var mongoose = require('mongoose');
var path = require('path');
var { PhieuNhap, CTPhieuNhap, NhaCungCap, Kho, CuaHang, HangHoa, TonKho, TonKhoLo, TonKhoLoQuyCach, LoHang, LichSuKho, CongNoNhaCungCap, NhomHang, DonViTinh, SoQuy, DiaChiNcc, VatChua, NhapVatChua } = require('../models/kiot.model');
var {
  importVatChuaWithPurchase,
  cancelNhapVatChuaBySource,
  parseVatChuaImportInput,
  assertVatChuaImportInput
} = require('../services/vatChuaImport.service');
var { taoPhieuThuChi } = require('../services/soQuy.service');
var { buildReceiptPaymentInfo } = require('../services/paymentCashBook.service');
var { syncTonKhoSauQuyCach } = require('../services/kho.service');
var purchaseService = require('../services/purchase.service');
var { mergePurchasesInSession } = require('../services/purchaseMerge.service');
var pdfService = require('../services/pdf.service');
var { loadPurchasesLinkedVatChuaMap, loadPurchaseLinkedVatChuaLines } = require('../services/vatChuaDetail.service');

function disabledTrashOperation() {
  var error = new Error('Chuc nang xoa/dua vao thung rac da duoc tat.');
  error.statusCode = 410;
  throw error;
}

var previewPurchaseTrash = disabledTrashOperation;
var movePurchasesToTrash = disabledTrashOperation;

var PURCHASE_DEBT_WARN_DEFAULT_DAYS = 10;
var NHAP_HANG_PAGE_SIZE = 10;

function activePurchaseDataFilter(extra) {
  var base = extra || {};
  return {
    $and: [
      base,
      {
        $or: [
          { trang_thai_du_lieu: 'active' },
          { trang_thai_du_lieu: { $exists: false } },
          { trang_thai_du_lieu: null },
          { trang_thai_du_lieu: '' }
        ]
      }
    ]
  };
}

function activePurchaseReturnDataFilter(extra) {
  var base = extra || {};
  return {
    $and: [
      base,
      {
        $or: [
          { trang_thai_du_lieu: 'active' },
          { trang_thai_du_lieu: { $exists: false } },
          { trang_thai_du_lieu: null },
          { trang_thai_du_lieu: '' }
        ]
      }
    ]
  };
}

function hasFilterQueryValue(value) {
  return String(value ?? '').trim() !== '';
}

function parseFilterMoney(value) {
  var amount = Number(String(value ?? '').replace(/\./g, '').replace(/,/g, '').trim());
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.floor(amount);
}

function normalizeFilterMoneyField(value) {
  var raw = String(value || '').trim();
  if (raw === '') return '';
  var amount = parseFilterMoney(raw);
  if (!Number.isFinite(amount) || amount < 0) return '';
  return String(amount);
}

function formatFilterMoneyDisplay(value) {
  if (value === '' || value == null) return '';
  var amount = parseFilterMoney(value);
  if (!Number.isFinite(amount)) return '';
  return amount.toLocaleString('vi-VN');
}

function purchaseRemainDue(ticket) {
  if (!ticket) return 0;
  if (ticket.con_no_ncc != null && ticket.con_no_ncc !== '') {
    return Math.max(0, Number(ticket.con_no_ncc) || 0);
  }
  var payable = Number(ticket.can_tra_ncc ?? ticket.tong_tien ?? 0) || 0;
  var paid = Number(ticket.da_tra_ncc ?? 0) || 0;
  return Math.max(0, payable - paid);
}

function normalizePurchaseDebtWarnSettings(filter) {
  filter = filter || {};
  var warnMinDaysRaw = parseInt(String(filter.warnMinDays != null && filter.warnMinDays !== '' ? filter.warnMinDays : PURCHASE_DEBT_WARN_DEFAULT_DAYS), 10);
  return {
    warnOnly: String(filter.warnOnly || '') === '1',
    warnMinDays: Number.isFinite(warnMinDaysRaw) && warnMinDaysRaw >= 0 ? warnMinDaysRaw : PURCHASE_DEBT_WARN_DEFAULT_DAYS,
    warnMinAmount: hasFilterQueryValue(filter.warnMinAmount) ? parseFilterMoney(filter.warnMinAmount) : 0
  };
}

function enrichPurchaseDebtInfo(slip) {
  if (!slip) return;
  var debt = purchaseRemainDue(slip);
  var ts = new Date(slip.ngay_nhap || slip.created_at || 0).getTime();
  slip.so_ngay_no = debt > 0 && ts > 0 ? Math.max(0, Math.floor((Date.now() - ts) / 86400000)) : null;
}

function evaluatePurchaseDebtWarning(slip, settings) {
  var debt = purchaseRemainDue(slip);
  if (debt <= 0) return false;
  var days = Number(slip.so_ngay_no);
  var hasDays = Number.isFinite(days);
  var meetsDays = hasDays && days >= Number(settings.warnMinDays || PURCHASE_DEBT_WARN_DEFAULT_DAYS);
  var minAmount = Number(settings.warnMinAmount || 0);
  var meetsAmount = minAmount > 0 && debt >= minAmount;
  if (minAmount > 0 && settings.warnMinDays >= 0) return meetsDays || meetsAmount;
  if (minAmount > 0) return meetsAmount;
  return meetsDays;
}

function applyPurchaseDebtWarning(slip, settings) {
  if (!slip) return;
  slip.debt_warning = evaluatePurchaseDebtWarning(slip, settings);
}

function filterPurchasesByDebtWarning(slips, settings) {
  if (!settings || !settings.warnOnly) return slips;
  return (slips || []).filter(function(slip) {
    return evaluatePurchaseDebtWarning(slip, settings);
  });
}

function normalizeNhapHangFilter(query) {
  query = query || {};
  var statuses = Array.isArray(query.trang_thai) ? query.trang_thai : (query.trang_thai ? [query.trang_thai] : []);
  statuses = statuses.map(function(x) { return String(x || '').trim(); }).filter(Boolean);
  statuses = statuses.filter(function(x) { return ['completed', 'cancelled'].indexOf(x) >= 0; });
  if (!statuses.length) statuses = ['completed'];
  var sort = String(query.sort || query.sort_cong_no || 'newest').trim();
  if (['newest', 'oldest', 'debt_high', 'debt_low', 'oldest_debt'].indexOf(sort) < 0) sort = 'newest';
  var supplierId = String(query.nha_cung_cap_id || '').trim();
  if (!mongoose.Types.ObjectId.isValid(supplierId)) supplierId = '';
  var warnMinDaysRaw = parseInt(String(query.warnMinDays != null && query.warnMinDays !== '' ? query.warnMinDays : PURCHASE_DEBT_WARN_DEFAULT_DAYS), 10);
  var warnMinDays = Number.isFinite(warnMinDaysRaw) && warnMinDaysRaw >= 0 ? warnMinDaysRaw : PURCHASE_DEBT_WARN_DEFAULT_DAYS;
  return {
    q: String(query.q || '').trim(),
    statuses: statuses,
    nha_cung_cap_id: supplierId,
    sort: sort,
    warnOnly: String(query.warnOnly || '') === '1' ? '1' : '',
    warnMinDays: String(warnMinDays),
    warnMinAmount: normalizeFilterMoneyField(query.warnMinAmount)
  };
}

