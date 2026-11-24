const mongoose = require('mongoose');
const { PhieuNhap, PhieuNhapTongHop, PhieuTraHangNhap, PhieuTraHangTongHop, CTPhieuTraHangNhap, PhieuThuChi, Counter } = require('../models/kiot.model');
const { acquirePurchaseGroupMutationLock } = require('./purchaseGroup.service');
const { loadPurchaseSourceBalances } = require('./purchaseGroupQuery.service');
const { buildReceiptPaymentInfo } = require('./paymentCashBook.service');
const { taoPhieuThuChi } = require('./soQuy.service');

function ref(value) { return String(value && value._id || value || ''); }
function valid(value) { return mongoose.Types.ObjectId.isValid(ref(value)); }
function fail(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }); }
function nonnegative(value, label) {
  const number = Number(value == null || value === '' ? 0 : value);
  if (!Number.isFinite(number) || number < 0) throw fail(label + ' phải là số không âm.');
  return number;
}
function requireOperations(operations) {
  if (!operations || typeof operations.validateReturnItems !== 'function') throw new Error('Thiếu nghiệp vụ trả hàng nhập dùng chung.');
  return operations;
}
function effective(row) { return row && row.trang_thai !== 'cancelled' && row.trang_thai_du_lieu !== 'inactive' && !row.deleted_at; }
async function transaction(storeId, userId, operation) {
  if (!valid(storeId) || !valid(userId)) throw fail('Cửa hàng hoặc người thực hiện không hợp lệ.', 403);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      await acquirePurchaseGroupMutationLock(storeId, session);
      result = await operation(session);
    });
    return result;
  } finally { await session.endSession(); }
}
async function nextGroupCode(session) {
  const last = await PhieuTraHangTongHop.findOne({ ma_phieu_tra_tong_hop: /^THG\d+$/ }).sort({ ma_phieu_tra_tong_hop: -1 }).session(session).lean();
  const maximum = Number(String(last && last.ma_phieu_tra_tong_hop || '').replace(/^THG/, '')) || 0;
  await Counter.updateOne({ _id: 'phieu_tra_hang_nhap_tong_hop' }, { $max: { seq: maximum } }, { upsert: true, session });
  const counter = await Counter.findOneAndUpdate({ _id: 'phieu_tra_hang_nhap_tong_hop' }, { $inc: { seq: 1 } }, { upsert: true, new: true, session }).lean();
  return 'THG' + String(counter.seq).padStart(6, '0');
}
async function purchaseContext(groupId, storeId, session, allowHistorical = false) {
  if (!valid(groupId)) throw fail('Phiếu nhập tổng hợp không hợp lệ.');
  const filter = { _id: ref(groupId), cua_hang_id: ref(storeId) };
  if (!allowHistorical) filter.trang_thai = 'active';
  const group = await PhieuNhapTongHop.findOne(filter).session(session).lean();
  if (!group) throw fail('Không tìm thấy phiếu nhập tổng hợp còn hiệu lực.', 404);
  return group;
}
function assertSource(source, group) {
  if (!source || !effective(source) || source.trang_thai !== 'completed'
    || ref(source.kho_id) !== ref(group.kho_id) || ref(source.nha_cung_cap_id) !== ref(group.nha_cung_cap_id)
    || !(group.phieu_nguon_ids || []).some(id => ref(id) === ref(source._id))) {
    throw fail('Chỉ trả hàng từ phiếu nguồn đã nhập, còn hiệu lực, cùng kho và nhà cung cấp thuộc GPN.');
  }
}
function dateOf(value) {
  if (!value) return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw fail('Ngày trả hàng không hợp lệ.');
  return date;
}
function resultOf(group, children, receipt) {
  return { group, children, receipt: receipt || null, id: group._id, ma_phieu_tra_tong_hop: group.ma_phieu_tra_tong_hop,
    redirect: '/tra-hang-nhap?q=' + encodeURIComponent(group.ma_phieu_tra_tong_hop),
    tong_tien_tra: children.reduce((sum, child) => sum + Number(child.tong_tien_tra || 0), 0) };
}
async function createRefundReceipt(group, allocations, paymentBody, userId, session) {
  const amount = allocations.reduce((sum, row) => sum + Number(row.so_tien || 0), 0);
  if (!amount) return null;
  const payload = Object.assign({}, paymentBody, { loai_phieu: 'thu', gia_tri: amount, payment_v2: paymentBody.payment_v2 !== false });
  const paymentInfo = await buildReceiptPaymentInfo(payload, { cuaHangId: group.cua_hang_id, session });
  if (Number(paymentInfo.gia_tri) !== amount) throw fail('Tổng phân bổ hoàn tiền phải bằng tiền mặt và chuyển khoản thực nhận.');
  if (Number(paymentInfo.chi_tiet_thanh_toan && paymentInfo.chi_tiet_thanh_toan.tien_tra_khach || 0) > 0) {
    throw fail('Tiền trả khách không áp dụng cho thanh toán nhà cung cấp.');
  }
  return taoPhieuThuChi({
    loai_phieu: 'thu', loai_thu_chi: 'NCC hoan tien tra hang nhap', gia_tri: amount,
    ngay_lap: new Date(), cua_hang_id: group.cua_hang_id, nha_cung_cap_id: group.nha_cung_cap_id,
    nguoi_tao_id: ref(userId), nhom_doi_tuong: 'nha_cung_cap',
    phieu_nhap_tong_hop_id: group.phieu_nhap_tong_hop_id, phieu_tra_tong_hop_id: group._id,
    phieu_tra_hang_nhap_id: allocations.length === 1 ? allocations[0].phieu_tra_hang_nhap_id : undefined,
    document_type: 'khac', chung_tu_khac: group.ma_phieu_tra_tong_hop, ma_chung_tu_goc: group.ma_phieu_tra_tong_hop,
    allocation_type: 'hoan_tien_tra_nhap', allocations, hach_toan: false,
    request_key: String(paymentBody.request_key || '').trim() || undefined,
    ghi_chu: String(paymentBody.ghi_chu || '').trim() || 'NCC hoàn tiền ' + group.ma_phieu_tra_tong_hop,
    _paymentInfo: paymentInfo
  }, { session });
}
function refundAllocation(child, source, amount, remainingBefore) {
  const before = Math.max(0, Number(remainingBefore || 0));
  return { phieu_tra_hang_nhap_id: child._id, ma_phieu_tra_nhap: child.ma_phieu_tra_nhap,
    phieu_nhap_id: ref(child.phieu_nhap_id), ma_phieu_nhap: source && source.ma_phieu_nhap || '', so_tien: amount,
    con_no_truoc: before, con_no_sau: Math.max(0, before - amount) };
}
function splitPayment(payment, amount, remainingCash) {
  const cash = Math.min(amount, remainingCash.value);
  remainingCash.value -= cash;
  return { tien_mat: cash, chuyen_khoan: amount - cash, tien_tra_khach: 0,
    so_quy_tien_mat_id: payment.detail.so_quy_tien_mat_id || null,
    so_quy_chuyen_khoan_id: payment.detail.so_quy_chuyen_khoan_id || null };
}
function samePaymentDetail(left = {}, right = {}) {
  return ['tien_mat', 'chuyen_khoan', 'tien_tra_khach'].every(key => Number(left[key] || 0) === Number(right[key] || 0))
    && ['so_quy_tien_mat_id', 'so_quy_chuyen_khoan_id'].every(key => ref(left[key]) === ref(right[key]));
}
function plannedRefund(child) {
  // Old drafts stored their unreceived plan in ncc_da_tra. Read it only while
  // completing that draft; never expose it as actual received money.
  return nonnegative(child.ncc_hoan_du_kien != null ? child.ncc_hoan_du_kien : child.ncc_da_tra, 'Tiền hoàn dự kiến');
}
function paymentBodyWithDefaults(savedPayment, legacyCashBook, data) {
  const keys = ['tien_mat', 'chuyen_khoan', 'tien_tra_khach', 'so_quy_tien_mat_id', 'so_quy_chuyen_khoan_id'];
  const supplied = data.chi_tiet_thanh_toan || keys.some(key => data[key] != null);
  return supplied ? Object.assign({ payment_v2: true }, data) : Object.assign({
    payment_v2: true, chi_tiet_thanh_toan: savedPayment, so_quy_id: ref(legacyCashBook)
  }, data);
}
function sameRefundRequest(receipt, data) {
  const requested = data.allocations.map(row => [ref(row.phieu_tra_hang_nhap_id), nonnegative(row.so_tien, 'Tiền hoàn')])
    .filter(row => row[1] > 0).sort((a, b) => a[0].localeCompare(b[0]));
  const recorded = (receipt.allocations || []).map(row => [ref(row.phieu_tra_hang_nhap_id), Number(row.so_tien || 0)])
    .filter(row => row[1] > 0).sort((a, b) => a[0].localeCompare(b[0]));
  if (JSON.stringify(requested) !== JSON.stringify(recorded)) return false;
  const input = data.chi_tiet_thanh_toan || data;
  const actual = receipt.chi_tiet_thanh_toan || {};
  return ['tien_mat', 'chuyen_khoan', 'tien_tra_khach'].every(key => nonnegative(input[key], 'Tiền hoàn') === Number(actual[key] || 0))
    && ['so_quy_tien_mat_id', 'so_quy_chuyen_khoan_id'].every(key => !input[key] || ref(input[key]) === ref(actual[key]));
}
async function applyChildEffects(child, rows, source, operations, userId, session) {
  await operations.completeInventory(child, rows, userId, { session });
  const offset = Number(child.gia_tri_can_tru_cong_no || 0);
  if (offset > 0) {
    await operations.applySupplierDebt(child, { session, debtAmount: offset });
    const current = source.payment_current || {};
    // Legacy return reductions are still projected separately by supplier
    // reports. Persist only explicit THG offsets in the source header cache.
    const storedDebt = Number.isFinite(Number(current.payable)) && Number.isFinite(Number(current.paid))
      ? Number(current.payable) - Number(current.paid) - Number(current.explicit_return_debt_reduction || 0)
      : Number(source.con_no_ncc || 0);
    await PhieuNhap.updateOne({ _id: source._id, cua_hang_id: child.cua_hang_id }, { $set: { con_no_ncc: Math.max(0, storedDebt - offset) } }, { session });
  }
}

