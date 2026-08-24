var mongoose = require('mongoose');
var { VatChua, Counter, NhaCungCap, KhachHang, NhapVatChua, XuatVatChua } = require('../models/kiot.model');
var { resolveStoreId } = require('../utils/storeScope');
var { importDirectVatChuaFromSupplier, loadAverageCostByVatChuaIds, createNhapVatChuaAndIncreaseStock } = require('../services/vatChuaImport.service');
var {
  createXuatVatChuaAndDecreaseStock,
  loadManualXuatVatChuaForEdit,
  updateManualXuatVatChua,
  cancelManualXuatVatChua,
  isManualPartnerExport,
  applySupplierDebtForXuatVatChua
} = require('../services/vatChuaExport.service');
var { taoPhieuThuChi } = require('../services/soQuy.service');
var { buildReceiptPaymentInfo, extractPaymentDetail } = require('../services/paymentCashBook.service');
var { loadVatChuaDetailContext, loadVatChuaDocumentDetail } = require('../services/vatChuaDetail.service');
var { loadNhapVatChuaForEdit, updateNhapVatChuaImport } = require('../services/vatChuaImportEdit.service');
var { loadXuatVatChuaForEdit, updateXuatVatChuaReturn } = require('../services/vatChuaReturnEdit.service');

function disabledTrashOperation() {
  var error = new Error('Chuc nang xoa/dua vao thung rac da duoc tat.');
  error.statusCode = 410;
  throw error;
}

var previewNhapVatChuaTrash = disabledTrashOperation;
var moveNhapVatChuaToTrash = disabledTrashOperation;
var deleteXuatVatChuaReturn = disabledTrashOperation;

var VAT_CHUA_PAGE_SIZE = 10;

function formatDate(value) {
  if (!value) return '---';
  return new Date(value).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function normalizeObjectId(value) {
  var raw = String(value || '').trim();
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) return '';
  return raw;
}

function hasReturnPaymentV2Payload(body) {
  var raw = body && typeof body.chi_tiet_thanh_toan === 'object' ? body.chi_tiet_thanh_toan : {};
  return body && (
    body.payment_v2 === true
    || body.payment_v2 === 'true'
    || body.payment_v2 === '1'
    || String(raw.so_quy_tien_mat_id || body['chi_tiet_thanh_toan[so_quy_tien_mat_id]'] || '').trim()
    || String(raw.so_quy_chuyen_khoan_id || body['chi_tiet_thanh_toan[so_quy_chuyen_khoan_id]'] || '').trim()
    || raw.tien_mat !== undefined
    || raw.chuyen_khoan !== undefined
  );
}

function normalizeFilterQuery(query) {
  query = query || {};
  var status = String(query.status || 'active').trim();
  if (['all', 'active', 'inactive'].indexOf(status) < 0) status = 'active';
  return {
    keyword: String(query.keyword || '').trim(),
    stockFrom: String(query.stockFrom || '').trim(),
    stockTo: String(query.stockTo || '').trim(),
    created: ['all', 'custom'].indexOf(query.created) >= 0 ? query.created : 'all',
    createdFrom: String(query.createdFrom || '').trim(),
    createdTo: String(query.createdTo || '').trim(),
    status: status
  };
}

function getDateRange(filter) {
  var start = null;
  var end = null;
  if (filter.created === 'custom') {
    if (filter.createdFrom) {
      var parsedFrom = new Date(filter.createdFrom + 'T00:00:00');
      if (!isNaN(parsedFrom.getTime())) start = parsedFrom;
    }
    if (filter.createdTo) {
      var parsedTo = new Date(filter.createdTo + 'T23:59:59.999');
      if (!isNaN(parsedTo.getTime())) end = parsedTo;
    }
  }
  return { start: start, end: end };
}

function makeRangeFilter(fromRaw, toRaw) {
  var from = String(fromRaw || '').trim();
  var to = String(toRaw || '').trim();
  if (!from && !to) return null;
  var range = {};
  if (from !== '') {
    var fromNum = Number(from);
    if (Number.isFinite(fromNum)) range.$gte = fromNum;
  }
  if (to !== '') {
    var toNum = Number(to);
    if (Number.isFinite(toNum)) range.$lte = toNum;
  }
  return Object.keys(range).length ? range : null;
}

function buildFilterQueryString(filter) {
  var params = [];
  if (filter.keyword) params.push('keyword=' + encodeURIComponent(filter.keyword));
  if (filter.stockFrom) params.push('stockFrom=' + encodeURIComponent(filter.stockFrom));
  if (filter.stockTo) params.push('stockTo=' + encodeURIComponent(filter.stockTo));
  if (filter.created !== 'all') params.push('created=' + encodeURIComponent(filter.created));
  if (filter.created === 'custom' && filter.createdFrom) {
    params.push('createdFrom=' + encodeURIComponent(filter.createdFrom));
  }
  if (filter.created === 'custom' && filter.createdTo) {
    params.push('createdTo=' + encodeURIComponent(filter.createdTo));
  }
  if (filter.status === 'inactive') params.push('status=inactive');
  else if (filter.status === 'all') params.push('status=all');
  return params.join('&');
}

