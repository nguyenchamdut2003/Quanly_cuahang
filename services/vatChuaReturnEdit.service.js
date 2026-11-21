const mongoose = require('mongoose');
const {
  VatChua,
  NhapVatChua,
  XuatVatChua,
  PhieuThuChi
} = require('../models/kiot.model');
const { extractPaymentDetail } = require('./paymentCashBook.service');

function createHttpError(statusCode, message) {
  const error = new Error(message || 'Yêu cầu không hợp lệ');
  error.statusCode = statusCode || 400;
  return error;
}

function cleanId(value) {
  const id = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(id) ? id : '';
}

function parseMoney(value) {
  const raw = String(value ?? '').replace(/\./g, '').replace(/,/g, '').replace(/[^\d]/g, '').trim();
  return raw ? Math.max(0, Math.floor(Number(raw) || 0)) : 0;
}

function parseQty(value) {
  const raw = String(value ?? '').replace(/\./g, '').replace(/,/g, '').replace(/[^\d]/g, '').trim();
  return raw ? Math.max(0, Math.floor(Number(raw) || 0)) : 0;
}

function firstLine(doc) {
  return (Array.isArray(doc && doc.items) ? doc.items : [])[0] || {};
}

function relatedReceiptFilter(doc) {
  const filter = {
    loai_phieu: 'thu',
    deleted_at: null,
    trang_thai: { $ne: 'cancelled' },
    cua_hang_id: doc.cua_hang_id,
    ma_chung_tu_goc: doc.ma_xuat_vat_chua || ''
  };
  return filter;
}

async function loadActiveReceipt(doc, session) {
  return PhieuThuChi.findOne(relatedReceiptFilter(doc))
    .sort({ ngay_lap: -1, created_at: -1 })
    .session(session || null);
}

function pickPaymentDetail(receipt) {
  const detail = receipt && receipt.chi_tiet_thanh_toan ? receipt.chi_tiet_thanh_toan : {};
  return {
    tien_mat: Number(detail.tien_mat || 0),
    so_quy_tien_mat_id: detail.so_quy_tien_mat_id ? String(detail.so_quy_tien_mat_id) : '',
    chuyen_khoan: Number(detail.chuyen_khoan || 0),
    so_quy_chuyen_khoan_id: detail.so_quy_chuyen_khoan_id ? String(detail.so_quy_chuyen_khoan_id) : ''
  };
}

function assertEditableReturn(doc) {
  if (!doc) throw createHttpError(404, 'Không tìm thấy phiếu trả vật chứa.');
  if (doc.deleted_at) throw createHttpError(400, 'Phiếu trả vật chứa đã nằm trong thùng rác.');
  if (doc.trang_thai === 'cancelled') throw createHttpError(400, 'Phiếu trả vật chứa đã hủy, không thể chỉnh sửa.');
  if (doc.loai_xuat !== 'tra_hang_nhap' || doc.source_type !== 'manual') {
    throw createHttpError(400, 'Chỉ chỉnh sửa trực tiếp phiếu trả vật chứa tạo thủ công tại màn Vật chứa.');
  }
}

async function loadXuatVatChuaForEdit(id, storeId) {
  const docId = cleanId(id);
  const store = cleanId(storeId);
  if (!docId || !store) throw createHttpError(400, 'ID phiếu trả vật chứa không hợp lệ.');

  const doc = await XuatVatChua.findOne({
    _id: docId,
    cua_hang_id: store,
    deleted_at: null
  }).lean();
  assertEditableReturn(doc);

  const receipt = await PhieuThuChi.findOne(relatedReceiptFilter(doc))
    .sort({ ngay_lap: -1, created_at: -1 })
    .lean();
  const line = firstLine(doc);
  return {
    _id: String(doc._id),
    ma_xuat_vat_chua: doc.ma_xuat_vat_chua || '',
    source_id: doc.source_id ? String(doc.source_id) : '',
    source_code: doc.source_code || '',
    vat_chua_id: line.vat_chua_id ? String(line.vat_chua_id) : '',
    so_luong: Number(line.so_luong || doc.tong_so_luong || 0),
    gia_tra: Number(line.gia_von || 0),
    ghi_chu: doc.ghi_chu || '',
    tong_tien: Number(doc.tong_tien || 0),
    payment: pickPaymentDetail(receipt)
  };
}

