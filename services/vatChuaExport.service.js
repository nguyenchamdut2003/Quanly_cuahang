const mongoose = require('mongoose');
const { VatChua, XuatVatChua, KhachHang, NhaCungCap, CongNoNhaCungCap } = require('../models/kiot.model');
const {
  parseVatChuaImportInput,
  assertVatChuaImportInput,
  loadAverageCostByVatChuaIds
} = require('./vatChuaImport.service');

function cleanId(value) {
  const id = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(id) ? id : undefined;
}

function withSessionQuery(query, session) {
  return session ? query.session(session) : query;
}

async function createOne(model, doc, session) {
  if (!session) return model.create(doc);
  const rows = await model.create([doc], { session });
  return rows[0];
}

async function applySupplierDebtForXuatVatChua(xuatDoc, options = {}, session) {
  const amount = Math.max(0, Number(options.amount != null ? options.amount : xuatDoc && xuatDoc.tong_tien || 0));
  const supplierId = cleanId(options.supplierId || (xuatDoc && xuatDoc.doi_tuong_type === 'nha_cung_cap' ? xuatDoc.doi_tuong_id : null));
  if (!amount || !supplierId || !xuatDoc || !xuatDoc._id) return null;

  const existing = await withSessionQuery(
    CongNoNhaCungCap.findOne({
      xuat_vat_chua_id: xuatDoc._id,
      loai: 'giam_no'
    }),
    session
  ).lean();
  if (existing) {
    await withSessionQuery(
      CongNoNhaCungCap.updateOne({ _id: existing._id }, { $set: { so_tien: amount } }),
      session
    );
  } else {
    await createOne(CongNoNhaCungCap, {
      cua_hang_id: xuatDoc.cua_hang_id,
      nha_cung_cap_id: supplierId,
      xuat_vat_chua_id: xuatDoc._id,
      nhap_vat_chua_id: options.nhapVatChuaId || xuatDoc.source_id || undefined,
      so_tien: amount,
      loai: 'giam_no',
      ghi_chu: options.note || ('Giảm nợ từ xuất/trả vật chứa ' + (xuatDoc.ma_xuat_vat_chua || '')),
      ngay: new Date()
    }, session);
  }

  const debtDelta = options.debtDelta != null ? Number(options.debtDelta) : -amount;
  if (debtDelta !== 0) {
    await withSessionQuery(
      NhaCungCap.updateOne({ _id: supplierId }, { $inc: { tong_no: debtDelta } }),
      session
    );
  }
  return true;
}

async function reverseSupplierDebtForXuatVatChua(xuatDoc, session) {
  if (!xuatDoc || !xuatDoc._id) return;
  const supplierId = cleanId(xuatDoc.doi_tuong_type === 'nha_cung_cap' ? xuatDoc.doi_tuong_id : null);
  const rows = await withSessionQuery(
    CongNoNhaCungCap.find({ xuat_vat_chua_id: xuatDoc._id, loai: 'giam_no' }),
    session
  ).lean();
  if (!rows.length) return;
  const amount = rows.reduce(function(sum, row) {
    return sum + Math.max(0, Number(row.so_tien || 0));
  }, 0);
  await withSessionQuery(
    CongNoNhaCungCap.deleteMany({ xuat_vat_chua_id: xuatDoc._id, loai: 'giam_no' }),
    session
  );
  if (supplierId && amount > 0) {
    await withSessionQuery(
      NhaCungCap.updateOne({ _id: supplierId }, { $inc: { tong_no: amount } }),
      session
    );
  }
}

async function makeXuatVatChuaCode(storeId, session) {
  const regex = /^XVC\d+$/;
  const last = await withSessionQuery(
    XuatVatChua.findOne({ cua_hang_id: storeId, ma_xuat_vat_chua: regex }).sort({ ma_xuat_vat_chua: -1 }),
    session
  ).lean();
  const next = last && last.ma_xuat_vat_chua
    ? Number(String(last.ma_xuat_vat_chua).replace(/\D/g, '')) + 1
    : 1;
  return 'XVC' + String(next).padStart(6, '0');
}