function parsePurchasePage(query) {
  var page = parseInt(query && query.page, 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function buildPurchaseListQueryString(filter, page) {
  var params = new URLSearchParams();
  filter = filter || {};
  if (filter.q) params.set('q', filter.q);
  (filter.statuses || []).forEach(function(status) {
    params.append('trang_thai', status);
  });
  if (filter.nha_cung_cap_id) params.set('nha_cung_cap_id', filter.nha_cung_cap_id);
  if (filter.sort && filter.sort !== 'newest') params.set('sort', filter.sort);
  if (filter.warnOnly === '1') params.set('warnOnly', '1');
  if (filter.warnMinDays && String(filter.warnMinDays) !== String(PURCHASE_DEBT_WARN_DEFAULT_DAYS)) {
    params.set('warnMinDays', filter.warnMinDays);
  }
  if (hasFilterQueryValue(filter.warnMinAmount)) params.set('warnMinAmount', filter.warnMinAmount);
  if (page > 1) params.set('page', String(page));
  return params.toString();
}

function purchaseSortSpec(sort) {
  if (sort === 'oldest') return { ngay_nhap: 1, created_at: 1 };
  if (sort === 'debt_high') return { con_no_ncc: -1, ngay_nhap: -1, created_at: -1 };
  if (sort === 'debt_low') return { con_no_ncc: 1, ngay_nhap: -1, created_at: -1 };
  return { ngay_nhap: -1, created_at: -1 };
}

async function loadSortedPurchases(query, sort) {
  if (sort === 'oldest_debt') {
    var matchQuery = Object.assign({}, query);
    if (matchQuery.cua_hang_id && mongoose.Types.ObjectId.isValid(String(matchQuery.cua_hang_id))) {
      matchQuery.cua_hang_id = new mongoose.Types.ObjectId(String(matchQuery.cua_hang_id));
    }
    var rows = await PhieuNhap.aggregate([
      { $match: matchQuery },
      { $addFields: { debt_sort: { $cond: [{ $gt: ['$con_no_ncc', 0] }, 0, 1] } } },
      { $sort: { debt_sort: 1, ngay_nhap: 1, created_at: 1 } },
      { $project: { debt_sort: 0 } }
    ]);
    await PhieuNhap.populate(rows, [
      { path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' },
      { path: 'nguoi_tao_id', select: 'ho_ten email' },
      { path: 'kho_id', select: 'ten_kho ma_kho' }
    ]);
    return rows;
  }
  return PhieuNhap.find(query)
    .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
    .populate({ path: 'nguoi_tao_id', select: 'ho_ten email' })
    .populate({ path: 'kho_id', select: 'ten_kho ma_kho' })
    .sort(purchaseSortSpec(sort))
    .lean();
}

function toStartOfMonth() {
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function toEndOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

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

function statusLabel(value) {
  if (value === 'draft') return 'Phi\u1ebfu t\u1ea1m';
  if (value === 'cancelled') return '\u0110\u00e3 h\u1ee7y';
  if (value === 'merged') return '\u0110\u00e3 g\u1ed9p';
  return '\u0110\u00e3 nh\u1eadp h\u00e0ng';
}

function paymentMethodLabel(value) {
  if (value === 'tien_mat') return 'Ti\u1ec1n m\u1eb7t';
  if (value === 'chuyen_khoan') return 'Chuy\u1ec3n kho\u1ea3n';
  return 'C\u00f4ng n\u1ee3';
}

async function makePhieuNhapCode() {
  var last = await PhieuNhap.findOne({ ma_phieu_nhap: /^PN\d+$/ }).sort({ ma_phieu_nhap: -1 }).lean();
  var nextNumber = 1;
  if (last && last.ma_phieu_nhap) {
    nextNumber = Number(String(last.ma_phieu_nhap).replace(/\D/g, '')) + 1;
  }
  return 'PN' + String(nextNumber).padStart(6, '0');
}

async function makeSupplierCode() {
  var last = await NhaCungCap.findOne({ ma_ncc: /^NCC\d+$/ }).sort({ ma_ncc: -1 }).lean();
  var nextNumber = 1;
  if (last && last.ma_ncc) {
    nextNumber = Number(String(last.ma_ncc).replace(/\D/g, '')) + 1;
  }
  return 'NCC' + String(nextNumber).padStart(4, '0');
}

async function makeProductCode() {
  var last = await HangHoa.findOne({ ma_hang: /^HH\d+$/ }).sort({ ma_hang: -1 }).lean();
  var nextNumber = 1;
  if (last && last.ma_hang) {
    nextNumber = Number(String(last.ma_hang).replace(/\D/g, '')) + 1;
  }
  return 'HH' + String(nextNumber).padStart(6, '0');
}

async function makeLoCode() {
  var last = await LoHang.findOne({ ma_lo: /^LO\d+$/ }).sort({ ma_lo: -1 }).lean();
  var nextNumber = 1;
  if (last && last.ma_lo) {
    nextNumber = Number(String(last.ma_lo).replace(/\D/g, '')) + 1;
  }
  return 'LO' + String(nextNumber).padStart(6, '0');
}

async function resolveStoreId(req) {
  var sessionStoreId = req && req.session ? String(req.session.cua_hang_id || '').trim() : '';
  if (sessionStoreId && mongoose.Types.ObjectId.isValid(sessionStoreId)) return sessionStoreId;
  var userStoreId = req && req.user ? String(req.user.cua_hang_id || '').trim() : '';
  if (userStoreId && mongoose.Types.ObjectId.isValid(userStoreId)) return userStoreId;
  var activeStore = await CuaHang.findOne({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
  return activeStore ? String(activeStore._id) : '';
}

exports.index = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var filter = normalizeNhapHangFilter(req.query);
    var debtWarnSettings = normalizePurchaseDebtWarnSettings(filter);
    var query = {};
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
    if (filter.q) query.ma_phieu_nhap = { $regex: filter.q, $options: 'i' };
    query.trang_thai = { $in: filter.statuses };
    if (filter.nha_cung_cap_id) query.nha_cung_cap_id = filter.nha_cung_cap_id;

    query = activePurchaseDataFilter(query);

    var importSlips = await loadSortedPurchases(query, filter.sort);

    importSlips.forEach(function(slip) {
      enrichPurchaseDebtInfo(slip);
      applyPurchaseDebtWarning(slip, debtWarnSettings);
    });
    importSlips = filterPurchasesByDebtWarning(importSlips, debtWarnSettings);
    var pageSize = NHAP_HANG_PAGE_SIZE;
    var totalSlips = importSlips.length;
    var page = parsePurchasePage(req.query);
    var totalPages = Math.max(1, Math.ceil(totalSlips / pageSize));
    if (page > totalPages) page = totalPages;
    var skip = (page - 1) * pageSize;
    importSlips = importSlips.slice(skip, skip + pageSize);

    var slipIds = importSlips.map(function(s) { return s._id; });
    var detailRows = [];
    if (slipIds.length > 0) {
      detailRows = await CTPhieuNhap.find({ phieu_nhap_id: { $in: slipIds } })
        .populate({ path: 'hang_hoa_id' })
        .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi' })
        .populate({ path: 'lo_hang_id' })
        .sort({ created_at: 1 })
        .lean();
    }
    var detailsBySlip = detailRows.reduce(function(map, row) {
      var key = String(row.phieu_nhap_id);
      if (!map[key]) map[key] = [];
      map[key].push(row);
      return map;
    }, {});

    var thuChiBySlip = {};
    if (mongoose.models.PhieuThuChi && slipIds.length > 0) {
      var thuChiRows = await mongoose.models.PhieuThuChi.find({ phieu_nhap_id: { $in: slipIds } })
        .populate({ path: 'nguoi_tao_id', select: 'ho_ten email' })
        .populate({ path: 'so_quy_id', select: 'ten_so_quy loai' })
        .sort({ ngay_lap: -1, created_at: -1 })
        .lean();
      thuChiBySlip = thuChiRows.reduce(function(map, row) {
        var key = String(row.phieu_nhap_id);
        if (!map[key]) map[key] = [];
        map[key].push(row);
        return map;
      }, {});
    }

    var vatChuaBySlip = await loadPurchasesLinkedVatChuaMap(slipIds, storeId);

    var returnBySlip = {};
    if (slipIds.length > 0 && mongoose.models.PhieuTraHangNhap) {
      var returnRows = await mongoose.models.PhieuTraHangNhap.find(activePurchaseReturnDataFilter({
        phieu_nhap_id: { $in: slipIds },
        trang_thai: { $ne: 'cancelled' }
      })).select('phieu_nhap_id ma_phieu_tra_nhap').lean();
      returnRows.forEach(function(row) {
        var slipKey = String(row.phieu_nhap_id || '');
        if (slipKey && !returnBySlip[slipKey]) returnBySlip[slipKey] = row;
      });
    }

    importSlips = importSlips.map(function(slip) {
      var key = String(slip._id);
      var rows = detailsBySlip[key] || [];
      var paymentRows = (thuChiBySlip[key] || []).map(function(x) {
        var chiTiet = x.chi_tiet_thanh_toan || {};
        var tm = Number(chiTiet.tien_mat || 0);
        var ck = Number(chiTiet.chuyen_khoan || 0);
        var traKhach = Number(chiTiet.tien_tra_khach || 0);
        var chiTietParts = [];
        if (tm > 0) chiTietParts.push('TM ' + tm.toLocaleString('vi-VN'));
        if (ck > 0) chiTietParts.push('CK ' + ck.toLocaleString('vi-VN'));
        if (traKhach > 0) chiTietParts.push('Trả KH ' + traKhach.toLocaleString('vi-VN'));
        return {
          _id: x._id,
          ma_phieu: x.ma_phieu || x.ma_thu_chi || '--',
          thoi_gian: x.ngay_lap || x.created_at,
          nguoi_tao: x?.nguoi_tao_id?.ho_ten || x?.nguoi_tao_id?.email || '--',
          phuong_thuc: paymentMethodLabel(x.phuong_thuc_thanh_toan || x.phuong_thuc || slip.phuong_thuc_thanh_toan),
          trang_thai: 'Đã thanh toán',
          tien_chi: Number(x.so_tien || x.gia_tri || 0),
          so_quy: chiTietParts.length ? chiTietParts.join(' · ') : (x?.so_quy_id?.ten_so_quy || '--'),
          ghi_chu: x.ghi_chu || ''
        };
      });
      if (paymentRows.length === 0 && Number(slip.da_tra_ncc || 0) > 0) {
        paymentRows.push({
          ma_phieu: 'TT' + String(slip.ma_phieu_nhap || ''),
          thoi_gian: slip.ngay_nhap || slip.created_at,
          nguoi_tao: slip?.nguoi_tao_id?.ho_ten || slip?.nguoi_tao_id?.email || '--',
          phuong_thuc: paymentMethodLabel(slip.phuong_thuc_thanh_toan),
          trang_thai: 'Đã thanh toán',
          tien_chi: Number(slip.da_tra_ncc || 0),
          so_quy: '--',
          ghi_chu: 'Thanh toán khi tạo phiếu'
        });
      }
      var tongMatHang = rows.length;
      var tongSoLuong = rows.reduce(function(sum, r) { return sum + Number(r.so_luong || 0); }, 0);
      return Object.assign({}, slip, {
        detail_rows: rows,
        payment_rows: paymentRows,
        vat_chua_lines: vatChuaBySlip[key] || [],
        phieu_tra_hang_nhap: returnBySlip[key] || null,
        has_return: Boolean(returnBySlip[key]),
        detail_summary: {
          tong_mat_hang: tongMatHang,
          tong_so_luong: tongSoLuong
        }
      });
    });

    var suppliers = await NhaCungCap.find(
      storeId && mongoose.Types.ObjectId.isValid(storeId) ? { cua_hang_id: storeId } : {}
    )
      .sort({ ten_ncc: 1 })
      .lean();
    if (suppliers.length === 0 && storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      suppliers = await NhaCungCap.find({})
        .sort({ ten_ncc: 1 })
        .lean();
    }
    var warehouses = await Kho.find(
      storeId && mongoose.Types.ObjectId.isValid(storeId) ? { cua_hang_id: storeId } : {}
    )
      .sort({ ten_kho: 1, ma_kho: 1 })
      .lean();
    var cashBooks = await SoQuy.find({ trang_thai: 'active' })
      .sort({ ten_so_quy: 1 })
      .lean();

    var vatChuaList = [];
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      vatChuaList = await VatChua.find({ cua_hang_id: storeId, trang_thai: 'active' })
        .sort({ ten_vat_chua: 1, ma_vat_chua: 1 })
        .select('ma_vat_chua ten_vat_chua so_luong_ton')
        .lean();
    }

    res.render('nhap-hang/index', {
      pageTitle: 'Nhập hàng',
      activeMenu: 'mua-hang',
      user: req.user,
      flash: req.query || {},
      filter: filter,
      debtWarnDefaultDays: PURCHASE_DEBT_WARN_DEFAULT_DAYS,
      formatFilterMoney: formatFilterMoneyDisplay,
      suppliers: suppliers,
      warehouses: warehouses,
      cashBooks: cashBooks,
      vatChuaList: vatChuaList,
      importSlips: importSlips,
      formatDate: formatDate,
      statusLabel: statusLabel,
      paymentMethodLabel: paymentMethodLabel,
      pagination: {
        total: totalSlips,
        page: page,
        limit: pageSize,
        totalPages: totalPages,
        from: totalSlips === 0 ? 0 : skip + 1,
        to: Math.min(skip + pageSize, totalSlips)
      },
      buildPurchasePageUrl: function(pageNumber) {
        var qs = buildPurchaseListQueryString(filter, pageNumber);
        return '/nhap-hang' + (qs ? '?' + qs : '');
      }
    });
  } catch (error) {
    next(error);
  }
};

function normalizeItemsPayload(raw) {
  if (!raw) return [];
  var parsed = null;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = null;
    }
  } else {
    parsed = raw;
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(function(x) {
      var lineDiscountType = String(x?.kieu_giam_gia_dong || 'vnd').trim();
      if (['vnd', 'percent'].indexOf(lineDiscountType) < 0) lineDiscountType = 'vnd';
      return {
        hang_hoa_id: String(x?.hang_hoa_id || '').trim(),
        gia_tri_thuoc_tinh_id: String(x?.gia_tri_thuoc_tinh_id || '').trim(),
        so_luong: Number(x?.so_luong || 0),
        don_gia: Number(x?.don_gia || 0),
        giam_gia_dong: Number(x?.giam_gia_dong != null ? x?.giam_gia_dong : x?.giam_gia || 0),
        kieu_giam_gia_dong: lineDiscountType,
        lo_info: x?.lo_info && typeof x.lo_info === 'object'
          ? {
            ma_lo: String(x.lo_info.ma_lo || '').trim(),
            ten_lo: String(x.lo_info.ten_lo || '').trim(),
            ngay_nhap: String(x.lo_info.ngay_nhap || '').trim(),
            han_su_dung: String(x.lo_info.han_su_dung || '').trim(),
            ghi_chu: String(x.lo_info.ghi_chu || '').trim()
          }
          : null
      };
    })
    .filter(function(x) {
      return mongoose.Types.ObjectId.isValid(x.hang_hoa_id)
        && Number.isFinite(x.so_luong)
        && x.so_luong > 0
        && Number.isFinite(x.don_gia)
        && x.don_gia >= 0;
    })
    .map(function(x) {
      x.so_luong = Math.floor(x.so_luong);
      if (!mongoose.Types.ObjectId.isValid(x.gia_tri_thuoc_tinh_id)) x.gia_tri_thuoc_tinh_id = '';
      if (!Number.isFinite(x.don_gia) || x.don_gia < 0) x.don_gia = 0;
      if (!Number.isFinite(x.giam_gia_dong) || x.giam_gia_dong < 0) x.giam_gia_dong = 0;
      if (x.kieu_giam_gia_dong === 'percent' && x.giam_gia_dong > 100) x.giam_gia_dong = 100;
      return x;
    });
}

function parseDateOnly(value) {
  var raw = String(value || '').trim();
  if (!raw) return undefined;
  var d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function normalizeEditQuyCachItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(function(item) {
      var qty = Math.max(0, Number(item && item.so_luong || 0));
      var price = parseMoneyInput(item && (item.don_gia_nhap != null ? item.don_gia_nhap : item.don_gia));
      var name = String(item && (item.ten_quy_cach || item.ten_thuoc_tinh) || '').trim();
      return {
        ten_quy_cach: name,
        ten_thuoc_tinh: name,
        so_luong: qty,
        don_gia_nhap: price,
        gia_von: price,
        thanh_tien: Math.floor(qty * price),
        ghi_chu: String(item && item.ghi_chu || '').trim()
      };
    })
    .filter(function(item) {
      return item.ten_quy_cach || item.so_luong > 0 || item.don_gia_nhap > 0 || item.ghi_chu;
    });
}

function sumEditQuyCachQty(items) {
  return normalizeEditQuyCachItems(items).reduce(function(sum, item) {
    return sum + Number(item.so_luong || 0);
  }, 0);
}

function sumEditQuyCachAmount(items) {
  return normalizeEditQuyCachItems(items).reduce(function(sum, item) {
    return sum + Number(item.thanh_tien || 0);
  }, 0);
}

function normalizeEditLotInfo(raw, fallback, qty, price) {
  raw = raw && typeof raw === 'object' ? raw : {};
  fallback = fallback && typeof fallback === 'object' ? fallback : {};
  var quyCachItems = normalizeEditQuyCachItems(raw.quy_cach_items);
  if (!Array.isArray(raw.quy_cach_items) && !quyCachItems.length && Array.isArray(fallback.quy_cach_items) && fallback.quy_cach_items.length) {
    quyCachItems = normalizeEditQuyCachItems(fallback.quy_cach_items);
  }
  if (!quyCachItems.length && !fallback.ma_lo && !fallback.ten_lo && !raw.ma_lo && !raw.ten_lo) return undefined;
  var totalQty = quyCachItems.length ? sumEditQuyCachQty(quyCachItems) : Number(qty || 0);
  var totalAmount = quyCachItems.length ? sumEditQuyCachAmount(quyCachItems) : Math.floor(Number(qty || 0) * Number(price || 0));
  return {
    lo_hang_id: String(raw.lo_hang_id || fallback.lo_hang_id || '').trim(),
    ma_lo: String(raw.ma_lo || fallback.ma_lo || '').trim(),
    ten_lo: String(raw.ten_lo || fallback.ten_lo || '').trim(),
    han_su_dung: String(raw.han_su_dung || fallback.han_su_dung || '').trim(),
    ngay_nhap: String(raw.ngay_nhap || fallback.ngay_nhap || '').trim(),
    ghi_chu: String(raw.ghi_chu || fallback.ghi_chu || '').trim(),
    so_luong_tong: totalQty,
    don_gia_nhap: quyCachItems.length && totalQty > 0 ? Math.round(totalAmount / totalQty) : Number(price || 0),
    tong_tien_quy_cach: totalAmount,
    quy_cach_items: quyCachItems
  };
}

function calcLineTotal(item) {
  var qcTotal = item && item.lot_info && Array.isArray(item.lot_info.quy_cach_items)
    ? sumEditQuyCachAmount(item.lot_info.quy_cach_items)
    : 0;
  if (qcTotal > 0) return Math.floor(qcTotal);
  var soLuong = Number(item?.so_luong || 0);
  var donGia = Number(item?.don_gia || 0);
  var base = soLuong * donGia;
  if (!Number.isFinite(base) || base <= 0) return 0;
  var discountValue = Number(item?.giam_gia_dong || 0);
  if (!Number.isFinite(discountValue) || discountValue < 0) discountValue = 0;
  var discountType = String(item?.kieu_giam_gia_dong || 'vnd');
  var discountAmount = discountType === 'percent' ? (base * Math.min(discountValue, 100) / 100) : discountValue;
  return Math.max(0, Math.floor(base - discountAmount));
}

function computeTotals(items, giamGiaPhieu, kieuGiamGiaPhieu) {
  var tongTienHang = items.reduce(function(sum, it) {
    var line = calcLineTotal(it);
    return sum + (Number.isFinite(line) ? line : 0);
  }, 0);
  tongTienHang = Math.max(0, Math.floor(tongTienHang));
  var giam = Number(giamGiaPhieu || 0);
  if (!Number.isFinite(giam) || giam < 0) giam = 0;
  var discountType = ['vnd', 'percent'].indexOf(String(kieuGiamGiaPhieu || '').trim()) >= 0 ? String(kieuGiamGiaPhieu).trim() : 'vnd';
  if (discountType === 'percent' && giam > 100) giam = 100;
  giam = Math.floor(giam);
  var giamTheoTien = discountType === 'percent'
    ? Math.floor((tongTienHang * giam) / 100)
    : giam;
  var tongTien = Math.max(0, tongTienHang - giamTheoTien);
  return { tongTienHang: tongTienHang, giamGia: giam, tongTien: tongTien };
}

function parseMoneyInput(raw) {
  if (raw == null) return 0;
  var normalized = String(raw).replace(/\./g, '').replace(/,/g, '').trim();
  var n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function normalizeMoneyOrThrow(raw, message) {
  if (raw === undefined || raw === null || raw === '') return 0;
  var normalized = String(raw).replace(/\s/g, '').replace(/\./g, '').replace(/,/g, '').trim();
  if (!normalized) return 0;
  var n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) throw new Error(message);
  return Math.floor(n);
}

function normalizePaymentBody(body) {
  body = Object.assign({}, body || {});
  if (typeof body.chi_tiet_thanh_toan === 'string') {
    try {
      body.chi_tiet_thanh_toan = JSON.parse(body.chi_tiet_thanh_toan);
    } catch (_) {
      body.chi_tiet_thanh_toan = {};
    }
  }
  if (!body.chi_tiet_thanh_toan || typeof body.chi_tiet_thanh_toan !== 'object') {
    body.chi_tiet_thanh_toan = {};
  }
  return body;
}

function readPaymentValue(body, key) {
  var nested = body && body.chi_tiet_thanh_toan && typeof body.chi_tiet_thanh_toan === 'object'
    ? body.chi_tiet_thanh_toan
    : {};
  if (nested[key] !== undefined) return nested[key];
  var bracketKey = 'chi_tiet_thanh_toan[' + key + ']';
  if (body && body[bracketKey] !== undefined) return body[bracketKey];
  return body ? body[key] : undefined;
}

function hasPaymentBookValue(body, key) {
  return String(readPaymentValue(body, key) || '').trim() !== '';
}

function isPaySupplierPaymentV2(body) {
  var flag = body && body.payment_v2;
  return flag === true
    || flag === 'true'
    || flag === '1'
    || hasPaymentBookValue(body, 'so_quy_tien_mat_id')
    || hasPaymentBookValue(body, 'so_quy_chuyen_khoan_id');
}

function getCurrentBranchId(req) {
  var sessionBranchId = req && req.session ? String(req.session.chi_nhanh_id || '').trim() : '';
  if (sessionBranchId && mongoose.Types.ObjectId.isValid(sessionBranchId)) return sessionBranchId;
  var userBranchId = req && req.user ? String(req.user.chi_nhanh_id || '').trim() : '';
  if (userBranchId && mongoose.Types.ObjectId.isValid(userBranchId)) return userBranchId;
  return '';
}

function normalizePaySupplierPayment(body, isV2) {
  var tienMat = normalizeMoneyOrThrow(readPaymentValue(body, 'tien_mat'), 'Số tiền mặt không hợp lệ.');
  var chuyenKhoan = normalizeMoneyOrThrow(readPaymentValue(body, 'chuyen_khoan'), 'Số tiền chuyển khoản không hợp lệ.');
  var tienTraKhach = normalizeMoneyOrThrow(readPaymentValue(body, 'tien_tra_khach'), 'Số tiền trả khách không hợp lệ.');
  var amount = tienMat + chuyenKhoan;

  if (amount <= 0 && !isV2 && body && body.gia_tri !== undefined) {
    amount = normalizeMoneyOrThrow(body.gia_tri, 'Số tiền thanh toán không hợp lệ.');
    tienMat = amount;
    chuyenKhoan = 0;
  }
  if (isV2 && tienTraKhach > 0) {
    throw new Error('Tiền trả khách không áp dụng cho thanh toán nhà cung cấp.');
  }
  if (!isV2 && tienTraKhach > 0) {
    console.warn('[NHAP_HANG][PAY_SUPPLIER_LEGACY_REFUND_IGNORED]', tienTraKhach);
  }
  return {
    tien_mat: tienMat,
    chuyen_khoan: chuyenKhoan,
    tien_tra_khach: 0,
    so_quy_tien_mat_id: String(readPaymentValue(body, 'so_quy_tien_mat_id') || '').trim(),
    so_quy_chuyen_khoan_id: String(readPaymentValue(body, 'so_quy_chuyen_khoan_id') || '').trim(),
    amount: amount
  };
}

function legacyPaymentMethodFromDetail(detail) {
  if (detail.chuyen_khoan > 0 && detail.tien_mat <= 0) return 'chuyen_khoan';
  if (detail.tien_mat > 0 && detail.chuyen_khoan > 0) return 'khac';
  return 'tien_mat';
}

async function loadPurchaseWithItems(id, storeId) {
  if (!mongoose.Types.ObjectId.isValid(String(id || ''))) return null;
  var filter = { _id: id };
  if (storeId && mongoose.Types.ObjectId.isValid(storeId)) filter.cua_hang_id = storeId;
  var ticket = await PhieuNhap.findOne(activePurchaseDataFilter(filter))
    .populate({ path: 'cua_hang_id', select: 'ten_cua_hang ma_cua_hang ma_so_thue dia_chi dia_chi_day_du dia_chi_chi_tiet phuong_xa tinh_thanh sdt email' })
    .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc ten_cong_ty ma_so_thue sdt email ghi_chu tong_no tong_mua' })
    .populate({ path: 'nguoi_tao_id', select: 'ho_ten email' })
    .populate({ path: 'kho_id', select: 'ten_kho ma_kho' });
  if (!ticket) return null;
  var items = await CTPhieuNhap.find({ phieu_nhap_id: ticket._id })
    .populate({ path: 'hang_hoa_id' })
    .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi ma_don_vi' })
    .populate({ path: 'lo_hang_id' })
    .sort({ created_at: 1 });
  return { ticket: ticket, items: items };
}

async function assertCanRollbackPurchase(ticket, items) {
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var qty = Number(item.so_luong || 0);
    if (qty <= 0) continue;
    var productId = item.hang_hoa_id?._id || item.hang_hoa_id;
    var lotId = item.lo_hang_id?._id || item.lo_hang_id;
    var attributeValueId = item.gia_tri_thuoc_tinh_id?._id || item.gia_tri_thuoc_tinh_id;
    var inventory = await TonKho.findOne({
      kho_id: ticket.kho_id,
      hang_hoa_id: productId
    }).lean();
    if (!inventory || Number(inventory.so_luong || 0) < qty) {
      throw new Error('Tồn kho không đủ để rollback phiếu nhập');
    }
    if (lotId) {
      var attributeValueId = item.gia_tri_thuoc_tinh_id?._id || item.gia_tri_thuoc_tinh_id;
      var lotInventory = await TonKhoLo.findOne({
        kho_id: ticket.kho_id,
        hang_hoa_id: productId,
        lo_hang_id: lotId,
        gia_tri_thuoc_tinh_id: attributeValueId || null
      }).lean();
      if (!lotInventory || Number(lotInventory.so_luong || 0) < qty) {
        throw new Error('Tồn kho theo lô không đủ để rollback phiếu nhập');
      }
    }
  }
}

async function rollbackPurchaseStock(ticket, items, userId) {
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var qty = Number(item.so_luong || 0);
    if (qty <= 0) continue;
    var productId = item.hang_hoa_id?._id || item.hang_hoa_id;
    var lotId = item.lo_hang_id?._id || item.lo_hang_id;
    var updatedInv = await TonKho.findOneAndUpdate(
      { kho_id: ticket.kho_id, hang_hoa_id: productId },
      { $inc: { so_luong: -qty } },
      { new: true }
    ).lean();

    if (lotId) {
      await TonKhoLo.findOneAndUpdate(
        { kho_id: ticket.kho_id, hang_hoa_id: productId, lo_hang_id: lotId, gia_tri_thuoc_tinh_id: attributeValueId || null },
        { $inc: { so_luong: -qty } },
        { new: true }
      );
      await LoHang.findByIdAndUpdate(lotId, {
        $inc: { so_luong_con_lai: -qty }
      });
    }

    await LichSuKho.create({
      cua_hang_id: ticket.cua_hang_id,
      kho_id: ticket.kho_id,
      hang_hoa_id: productId,
      lo_hang_id: lotId || undefined,
      gia_tri_thuoc_tinh_id: attributeValueId || undefined,
      nguoi_tao_id: userId || undefined,
      loai_phieu: 'dieu_chinh',
      ma_phieu: ticket.ma_phieu_nhap,
      so_luong_thay_doi: -qty,
      ton_kho_sau: Number(updatedInv?.so_luong || 0),
      ghi_chu: 'Hủy phiếu nhập ' + ticket.ma_phieu_nhap,
      ngay: new Date()
    });
  }
}