async function getMaxReturnQty(importDoc, vatChuaId, editedReturnId, session) {
  const line = (Array.isArray(importDoc.items) ? importDoc.items : []).find(function(item) {
    return String(item && item.vat_chua_id || '') === String(vatChuaId);
  });
  if (!line) return 0;

  const rows = await XuatVatChua.find({
    cua_hang_id: importDoc.cua_hang_id,
    source_type: 'manual',
    source_id: importDoc._id,
    trang_thai: 'active',
    deleted_at: null,
    _id: { $ne: editedReturnId },
    'items.vat_chua_id': line.vat_chua_id
  }).select('items').session(session || null).lean();
  const returnedQty = rows.reduce(function(sum, row) {
    const items = Array.isArray(row.items) ? row.items : [];
    return sum + items.reduce(function(lineSum, item) {
      return String(item && item.vat_chua_id || '') === String(vatChuaId)
        ? lineSum + Math.max(0, Number(item.so_luong || 0))
        : lineSum;
    }, 0);
  }, 0);
  return Math.max(0, Number(line.so_luong || 0) - returnedQty);
}

async function makeReceiptCode(session) {
  const count = await PhieuThuChi.countDocuments({ loai_phieu: 'thu' }).session(session || null);
  return 'PT' + String(count + 1).padStart(6, '0');
}

function paymentMethod(detail) {
  if (detail.tien_mat > 0 && detail.chuyen_khoan > 0) return 'khac';
  if (detail.chuyen_khoan > 0) return 'chuyen_khoan';
  return 'tien_mat';
}

async function upsertReceipt(doc, detail, paidAmount, userId, session) {
  let receipt = await loadActiveReceipt(doc, session);
  if (paidAmount <= 0) {
    if (receipt) {
      receipt.trang_thai = 'cancelled';
      receipt.ngay_huy = new Date();
      receipt.ly_do_huy = 'Chỉnh sửa phiếu trả vật chứa về chưa thu tiền';
      await receipt.save({ session });
    }
    return null;
  }

  const payload = {
    ngay_lap: receipt ? receipt.ngay_lap : new Date(),
    loai_phieu: 'thu',
    loai_thu_chi: 'Thu tien tra vat chua',
    gia_tri: paidAmount,
    doi_tuong: doc.doi_tuong_ten || '',
    ghi_chu: 'Thu tiền trả vật chứa theo ' + (doc.ma_xuat_vat_chua || ''),
    trang_thai: 'paid',
    hach_toan: false,
    cua_hang_id: doc.cua_hang_id,
    so_quy_id: detail.so_quy_tien_mat_id || detail.so_quy_chuyen_khoan_id || undefined,
    nguoi_tao_id: userId || undefined,
    nha_cung_cap_id: doc.doi_tuong_type === 'nha_cung_cap' ? doc.doi_tuong_id : undefined,
    doi_tuong_entity_id: doc.doi_tuong_type === 'nha_cung_cap' ? doc.doi_tuong_id : undefined,
    nhap_vat_chua_id: doc.source_id || undefined,
    nhom_doi_tuong: doc.doi_tuong_type === 'nha_cung_cap' ? 'nha_cung_cap' : 'khac',
    ma_chung_tu_goc: doc.ma_xuat_vat_chua || '',
    phuong_thuc_thanh_toan: paymentMethod(detail),
    chi_tiet_thanh_toan: {
      tien_mat: detail.tien_mat,
      so_quy_tien_mat_id: detail.so_quy_tien_mat_id || null,
      chuyen_khoan: detail.chuyen_khoan,
      so_quy_chuyen_khoan_id: detail.so_quy_chuyen_khoan_id || null,
      tien_tra_khach: 0
    }
  };

  if (!receipt) {
    const rows = await PhieuThuChi.create([Object.assign({ ma_phieu: await makeReceiptCode(session) }, payload)], { session });
    receipt = rows[0];
  } else {
    Object.assign(receipt, payload);
    await receipt.save({ session });
  }
  return receipt;
}