async function createXuatVatChuaAndDecreaseStock(options = {}, session) {
  const storeId = cleanId(options.storeId);
  const vatChuaId = cleanId(options.vatChuaId);
  const qty = Math.floor(Number(options.qty || 0));
  if (!storeId || !vatChuaId || qty <= 0) {
    throw new Error('Thiếu thông tin xuất vật chứa');
  }

  const vatChua = await withSessionQuery(
    VatChua.findOne({
      _id: vatChuaId,
      cua_hang_id: storeId,
      trang_thai: 'active'
    }),
    session
  ).lean();
  if (!vatChua) throw new Error('Vật chứa không hợp lệ hoặc đã ngừng sử dụng');

  const tonKho = Math.max(0, Number(vatChua.so_luong_ton || 0));
  if (tonKho < qty) {
    throw new Error('Tồn vật chứa không đủ để xuất (còn ' + tonKho + ', cần ' + qty + ')');
  }

  const costMap = await loadAverageCostByVatChuaIds(storeId, [vatChuaId], session);
  const requestedGiaVon = options.giaVon != null ? Number(options.giaVon) : NaN;
  const giaVon = Number.isFinite(requestedGiaVon) && requestedGiaVon >= 0
    ? requestedGiaVon
    : Math.max(0, Number(costMap[String(vatChuaId)] || 0));
  const thanhTien = Math.round(giaVon * qty);
  const maXuat = await makeXuatVatChuaCode(storeId, session);

  const xuatDoc = await createOne(XuatVatChua, {
    ma_xuat_vat_chua: maXuat,
    loai_xuat: options.loaiXuat || 'ban_hang',
    doi_tuong_type: options.doiTuongType || 'none',
    doi_tuong_id: options.doiTuongId || undefined,
    doi_tuong_ten: options.doiTuongTen || undefined,
    source_type: options.sourceType || 'manual',
    source_id: options.sourceId || undefined,
    source_code: options.sourceCode || undefined,
    items: [{
      vat_chua_id: vatChua._id,
      ma_vat_chua: vatChua.ma_vat_chua || '',
      ten_vat_chua: vatChua.ten_vat_chua || '',
      so_luong: qty,
      gia_von: giaVon,
      thanh_tien: thanhTien
    }],
    tong_so_luong: qty,
    tong_tien: thanhTien,
    ghi_chu: String(options.ghiChu || '').trim(),
    trang_thai: 'active',
    cua_hang_id: storeId
  }, session);

  const stockUpdate = await withSessionQuery(
    VatChua.updateOne({ _id: vatChua._id }, { $inc: { so_luong_ton: -qty } }),
    session
  );
  if (!stockUpdate || Number(stockUpdate.modifiedCount || 0) < 1) {
    throw new Error('Không trừ được tồn vật chứa khi xuất.');
  }

  return xuatDoc;
}

/**
 * Ghi nhận xuất vật chứa kèm xác nhận giao đơn hàng (két giao cho khách).
 */
async function exportVatChuaWithOrderDelivery(order, invoice, data = {}, session) {
  if (!order || !order._id || !order.cua_hang_id) return null;

  const parsed = parseVatChuaImportInput(data);
  assertVatChuaImportInput(parsed);
  if (!parsed.vatChuaId || parsed.qty <= 0) return null;

  const customerName = String(data.khach_hang_ten || data.doi_tuong_ten || '').trim();
  const orderCode = order.ma_don_hang || '';
  const invoiceCode = invoice && invoice.ma_hoa_don ? String(invoice.ma_hoa_don).trim() : '';

  return createXuatVatChuaAndDecreaseStock({
    storeId: order.cua_hang_id,
    vatChuaId: parsed.vatChuaId,
    qty: parsed.qty,
    loaiXuat: invoice && invoice._id ? 'hoa_don' : 'ban_hang',
    doiTuongType: order.khach_hang_id ? 'khach_hang' : 'none',
    doiTuongId: order.khach_hang_id || undefined,
    doiTuongTen: customerName,
    sourceType: invoice && invoice._id ? 'hoa_don' : 'don_hang',
    sourceId: invoice && invoice._id ? invoice._id : order._id,
    sourceCode: invoiceCode || orderCode,
    ghiChu: 'Xuất két khi giao đơn ' + (orderCode || '') + (invoiceCode ? ' — HĐ ' + invoiceCode : '')
  }, session);
}