function normalizePayload(body) {
  body = body || {};
  return {
    ma_vat_chua: String(body.ma_vat_chua || '').trim(),
    ten_vat_chua: String(body.ten_vat_chua || '').trim(),
    so_luong_ton: Math.max(0, Number(body.so_luong_ton || 0)),
    trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
  };
}

function parseVatChuaStockRows(raw) {
  var parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch (_) { parsed = []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(function(row) {
    return {
      vat_chua_id: normalizeObjectId(row && row.vat_chua_id),
      so_luong: Math.floor(Number(row && (row.so_luong ?? row.qty) || 0)),
      so_luong_thuc_te: Math.floor(Number(row && row.so_luong_thuc_te || 0)),
      gia_von: Math.max(0, Number(row && row.gia_von || 0)),
      ghi_chu: String(row && row.ghi_chu || '').trim()
    };
  }).filter(function(row) {
    return row.vat_chua_id;
  });
}

async function makeVatChuaCode(storeId) {
  var counterKey = 'vat_chua_' + String(storeId || 'global');
  for (var i = 0; i < 20; i += 1) {
    var counter = await Counter.findOneAndUpdate(
      { _id: counterKey },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' }
    ).lean();
    var code = 'VC' + String(counter.seq || 1).padStart(6, '0');
    var query = { ma_vat_chua: code };
    if (storeId) query.cua_hang_id = storeId;
    var existed = await VatChua.exists(query);
    if (!existed) return code;
  }
  return 'VC' + String(Date.now()).slice(-10);
}

function applyStatusFilter(query, filter) {
  if (!filter) return;
  if (filter.status === 'inactive') {
    query.trang_thai = 'inactive';
  } else if (filter.status === 'active') {
    query.trang_thai = 'active';
  }
}

async function loadSuppliersForStore(storeId) {
  if (!storeId) return [];
  var query = { trang_thai: 'active' };
  query.$or = [
    { cua_hang_id: storeId },
    { cua_hang_id: { $exists: false } },
    { cua_hang_id: null }
  ];
  return NhaCungCap.find(query).sort({ ten_ncc: 1, ma_ncc: 1 }).select('ten_ncc ma_ncc').lean();
}

async function loadCustomersForStore(storeId) {
  if (!storeId) return [];
  var query = { trang_thai: 'active' };
  query.$or = [
    { cua_hang_id: storeId },
    { cua_hang_id: { $exists: false } },
    { cua_hang_id: null }
  ];
  return KhachHang.find(query)
    .sort({ ten_khach_hang: 1, ma_khach_hang: 1 })
    .select('ten_khach_hang ma_khach_hang sdt')
    .lean();
}

async function loadActiveVatChuaForStore(storeId) {
  if (!storeId) return [];
  return VatChua.find({ cua_hang_id: storeId, trang_thai: 'active' })
    .sort({ ten_vat_chua: 1, ma_vat_chua: 1 })
    .select('ma_vat_chua ten_vat_chua so_luong_ton')
    .lean();
}

async function resolveOpenDetailVatChuaId(storeId, docIdRaw, docKind) {
  var docId = normalizeObjectId(docIdRaw);
  if (!docId || !storeId) return '';
  var Model = docKind === 'xuat' ? XuatVatChua : NhapVatChua;
  var doc = await Model.findOne({ _id: docId, cua_hang_id: storeId })
    .select('items.vat_chua_id')
    .lean();
  if (!doc || !Array.isArray(doc.items) || !doc.items.length) return '';
  var firstLine = doc.items.find(function(line) {
    return line && line.vat_chua_id;
  }) || doc.items[0];
  return firstLine && firstLine.vat_chua_id ? String(firstLine.vat_chua_id) : '';
}

exports.index = async function(req, res, next) {
  try {
    var requestQuery = req?.query || {};
    var filter = normalizeFilterQuery(requestQuery);
    var storeId = await resolveStoreId(req);
    if (!storeId) {
      return res.render('vat-chua/index', {
        pageTitle: 'Vật chứa',
        activeMenu: 'vat-chua',
        user: req.user,
        flash: requestQuery,
        items: [],
        filter: filter,
        formatDate: formatDate,
        filterQueryString: buildFilterQueryString(filter),
        formMode: requestQuery.mode === 'create' ? 'create' : (requestQuery.mode === 'nhap' ? 'nhap' : ''),
        missingStore: true,
        suppliers: [],
        customers: [],
        activeVatChuaList: [],
        openDetailVatChuaId: '',
        pagination: {
          page: 1,
          limit: VAT_CHUA_PAGE_SIZE,
          total: 0,
          totalPages: 1,
          from: 0,
          to: 0
        }
      });
    }

    var query = { cua_hang_id: storeId };
    applyStatusFilter(query, filter);

    if (filter.keyword) {
      query.$or = [
        { ma_vat_chua: { $regex: filter.keyword, $options: 'i' } },
        { ten_vat_chua: { $regex: filter.keyword, $options: 'i' } }
      ];
    }

    var stockRange = makeRangeFilter(filter.stockFrom, filter.stockTo);
    if (stockRange) query.so_luong_ton = stockRange;

    var dateRange = getDateRange(filter);
    if (dateRange.start || dateRange.end) {
      query.created_at = {};
      if (dateRange.start) query.created_at.$gte = dateRange.start;
      if (dateRange.end) query.created_at.$lte = dateRange.end;
    }

    var items = await VatChua.find(query)
      .sort({ created_at: -1, ma_vat_chua: 1 })
      .lean();

    var avgCostMap = await loadAverageCostByVatChuaIds(
      storeId,
      items.map(function(item) { return item._id; })
    );
    items = items.map(function(item) {
      return Object.assign({}, item, {
        gia_von_trung_binh: avgCostMap[String(item._id)] || 0
      });
    });
    var totalItems = items.length;
    var totalPages = Math.max(1, Math.ceil(totalItems / VAT_CHUA_PAGE_SIZE));
    var page = parseInt(requestQuery.page, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    var start = (page - 1) * VAT_CHUA_PAGE_SIZE;
    var pageItems = items.slice(start, start + VAT_CHUA_PAGE_SIZE);

    var suppliers = await loadSuppliersForStore(storeId);
    var customers = await loadCustomersForStore(storeId);
    var activeVatChuaList = await loadActiveVatChuaForStore(storeId);
    var openDetailVatChuaId = requestQuery.xuat_vat_chua
      ? await resolveOpenDetailVatChuaId(storeId, requestQuery.xuat_vat_chua, 'xuat')
      : await resolveOpenDetailVatChuaId(storeId, requestQuery.nhap_vat_chua, 'nhap');

    res.render('vat-chua/index', {
      pageTitle: 'Vật chứa',
      activeMenu: 'vat-chua',
      user: req.user,
      flash: requestQuery,
      items: pageItems,
      filter: filter,
      formatDate: formatDate,
      filterQueryString: buildFilterQueryString(filter),
      formMode: requestQuery.mode === 'create' ? 'create' : (requestQuery.mode === 'nhap' ? 'nhap' : ''),
      missingStore: false,
      suppliers: suppliers,
      customers: customers,
      activeVatChuaList: activeVatChuaList,
      openDetailVatChuaId: openDetailVatChuaId,
      pagination: {
        page: page,
        limit: VAT_CHUA_PAGE_SIZE,
        total: totalItems,
        totalPages: totalPages,
        from: totalItems ? start + 1 : 0,
        to: Math.min(start + VAT_CHUA_PAGE_SIZE, totalItems)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.add = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.redirect('/vat-chua?mode=create&error=missing_store');

    var payload = normalizePayload(req?.body);
    if (!payload.ten_vat_chua) {
      return res.redirect('/vat-chua?mode=create&error=missing_name');
    }
    if (!payload.ma_vat_chua) {
      payload.ma_vat_chua = await makeVatChuaCode(storeId);
    }
    payload.cua_hang_id = storeId;

    await VatChua.create(payload);
    res.redirect('/vat-chua?success=created');
  } catch (error) {
    if (error && error.code === 11000) {
      return res.redirect('/vat-chua?mode=create&error=duplicate_code');
    }
    next(error);
  }
};

exports.removeSelected = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.redirect('/vat-chua?error=missing_store');

    var ids = req?.body?.ids || [];
    if (!Array.isArray(ids)) ids = [ids];
    ids = ids.map(function(item) { return normalizeObjectId(item); }).filter(Boolean);
    if (ids.length === 0) return res.redirect('/vat-chua?error=no_selection');

    await VatChua.updateMany(
      { _id: { $in: ids }, cua_hang_id: storeId },
      { $set: { trang_thai: 'inactive' } }
    );
    res.redirect('/vat-chua?success=deleted');
  } catch (error) {
    next(error);
  }
};

exports.apiDetail = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) {
      return res.status(400).type('html').send('<div class="kv-detail-panel product-detail kv-detail-error"><p>Chưa chọn cửa hàng làm việc.</p></div>');
    }
    var ctx = await loadVatChuaDetailContext(req.params && req.params.id, storeId);
    if (!ctx) {
      return res.status(404).type('html').send('<div class="kv-detail-panel product-detail kv-detail-error"><p>Không tìm thấy vật chứa.</p></div>');
    }
    ctx.formatDate = formatDate;
    res.render('vat-chua/_detail-panel', ctx);
  } catch (error) {
    next(error);
  }
};

