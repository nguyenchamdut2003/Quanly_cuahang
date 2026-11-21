const mongoose = require('mongoose');
const { NhapVatChua, NhaCungCap } = require('../models/kiot.model');
const { buildReceiptPaymentInfo } = require('./paymentCashBook.service');
const { taoPhieuThuChi } = require('./soQuy.service');
const { loadNhapVatChuaPaymentTotals, loadNhapVatChuaReturnTotals } = require('./vatChuaPaymentTotals.service');

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function cleanId(value) {
  const id = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(id) ? id : '';
}

async function payNhapVatChuaImport(id, data = {}, storeId, userId) {
  const docId = cleanId(id);
  const store = cleanId(storeId);
  if (!docId || !store) throw createHttpError(400, 'ID phiếu nhập vật chứa không hợp lệ.');

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async function() {
      const doc = await NhapVatChua.findOne({
        _id: docId,
        cua_hang_id: store,
        deleted_at: null,
        trang_thai_du_lieu: { $ne: 'inactive' }
      }).setOptions({ strictQuery: false }).session(session);
      if (!doc) throw createHttpError(404, 'Không tìm thấy phiếu nhập vật chứa.');
      if (doc.trang_thai !== 'active') throw createHttpError(400, 'Phiếu nhập vật chứa đã hủy, không thể thanh toán.');
      if (doc.source_type !== 'manual' || doc.doi_tuong_type !== 'nha_cung_cap') {
        throw createHttpError(400, 'Chỉ thanh toán trực tiếp phiếu nhập vật chứa thủ công từ nhà cung cấp.');
      }
      const supplierId = cleanId(doc.doi_tuong_id);
      const supplier = supplierId && await NhaCungCap.findOne({
        _id: supplierId,
        trang_thai: 'active',
        $or: [{ cua_hang_id: store }, { cua_hang_id: { $exists: false } }, { cua_hang_id: null }]
      }).session(session);
      if (!supplier) throw createHttpError(400, 'Nhà cung cấp không hợp lệ hoặc đã ngừng hoạt động.');

      // Force concurrent payments/edits of this import to retry with a fresh balance.
      await NhapVatChua.updateOne(
        { _id: doc._id, cua_hang_id: store },
        { $currentDate: { updated_at: true } },
        { session }
      );
      const paidMap = await loadNhapVatChuaPaymentTotals([doc], { session, storeId: store });
      const oldPaid = Number(paidMap.get(String(doc._id)) || 0);
      const returnMap = await loadNhapVatChuaReturnTotals([doc], { session, storeId: store });
      const returnedAmount = Number(returnMap.get(String(doc._id)) || 0);
      const total = Math.max(0, Number(doc.tong_tien || 0));
      const remaining = Math.max(0, total - oldPaid - returnedAmount);
      if (remaining <= 0) throw createHttpError(400, 'Phiếu nhập vật chứa đã được thanh toán đủ.');

      const payload = {
        payment_v2: true,
        chi_tiet_thanh_toan: data.chi_tiet_thanh_toan,
        tien_mat: data.tien_mat,
        so_quy_tien_mat_id: data.so_quy_tien_mat_id,
        chuyen_khoan: data.chuyen_khoan,
        so_quy_chuyen_khoan_id: data.so_quy_chuyen_khoan_id,
        tien_tra_khach: data.tien_tra_khach,
        loai_phieu: 'chi',
        loai_thu_chi: 'Chi Nhập vật chứa',
        cua_hang_id: doc.cua_hang_id,
        nguoi_tao_id: cleanId(userId) || undefined,
        nha_cung_cap_id: supplier._id,
        nhom_doi_tuong: 'nha_cung_cap',
        doi_tuong: supplier.ten_ncc || doc.doi_tuong_ten || '',
        document_type: 'nhap_vat_chua',
        nhap_vat_chua_id: doc._id,
        ma_chung_tu_goc: doc.ma_nhap_vat_chua || '',
        ghi_chu: String(data.ghi_chu || '').trim() || 'Thanh toán nhập vật chứa ' + (doc.ma_nhap_vat_chua || ''),
        hach_toan: true
      };
      payload._paymentInfo = await buildReceiptPaymentInfo(payload, { cuaHangId: store, session });
      const amount = payload._paymentInfo.gia_tri;
      if (amount > remaining) throw createHttpError(400, 'Số tiền thanh toán không được vượt số tiền còn phải trả.');
      payload.gia_tri = amount;
      const receipt = await taoPhieuThuChi(payload, { session });
      result = {
        _id: String(doc._id),
        ma_nhap_vat_chua: doc.ma_nhap_vat_chua || '',
        phieu_chi_id: String(receipt._id),
        ma_phieu_chi: receipt.ma_phieu || '',
        payment_amount: amount,
        tong_tien: total,
        returned_amount: returnedAmount,
        paid_amount: oldPaid + amount,
        remaining_amount: Math.max(0, remaining - amount)
      };
    });
  } finally {
    await session.endSession();
  }
  return result;
}

module.exports = { payNhapVatChuaImport };