async function createPurchaseGroupReturn({ groupId, storeId, userId, data = {} } = {}, { operations } = {}) {
  const ops = requireOperations(operations);
  let entries = data.sources;
  if (typeof entries === 'string') { try { entries = JSON.parse(entries); } catch (_) { throw fail('Danh sách phiếu nguồn không hợp lệ.'); } }
  if (!Array.isArray(entries) || !entries.length) throw fail('Vui lòng chọn hàng trả từ ít nhất một phiếu nguồn.');
  const ids = entries.map(row => ref(row.phieu_nhap_id));
  if (ids.some(id => !valid(id)) || new Set(ids).size !== ids.length) throw fail('Phiếu nguồn không hợp lệ hoặc bị trùng.');
  const requestKey = String(data.request_key || '').trim();
  if (!requestKey || requestKey.length > 120) throw fail('Mã yêu cầu không hợp lệ. Vui lòng tải lại biểu mẫu trả hàng.');
  return transaction(storeId, userId, async session => {
    if (requestKey) {
      const previous = await PhieuTraHangTongHop.findOne({ cua_hang_id: ref(storeId), request_key: requestKey }).session(session).lean();
      if (previous) {
        if (ref(previous.phieu_nhap_tong_hop_id) !== ref(groupId)) throw fail('Mã yêu cầu đã được sử dụng.');
        const children = await PhieuTraHangNhap.find({ phieu_tra_tong_hop_id: previous._id, cua_hang_id: ref(storeId) }).session(session).lean();
        const receipt = await PhieuThuChi.findOne({ phieu_tra_tong_hop_id: previous._id, loai_phieu: 'thu' }).session(session).lean();
        return resultOf(previous, children, receipt);
      }
    }
    const group = await purchaseContext(groupId, storeId, session);
    const sources = await loadPurchaseSourceBalances(ids, storeId, { session });
    if (sources.length !== ids.length) throw fail('Không tìm thấy đủ phiếu nhập nguồn.');
    const mode = data.submitMode === 'completed' ? 'completed' : 'draft';
    const planned = [];
    for (const entry of entries) {
      const source = sources.find(row => ref(row._id) === ref(entry.phieu_nhap_id));
      assertSource(source, group);
      const rows = await ops.validateReturnItems({ items: ops.parseItems(entry.items_json || entry.items), storeId, khoId: ref(group.kho_id),
        phieuNhapId: ref(source._id), purchaseGroupId: ref(group._id), session });
      const discountType = entry.kieu_giam_gia === 'percent' ? 'percent' : 'vnd';
      const totals = ops.computeTotals(rows, nonnegative(entry.giam_gia, 'Giảm giá'), discountType);
      const offset = nonnegative(entry.gia_tri_can_tru_cong_no, 'Cấn trừ công nợ');
      const refund = nonnegative(entry.ncc_da_tra, 'NCC hoàn tiền');
      const debt = Number(source.payment_current ? source.payment_current.debt : source.con_no_ncc) || 0;
      if (offset > debt || offset + refund > totals.tong_tien_tra) throw fail('Cấn trừ không được vượt nợ PN; cấn trừ và tiền hoàn không được vượt giá trị trả.');
      planned.push({ source, rows, totals, offset, refund, discountType });
    }
    if (ops.assertCombinedReturnInventory) await ops.assertCombinedReturnInventory(planned.flatMap(row => row.rows), { khoId: ref(group.kho_id), session });
    const refundTotal = planned.reduce((sum, row) => sum + row.refund, 0);
    const payment = ops.normalizePaymentDetail(data, refundTotal);
    if (payment.amount !== refundTotal) throw fail('Tổng phân bổ hoàn tiền phải bằng tiền mặt và chuyển khoản thực nhận.');
    const groupRows = await PhieuTraHangTongHop.create([{
      ma_phieu_tra_tong_hop: await nextGroupCode(session), request_key: requestKey || undefined,
      phieu_nhap_tong_hop_id: group._id, cua_hang_id: ref(storeId), kho_id: group.kho_id, nha_cung_cap_id: group.nha_cung_cap_id,
      ngay_tra: dateOf(data.ngay_tra), nguoi_tao_id: ref(userId), ghi_chu: String(data.ghi_chu || '').trim(), trang_thai: 'active'
    }], { session });
    const returnGroup = groupRows[0];
    const children = [], allocations = [], remainingCash = { value: Number(payment.detail.tien_mat || 0) };
    for (const plan of planned) {
      const plannedDetail = splitPayment(payment, plan.refund, remainingCash);
      const received = mode === 'completed' ? plan.refund : 0;
      const childRows = await PhieuTraHangNhap.create([{
        cua_hang_id: ref(storeId), kho_id: group.kho_id, nha_cung_cap_id: group.nha_cung_cap_id,
        phieu_nhap_id: plan.source._id, phieu_tra_tong_hop_id: returnGroup._id,
        ma_phieu_tra_nhap: await ops.makeReturnCode(session), ngay_tra: returnGroup.ngay_tra,
        tong_tien_hang: plan.totals.tong_tien_hang, tong_tien_tra: plan.totals.tong_tien_tra,
        giam_gia: plan.totals.giam_gia, kieu_giam_gia: plan.discountType,
        gia_tri_can_tru_cong_no: plan.offset, tinh_vao_cong_no: plan.offset > 0,
        ncc_can_tra: plan.totals.tong_tien_tra - plan.offset, ncc_da_tra: received,
        ncc_con_phai_tra: plan.totals.tong_tien_tra - plan.offset - received,
        ncc_hoan_du_kien: mode === 'draft' ? plan.refund : undefined,
        chi_tiet_hoan_du_kien: mode === 'draft' ? plannedDetail : undefined,
        so_quy_id: !payment.isV2 && valid(data.so_quy_id) ? ref(data.so_quy_id) : undefined,
        chi_tiet_thanh_toan: mode === 'completed' ? plannedDetail : { tien_mat: 0, chuyen_khoan: 0, tien_tra_khach: 0 },
        trang_thai: mode, ghi_chu: returnGroup.ghi_chu, nguoi_tao_id: ref(userId), nguoi_tra_id: ref(userId)
      }], { session });
      const child = childRows[0];
      await ops.persistDetails(child._id, plan.rows, { session });
      if (mode === 'completed') await applyChildEffects(child, plan.rows, plan.source, ops, userId, session);
      if (plan.refund > 0) allocations.push(refundAllocation(child, plan.source, plan.refund, child.ncc_can_tra));
      children.push(child);
    }
    const receipt = mode === 'completed' ? await createRefundReceipt(returnGroup, allocations, data, userId, session) : null;
    if (receipt) {
      const actualPayment = { detail: receipt.chi_tiet_thanh_toan || {} };
      const actualCash = { value: Number(actualPayment.detail.tien_mat || 0) };
      for (const child of children) {
        const actualDetail = splitPayment(actualPayment, Number(child.ncc_da_tra || 0), actualCash);
        // Payment V2 can resolve a default book. Persist that resolved reference,
        // while avoiding a second write when the explicit plan already matches.
        if (!samePaymentDetail(child.chi_tiet_thanh_toan, actualDetail)) {
          child.chi_tiet_thanh_toan = actualDetail;
          await child.save({ session });
        }
      }
    }
    return resultOf(returnGroup, children, receipt);
  });
}