exports.apiDocumentDetail = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) {
      return res.status(400).type('html').send('<div class="vc-doc-modal-error"><p>Chưa chọn cửa hàng làm việc.</p></div>');
    }
    var kind = String(req.params && req.params.kind || '').trim();
    var docId = req.params && req.params.id;
    var ctx = await loadVatChuaDocumentDetail(kind, docId, storeId);
    if (!ctx) {
      return res.status(404).type('html').send('<div class="vc-doc-modal-error"><p>Không tìm thấy chứng từ.</p></div>');
    }
    ctx.formatDate = formatDate;
    res.render('vat-chua/_document-modal', ctx);
  } catch (error) {
    next(error);
  }
};

exports.importStock = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.redirect('/vat-chua?mode=nhap&error=missing_store');

    var body = req && req.body ? req.body : {};
    await importDirectVatChuaFromSupplier(Object.assign({}, body, {
      cua_hang_id: storeId
    }), {
      userId: req.user && req.user._id
    });

    res.redirect('/vat-chua?success=imported');
  } catch (error) {
    var message = error && error.message ? error.message : 'import_failed';
    return res.redirect('/vat-chua?mode=nhap&error=' + encodeURIComponent(message));
  }
};

exports.apiImportEditDetail = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng làm việc.' });
    var data = await loadNhapVatChuaForEdit(req.params && req.params.id, storeId);
    return res.json({ success: true, data: data });
  } catch (error) {
    var status = error && error.statusCode ? error.statusCode : 400;
    return res.status(status).json({ success: false, message: error && error.message ? error.message : 'Không tải được phiếu nhập vật chứa.' });
  }
};

