const mongoose = require('mongoose');
const {
  VatChua,
  NhapVatChua,
  XuatVatChua,
  PhieuThuChi
} = require('../models/kiot.model');
const { ThungRacItem } = require('../models/trash.model');
const { extractPaymentDetail } = require('./paymentCashBook.service');
const { ENTITY_LABELS, buildTrashChildFields } = require('./trashLabels.service');

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
  if (!doc) throw createHttpError(404, 'Khong tim thay phieu tra vat chua.');
  if (doc.deleted_at) throw createHttpError(400, 'Phieu tra vat chua da nam trong thung rac.');
  if (doc.trang_thai === 'cancelled') throw createHttpError(400, 'Phieu tra vat chua da huy, khong the chinh sua.');
  if (doc.loai_xuat !== 'tra_hang_nhap' || doc.source_type !== 'manual') {
    throw createHttpError(400, 'Chi chinh sua truc tiep phieu tra vat chua tao thu cong tai man Vat chua.');
  }
}

async function loadXuatVatChuaForEdit(id, storeId) {
  const docId = cleanId(id);
  const store = cleanId(storeId);
  if (!docId || !store) throw createHttpError(400, 'ID phieu tra vat chua khong hop le.');

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
      receipt.ly_do_huy = 'Chinh sua phieu tra vat chua ve chua thu tien';
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
    ghi_chu: 'Thu tien tra vat chua theo ' + (doc.ma_xuat_vat_chua || ''),
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
  if (!docId || !store) throw createHttpError(400, 'ID phieu tra vat chua khong hop le.');

  const qty = parseQty(data.so_luong);
  const giaTra = parseMoney(data.gia_tra || data.gia_von);
  const detail = extractPaymentDetail(Object.assign({}, data, { payment_v2: true }));
  if (qty <= 0) throw createHttpError(400, 'So luong tra phai lon hon 0.');
  if (giaTra <= 0) throw createHttpError(400, 'Gia tra phai lon hon 0.');
  if (detail.tien_tra_khach > 0) throw createHttpError(400, 'Tien tra khach khong ap dung khi tra vat chua.');

  const paidAmount = detail.tien_mat + detail.chuyen_khoan;
  const total = Math.round(qty * giaTra);
  if (paidAmount > total) throw createHttpError(400, 'So tien thu khong duoc vuot tong gia tri tra.');
  if (detail.tien_mat > 0 && !detail.so_quy_tien_mat_id) throw createHttpError(400, 'Vui long chon so tien mat.');
  if (detail.chuyen_khoan > 0 && !detail.so_quy_chuyen_khoan_id) throw createHttpError(400, 'Vui long chon tai khoan chuyen khoan.');

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async function() {
      const doc = await XuatVatChua.findOne({ _id: docId, cua_hang_id: store, deleted_at: null }).session(session);
      assertEditableReturn(doc);

      const oldLine = firstLine(doc);
      const vatChuaId = cleanId(oldLine.vat_chua_id);
      if (!vatChuaId) throw createHttpError(400, 'Phieu tra vat chua khong co dong vat chua hop le.');
      const importId = cleanId(doc.source_id);
      const importDoc = importId
        ? await NhapVatChua.findOne({ _id: importId, cua_hang_id: store, deleted_at: null }).session(session)
        : null;
      if (!importDoc) throw createHttpError(400, 'Khong tim thay phieu nhap vat chua goc.');
      const vatChua = await VatChua.findOne({ _id: vatChuaId, cua_hang_id: store, trang_thai: 'active' }).session(session);
      if (!vatChua) throw createHttpError(400, 'Vat chua khong hop le hoac da ngung su dung.');

      const maxReturnQty = await getMaxReturnQty(importDoc, vatChuaId, doc._id, session);
      if (qty > maxReturnQty) {
        throw createHttpError(400, 'So luong tra vuot so luong con co the tra (' + maxReturnQty + ').');
      }

      const oldQty = Number(oldLine.so_luong || doc.tong_so_luong || 0);
      const deltaQty = qty - oldQty;
      if (deltaQty !== 0) {
        const stockFilter = { _id: vatChuaId, cua_hang_id: store };
        if (deltaQty > 0) stockFilter.so_luong_ton = { $gte: deltaQty };
        const stockUpdate = await VatChua.updateOne(stockFilter, { $inc: { so_luong_ton: -deltaQty } }, { session });
        if (!stockUpdate || Number(stockUpdate.modifiedCount || 0) < 1) {
          throw createHttpError(400, 'Ton vat chua khong du de tang so luong tra.');
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

async function deleteXuatVatChuaReturn(id, storeId, userId) {
  const docId = cleanId(id);
  const store = cleanId(storeId);
  if (!docId || !store) throw createHttpError(400, 'ID phieu tra vat chua khong hop le.');

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async function() {
      const doc = await XuatVatChua.findOne({ _id: docId, cua_hang_id: store, deleted_at: null }).session(session);
      assertEditableReturn(doc);
      const now = new Date();

      const items = Array.isArray(doc.items) ? doc.items : [];
      for (const line of items) {
        const vatChuaId = cleanId(line && line.vat_chua_id);
        const qty = Math.max(0, Math.floor(Number(line && line.so_luong || 0)));
        if (!vatChuaId || qty <= 0) continue;
        await VatChua.updateOne(
          { _id: vatChuaId, cua_hang_id: store },
          { $inc: { so_luong_ton: qty } },
          { session }
        );
      }

      const receipts = await PhieuThuChi.find(relatedReceiptFilter(doc)).session(session);
      for (const receipt of receipts) {
        receipt.trang_thai = 'cancelled';
        receipt.deleted_at = now;
        receipt.deleted_by = userId || null;
        receipt.ngay_huy = new Date();
        receipt.ly_do_huy = 'Xoa phieu tra vat chua ' + (doc.ma_xuat_vat_chua || '');
        await receipt.save({ session });
      }

      const root = await ThungRacItem.create([{
        entity_type: 'XuatVatChua',
        entity_id: doc._id,
        ma_chung_tu: doc.ma_xuat_vat_chua || '',
        ten_hien_thi: doc.ma_xuat_vat_chua || 'Phieu tra vat chua',
        mo_ta_phu: doc.doi_tuong_ten ? ('Doi tuong: ' + doc.doi_tuong_ten) : '',
        cua_hang_id: doc.cua_hang_id || store || null,
        deleted_at: now,
        deleted_by: userId || null,
        is_trash_root: true,
        trash_group_id: null,
        sort_order: 0
      }], { session });
      const rootDoc = root && root[0];

      if (receipts.length && rootDoc) {
        const childFields = buildTrashChildFields({
          entity_type: 'PhieuThuChi',
          label: ENTITY_LABELS.PhieuThuChi,
          count: receipts.length,
          samples: receipts.map(function(row) { return row.ma_phieu || ''; }).filter(Boolean).slice(0, 5)
        });
        await ThungRacItem.create([{
          entity_type: 'PhieuThuChi',
          entity_id: doc._id,
          ma_chung_tu: childFields.ma_chung_tu,
          ten_hien_thi: childFields.ten_hien_thi,
          mo_ta_phu: childFields.mo_ta_phu,
          cua_hang_id: doc.cua_hang_id || store || null,
          deleted_at: now,
          deleted_by: userId || null,
          is_trash_root: false,
          trash_group_id: rootDoc._id,
          sort_order: 1
        }], { session });
      }

      doc.trang_thai = 'cancelled';
      doc.deleted_at = now;
      doc.deleted_by = userId || null;
      doc.ghi_chu = [String(doc.ghi_chu || '').trim(), 'Da xoa phieu tra vat chua'].filter(Boolean).join(' | ');
      await doc.save({ session });

      result = {
        _id: String(doc._id),
        ma_xuat_vat_chua: doc.ma_xuat_vat_chua || '',
        restored_qty: items.reduce(function(sum, line) {
          return sum + Math.max(0, Math.floor(Number(line && line.so_luong || 0)));
        }, 0),
        cancelled_receipts: receipts.length,
        trash_root_id: rootDoc ? String(rootDoc._id) : ''
      };
    });
  } finally {
    await session.endSession();
  }

  return result;
}

module.exports = {
  loadXuatVatChuaForEdit,
  updateXuatVatChuaReturn,
  deleteXuatVatChuaReturn
};