function csvEscape(value) {
  return '"' + String(value ?? '').replace(/"/g, '""') + '"';
}

exports.createPage = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var warehouses = await Kho.find(
      storeId && mongoose.Types.ObjectId.isValid(storeId) ? { cua_hang_id: storeId } : {}
    )
      .sort({ ten_kho: 1, ma_kho: 1 })
      .lean();
    if (warehouses.length === 0 && storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      var suffix = String(Date.now()).slice(-5);
      var createdWarehouse = await Kho.create({
        cua_hang_id: storeId,
        ma_kho: 'KHO' + suffix,
        ten_kho: 'Kho tổng'
      });
      warehouses = [createdWarehouse];
    }

    var suppliers = await NhaCungCap.find(
      storeId && mongoose.Types.ObjectId.isValid(storeId) ? { cua_hang_id: storeId } : {}
    )
      .sort({ ten_ncc: 1, ma_ncc: 1 })
      .lean();
    if (suppliers.length === 0 && storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      suppliers = await NhaCungCap.find({})
        .sort({ ten_ncc: 1, ma_ncc: 1 })
        .lean();
    }
    var groups = await NhomHang.find(
      storeId && mongoose.Types.ObjectId.isValid(storeId) ? { cua_hang_id: storeId, trang_thai: 'active' } : { trang_thai: 'active' }
    )
      .sort({ ten_nhom: 1 })
      .lean();
    var units = await DonViTinh.find(
      storeId && mongoose.Types.ObjectId.isValid(storeId) ? { cua_hang_id: storeId, trang_thai: 'active' } : { trang_thai: 'active' }
    )
      .sort({ ten_don_vi: 1 })
      .lean();
    var cashBooks = await SoQuy.find({ trang_thai: 'active' })
      .sort({ ten_so_quy: 1 })
      .lean();

    var productQuery = storeId && mongoose.Types.ObjectId.isValid(storeId)
      ? { cua_hang_id: storeId, trang_thai: 'active' }
      : { trang_thai: 'active' };
    var products = await HangHoa.find(productQuery)
      .sort({ ten_hang: 1, ma_hang: 1 })
      .select('ma_hang ten_hang gia_nhap_cuoi gia_von don_vi_tinh_id nha_cung_cap_id quan_ly_theo_lo')
      .lean();
    if (products.length === 0 && productQuery.cua_hang_id) {
      // Fallback to global active products when current store has none.
      products = await HangHoa.find({ trang_thai: 'active' })
        .sort({ ten_hang: 1, ma_hang: 1 })
        .select('ma_hang ten_hang gia_nhap_cuoi gia_von don_vi_tinh_id nha_cung_cap_id quan_ly_theo_lo')
        .lean();
    }

    var vatChuaList = [];
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      vatChuaList = await VatChua.find({ cua_hang_id: storeId, trang_thai: 'active' })
        .sort({ ten_vat_chua: 1, ma_vat_chua: 1 })
        .select('ma_vat_chua ten_vat_chua so_luong_ton')
        .lean();
    }

    res.render('nhap-hang/create', {
      pageTitle: 'Nhập hàng',
      activeMenu: 'mua-hang',
      user: req.user,
      flash: req.query || {},
      suppliers: suppliers,
      warehouses: warehouses,
      products: products,
      groups: groups,
      units: units,
      cashBooks: cashBooks,
      vatChuaList: vatChuaList
    });
  } catch (error) {
    next(error);
  }
};

exports.apiSupplierProducts = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var supplierId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(supplierId)) {
      return res.status(400).json({ success: false, message: 'nha_cung_cap_id không hợp lệ' });
    }
    var keyword = String(req.query.keyword || '').trim();
    var query = {
      trang_thai: 'active',
      nha_cung_cap_id: supplierId
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
    if (keyword) {
      query.$or = [
        { ma_hang: { $regex: keyword, $options: 'i' } },
        { ten_hang: { $regex: keyword, $options: 'i' } }
      ];
    }
    var items = await HangHoa.find(query)
      .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi' })
      .populate({ path: 'nhom_hang_id', select: 'ten_nhom' })
      .sort({ ten_hang: 1, ma_hang: 1 })
      .select('ma_hang ten_hang don_vi_tinh_id nhom_hang_id nha_cung_cap_id gia_nhap_cuoi gia_von trang_thai quan_ly_theo_lo loai_gia gia_co_dinh')
      .lean();
    if (items.length === 0 && query.cua_hang_id) {
      var fallbackQuery = {
        trang_thai: 'active',
        nha_cung_cap_id: supplierId
      };
      if (keyword) {
        fallbackQuery.$or = [
          { ma_hang: { $regex: keyword, $options: 'i' } },
          { ten_hang: { $regex: keyword, $options: 'i' } }
        ];
      }
      items = await HangHoa.find(fallbackQuery)
        .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi' })
        .populate({ path: 'nhom_hang_id', select: 'ten_nhom' })
        .sort({ ten_hang: 1, ma_hang: 1 })
        .select('ma_hang ten_hang don_vi_tinh_id nhom_hang_id nha_cung_cap_id gia_nhap_cuoi gia_von trang_thai quan_ly_theo_lo loai_gia gia_co_dinh')
        .lean();
    }
    return res.json({ success: true, data: items, items: items });
  } catch (error) {
    next(error);
  }
};

exports.apiSupplierAddresses = async function(req, res, next) {
  try {
    var supplierId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(supplierId)) {
      return res.status(400).json({ success: false, message: 'nha_cung_cap_id khong hop le' });
    }
    var items = await DiaChiNcc.find({
        nha_cung_cap_id: supplierId,
        trang_thai: 'active'
      })
      .sort({ mac_dinh: -1, created_at: -1 })
      .select('ma_dia_chi ten_nguoi_nhan sdt_nguoi_nhan so_nha dia_chi_day_du tinh_thanh quan_huyen phuong_xa loai_dia_chi mac_dinh ghi_chu')
      .lean();
    return res.json({ success: true, data: items, items: items });
  } catch (error) {
    next(error);
  }
};