exports.apiImportUpdate = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng làm việc.' });
    var userId = req.user && req.user._id ? req.user._id : null;
    var data = await updateNhapVatChuaImport(req.params && req.params.id, req.body || {}, storeId, userId);
    return res.json({ success: true, data: data });
  } catch (error) {
    var status = error && error.statusCode ? error.statusCode : 400;
    return res.status(status).json({ success: false, message: error && error.message ? error.message : 'Không cập nhật được phiếu nhập vật chứa.' });
  }
};

exports.apiReturnEditDetail = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng làm việc.' });
    var docId = normalizeObjectId(req.params && req.params.id);
    if (!docId) return res.status(400).json({ success: false, message: 'ID phiếu xuất không hợp lệ.' });

    var doc = await XuatVatChua.findOne({ _id: docId, cua_hang_id: storeId, deleted_at: null })
      .select('loai_xuat source_type trang_thai')
      .lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu xuất vật chứa.' });

    var data = isManualPartnerExport(doc)
      ? await loadManualXuatVatChuaForEdit(docId, storeId)
      : await loadXuatVatChuaForEdit(docId, storeId);
    return res.json({ success: true, data: data });
  } catch (error) {
    var status = error && error.statusCode ? error.statusCode : 400;
    return res.status(status).json({ success: false, message: error && error.message ? error.message : 'Không tải được phiếu xuất vật chứa.' });
  }
};

exports.apiReturnUpdate = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng làm việc.' });
    var docId = normalizeObjectId(req.params && req.params.id);
    if (!docId) return res.status(400).json({ success: false, message: 'ID phiếu xuất không hợp lệ.' });

    var doc = await XuatVatChua.findOne({ _id: docId, cua_hang_id: storeId, deleted_at: null })
      .select('loai_xuat source_type trang_thai deleted_at')
      .lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu xuất vật chứa.' });

    var userId = req.user && req.user._id ? req.user._id : undefined;
    var data = isManualPartnerExport(doc)
      ? await updateManualXuatVatChua(docId, req.body || {}, storeId)
      : await updateXuatVatChuaReturn(docId, req.body || {}, storeId, userId);
    return res.json({ success: true, data: data });
  } catch (error) {
    var status = error && error.statusCode ? error.statusCode : 400;
    return res.status(status).json({ success: false, message: error && error.message ? error.message : 'Không cập nhật được phiếu xuất vật chứa.' });
  }
};