/**
 * Ghi nhận xuất vật chứa kèm phiếu trả hàng nhập (trả két cho NCC).
 */
async function exportVatChuaWithPurchaseReturn(returnDoc, data = {}, session) {
  if (!returnDoc || !returnDoc._id || !returnDoc.cua_hang_id) return null;

  const parsed = parseVatChuaImportInput(data);
  assertVatChuaImportInput(parsed);
  if (!parsed.vatChuaId || parsed.qty <= 0) return null;

  const supplierName = String(data.doi_tuong_ten || data.nha_cung_cap_ten || '').trim();
  const returnCode = returnDoc.ma_phieu_tra_nhap || '';

  return createXuatVatChuaAndDecreaseStock({
    storeId: returnDoc.cua_hang_id,
    vatChuaId: parsed.vatChuaId,
    qty: parsed.qty,
    loaiXuat: 'tra_hang_nhap',
    doiTuongType: returnDoc.nha_cung_cap_id ? 'nha_cung_cap' : 'none',
    doiTuongId: returnDoc.nha_cung_cap_id || undefined,
    doiTuongTen: supplierName,
    sourceType: 'phieu_tra_hang_nhap',
    sourceId: returnDoc._id,
    sourceCode: returnCode,
    ghiChu: 'Xuất két khi trả hàng nhập ' + (returnCode || '')
  }, session);
}

/**
 * Ghi nhận xuất vật chứa kèm tạo hóa đơn bán trực tiếp.
 */
async function exportVatChuaWithInvoice(invoice, data = {}, session) {
  if (!invoice || !invoice._id || !invoice.cua_hang_id) return null;

  const parsed = parseVatChuaImportInput(data);
  assertVatChuaImportInput(parsed);
  if (!parsed.vatChuaId || parsed.qty <= 0) return null;

  const customerName = String(data.khach_hang_ten || data.doi_tuong_ten || '').trim();
  const invoiceCode = invoice.ma_hoa_don || '';

  return createXuatVatChuaAndDecreaseStock({
    storeId: invoice.cua_hang_id,
    vatChuaId: parsed.vatChuaId,
    qty: parsed.qty,
    loaiXuat: 'hoa_don',
    doiTuongType: invoice.khach_hang_id ? 'khach_hang' : 'none',
    doiTuongId: invoice.khach_hang_id || undefined,
    doiTuongTen: customerName,
    sourceType: 'hoa_don',
    sourceId: invoice._id,
    sourceCode: invoiceCode,
    ghiChu: 'Xuất két khi tạo hóa đơn ' + (invoiceCode || '')
  }, session);
}

async function exportVatChuaWithSalesReturn(returnSlip, data = {}, session) {
  if (!returnSlip || !returnSlip._id || !returnSlip.cua_hang_id) return null;

  const parsed = parseVatChuaImportInput(data);
  assertVatChuaImportInput(parsed);
  if (!parsed.vatChuaId || parsed.qty <= 0) return null;

  const customerName = String(data.khach_hang_ten || data.doi_tuong_ten || '').trim();
  const returnCode = returnSlip.ma_phieu_tra || '';

  return createXuatVatChuaAndDecreaseStock({
    storeId: returnSlip.cua_hang_id,
    vatChuaId: parsed.vatChuaId,
    qty: parsed.qty,
    loaiXuat: 'doi_tra_hang',
    doiTuongType: returnSlip.khach_hang_id ? 'khach_hang' : 'none',
    doiTuongId: returnSlip.khach_hang_id || undefined,
    doiTuongTen: customerName,
    sourceType: 'tra_hang_ban',
    sourceId: returnSlip._id,
    sourceCode: returnCode,
    ghiChu: 'Xuất két khi trả/đổi hàng bán ' + (returnCode || '')
  }, session);
}

