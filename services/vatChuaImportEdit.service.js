const mongoose = require('mongoose');
const {
  VatChua,
  NhapVatChua,
  NhaCungCap,
  PhieuThuChi,
  CongNoNhaCungCap
} = require('../models/kiot.model');
const { extractPaymentDetail } = require('./paymentCashBook.service');

function createHttpError(statusCode, message) {
  const error = new Error(message || 'Yeu cau khong hop le');
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

function getSupplierId(doc) {
  return cleanId(doc && doc.doi_tuong_type === 'nha_cung_cap' ? doc.doi_tuong_id : '');
}

function relatedReceiptFilter(doc) {
  const filter = {
    loai_phieu: 'chi',
    deleted_at: null,
    cua_hang_id: doc.cua_hang_id,
    $or: [{ nhap_vat_chua_id: doc._id }]
  };
  if (doc.ma_nhap_vat_chua) filter.$or.push({ ma_chung_tu_goc: doc.ma_nhap_vat_chua });
  return filter;
}

async function loadActiveReceipt(doc, session) {
  return PhieuThuChi.findOne(Object.assign({ trang_thai: { $ne: 'cancelled' } }, relatedReceiptFilter(doc)))
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

async function loadNhapVatChuaForEdit(id, storeId) {
  const docId = cleanId(id);
  const store = cleanId(storeId);
  if (!docId || !store) throw createHttpError(400, 'ID phiếu nhập vật chứa không hợp lệ.');

  const doc = await NhapVatChua.findOne({
    _id: docId,
    cua_hang_id: store,
    deleted_at: null
  }).lean();
  if (!doc) throw createHttpError(404, 'Không tìm thấy phiếu nhập vật chứa.');
  if (doc.trang_thai === 'cancelled') throw createHttpError(400, 'Phiếu nhập vật chứa đã hủy, không thể chỉnh sửa.');
  if (doc.source_type !== 'manual') throw createHttpError(400, 'Chỉ chỉnh sửa trực tiếp phiếu nhập vật chứa tạo thủ công tại màn Vật chứa.');

  const receipt = await PhieuThuChi.findOne(Object.assign({ trang_thai: { $ne: 'cancelled' } }, relatedReceiptFilter(doc)))
    .sort({ ngay_lap: -1, created_at: -1 })
    .lean();
  const line = firstLine(doc);
  return {
    _id: String(doc._id),
    ma_nhap_vat_chua: doc.ma_nhap_vat_chua || '',
    nha_cung_cap_id: getSupplierId(doc),
    doi_tuong_ten: doc.doi_tuong_ten || '',
    vat_chua_id: line.vat_chua_id ? String(line.vat_chua_id) : '',
    so_luong: Number(line.so_luong || doc.tong_so_luong || 0),
    gia_von: Number(line.gia_von || 0),
    ghi_chu: doc.ghi_chu || '',
    tong_tien: Number(doc.tong_tien || 0),
    payment: pickPaymentDetail(receipt)
  };
}

async function ensureDebtRow(doc, supplierId, amount, note, session) {
  let row = await CongNoNhaCungCap.findOne({
    nhap_vat_chua_id: doc._id,
    loai: 'tang_no',
    $or: [
      { phieu_thu_chi_id: { $exists: false } },
      { phieu_thu_chi_id: null }
    ]
  }).session(session);
  if (!row) {
    const rows = await CongNoNhaCungCap.create([{
      cua_hang_id: doc.cua_hang_id,
      nha_cung_cap_id: supplierId,
      nhap_vat_chua_id: doc._id,
      so_tien: amount,
      loai: 'tang_no',
      ghi_chu: note,
      ngay: new Date()
    }], { session });
    row = rows[0];
  } else {
    row.nha_cung_cap_id = supplierId;
    row.so_tien = amount;
    row.ghi_chu = note;
    await row.save({ session });
  }
  return row;
}

async function makeReceiptCode(session) {
  const count = await PhieuThuChi.countDocuments({ loai_phieu: 'chi' }).session(session || null);
  return 'PC' + String(count + 1).padStart(6, '0');
}

function paymentMethod(detail) {
  if (detail.tien_mat > 0 && detail.chuyen_khoan > 0) return 'khac';
  if (detail.chuyen_khoan > 0) return 'chuyen_khoan';
  return 'tien_mat';
}

async function upsertReceipt(doc, supplier, detail, paidAmount, userId, session) {
  let receipt = await loadActiveReceipt(doc, session);
  if (paidAmount <= 0) {
    if (receipt) {
      receipt.trang_thai = 'cancelled';
      receipt.ngay_huy = new Date();
      receipt.ly_do_huy = 'Chỉnh sửa phiếu nhập vật chứa về chưa thanh toán';
      await receipt.save({ session });
      await CongNoNhaCungCap.deleteMany({ phieu_thu_chi_id: receipt._id }).session(session);
    }
    return null;
  }

  const payload = {
    ngay_lap: receipt ? receipt.ngay_lap : new Date(),
    loai_phieu: 'chi',
    loai_thu_chi: 'Chi Nhập vật chứa',
    gia_tri: paidAmount,
    doi_tuong: supplier.ten_ncc || '',
    ghi_chu: 'Thanh toán nhập vật chứa ' + (doc.ma_nhap_vat_chua || ''),
    trang_thai: 'paid',
    hach_toan: true,
    cua_hang_id: doc.cua_hang_id,
    so_quy_id: detail.so_quy_tien_mat_id || detail.so_quy_chuyen_khoan_id || undefined,
    nguoi_tao_id: userId || undefined,
    nha_cung_cap_id: supplier._id,
    nhap_vat_chua_id: doc._id,
    ma_chung_tu_goc: doc.ma_nhap_vat_chua || '',
    nhom_doi_tuong: 'nha_cung_cap',
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
    await CongNoNhaCungCap.deleteMany({ phieu_thu_chi_id: receipt._id }).session(session);
  }

  await CongNoNhaCungCap.create([{
    cua_hang_id: doc.cua_hang_id,
    nha_cung_cap_id: supplier._id,
    nhap_vat_chua_id: doc._id,
    phieu_thu_chi_id: receipt._id,
    so_tien: paidAmount,
    loai: 'thanh_toan',
    ghi_chu: 'Thanh toán NCC ' + (receipt.ma_phieu || ''),
    ngay: receipt.ngay_lap
  }], { session });
  return receipt;
}

async function updateNhapVatChuaImport(id, data = {}, storeId, userId) {
  const docId = cleanId(id);
  const store = cleanId(storeId);
  if (!docId || !store) throw createHttpError(400, 'ID phiếu nhập vật chứa không hợp lệ.');

  const supplierId = cleanId(data.nha_cung_cap_id);
  const vatChuaId = cleanId(data.vat_chua_id);
  const qty = parseQty(data.so_luong);
  const giaVon = parseMoney(data.gia_von);
  if (!supplierId) throw createHttpError(400, 'Vui lòng chọn nhà cung cấp.');
  if (!vatChuaId) throw createHttpError(400, 'Vui lòng chọn vật chứa.');
  if (qty <= 0) throw createHttpError(400, 'Số lượng phải lớn hơn 0.');
  if (giaVon <= 0) throw createHttpError(400, 'Giá vốn phải lớn hơn 0.');

  const detail = extractPaymentDetail(Object.assign({}, data, { payment_v2: true }));
  if (detail.tien_tra_khach > 0) throw createHttpError(400, 'Tiền trả khách không áp dụng cho nhập vật chứa.');
  const paidAmount = detail.tien_mat + detail.chuyen_khoan;
  const total = Math.round(qty * giaVon);
  if (paidAmount > total) throw createHttpError(400, 'Số tiền thanh toán không được vượt tổng tiền.');
  if (detail.tien_mat > 0 && !detail.so_quy_tien_mat_id) throw createHttpError(400, 'Vui lòng chọn sổ tiền mặt.');
  if (detail.chuyen_khoan > 0 && !detail.so_quy_chuyen_khoan_id) throw createHttpError(400, 'Vui lòng chọn tài khoản chuyển khoản.');

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async function() {
      const doc = await NhapVatChua.findOne({
        _id: docId,
        cua_hang_id: store,
        deleted_at: null
      }).session(session);
      if (!doc) throw createHttpError(404, 'Không tìm thấy phiếu nhập vật chứa.');
      if (doc.trang_thai === 'cancelled') throw createHttpError(400, 'Phiếu nhập vật chứa đã hủy, không thể chỉnh sửa.');
      if (doc.source_type !== 'manual') throw createHttpError(400, 'Chỉ chỉnh sửa trực tiếp phiếu nhập vật chứa tạo thủ công tại màn Vật chứa.');

      const [supplier, vatChua, oldReceipt] = await Promise.all([
        NhaCungCap.findOne({
          _id: supplierId,
          trang_thai: 'active',
          $or: [
            { cua_hang_id: store },
            { cua_hang_id: { $exists: false } },
            { cua_hang_id: null }
          ]
        }).session(session),
        VatChua.findOne({ _id: vatChuaId, cua_hang_id: store, trang_thai: 'active' }).session(session),
        loadActiveReceipt(doc, session)
      ]);
      if (!supplier) throw createHttpError(400, 'Nhà cung cấp không hợp lệ.');
      if (!vatChua) throw createHttpError(400, 'Vật chứa không hợp lệ hoặc đã ngừng sử dụng.');

      const oldLine = firstLine(doc);
      const oldVatChuaId = cleanId(oldLine.vat_chua_id);
      const oldQty = Number(oldLine.so_luong || doc.tong_so_luong || 0);
      const oldTotal = Number(doc.tong_tien || 0);
      const oldPaid = oldReceipt ? Number(oldReceipt.gia_tri || 0) : 0;
      const oldSupplierId = getSupplierId(doc);

      if (oldVatChuaId && oldVatChuaId !== vatChuaId) {
        const oldUpdate = await VatChua.updateOne(
          { _id: oldVatChuaId, cua_hang_id: store, so_luong_ton: { $gte: oldQty } },
          { $inc: { so_luong_ton: -oldQty } },
          { session }
        );
        if (!oldUpdate || Number(oldUpdate.modifiedCount || 0) < 1) {
          throw createHttpError(400, 'Tồn vật chứa cũ không đủ để trừ lại khi chỉnh sửa.');
        }
        await VatChua.updateOne({ _id: vatChuaId, cua_hang_id: store }, { $inc: { so_luong_ton: qty } }, { session });
      } else {
        const deltaQty = qty - oldQty;
        if (deltaQty !== 0) {
          const stockFilter = { _id: vatChuaId, cua_hang_id: store };
          if (deltaQty < 0) stockFilter.so_luong_ton = { $gte: Math.abs(deltaQty) };
          const stockUpdate = await VatChua.updateOne(stockFilter, { $inc: { so_luong_ton: deltaQty } }, { session });
          if (!stockUpdate || Number(stockUpdate.modifiedCount || 0) < 1) {
            throw createHttpError(400, 'Tồn vật chứa không đủ để giảm số lượng nhập.');
          }
        }
      }

      if (oldSupplierId && oldSupplierId === supplierId) {
        await NhaCungCap.updateOne(
          { _id: supplierId },
          { $inc: { tong_mua: total - oldTotal, tong_no: (total - paidAmount) - (oldTotal - oldPaid) } },
          { session }
        );
      } else {
        if (oldSupplierId) {
          await NhaCungCap.updateOne(
            { _id: oldSupplierId },
            { $inc: { tong_mua: -oldTotal, tong_no: -(oldTotal - oldPaid) } },
            { session }
          );
        }
        await NhaCungCap.updateOne(
          { _id: supplierId },
          { $inc: { tong_mua: total, tong_no: total - paidAmount } },
          { session }
        );
      }

      doc.doi_tuong_type = 'nha_cung_cap';
      doc.doi_tuong_id = supplier._id;
      doc.doi_tuong_ten = supplier.ten_ncc || '';
      doc.items = [{
        vat_chua_id: vatChua._id,
        ma_vat_chua: vatChua.ma_vat_chua || '',
        ten_vat_chua: vatChua.ten_vat_chua || '',
        so_luong: qty,
        gia_von: giaVon,
        thanh_tien: total
      }];
      doc.tong_so_luong = qty;
      doc.tong_tien = total;
      doc.ghi_chu = String(data.ghi_chu || '').trim();
      await doc.save({ session });

      await ensureDebtRow(
        doc,
        supplier._id,
        total,
        'Công nợ phát sinh từ nhập vật chứa ' + (doc.ma_nhap_vat_chua || ''),
        session
      );
      const receipt = await upsertReceipt(doc, supplier, detail, paidAmount, userId, session);

      result = {
        _id: String(doc._id),
        ma_nhap_vat_chua: doc.ma_nhap_vat_chua || '',
        tong_so_luong: qty,
        tong_tien: total,
        paid_amount: paidAmount,
        phieu_chi_id: receipt ? String(receipt._id) : ''
      };
    });
  } finally {
    await session.endSession();
  }

  return result;
}

module.exports = {
  loadNhapVatChuaForEdit,
  updateNhapVatChuaImport
};