exports.quickCreateProduct = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var body = req.body || {};
    var supplierId = String(body.nha_cung_cap_id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(supplierId)) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn nhà cung cấp trước' });
    }
    var tenHang = String(body.ten_hang || '').trim();
    if (!tenHang) return res.status(400).json({ success: false, message: 'Tên hàng là bắt buộc' });

    var maHang = String(body.ma_hang || '').trim();
    if (!maHang) maHang = await makeProductCode();

    var donViTinhId = String(body.don_vi_tinh_id || '').trim();
    var nhomHangId = String(body.nhom_hang_id || '').trim();
    var loaiGia = String(body.loai_gia || 'thi_truong').trim();
    if (['thi_truong', 'co_dinh'].indexOf(loaiGia) < 0) loaiGia = 'thi_truong';

    var payload = {
      cua_hang_id: storeId || undefined,
      nha_cung_cap_id: supplierId,
      nguoi_tao_id: req.user && req.user._id ? req.user._id : undefined,
      ma_hang: maHang,
      ten_hang: tenHang,
      don_vi_tinh_id: mongoose.Types.ObjectId.isValid(donViTinhId) ? donViTinhId : undefined,
      nhom_hang_id: mongoose.Types.ObjectId.isValid(nhomHangId) ? nhomHangId : undefined,
      gia_von: Math.max(0, Number(body.gia_von || 0)),
      gia_nhap_cuoi: Math.max(0, Number(body.gia_nhap_cuoi || 0)),
      loai_gia: loaiGia,
      gia_co_dinh: Math.max(0, Number(body.gia_co_dinh || 0)),
      quan_ly_theo_lo: Boolean(body.quan_ly_theo_lo),
      trang_thai: 'active'
    };

    var created = await HangHoa.create(payload);
    var item = await HangHoa.findById(created._id)
      .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi' })
      .populate({ path: 'nhom_hang_id', select: 'ten_nhom' })
      .lean();
    return res.json({ success: true, item: item });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Mã hàng đã tồn tại' });
    }
    next(error);
  }
};

exports.quickUpdateProduct = async function(req, res, next) {
  try {
    var productId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'ID hàng hóa không hợp lệ' });
    }
    var body = req.body || {};
    var update = {
      ten_hang: String(body.ten_hang || '').trim(),
      gia_von: Math.max(0, Number(body.gia_von || 0)),
      gia_nhap_cuoi: Math.max(0, Number(body.gia_nhap_cuoi || 0)),
      loai_gia: ['thi_truong', 'co_dinh'].indexOf(String(body.loai_gia || '')) >= 0 ? String(body.loai_gia) : 'thi_truong',
      gia_co_dinh: Math.max(0, Number(body.gia_co_dinh || 0)),
      quan_ly_theo_lo: Boolean(body.quan_ly_theo_lo),
      trang_thai: ['active', 'inactive'].indexOf(String(body.trang_thai || '')) >= 0 ? String(body.trang_thai) : 'active'
    };
    if (!update.ten_hang) return res.status(400).json({ success: false, message: 'Tên hàng là bắt buộc' });

    var donViTinhId = String(body.don_vi_tinh_id || '').trim();
    var nhomHangId = String(body.nhom_hang_id || '').trim();
    update.don_vi_tinh_id = mongoose.Types.ObjectId.isValid(donViTinhId) ? donViTinhId : undefined;
    update.nhom_hang_id = mongoose.Types.ObjectId.isValid(nhomHangId) ? nhomHangId : undefined;

    await HangHoa.updateOne({ _id: productId }, { $set: update });
    var item = await HangHoa.findById(productId)
      .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi' })
      .populate({ path: 'nhom_hang_id', select: 'ten_nhom' })
      .lean();
    return res.json({ success: true, item: item });
  } catch (error) {
    next(error);
  }
};

exports.inactiveProduct = async function(req, res, next) {
  try {
    var productId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'ID hàng hóa không hợp lệ' });
    }
    await HangHoa.updateOne({ _id: productId }, { $set: { trang_thai: 'inactive' } });
    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

exports.apiHangHoa = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var keyword = String(req.query.keyword || '').trim();
    var supplierId = String(req.query.nha_cung_cap_id || '').trim();
    var hasSupplierFilter = mongoose.Types.ObjectId.isValid(supplierId);

    var query = { trang_thai: 'active' };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      query.cua_hang_id = storeId;
    }
    if (keyword) {
      query.$or = [
        { ma_hang: { $regex: keyword, $options: 'i' } },
        { ten_hang: { $regex: keyword, $options: 'i' } }
      ];
    }
    if (hasSupplierFilter) {
      query.nha_cung_cap_id = supplierId;
    }

    var products = await HangHoa.find(query)
      .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi' })
      .select('ma_hang ten_hang gia_nhap_cuoi gia_von don_vi_tinh_id nha_cung_cap_id quan_ly_theo_lo')
      .lean();
    if (products.length === 0 && query.cua_hang_id) {
      var fallbackQuery = { trang_thai: 'active' };
      if (keyword) {
        fallbackQuery.$or = [
          { ma_hang: { $regex: keyword, $options: 'i' } },
          { ten_hang: { $regex: keyword, $options: 'i' } }
        ];
      }
      if (hasSupplierFilter) {
        fallbackQuery.nha_cung_cap_id = supplierId;
      }
      products = await HangHoa.find(fallbackQuery)
        .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi' })
        .select('ma_hang ten_hang gia_nhap_cuoi gia_von don_vi_tinh_id nha_cung_cap_id quan_ly_theo_lo')
        .lean();
    }

    products.sort(function(a, b) {
      var aCode = String(a?.ma_hang || '');
      var bCode = String(b?.ma_hang || '');
      return aCode.localeCompare(bCode, 'vi');
    });

    var items = products.slice(0, 100).map(function(p) {
      return {
        _id: p._id,
        ma_hang: p.ma_hang || '',
        ten_hang: p.ten_hang || '',
        don_vi_tinh: p?.don_vi_tinh_id?.ten_don_vi || 'cái',
        gia_nhap_cuoi: Number(p.gia_nhap_cuoi || 0),
        gia_von: Number(p.gia_von || 0),
        nha_cung_cap_id: p.nha_cung_cap_id || null,
        quan_ly_theo_lo: Boolean(p.quan_ly_theo_lo)
      };
    });

    return res.json({ success: true, items: items });
  } catch (error) {
    next(error);
  }
};

exports.apiProductLots = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var productId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Mã hàng hóa không hợp lệ' });
    }
    var query = { hang_hoa_id: productId, trang_thai: { $ne: 'huy' } };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
    if (mongoose.Types.ObjectId.isValid(String(req.query.kho_id || ''))) query.kho_id = String(req.query.kho_id);
    var items = await LoHang.find(query)
      .sort({ han_su_dung: 1, ngay_nhap: -1 })
      .select('ma_lo ten_lo ngay_nhap han_su_dung so_luong_ban_dau so_luong_con_lai don_gia_nhap gia_von trang_thai kho_id quy_cach_items')
      .lean();
    return res.json({ success: true, items: items });
  } catch (error) {
    next(error);
  }
};

exports.createSubmit = async function(req, res, next) {
  var session = null;
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.redirect('/nhap-hang?error=invalid_store');
    }
    var purchase;
    session = await mongoose.startSession();
    await session.withTransaction(async function() {
      purchase = await purchaseService.createPurchase(Object.assign({}, req.body || {}, {
        cua_hang_id: storeId,
        nguoi_tao_id: req.user && req.user._id ? req.user._id : undefined
      }), { session: session });
    });
    var redirectUrl = '/nhap-hang?success=created&purchase=' + encodeURIComponent(String(purchase._id));
    var wantExport = req.body && (req.body.exportAfterComplete === '1' || req.body.exportAfterComplete === 'true');
    if (wantExport) redirectUrl += '&export=1';
    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('[NHAP_HANG][TRANSACTION_FAIL]', error && error.message ? error.message : error);
    return res.redirect('/nhap-hang/create?error=' + encodeURIComponent(error.message || 'create_failed'));
  } finally {
    if (session) await session.endSession();
  }
};
exports.detail = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var loaded = await loadPurchaseWithItems(req.params.id, storeId);
    if (!loaded) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập' });
    const ticketObj = loaded.ticket.toObject ? loaded.ticket.toObject() : loaded.ticket;
    const vatChuaLines = await loadPurchaseLinkedVatChuaLines(
      loaded.ticket._id,
      storeId || ticketObj.cua_hang_id
    );
    var vatChuaEdit = { vat_chua_id: '', so_luong: 0 };
    var storeOid = storeId || ticketObj.cua_hang_id;
    if (storeOid && mongoose.Types.ObjectId.isValid(String(storeOid))) {
      var nhapVatChua = await NhapVatChua.findOne({
        cua_hang_id: storeOid,
        source_type: 'phieu_nhap',
        source_id: loaded.ticket._id,
        trang_thai: 'active'
      }).lean();
      if (nhapVatChua && Array.isArray(nhapVatChua.items) && nhapVatChua.items.length) {
        var vcItem = nhapVatChua.items[0];
        vatChuaEdit = {
          vat_chua_id: String(vcItem.vat_chua_id || ''),
          so_luong: Number(vcItem.so_luong || 0)
        };
      }
    }
    return res.json({
      success: true,
      data: {
        ticket: ticketObj,
        items: loaded.items.map(function(item) { return item.toObject ? item.toObject() : item; }),
        vat_chua_lines: vatChuaLines,
        vat_chua_edit: vatChuaEdit
      }
    });
  } catch (error) {
    next(error);
  }
};

async function paySupplierLegacyUnused(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var filter = { _id: req.params.id };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) filter.cua_hang_id = storeId;
    var purchase = await PhieuNhap.findOne(activePurchaseDataFilter(filter)).populate({ path: 'nha_cung_cap_id', select: 'ten_ncc ma_ncc' });
    if (!purchase) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập' });
    if (!purchase.nha_cung_cap_id) return res.status(400).json({ success: false, message: 'Phiếu nhập chưa có nhà cung cấp' });
    if (purchase.trang_thai === 'cancelled') return res.status(400).json({ success: false, message: 'Phiếu nhập đã hủy' });

    var debt = Math.max(0, Number(purchase.con_no_ncc || 0));
    if (debt <= 0) return res.status(400).json({ success: false, message: 'Phiếu nhập không còn nợ nhà cung cấp' });

    var chiTietRaw = req.body && req.body.chi_tiet_thanh_toan;
    if (typeof chiTietRaw === 'string') {
      try { chiTietRaw = JSON.parse(chiTietRaw); } catch (_) { chiTietRaw = {}; }
    }
    var tienMat = parseMoneyInput(chiTietRaw && chiTietRaw.tien_mat);
    var chuyenKhoan = parseMoneyInput(chiTietRaw && chiTietRaw.chuyen_khoan);
    var tienTraKhach = parseMoneyInput(chiTietRaw && chiTietRaw.tien_tra_khach);
    if ((!chiTietRaw || (!chiTietRaw.tien_mat && !chiTietRaw.chuyen_khoan)) && req.body) {
      tienMat = parseMoneyInput(req.body.tien_mat);
      chuyenKhoan = parseMoneyInput(req.body.chuyen_khoan);
      tienTraKhach = parseMoneyInput(req.body.tien_tra_khach);
    }
    var amount = tienMat + chuyenKhoan;
    if (amount <= 0 && req.body && req.body.gia_tri != null) {
      amount = parseMoneyInput(req.body.gia_tri);
      tienMat = amount;
      chuyenKhoan = 0;
    }
    if (amount <= 0) return res.status(400).json({ success: false, message: 'Vui lòng nhập tiền mặt hoặc chuyển khoản' });
    if (amount > debt) return res.status(400).json({ success: false, message: 'Tổng thanh toán không được vượt quá nợ NCC còn lại' });

    var cashBookId = String((req.body && (req.body.so_quy_id || req.body.cashBookId)) || '').trim();
    if (!mongoose.Types.ObjectId.isValid(cashBookId)) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ để thanh toán phiếu nhập.' });
    }
    var paymentMethod = 'tien_mat';
    if (chuyenKhoan > 0 && tienMat <= 0) paymentMethod = 'chuyen_khoan';
    else if (tienMat > 0 && chuyenKhoan > 0) paymentMethod = 'khac';
    var note = String(req.body && req.body.ghi_chu || '').trim() || ('Thanh toán tiền nhập hàng cho phiếu ' + purchase.ma_phieu_nhap);

    var nextPaid = Math.min(Number(purchase.da_tra_ncc || 0) + amount, Number(purchase.can_tra_ncc || 0));
    var nextDebt = Math.max(0, Number(purchase.can_tra_ncc || 0) - nextPaid);
    var allocations = [{
      phieu_nhap_id: purchase._id,
      ma_phieu_nhap: purchase.ma_phieu_nhap || '',
      so_tien: amount,
      con_no_truoc: debt,
      con_no_sau: nextDebt
    }];

    var receipt = await taoPhieuThuChi({
      loai_phieu: 'chi',
      loai_thu_chi: 'thanh_toan_nhap_hang',
      gia_tri: amount,
      chi_tiet_thanh_toan: { tien_mat: tienMat, chuyen_khoan: chuyenKhoan, tien_tra_khach: tienTraKhach },
      nha_cung_cap_id: purchase.nha_cung_cap_id._id || purchase.nha_cung_cap_id,
      phieu_nhap_id: purchase._id,
      ma_chung_tu_goc: purchase.ma_phieu_nhap,
      nhom_doi_tuong: 'nha_cung_cap',
      phuong_thuc_thanh_toan: paymentMethod,
      so_quy_id: cashBookId,
      nguoi_tao_id: req.user && req.user._id,
      cua_hang_id: purchase.cua_hang_id || storeId,
      trang_thai: 'paid',
      ghi_chu: note,
      hach_toan: true,
      allocation_type: 'thanh_toan_ncc',
      allocations: allocations
    });

    await PhieuNhap.updateOne(
      { _id: purchase._id },
      { $set: { da_tra_ncc: nextPaid, con_no_ncc: nextDebt } }
    );

    return res.json({
      success: true,
      message: 'Đã tạo phiếu chi trả NCC',
      data: {
        receipt: receipt,
        da_tra_ncc: nextPaid,
        con_no_ncc: nextDebt
      }
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không tạo được phiếu chi' });
  }
}