async function cancelXuatVatChuaBySource(storeId, sourceType, sourceId, session) {
  const store = cleanId(storeId);
  const source = cleanId(sourceId);
  if (!store || !source || !sourceType) return;

  const xuatRows = await withSessionQuery(
    XuatVatChua.find({
      cua_hang_id: store,
      source_type: sourceType,
      source_id: source,
      trang_thai: 'active',
      deleted_at: null
    }),
    session
  );

  for (const xuatDoc of xuatRows) {
    const items = Array.isArray(xuatDoc.items) ? xuatDoc.items : [];
    for (const item of items) {
      const vatChuaId = cleanId(item.vat_chua_id);
      const qty = Math.floor(Number(item.so_luong || 0));
      if (!vatChuaId || qty <= 0) continue;
      await withSessionQuery(
        VatChua.updateOne({ _id: vatChuaId }, { $inc: { so_luong_ton: qty } }),
        session
      );
    }
    xuatDoc.trang_thai = 'cancelled';
    await xuatDoc.save(withSessionOptions({}, session));
  }
}

function withSessionOptions(options, session) {
  return session ? Object.assign({}, options, { session }) : options;
}

function createHttpError(statusCode, message) {
  const error = new Error(message || 'Yêu cầu không hợp lệ');
  error.statusCode = statusCode || 400;
  return error;
}

function firstLine(doc) {
  return (Array.isArray(doc && doc.items) ? doc.items : [])[0] || {};
}

function isManualPartnerExport(doc) {
  if (!doc || doc.trang_thai === 'cancelled' || doc.deleted_at) return false;
  if (doc.source_type !== 'manual') return false;
  return doc.loai_xuat === 'ban_hang' || doc.loai_xuat === 'khac';
}

async function loadManualXuatVatChuaForEdit(id, storeId) {
  const docId = cleanId(id);
  const store = cleanId(storeId);
  if (!docId || !store) throw createHttpError(400, 'ID phiếu xuất vật chứa không hợp lệ.');

  const doc = await XuatVatChua.findOne({
    _id: docId,
    cua_hang_id: store,
    deleted_at: null
  }).lean();
  if (!doc) throw createHttpError(404, 'Không tìm thấy phiếu xuất vật chứa.');
  if (!isManualPartnerExport(doc)) {
    throw createHttpError(400, 'Chỉ chỉnh sửa phiếu xuất thủ công cho khách hàng hoặc nhà cung cấp.');
  }

  const line = firstLine(doc);
  return {
    edit_mode: 'manual_export',
    _id: String(doc._id),
    ma_xuat_vat_chua: doc.ma_xuat_vat_chua || '',
    loai_xuat: doc.loai_xuat || '',
    doi_tuong_type: doc.doi_tuong_type || 'none',
    khach_hang_id: doc.doi_tuong_type === 'khach_hang' && doc.doi_tuong_id ? String(doc.doi_tuong_id) : '',
    nha_cung_cap_id: doc.doi_tuong_type === 'nha_cung_cap' && doc.doi_tuong_id ? String(doc.doi_tuong_id) : '',
    doi_tuong_ten: doc.doi_tuong_ten || '',
    vat_chua_id: line.vat_chua_id ? String(line.vat_chua_id) : '',
    so_luong: Number(line.so_luong || doc.tong_so_luong || 0),
    ghi_chu: doc.ghi_chu || '',
    tong_tien: Number(doc.tong_tien || 0)
  };
}

async function resolvePartnerForManualExport(storeId, customerId, supplierId, session) {
  if (customerId && supplierId) {
    throw createHttpError(400, 'Chỉ chọn một đối tượng: khách hàng hoặc nhà cung cấp.');
  }
  if (!customerId && !supplierId) {
    throw createHttpError(400, 'Vui lòng chọn khách hàng hoặc nhà cung cấp.');
  }

  if (customerId) {
    const customer = await withSessionQuery(
      KhachHang.findOne({
        _id: customerId,
        trang_thai: 'active',
        $or: [
          { cua_hang_id: storeId },
          { cua_hang_id: { $exists: false } },
          { cua_hang_id: null }
        ]
      }).select('ten_khach_hang ma_khach_hang'),
      session
    ).lean();
    if (!customer) throw createHttpError(400, 'Khách hàng không hợp lệ.');
    return {
      doiTuongType: 'khach_hang',
      doiTuongId: customer._id,
      doiTuongTen: customer.ten_khach_hang || customer.ma_khach_hang || '',
      loaiXuat: 'ban_hang'
    };
  }

  const supplier = await withSessionQuery(
    NhaCungCap.findOne({
      _id: supplierId,
      trang_thai: 'active',
      $or: [
        { cua_hang_id: storeId },
        { cua_hang_id: { $exists: false } },
        { cua_hang_id: null }
      ]
    }).select('ten_ncc ma_ncc'),
    session
  ).lean();
  if (!supplier) throw createHttpError(400, 'Nhà cung cấp không hợp lệ.');
  return {
    doiTuongType: 'nha_cung_cap',
    doiTuongId: supplier._id,
    doiTuongTen: supplier.ten_ncc || supplier.ma_ncc || '',
    loaiXuat: 'khac'
  };
}