exports.apiReturnDelete = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng làm việc.' });
    var docId = normalizeObjectId(req.params && req.params.id);
    if (!docId) return res.status(400).json({ success: false, message: 'ID phiếu xuất không hợp lệ.' });

    var doc = await XuatVatChua.findOne({ _id: docId, cua_hang_id: storeId, deleted_at: null })
      .select('loai_xuat source_type trang_thai deleted_at')
      .lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu xuất vật chứa.' });

    if (isManualPartnerExport(doc)) {
      var cancelled = await cancelManualXuatVatChua(docId, storeId);
      return res.json({ success: true, data: cancelled });
    }

    var userId = req.user && req.user._id ? req.user._id : undefined;
    var data = await deleteXuatVatChuaReturn(docId, storeId, userId);
    return res.json({ success: true, data: data });
  } catch (error) {
    var status = error && error.statusCode ? error.statusCode : 400;
    return res.status(status).json({ success: false, message: error && error.message ? error.message : 'Không xóa được phiếu xuất vật chứa.' });
  }
};

exports.apiImportReturn = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng làm việc.' });

    var importId = normalizeObjectId(req.params && req.params.id);
    if (!importId) return res.status(400).json({ success: false, message: 'Phiếu nhập vật chứa không hợp lệ.' });

    var body = req && req.body ? req.body : {};
    var vatChuaId = normalizeObjectId(body.vat_chua_id);
    var qty = Math.max(0, Math.floor(Number(body.so_luong || body.qty || 0)));
    var giaTra = Math.max(0, Number(body.gia_tra || body.gia_von || 0));
    var usePaymentV2 = hasReturnPaymentV2Payload(body);
    var paymentDetail = usePaymentV2 ? extractPaymentDetail(body) : null;
    var soTienThu = usePaymentV2
      ? Math.max(0, Number(paymentDetail.tien_mat || 0) + Number(paymentDetail.chuyen_khoan || 0))
      : Math.max(0, Number(body.so_tien_thu || body.gia_tri || 0));
    var soQuyId = normalizeObjectId(body.so_quy_id);
    if (!vatChuaId || qty <= 0) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập số lượng trả hợp lệ.' });
    }
    if (giaTra <= 0) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập giá trả hợp lệ.' });
    }
    if (usePaymentV2 && paymentDetail && Number(paymentDetail.tien_tra_khach || 0) > 0) {
      return res.status(400).json({ success: false, message: 'Tiền trả khách không áp dụng khi trả vật chứa.' });
    }
    if (usePaymentV2 && paymentDetail && Number(paymentDetail.tien_mat || 0) > 0 && !normalizeObjectId(paymentDetail.so_quy_tien_mat_id)) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ tiền mặt.' });
    }
    if (usePaymentV2 && paymentDetail && Number(paymentDetail.chuyen_khoan || 0) > 0 && !normalizeObjectId(paymentDetail.so_quy_chuyen_khoan_id)) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn tài khoản chuyển khoản.' });
    }
    if (!usePaymentV2 && soTienThu > 0 && !soQuyId) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ để ghi nhận tiền thu.' });
    }

    var doc = await NhapVatChua.findOne({
      _id: importId,
      cua_hang_id: storeId,
      trang_thai: { $ne: 'cancelled' }
    }).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập vật chứa.' });

    var line = (Array.isArray(doc.items) ? doc.items : []).find(function(item) {
      return String(item && item.vat_chua_id || '') === String(vatChuaId);
    });
    if (!line) return res.status(400).json({ success: false, message: 'Phiếu nhập không có vật chứa này.' });
    var returnedRows = await XuatVatChua.find({
      cua_hang_id: storeId,
      source_type: 'manual',
      source_id: doc._id,
      trang_thai: 'active',
      'items.vat_chua_id': line.vat_chua_id
    }).select('items').lean();
    var returnedQty = returnedRows.reduce(function(sum, row) {
      var items = Array.isArray(row.items) ? row.items : [];
      return sum + items.reduce(function(lineSum, item) {
        return String(item && item.vat_chua_id || '') === String(vatChuaId)
          ? lineSum + Math.max(0, Number(item.so_luong || 0))
          : lineSum;
      }, 0);
    }, 0);
    var maxReturnQty = Math.max(0, Number(line.so_luong || 0) - returnedQty);
    if (qty > maxReturnQty) {
      return res.status(400).json({ success: false, message: 'Số lượng trả vượt số lượng còn có thể trả (' + maxReturnQty + ').' });
    }
    var returnTotal = Math.round(qty * giaTra);
    if (soTienThu > returnTotal) {
      return res.status(400).json({ success: false, message: 'Số tiền thu không được vượt tổng giá trị trả.' });
    }

    var xuatDoc = null;
    var receipt = null;
    var session = await mongoose.startSession();
    try {
      await session.withTransaction(async function() {
        xuatDoc = await createXuatVatChuaAndDecreaseStock({
          storeId: storeId,
          vatChuaId: vatChuaId,
          qty: qty,
          giaVon: giaTra,
          loaiXuat: 'tra_hang_nhap',
          doiTuongType: doc.doi_tuong_type === 'nha_cung_cap' ? 'nha_cung_cap' : 'none',
          doiTuongId: doc.doi_tuong_type === 'nha_cung_cap' ? doc.doi_tuong_id : undefined,
          doiTuongTen: doc.doi_tuong_ten || '',
          sourceType: 'manual',
          sourceId: doc._id,
          sourceCode: doc.ma_nhap_vat_chua || '',
          ghiChu: 'Trả vật chứa theo phiếu nhập ' + (doc.ma_nhap_vat_chua || '')
        }, session);

        if (
          doc.doi_tuong_type === 'nha_cung_cap'
          && String(doc.source_type || 'manual') === 'manual'
          && xuatDoc
          && returnTotal > 0
        ) {
          await applySupplierDebtForXuatVatChua(xuatDoc, {
            supplierId: doc.doi_tuong_id,
            nhapVatChuaId: doc._id,
            amount: returnTotal,
            note: 'Giảm nợ từ trả vật chứa ' + (xuatDoc.ma_xuat_vat_chua || '')
          }, session);
        }

        if (soTienThu > 0) {
          var receiptPayload = {
            loai_phieu: 'thu',
            loai_thu_chi: 'Thu tiền trả vật chứa',
            gia_tri: soTienThu,
            doi_tuong: doc.doi_tuong_ten || '',
            nhom_doi_tuong: doc.doi_tuong_type === 'nha_cung_cap' ? 'nha_cung_cap' : 'khac',
            nha_cung_cap_id: doc.doi_tuong_type === 'nha_cung_cap' ? doc.doi_tuong_id : undefined,
            doi_tuong_entity_id: doc.doi_tuong_type === 'nha_cung_cap' ? doc.doi_tuong_id : undefined,
            document_type: 'nhap_vat_chua',
            nhap_vat_chua_id: doc._id,
            ma_chung_tu_goc: xuatDoc && xuatDoc.ma_xuat_vat_chua ? xuatDoc.ma_xuat_vat_chua : (doc.ma_nhap_vat_chua || ''),
            ghi_chu: 'Thu tiền trả vật chứa theo ' + (xuatDoc && xuatDoc.ma_xuat_vat_chua ? xuatDoc.ma_xuat_vat_chua : doc.ma_nhap_vat_chua || ''),
            hach_toan: false,
            cua_hang_id: storeId,
            nguoi_tao_id: req.user && req.user._id ? req.user._id : undefined
          };
          if (usePaymentV2) {
            receiptPayload.payment_v2 = true;
            receiptPayload.chi_tiet_thanh_toan = {
              tien_mat: Number(paymentDetail.tien_mat || 0),
              so_quy_tien_mat_id: paymentDetail.so_quy_tien_mat_id || '',
              chuyen_khoan: Number(paymentDetail.chuyen_khoan || 0),
              so_quy_chuyen_khoan_id: paymentDetail.so_quy_chuyen_khoan_id || '',
              tien_tra_khach: 0
            };
            receiptPayload._paymentInfo = await buildReceiptPaymentInfo(receiptPayload, {
              cuaHangId: storeId,
              session: session
            });
          } else {
            receiptPayload.so_quy_id = soQuyId;
          }
          receipt = await taoPhieuThuChi(receiptPayload, { session: session });
        }
      });
    } finally {
      await session.endSession();
    }

    return res.json({
      success: true,
      data: {
        _id: xuatDoc && xuatDoc._id,
        ma_xuat_vat_chua: xuatDoc && xuatDoc.ma_xuat_vat_chua,
        phieu_thu_id: receipt && receipt._id,
        ma_phieu_thu: receipt && receipt.ma_phieu
      }
    });
  } catch (error) {
    var status = error && error.statusCode ? error.statusCode : 400;
    return res.status(status).json({ success: false, message: error && error.message ? error.message : 'Không trả được vật chứa.' });
  }
};