async function updateXuatVatChuaReturn(id, data = {}, storeId, userId) {
  const docId = cleanId(id);
  const store = cleanId(storeId);
  if (!docId || !store) throw createHttpError(400, 'ID phiếu trả vật chứa không hợp lệ.');

  const qty = parseQty(data.so_luong);
  const giaTra = parseMoney(data.gia_tra || data.gia_von);
  const detail = extractPaymentDetail(Object.assign({}, data, { payment_v2: true }));
  if (qty <= 0) throw createHttpError(400, 'Số lượng trả phải lớn hơn 0.');
  if (giaTra <= 0) throw createHttpError(400, 'Giá trả phải lớn hơn 0.');
  if (detail.tien_tra_khach > 0) throw createHttpError(400, 'Tiền trả khách không áp dụng khi trả vật chứa.');

  const paidAmount = detail.tien_mat + detail.chuyen_khoan;
  const total = Math.round(qty * giaTra);
  if (paidAmount > total) throw createHttpError(400, 'Số tiền thu không được vượt tổng giá trị trả.');
  if (detail.tien_mat > 0 && !detail.so_quy_tien_mat_id) throw createHttpError(400, 'Vui lòng chọn sổ tiền mặt.');
  if (detail.chuyen_khoan > 0 && !detail.so_quy_chuyen_khoan_id) throw createHttpError(400, 'Vui lòng chọn tài khoản chuyển khoản.');

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async function() {
      const doc = await XuatVatChua.findOne({ _id: docId, cua_hang_id: store, deleted_at: null }).session(session);
      assertEditableReturn(doc);

      const oldLine = firstLine(doc);
      const vatChuaId = cleanId(oldLine.vat_chua_id);
      if (!vatChuaId) throw createHttpError(400, 'Phiếu trả vật chứa không có dòng vật chứa hợp lệ.');
      const importId = cleanId(doc.source_id);
      const importDoc = importId
        ? await NhapVatChua.findOne({ _id: importId, cua_hang_id: store, deleted_at: null }).session(session)
        : null;
      if (!importDoc) throw createHttpError(400, 'Không tìm thấy phiếu nhập vật chứa gốc.');
      const vatChua = await VatChua.findOne({ _id: vatChuaId, cua_hang_id: store, trang_thai: 'active' }).session(session);
      if (!vatChua) throw createHttpError(400, 'Vật chứa không hợp lệ hoặc đã ngừng sử dụng.');

      const maxReturnQty = await getMaxReturnQty(importDoc, vatChuaId, doc._id, session);
      if (qty > maxReturnQty) {
        throw createHttpError(400, 'Số lượng trả vượt số lượng còn có thể trả (' + maxReturnQty + ').');
      }

      const oldQty = Number(oldLine.so_luong || doc.tong_so_luong || 0);
      const deltaQty = qty - oldQty;
      if (deltaQty !== 0) {
        const stockFilter = { _id: vatChuaId, cua_hang_id: store };
        if (deltaQty > 0) stockFilter.so_luong_ton = { $gte: deltaQty };
        const stockUpdate = await VatChua.updateOne(stockFilter, { $inc: { so_luong_ton: -deltaQty } }, { session });
        if (!stockUpdate || Number(stockUpdate.modifiedCount || 0) < 1) {
          throw createHttpError(400, 'Tồn vật chứa không đủ để tăng số lượng trả.');
        }
      }

      doc.items = [{
        vat_chua_id: vatChua._id,
        ma_vat_chua: vatChua.ma_vat_chua || '',
        ten_vat_chua: vatChua.ten_vat_chua || '',
        so_luong: qty,
        gia_von: giaTra,
        thanh_tien: total
      }];
      doc.tong_so_luong = qty;
      doc.tong_tien = total;
      doc.ghi_chu = String(data.ghi_chu || doc.ghi_chu || '').trim();
      await doc.save({ session });

      const receipt = await upsertReceipt(doc, detail, paidAmount, userId, session);
      result = {
        _id: String(doc._id),
        ma_xuat_vat_chua: doc.ma_xuat_vat_chua || '',
        tong_so_luong: qty,
        tong_tien: total,
        paid_amount: paidAmount,
        phieu_thu_id: receipt ? String(receipt._id) : ''
      };
    });
  } finally {
    await session.endSession();
  }

  return result;
}

module.exports = {
  loadXuatVatChuaForEdit,
  updateXuatVatChuaReturn
};