async function updateManualXuatVatChua(id, data = {}, storeId) {
  const docId = cleanId(id);
  const store = cleanId(storeId);
  if (!docId || !store) throw createHttpError(400, 'ID phiếu xuất vật chứa không hợp lệ.');

  const vatChuaId = cleanId(data.vat_chua_id);
  const qty = Math.max(0, Math.floor(Number(data.so_luong || data.qty || 0)));
  const customerId = cleanId(data.khach_hang_id);
  const supplierId = cleanId(data.nha_cung_cap_id);
  const ghiChu = String(data.ghi_chu || '').trim();

  if (!vatChuaId) throw createHttpError(400, 'Vui lòng chọn vật chứa.');
  if (qty <= 0) throw createHttpError(400, 'Vui lòng nhập số lượng xuất hợp lệ.');

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async function() {
      const doc = await withSessionQuery(
        XuatVatChua.findOne({ _id: docId, cua_hang_id: store, deleted_at: null }),
        session
      );
      if (!doc) throw createHttpError(404, 'Không tìm thấy phiếu xuất vật chứa.');
      if (!isManualPartnerExport(doc)) {
        throw createHttpError(400, 'Chỉ chỉnh sửa phiếu xuất thủ công cho khách hàng hoặc nhà cung cấp.');
      }

      const partner = await resolvePartnerForManualExport(store, customerId, supplierId, session);
      const vatChua = await withSessionQuery(
        VatChua.findOne({ _id: vatChuaId, cua_hang_id: store, trang_thai: 'active' }),
        session
      );
      if (!vatChua) throw createHttpError(400, 'Vật chứa không hợp lệ hoặc đã ngừng sử dụng.');

      const oldLine = firstLine(doc);
      const oldVatChuaId = cleanId(oldLine.vat_chua_id);
      const oldQty = Math.max(0, Math.floor(Number(oldLine.so_luong || doc.tong_so_luong || 0)));
      const oldPartnerType = doc.doi_tuong_type;
      const oldPartnerId = doc.doi_tuong_id;
      const oldTotal = Math.max(0, Number(doc.tong_tien || 0));
      const costMap = await loadAverageCostByVatChuaIds(store, [vatChuaId], session);
      const giaVon = Math.max(0, Number(costMap[String(vatChuaId)] || oldLine.gia_von || 0));
      const thanhTien = Math.round(giaVon * qty);

      if (oldVatChuaId && oldVatChuaId !== vatChuaId) {
        if (oldQty > 0) {
          await withSessionQuery(
            VatChua.updateOne({ _id: oldVatChuaId, cua_hang_id: store }, { $inc: { so_luong_ton: oldQty } }),
            session
          );
        }
        const stockUpdate = await withSessionQuery(
          VatChua.updateOne(
            { _id: vatChuaId, cua_hang_id: store, so_luong_ton: { $gte: qty } },
            { $inc: { so_luong_ton: -qty } }
          ),
          session
        );
        if (!stockUpdate || Number(stockUpdate.modifiedCount || 0) < 1) {
          throw createHttpError(400, 'Tồn vật chứa không đủ để xuất.');
        }
      } else {
        const deltaQty = qty - oldQty;
        if (deltaQty !== 0) {
          const stockFilter = { _id: vatChuaId, cua_hang_id: store };
          if (deltaQty > 0) stockFilter.so_luong_ton = { $gte: deltaQty };
          const stockUpdate = await withSessionQuery(
            VatChua.updateOne(stockFilter, { $inc: { so_luong_ton: -deltaQty } }),
            session
          );
          if (!stockUpdate || Number(stockUpdate.modifiedCount || 0) < 1) {
            throw createHttpError(400, 'Tồn vật chứa không đủ để tăng số lượng xuất.');
          }
        }
      }

      doc.loai_xuat = partner.loaiXuat;
      doc.doi_tuong_type = partner.doiTuongType;
      doc.doi_tuong_id = partner.doiTuongId;
      doc.doi_tuong_ten = partner.doiTuongTen;
      doc.items = [{
        vat_chua_id: vatChua._id,
        ma_vat_chua: vatChua.ma_vat_chua || '',
        ten_vat_chua: vatChua.ten_vat_chua || '',
        so_luong: qty,
        gia_von: giaVon,
        thanh_tien: thanhTien
      }];
      doc.tong_so_luong = qty;
      doc.tong_tien = thanhTien;
      doc.ghi_chu = ghiChu || ('Xuất vật chứa cho ' + partner.doiTuongTen);
      await doc.save(withSessionOptions({}, session));

      await reverseSupplierDebtForXuatVatChua({
        _id: doc._id,
        doi_tuong_type: oldPartnerType,
        doi_tuong_id: oldPartnerId,
        tong_tien: oldTotal
      }, session);
      if (partner.doiTuongType === 'nha_cung_cap' && thanhTien > 0) {
        await applySupplierDebtForXuatVatChua(doc, {
          supplierId: partner.doiTuongId,
          amount: thanhTien
        }, session);
      }

      result = {
        edit_mode: 'manual_export',
        _id: String(doc._id),
        ma_xuat_vat_chua: doc.ma_xuat_vat_chua || '',
        tong_so_luong: qty,
        tong_tien: thanhTien
      };
    });
  } finally {
    await session.endSession();
  }

  return result;
}