async function completePurchaseGroupReturn({ returnGroupId, storeId, userId, data = {} } = {}, { operations } = {}) {
  const ops = requireOperations(operations);
  if (!valid(returnGroupId)) throw fail('Phiếu trả tổng hợp không hợp lệ.');
  return transaction(storeId, userId, async session => {
    const group = await PhieuTraHangTongHop.findOne({ _id: ref(returnGroupId), cua_hang_id: ref(storeId), trang_thai: 'active' }).session(session).lean();
    if (!group) throw fail('Không tìm thấy phiếu trả tổng hợp còn hiệu lực.', 404);
    const children = await PhieuTraHangNhap.find({ phieu_tra_tong_hop_id: group._id, cua_hang_id: ref(storeId) }).session(session);
    if (!children.length || children.some(row => !effective(row))) throw fail('Phiếu trả tổng hợp có phiếu nguồn không còn hiệu lực.');
    if (children.every(row => row.trang_thai === 'completed')) return resultOf(group, children, null);
    if (children.some(row => row.trang_thai !== 'draft')) throw fail('Không thể hoàn thành nhóm có trạng thái phiếu nguồn không đồng nhất.');
    const purchaseGroup = await purchaseContext(group.phieu_nhap_tong_hop_id, storeId, session, true);
    const sources = await loadPurchaseSourceBalances(children.map(row => row.phieu_nhap_id), storeId, { session });
    const plans = [], allocations = [];
    for (const child of children) {
      const source = sources.find(row => ref(row._id) === ref(child.phieu_nhap_id));
      assertSource(source, purchaseGroup);
      const debt = Number(source.payment_current ? source.payment_current.debt : source.con_no_ncc) || 0;
      if (Number(child.gia_tri_can_tru_cong_no || 0) > debt) throw fail('Công nợ PN đã thay đổi, không đủ để cấn trừ phiếu trả tạm.');
      const savedRows = await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: child._id }).session(session).lean();
      const rows = await ops.validateReturnItems({ items: savedRows, storeId, khoId: ref(group.kho_id), phieuNhapId: ref(source._id),
        returnId: child._id, purchaseGroupId: ref(purchaseGroup._id), session });
      const refund = plannedRefund(child);
      if (refund > Number(child.ncc_can_tra || 0)) throw fail('Tiền hoàn dự kiến vượt số NCC cần trả của phiếu tạm.');
      plans.push({ child, source, rows, refund });
      if (refund > 0) allocations.push(refundAllocation(child, source, refund, child.ncc_can_tra));
    }
    if (ops.assertCombinedReturnInventory) await ops.assertCombinedReturnInventory(plans.flatMap(row => row.rows), { khoId: ref(group.kho_id), session });
    const savedPayment = { tien_mat: 0, chuyen_khoan: 0, tien_tra_khach: 0 };
    children.forEach(child => {
      const detail = child.chi_tiet_hoan_du_kien || child.chi_tiet_thanh_toan || {};
      savedPayment.tien_mat += Number(detail.tien_mat || 0); savedPayment.chuyen_khoan += Number(detail.chuyen_khoan || 0);
      savedPayment.so_quy_tien_mat_id = savedPayment.so_quy_tien_mat_id || detail.so_quy_tien_mat_id;
      savedPayment.so_quy_chuyen_khoan_id = savedPayment.so_quy_chuyen_khoan_id || detail.so_quy_chuyen_khoan_id;
    });
    const paymentBody = paymentBodyWithDefaults(savedPayment, children[0].so_quy_id, data);
    const refundTotal = allocations.reduce((sum, row) => sum + row.so_tien, 0);
    const payment = ops.normalizePaymentDetail(paymentBody, refundTotal);
    if (payment.amount !== refundTotal) throw fail('Tổng phân bổ hoàn tiền phải bằng tiền mặt và chuyển khoản thực nhận.');
    // One shared receipt is written in the same transaction as the inventory,
    // debt and child balances; a failed cash book check leaves the draft intact.
    const receipt = await createRefundReceipt(group, allocations, paymentBody, userId, session);
    const actualPayment = receipt ? { detail: receipt.chi_tiet_thanh_toan || {} } : payment;
    const remainingCash = { value: Number(actualPayment.detail.tien_mat || 0) };
    for (const plan of plans) {
      await applyChildEffects(plan.child, plan.rows, plan.source, ops, userId, session);
      plan.child.ncc_da_tra = plan.refund;
      plan.child.ncc_con_phai_tra = Math.max(0, Number(plan.child.ncc_can_tra || 0) - plan.refund);
      plan.child.chi_tiet_thanh_toan = splitPayment(actualPayment, plan.refund, remainingCash);
      plan.child.ncc_hoan_du_kien = undefined;
      plan.child.chi_tiet_hoan_du_kien = undefined;
      plan.child.trang_thai = 'completed'; plan.child.nguoi_tra_id = ref(userId);
      await plan.child.save({ session });
    }
    return resultOf(group, children, receipt);
  });
}