exports.paySupplier = async function(req, res, next) {
  var session = null;
  try {
    var storeId = await resolveStoreId(req);
    var branchId = getCurrentBranchId(req);
    var body = normalizePaymentBody(req.body);
    var isV2 = isPaySupplierPaymentV2(body);
    var paymentInput = normalizePaySupplierPayment(body, isV2);
    var amount = paymentInput.amount;

    if (amount <= 0) {
      return res.status(400).json({ success: false, message: 'Số tiền thanh toán phải lớn hơn 0.' });
    }

    var result;
    session = await mongoose.startSession();
    await session.withTransaction(async function() {
      var filter = { _id: req.params.id };
      if (storeId && mongoose.Types.ObjectId.isValid(storeId)) filter.cua_hang_id = storeId;
      var purchase = await PhieuNhap.findOne(activePurchaseDataFilter(filter))
        .session(session)
        .populate({ path: 'nha_cung_cap_id', select: 'ten_ncc ma_ncc' });
      if (!purchase) throw new Error('Không tìm thấy phiếu nhập');
      if (!purchase.nha_cung_cap_id) throw new Error('Phiếu nhập chưa có nhà cung cấp');
      if (purchase.trang_thai === 'cancelled') throw new Error('Phiếu nhập đã hủy');

      var debt = Math.max(0, Number(purchase.con_no_ncc || 0));
      if (debt <= 0) throw new Error('Phiếu nhập không còn công nợ cần thanh toán.');
      if (amount > debt) throw new Error('Số tiền thanh toán không được vượt công nợ phiếu nhập.');

      var nextPaid = Math.min(Number(purchase.da_tra_ncc || 0) + amount, Number(purchase.can_tra_ncc || 0));
      var nextDebt = Math.max(0, debt - amount);
      var allocations = [{
        phieu_nhap_id: purchase._id,
        ma_phieu_nhap: purchase.ma_phieu_nhap || purchase.ma_phieu || '',
        so_tien: amount,
        con_no_truoc: debt,
        con_no_sau: nextDebt
      }];
      if (allocations[0].so_tien !== amount || allocations[0].con_no_sau < 0) {
        throw new Error('Phân bổ thanh toán phiếu nhập không hợp lệ.');
      }

      var supplierId = purchase.nha_cung_cap_id._id || purchase.nha_cung_cap_id;
      var supplierName = purchase.nha_cung_cap_id.ten_ncc || purchase.nha_cung_cap_id.ma_ncc || '';
      var note = String(body.ghi_chu || '').trim() || ('Thanh toán tiền nhập hàng cho phiếu ' + purchase.ma_phieu_nhap);
      var receiptPayload = {
        loai_phieu: 'chi',
        loai_thu_chi: 'thanh_toan_nhap_hang',
        gia_tri: amount,
        nha_cung_cap_id: supplierId,
        phieu_nhap_id: purchase._id,
        ma_chung_tu_goc: purchase.ma_phieu_nhap,
        nhom_doi_tuong: 'nha_cung_cap',
        doi_tuong: supplierName,
        nguoi_tao_id: req.user && req.user._id,
        cua_hang_id: purchase.cua_hang_id || storeId,
        chi_nhanh_id: branchId || undefined,
        trang_thai: 'paid',
        ghi_chu: note,
        hach_toan: true,
        allocation_type: 'thanh_toan_ncc',
        allocations: allocations,
        overpayment_amount: 0
      };

      if (isV2) {
        Object.assign(receiptPayload, {
          payment_v2: true,
          tien_mat: paymentInput.tien_mat,
          so_quy_tien_mat_id: paymentInput.so_quy_tien_mat_id,
          chuyen_khoan: paymentInput.chuyen_khoan,
          so_quy_chuyen_khoan_id: paymentInput.so_quy_chuyen_khoan_id,
          tien_tra_khach: 0
        });
        receiptPayload._paymentInfo = await buildReceiptPaymentInfo(receiptPayload, {
          cuaHangId: receiptPayload.cua_hang_id,
          chiNhanhId: receiptPayload.chi_nhanh_id,
          session: session
        });
      } else {
        var cashBookId = String((body && (body.so_quy_id || body.cashBookId)) || '').trim();
        if (!mongoose.Types.ObjectId.isValid(cashBookId)) {
          throw new Error('Vui lòng chọn sổ quỹ để thanh toán phiếu nhập.');
        }
        var cashBook = await SoQuy.findOne({
          _id: cashBookId,
          trang_thai: 'active'
        }).session(session);
        if (!cashBook) throw new Error('Sổ quỹ không hợp lệ.');

        var legacyPaymentMethod = legacyPaymentMethodFromDetail(paymentInput);
        var legacyDetail = {
          tien_mat: paymentInput.tien_mat,
          so_quy_tien_mat_id: paymentInput.tien_mat > 0 && cashBook.loai_so_quy !== 'chuyen_khoan' ? cashBook._id : null,
          chuyen_khoan: paymentInput.chuyen_khoan,
          so_quy_chuyen_khoan_id: paymentInput.chuyen_khoan > 0 && cashBook.loai_so_quy === 'chuyen_khoan' ? cashBook._id : null,
          tien_tra_khach: 0
        };
        Object.assign(receiptPayload, {
          so_quy_id: cashBook._id,
          phuong_thuc_thanh_toan: legacyPaymentMethod,
          chi_tiet_thanh_toan: legacyDetail,
          _paymentInfo: {
            isV2: false,
            gia_tri: amount,
            chi_tiet_thanh_toan: legacyDetail,
            phuong_thuc_thanh_toan: legacyPaymentMethod,
            so_quy_id: cashBook._id,
            cashBook: cashBook
          }
        });
      }

      var receipt = await taoPhieuThuChi(receiptPayload, { session: session });

      await PhieuNhap.updateOne(
        { _id: purchase._id },
        { $set: { da_tra_ncc: nextPaid, con_no_ncc: nextDebt } },
        { session: session }
      );

      result = {
        receipt: receipt,
        receipt_id: receipt && receipt._id,
        da_tra_ncc: nextPaid,
        con_no_ncc: nextDebt
      };
    });

    return res.json({
      success: true,
      message: 'Đã tạo phiếu chi trả NCC',
      data: result
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không tạo được phiếu chi' });
  } finally {
    if (session) await session.endSession();
  }
};

function qcKey(name) {
  return String(name || '').trim().toLowerCase();
}

function buildQcDeltaRows(oldItems, nextItems) {
  var byKey = new Map();
  function add(items, side) {
    normalizeEditQuyCachItems(items).forEach(function(item) {
      var name = String(item.ten_quy_cach || item.ten_thuoc_tinh || '').trim();
      if (!name) return;
      var key = qcKey(name);
      if (!byKey.has(key)) {
        byKey.set(key, {
          ten_quy_cach: name,
          oldQty: 0,
          nextQty: 0,
          oldAmount: 0,
          nextAmount: 0,
          nextPrice: Number(item.don_gia_nhap || item.gia_von || 0)
        });
      }
      var row = byKey.get(key);
      if (side === 'old') {
        row.oldQty += Number(item.so_luong || 0);
        row.oldAmount += Number(item.thanh_tien || 0);
      } else {
        row.nextQty += Number(item.so_luong || 0);
        row.nextAmount += Number(item.thanh_tien || 0);
        row.nextPrice = Number(item.don_gia_nhap || item.gia_von || row.nextPrice || 0);
        row.ten_quy_cach = name;
      }
    });
  }
  add(oldItems, 'old');
  add(nextItems, 'next');
  return Array.from(byKey.values()).map(function(row) {
    row.deltaQty = row.nextQty - row.oldQty;
    row.deltaAmount = row.nextAmount - row.oldAmount;
    return row;
  });
}

async function ensureCanDecreaseQuyCach(khoId, productId, lotId, deltas) {
  for (var i = 0; i < deltas.length; i++) {
    var row = deltas[i];
    if (row.deltaQty >= 0) continue;
    var stock = await TonKhoLoQuyCach.findOne({
      kho_id: khoId,
      hang_hoa_id: productId,
      lo_hang_id: lotId,
      ten_quy_cach: row.ten_quy_cach
    }).lean();
    if (!stock || Number(stock.so_luong || 0) < Math.abs(row.deltaQty)) {
      throw new Error('Tồn kho quy cách trong lô không đủ để giảm số lượng dòng hàng');
    }
  }
}

async function applyQuyCachDelta(params) {
  var storeId = params.storeId;
  var khoId = params.khoId;
  var productId = params.productId;
  var lotId = params.lotId;
  var deltas = params.deltas || [];
  for (var i = 0; i < deltas.length; i++) {
    var row = deltas[i];
    if (!row.ten_quy_cach || (row.deltaQty === 0 && row.deltaAmount === 0)) continue;
    await TonKhoLoQuyCach.findOneAndUpdate(
      {
        kho_id: khoId,
        hang_hoa_id: productId,
        lo_hang_id: lotId,
        ten_quy_cach: row.ten_quy_cach
      },
      {
        $setOnInsert: {
          cua_hang_id: storeId
        },
        $inc: {
          so_luong: row.deltaQty,
          thanh_tien: row.deltaAmount
        },
        $set: {
          ten_thuoc_tinh: row.ten_quy_cach,
          don_gia_nhap: row.nextPrice,
          gia_von: row.nextPrice
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  var warehouse = await Kho.findById(khoId).lean();
  if (warehouse) await syncTonKhoSauQuyCach(khoId, productId, lotId, warehouse, params.cost);
}

function toObjectIdOrNull(value) {
  var id = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

async function calculateProductCostFromCurrentStock(productId, storeId) {
  var productObjectId = toObjectIdOrNull(productId);
  if (!productObjectId) return null;
  var storeObjectId = toObjectIdOrNull(storeId);

  var lotMatch = { hang_hoa_id: productObjectId, so_luong: { $gt: 0 } };
  if (storeObjectId) lotMatch.cua_hang_id = storeObjectId;
  var lotRows = await TonKhoLo.aggregate([
    { $match: lotMatch },
    {
      $group: {
        _id: '$hang_hoa_id',
        totalQty: { $sum: { $ifNull: ['$so_luong', 0] } },
        totalValue: {
          $sum: {
            $multiply: [
              { $ifNull: ['$so_luong', 0] },
              { $ifNull: ['$gia_von', 0] }
            ]
          }
        }
      }
    }
  ]);
  if (lotRows[0] && Number(lotRows[0].totalQty || 0) > 0) {
    return Math.round(Number(lotRows[0].totalValue || 0) / Number(lotRows[0].totalQty || 1));
  }

  var purchaseMatch = {
    'purchase.trang_thai': 'completed'
  };
  if (storeObjectId) purchaseMatch['purchase.cua_hang_id'] = storeObjectId;
  var purchaseRows = await CTPhieuNhap.aggregate([
    { $match: { hang_hoa_id: productObjectId, so_luong: { $gt: 0 } } },
    {
      $lookup: {
        from: 'phieu_nhap',
        localField: 'phieu_nhap_id',
        foreignField: '_id',
        as: 'purchase'
      }
    },
    { $unwind: '$purchase' },
    { $match: purchaseMatch },
    {
      $group: {
        _id: '$hang_hoa_id',
        totalQty: { $sum: { $ifNull: ['$so_luong', 0] } },
        totalValue: {
          $sum: {
            $multiply: [
              { $ifNull: ['$so_luong', 0] },
              { $ifNull: ['$don_gia_nhap', 0] }
            ]
          }
        }
      }
    }
  ]);
  if (purchaseRows[0] && Number(purchaseRows[0].totalQty || 0) > 0) {
    return Math.round(Number(purchaseRows[0].totalValue || 0) / Number(purchaseRows[0].totalQty || 1));
  }
  return null;
}

async function refreshProductCostsAfterPurchaseEdit(rows, storeId) {
  var latestCostByProduct = {};
  (rows || []).forEach(function(pair) {
    var productId = String(pair && pair.next && pair.next.hang_hoa_id || '');
    if (!productId) return;
    latestCostByProduct[productId] = Number(pair.next.don_gia_nhap || 0);
  });
  var productIds = Object.keys(latestCostByProduct);
  for (var i = 0; i < productIds.length; i++) {
    var productId = productIds[i];
    var avgCost = await calculateProductCostFromCurrentStock(productId, storeId);
    if (avgCost == null) avgCost = latestCostByProduct[productId];
    await HangHoa.updateOne(
      { _id: productId },
      {
        $set: {
          gia_von: Number(avgCost || 0),
          gia_nhap_cuoi: Number(latestCostByProduct[productId] || 0)
        }
      }
    );
  }
}

exports.save = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var loaded = await loadPurchaseWithItems(req.params.id, storeId);
    if (!loaded) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập' });
    if (loaded.ticket.trang_thai === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Phiếu đã hủy, không thể lưu' });
    }
    var body = req.body || {};
    var oldTicket = loaded.ticket.toObject ? loaded.ticket.toObject() : loaded.ticket;
    var oldKhoId = String(oldTicket.kho_id?._id || oldTicket.kho_id || '');
    var newKhoId = String(body.kho_id || oldKhoId).trim();
    if (!mongoose.Types.ObjectId.isValid(newKhoId)) return res.status(400).json({ success: false, message: 'Kho nhập không hợp lệ' });
    var supplierId = String(body.nha_cung_cap_id || oldTicket.nha_cung_cap_id?._id || oldTicket.nha_cung_cap_id || '').trim();
    if (supplierId && !mongoose.Types.ObjectId.isValid(supplierId)) supplierId = '';
    var rowsById = new Map((loaded.items || []).map(function(row) {
      var plain = row.toObject ? row.toObject() : row;
      return [String(plain._id), plain];
    }));
    var incoming = Array.isArray(body.items) ? body.items : [];
    var normalizedRows = [];
    for (var i = 0; i < incoming.length; i++) {
      var raw = incoming[i] || {};
      var oldRow = rowsById.get(String(raw._id || ''));
      if (!oldRow) continue;
      var qty = Math.max(0, Math.floor(Number(raw.so_luong || 0)));
      var price = parseMoneyInput(raw.don_gia_nhap);
      var lotInfo = normalizeEditLotInfo(raw.lot_info, oldRow.lot_info, qty, price);
      var qcItems = lotInfo && Array.isArray(lotInfo.quy_cach_items) ? lotInfo.quy_cach_items : [];
      var oldRowQcItems = normalizeEditQuyCachItems(oldRow.lot_info && oldRow.lot_info.quy_cach_items);
      if (oldRowQcItems.length && raw.lot_info && Array.isArray(raw.lot_info.quy_cach_items) && !qcItems.length) {
        return res.status(400).json({ success: false, message: 'Lô đang có thuộc tính/quy cách, cần giữ ít nhất một dòng thuộc tính' });
      }
      if (qcItems.length) {
        for (var q = 0; q < qcItems.length; q++) {
          if (!qcItems[q].ten_quy_cach) {
            return res.status(400).json({ success: false, message: 'Tên thuộc tính/quy cách không được để trống' });
          }
          if (Number(qcItems[q].so_luong || 0) <= 0) {
            return res.status(400).json({ success: false, message: 'Số lượng thuộc tính/quy cách phải lớn hơn 0' });
          }
        }
        qty = Math.floor(sumEditQuyCachQty(qcItems));
        var qcAmount = sumEditQuyCachAmount(qcItems);
        price = qty > 0 ? Math.round(qcAmount / qty) : price;
        lotInfo.so_luong_tong = qty;
        lotInfo.don_gia_nhap = price;
        lotInfo.tong_tien_quy_cach = qcAmount;
      }
      var lineDiscount = Number(raw.giam_gia_dong || 0);
      if (!Number.isFinite(lineDiscount) || lineDiscount < 0) lineDiscount = 0;
      var lineDiscountType = ['vnd', 'percent'].indexOf(String(raw.kieu_giam_gia_dong || '').trim()) >= 0 ? String(raw.kieu_giam_gia_dong).trim() : 'vnd';
      if (lineDiscountType === 'percent' && lineDiscount > 100) lineDiscount = 100;
      if (qty <= 0) return res.status(400).json({ success: false, message: 'Số lượng phải lớn hơn 0' });
      var normalized = {
        _id: oldRow._id,
        hang_hoa_id: oldRow.hang_hoa_id?._id || oldRow.hang_hoa_id,
        lo_hang_id: oldRow.lo_hang_id?._id || oldRow.lo_hang_id,
        gia_tri_thuoc_tinh_id: oldRow.gia_tri_thuoc_tinh_id?._id || oldRow.gia_tri_thuoc_tinh_id,
        so_luong: qty,
        don_gia: price,
        don_gia_nhap: price,
        giam_gia_dong: Math.floor(lineDiscount),
        kieu_giam_gia_dong: lineDiscountType,
        ghi_chu: String(raw.ghi_chu || '').trim(),
        lot_info: lotInfo
      };
      normalized.thanh_tien = calcLineTotal(normalized);
      normalizedRows.push({ oldRow: oldRow, next: normalized });
    }
    if (!normalizedRows.length) {
      return res.status(400).json({ success: false, message: 'Phiếu nhập cần có ít nhất một dòng hàng' });
    }

    if (oldTicket.trang_thai === 'completed') {
      for (var s = 0; s < normalizedRows.length; s++) {
        var pair = normalizedRows[s];
        var productId = pair.next.hang_hoa_id;
        var lotId = pair.next.lo_hang_id;
        var attributeValueId = pair.next.gia_tri_thuoc_tinh_id || undefined;
        var oldQcItems = normalizeEditQuyCachItems(pair.oldRow.lot_info && pair.oldRow.lot_info.quy_cach_items);
        var nextQcItems = normalizeEditQuyCachItems(pair.next.lot_info && pair.next.lot_info.quy_cach_items);
        if (lotId && (oldQcItems.length || nextQcItems.length)) {
          var qcDeltas = buildQcDeltaRows(oldQcItems, nextQcItems);
          var purchaseStoreIdForQc = oldTicket.cua_hang_id?._id || oldTicket.cua_hang_id || storeId;
          if (String(oldKhoId) === String(newKhoId)) {
            await ensureCanDecreaseQuyCach(oldKhoId, productId, lotId, qcDeltas);
            await applyQuyCachDelta({
              storeId: purchaseStoreIdForQc,
              khoId: oldKhoId,
              productId: productId,
              lotId: lotId,
              deltas: qcDeltas,
              cost: pair.next.don_gia_nhap
            });
          } else {
            await ensureCanDecreaseQuyCach(oldKhoId, productId, lotId, qcDeltas.map(function(row) {
              return Object.assign({}, row, { deltaQty: -row.oldQty });
            }));
            await applyQuyCachDelta({
              storeId: purchaseStoreIdForQc,
              khoId: oldKhoId,
              productId: productId,
              lotId: lotId,
              deltas: oldQcItems.map(function(item) {
                return {
                  ten_quy_cach: item.ten_quy_cach || item.ten_thuoc_tinh,
                  deltaQty: -Number(item.so_luong || 0),
                  deltaAmount: -Number(item.thanh_tien || 0),
                  nextPrice: Number(item.don_gia_nhap || item.gia_von || 0)
                };
              }),
              cost: pair.next.don_gia_nhap
            });
            await applyQuyCachDelta({
              storeId: purchaseStoreIdForQc,
              khoId: newKhoId,
              productId: productId,
              lotId: lotId,
              deltas: nextQcItems.map(function(item) {
                return {
                  ten_quy_cach: item.ten_quy_cach || item.ten_thuoc_tinh,
                  deltaQty: Number(item.so_luong || 0),
                  deltaAmount: Number(item.thanh_tien || 0),
                  nextPrice: Number(item.don_gia_nhap || item.gia_von || 0)
                };
              }),
              cost: pair.next.don_gia_nhap
            });
          }
          continue;
        }
        var oldQty = Number(pair.oldRow.so_luong || 0);
        var newQty = Number(pair.next.so_luong || 0);
        if (String(oldKhoId) === String(newKhoId)) {
          var delta = newQty - oldQty;
          if (delta < 0) {
            var stock = await TonKho.findOne({ kho_id: oldKhoId, hang_hoa_id: productId }).lean();
            if (!stock || Number(stock.so_luong || 0) < Math.abs(delta)) {
              return res.status(400).json({ success: false, message: 'Tồn kho không đủ để giảm số lượng dòng hàng' });
            }
            if (lotId) {
              var lotStock = await TonKhoLo.findOne({ kho_id: oldKhoId, hang_hoa_id: productId, lo_hang_id: lotId, gia_tri_thuoc_tinh_id: attributeValueId || null }).lean();
              if (!lotStock || Number(lotStock.so_luong || 0) < Math.abs(delta)) {
                return res.status(400).json({ success: false, message: 'Tồn kho lô không đủ để giảm số lượng dòng hàng' });
              }
            }
          }
          if (delta !== 0) {
            await TonKho.findOneAndUpdate(
              { cua_hang_id: oldTicket.cua_hang_id?._id || oldTicket.cua_hang_id, kho_id: oldKhoId, hang_hoa_id: productId },
              { $inc: { so_luong: delta }, $setOnInsert: { cua_hang_id: oldTicket.cua_hang_id?._id || oldTicket.cua_hang_id } },
              { upsert: true }
            );
            if (lotId) {
              await TonKhoLo.findOneAndUpdate(
                { cua_hang_id: oldTicket.cua_hang_id?._id || oldTicket.cua_hang_id, kho_id: oldKhoId, hang_hoa_id: productId, lo_hang_id: lotId, gia_tri_thuoc_tinh_id: attributeValueId || null },
                { $inc: { so_luong: delta }, $set: { gia_von: pair.next.don_gia_nhap } },
                { upsert: true }
              );
              await LoHang.updateOne({ _id: lotId }, { $inc: { so_luong_con_lai: delta }, $set: { don_gia_nhap: pair.next.don_gia_nhap, gia_von: pair.next.don_gia_nhap } });
            }
          }
          if (lotId && delta === 0 && Number(pair.oldRow.don_gia_nhap || 0) !== Number(pair.next.don_gia_nhap || 0)) {
            await TonKhoLo.updateOne(
              { cua_hang_id: oldTicket.cua_hang_id?._id || oldTicket.cua_hang_id, kho_id: oldKhoId, hang_hoa_id: productId, lo_hang_id: lotId, gia_tri_thuoc_tinh_id: attributeValueId || null },
              { $set: { gia_von: pair.next.don_gia_nhap } }
            );
            await LoHang.updateOne(
              { _id: lotId },
              { $set: { don_gia_nhap: pair.next.don_gia_nhap, gia_von: pair.next.don_gia_nhap } }
            );
          }
        } else {
          var oldStock = await TonKho.findOne({ kho_id: oldKhoId, hang_hoa_id: productId }).lean();
          if (!oldStock || Number(oldStock.so_luong || 0) < oldQty) {
            return res.status(400).json({ success: false, message: 'Tồn kho cũ không đủ để chuyển kho nhập' });
          }
          if (lotId) {
            var oldLotStock = await TonKhoLo.findOne({ kho_id: oldKhoId, hang_hoa_id: productId, lo_hang_id: lotId, gia_tri_thuoc_tinh_id: attributeValueId || null }).lean();
            if (!oldLotStock || Number(oldLotStock.so_luong || 0) < oldQty) {
              return res.status(400).json({ success: false, message: 'Tồn kho lô cũ không đủ để chuyển kho nhập' });
            }
          }
          await TonKho.updateOne({ kho_id: oldKhoId, hang_hoa_id: productId }, { $inc: { so_luong: -oldQty } });
          await TonKho.findOneAndUpdate(
            { cua_hang_id: oldTicket.cua_hang_id?._id || oldTicket.cua_hang_id, kho_id: newKhoId, hang_hoa_id: productId },
            { $inc: { so_luong: newQty }, $setOnInsert: { cua_hang_id: oldTicket.cua_hang_id?._id || oldTicket.cua_hang_id } },
            { upsert: true }
          );
          if (lotId) {
            await TonKhoLo.updateOne({ kho_id: oldKhoId, hang_hoa_id: productId, lo_hang_id: lotId, gia_tri_thuoc_tinh_id: attributeValueId || null }, { $inc: { so_luong: -oldQty } });
            await TonKhoLo.findOneAndUpdate(
              { cua_hang_id: oldTicket.cua_hang_id?._id || oldTicket.cua_hang_id, kho_id: newKhoId, hang_hoa_id: productId, lo_hang_id: lotId, gia_tri_thuoc_tinh_id: attributeValueId || null },
              { $inc: { so_luong: newQty }, $set: { gia_von: pair.next.don_gia_nhap } },
              { upsert: true }
            );
            var lotDelta = newQty - oldQty;
            if (lotDelta !== 0) await LoHang.updateOne({ _id: lotId }, { $inc: { so_luong_con_lai: lotDelta } });
          }
        }
      }
    }

    var giamGia = Number(body.giam_gia || 0);
    if (!Number.isFinite(giamGia) || giamGia < 0) giamGia = 0;
    var discountType = ['vnd', 'percent'].indexOf(String(body.kieu_giam_gia || '').trim()) >= 0 ? String(body.kieu_giam_gia).trim() : 'vnd';
    var totals = computeTotals(normalizedRows.map(function(pair) { return pair.next; }), giamGia, discountType);
    var canTra = parseMoneyInput(body.can_tra_ncc || totals.tongTien);
    if (canTra > totals.tongTien) canTra = totals.tongTien;
    var daTra = parseMoneyInput(body.da_tra_ncc);
    if (daTra <= 0) daTra = 0;
    else if (daTra > canTra) daTra = canTra;
    var phuongThuc = daTra > 0 ? 'tien_mat' : 'cong_no';
    var conNo = Math.max(0, canTra - daTra);

    var oldSupplierId = String(oldTicket.nha_cung_cap_id?._id || oldTicket.nha_cung_cap_id || '');
    if (oldTicket.trang_thai === 'completed') {
      if (oldSupplierId && oldSupplierId === supplierId) {
        await NhaCungCap.updateOne({ _id: oldSupplierId }, { $inc: { tong_mua: canTra - Number(oldTicket.can_tra_ncc || 0), tong_no: conNo - Number(oldTicket.con_no_ncc || 0) } });
      } else {
        if (oldSupplierId) await NhaCungCap.updateOne({ _id: oldSupplierId }, { $inc: { tong_mua: -Number(oldTicket.can_tra_ncc || 0), tong_no: -Number(oldTicket.con_no_ncc || 0) } });
        if (supplierId) await NhaCungCap.updateOne({ _id: supplierId }, { $inc: { tong_mua: canTra, tong_no: conNo } });
      }
    }

    await PhieuNhap.updateOne({ _id: loaded.ticket._id }, {
      $set: {
        kho_id: newKhoId,
        nha_cung_cap_id: supplierId || undefined,
        ngay_nhap: parseDateOnly(body.ngay_nhap) || oldTicket.ngay_nhap,
        giam_gia: totals.giamGia,
        kieu_giam_gia: discountType,
        tong_tien_hang: totals.tongTienHang,
        tong_tien: totals.tongTien,
        can_tra_ncc: canTra,
        da_tra_ncc: daTra,
        con_no_ncc: conNo,
        phuong_thuc_thanh_toan: phuongThuc,
        ghi_chu: String(body.ghi_chu || '').trim()
      }
    });
    for (var u = 0; u < normalizedRows.length; u++) {
      await CTPhieuNhap.updateOne({ _id: normalizedRows[u].oldRow._id }, {
        $set: {
          so_luong: normalizedRows[u].next.so_luong,
          don_gia_nhap: normalizedRows[u].next.don_gia_nhap,
          giam_gia_dong: normalizedRows[u].next.giam_gia_dong,
          kieu_giam_gia_dong: normalizedRows[u].next.kieu_giam_gia_dong,
          thanh_tien: normalizedRows[u].next.thanh_tien,
          ghi_chu: normalizedRows[u].next.ghi_chu,
          lot_info: normalizedRows[u].next.lot_info
        }
      });
      var nextLotId = normalizedRows[u].next.lo_hang_id;
      var nextLotInfo = normalizedRows[u].next.lot_info;
      var nextLotQcItems = normalizeEditQuyCachItems(nextLotInfo && nextLotInfo.quy_cach_items);
      if (nextLotId && nextLotInfo && nextLotQcItems.length) {
        await LoHang.updateOne({ _id: nextLotId }, {
          $set: {
            quy_cach_items: nextLotQcItems,
            so_luong_ban_dau: normalizedRows[u].next.so_luong,
            don_gia_nhap: normalizedRows[u].next.don_gia_nhap,
            gia_von: normalizedRows[u].next.don_gia_nhap
          }
        });
      }
    }

    if (oldTicket.trang_thai === 'completed') {
      await refreshProductCostsAfterPurchaseEdit(
        normalizedRows,
        oldTicket.cua_hang_id?._id || oldTicket.cua_hang_id || storeId
      );
    }

    if (oldTicket.trang_thai === 'completed') {
      var purchaseStoreId = oldTicket.cua_hang_id?._id || oldTicket.cua_hang_id || storeId;
      var parsedVatChua = parseVatChuaImportInput(body);
      try {
        assertVatChuaImportInput(parsedVatChua);
      } catch (vcErr) {
        return res.status(400).json({ success: false, message: vcErr.message || 'Dữ liệu vật chứa không hợp lệ' });
      }
      await cancelNhapVatChuaBySource(purchaseStoreId, 'phieu_nhap', loaded.ticket._id);
      if (parsedVatChua.vatChuaId && parsedVatChua.qty > 0) {
        var updatedPurchase = await PhieuNhap.findById(loaded.ticket._id).lean();
        if (updatedPurchase) {
          await importVatChuaWithPurchase(updatedPurchase, body);
        }
      }
    }

    return res.json({ success: true, message: 'Đã lưu thông tin phiếu nhập' });
  } catch (error) {
    next(error);
  }
};

exports.cancel = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    await purchaseService.cancelPurchase(req.params.id, storeId, req.user && req.user._id);
    return res.json({ success: true, message: 'Đã hủy phiếu nhập' });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không hủy được phiếu nhập' });
  }
};

exports.previewTrash = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var ids = req.body && req.body.phieu_nhap_ids;
    var preview = await previewPurchaseTrash(ids, storeId);
    return res.json({ success: true, data: preview });
  } catch (error) {
    var status = Number(error && error.statusCode) || 400;
    return res.status(status).json({ success: false, message: error.message || 'Không xem trước được thùng rác' });
  }
};

exports.moveToTrash = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var ids = req.body && req.body.phieu_nhap_ids;
    var userId = req.user && req.user._id;
    var result = await movePurchasesToTrash(ids, storeId, userId);
    return res.json({
      success: true,
      message: 'Đã đưa ' + result.moved_count + ' phiếu nhập vào thùng rác.',
      data: result
    });
  } catch (error) {
    var status = Number(error && error.statusCode) || 400;
    return res.status(status).json({ success: false, message: error.message || 'Không đưa vào thùng rác được' });
  }
};