exports.stocktake = async function(req, res, next) {
  var session = null;
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng làm việc.' });

    var body = req && req.body ? req.body : {};
    var rows = parseVatChuaStockRows(body.items);
    if (!rows.length) return res.status(400).json({ success: false, message: 'Vui lòng nhập ít nhất một dòng kiểm kho.' });

    var ids = rows.map(function(row) { return row.vat_chua_id; });
    var vatChuaRows = await VatChua.find({
      _id: { $in: ids },
      cua_hang_id: storeId,
      trang_thai: 'active'
    }).select('ma_vat_chua ten_vat_chua so_luong_ton').lean();
    var map = {};
    vatChuaRows.forEach(function(row) { map[String(row._id)] = row; });

    var avgCostMap = await loadAverageCostByVatChuaIds(storeId, ids);
    var changes = rows.map(function(row) {
      var vatChua = map[row.vat_chua_id];
      if (!vatChua) return null;
      var systemQty = Math.max(0, Number(vatChua.so_luong_ton || 0));
      var actualQty = Math.max(0, row.so_luong_thuc_te);
      var diff = actualQty - systemQty;
      return {
        row: row,
        vatChua: vatChua,
        systemQty: systemQty,
        actualQty: actualQty,
        diff: diff,
        giaVon: row.gia_von > 0 ? row.gia_von : Math.max(0, Number(avgCostMap[row.vat_chua_id] || 0))
      };
    }).filter(function(item) {
      return item && item.diff !== 0;
    });

    if (!changes.length) return res.json({ success: true, message: 'Không có chênh lệch cần cân bằng.', data: { changed: 0 } });

    session = await mongoose.startSession();
    var created = [];
    await session.withTransaction(async function() {
      for (var i = 0; i < changes.length; i += 1) {
        var item = changes[i];
        var commonNote = String(body.ghi_chu || item.row.ghi_chu || '').trim();
        if (item.diff > 0) {
          var nhapDoc = await createNhapVatChuaAndIncreaseStock({
            storeId: storeId,
            vatChuaId: item.row.vat_chua_id,
            qty: item.diff,
            giaVon: item.giaVon,
            zeroCost: item.giaVon <= 0,
            loaiNhap: 'dieu_chinh_tang',
            sourceType: 'manual',
            ghiChu: commonNote || ('Kiểm kho vật chứa tăng từ ' + item.systemQty + ' lên ' + item.actualQty)
          }, session);
          created.push({ type: 'nhap', id: String(nhapDoc._id), code: nhapDoc.ma_nhap_vat_chua || '', qty: item.diff });
        } else {
          var xuatDoc = await createXuatVatChuaAndDecreaseStock({
            storeId: storeId,
            vatChuaId: item.row.vat_chua_id,
            qty: Math.abs(item.diff),
            giaVon: item.giaVon,
            loaiXuat: 'dieu_chinh_giam',
            sourceType: 'manual',
            ghiChu: commonNote || ('Kiểm kho vật chứa giảm từ ' + item.systemQty + ' xuống ' + item.actualQty)
          }, session);
          created.push({ type: 'xuat', id: String(xuatDoc._id), code: xuatDoc.ma_xuat_vat_chua || '', qty: Math.abs(item.diff) });
        }
      }
    });

    return res.json({ success: true, message: 'Đã cân bằng tồn vật chứa.', data: { changed: changes.length, created: created } });
  } catch (error) {
    var status = error && error.statusCode ? error.statusCode : 400;
    return res.status(status).json({ success: false, message: error && error.message ? error.message : 'Không kiểm kho được vật chứa.' });
  } finally {
    if (session) await session.endSession();
  }
};

