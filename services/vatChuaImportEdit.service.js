const mongoose = require('mongoose');
const {
  VatChua,
  NhapVatChua,
  XuatVatChua,
  NhaCungCap,
  CongNoNhaCungCap
} = require('../models/kiot.model');
const { loadNhapVatChuaPaymentTotals, loadNhapVatChuaReturnTotals } = require('./vatChuaPaymentTotals.service');

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

function getSupplierId(doc) {
  return cleanId(doc && doc.doi_tuong_type === 'nha_cung_cap' ? doc.doi_tuong_id : '');
}

async function loadNhapVatChuaForEdit(id, storeId) {
  const docId = cleanId(id);
  const store = cleanId(storeId);
  if (!docId || !store) throw createHttpError(400, 'ID phiếu nhập vật chứa không hợp lệ.');

  const doc = await NhapVatChua.findOne({
    _id: docId,
    cua_hang_id: store,
    deleted_at: null,
    trang_thai_du_lieu: { $ne: 'inactive' }
  }).setOptions({ strictQuery: false }).lean();
  if (!doc) throw createHttpError(404, 'Không tìm thấy phiếu nhập vật chứa.');
  if (doc.trang_thai === 'cancelled') throw createHttpError(400, 'Phiếu nhập vật chứa đã hủy, không thể chỉnh sửa.');
  if (doc.source_type !== 'manual') throw createHttpError(400, 'Chỉ chỉnh sửa trực tiếp phiếu nhập vật chứa tạo thủ công tại màn Vật chứa.');

  const paidMap = await loadNhapVatChuaPaymentTotals([doc], { storeId: store });
  const paidAmount = Number(paidMap.get(String(doc._id)) || 0);
  const returnMap = await loadNhapVatChuaReturnTotals([doc], { storeId: store });
  const returnedAmount = Number(returnMap.get(String(doc._id)) || 0);
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
    paid_amount: paidAmount,
    returned_amount: returnedAmount,
    remaining_amount: Math.max(0, Number(doc.tong_tien || 0) - paidAmount - returnedAmount),
    can_change_supplier: paidAmount === 0 && returnedAmount === 0
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

  const total = Math.round(qty * giaVon);
  if (!Number.isSafeInteger(total)) throw createHttpError(400, 'Tổng tiền phiếu nhập vật chứa không hợp lệ.');

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async function() {
      const doc = await NhapVatChua.findOne({
        _id: docId,
        cua_hang_id: store,
        deleted_at: null,
        trang_thai_du_lieu: { $ne: 'inactive' }
      }).setOptions({ strictQuery: false }).session(session);
      if (!doc) throw createHttpError(404, 'Không tìm thấy phiếu nhập vật chứa.');
      if (doc.trang_thai === 'cancelled') throw createHttpError(400, 'Phiếu nhập vật chứa đã hủy, không thể chỉnh sửa.');
      if (doc.source_type !== 'manual') throw createHttpError(400, 'Chỉ chỉnh sửa trực tiếp phiếu nhập vật chứa tạo thủ công tại màn Vật chứa.');

      const supplier = await NhaCungCap.findOne({
        _id: supplierId,
        trang_thai: 'active',
        $or: [
          { cua_hang_id: store },
          { cua_hang_id: { $exists: false } },
          { cua_hang_id: null }
        ]
      }).session(session);
      const vatChua = await VatChua.findOne({ _id: vatChuaId, cua_hang_id: store, trang_thai: 'active' }).session(session);
      const paidMap = await loadNhapVatChuaPaymentTotals([doc], { session, storeId: store });
      const paidAmount = Number(paidMap.get(String(doc._id)) || 0);
      const returnMap = await loadNhapVatChuaReturnTotals([doc], { session, storeId: store });
      const returnedAmount = Number(returnMap.get(String(doc._id)) || 0);
      if (!supplier) throw createHttpError(400, 'Nhà cung cấp không hợp lệ.');
      if (!vatChua) throw createHttpError(400, 'Vật chứa không hợp lệ hoặc đã ngừng sử dụng.');

      const oldLine = firstLine(doc);
      const oldVatChuaId = cleanId(oldLine.vat_chua_id);
      const oldQty = Number(oldLine.so_luong || doc.tong_so_luong || 0);
      const oldTotal = Number(doc.tong_tien || 0);
      const oldSupplierId = getSupplierId(doc);
      if (total < oldTotal && total < paidAmount + returnedAmount) {
        throw createHttpError(400, 'Tổng tiền không được nhỏ hơn số tiền đã thanh toán cộng giá trị đã trả hàng.');
      }
      if (paidAmount > 0 && oldSupplierId !== supplierId) {
        throw createHttpError(400, 'Phiếu đã có thanh toán, không thể đổi nhà cung cấp.');
      }
      if (returnedAmount > 0) {
        if (oldSupplierId !== supplierId || oldVatChuaId !== vatChuaId) {
          throw createHttpError(400, 'Phiếu đã phát sinh trả hàng, không thể đổi nhà cung cấp hoặc vật chứa.');
        }
        const returnedRows = await XuatVatChua.find({
          cua_hang_id: store,
          source_type: 'manual',
          source_id: doc._id,
          loai_xuat: 'tra_hang_nhap',
          trang_thai: 'active',
          trang_thai_du_lieu: { $ne: 'inactive' },
          deleted_at: null
        }).setOptions({ strictQuery: false }).select('items').session(session).lean();
        const returnedQty = returnedRows.reduce(function(sum, row) {
          return sum + (Array.isArray(row.items) ? row.items : []).reduce(function(lineSum, item) {
            return lineSum + (String(item.vat_chua_id || '') === vatChuaId ? Number(item.so_luong || 0) : 0);
          }, 0);
        }, 0);
        if (qty < returnedQty) throw createHttpError(400, 'Số lượng nhập không được nhỏ hơn số lượng đã trả hàng.');
      }

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
          { $inc: { tong_mua: total - oldTotal, tong_no: total - oldTotal } },
          { session }
        );
      } else {
        if (oldSupplierId) {
          await NhaCungCap.updateOne(
            { _id: oldSupplierId },
            { $inc: { tong_mua: -oldTotal, tong_no: -oldTotal } },
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
      result = {
        _id: String(doc._id),
        ma_nhap_vat_chua: doc.ma_nhap_vat_chua || '',
        tong_so_luong: qty,
        tong_tien: total,
        paid_amount: paidAmount,
        returned_amount: returnedAmount,
        remaining_amount: Math.max(0, total - paidAmount - returnedAmount)
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