exports.deactivateSelected = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var ids = Array.isArray(req.body && req.body.phieu_nhap_ids)
      ? req.body.phieu_nhap_ids
      : (Array.isArray(req.body && req.body.ids) ? req.body.ids : []);
    ids = ids.map(function(id) { return String(id || '').trim(); }).filter(function(id) {
      return mongoose.Types.ObjectId.isValid(id);
    });
    if (!ids.length) {
      return res.status(400).json({ success: false, message: 'Vui long chon it nhat mot phieu nhap.' });
    }
    var filter = { _id: { $in: ids } };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) filter.cua_hang_id = storeId;
    var result = await PhieuNhap.updateMany(
      activePurchaseDataFilter(filter),
      { $set: { trang_thai_du_lieu: 'inactive', updated_at: new Date() } }
    );
    return res.json({
      success: true,
      message: 'Da xoa phieu nhap da chon.',
      data: { modified_count: result.modifiedCount || result.nModified || 0 }
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Khong xoa duoc phieu nhap.' });
  }
};

/** Deep clone Mixed snapshot (lot_info) — không giữ reference tới chi tiết gốc */
function clonePurchaseDetailSnapshot(value) {
  if (value == null) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return undefined;
  }
}

exports.copy = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var loaded = await loadPurchaseWithItems(req.params.id, storeId);
    if (!loaded) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập' });
    var source = loaded.ticket;
    var maPhieu = await makePhieuNhapCode();
    var copied = await PhieuNhap.create({
      cua_hang_id: source.cua_hang_id,
      kho_id: source.kho_id?._id || source.kho_id,
      nha_cung_cap_id: source.nha_cung_cap_id?._id || source.nha_cung_cap_id || undefined,
      dia_chi_ncc_id: source.dia_chi_ncc_id?._id || source.dia_chi_ncc_id || undefined,
      nguoi_tao_id: req.user && req.user._id ? req.user._id : undefined,
      ma_phieu_nhap: maPhieu,
      ngay_nhap: new Date(),
      tong_tien_hang: source.tong_tien_hang || 0,
      giam_gia: source.giam_gia || 0,
      kieu_giam_gia: source.kieu_giam_gia || 'vnd',
      tong_tien: source.tong_tien || 0,
      can_tra_ncc: source.can_tra_ncc || 0,
      da_tra_ncc: 0,
      con_no_ncc: source.can_tra_ncc || source.tong_tien || 0,
      phuong_thuc_thanh_toan: 'cong_no',
      trang_thai: 'draft',
      ghi_chu: 'Sao chép từ ' + source.ma_phieu_nhap
    });

    var rows = loaded.items.map(function(item) {
      var plain = item.toObject ? item.toObject() : item;
      var row = {
        phieu_nhap_id: copied._id,
        hang_hoa_id: plain.hang_hoa_id && (plain.hang_hoa_id._id || plain.hang_hoa_id),
        lo_hang_id: plain.lo_hang_id ? (plain.lo_hang_id._id || plain.lo_hang_id) : undefined,
        gia_tri_thuoc_tinh_id: plain.gia_tri_thuoc_tinh_id
          ? (plain.gia_tri_thuoc_tinh_id._id || plain.gia_tri_thuoc_tinh_id)
          : undefined,
        don_vi_tinh_id: plain.don_vi_tinh_id ? (plain.don_vi_tinh_id._id || plain.don_vi_tinh_id) : undefined,
        so_luong: Number(plain.so_luong || 0),
        don_gia_nhap: Number(plain.don_gia_nhap || 0),
        giam_gia_dong: Number(plain.giam_gia_dong || 0),
        kieu_giam_gia_dong: plain.kieu_giam_gia_dong || 'vnd',
        thanh_tien: Number(plain.thanh_tien || 0),
        ghi_chu: plain.ghi_chu || ''
      };
      var lotSnap = clonePurchaseDetailSnapshot(plain.lot_info);
      if (lotSnap !== undefined) row.lot_info = lotSnap;
      return row;
    });
    if (rows.length) await CTPhieuNhap.insertMany(rows);
    return res.json({ success: true, message: 'Đã sao chép phiếu nhập', id: copied._id, ma_phieu_nhap: maPhieu });
  } catch (error) {
    next(error);
  }
};