async function cancelManualXuatVatChua(id, storeId) {
  const docId = cleanId(id);
  const store = cleanId(storeId);
  if (!docId || !store) throw createHttpError(400, 'ID phiếu xuất vật chứa không hợp lệ.');

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async function() {
      const doc = await withSessionQuery(
        XuatVatChua.findOne({ _id: docId, cua_hang_id: store, deleted_at: null }),
        session
      );
      if (!doc) throw createHttpError(404, 'Không tìm thấy phiếu xuất vật chứa.');
      if (!isManualPartnerExport(doc)) {
        throw createHttpError(400, 'Chỉ xóa phiếu xuất thủ công cho khách hàng hoặc nhà cung cấp.');
      }

      const items = Array.isArray(doc.items) ? doc.items : [];
      for (const item of items) {
        const vatChuaId = cleanId(item.vat_chua_id);
        const qty = Math.max(0, Math.floor(Number(item.so_luong || 0)));
        if (!vatChuaId || qty <= 0) continue;
        await withSessionQuery(
          VatChua.updateOne({ _id: vatChuaId, cua_hang_id: store }, { $inc: { so_luong_ton: qty } }),
          session
        );
      }

      doc.trang_thai = 'cancelled';
      await doc.save(withSessionOptions({}, session));
      await reverseSupplierDebtForXuatVatChua(doc, session);
      result = {
        edit_mode: 'manual_export',
        _id: String(doc._id),
        ma_xuat_vat_chua: doc.ma_xuat_vat_chua || ''
      };
    });
  } finally {
    await session.endSession();
  }

  return result;
}

module.exports = {
  exportVatChuaWithOrderDelivery,
  exportVatChuaWithPurchaseReturn,
  exportVatChuaWithInvoice,
  exportVatChuaWithSalesReturn,
  cancelXuatVatChuaBySource,
  createXuatVatChuaAndDecreaseStock,
  applySupplierDebtForXuatVatChua,
  reverseSupplierDebtForXuatVatChua,
  isManualPartnerExport,
  loadManualXuatVatChuaForEdit,
  updateManualXuatVatChua,
  cancelManualXuatVatChua
};