async function receivePurchaseGroupReturnRefund({ returnGroupId, storeId, userId, data = {} } = {}) {
  if (!valid(returnGroupId) || !Array.isArray(data.allocations) || !data.allocations.length) throw fail('Vui lòng xác nhận phân bổ tiền hoàn về các THN.');
  const requestKey = String(data.request_key || '').trim();
  if (requestKey.length > 120) throw fail('Mã yêu cầu hoàn tiền không hợp lệ.');
  return transaction(storeId, userId, async session => {
    const group = await PhieuTraHangTongHop.findOne({ _id: ref(returnGroupId), cua_hang_id: ref(storeId), trang_thai: 'active' }).session(session).lean();
    if (!group) throw fail('Không tìm thấy phiếu trả tổng hợp.', 404);
    if (data.doi_tuong_entity_id && ref(data.doi_tuong_entity_id) !== ref(group.nha_cung_cap_id)) {
      throw fail('Phiếu trả tổng hợp không thuộc nhà cung cấp đã chọn.');
    }
    if (requestKey) {
      const previous = await PhieuThuChi.findOne({
        cua_hang_id: ref(storeId), phieu_tra_tong_hop_id: group._id,
        loai_phieu: 'thu', allocation_type: 'hoan_tien_tra_nhap', request_key: requestKey
      }).session(session).lean();
      if (previous) {
        if (previous.trang_thai === 'cancelled' || !sameRefundRequest(previous, data)) throw fail('Mã yêu cầu đã được dùng cho khoản hoàn tiền khác.', 409);
        return { receipt: previous, allocations: previous.allocations, group };
      }
    }
    const children = await PhieuTraHangNhap.find({ phieu_tra_tong_hop_id: group._id, cua_hang_id: ref(storeId) })
      .populate('phieu_nhap_id', 'ma_phieu_nhap').session(session);
    const allocations = [], updates = [], seen = new Set();
    for (const entry of data.allocations) {
      const child = children.find(row => ref(row._id) === ref(entry.phieu_tra_hang_nhap_id));
      const amount = nonnegative(entry.so_tien, 'Tiền hoàn');
      if (!child || !effective(child) || child.trang_thai !== 'completed'
        || ref(child.nha_cung_cap_id) !== ref(group.nha_cung_cap_id) || ref(child.kho_id) !== ref(group.kho_id)
        || seen.has(ref(child._id)) || amount > Number(child.ncc_con_phai_tra || 0)) throw fail('Phân bổ tiền hoàn không hợp lệ hoặc vượt số NCC còn phải trả của THN.');
      if (amount > 0 && (!Number.isFinite(Number(entry.con_phai_tra_truoc)) || Number(entry.con_phai_tra_truoc) !== Number(child.ncc_con_phai_tra || 0))) {
        throw fail('Số NCC còn phải trả đã thay đổi. Vui lòng tải lại và xác nhận phân bổ tiền hoàn.', 409);
      }
      seen.add(ref(child._id));
      if (!amount) continue;
      allocations.push(refundAllocation(child, child.phieu_nhap_id, amount, child.ncc_con_phai_tra)); updates.push({ child, amount });
    }
    if (!allocations.length) throw fail('Tiền hoàn phải lớn hơn 0.');
    const receipt = await createRefundReceipt(group, allocations, data, userId, session);
    const actualPayment = { detail: receipt.chi_tiet_thanh_toan || {} };
    const remainingCash = { value: Number(actualPayment.detail.tien_mat || 0) };
    for (const { child, amount } of updates) {
      const delta = splitPayment(actualPayment, amount, remainingCash);
      const current = child.chi_tiet_thanh_toan || {};
      child.ncc_da_tra = Number(child.ncc_da_tra || 0) + amount;
      child.ncc_con_phai_tra = Math.max(0, Number(child.ncc_can_tra || 0) - child.ncc_da_tra);
      child.chi_tiet_thanh_toan = {
        tien_mat: Number(current.tien_mat || 0) + delta.tien_mat,
        so_quy_tien_mat_id: delta.tien_mat > 0 ? delta.so_quy_tien_mat_id : (current.so_quy_tien_mat_id || null),
        chuyen_khoan: Number(current.chuyen_khoan || 0) + delta.chuyen_khoan,
        so_quy_chuyen_khoan_id: delta.chuyen_khoan > 0 ? delta.so_quy_chuyen_khoan_id : (current.so_quy_chuyen_khoan_id || null),
        tien_tra_khach: 0
      };
      await child.save({ session });
    }
    return { receipt, allocations, group };
  });
}
module.exports = { createPurchaseGroupReturn, completePurchaseGroupReturn, receivePurchaseGroupReturnRefund };
