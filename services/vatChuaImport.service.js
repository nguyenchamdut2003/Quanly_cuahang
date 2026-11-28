const mongoose = require('mongoose');
const { VatChua, NhapVatChua, NhaCungCap, CongNoNhaCungCap } = require('../models/kiot.model');
const { extractPaymentDetail } = require('./paymentCashBook.service');
const { taoPhieuThuChi } = require('./soQuy.service');
const { LINKED_SOURCES, money, parseLinkedMoney, linkedOptions, inTransaction, operationKey,
  loadLinkedMovement, assertLinkedCashCanChange, createLinkedContainerReceipt } = require('./vatChuaLinkedMoney.service');

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

function cleanId(value) {
  const id = String(value || '').trim();
  return isObjectId(id) ? id : undefined;
}

function parseMoney(value) {
  const n = Number(String(value ?? '').replace(/\./g, '').replace(/,/g, '').trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function withSessionQuery(query, session) {
  return session ? query.session(session) : query;
}

function withSessionOptions(options = {}, session) {
  return session ? Object.assign({}, options, { session }) : options;
}

async function createOne(model, doc, session) {
  if (!session) return model.create(doc);
  const rows = await model.create([doc], { session });
  return rows[0];
}

async function makeNhapVatChuaCode(storeId, session) {
  const regex = /^NVC\d+$/;
  const last = await withSessionQuery(
    NhapVatChua.findOne({ cua_hang_id: storeId, ma_nhap_vat_chua: regex }).sort({ ma_nhap_vat_chua: -1 }),
    session
  ).lean();
  const next = last && last.ma_nhap_vat_chua
    ? Number(String(last.ma_nhap_vat_chua).replace(/\D/g, '')) + 1
    : 1;
  return 'NVC' + String(next).padStart(6, '0');
}

function parseVatChuaImportInput(data = {}) {
  const vatChuaId = cleanId(data.vat_chua_id);
  const rawQty = String(data.vat_chua_so_luong ?? data.so_luong ?? '').replace(/\./g, '').replace(/,/g, '').trim();
  const qty = Math.floor(Number(rawQty || 0));
  return { vatChuaId, qty, hasQtyInput: rawQty !== '', ...parseLinkedMoney(data, qty) };
}

function parseVatChuaSignedInput(data = {}) {
  const vatChuaId = cleanId(data.vat_chua_id);
  const rawQty = String(data.vat_chua_so_luong ?? data.so_luong ?? '').replace(/\./g, '').replace(/,/g, '').trim();
  if (rawQty === '' || rawQty === '-') {
    return { vatChuaId, qty: 0, hasQtyInput: rawQty !== '', ...parseLinkedMoney(data, 0) };
  }
  const qty = Math.floor(Number(rawQty));
  if (!Number.isFinite(qty)) {
    return { vatChuaId, qty: 0, hasQtyInput: true, ...parseLinkedMoney(data, 0) };
  }
  return { vatChuaId, qty, hasQtyInput: true, ...parseLinkedMoney(data, qty) };
}

function assertVatChuaImportInput(parsed) {
  if (!parsed) return;
  if (!Number.isFinite(parsed.qty) || !Number.isInteger(parsed.qty)) throw new Error('Số lượng vật chứa không hợp lệ');
  if (parsed.vatChuaId && parsed.qty <= 0) {
    throw new Error('Số lượng vật chứa phải lớn hơn 0');
  }
  if (!parsed.vatChuaId && parsed.hasQtyInput && parsed.qty > 0) {
    throw new Error('Vui lòng chọn vật chứa');
  }
}

function assertVatChuaSignedInput(parsed) {
  if (!parsed) return;
  if (!Number.isFinite(parsed.qty) || !Number.isInteger(parsed.qty)) throw new Error('Số lượng vật chứa không hợp lệ');
  if (parsed.vatChuaId && parsed.hasQtyInput && parsed.qty === 0) {
    throw new Error('Số lượng vật chứa không được bằng 0');
  }
  if (!parsed.vatChuaId && parsed.hasQtyInput && parsed.qty !== 0) {
    throw new Error('Vui lòng chọn vật chứa');
  }
}

function vatChuaConfigFromParsed(parsed) {
  if (!parsed || !parsed.vatChuaId) return undefined;
  return { vat_chua_id: parsed.vatChuaId, vat_chua_so_luong: parsed.qty,
    vat_chua_don_gia_giao_dich: parsed.transactionPrice || 0,
    vat_chua_ghi_nhan_thu_chi: parsed.recognizeCash === true,
    vat_chua_thanh_toan: { ...(parsed.payment || {}) } };
}

function parseGiaVonInput(value) {
  const raw = String(value ?? '').replace(/\./g, '').replace(/,/g, '').replace(/[^\d]/g, '').trim();
  if (raw === '') return null;
  return Math.max(0, Number(raw) || 0);
}

function isDirectImportPaymentV2(data = {}) {
  const raw = data.chi_tiet_thanh_toan && typeof data.chi_tiet_thanh_toan === 'object'
    ? data.chi_tiet_thanh_toan
    : {};
  const flag = data.payment_v2;
  return flag === true
    || flag === 'true'
    || flag === '1'
    || Boolean(String(raw.so_quy_tien_mat_id || data['chi_tiet_thanh_toan[so_quy_tien_mat_id]'] || '').trim())
    || Boolean(String(raw.so_quy_chuyen_khoan_id || data['chi_tiet_thanh_toan[so_quy_chuyen_khoan_id]'] || '').trim());
}

function normalizeDirectImportPayment(data = {}, payableAmount) {
  const limit = Math.max(0, parseMoney(payableAmount));
  if (isDirectImportPaymentV2(data)) {
    const detail = extractPaymentDetail(data);
    if (detail.tien_tra_khach > 0) {
      throw new Error('Tiền trả khách không áp dụng cho thanh toán nhập vật chứa.');
    }
    const amount = detail.tien_mat + detail.chuyen_khoan;
    if (amount > limit) {
      throw new Error('Số tiền thanh toán không được vượt tổng tiền nhập vật chứa.');
    }
    if (detail.tien_mat > 0 && !String(detail.so_quy_tien_mat_id || '').trim()) {
      throw new Error('Vui lòng chọn sổ tiền mặt.');
    }
    if (detail.chuyen_khoan > 0 && !String(detail.so_quy_chuyen_khoan_id || '').trim()) {
      throw new Error('Vui lòng chọn tài khoản chuyển khoản.');
    }
    return {
      isV2: true,
      amount,
      detail: Object.assign({}, detail, { tien_tra_khach: 0 })
    };
  }

  const raw = data.chi_tiet_thanh_toan && typeof data.chi_tiet_thanh_toan === 'object'
    ? data.chi_tiet_thanh_toan
    : {};
  let tienMat = parseMoney(raw.tien_mat ?? data['chi_tiet_thanh_toan[tien_mat]']);
  let chuyenKhoan = parseMoney(raw.chuyen_khoan ?? data['chi_tiet_thanh_toan[chuyen_khoan]']);
  let amount = tienMat + chuyenKhoan;
  if (amount > limit) {
    const overflow = amount - limit;
    if (chuyenKhoan >= overflow) chuyenKhoan -= overflow;
    else {
      tienMat = Math.max(0, tienMat - (overflow - chuyenKhoan));
      chuyenKhoan = 0;
    }
    amount = tienMat + chuyenKhoan;
  }
  return {
    isV2: false,
    amount,
    detail: {
      tien_mat: tienMat,
      chuyen_khoan: chuyenKhoan,
      tien_tra_khach: 0
    }
  };
}

async function applySupplierDebtForNhapVatChua(nhapDoc, options = {}, session) {
  const canTra = Math.max(0, Number(nhapDoc.tong_tien || 0));
  const supplierId = cleanId(options.supplierId);
  if (!canTra || !supplierId) return;

  await createOne(CongNoNhaCungCap, {
    cua_hang_id: nhapDoc.cua_hang_id,
    nha_cung_cap_id: supplierId,
    nhap_vat_chua_id: nhapDoc._id,
    so_tien: canTra,
    loai: 'tang_no',
    ghi_chu: 'Công nợ phát sinh từ nhập vật chứa ' + (nhapDoc.ma_nhap_vat_chua || ''),
    ngay: new Date()
  }, session);

  await withSessionQuery(
    NhaCungCap.updateOne(
      { _id: supplierId },
      { $inc: { tong_mua: canTra, tong_no: canTra } }
    ),
    session
  );
}

async function createNhapVatChuaAndIncreaseStock(options = {}, session) {
  const linked = LINKED_SOURCES.has(options.sourceType);
  if (linked && !session) return inTransaction(null, activeSession => createNhapVatChuaAndIncreaseStock(options, activeSession));
  const storeId = cleanId(options.storeId);
  const vatChuaId = cleanId(options.vatChuaId);
  const qty = Math.floor(Number(options.qty || 0));
  if (!storeId || !vatChuaId || qty <= 0) {
    throw new Error('Thiếu thông tin nhập vật chứa');
  }
  const existing = linked ? await loadLinkedMovement(NhapVatChua, { ...options, storeId, vatChuaId, qty }, 'nhap', session) : null;

  const vatChua = await withSessionQuery(
    VatChua.findOne({
      _id: vatChuaId,
      cua_hang_id: storeId,
      trang_thai: 'active'
    }),
    session
  ).lean();
  if (!vatChua) throw new Error('Vật chứa không hợp lệ hoặc đã ngừng sử dụng');

  const zeroCost = options.zeroCost === true;
  const giaVonOverride = options.giaVon != null ? Math.max(0, Number(options.giaVon)) : null;
  const giaVon = zeroCost ? 0 : giaVonOverride;
  if (!zeroCost && (giaVon == null || giaVon <= 0)) {
    throw new Error('Vui lòng nhập giá vốn lớn hơn 0');
  }
  const thanhTien = zeroCost ? 0 : Math.round(giaVon * qty);
  const transactionPrice = money(options.transactionPrice ?? giaVon ?? 0);
  const maNhap = existing ? existing.ma_nhap_vat_chua : await makeNhapVatChuaCode(storeId, session);
  const values = {
    ma_nhap_vat_chua: maNhap,
    loai_nhap: options.loaiNhap || 'mua_moi',
    doi_tuong_type: options.doiTuongType || 'none',
    doi_tuong_id: options.doiTuongId || undefined,
    doi_tuong_ten: options.doiTuongTen || undefined,
    source_type: options.sourceType || 'manual',
    source_id: options.sourceId || undefined,
    source_code: options.sourceCode || undefined,
    operation_key: operationKey(options),
    ghi_nhan_thu_chi: linked && options.recognizeCash === true,
    items: [{
      vat_chua_id: vatChua._id,
      ma_vat_chua: vatChua.ma_vat_chua || '',
      ten_vat_chua: vatChua.ten_vat_chua || '',
      so_luong: qty,
      gia_von: giaVon,
      thanh_tien: thanhTien,
      don_gia_giao_dich: transactionPrice,
      thanh_tien_giao_dich: transactionPrice * qty
    }],
    tong_so_luong: qty,
    tong_tien: thanhTien,
    ghi_chu: String(options.ghiChu || '').trim(),
    trang_thai: 'active',
    cua_hang_id: storeId
  };
  let nhapDoc;
  if (existing) {
    const oldLine = (existing.items || [])[0] || {};
    const oldId = cleanId(oldLine.vat_chua_id), oldQty = Number(oldLine.so_luong || 0);
    if (oldId && oldId !== vatChuaId && oldQty > 0) {
      const restored = await VatChua.updateOne({ _id: oldId, cua_hang_id: storeId, so_luong_ton: { $gte: oldQty } }, { $inc: { so_luong_ton: -oldQty } }, { session });
      if (!restored || Number(restored.modifiedCount || 0) < 1) throw new Error('Tồn vật chứa không đủ để điều chỉnh phiếu nhập.');
    }
    const delta = oldId === vatChuaId ? qty - oldQty : qty;
    if (delta) {
      const updated = await VatChua.updateOne({ _id: vatChuaId, cua_hang_id: storeId, ...(delta < 0 ? { so_luong_ton: { $gte: -delta } } : {}) },
        { $inc: { so_luong_ton: delta } }, { session });
      if (!updated || Number(updated.modifiedCount || 0) < 1) throw new Error('Tồn vật chứa không đủ để điều chỉnh phiếu nhập.');
    }
    Object.assign(existing, values); await existing.save(withSessionOptions({}, session)); nhapDoc = existing;
  } else {
    nhapDoc = await createOne(NhapVatChua, values, session);
    await withSessionQuery(VatChua.updateOne({ _id: vatChua._id, cua_hang_id: storeId }, { $inc: { so_luong_ton: qty } }), session);
  }
  if (linked) await createLinkedContainerReceipt(nhapDoc, 'nhap', options, session);

  return nhapDoc;
}

/**
 * Nhập vật chứa khi khách trả hàng bán — tăng tồn, không ghi nhận tiền.
 */
async function importVatChuaWithSalesReturn(returnSlip, data = {}, session) {
  if (!returnSlip || !returnSlip._id || !returnSlip.cua_hang_id) return null;
  if (['draft', 'cancelled'].includes(returnSlip.trang_thai)) return null;

  const parsed = parseVatChuaImportInput(data);
  assertVatChuaImportInput(parsed);
  if (!parsed.vatChuaId || parsed.qty <= 0) return null;

  const customerName = String(data.khach_hang_ten || data.doi_tuong_ten || '').trim();
  const returnCode = returnSlip.ma_phieu_tra || '';

  return createNhapVatChuaAndIncreaseStock({
    storeId: returnSlip.cua_hang_id,
    vatChuaId: parsed.vatChuaId,
    qty: parsed.qty,
    ...linkedOptions(parsed, data),
    zeroCost: true,
    loaiNhap: 'doi_tra_hang',
    doiTuongType: returnSlip.khach_hang_id ? 'khach_hang' : 'none',
    doiTuongId: returnSlip.khach_hang_id || undefined,
    doiTuongTen: customerName,
    sourceType: 'tra_hang_ban',
    sourceId: returnSlip._id,
    sourceCode: returnCode,
    ghiChu: 'Nhập két khi trả hàng bán ' + (returnCode || '')
  }, session);
}

async function cancelNhapVatChuaBySource(storeId, sourceType, sourceId, session) {
  if (!session) return inTransaction(null, activeSession => cancelNhapVatChuaBySource(storeId, sourceType, sourceId, activeSession));
  const store = cleanId(storeId);
  const source = cleanId(sourceId);
  if (!store || !source || !sourceType) return;

  const nhapRows = await withSessionQuery(
    NhapVatChua.find({
      cua_hang_id: store,
      source_type: sourceType,
      source_id: source,
      trang_thai: 'active',
      deleted_at: null
    }),
    session
  );

  for (const nhapDoc of nhapRows) {
    await assertLinkedCashCanChange(nhapDoc, 'nhap', session);
    const items = Array.isArray(nhapDoc.items) ? nhapDoc.items : [];
    for (const item of items) {
      const vatChuaId = cleanId(item.vat_chua_id);
      const qty = Math.floor(Number(item.so_luong || 0));
      if (!vatChuaId || qty <= 0) continue;
      const updated = await withSessionQuery(VatChua.updateOne({ _id: vatChuaId, cua_hang_id: store, so_luong_ton: { $gte: qty } }, { $inc: { so_luong_ton: -qty } }), session);
      if (!updated || Number(updated.modifiedCount || 0) < 1) throw new Error('Tồn vật chứa không đủ để hủy phiếu nhập.');
    }
    nhapDoc.trang_thai = 'cancelled';
    await nhapDoc.save(withSessionOptions({}, session));
  }
}

async function createExpenseReceiptForNhapVatChua(nhapDoc, options = {}, session) {
  if (!nhapDoc || !nhapDoc._id) return null;
  const payment = options.payment || {};
  const paidAmount = Math.max(0, Number(payment.amount || 0));
  if (paidAmount <= 0) return null;

  const supplierId = cleanId(options.supplierId);
  const supplierName = String(options.supplierName || '').trim();

  if (payment.isV2) {
    return taoPhieuThuChi({
      loai_phieu: 'chi',
      loai_thu_chi: 'Chi Nhập vật chứa',
      gia_tri: paidAmount,
      ngay_lap: new Date(),
      cua_hang_id: nhapDoc.cua_hang_id,
      nguoi_tao_id: options.userId,
      nha_cung_cap_id: supplierId,
      nhap_vat_chua_id: nhapDoc._id,
      document_type: 'nhap_vat_chua',
      ma_chung_tu_goc: nhapDoc.ma_nhap_vat_chua || '',
      nhom_doi_tuong: 'nha_cung_cap',
      doi_tuong: supplierName,
      payment_v2: true,
      tien_mat: Number(payment.detail.tien_mat || 0),
      so_quy_tien_mat_id: payment.detail.so_quy_tien_mat_id || '',
      chuyen_khoan: Number(payment.detail.chuyen_khoan || 0),
      so_quy_chuyen_khoan_id: payment.detail.so_quy_chuyen_khoan_id || '',
      tien_tra_khach: 0,
      hach_toan: true
    }, { session });
  }

  throw new Error('Vui lòng chọn sổ quỹ để thanh toán nhập vật chứa.');
}

/**
 * Tạo NhapVatChua kèm phiếu nhập và tăng VatChua.so_luong_ton (không ghi nhận tiền).
 */
async function importVatChuaWithPurchase(purchase, data = {}, session) {
  if (!purchase || !purchase._id || !purchase.cua_hang_id) return null;
  if (['draft', 'cancelled'].includes(purchase.trang_thai)) return null;

  const parsed = parseVatChuaImportInput(data);
  assertVatChuaImportInput(parsed);
  if (!parsed.vatChuaId || parsed.qty <= 0) return null;

  let doiTuongTen = '';
  if (purchase.nha_cung_cap_id) {
    const supplier = await withSessionQuery(
      NhaCungCap.findById(purchase.nha_cung_cap_id).select('ten_ncc'),
      session
    ).lean();
    doiTuongTen = supplier && supplier.ten_ncc ? String(supplier.ten_ncc).trim() : '';
  }

  return createNhapVatChuaAndIncreaseStock({
    storeId: purchase.cua_hang_id,
    vatChuaId: parsed.vatChuaId,
    qty: parsed.qty,
    ...linkedOptions(parsed, data),
    zeroCost: true,
    loaiNhap: 'kem_phieu_nhap_hang',
    doiTuongType: purchase.nha_cung_cap_id ? 'nha_cung_cap' : 'none',
    doiTuongId: purchase.nha_cung_cap_id || undefined,
    doiTuongTen: doiTuongTen,
    sourceType: 'phieu_nhap',
    sourceId: purchase._id,
    sourceCode: purchase.ma_phieu_nhap || '',
    ghiChu: 'Nhập kèm phiếu nhập ' + (purchase.ma_phieu_nhap || '')
  }, session);
}

/**
 * Nhập vật chứa trực tiếp từ nhà cung cấp — tạo phiếu chi khi thanh toán.
 */
async function importDirectVatChuaFromSupplier(data = {}, options = {}) {
  const storeId = cleanId(data.cua_hang_id);
  const supplierId = cleanId(data.nha_cung_cap_id);
  const parsed = parseVatChuaImportInput(data);
  const session = options.session || data.session;
  const runInTransaction = typeof options.runInTransaction === 'boolean' ? options.runInTransaction : !session;

  if (!storeId) throw new Error('Chưa chọn cửa hàng làm việc');
  if (!supplierId) throw new Error('Vui lòng chọn nhà cung cấp');
  if (!parsed.vatChuaId || parsed.qty <= 0) {
    throw new Error('Vui lòng chọn vật chứa và nhập số lượng lớn hơn 0');
  }

  const giaVon = parseGiaVonInput(data.gia_von);
  if (giaVon == null || giaVon <= 0) {
    throw new Error('Vui lòng nhập giá vốn lớn hơn 0');
  }
  const thanhTien = Math.round(giaVon * parsed.qty);
  const payment = normalizeDirectImportPayment(data, thanhTien);

  const supplierQuery = { _id: supplierId, trang_thai: 'active' };
  supplierQuery.$or = [
    { cua_hang_id: storeId },
    { cua_hang_id: { $exists: false } },
    { cua_hang_id: null }
  ];
  const supplier = await withSessionQuery(
    NhaCungCap.findOne(supplierQuery).select('ten_ncc'),
    session
  ).lean();
  if (!supplier) throw new Error('Nhà cung cấp không hợp lệ');

  const supplierName = supplier.ten_ncc ? String(supplier.ten_ncc).trim() : '';
  const note = String(data.ghi_chu || '').trim();
  const ghiChu = note || ('Nhập trực tiếp từ NCC ' + (supplierName || ''));

  async function execute(activeSession) {
    const nhapDoc = await createNhapVatChuaAndIncreaseStock({
      storeId: storeId,
      vatChuaId: parsed.vatChuaId,
      qty: parsed.qty,
      giaVon: giaVon,
      loaiNhap: 'mua_moi',
      doiTuongType: 'nha_cung_cap',
      doiTuongId: supplierId,
      doiTuongTen: supplierName,
      sourceType: 'manual',
      ghiChu: ghiChu
    }, activeSession);

    await applySupplierDebtForNhapVatChua(nhapDoc, {
      supplierId: supplierId
    }, activeSession);

    await createExpenseReceiptForNhapVatChua(nhapDoc, {
      payment: payment,
      supplierId: supplierId,
      supplierName: supplierName,
      userId: options.userId
    }, activeSession);

    return nhapDoc;
  }

  if (!runInTransaction) {
    return execute(session);
  }

  const ownSession = await mongoose.startSession();
  try {
    let result;
    await ownSession.withTransaction(async function() {
      result = await execute(ownSession);
    });
    return result;
  } finally {
    await ownSession.endSession();
  }
}

async function loadAverageCostByVatChuaIds(storeId, vatChuaIds = []) {
  const map = {};
  if (!storeId || !Array.isArray(vatChuaIds) || vatChuaIds.length === 0) return map;

  const objectIds = vatChuaIds
    .map(function(id) { return cleanId(id); })
    .filter(Boolean)
    .map(function(id) { return new mongoose.Types.ObjectId(id); });
  if (!objectIds.length) return map;

  const rows = await NhapVatChua.aggregate([
    {
      $match: {
        cua_hang_id: new mongoose.Types.ObjectId(String(storeId)),
        trang_thai: 'active',
        deleted_at: null,
        loai_nhap: { $ne: 'kem_phieu_nhap_hang' }
      }
    },
    { $unwind: '$items' },
    {
      $match: {
        'items.vat_chua_id': { $in: objectIds }
      }
    },
    {
      $group: {
        _id: '$items.vat_chua_id',
        totalQty: { $sum: '$items.so_luong' },
        totalAmount: { $sum: '$items.thanh_tien' }
      }
    }
  ]);

  rows.forEach(function(row) {
    const qty = Number(row.totalQty || 0);
    map[String(row._id)] = qty > 0 ? Math.round(Number(row.totalAmount || 0) / qty) : 0;
  });
  return map;
}

async function addAverageCostToVatChuaOptions(storeId, rows = []) {
  const costs = await loadAverageCostByVatChuaIds(storeId, rows.map(row => row._id));
  rows.forEach(row => { row.gia_von_binh_quan = costs[String(row._id)] || 0; });
  return rows;
}

module.exports = {
  parseVatChuaImportInput,
  vatChuaConfigFromParsed,
  parseVatChuaSignedInput,
  assertVatChuaImportInput,
  assertVatChuaSignedInput,
  createNhapVatChuaAndIncreaseStock,
  importVatChuaWithPurchase,
  importVatChuaWithSalesReturn,
  cancelNhapVatChuaBySource,
  importDirectVatChuaFromSupplier,
  loadAverageCostByVatChuaIds,
  addAverageCostToVatChuaOptions
};