/**
 * Ghi chú in phiếu nhập / bảng kê 02-TNDN: chỉ từ snapshot trên chi tiết phiếu (lot_info.quy_cach_items).
 * Không dùng TonKho, TonKhoLo, TonKhoLoQuyCach hay LoHang hiện tại — các bảng đó thay đổi sau kiểm kho/trả hàng.
 */
function formatDateOnlyForPrint(value) {
  if (!value) return '';
  var date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('vi-VN');
}

function lotLabelForPurchasePrintRow(row) {
  var product = row.hang_hoa_id || {};
  if (!product.quan_ly_theo_lo) return 'Không theo lô';
  var lot = row.lo_hang_id || null;
  if (!lot) return '--';
  var lotName = lot.ten_lo || lot.ma_lo || '--';
  var expiry = formatDateOnlyForPrint(lot.han_su_dung);
  return expiry ? lotName + ' - HSD: ' + expiry : lotName;
}

function purchaseDetailGroupsForPrint(rows) {
  var groups = [];
  var index = {};
  (rows || []).forEach(function(row) {
    var product = row.hang_hoa_id || {};
    var lot = row.lo_hang_id || null;
    var productId = String(product._id || row.hang_hoa_id || '');
    var lotId = product.quan_ly_theo_lo ? String(lot && lot._id ? lot._id : row.lo_hang_id || 'missing') : 'no-lot';
    var key = productId + '::' + lotId;
    if (!index[key]) {
      index[key] = {
        product: product,
        lot: lot,
        lot_label: lotLabelForPurchasePrintRow(row),
        rows: [],
        total: 0
      };
      groups.push(index[key]);
    }
    index[key].rows.push(row);
    index[key].total += Number(row.thanh_tien || 0);
  });
  return groups;
}

function purchaseDetailRowsForPrintGroup(group) {
  var result = [];
  (group.rows || []).forEach(function(row) {
    var info = row && row.lot_info ? row.lot_info : null;
    var attrs = info && Array.isArray(info.quy_cach_items)
      ? info.quy_cach_items.filter(function(item) {
          return Number(item.so_luong || 0) > 0 || item.ten_quy_cach || item.ten_thuoc_tinh;
        })
      : [];
    if (!attrs.length) {
      result.push({
        ten_thuoc_tinh: '--',
        so_luong: Number(row.so_luong || 0),
        don_gia_nhap: Number(row.don_gia_nhap || 0),
        thanh_tien: Number(row.thanh_tien || 0)
      });
      return;
    }
    attrs.forEach(function(item) {
      var qty = Number(item.so_luong || 0);
      var price = Number(
        item.don_gia_nhap != null ? item.don_gia_nhap
          : (item.gia_von != null ? item.gia_von : row.don_gia_nhap || 0)
      );
      var tt = item.thanh_tien != null ? Number(item.thanh_tien) : Math.floor(qty * price);
      result.push({
        ten_thuoc_tinh: item.ten_quy_cach || item.ten_thuoc_tinh || '--',
        so_luong: qty,
        don_gia_nhap: price,
        thanh_tien: tt
      });
    });
  });
  return result.length ? result : [{ ten_thuoc_tinh: '--', so_luong: 0, don_gia_nhap: 0, thanh_tien: 0 }];
}

function buildPurchasePrintGroups(flatItems) {
  var groups = purchaseDetailGroupsForPrint(flatItems);
  return groups.map(function(g) {
    var displayRows = purchaseDetailRowsForPrintGroup(g);
    var sourceRow = g.rows[0] || {};
    var hang = sourceRow.hang_hoa_id || {};
    return {
      product_ma: hang.ma_hang || '',
      product_ten: hang.ten_hang || '',
      lot_label: g.lot_label,
      displayRows: displayRows,
      group_total: Number(g.total || 0),
      giam_gia_dong: sourceRow.giam_gia_dong,
      kieu_giam_gia_dong: sourceRow.kieu_giam_gia_dong || 'vnd',
      ghi_chu_line: String(sourceRow.ghi_chu || '').trim(),
      quy_cach_summary: String(sourceRow.quy_cach_summary || '').trim()
    };
  });
}

function buildPurchasePrintNoteFromOriginalDetail(detail) {
  if (!detail || typeof detail !== 'object') return '';
  var lotInfo = detail.lot_info;
  var rawItems = lotInfo && Array.isArray(lotInfo.quy_cach_items) ? lotInfo.quy_cach_items : [];
  var segments = [];
  for (var i = 0; i < rawItems.length; i++) {
    var qc = rawItems[i] || {};
    var name = String(qc.ten_quy_cach || qc.ten_thuoc_tinh || '').trim();
    var qty = Number(qc.so_luong || 0);
    var price = qc.don_gia_nhap != null ? Number(qc.don_gia_nhap) : (qc.don_gia != null ? Number(qc.don_gia) : Number(qc.gia_von || 0));
    if (!Number.isFinite(qty)) qty = 0;
    if (!Number.isFinite(price)) price = 0;
    if (name && qty > 0) {
      segments.push(name + ' ' + qty.toLocaleString('vi-VN') + ' x ' + price.toLocaleString('vi-VN'));
    }
  }
  if (segments.length) return segments.join('; ');
  return String(detail.ghi_chu || '').trim();
}

exports.buildPurchasePrintNoteFromOriginalDetail = buildPurchasePrintNoteFromOriginalDetail;
exports.buildPurchasePrintGroups = buildPurchasePrintGroups;