exports.destroyStock = async function(req, res, next) {
  var session = null;
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng làm việc.' });

    var body = req && req.body ? req.body : {};
    var rows = parseVatChuaStockRows(body.items).filter(function(row) {
      return row.so_luong > 0;
    });
    if (!rows.length) return res.status(400).json({ success: false, message: 'Vui lòng nhập ít nhất một số lượng xuất hủy.' });

    var ids = rows.map(function(row) { return row.vat_chua_id; });
    var avgCostMap = await loadAverageCostByVatChuaIds(storeId, ids);
    session = await mongoose.startSession();
    var created = [];
    await session.withTransaction(async function() {
      for (var i = 0; i < rows.length; i += 1) {
        var row = rows[i];
        var xuatDoc = await createXuatVatChuaAndDecreaseStock({
          storeId: storeId,
          vatChuaId: row.vat_chua_id,
          qty: row.so_luong,
          giaVon: row.gia_von > 0 ? row.gia_von : Math.max(0, Number(avgCostMap[row.vat_chua_id] || 0)),
          loaiXuat: 'hong_mat',
          sourceType: 'manual',
          ghiChu: String(body.ly_do_huy || body.ghi_chu || row.ghi_chu || 'Xuất hủy vật chứa').trim()
        }, session);
        created.push({ id: String(xuatDoc._id), code: xuatDoc.ma_xuat_vat_chua || '', qty: row.so_luong });
      }
    });

    return res.json({ success: true, message: 'Đã xuất hủy vật chứa.', data: { changed: rows.length, created: created } });
  } catch (error) {
    var status = error && error.statusCode ? error.statusCode : 400;
    return res.status(status).json({ success: false, message: error && error.message ? error.message : 'Không xuất hủy được vật chứa.' });
  } finally {
    if (session) await session.endSession();
  }
};

