const mongoose = require('mongoose');
const models = require('../models/kiot.model');
const { buildReceiptPaymentInfo } = require('./paymentCashBook.service');
const { taoPhieuThuChi } = require('./soQuy.service');

const LINKED_SOURCES = new Set(['phieu_nhap', 'phieu_tra_hang_nhap', 'don_hang', 'hoa_don', 'tra_hang_ban']);
const SOURCE_MODELS = { phieu_nhap: 'PhieuNhap', phieu_tra_hang_nhap: 'PhieuTraHangNhap', don_hang: 'DonHang', hoa_don: 'HoaDonBanHang', tra_hang_ban: 'PhieuTraHang' };
function ref(value) { return String(value && value._id || value || '').trim(); }
function valid(value) { return mongoose.Types.ObjectId.isValid(ref(value)); }
function effectiveCash(row) { return row && !['cancelled', 'inactive'].includes(row.trang_thai) && row.trang_thai_du_lieu !== 'inactive' && !row.deleted_at; }
function sameReceiptPayment(receipt, detail) {
  const amount = Number(detail.tien_mat || 0) + Number(detail.chuyen_khoan || 0);
  if (Number(receipt.gia_tri || 0) !== amount) return false;
  const recorded = receipt.chi_tiet_thanh_toan || {};
  return ['tien_mat', 'chuyen_khoan'].every(key => Number(recorded[key] || 0) === Number(detail[key] || 0))
    && ['so_quy_tien_mat_id', 'so_quy_chuyen_khoan_id'].every(key => !detail[key] || ref(recorded[key]) === ref(detail[key]));
}
function scoped(query, session) { return session ? query.session(session) : query; }
function checkbox(value) { return value === true || value === 'true' || value === '1' || value === 'on'; }
function money(value, label = 'Đơn giá vật chứa') {
  if (value == null || value === '') return 0;
  const number = typeof value === 'number' ? value : Number(String(value).replace(/[.,\s]/g, ''));
  if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(number)) throw new Error(label + ' không hợp lệ.');
  return number;
}
function paymentInput(data = {}) {
  let nested = data.vat_chua_thanh_toan || {};
  if (typeof nested === 'string') { try { nested = JSON.parse(nested); } catch (_) { throw new Error('Thanh toán vật chứa không hợp lệ.'); } }
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) throw new Error('Thanh toán vật chứa không hợp lệ.');
  const read = key => nested[key] ?? data['vat_chua_thanh_toan[' + key + ']'];
  return {
    tien_mat: money(read('tien_mat'), 'Tiền mặt vật chứa'),
    so_quy_tien_mat_id: ref(read('so_quy_tien_mat_id')),
    chuyen_khoan: money(read('chuyen_khoan'), 'Tiền chuyển khoản vật chứa'),
    so_quy_chuyen_khoan_id: ref(read('so_quy_chuyen_khoan_id')),
    tien_tra_khach: money(read('tien_tra_khach'), 'Tiền trả khách vật chứa')
  };
}
function parseLinkedMoney(data, qty) {
  const transactionPrice = money(data.vat_chua_don_gia_giao_dich ?? data.don_gia_giao_dich);
  const transactionTotal = transactionPrice * Math.abs(qty || 0);
  if (!Number.isSafeInteger(transactionTotal) || transactionTotal < 0) throw new Error('Thành tiền vật chứa không hợp lệ.');
  const recognizeCash = checkbox(data.vat_chua_ghi_nhan_thu_chi);
  const payment = paymentInput(data);
  if (payment.tien_tra_khach > 0) throw new Error('Tiền trả khách không áp dụng cho thanh toán vật chứa đi kèm.');
  if (recognizeCash && transactionTotal <= 0) throw new Error('Chỉ ghi Thu chi khi thành tiền vật chứa lớn hơn 0.');
  if (recognizeCash && payment.tien_mat + payment.chuyen_khoan > transactionTotal) throw new Error('Tiền thực thu/chi vật chứa không được vượt thành tiền.');
  return { transactionPrice, transactionTotal, recognizeCash, payment };
}
function linkedOptions(parsed, data = {}) {
  return { transactionPrice: parsed.transactionPrice, recognizeCash: parsed.recognizeCash,
    linkedPayment: parsed.payment, operationKey: data.vat_chua_operation_key, userId: data.nguoi_tao_id || data.user_id };
}
async function inTransaction(session, operation) {
  if (session) return operation(session);
  const ownSession = await mongoose.startSession();
  try { let result; await ownSession.withTransaction(async () => { result = await operation(ownSession); }); return result; }
  finally { await ownSession.endSession(); }
}
function operationKey(options) {
  const source = ref(options.sourceId);
  if (!LINKED_SOURCES.has(options.sourceType) || !valid(source)) return undefined;
  if (options.sourceType === 'hoa_don' && valid(options.relatedOrderId) && String(options.operationKey || '').startsWith('delivery:')) {
    return String(options.operationKey);
  }
  // Single source documents cannot bypass idempotency by changing a client key.
  const event = options.sourceType === 'don_hang' ? ref(options.operationKey) : '';
  return options.sourceType + ':' + source + (event ? ':' + event : '');
}
async function lockLinkedSource(options, session) {
  if (!LINKED_SOURCES.has(options.sourceType) || !valid(options.sourceId)) return;
  if (options.sourceType === 'hoa_don' && valid(options.relatedOrderId) && String(options.operationKey || '').startsWith('delivery:')) {
    const orderLock = await models.DonHang.updateOne({ _id: ref(options.relatedOrderId), cua_hang_id: ref(options.storeId),
      trang_thai: { $ne: 'cancelled' }, trang_thai_du_lieu: { $ne: 'inactive' }, deleted_at: null }, { $currentDate: { updated_at: true } }, { session });
    if (!orderLock || Number(orderLock.matchedCount ?? orderLock.n ?? orderLock.modifiedCount ?? 0) < 1) throw new Error('Đơn hàng nguồn vật chứa không hợp lệ.');
  }
  const Model = models[SOURCE_MODELS[options.sourceType]];
  const update = await Model.updateOne({ _id: ref(options.sourceId), cua_hang_id: ref(options.storeId),
    trang_thai: { $nin: options.sourceType === 'don_hang' ? ['cancelled'] : ['cancelled', 'draft'] },
    trang_thai_du_lieu: { $ne: 'inactive' }, deleted_at: null }, { $currentDate: { updated_at: true } }, { session });
  if (!update || Number(update.matchedCount ?? update.n ?? update.modifiedCount ?? 0) < 1) throw new Error('Chứng từ nguồn vật chứa không thuộc cửa hàng đang làm việc.');
}
async function loadLinkedCash(doc, kind, session, includeCancelled = false) {
  if (!doc || !doc._id) return [];
  const field = kind === 'nhap' ? 'nhap_vat_chua_id' : 'xuat_vat_chua_id';
  return scoped(models.PhieuThuChi.find({ cua_hang_id: doc.cua_hang_id, [field]: doc._id,
    ...(includeCancelled ? {} : { trang_thai: { $nin: ['cancelled', 'inactive'] }, trang_thai_du_lieu: { $ne: 'inactive' }, deleted_at: null }) })
    .setOptions({ strictQuery: false }), session).lean();
}
async function assertLinkedCashCanChange(doc, kind, session) {
  if ((await loadLinkedCash(doc, kind, session)).length) {
    throw new Error('Vật chứa đã phát sinh Thu chi. Vui lòng xử lý điều chỉnh/hủy phiếu thu chi theo nghiệp vụ trước khi đổi hoặc hủy chứng từ vật chứa.');
  }
}
async function loadLinkedMovement(Model, options, kind, session) {
  const key = operationKey(options);
  if (!key) return null;
  await lockLinkedSource(options, session);
  let eventMovement = null;
  if (key.startsWith('delivery:')) {
    eventMovement = await scoped(Model.findOne({ cua_hang_id: ref(options.storeId), operation_key: key,
      trang_thai: 'active', deleted_at: null }), session);
    if (eventMovement && ref(eventMovement.hoa_don_id || eventMovement.source_id) !== ref(options.sourceId)) {
      throw new Error('Lần giao vật chứa đã được ghi nhận. Vui lòng tải lại đơn hàng.');
    }
  }
  const filter = { cua_hang_id: ref(options.storeId),
    ...(options.sourceType === 'hoa_don' && kind === 'xuat'
      ? { $or: [{ source_type: options.sourceType, source_id: ref(options.sourceId) }, { hoa_don_id: ref(options.sourceId) }] }
      : { source_type: options.sourceType, source_id: ref(options.sourceId) }),
    trang_thai: 'active', deleted_at: null };
  if (options.sourceType === 'don_hang' && options.operationKey) filter.operation_key = key;
  let existing = eventMovement || await scoped(Model.findOne(filter), session);
  if (!existing && options.sourceType === 'hoa_don' && kind === 'xuat' && valid(options.relatedOrderId)) {
    const candidates = await scoped(Model.find({ cua_hang_id: ref(options.storeId), source_type: 'don_hang',
      source_id: ref(options.relatedOrderId), trang_thai: 'active', deleted_at: null,
      $or: [{ hoa_don_id: null }, { hoa_don_id: ref(options.sourceId) }] }), session);
    const exact = candidates.filter(doc => (doc.items || []).length === 1 && ref(doc.items[0].vat_chua_id) === ref(options.vatChuaId)
      && Number(doc.items[0].so_luong) === Number(options.qty));
    if (exact.length > 1) throw new Error('Có nhiều đợt giao vật chứa phù hợp. Vui lòng mở hóa đơn của đúng đợt giao hàng.');
    if (exact.length === 1) existing = exact[0];
  }
  if (!existing) return null;
  const oldLine = (existing.items || [])[0] || {};
  const changed = ref(oldLine.vat_chua_id) !== ref(options.vatChuaId)
    || Number(oldLine.so_luong || 0) !== Number(options.qty || 0)
    || Number(oldLine.don_gia_giao_dich || 0) !== Number(options.transactionPrice || 0)
    || Boolean(existing.ghi_nhan_thu_chi) !== Boolean(options.recognizeCash)
    || ref(existing.doi_tuong_id) !== ref(options.doiTuongId);
  if (changed) await assertLinkedCashCanChange(existing, kind, session);
  return existing;
}
async function validateLinkedPayment(detail, storeId, direction, total, session) {
  const amount = money(detail.tien_mat, 'Tiền mặt vật chứa') + money(detail.chuyen_khoan, 'Tiền chuyển khoản vật chứa');
  if (!amount) return null;
  if (amount > total) throw new Error('Tiền thực thu/chi vật chứa không được vượt thành tiền.');
  for (const [moneyKey, bookKey] of [['tien_mat', 'so_quy_tien_mat_id'], ['chuyen_khoan', 'so_quy_chuyen_khoan_id']]) {
    if (Number(detail[moneyKey] || 0) <= 0) continue;
    if (!valid(detail[bookKey])) throw new Error('Vui lòng chọn sổ quỹ cho khoản thực thu/chi vật chứa.');
    const book = await scoped(models.SoQuy.findOne({ _id: ref(detail[bookKey]), trang_thai: 'active' }).setOptions({ strictQuery: false }), session).lean();
    // Existing cash books are shared. Honor an explicit owner where present.
    if (!book || (book.cua_hang_id && ref(book.cua_hang_id) !== ref(storeId))) throw new Error('Sổ quỹ vật chứa không thuộc cửa hàng hoặc đã ngừng hoạt động.');
  }
  return buildReceiptPaymentInfo({ loai_phieu: direction, payment_v2: true, chi_tiet_thanh_toan: { ...detail, tien_tra_khach: 0 } }, { cuaHangId: storeId, session });
}
async function assertLinkedContainerChange({ storeId, sourceType, sourceId, data = {}, direction, relatedOrderId } = {}, session) {
  if (!valid(storeId) || !valid(sourceId) || !LINKED_SOURCES.has(sourceType)) throw new Error('Chứng từ nguồn vật chứa không hợp lệ.');
  const requestedId = ref(data.vat_chua_id);
  const qty = Math.abs(Number(String(data.vat_chua_so_luong ?? '').replace(/[.,\s]/g, '')) || 0);
  const parsed = parseLinkedMoney(data, qty);
  const kind = direction || (sourceType === 'phieu_nhap' || sourceType === 'tra_hang_ban' && Number(data.vat_chua_so_luong) > 0 ? 'nhap' : 'xuat');
  const rows = await Promise.all([models.NhapVatChua, models.XuatVatChua].map((Model, index) => scoped(Model.find({
    cua_hang_id: ref(storeId), trang_thai: 'active', deleted_at: null,
    ...(sourceType === 'hoa_don' && index === 1 ? { $or: [{ source_type: sourceType, source_id: ref(sourceId) }, { hoa_don_id: ref(sourceId) }] }
      : { source_type: sourceType, source_id: ref(sourceId) })
  }), session).lean()));
  let hasRecordedCash = false;
  if (sourceType === 'hoa_don' && !rows[1].length) {
    const invoice = valid(relatedOrderId) ? null : await scoped(models.HoaDonBanHang.findOne({ _id: ref(sourceId), cua_hang_id: ref(storeId) }), session).lean();
    const orderId = ref(relatedOrderId || invoice && invoice.don_hang_id);
    if (valid(orderId)) {
      const candidates = await scoped(models.XuatVatChua.find({ cua_hang_id: ref(storeId), source_type: 'don_hang', source_id: orderId,
        trang_thai: 'active', deleted_at: null, $or: [{ hoa_don_id: null }, { hoa_don_id: ref(sourceId) }] }), session).lean();
      const exact = requestedId ? candidates.filter(doc => (doc.items || []).length === 1 && ref(doc.items[0].vat_chua_id) === requestedId && Number(doc.items[0].so_luong) === qty) : candidates;
      if (exact.length > 1) throw new Error('Có nhiều đợt giao vật chứa phù hợp. Vui lòng mở hóa đơn của đúng đợt giao hàng.');
      if (exact.length === 1) rows[1].push(exact[0]);
    }
  }
  for (let index = 0; index < rows.length; index++) for (const doc of rows[index]) {
    const oldKind = index === 0 ? 'nhap' : 'xuat';
    const line = (doc.items || [])[0] || {};
    const requestedParty = Object.prototype.hasOwnProperty.call(data, 'khach_hang_id') ? ref(data.khach_hang_id)
      : Object.prototype.hasOwnProperty.call(data, 'nha_cung_cap_id') ? ref(data.nha_cung_cap_id) : undefined;
    const changed = !requestedId || ref(line.vat_chua_id) !== requestedId || Number(line.so_luong) !== qty || oldKind !== kind
      || Number(line.don_gia_giao_dich || 0) !== parsed.transactionPrice || Boolean(doc.ghi_nhan_thu_chi) !== parsed.recognizeCash
      || requestedParty !== undefined && requestedParty !== ref(doc.doi_tuong_id);
    if (changed) await assertLinkedCashCanChange(doc, oldKind, session);
    const actualAmount = parsed.payment.tien_mat + parsed.payment.chuyen_khoan;
    const cash = await loadLinkedCash(doc, oldKind, session, true);
    if (cash.length) hasRecordedCash = true;
    if (!changed && actualAmount > 0) {
      if (cash.length && (!cash.some(effectiveCash) || !cash.some(row => effectiveCash(row) && sameReceiptPayment(row, parsed.payment)))) {
        throw new Error('Khoản Thu chi vật chứa đã ghi nhận; vui lòng sử dụng quy trình điều chỉnh tiền.');
      }
    }
    if ((!requestedId || oldKind !== kind || ref(line.vat_chua_id) !== requestedId) && oldKind === 'nhap') {
      const old = await scoped(models.VatChua.findOne({ _id: line.vat_chua_id, cua_hang_id: ref(storeId) }), session).lean();
      if (!old || Number(old.so_luong_ton) < Number(line.so_luong)) throw new Error('Tồn vật chứa không đủ để điều chỉnh phiếu nhập.');
    }
    if (requestedId && oldKind === 'nhap' && kind === 'nhap' && ref(line.vat_chua_id) === requestedId && Number(line.so_luong) > qty) {
      const old = await scoped(models.VatChua.findOne({ _id: line.vat_chua_id, cua_hang_id: ref(storeId) }), session).lean();
      if (!old || Number(old.so_luong_ton) < Number(line.so_luong) - qty) throw new Error('Tồn vật chứa không đủ để điều chỉnh phiếu nhập.');
    }
  }
  if (!requestedId) return;
  if (!valid(requestedId) || !Number.isSafeInteger(qty) || qty <= 0) throw new Error('Vật chứa hoặc số lượng vật chứa không hợp lệ.');
  const item = await scoped(models.VatChua.findOne({ _id: requestedId, cua_hang_id: ref(storeId), trang_thai: 'active' }), session).lean();
  if (!item) throw new Error('Vật chứa không hợp lệ hoặc đã ngừng sử dụng.');
  if (kind === 'xuat') {
    const oldQty = rows[1].reduce((sum, doc) => sum + (doc.items || []).filter(line => ref(line.vat_chua_id) === requestedId).reduce((n, line) => n + Number(line.so_luong || 0), 0), 0);
    if (Number(item.so_luong_ton || 0) + oldQty < qty) throw new Error('Tồn vật chứa không đủ để xuất.');
  }
  if (parsed.recognizeCash && !hasRecordedCash) await validateLinkedPayment(parsed.payment, ref(storeId), kind === 'nhap' ? 'chi' : 'thu', parsed.transactionTotal, session);
}
async function createLinkedContainerReceipt(doc, kind, options = {}, session) {
  if (!LINKED_SOURCES.has(doc.source_type) || !doc.ghi_nhan_thu_chi) return null;
  const detail = options.linkedPayment || {};
  const amount = money(detail.tien_mat, 'Tiền mặt vật chứa') + money(detail.chuyen_khoan, 'Tiền chuyển khoản vật chứa');
  if (!amount) return null;
  const total = (doc.items || []).reduce((sum, line) => sum + Number(line.thanh_tien_giao_dich || 0), 0);
  if (amount > total) throw new Error('Tiền thực thu/chi vật chứa không được vượt thành tiền.');
  const previous = await loadLinkedCash(doc, kind, session, true);
  if (previous.length) {
    const active = previous.find(effectiveCash);
    if (active) {
      if (!sameReceiptPayment(active, detail)) throw new Error('Khoản Thu chi vật chứa đã ghi nhận; vui lòng sử dụng quy trình điều chỉnh tiền.');
      return active;
    }
    throw new Error('Phiếu Thu chi vật chứa trước đã hủy. Vui lòng sử dụng quy trình điều chỉnh/thanh toán hiện có.');
  }
  const direction = kind === 'nhap' ? 'chi' : 'thu';
  const field = kind === 'nhap' ? 'nhap_vat_chua_id' : 'xuat_vat_chua_id';
  const code = kind === 'nhap' ? doc.ma_nhap_vat_chua : doc.ma_xuat_vat_chua;
  const payload = { loai_phieu: direction, loai_thu_chi: direction === 'chi' ? 'Chi vật chứa kèm chứng từ' : 'Thu vật chứa kèm chứng từ',
    gia_tri: amount, cua_hang_id: doc.cua_hang_id, nguoi_tao_id: options.userId,
    document_type: field.slice(0, -3), [field]: doc._id, ma_chung_tu_goc: code,
    doi_tuong: doc.doi_tuong_ten || '', nhom_doi_tuong: ['nha_cung_cap', 'khach_hang'].includes(doc.doi_tuong_type) ? doc.doi_tuong_type : 'khac',
    ...(doc.doi_tuong_type === 'nha_cung_cap' ? { nha_cung_cap_id: doc.doi_tuong_id } : {}),
    ...(doc.doi_tuong_type === 'khach_hang' ? { khach_hang_id: doc.doi_tuong_id } : {}),
    payment_v2: true, chi_tiet_thanh_toan: { ...detail, tien_tra_khach: 0 }, hach_toan: false,
    ghi_chu: (direction === 'chi' ? 'Chi' : 'Thu') + ' vật chứa ' + (code || '') + ' — ' + (doc.source_code || '') };
  payload._paymentInfo = await validateLinkedPayment(detail, doc.cua_hang_id, direction, total, session);
  return taoPhieuThuChi(payload, { session });
}

module.exports = { LINKED_SOURCES, money, parseLinkedMoney, linkedOptions, inTransaction, operationKey,
  loadLinkedMovement, loadLinkedCash, assertLinkedCashCanChange, assertLinkedContainerChange, createLinkedContainerReceipt };