async function buildPurchasePrintData(req, title) {
  var storeId = await resolveStoreId(req);
  var loaded = await loadPurchaseWithItems(req.params.id, storeId);
  if (!loaded) return null;
  loaded.items = (loaded.items || []).map(function(item) {
    var plain = item.toObject ? item.toObject() : item;
    plain.quy_cach_summary = buildPurchasePrintNoteFromOriginalDetail(plain);
    return plain;
  });
  var printGroups = buildPurchasePrintGroups(loaded.items);
  var store = loaded.ticket.cua_hang_id || null;
  if (store && store._id) store = store.toObject ? store.toObject() : store;
  if (!store && loaded.ticket.cua_hang_id) store = await CuaHang.findById(loaded.ticket.cua_hang_id).lean();
  var business = store ? {
    ten_cua_hang: store.ten_cua_hang || '',
    ma_so_thue: store.ma_so_thue || '',
    dia_chi_day_du: store.dia_chi_day_du || store.dia_chi || '',
    sdt: store.sdt || '',
    email: store.email || ''
  } : {};
  var supplierId = loaded.ticket.nha_cung_cap_id && (loaded.ticket.nha_cung_cap_id._id || loaded.ticket.nha_cung_cap_id);
  var supplierAddress = null;
  var selectedSupplierAddressId = loaded.ticket.dia_chi_ncc_id && (loaded.ticket.dia_chi_ncc_id._id || loaded.ticket.dia_chi_ncc_id);
  if (supplierId) {
    if (selectedSupplierAddressId) {
      supplierAddress = await DiaChiNcc.findOne({
        _id: selectedSupplierAddressId,
        nha_cung_cap_id: supplierId,
        trang_thai: 'active'
      }).lean();
    }
    if (!supplierAddress) {
      supplierAddress = await DiaChiNcc.findOne({
        nha_cung_cap_id: supplierId,
        trang_thai: 'active'
      })
        .sort({ mac_dinh: -1, created_at: -1 })
        .lean();
    }
  }
  return {
    activeMenu: 'mua-hang',
    user: req.user,
    store: store,
    businessInfo: business,
    supplierAddress: supplierAddress,
    ticket: loaded.ticket,
    items: loaded.items,
    printGroups: printGroups,
    embeddedPrint: String(req.query && req.query.embed || '') === '1',
    formatDate: formatDate
  };
}

async function renderPurchasePrint(req, res, next, viewName, title) {
  try {
    var data = await buildPurchasePrintData(req, title);
    if (!data) return res.status(404).send('Không tìm thấy phiếu nhập');
    return res.render(viewName, data);
  } catch (error) {
    next(error);
  }
}

function safePdfName(prefix, ticket) {
  var code = String(ticket && ticket.ma_phieu_nhap ? ticket.ma_phieu_nhap : 'phieu-nhap')
    .replace(/[^\w.-]+/g, '-');
  return prefix + '-' + code + '.pdf';
}

async function renderPurchasePdf(req, res, next, viewName, title, filenamePrefix) {
  try {
    var data = await buildPurchasePrintData(req, title);
    if (!data) return res.status(404).send('Không tìm thấy phiếu nhập');
    var viewPath = path.join(__dirname, '..', 'views', viewName + '.ejs');
    var html = await pdfService.renderViewToHtml(viewPath, data);
    var buffer = await pdfService.generatePdfFromHtml(html, {
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm'
      }
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + safePdfName(filenamePrefix, data.ticket) + '"');
    return res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
}

exports.printPurchase = async function(req, res, next) {
  return renderPurchasePrint(req, res, next, 'nhap-hang/print-phieu-nhap', 'In phieu nhap hang');
};

exports.printBangKe02Tndn = async function(req, res, next) {
  return renderPurchasePrint(req, res, next, 'nhap-hang/bang-ke-02-tndn', 'Bang ke 02/TNDN');
};

exports.printPurchaseBundle = async function(req, res, next) {
  try {
    var data = await buildPurchasePrintData(req, 'In phiếu nhập và bảng kê 02/TNDN');
    if (!data) return res.status(404).send('Không tìm thấy phiếu nhập');
    return res.render('nhap-hang/print-bundle', data);
  } catch (error) {
    next(error);
  }
};

exports.printContract = async function(req, res, next) {
  return renderPurchasePrint(req, res, next, 'nhap-hang/hd-mua-ban-nguyen-tac', 'HD mua ban nguyen tac');
};

exports.printPhieuNhapPdf = async function(req, res, next) {
  return renderPurchasePdf(req, res, next, 'nhap-hang/print-phieu-nhap', 'In phieu nhap hang', 'phieu-nhap');
};

exports.printBangKe02TndnPdf = async function(req, res, next) {
  return renderPurchasePdf(req, res, next, 'nhap-hang/bang-ke-02-tndn', 'Bang ke 02/TNDN', 'bang-ke-02-tndn');
};

exports.printHdMuaBanNguyenTacPdf = async function(req, res, next) {
  return renderPurchasePdf(req, res, next, 'nhap-hang/hd-mua-ban-nguyen-tac', 'HD mua ban nguyen tac', 'hd-mua-ban-nguyen-tac');
};

exports.exportOneCsv = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var loaded = await loadPurchaseWithItems(req.params.id, storeId);
    if (!loaded) return res.status(404).send('Không tìm thấy phiếu nhập');
    var ticket = loaded.ticket;
    var rows = [
      ['ma_phieu_nhap', ticket.ma_phieu_nhap || ''],
      ['nha_cung_cap', ticket.nha_cung_cap_id?.ten_ncc || ''],
      ['kho', ticket.kho_id?.ten_kho || ticket.kho_id?.ma_kho || ''],
      ['ngay_nhap', ticket.ngay_nhap ? ticket.ngay_nhap.toISOString() : ''],
      ['tong_tien_hang', ticket.tong_tien_hang || 0],
      ['can_tra_ncc', ticket.can_tra_ncc || ticket.tong_tien || 0],
      ['da_tra_ncc', ticket.da_tra_ncc || 0],
      ['con_no_ncc', ticket.con_no_ncc || 0],
      [],
      ['ma_hang', 'ten_hang', 'so_luong', 'don_gia_nhap', 'giam_gia', 'thanh_tien']
    ];
    loaded.items.forEach(function(item) {
      rows.push([
        item.hang_hoa_id?.ma_hang || '',
        item.hang_hoa_id?.ten_hang || '',
        item.so_luong || 0,
        item.don_gia_nhap || 0,
        item.giam_gia_dong || 0,
        item.thanh_tien || 0
      ]);
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + (ticket.ma_phieu_nhap || 'phieu-nhap') + '.csv"');
    return res.send('\uFEFF' + rows.map(function(row) {
      return row.map(csvEscape).join(',');
    }).join('\n'));
  } catch (error) {
    next(error);
  }
};

// Excel export matching the KiotViet-style table
exports.exportOneExcel = async function(req, res, next) {
  try {
    const ExcelJS = require('exceljs');
    const storeId = await resolveStoreId(req);
    const loaded = await loadPurchaseWithItems(req.params.id, storeId);
    if (!loaded) return res.status(404).send('Không tìm thấy phiếu nhập');
    const ticket = loaded.ticket;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Chi tiết phiếu nhập');

    // Define columns (A–J)
    worksheet.columns = [
      { header: 'Mã hàng', key: 'ma_hang', width: 16 },
      { header: 'Tên hàng', key: 'ten_hang', width: 22 },
      { header: 'Đơn vị tính', key: 'don_vi_tinh', width: 14 },
      { header: 'Đơn giá', key: 'don_gia', width: 14 },
      { header: 'Giảm giá', key: 'giam_gia', width: 12 },
      { header: 'Giảm giá', key: 'giam_gia2', width: 12 },
      { header: 'Số lượng', key: 'so_luong', width: 12 },
      { header: 'Giá nhập', key: 'gia_nhap', width: 14 },
      { header: 'Thành tiền', key: 'thanh_tien', width: 16 },
      { header: 'Giá vốn', key: 'gia_von', width: 14 }
    ];

    // Header row styling – dark blue background, white bold text
    var headerRow = worksheet.getRow(1);
    headerRow.eachCell(function(cell) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF305496' } },
        bottom: { style: 'thin', color: { argb: 'FF305496' } },
        left: { style: 'thin', color: { argb: 'FF305496' } },
        right: { style: 'thin', color: { argb: 'FF305496' } }
      };
    });
    headerRow.height = 20;

    // Enable auto-filter on header
    worksheet.autoFilter = { from: 'A1', to: 'J1' };

    // Add data rows
    loaded.items.forEach(function(item) {
      var maHang = item.hang_hoa_id?.ma_hang || '';
      var tenHang = item.hang_hoa_id?.ten_hang || '';
      var donVi = item.don_vi_tinh_id?.ten_don_vi || '';
      var donGia = Number(item.don_gia_nhap || 0);
      var giamGia = Number(item.giam_gia_dong || 0);
      var soLuong = Number(item.so_luong || 0);
      // Giá nhập: from lot if available, otherwise from line don_gia_nhap
      var giaNhap = (item.lo_hang_id && item.lo_hang_id.don_gia_nhap != null)
        ? Number(item.lo_hang_id.don_gia_nhap)
        : donGia;
      var thanhTien = Number(item.thanh_tien || 0);
      // Giá vốn: from lot if available, otherwise from product gia_von
      var giaVon = (item.lo_hang_id && item.lo_hang_id.gia_von != null)
        ? Number(item.lo_hang_id.gia_von)
        : Number(item.hang_hoa_id?.gia_von || 0);

      var row = worksheet.addRow({
        ma_hang: maHang,
        ten_hang: tenHang,
        don_vi_tinh: donVi,
        don_gia: donGia,
        giam_gia: giamGia,
        giam_gia2: giamGia,
        so_luong: soLuong,
        gia_nhap: giaNhap,
        thanh_tien: thanhTien,
        gia_von: giaVon
      });

      // Thin border for data cells
      row.eachCell(function(cell) {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          bottom: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          left: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          right: { style: 'thin', color: { argb: 'FFD9E2F3' } }
        };
      });
    });

    // Number format (1 decimal as shown in screenshot: 0.0, 100.0, 13.0)
    var numericCols = ['don_gia', 'giam_gia', 'giam_gia2', 'so_luong', 'gia_nhap', 'thanh_tien', 'gia_von'];
    numericCols.forEach(function(col) {
      worksheet.getColumn(col).numFmt = '#,##0.0';
    });

    var filename = 'phieu-nhap-' + (ticket.ma_phieu_nhap || 'unknown') + '.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
};

exports.traHangNhapPage = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var returns = await mongoose.models.PhieuTraHangNhap.find(activePurchaseReturnDataFilter(storeId ? { cua_hang_id: storeId } : {}))
      .populate('nha_cung_cap_id')
      .populate('phieu_nhap_id')
      .sort({ ngay_tra: -1 })
      .lean();

    var suppliers = await mongoose.models.NhaCungCap.find(storeId ? { cua_hang_id: storeId } : {}).lean();
    var receipts = await mongoose.models.PhieuNhap.find(activePurchaseDataFilter(storeId ? { cua_hang_id: storeId, trang_thai: 'completed' } : { trang_thai: 'completed' })).lean();
    var products = await mongoose.models.HangHoa.find(storeId ? { cua_hang_id: storeId, trang_thai: 'active' } : { trang_thai: 'active' }).lean();

    res.render('nhap-hang/tra-hang-nhap', {
      activeMenu: 'mua-hang',
      user: req.user,
      returns: returns,
      suppliers: suppliers,
      receipts: receipts,
      products: products
    });
  } catch (error) {
    next(error);
  }
};

exports.mergePurchases = async function(req, res, next) {
  var session = await mongoose.startSession();
  try {
    var result;
    await session.withTransaction(async function() {
      result = await mergePurchasesInSession(req, session);
    });
    res.json({ success: true, message: 'G\u1ed9p phi\u1ebfu nh\u1eadp th\u00e0nh c\u00f4ng', data: result });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    next(error);
  } finally {
    await session.endSession();
  }
};

exports.traHangNhapSubmit = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var body = req.body || {};
    var items = body.items || [];

    if (!items || items.length === 0) return res.json({ success: false, message: 'Chưa có hàng hóa cần trả' });

    var last = await mongoose.models.PhieuTraHangNhap.findOne({ ma_phieu_tra_nhap: /^PTH\d+$/ }).sort({ ma_phieu_tra_nhap: -1 }).lean();
    var nextNumber = last ? Number(String(last.ma_phieu_tra_nhap).replace(/\D/g, '')) + 1 : 1;
    var maPhieu = 'PTH' + String(nextNumber).padStart(6, '0');

    var tongTienTra = items.reduce(function(s, i) {
      return s + (Number(i.so_luong || 0) * Number(i.don_gia || 0));
    }, 0);

    var nccId = String(body.nha_cung_cap_id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(nccId)) nccId = undefined;

    var pnId = String(body.phieu_nhap_id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(pnId)) pnId = undefined;

    var pth = await mongoose.models.PhieuTraHangNhap.create({
      cua_hang_id: storeId,
      ma_phieu_tra_nhap: maPhieu,
      nha_cung_cap_id: nccId,
      phieu_nhap_id: pnId,
      tong_tien_tra: tongTienTra,
      ly_do: String(body.ly_do || ''),
      ghi_chu: String(body.ghi_chu || ''),
      nguoi_tao_id: req.user ? req.user._id : undefined
    });

    var ctRows = items.map(function(it) {
      return {
        phieu_tra_nhap_id: pth._id,
        hang_hoa_id: it.hang_hoa_id,
        so_luong: Number(it.so_luong || 0),
        don_gia: Number(it.don_gia || 0),
        thanh_tien: Number(it.so_luong || 0) * Number(it.don_gia || 0)
      };
    });
    await mongoose.models.CtPhieuTraHangNhap.insertMany(ctRows);

    var kho = await mongoose.models.Kho.findOne(storeId ? { cua_hang_id: storeId } : {}).lean();
    if (kho) {
      for (var i = 0; i < ctRows.length; i++) {
        var row = ctRows[i];
        if (row.so_luong > 0) {
          var updatedInv = await mongoose.models.TonKho.findOneAndUpdate(
            { cua_hang_id: storeId, kho_id: kho._id, hang_hoa_id: row.hang_hoa_id },
            { $inc: { so_luong: -row.so_luong } },
            { upsert: true, new: true }
          ).lean();
          await mongoose.models.LichSuKho.create({
            cua_hang_id: storeId,
            kho_id: kho._id,
            hang_hoa_id: row.hang_hoa_id,
            nguoi_tao_id: req.user ? req.user._id : undefined,
            loai_phieu: 'xuat_huy',
            ma_phieu: maPhieu,
            so_luong_thay_doi: -row.so_luong,
            ton_kho_sau: Number(updatedInv?.so_luong || 0),
            ghi_chu: 'Trả hàng nhập'
          });
        }
      }
    }

    res.json({ success: true, pth });
  } catch (error) {
    res.json({ success: false, message: error.message });
    }
};

exports.redirectDetail = async function(req, res) {
  return res.redirect('/nhap-hang?purchase=' + encodeURIComponent(req.params.id));
};