exports.exportStock = async function(req, res, next) {
  var session = null;
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng làm việc.' });

    var body = req && req.body ? req.body : {};
    var vatChuaId = normalizeObjectId(body.vat_chua_id);
    var qty = Math.max(0, Math.floor(Number(body.so_luong || body.qty || 0)));
    var customerId = normalizeObjectId(body.khach_hang_id);
    var supplierId = normalizeObjectId(body.nha_cung_cap_id);
    var ghiChu = String(body.ghi_chu || '').trim();

    if (!vatChuaId) return res.status(400).json({ success: false, message: 'Vui lòng chọn vật chứa.' });
    if (qty <= 0) return res.status(400).json({ success: false, message: 'Vui lòng nhập số lượng xuất hợp lệ.' });
    if (customerId && supplierId) {
      return res.status(400).json({ success: false, message: 'Chỉ chọn một đối tượng: khách hàng hoặc nhà cung cấp.' });
    }
    if (!customerId && !supplierId) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn khách hàng hoặc nhà cung cấp.' });
    }

    var doiTuongType = 'none';
    var doiTuongId = undefined;
    var doiTuongTen = '';
    var loaiXuat = 'khac';

    if (customerId) {
      var customer = await KhachHang.findOne({
        _id: customerId,
        trang_thai: 'active',
        $or: [
          { cua_hang_id: storeId },
          { cua_hang_id: { $exists: false } },
          { cua_hang_id: null }
        ]
      }).select('ten_khach_hang ma_khach_hang').lean();
      if (!customer) return res.status(400).json({ success: false, message: 'Khách hàng không hợp lệ.' });
      doiTuongType = 'khach_hang';
      doiTuongId = customer._id;
      doiTuongTen = customer.ten_khach_hang || customer.ma_khach_hang || '';
      loaiXuat = 'ban_hang';
    } else {
      var supplier = await NhaCungCap.findOne({
        _id: supplierId,
        trang_thai: 'active',
        $or: [
          { cua_hang_id: storeId },
          { cua_hang_id: { $exists: false } },
          { cua_hang_id: null }
        ]
      }).select('ten_ncc ma_ncc').lean();
      if (!supplier) return res.status(400).json({ success: false, message: 'Nhà cung cấp không hợp lệ.' });
      doiTuongType = 'nha_cung_cap';
      doiTuongId = supplier._id;
      doiTuongTen = supplier.ten_ncc || supplier.ma_ncc || '';
      loaiXuat = 'khac';
    }

    session = await mongoose.startSession();
    var xuatDoc = null;
    await session.withTransaction(async function() {
      xuatDoc = await createXuatVatChuaAndDecreaseStock({
        storeId: storeId,
        vatChuaId: vatChuaId,
        qty: qty,
        loaiXuat: loaiXuat,
        doiTuongType: doiTuongType,
        doiTuongId: doiTuongId,
        doiTuongTen: doiTuongTen,
        sourceType: 'manual',
        ghiChu: ghiChu || ('Xuất vật chứa cho ' + doiTuongTen)
      }, session);
      if (doiTuongType === 'nha_cung_cap' && xuatDoc && Number(xuatDoc.tong_tien || 0) > 0) {
        await applySupplierDebtForXuatVatChua(xuatDoc, {
          supplierId: doiTuongId,
          amount: Number(xuatDoc.tong_tien || 0)
        }, session);
      }
    });

    return res.json({
      success: true,
      message: 'Đã xuất vật chứa.',
      data: {
        id: xuatDoc && xuatDoc._id ? String(xuatDoc._id) : '',
        code: xuatDoc && xuatDoc.ma_xuat_vat_chua ? xuatDoc.ma_xuat_vat_chua : '',
        qty: qty
      }
    });
  } catch (error) {
    var status = error && error.statusCode ? error.statusCode : 400;
    return res.status(status).json({
      success: false,
      message: error && error.message ? error.message : 'Không xuất được vật chứa.'
    });
  } finally {
    if (session) await session.endSession();
  }
};

exports.previewImportTrash = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng làm việc.' });
    var ids = req?.body?.nhap_vat_chua_ids || req?.body?.ids || req?.body?.id || [];
    var preview = await previewNhapVatChuaTrash(ids, storeId);
    return res.json({ success: true, data: preview });
  } catch (error) {
    var status = error && error.statusCode ? error.statusCode : 400;
    return res.status(status).json({ success: false, message: error && error.message ? error.message : 'Không kiểm tra được dữ liệu liên quan.' });
  }
};

exports.moveImportToTrash = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng làm việc.' });
    var ids = req?.body?.nhap_vat_chua_ids || req?.body?.ids || req?.body?.id || [];
    var userId = req.user && req.user._id ? req.user._id : null;
    var result = await moveNhapVatChuaToTrash(ids, storeId, userId);
    return res.json({ success: true, data: result });
  } catch (error) {
    var status = error && error.statusCode ? error.statusCode : 400;
    return res.status(status).json({ success: false, message: error && error.message ? error.message : 'Không đưa được phiếu nhập vật chứa vào thùng rác.' });
  }
};
