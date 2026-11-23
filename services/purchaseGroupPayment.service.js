const mongoose = require('mongoose');
const { PhieuNhap, PhieuNhapTongHop } = require('../models/kiot.model');
const { acquirePurchaseGroupMutationLock } = require('./purchaseGroup.service');
const { loadPurchaseSourceBalances } = require('./purchaseGroupQuery.service');
const { buildReceiptPaymentInfo } = require('./paymentCashBook.service');
const { taoPhieuThuChi } = require('./soQuy.service');

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = error.statusCode = status;
  return error;
}
function cleanId(value) {
  const id = String(value && value._id || value || '').trim();
  return mongoose.Types.ObjectId.isValid(id) ? id : '';
}
function normalizePaymentData(data) {
  const body = Object.assign({}, data || {});
  if (typeof body.chi_tiet_thanh_toan === 'string') {
    try { body.chi_tiet_thanh_toan = JSON.parse(body.chi_tiet_thanh_toan); }
    catch (_) { throw fail('Chi tiết thanh toán không hợp lệ.'); }
  }
  return body;
}

// Both individual PN and group C payments use this source-only accounting path.
async function payPurchaseSources({ sourceIds, storeId, userId, data = {}, groupId, branchId } = {}) {
  const store = cleanId(storeId);
  if (!store) throw fail('Chưa chọn cửa hàng làm việc.');
  const groupKey = groupId ? cleanId(groupId) : '';
  if (groupId && !groupKey) throw fail('ID phiếu tổng hợp không hợp lệ.');
  const body = normalizePaymentData(data);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async function() {
      await acquirePurchaseGroupMutationLock(store, session);
      let group = null;
      let ids = sourceIds;
      if (groupKey) {
        group = await PhieuNhapTongHop.findOne({ _id: groupKey, cua_hang_id: store, trang_thai: 'active' }).session(session).lean();
        if (!group) throw fail('Không tìm thấy phiếu tổng hợp còn hiệu lực.', 404);
        ids = group.phieu_nguon_ids;
      }
      if (!Array.isArray(ids) || !ids.length) throw fail('Chưa chọn phiếu nhập cần thanh toán.');
      const normalizedIds = ids.map(cleanId);
      if (normalizedIds.some(id => !id) || new Set(normalizedIds).size !== normalizedIds.length) {
        throw fail('Danh sách phiếu nhập không hợp lệ hoặc bị trùng.');
      }
      const sources = await loadPurchaseSourceBalances(normalizedIds, store, { session });
      if (sources.length !== normalizedIds.length) throw fail('Phiếu nguồn không tồn tại hoặc không thuộc cửa hàng.', 404);
      if (sources.some(source => source.trang_thai === 'cancelled' || source.trang_thai === 'merged'
        || source.trang_thai_du_lieu === 'inactive' || source.deleted_at)) {
        throw fail('Không thanh toán phiếu nguồn đã hủy, bị ẩn hoặc gộp kiểu cũ.');
      }
      if (!group && sources.some(source => source.trang_thai !== 'completed')) {
        throw fail('Phiếu tạm chưa nhập hàng không được thanh toán công nợ.');
      }
      const supplierIds = new Set(sources.map(source => cleanId(source.nha_cung_cap_id)));
      if (supplierIds.size !== 1 || supplierIds.has('')) throw fail('Các phiếu nguồn phải có cùng nhà cung cấp.');
      const completed = sources.filter(source => source.trang_thai === 'completed');
      completed.sort((left, right) => new Date(left.ngay_nhap || left.created_at || 0) - new Date(right.ngay_nhap || right.created_at || 0)
        || String(left._id).localeCompare(String(right._id)));
      const debtOf = source => Math.max(0, Number(source.payment_current ? source.payment_current.debt : source.con_no_ncc) || 0);
      const totalDebt = completed.reduce((sum, source) => sum + debtOf(source), 0);
      if (totalDebt <= 0) throw fail('Không còn công nợ phiếu đã nhập để thanh toán.');
      const paymentPayload = Object.assign({}, body, { loai_phieu: 'chi' });
      if (!body.payment_v2 && !body.so_quy_id && !body.cashBookId) paymentPayload.payment_v2 = true;
      if (body.cashBookId && !body.so_quy_id) paymentPayload.so_quy_id = body.cashBookId;
      const paymentInfo = await buildReceiptPaymentInfo(paymentPayload, { cuaHangId: store, chiNhanhId: branchId, session });
      const amount = Number(paymentInfo.gia_tri);
      if (!Number.isFinite(amount) || amount <= 0) throw fail('Số tiền thanh toán phải lớn hơn 0.');
      if (amount > totalDebt) throw fail('Số tiền thanh toán không được vượt công nợ các phiếu đã nhập.');

      const allocations = [];
      if (body.allocations !== undefined) {
        if (!Array.isArray(body.allocations) || !body.allocations.length) throw fail('Phân bổ thanh toán không hợp lệ.');
        const seen = new Set();
        for (const allocation of body.allocations) {
          const sourceId = cleanId(allocation.phieu_nhap_id);
          const source = completed.find(row => String(row._id) === sourceId);
          const value = Number(allocation.so_tien);
          if (!source || seen.has(sourceId) || !Number.isFinite(value) || value <= 0 || value > debtOf(source)) {
            throw fail('Phân bổ phải thuộc phiếu nguồn đã nhập, không trùng và không vượt công nợ.');
          }
          seen.add(sourceId);
          allocations.push({ phieu_nhap_id: source._id, ma_phieu_nhap: source.ma_phieu_nhap || '', so_tien: value,
            con_no_truoc: debtOf(source), con_no_sau: debtOf(source) - value });
        }
        if (allocations.reduce((sum, row) => sum + row.so_tien, 0) !== amount) throw fail('Tổng phân bổ phải bằng số tiền thanh toán.');
      } else {
        let remaining = amount;
        for (const source of completed) {
          const allocated = Math.min(debtOf(source), remaining);
          if (allocated <= 0) continue;
          allocations.push({ phieu_nhap_id: source._id, ma_phieu_nhap: source.ma_phieu_nhap || '', so_tien: allocated,
            con_no_truoc: debtOf(source), con_no_sau: debtOf(source) - allocated });
          remaining -= allocated;
        }
      }
      const supplier = sources[0].nha_cung_cap_id;
      allocations.forEach(allocation => {
        const source = completed.find(row => String(row._id) === String(allocation.phieu_nhap_id));
        if (source.payment_current && source.payment_current.legacy_paid_fallback) {
          allocation.legacy_paid_baseline = Number(source.payment_current.paid) || 0;
        }
      });
      const receipt = await taoPhieuThuChi({
        loai_phieu: 'chi', loai_thu_chi: 'thanh_toan_nhap_hang', gia_tri: amount,
        nha_cung_cap_id: [...supplierIds][0], nhom_doi_tuong: 'nha_cung_cap', doi_tuong: supplier.ten_ncc || supplier.ma_ncc || '',
        phieu_nhap_id: allocations.length === 1 ? allocations[0].phieu_nhap_id : undefined,
        document_type: allocations.length === 1 ? 'phieu_nhap' : 'khac',
        phieu_nhap_tong_hop_id: group ? group._id : undefined,
        ma_chung_tu_goc: group ? group.ma_phieu_tong_hop : (allocations[0].ma_phieu_nhap || ''),
        chung_tu_khac: group ? group.ma_phieu_tong_hop : '',
        nguoi_tao_id: cleanId(userId) || undefined, cua_hang_id: store, chi_nhanh_id: cleanId(branchId) || undefined,
        ghi_chu: String(body.ghi_chu || '').trim() || 'Thanh toán nhập hàng ' + (group ? group.ma_phieu_tong_hop : allocations[0].ma_phieu_nhap),
        trang_thai: 'paid', hach_toan: true, allocation_type: 'thanh_toan_ncc', allocations, overpayment_amount: 0,
        _paymentInfo: paymentInfo
      }, { session });
      for (const allocation of allocations) {
        const source = completed.find(row => String(row._id) === String(allocation.phieu_nhap_id));
        const paid = Number(source.payment_current ? source.payment_current.paid : source.da_tra_ncc) || 0;
        const payable = Number(source.payment_current ? source.payment_current.payable : source.can_tra_ncc) || 0;
        await PhieuNhap.updateOne({ _id: source._id, cua_hang_id: store }, {
          // Return debt reductions are applied separately by existing supplier reports.
          $set: { da_tra_ncc: paid + allocation.so_tien, con_no_ncc: Math.max(0, payable - paid - allocation.so_tien) }
        }, { session });
      }
      result = { receipt, receipt_id: receipt._id, phieu_nhap_tong_hop_id: group ? group._id : undefined,
        allocations, payment_amount: amount, con_no_ncc: totalDebt - amount,
        da_tra_ncc: completed.reduce((sum, source) => sum + Number(source.payment_current ? source.payment_current.paid : source.da_tra_ncc), 0) + amount };
    });
  } finally {
    await session.endSession();
  }
  return result;
}
async function payPurchaseGroup(options) { return payPurchaseSources(options); }
module.exports = { payPurchaseGroup, payPurchaseSources };
