var mongoose = require('mongoose');
var querystring = require('querystring');
var ExcelJS = require('exceljs');
var { NhaCungCap, NhomNhaCungCap, PhieuNhap, PhieuTraHangNhap, CongNoNhaCungCap, GiaoDichCongNoNhaCungCap, CuaHang, DiaChiNcc, DiaChiDoiTuong, LoaiDiaChiKhachHang, PhieuXuatNoiBo, CTXuatNoiBo, SoQuy, PhieuThuChi, Counter, NhapVatChua, XuatVatChua } = require('../models/kiot.model');
var { taoPhieuThuChi, parseMoney } = require('../services/soQuy.service');
var { buildReceiptPaymentInfo } = require('../services/paymentCashBook.service');
var { normalizeAddress } = require('../utils/address');
var {
    measureAsync,
    measureSync,
    isPerformanceEnabled
} = require('../utils/performance.util');
var { buildSupplierHangHoaExportPack } = require('../services/supplierHangHoaExport.service');
var { buildSupplierPurchaseInvoiceExportPack } = require('../services/supplierPurchaseInvoiceExport.service');
var { handleSupplierDebtExport } = require('../services/supplierDebtExport.service');
var nhaCungCapImportService = require('../services/nhaCungCapImport.service');
var DiaChiNhaCungCap = DiaChiNcc || DiaChiDoiTuong;
var SUPPLIER_TABLE_METRICS_LIMIT = 100;

var SUPPLIER_EXPORT_COLUMNS = [
    { header: 'Mã NCC', key: 'ma_ncc' },
    { header: 'Tên nhà cung cấp', key: 'ten_ncc' },
    { header: 'Người liên hệ', key: 'nguoi_lien_he' },
    { header: 'Điện thoại', key: 'dien_thoai' },
    { header: 'Email', key: 'email' },
    { header: 'Địa chỉ', key: 'dia_chi' },
    { header: 'Tỉnh/TP', key: 'tinh_tp' },
    { header: 'Phường/Xã', key: 'phuong_xa' },
    { header: 'Mã số thuế', key: 'ma_so_thue' },
    { header: 'Nhóm nhà cung cấp', key: 'nhom_nha_cung_cap' },
    { header: 'Tổng mua', key: 'tong_mua', style: { numFmt: '#,##0' } },
    { header: 'Đã trả NCC', key: 'da_tra_ncc', style: { numFmt: '#,##0' } },
    { header: 'Nợ NCC', key: 'no_ncc', style: { numFmt: '#,##0' } },
    { header: 'Trạng thái', key: 'trang_thai' },
    { header: 'Ngày tạo', key: 'ngay_tao' },
    { header: 'Người tạo', key: 'nguoi_tao' },
    { header: 'Ghi chú', key: 'ghi_chu' }
];

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

function normalizeSupplierPayload(body) {
    body = body || {};
    return {
        ma_ncc: String(body.ma_ncc || '').trim(),
        ten_ncc: String(body.ten_ncc || '').trim(),
        sdt: String(body.sdt || '').trim(),
        email: String(body.email || '').trim(),
        ten_cong_ty: String(body.ten_cong_ty || '').trim(),
        ma_so_thue: String(body.ma_so_thue || '').trim(),
        ghi_chu: String(body.ghi_chu || '').trim(),
        trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
    };
}

function slugifyFilePart(value) {
    var s = String(value || 'ncc').trim().replace(/[/\\?%*:|"<>]/g, '-');
    s = s.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return s || 'ncc';
}

function normalizeSupplierObjectIds(supplierIds) {
    var source = Array.isArray(supplierIds) ? supplierIds : (supplierIds ? [supplierIds] : []);
    var seen = {};
    var ids = [];
    source.forEach(function(value) {
        var id = String(value || '').trim();
        if (!id || seen[id] || !mongoose.Types.ObjectId.isValid(id)) return;
        seen[id] = true;
        ids.push(new mongoose.Types.ObjectId(id));
    });
    return ids;
}

async function aggregateSupplierPurchaseTotals(storeId, supplierIds) {
    var purchaseMatch = {
        trang_thai: 'completed',
        deleted_at: null,
        nha_cung_cap_id: { $exists: true, $ne: null }
    };
    var debtMatch = {
        nha_cung_cap_id: { $exists: true, $ne: null }
    };
    var debtTransactionMatch = {
        nha_cung_cap_id: { $exists: true, $ne: null },
        trang_thai: 'active'
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        var storeObjectId = new mongoose.Types.ObjectId(String(storeId));
        purchaseMatch.cua_hang_id = storeObjectId;
        debtMatch.cua_hang_id = storeObjectId;
        debtTransactionMatch.cua_hang_id = storeObjectId;
    }
    var supplierObjectIds = normalizeSupplierObjectIds(supplierIds);
    if (supplierObjectIds.length) {
        purchaseMatch.nha_cung_cap_id = { $in: supplierObjectIds };
        debtMatch.nha_cung_cap_id = { $in: supplierObjectIds };
        debtTransactionMatch.nha_cung_cap_id = { $in: supplierObjectIds };
    }
    var purchaseRows = await PhieuNhap.aggregate([
        { $match: purchaseMatch },
        {
            $group: {
                _id: '$nha_cung_cap_id',
                tong_mua: { $sum: { $ifNull: ['$tong_tien', 0] } },
                da_tra_phieu_nhap: { $sum: { $ifNull: ['$da_tra_ncc', 0] } }
            }
        }
    ]);
    var debtRows = await CongNoNhaCungCap.find(debtMatch)
        .populate({ path: 'phieu_nhap_id', select: 'deleted_at' })
        .populate({ path: 'nhap_vat_chua_id', select: 'deleted_at' })
        .populate({ path: 'phieu_tra_nhap_id', select: 'deleted_at' })
        .populate({ path: 'phieu_thu_chi_id', select: 'deleted_at trang_thai' })
        .lean();
    var debtTransactionRows = GiaoDichCongNoNhaCungCap ? await GiaoDichCongNoNhaCungCap.find(debtTransactionMatch)
        .populate({ path: 'phieu_nhap_id', select: 'deleted_at trang_thai' })
        .populate({ path: 'phieu_tra_hang_nhap_id', select: 'deleted_at trang_thai' })
        .populate({ path: 'phieu_thu_chi_id', select: 'deleted_at trang_thai' })
        .lean() : [];
    var map = {};
    purchaseRows.forEach(function(r) {
        if (!r._id) return;
        map[String(r._id)] = {
            tong_mua: Number(r.tong_mua || 0),
            tong_no: 0,
            da_tra_tong: 0,
            da_tra_phieu_nhap: Number(r.da_tra_phieu_nhap || 0)
        };
    });
    debtRows.filter(isVisibleSupplierDebtRow).forEach(function(r) {
        if (!r.nha_cung_cap_id) return;
        var key = String(r.nha_cung_cap_id);
        if (!map[key]) map[key] = { tong_mua: 0, tong_no: 0, da_tra_tong: 0, da_tra_phieu_nhap: 0 };
        var amount = Number(r.so_tien || 0);
        if (r.loai === 'tang_no') map[key].tong_no += amount;
        if (r.loai === 'giam_no' || r.loai === 'thanh_toan') map[key].tong_no -= amount;
        if (r.loai === 'thanh_toan') map[key].da_tra_tong = Number(map[key].da_tra_tong || 0) + amount;
    });
    debtTransactionRows.filter(isVisibleSupplierDebtRow).forEach(function(r) {
        if (!r.nha_cung_cap_id) return;
        var key = String(r.nha_cung_cap_id);
        if (!map[key]) map[key] = { tong_mua: 0, tong_no: 0, da_tra_tong: 0, da_tra_phieu_nhap: 0 };
        var amount = Number(r.gia_tri || 0);
        if (r.huong_cong_no === 'tang_no') map[key].tong_no += amount;
        if (r.huong_cong_no === 'giam_no') map[key].tong_no -= amount;
        if (r.loai_giao_dich === 'thanh_toan') map[key].da_tra_tong += amount;
    });
    Object.keys(map).forEach(function(key) {
        if (Number(map[key].da_tra_tong || 0) <= 0) {
            map[key].da_tra_tong = Number(map[key].da_tra_phieu_nhap || 0);
        }
    });
    return map;
}

async function aggregateSupplierDebtDayInfo(storeId, supplierIds) {
    var match = {
        trang_thai: 'completed',
        deleted_at: null,
        nha_cung_cap_id: { $exists: true, $ne: null },
        con_no_ncc: { $gt: 0 }
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        match.cua_hang_id = new mongoose.Types.ObjectId(String(storeId));
    }
    var supplierObjectIds = normalizeSupplierObjectIds(supplierIds);
    if (supplierObjectIds.length) {
        match.nha_cung_cap_id = { $in: supplierObjectIds };
    }
    var rows = await PhieuNhap.aggregate([
        { $match: match },
        { $sort: { ngay_nhap: 1, created_at: 1 } },
        {
            $group: {
                _id: '$nha_cung_cap_id',
                ngay_no_xa_nhat: { $first: { $ifNull: ['$ngay_nhap', '$created_at'] } },
                no_xa_nhat_ma_phieu: { $first: '$ma_phieu_nhap' },
                no_xa_nhat_tien: { $first: '$con_no_ncc' },
                ngay_no_gan_nhat: { $last: { $ifNull: ['$ngay_nhap', '$created_at'] } }
            }
        }
    ]);
    var now = Date.now();
    var map = {};
    rows.forEach(function(row) {
        if (!row || !row._id) return;
        var oldestTs = new Date(row.ngay_no_xa_nhat || 0).getTime();
        var newestTs = new Date(row.ngay_no_gan_nhat || 0).getTime();
        map[String(row._id)] = {
            ngay_no_xa_nhat: row.ngay_no_xa_nhat || null,
            ngay_no_gan_nhat: row.ngay_no_gan_nhat || null,
            no_xa_nhat_ma_phieu: String(row.no_xa_nhat_ma_phieu || '').trim(),
            no_xa_nhat_tien: Math.max(0, Number(row.no_xa_nhat_tien || 0)),
            so_ngay_no_xa: oldestTs > 0 ? Math.max(0, Math.floor((now - oldestTs) / 86400000)) : null,
            so_ngay_no_gan: newestTs > 0 ? Math.max(0, Math.floor((now - newestTs) / 86400000)) : null
        };
    });
    return map;
}

function applySupplierDebtDayInfo(supplier, debtDayMap) {
    if (!supplier) return;
    var info = debtDayMap ? debtDayMap[String(supplier._id)] : null;
    supplier.ngay_no_xa_nhat = info ? info.ngay_no_xa_nhat : null;
    supplier.ngay_no_gan_nhat = info ? info.ngay_no_gan_nhat : null;
    supplier.so_ngay_no_xa = info && info.so_ngay_no_xa != null ? info.so_ngay_no_xa : null;
    supplier.so_ngay_no_gan = info && info.so_ngay_no_gan != null ? info.so_ngay_no_gan : null;
    supplier.no_xa_nhat_ma_phieu = info ? (info.no_xa_nhat_ma_phieu || '') : '';
    supplier.no_xa_nhat_tien = info ? Number(info.no_xa_nhat_tien || 0) : 0;
}

var SUPPLIER_DEBT_WARN_DEFAULT_DAYS = 10;

function normalizeDebtWarnSettings(filter) {
    filter = filter || {};
    var warnMinDaysRaw = parseInt(String(filter.warnMinDays != null ? filter.warnMinDays : SUPPLIER_DEBT_WARN_DEFAULT_DAYS), 10);
    return {
        warnOnly: String(filter.warnOnly || '') === '1',
        warnMinDays: Number.isFinite(warnMinDaysRaw) && warnMinDaysRaw >= 0 ? warnMinDaysRaw : SUPPLIER_DEBT_WARN_DEFAULT_DAYS,
        warnMinAmount: hasFilterQueryValue(filter.warnMinAmount) ? Math.max(0, parseMoney(filter.warnMinAmount)) : 0
    };
}

function evaluateSupplierDebtWarning(supplier, settings) {
    var debt = Number(supplier && supplier.tong_no || 0);
    if (debt <= 0) return false;
    var days = Number(supplier.so_ngay_no_xa);
    var hasDays = Number.isFinite(days);
    var meetsDays = hasDays && days >= Number(settings.warnMinDays || SUPPLIER_DEBT_WARN_DEFAULT_DAYS);
    var minAmount = Number(settings.warnMinAmount || 0);
    var meetsAmount = minAmount > 0 && debt >= minAmount;
    if (minAmount > 0 && settings.warnMinDays >= 0) return meetsDays || meetsAmount;
    if (minAmount > 0) return meetsAmount;
    return meetsDays;
}

function applySupplierDebtWarning(supplier, settings) {
    if (!supplier) return;
    supplier.debt_warning = evaluateSupplierDebtWarning(supplier, settings);
}

function filterSuppliersByDebtWarning(suppliers, settings) {
    if (!settings || !settings.warnOnly) return suppliers;
    return suppliers.filter(function(supplier) {
        return evaluateSupplierDebtWarning(supplier, settings);
    });
}

function enrichSupplierDebtHistory(rows, warnMinDays) {
    var minDays = Number(warnMinDays) >= 0 ? Number(warnMinDays) : SUPPLIER_DEBT_WARN_DEFAULT_DAYS;
    var now = Date.now();
    return (rows || []).map(function(row) {
        var copy = Object.assign({}, row);
        var conLai = Number(copy.con_lai || 0);
        var thoiGian = copy.thoi_gian;
        var days = null;
        if (thoiGian) {
            var ts = new Date(thoiGian).getTime();
            if (ts > 0) days = Math.max(0, Math.floor((now - ts) / 86400000));
        }
        copy.so_ngay_no = days;
        copy.co_no_con_lai = conLai > 0;
        copy.is_debt_overdue = conLai > 0 && days != null && days >= minDays;
        return copy;
    });
}

function sortSupplierDebtHistoryRows(rows) {
    return rows.slice().sort(function(a, b) {
        return new Date(b.thoi_gian || 0).getTime() - new Date(a.thoi_gian || 0).getTime();
    });
}

function sortSuppliersByDebtDaySort(suppliers, debtDaySort) {
    if (debtDaySort !== 'oldest' && debtDaySort !== 'newest') return suppliers;
    return suppliers.slice().sort(function(a, b) {
        var debtA = Number(a.tong_no || 0);
        var debtB = Number(b.tong_no || 0);
        if (debtA <= 0 && debtB <= 0) {
            return String(a.ma_ncc || '').localeCompare(String(b.ma_ncc || ''), 'vi');
        }
        if (debtA <= 0) return 1;
        if (debtB <= 0) return -1;
        if (debtDaySort === 'oldest') {
            var daysOldestA = Number(a.so_ngay_no_xa != null ? a.so_ngay_no_xa : -1);
            var daysOldestB = Number(b.so_ngay_no_xa != null ? b.so_ngay_no_xa : -1);
            if (daysOldestB !== daysOldestA) return daysOldestB - daysOldestA;
            return String(a.ma_ncc || '').localeCompare(String(b.ma_ncc || ''), 'vi');
        }
        var daysNewestA = Number(a.so_ngay_no_gan != null ? a.so_ngay_no_gan : 999999);
        var daysNewestB = Number(b.so_ngay_no_gan != null ? b.so_ngay_no_gan : 999999);
        if (daysNewestA !== daysNewestB) return daysNewestA - daysNewestB;
        return String(a.ma_ncc || '').localeCompare(String(b.ma_ncc || ''), 'vi');
    });
}

function getDebtDocumentInfo(row) {
    if (row.phieu_tra_nhap_id) {
        return {
            type: 'tra_hang_nhap',
            label: 'Trả hàng nhập',
            doc: row.phieu_tra_nhap_id,
            code: row.phieu_tra_nhap_id.ma_phieu_tra_nhap || '--'
        };
    }
    if (row.phieu_thu_chi_id) {
        var receiptType = row.phieu_thu_chi_id.loai_phieu;
        var receiptKind = String(row.phieu_thu_chi_id.loai_thu_chi || '').toLowerCase();
        var isVatChuaReturn = receiptType === 'thu' && receiptKind.indexOf('trả vật chứa') >= 0;
        return {
            type: isVatChuaReturn ? 'tra_vat_chua' : 'phieu_thu_chi',
            label: receiptType === 'thu' ? 'Phiếu thu' : (receiptType === 'chi' ? 'Phiếu chi' : 'Phiếu thu/chi'),
            doc: row.phieu_thu_chi_id,
            code: row.phieu_thu_chi_id.ma_phieu || '--'
        };
    }
    if (row.phieu_nhap_id) {
        return {
            type: 'phieu_nhap',
            label: 'Phiếu nhập',
            doc: row.phieu_nhap_id,
            code: row.phieu_nhap_id.ma_phieu_nhap || '--'
        };
    }
    if (row.nhap_vat_chua_id) {
        return {
            type: 'nhap_vat_chua',
            label: 'Nhập vật chứa',
            doc: row.nhap_vat_chua_id,
            code: row.nhap_vat_chua_id.ma_nhap_vat_chua || '--'
        };
    }
    return { type: '', label: 'Khác', doc: null, code: '--' };
}

function isDeletedDebtLinkedDoc(doc) {
    return !!(doc && typeof doc === 'object' && (doc.deleted_at || doc.trang_thai === 'cancelled'));
}

function isVisibleSupplierDebtRow(row) {
    if (!row) return false;
    if (row.phieu_nhap_id && isDeletedDebtLinkedDoc(row.phieu_nhap_id)) return false;
    if (row.nhap_vat_chua_id && isDeletedDebtLinkedDoc(row.nhap_vat_chua_id)) return false;
    if (row.phieu_tra_nhap_id && isDeletedDebtLinkedDoc(row.phieu_tra_nhap_id)) return false;
    if (row.phieu_tra_hang_nhap_id && isDeletedDebtLinkedDoc(row.phieu_tra_hang_nhap_id)) return false;
    if (row.phieu_thu_chi_id && isDeletedDebtLinkedDoc(row.phieu_thu_chi_id)) return false;
    return true;
}

function getSupplierDebtAmountInfo(row, amount, runningDebt) {
    var docInfo = getDebtDocumentInfo(row);
    var doc = docInfo.doc || {};
    var value = Number(amount || 0);
    var paid = 0;
    var remaining = Math.max(0, Number(runningDebt || 0));

    if (docInfo.type === 'phieu_nhap') {
        value = Number(doc.can_tra_ncc || doc.tong_tien || amount || 0);
        paid = Number(doc.da_tra_ncc || 0);
        remaining = Number(doc.con_no_ncc || Math.max(0, value - paid));
    } else if (docInfo.type === 'tra_hang_nhap') {
        value = Number(doc.ncc_can_tra || doc.tong_tien_tra || amount || 0);
        paid = Number(doc.ncc_da_tra || 0);
        remaining = Math.max(0, value - paid);
    } else if (row.loai === 'giam_no' || row.loai === 'thanh_toan') {
        paid = value;
    }

    return {
        gia_tri: value,
        da_thanh_toan: paid,
        con_lai: remaining,
        tong_no: Number(runningDebt || 0)
    };
}

function getLegacySupplierDebtDelta(row, amount) {
    var value = Number(amount || 0);
    var receiptType = row && row.phieu_thu_chi_id && row.phieu_thu_chi_id.loai_phieu;
    if (receiptType === 'thu') return value;
    if (row && row.loai === 'tang_no') return value;
    if (row && (row.loai === 'giam_no' || row.loai === 'thanh_toan')) return -value;
    return 0;
}

function getDebtEventTime(row) {
    if (!row) return 0;
    if (row.phieu_tra_nhap_id) {
        return new Date(row.phieu_tra_nhap_id.ngay_tra || row.ngay || row.phieu_tra_nhap_id.created_at || row.created_at || 0).getTime();
    }
    if (row.nhap_vat_chua_id) {
        return new Date(row.nhap_vat_chua_id.created_at || row.ngay || row.created_at || 0).getTime();
    }
    if (row.phieu_nhap_id) {
        return new Date(row.phieu_nhap_id.ngay_nhap || row.ngay || row.phieu_nhap_id.created_at || row.created_at || 0).getTime();
    }
    return new Date(row.ngay || row.created_at || 0).getTime();
}

function getDebtDisplayDate(row) {
    if (row && row.phieu_tra_nhap_id) return row.phieu_tra_nhap_id.ngay_tra || row.ngay || row.phieu_tra_nhap_id.created_at || row.created_at;
    if (row && row.nhap_vat_chua_id) return row.nhap_vat_chua_id.created_at || row.ngay || row.created_at;
    if (row && row.phieu_nhap_id) return row.phieu_nhap_id.ngay_nhap || row.ngay || row.phieu_nhap_id.created_at || row.created_at;
    return row ? (row.ngay || row.created_at) : null;
}

function getDebtSortCreatedTime(row) {
    if (!row) return 0;
    return new Date(row.created_at || row.updated_at || 0).getTime();
}

function getDebtSortCode(row) {
    if (!row) return '';
    return String(row._id || row.ma_giao_dich || row.ma_phieu || row.ma_phieu_tra_nhap || row.ma_nhap_vat_chua || '');
}

function sortDebtLedgerAsc(a, b) {
    var timeA = new Date(a && a.date || 0).getTime();
    var timeB = new Date(b && b.date || 0).getTime();
    if (timeA !== timeB) return timeA - timeB;

    var createdA = getDebtSortCreatedTime(a && a.row);
    var createdB = getDebtSortCreatedTime(b && b.row);
    if (createdA !== createdB) return createdA - createdB;

    return getDebtSortCode(a && a.row).localeCompare(getDebtSortCode(b && b.row));
}

function mapSupplierDebtTransactionLabel(value) {
    if (value === 'nhap_hang') return 'Phiếu nhập';
    if (value === 'tra_hang_nhap') return 'Trả hàng nhập';
    if (value === 'thanh_toan') return 'Thanh toán';
    if (value === 'chiet_khau_thanh_toan') return 'Chiết khấu thanh toán';
    if (value === 'dieu_chinh_tang') return 'Điều chỉnh tăng';
    if (value === 'dieu_chinh_giam') return 'Điều chỉnh giảm';
    return 'Khác';
}

function resolveSupplierDaThanhToan(supplier) {
    var totalBuy = Number(supplier && supplier.tong_mua || 0);
    var debt = Number(supplier && supplier.tong_no || 0);
    var paid = Number(supplier && supplier.da_tra_tong || 0);
    if (!Number.isFinite(paid) || paid < 0) paid = 0;
    if (!paid && (totalBuy || debt)) {
        paid = Math.max(0, totalBuy - debt);
    }
    return paid;
}

function applySupplierTotalsFromMap(supplier, totalsMap) {
    if (!supplier) return;
    var currentDebt = Number(supplier.tong_no || 0);
    var t = totalsMap[String(supplier._id)];
    if (t) {
        supplier.tong_mua = t.tong_mua;
        supplier.tong_no_theo_so = t.tong_no;
        supplier.da_tra_tong = t.da_tra_tong;
    } else {
        supplier.tong_mua = 0;
        supplier.tong_no_theo_so = 0;
        supplier.da_tra_tong = 0;
    }
    supplier.tong_no = currentDebt;
    supplier.da_thanh_toan = resolveSupplierDaThanhToan(supplier);
}

function normalizeIdParam(value) {
    return String(value || '').trim();
}

function normalizeIdList(value) {
    var source = Array.isArray(value) ? value : [value];
    return source
        .map(function(item) { return String(item || '').trim(); })
        .filter(Boolean);
}

function shouldRespondJson(req) {
    var accept = String(req?.headers?.accept || '').toLowerCase();
    var requestedWith = String(req?.headers?.['x-requested-with'] || '').toLowerCase();
    return requestedWith === 'xmlhttprequest' || accept.indexOf('application/json') >= 0;
}

async function loadSupplierGroups() {
    return await NhomNhaCungCap.find({}).sort({ ten_nhom_ncc: 1 }).lean();
}

async function makeSupplierGroupCode() {
    var groups = await NhomNhaCungCap.find({ ma_nhom_ncc: /^NNCC\d+$/ }).select('ma_nhom_ncc').lean();
    var maxNumber = 0;
    for (var group of groups) {
        var number = Number(String(group.ma_nhom_ncc || '').replace(/\D/g, ''));
        if (Number.isFinite(number) && number > maxNumber) maxNumber = number;
    }
    return 'NNCC' + String(maxNumber + 1).padStart(4, '0');
}

function respondSupplierGroupError(req, res, statusCode, message) {
    console.error('[SupplierGroup]', message);
    if (shouldRespondJson(req)) {
        return res.status(statusCode || 400).json({ success: false, message: message || 'Không thể xử lý nhóm nhà cung cấp.' });
    }
    return res.redirect('/nha-cung-cap?error=group_error');
}

async function loadAddressTypes() {
    if (!LoaiDiaChiKhachHang) return [];
    return await LoaiDiaChiKhachHang.find({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
}

function normalizeAddressTypeCode(value) {
    var text = String(value || '').trim().toLowerCase();
    text = text.normalize ? text.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : text;
    text = text.replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return text || 'loai_dia_chi';
}

async function makeAddressTypeCode(name) {
    var base = normalizeAddressTypeCode(name);
    var code = base;
    var index = 1;
    while (await LoaiDiaChiKhachHang.exists({ ma_loai: code })) {
        index += 1;
        code = base + '_' + index;
    }
    return code;
}

function respondAddressTypeError(req, res, statusCode, message) {
    console.error('[AddressType]', message);
    if (shouldRespondJson(req)) {
        return res.status(statusCode || 400).json({ success: false, message: message || 'Không thể xử lý loại địa chỉ.' });
    }
    return res.redirect('/nha-cung-cap?error=address_type_error');
}

function normalizeFilterMoneyField(value) {
    var raw = String(value || '').trim();
    if (raw === '') return '';
    var amount = parseMoney(raw);
    if (!Number.isFinite(amount) || amount < 0) return '';
    return String(Math.floor(amount));
}

function formatFilterMoneyDisplay(value) {
    if (value === '' || value == null) return '';
    var amount = parseMoney(value);
    if (!Number.isFinite(amount)) return '';
    return amount.toLocaleString('vi-VN');
}

function hasFilterQueryValue(value) {
    return String(value ?? '').trim() !== '';
}

function normalizeFilterQuery(query) {
    query = query || {};
    var groupId = String(query.groupId || query.groupid || 'all').trim() || 'all';
    var status = query.status === 'active' || query.status === 'inactive' ? query.status : 'all';
    var totalBuyFrom = normalizeFilterMoneyField(query.totalBuyFrom);
    var totalBuyTo = normalizeFilterMoneyField(query.totalBuyTo);
    var currentDebtFrom = normalizeFilterMoneyField(query.currentDebtFrom);
    var currentDebtTo = normalizeFilterMoneyField(query.currentDebtTo);
    var created = ['all', 'today', '7days', '30days', 'custom'].indexOf(query.created) >= 0 ? query.created : 'all';
    var createdFrom = String(query.createdFrom || '').trim();
    var createdTo = String(query.createdTo || '').trim();
    var debtDaySort = String(query.debtDaySort || '').trim();
    if (['oldest', 'newest'].indexOf(debtDaySort) < 0) debtDaySort = '';
    var warnMinDaysRaw = parseInt(String(query.warnMinDays != null && query.warnMinDays !== '' ? query.warnMinDays : SUPPLIER_DEBT_WARN_DEFAULT_DAYS), 10);
    var warnMinDays = Number.isFinite(warnMinDaysRaw) && warnMinDaysRaw >= 0 ? warnMinDaysRaw : SUPPLIER_DEBT_WARN_DEFAULT_DAYS;

    return {
        groupId: groupId,
        status: status,
        totalBuyFrom: totalBuyFrom,
        totalBuyTo: totalBuyTo,
        currentDebtFrom: currentDebtFrom,
        currentDebtTo: currentDebtTo,
        created: created,
        createdFrom: createdFrom,
        createdTo: createdTo,
        debtDaySort: debtDaySort,
        warnOnly: String(query.warnOnly || '') === '1' ? '1' : '',
        warnMinDays: String(warnMinDays),
        warnMinAmount: normalizeFilterMoneyField(query.warnMinAmount)
    };
}

function requiresComputedSupplierData(filter) {
    filter = filter || {};
    return Boolean(
        hasFilterQueryValue(filter.totalBuyFrom) ||
        hasFilterQueryValue(filter.totalBuyTo) ||
        hasFilterQueryValue(filter.currentDebtFrom) ||
        hasFilterQueryValue(filter.currentDebtTo) ||
        filter.warnOnly === '1' ||
        filter.debtDaySort === 'oldest' ||
        filter.debtDaySort === 'newest'
    );
}

function normalizeSupplierMetricIds(value) {
    var source = Array.isArray(value) ? value.join(',') : String(value || '');
    var seen = {};
    var ids = [];
    source.split(',').forEach(function(item) {
        var id = String(item || '').trim();
        if (!id || seen[id] || !mongoose.Types.ObjectId.isValid(id)) return;
        seen[id] = true;
        ids.push(id);
    });
    return ids;
}

function countSupplierMetricIdCandidates(value) {
    var source = Array.isArray(value) ? value.join(',') : String(value || '');
    return source.split(',').map(function(item) {
        return String(item || '').trim();
    }).filter(Boolean).length;
}

function buildSupplierStoreAccessQuery(storeId) {
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) return {};
    var storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    return {
        $or: [
            { cua_hang_id: storeObjectId },
            { cua_hang_id: null },
            { cua_hang_id: { $exists: false } }
        ]
    };
}

async function resolveStoreId(req) {
    var sessionStoreId = req && req.session ? String(req.session.cua_hang_id || '').trim() : '';
    if (sessionStoreId && mongoose.Types.ObjectId.isValid(sessionStoreId)) return sessionStoreId;
    var userStoreId = req && req.user ? String(req.user.cua_hang_id || '').trim() : '';
    if (userStoreId && mongoose.Types.ObjectId.isValid(userStoreId)) return userStoreId;
    var activeStore = await CuaHang.findOne({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
    return activeStore ? String(activeStore._id) : '';
}

function mapNhapHangStatus(value) {
    if (value === 'draft') return 'Phiếu tạm';
    if (value === 'cancelled') return 'Đã hủy';
    return 'Đã nhập hàng';
}

function mapCongNoLoai(value) {
    if (value === 'thanh_toan') return 'Thanh toán';
    if (value === 'giam_no') return 'Giảm nợ';
    return 'Nhập hàng';
}

function mapCongNoDirection(value) {
    return value === 'tang_no' ? 'Tăng nợ' : 'Giảm nợ';
}

function getDateRange(filter) {
    var now = new Date();
    var start = null;
    var end = null;

    if (filter.created === 'today') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }
    if (filter.created === '7days') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }
    if (filter.created === '30days') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }
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

function buildFilterQueryString(filter) {
    var params = [];
    if (filter.groupId !== 'all') params.push('groupId=' + encodeURIComponent(filter.groupId));
    if (filter.status !== 'all') params.push('status=' + encodeURIComponent(filter.status));
    if (hasFilterQueryValue(filter.totalBuyFrom)) params.push('totalBuyFrom=' + encodeURIComponent(filter.totalBuyFrom));
    if (hasFilterQueryValue(filter.totalBuyTo)) params.push('totalBuyTo=' + encodeURIComponent(filter.totalBuyTo));
    if (hasFilterQueryValue(filter.currentDebtFrom)) params.push('currentDebtFrom=' + encodeURIComponent(filter.currentDebtFrom));
    if (hasFilterQueryValue(filter.currentDebtTo)) params.push('currentDebtTo=' + encodeURIComponent(filter.currentDebtTo));
    if (filter.created !== 'all') params.push('created=' + encodeURIComponent(filter.created));
    if (filter.created === 'custom' && filter.createdFrom) params.push('createdFrom=' + encodeURIComponent(filter.createdFrom));
    if (filter.created === 'custom' && filter.createdTo) params.push('createdTo=' + encodeURIComponent(filter.createdTo));
    if (filter.debtDaySort === 'oldest' || filter.debtDaySort === 'newest') {
        params.push('debtDaySort=' + encodeURIComponent(filter.debtDaySort));
    }
    if (filter.warnOnly === '1') params.push('warnOnly=1');
    if (filter.warnMinDays && String(filter.warnMinDays) !== String(SUPPLIER_DEBT_WARN_DEFAULT_DAYS)) {
        params.push('warnMinDays=' + encodeURIComponent(filter.warnMinDays));
    }
    if (hasFilterQueryValue(filter.warnMinAmount)) {
        params.push('warnMinAmount=' + encodeURIComponent(filter.warnMinAmount));
    }
    return params.join('&');
}

function makeRangeFilter(minRaw, maxRaw) {
    var hasMinValue = hasFilterQueryValue(minRaw);
    var hasMaxValue = hasFilterQueryValue(maxRaw);
    if (!hasMinValue && !hasMaxValue) return null;

    var min = hasMinValue ? parseMoney(minRaw) : NaN;
    var max = hasMaxValue ? parseMoney(maxRaw) : NaN;
    var hasMin = hasMinValue && Number.isFinite(min);
    var hasMax = hasMaxValue && Number.isFinite(max);
    if (!hasMin && !hasMax) return null;

    var range = {};
    if (hasMin) range.$gte = min < 0 ? 0 : min;
    if (hasMax) range.$lte = max < 0 ? 0 : max;
    if (hasMin && hasMax && range.$gte > range.$lte) {
        var swap = range.$gte;
        range.$gte = range.$lte;
        range.$lte = swap;
    }
    return range;
}

function buildSupplierQueryFromFilter(filter) {
    var dateRange = getDateRange(filter);
    var supplierQuery = {};

    if (filter.groupId !== 'all') supplierQuery.nhom_nha_cung_cap_id = filter.groupId;
    if (filter.status !== 'all') supplierQuery.trang_thai = filter.status;
    if (dateRange.start || dateRange.end) {
        supplierQuery.created_at = {};
        if (dateRange.start) supplierQuery.created_at.$gte = dateRange.start;
        if (dateRange.end) supplierQuery.created_at.$lte = dateRange.end;
    }

    return supplierQuery;
}

function isInRange(value, range) {
    if (!range) return true;
    var number = Math.max(0, Number(value || 0));
    if (range.$gte != null && number < range.$gte) return false;
    if (range.$lte != null && number > range.$lte) return false;
    return true;
}

function filterSuppliersByComputedTotals(suppliers, filter) {
    var totalBuyRange = makeRangeFilter(filter.totalBuyFrom, filter.totalBuyTo);
    var currentDebtRange = makeRangeFilter(filter.currentDebtFrom, filter.currentDebtTo);
    if (!totalBuyRange && !currentDebtRange) return suppliers;
    return suppliers.filter(function(supplier) {
        return isInRange(supplier.tong_mua, totalBuyRange) && isInRange(supplier.tong_no, currentDebtRange);
    });
}

function formatExportDate(value) {
    if (!value) return '';
    return new Date(value).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

function getUserName(user) {
    return user ? (user.ho_ten || user.username || user.email || '') : '';
}

function getSupplierStatusLabel(value) {
    return value === 'inactive' ? 'Ngừng hoạt động' : 'Đang hoạt động';
}

function buildSupplierExportRow(supplier, address) {
    var debt = Number(supplier.tong_no || 0);
    var totalBuy = Number(supplier.tong_mua || 0);
    var paid = resolveSupplierDaThanhToan(supplier);
    return {
        ma_ncc: supplier.ma_ncc || '',
        ten_ncc: supplier.ten_ncc || '',
        nguoi_lien_he: address ? (address.ten_nguoi_nhan || '') : '',
        dien_thoai: supplier.sdt || (address ? address.sdt_nguoi_nhan || '' : ''),
        email: supplier.email || '',
        dia_chi: address ? (address.dia_chi_day_du || address.dia_chi_chi_tiet || '') : '',
        tinh_tp: address ? (address.tinh_thanh || '') : '',
        phuong_xa: address ? (address.phuong_xa || '') : '',
        ma_so_thue: supplier.ma_so_thue || '',
        nhom_nha_cung_cap: supplier.nhom_nha_cung_cap_id ? (supplier.nhom_nha_cung_cap_id.ten_nhom_ncc || '') : '',
        tong_mua: totalBuy,
        da_tra_ncc: paid,
        no_ncc: debt,
        trang_thai: getSupplierStatusLabel(supplier.trang_thai),
        ngay_tao: formatExportDate(supplier.created_at),
        nguoi_tao: getUserName(supplier.nguoi_tao_id),
        ghi_chu: supplier.ghi_chu || ''
    };
}

function applySupplierWorksheetFormat(worksheet) {
    var headerRow = worksheet.getRow(1);
    headerRow.eachCell(function(cell) {
        cell.font = { bold: true, color: { argb: 'FF111827' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            bottom: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            left: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            right: { style: 'thin', color: { argb: 'FFD8E8FB' } }
        };
    });
    worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: worksheet.columns.length }
    };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.eachRow(function(row, rowNumber) {
        if (rowNumber === 1) return;
        row.eachCell(function(cell) {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
            };
            cell.alignment = { vertical: 'middle' };
        });
    });
    worksheet.columns.forEach(function(column) {
        var maxLength = String(column.header || '').length;
        column.eachCell({ includeEmpty: true }, function(cell) {
            var value = cell.value == null ? '' : String(cell.value);
            maxLength = Math.max(maxLength, value.length);
        });
        column.width = Math.min(Math.max(maxLength + 2, 12), 36);
    });
}

async function makeSupplierCode() {
    var lastSupplier = await NhaCungCap.findOne({ ma_ncc: /^NCC\d+$/ }).sort({ ma_ncc: -1 }).lean();
    var nextNumber = 1;
    if (lastSupplier && lastSupplier.ma_ncc) {
        nextNumber = Number(lastSupplier.ma_ncc.replace(/\D/g, '')) + 1;
    }
    return 'NCC' + String(nextNumber).padStart(4, '0');
}

async function makeSupplierAddressCode() {
    var addresses = await DiaChiNhaCungCap.find({ ma_dia_chi: /^DCNCC\d+$/ }).select('ma_dia_chi').lean();
    var maxNumber = 0;

    for (var address of addresses) {
        if (address.ma_dia_chi) {
            var num = Number(address.ma_dia_chi.replace(/\D/g, ''));
            if (num > maxNumber) maxNumber = num;
        }
    }

    return 'DCNCC' + String(maxNumber + 1).padStart(4, '0');
}

async function makeSupplierDebtTransactionCode(storeId) {
    var counterKey = 'giao_dich_cong_no_nha_cung_cap';
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) counterKey += ':' + String(storeId);
    var counter = await Counter.findOneAndUpdate(
        { _id: counterKey },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    ).lean();
    return 'GDNCC' + String(Number(counter?.seq || 1)).padStart(6, '0');
}

function mapXuatNoiBoStatus(status) {
    if (status === 'completed') return 'Hoàn thành';
    if (status === 'draft') return 'Phiếu tạm';
    if (status === 'cancelled') return 'Đã hủy';
    return status || '--';
}

function buildSupplierInternalExportReceiverNames(supplier) {
    var names = [];
    [supplier?.ten_ncc, supplier?.ten_cong_ty, supplier?.sdt].forEach(function(value) {
        var text = String(value || '').trim();
        if (text && names.indexOf(text) < 0) names.push(text);
    });
    return names;
}

function buildSupplierInternalExportFilter(supplier, storeId) {
    var names = buildSupplierInternalExportReceiverNames(supplier);
    if (!names.length) return null;
    var filter = {
        loai_nguoi_nhan: 'nha_cung_cap',
        nguoi_nhan: { $in: names }
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        filter.cua_hang_id = storeId;
    }
    return filter;
}

async function loadSupplierInternalExportHistory(supplier, storeId) {
    var filter = buildSupplierInternalExportFilter(supplier, storeId);
    if (!filter) return [];
    var rows = await PhieuXuatNoiBo.find(filter)
        .populate({ path: 'nguoi_tao_id', select: 'ho_ten email' })
        .populate({ path: 'kho_id', select: 'ten_kho ma_kho' })
        .populate({ path: 'cua_hang_id', select: 'ten_cua_hang ma_cua_hang' })
        .sort({ ngay_xuat: -1, created_at: -1 })
        .lean();
    var ticketIds = rows.map(function(row) { return row._id; });
    var detailRows = ticketIds.length ? await CTXuatNoiBo.find({ phieu_xuat_id: { $in: ticketIds } })
        .populate({
            path: 'hang_hoa_id',
            select: 'ten_hang'
        })
        .lean() : [];
    var itemNamesByTicket = detailRows.reduce(function(map, detail) {
        var key = String(detail.phieu_xuat_id || '');
        var product = detail.hang_hoa_id || {};
        var name = String(product.ten_hang || '').trim();
        if (!key) return map;
        if (!map[key]) map[key] = [];
        if (name && map[key].indexOf(name) < 0) map[key].push(name);
        return map;
    }, {});
    return rows.map(function(row) {
        var itemNames = itemNamesByTicket[String(row._id)] || [];
        return {
            _id: row._id,
            ma_xuat_noi_bo: row.ma_xuat_noi_bo || '--',
            loai_xuat: row.loai_xuat || '--',
            ten_hang_hoa: itemNames.length ? itemNames.join(', ') : 'Không có',
            kho: row?.kho_id?.ten_kho || row?.kho_id?.ma_kho || '--',
            cua_hang: row?.cua_hang_id?.ten_cua_hang || '--',
            tong_so_luong: Number(row.tong_so_luong || 0),
            tong_gia_tri: Number(row.tong_gia_tri || 0),
            thoi_gian: row.ngay_xuat || row.created_at,
            nguoi_tao: row?.nguoi_tao_id?.ho_ten || row?.nguoi_tao_id?.email || '--',
            nguoi_nhan: row.nguoi_nhan || '--',
            trang_thai: row.trang_thai || 'draft',
            ghi_chu: row.ghi_chu || ''
        };
    });
}

async function loadSupplierUnpaidPurchases(supplierId, storeId) {
    var query = {
        nha_cung_cap_id: supplierId,
        trang_thai: 'completed',
        deleted_at: null,
        con_no_ncc: { $gt: 0 }
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
    return await PhieuNhap.find(query)
        .sort({ ngay_nhap: 1, created_at: 1 })
        .select('ma_phieu_nhap ngay_nhap tong_tien can_tra_ncc da_tra_ncc con_no_ncc')
        .lean();
}

function sumInvoiceDebt(purchases) {
    return (Array.isArray(purchases) ? purchases : []).reduce(function(sum, row) {
        return sum + Math.max(0, Number(row.con_no_ncc || 0));
    }, 0);
}

function buildDebtReconciliation(invoiceDebt, ledgerDebt) {
    var debtByInvoices = Math.max(0, Number(invoiceDebt || 0));
    var currentDebt = Math.max(0, Number(ledgerDebt || 0));
    var debtByLedger = Math.abs(debtByInvoices - currentDebt);
    var debtDiff = debtByInvoices - debtByLedger;
    return {
        debtByInvoices: debtByInvoices,
        debtByLedger: debtByLedger,
        currentDebt: currentDebt,
        debtDiff: debtDiff,
        hasDebtMismatch: debtByLedger > 1
    };
}

async function loadActiveCashBooks() {
    return SoQuy.find({ trang_thai: 'active' }).sort({ ten_so_quy: 1 }).lean();
}

function supplierReadNestedPayment(body) {
    body = body || {};
    if (body.chi_tiet_thanh_toan && typeof body.chi_tiet_thanh_toan === 'object') return body.chi_tiet_thanh_toan;
    return {};
}

function supplierReadPaymentValue(body, key) {
    var nested = supplierReadNestedPayment(body);
    if (nested[key] !== undefined) return nested[key];
    var bracketKey = 'chi_tiet_thanh_toan[' + key + ']';
    if (body && body[bracketKey] !== undefined) return body[bracketKey];
    return body ? body[key] : undefined;
}

function supplierHasPaymentBookId(body, key) {
    return String(supplierReadPaymentValue(body, key) || '').trim() !== '';
}

function supplierPaymentIsV2(body) {
    var flag = body && body.payment_v2;
    return flag === true
        || flag === 'true'
        || flag === '1'
        || supplierHasPaymentBookId(body, 'so_quy_tien_mat_id')
        || supplierHasPaymentBookId(body, 'so_quy_chuyen_khoan_id');
}

function normalizeSupplierPaymentInput(body) {
    body = body || {};
    var isV2 = supplierPaymentIsV2(body);
    var tienMat = parseMoney(supplierReadPaymentValue(body, 'tien_mat'));
    var chuyenKhoan = parseMoney(supplierReadPaymentValue(body, 'chuyen_khoan'));
    var tienTraKhach = parseMoney(supplierReadPaymentValue(body, 'tien_tra_khach'));
    var amount = tienMat + chuyenKhoan;
    if (!isV2 && amount <= 0) {
        amount = parseMoney(body.gia_tri);
        tienMat = amount;
        chuyenKhoan = 0;
    }
    if (isV2 && tienTraKhach > 0) {
        throw new Error('Tiền trả khách không áp dụng cho thanh toán nhà cung cấp.');
    }
    return {
        isV2: isV2,
        amount: amount,
        tien_mat: tienMat,
        chuyen_khoan: chuyenKhoan,
        tien_tra_khach: 0,
        so_quy_tien_mat_id: String(supplierReadPaymentValue(body, 'so_quy_tien_mat_id') || '').trim(),
        so_quy_chuyen_khoan_id: String(supplierReadPaymentValue(body, 'so_quy_chuyen_khoan_id') || '').trim()
    };
}

function normalizeSupplierAddressPayload(body) {
    body = body || {};
    var address = normalizeAddress(body);
    return {
        ma_dia_chi: String(body.ma_dia_chi || '').trim(),
        ten_nguoi_nhan: String(body.ten_nguoi_nhan || '').trim(),
        sdt_nguoi_nhan: String(body.sdt_nguoi_nhan || '').trim(),
        dia_chi_chi_tiet: address.dia_chi_chi_tiet,
        dia_chi_day_du: address.dia_chi_day_du,
        tinh_thanh: address.tinh_thanh,
        phuong_xa: address.phuong_xa,
        loai_dia_chi: String(body.loai_dia_chi || '').trim(),
        ghi_chu: String(body.ghi_chu || '').trim(),
        mac_dinh: body.mac_dinh === 'true' || body.mac_dinh === true || body.mac_dinh === 'on'
    };
}

function buildSupplierReturnUrl(supplierId, returnQueryRaw, extraParams) {
    var returnQuery = String(returnQueryRaw || '').trim().replace(/^\?/, '');
    var params = returnQuery ? returnQuery.split('&').filter(Boolean) : [];
    var paramsWithoutSupplier = params.filter(function(item) {
        return item.indexOf('supplier=') !== 0;
    });
    Object.keys(extraParams || {}).forEach(function(key) {
        var value = extraParams[key];
        if (value === undefined || value === null || value === '') return;
        paramsWithoutSupplier.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    });
    var hash = supplierId ? '#s-' + encodeURIComponent(String(supplierId)) : '';
    return '/nha-cung-cap' + (paramsWithoutSupplier.length ? '?' + paramsWithoutSupplier.join('&') : '') + hash;
}

async function loadSupplierDetailRenderLocals(req, supplierId) {
    var storeId = await resolveStoreId(req);
    var sid = normalizeIdParam(supplierId);
    if (!sid || !mongoose.Types.ObjectId.isValid(sid)) return null;

    var selectedSupplier = await NhaCungCap.findById(sid).lean();
    if (!selectedSupplier) return null;
    if (storeId && mongoose.Types.ObjectId.isValid(storeId) && selectedSupplier.cua_hang_id &&
        String(selectedSupplier.cua_hang_id) !== String(storeId)) {
        return null;
    }

    var totalsMap = await aggregateSupplierPurchaseTotals(storeId);
    applySupplierTotalsFromMap(selectedSupplier, totalsMap);

    var filter = normalizeFilterQuery(req?.query || {});
    var debtWarnSettings = normalizeDebtWarnSettings(filter);
    var filterQueryString = buildFilterQueryString(filter);

    var supplierAddresses = await DiaChiNhaCungCap.find({ nha_cung_cap_id: selectedSupplier._id }).sort({ created_at: -1 }).lean();

    var phieuNhapQuery = {
        nha_cung_cap_id: selectedSupplier._id,
        trang_thai: { $in: ['completed', 'draft', 'cancelled'] },
        deleted_at: null
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        phieuNhapQuery.cua_hang_id = storeId;
    }
    var nhapRows = await PhieuNhap.find(phieuNhapQuery)
        .populate({ path: 'nguoi_tao_id', select: 'ho_ten email' })
        .populate({ path: 'kho_id', select: 'ten_kho ma_kho' })
        .sort({ ngay_nhap: -1, created_at: -1 })
        .lean();
    var supplierPurchaseHistory = nhapRows.map(function(row) {
        return {
            loai: 'nhap',
            phieu_nhap_id: row._id,
            ma_phieu: row.ma_phieu_nhap || '--',
            thoi_gian: row.ngay_nhap || row.created_at,
            nguoi_tao: row?.nguoi_tao_id?.ho_ten || row?.nguoi_tao_id?.email || '--',
            tong_cong: Number(row.can_tra_ncc || row.tong_tien || 0),
            trang_thai: row.trang_thai || 'draft'
        };
    });

    if (PhieuTraHangNhap) {
        var phieuTraQuery = { nha_cung_cap_id: selectedSupplier._id, deleted_at: null };
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
            phieuTraQuery.cua_hang_id = storeId;
        }
        var traRows = await PhieuTraHangNhap.find(phieuTraQuery)
            .populate({ path: 'nguoi_tao_id', select: 'ho_ten email' })
            .sort({ ngay_tra: -1, created_at: -1 })
            .lean();
        supplierPurchaseHistory = supplierPurchaseHistory.concat(traRows.map(function(row) {
            return {
                loai: 'tra',
                phieu_tra_hang_nhap_id: row._id,
                phieu_nhap_id: row.phieu_nhap_id,
                ma_phieu: row.ma_phieu_tra_nhap || '--',
                thoi_gian: row.created_at || row.ngay_tra,
                nguoi_tao: row?.nguoi_tao_id?.ho_ten || row?.nguoi_tao_id?.email || '--',
                tong_cong: Number(row.tong_tien_tra || 0),
                trang_thai: row.trang_thai || 'completed'
            };
        }));
    }
    var nhapVatChuaQuery = {
        doi_tuong_type: 'nha_cung_cap',
        doi_tuong_id: selectedSupplier._id,
        trang_thai: { $ne: 'cancelled' }
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        nhapVatChuaQuery.cua_hang_id = storeId;
    }
    var nhapVatChuaRows = await NhapVatChua.find(nhapVatChuaQuery)
        .where('deleted_at').equals(null)
        .sort({ created_at: -1 })
        .lean();
    supplierPurchaseHistory = supplierPurchaseHistory.concat(nhapVatChuaRows.map(function(row) {
        return {
            loai: 'nhap_vat_chua',
            nhap_vat_chua_id: row._id,
            ma_phieu: row.ma_nhap_vat_chua || '--',
            thoi_gian: row.created_at,
            nguoi_tao: '--',
            tong_cong: Number(row.tong_tien || 0),
            trang_thai: row.trang_thai || 'active'
        };
    }));

    var traVatChuaQuery = {
        doi_tuong_type: 'nha_cung_cap',
        doi_tuong_id: selectedSupplier._id,
        loai_xuat: 'tra_hang_nhap',
        trang_thai: 'active',
        deleted_at: null
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        traVatChuaQuery.cua_hang_id = storeId;
    }
    var traVatChuaRows = await XuatVatChua.find(traVatChuaQuery)
        .sort({ created_at: -1 })
        .lean();
    supplierPurchaseHistory = supplierPurchaseHistory.concat(traVatChuaRows.map(function(row) {
        return {
            loai: 'tra_vat_chua',
            xuat_vat_chua_id: row._id,
            ma_phieu: row.ma_xuat_vat_chua || '--',
            thoi_gian: row.created_at,
            nguoi_tao: '--',
            tong_cong: Number(row.tong_tien || 0),
            trang_thai: row.trang_thai || 'active'
        };
    }));
    supplierPurchaseHistory.sort(function(a, b) {
        return new Date(b.thoi_gian || 0).getTime() - new Date(a.thoi_gian || 0).getTime();
    });

    var debtQuery = { nha_cung_cap_id: selectedSupplier._id };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        debtQuery.cua_hang_id = storeId;
    }
    var debtRows = await CongNoNhaCungCap.find(debtQuery)
        .populate({ path: 'phieu_nhap_id', select: 'ma_phieu_nhap ngay_nhap created_at tong_tien can_tra_ncc da_tra_ncc con_no_ncc deleted_at trang_thai' })
        .populate({ path: 'nhap_vat_chua_id', select: 'ma_nhap_vat_chua created_at tong_tien tong_so_luong deleted_at trang_thai' })
        .populate({
            path: 'phieu_tra_nhap_id',
            select: 'ma_phieu_tra_nhap ngay_tra created_at tong_tien_tra ncc_can_tra ncc_da_tra phieu_nhap_id deleted_at trang_thai',
            populate: { path: 'phieu_nhap_id', select: 'ngay_nhap created_at' }
        })
        .populate({ path: 'phieu_thu_chi_id', select: 'ma_phieu loai_phieu loai_thu_chi deleted_at trang_thai' })
        .sort({ ngay: -1, created_at: -1 })
        .lean();
    debtRows = debtRows.filter(isVisibleSupplierDebtRow);
    var debtTransactionRows = GiaoDichCongNoNhaCungCap ? await GiaoDichCongNoNhaCungCap.find({
        nha_cung_cap_id: selectedSupplier._id,
        ...(storeId && mongoose.Types.ObjectId.isValid(storeId) ? { cua_hang_id: storeId } : {}),
        trang_thai: 'active'
    })
        .populate({ path: 'phieu_nhap_id', select: 'deleted_at trang_thai' })
        .populate({ path: 'phieu_tra_hang_nhap_id', select: 'deleted_at trang_thai' })
        .populate({ path: 'phieu_thu_chi_id', select: 'deleted_at trang_thai' })
        .sort({ ngay_giao_dich: -1, created_at: -1 })
        .lean() : [];
    debtTransactionRows = debtTransactionRows.filter(isVisibleSupplierDebtRow);
    var vatChuaReturnQuery = {
        doi_tuong_type: 'nha_cung_cap',
        doi_tuong_id: selectedSupplier._id,
        loai_xuat: 'tra_hang_nhap',
        trang_thai: 'active',
        deleted_at: null
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        vatChuaReturnQuery.cua_hang_id = storeId;
    }
    var vatChuaReturnRows = await XuatVatChua.find(vatChuaReturnQuery)
        .sort({ created_at: -1 })
        .lean();
    var runningDebt = 0;
    var debtAsc = debtRows.map(function(row) {
        return { source: 'legacy', row: row, date: getDebtEventTime(row) };
    }).concat(debtTransactionRows.map(function(row) {
        return { source: 'giao_dich', row: row, date: row.ngay_giao_dich || row.created_at };
    })).concat(vatChuaReturnRows.map(function(row) {
        return { source: 'tra_vat_chua', row: row, date: row.created_at };
    })).sort(sortDebtLedgerAsc);
    var mappedDebtAsc = debtAsc.map(function(row) {
        var sourceRow = row.row || {};
        if (row.source === 'giao_dich') {
            var txAmount = Number(sourceRow.gia_tri || 0);
            if (sourceRow.huong_cong_no === 'tang_no') runningDebt += txAmount;
            if (sourceRow.huong_cong_no === 'giam_no') runningDebt -= txAmount;
            return {
                phieu_nhap_id: sourceRow.phieu_nhap_id,
                nhap_vat_chua_id: sourceRow.nhap_vat_chua_id,
                phieu_tra_nhap_id: sourceRow.phieu_tra_hang_nhap_id,
                phieu_thu_chi_id: sourceRow.phieu_thu_chi_id,
                ma_phieu: sourceRow.ma_giao_dich || '--',
                loai_chung_tu: mapSupplierDebtTransactionLabel(sourceRow.loai_giao_dich),
                thoi_gian: sourceRow.ngay_giao_dich || sourceRow.created_at,
                loai: sourceRow.huong_cong_no === 'tang_no' ? 'tang_no' : 'giam_no',
                gia_tri: txAmount,
                da_thanh_toan: sourceRow.loai_giao_dich === 'thanh_toan' ? txAmount : 0,
                con_lai: Math.max(0, Number(runningDebt || 0)),
                tong_no: Number(runningDebt || 0),
                no_con_lai: runningDebt,
                no_sau_da_luu: Number(sourceRow.no_sau || 0),
                ghi_chu: sourceRow.ghi_chu || ''
            };
        }
        if (row.source === 'tra_vat_chua') {
            var returnAmount = Number(sourceRow.tong_tien || 0);
            runningDebt -= returnAmount;
            return {
                xuat_vat_chua_id: sourceRow._id,
                ma_phieu: sourceRow.ma_xuat_vat_chua || '--',
                loai_chung_tu: 'Trả vật chứa',
                thoi_gian: sourceRow.created_at,
                loai: 'giam_no',
                gia_tri: returnAmount,
                da_thanh_toan: 0,
                con_lai: Math.max(0, returnAmount),
                tong_no: Number(runningDebt || 0),
                no_con_lai: runningDebt,
                ghi_chu: sourceRow.ghi_chu || ''
            };
        }
        var soTien = Number(sourceRow.so_tien || 0);
        runningDebt += getLegacySupplierDebtDelta(sourceRow, soTien);
        var docInfo = getDebtDocumentInfo(sourceRow);
        var amountInfo = getSupplierDebtAmountInfo(sourceRow, soTien, runningDebt);
        return {
            phieu_nhap_id: sourceRow.phieu_nhap_id,
            nhap_vat_chua_id: sourceRow.nhap_vat_chua_id,
            phieu_tra_nhap_id: sourceRow.phieu_tra_nhap_id,
            phieu_thu_chi_id: sourceRow.phieu_thu_chi_id,
            ma_phieu: docInfo.code,
            loai_chung_tu: docInfo.type === 'tra_vat_chua' ? 'Trả vật chứa' : docInfo.label,
            thoi_gian: getDebtDisplayDate(sourceRow),
            loai: sourceRow.loai || 'tang_no',
            gia_tri: amountInfo.gia_tri,
            da_thanh_toan: amountInfo.da_thanh_toan,
            con_lai: amountInfo.con_lai,
            tong_no: amountInfo.tong_no,
            no_con_lai: runningDebt,
            ghi_chu: sourceRow.ghi_chu || ''
        };
    });
    var supplierDebtHistory = enrichSupplierDebtHistory(mappedDebtAsc.reverse(), debtWarnSettings.warnMinDays);

    var supplierInternalExportHistory = await loadSupplierInternalExportHistory(selectedSupplier, storeId);
    var supplierUnpaidPurchases = await loadSupplierUnpaidPurchases(selectedSupplier._id, storeId);
    var debtReconciliation = buildDebtReconciliation(sumInvoiceDebt(supplierUnpaidPurchases), selectedSupplier.tong_no);
    var cashBooks = await loadActiveCashBooks();
    var addressTypes = await loadAddressTypes();

    return {
        selectedSupplier: selectedSupplier,
        supplierAddresses: supplierAddresses,
        supplierPurchaseHistory: supplierPurchaseHistory,
        supplierDebtHistory: supplierDebtHistory,
        supplierInternalExportHistory: supplierInternalExportHistory,
        supplierUnpaidPurchases: supplierUnpaidPurchases,
        debtReconciliation: debtReconciliation,
        cashBooks: cashBooks,
        debtWarnMinDays: debtWarnSettings.warnMinDays,
        debtWarnDefaultDays: SUPPLIER_DEBT_WARN_DEFAULT_DAYS,
        currentUserName: getUserName(req?.user) || 'test',
        addressTypes: addressTypes,
        filterQueryString: filterQueryString,
        formatDate: formatDate,
        mapNhapHangStatus: mapNhapHangStatus,
        mapTraHangStatus: mapTraHangStatus,
        mapSupplierPurchaseHistoryType: mapSupplierPurchaseHistoryType,
        mapCongNoLoai: mapCongNoLoai,
        mapCongNoDirection: mapCongNoDirection,
        mapXuatNoiBoStatus: mapXuatNoiBoStatus
    };
}

exports.apiSupplierDetail = async function(req, res, next) {
    try {
        var ctx = await loadSupplierDetailRenderLocals(req, req.params.id);
        if (!ctx) {
            return res.status(404).type('html').send('<div class="kv-detail-panel product-detail kv-detail-error"><p>Không tìm thấy nhà cung cấp.</p></div>');
        }
        res.render('nha-cung-cap/_detail-panel', ctx);
    } catch (err) {
        next(err);
    }
};

exports.apiTableMetrics = async function(req, res, next) {
    try {
        return await measureAsync('nhaCungCap.apiTableMetrics.total', async function() {
            var rawIds = req?.query?.ids || '';
            if (countSupplierMetricIdCandidates(rawIds) > SUPPLIER_TABLE_METRICS_LIMIT) {
                return res.status(400).json({
                    success: false,
                    message: 'Chỉ được tải tối đa ' + SUPPLIER_TABLE_METRICS_LIMIT + ' nhà cung cấp mỗi lần.'
                });
            }
            var ids = normalizeSupplierMetricIds(rawIds);
            if (!ids.length) {
                return res.json({ success: true, rows: [] });
            }

            var storeId = await resolveStoreId(req);
            var supplierQuery = Object.assign(
                { _id: { $in: ids.map(function(id) { return new mongoose.Types.ObjectId(id); }) } },
                buildSupplierStoreAccessQuery(storeId)
            );
            var suppliers = await NhaCungCap.find(supplierQuery)
                .select('_id tong_mua tong_no')
                .lean();
            if (!suppliers.length) {
                return res.json({ success: true, rows: [] });
            }

            var allowedIds = suppliers.map(function(supplier) { return String(supplier._id); });
            var supplierMap = suppliers.reduce(function(map, supplier) {
                map[String(supplier._id)] = supplier;
                return map;
            }, {});
            var aggregateResult = await Promise.all([
                measureAsync('nhaCungCap.apiTableMetrics.aggregateTotals', function() {
                    return aggregateSupplierPurchaseTotals(storeId, allowedIds);
                }),
                measureAsync('nhaCungCap.apiTableMetrics.aggregateDebtDays', function() {
                    return aggregateSupplierDebtDayInfo(storeId, allowedIds);
                })
            ]);
            var totalsMap = aggregateResult[0];
            var debtDayMap = aggregateResult[1];
            var debtWarnSettings = normalizeDebtWarnSettings(normalizeFilterQuery(req?.query || {}));

            var rows = ids.map(function(id) {
                var supplier = supplierMap[id];
                if (!supplier) return null;
                applySupplierTotalsFromMap(supplier, totalsMap);
                applySupplierDebtDayInfo(supplier, debtDayMap);
                applySupplierDebtWarning(supplier, debtWarnSettings);
                return {
                    id: id,
                    tong_mua: Number(supplier.tong_mua || 0),
                    da_thanh_toan: Number(supplier.da_thanh_toan || 0),
                    tong_no: Number(supplier.tong_no || 0),
                    tong_no_theo_so: Number(supplier.tong_no_theo_so || 0),
                    so_ngay_no_xa: supplier.so_ngay_no_xa != null ? Number(supplier.so_ngay_no_xa) : null,
                    so_ngay_no_gan: supplier.so_ngay_no_gan != null ? Number(supplier.so_ngay_no_gan) : null,
                    no_xa_nhat_ma_phieu: supplier.no_xa_nhat_ma_phieu || '',
                    no_xa_nhat_tien: Number(supplier.no_xa_nhat_tien || 0),
                    debt_warning: !!supplier.debt_warning
                };
            }).filter(Boolean);

            return res.json({ success: true, rows: rows });
        });
    } catch (err) {
        next(err);
    }
};
exports.index = async function(req, res, next) {
    try {
        var requestQuery = req?.query || {};
        if (
            Object.prototype.hasOwnProperty.call(
                requestQuery,
                'supplier'
            )
        ) {
            var redirectQuery = Object.assign(
                {},
                requestQuery
            );

            delete redirectQuery.supplier;

            var qsStr = querystring.stringify(
                redirectQuery
            );

            return res.redirect(
                302,
                '/nha-cung-cap' +
                (qsStr ? '?' + qsStr : '')
            );
        }
        var filter = normalizeFilterQuery(requestQuery);
        var supplierQuery =
            buildSupplierQueryFromFilter(filter);
        var formMode =
            requestQuery.mode === 'create'
                ? 'create'
                : '';
        var initialData = await Promise.all([
            loadSupplierGroups(),

            NhaCungCap.find(supplierQuery)
                .select(
                    '_id ma_ncc ten_ncc sdt email ' +
                    'tong_mua tong_no trang_thai ' +
                    'created_at cua_hang_id'
                )
                .sort({
                    created_at: 1,
                    ma_ncc: 1
                })
                .lean(),
            formMode === 'create'
                ? loadAddressTypes()
                : Promise.resolve([])
        ]);

        var supplierGroups = initialData[0];
        var suppliers = initialData[1];
        var addressTypes = initialData[2];
        suppliers.forEach(function(supplier) {
            supplier.da_thanh_toan =
                resolveSupplierDaThanhToan(supplier);
            supplier.tong_no_theo_so = null;
            supplier.debt_warning = false;
            supplier.metrics_pending = true;
        });
        var locals = {
            title: 'Nhà cung cấp',
            pageTitle: 'Nhà cung cấp',
            activeMenu: 'nha-cung-cap',

            user: req.user,
            flash: requestQuery,

            suppliers: suppliers,
            supplierGroups: supplierGroups,
            addressTypes: addressTypes,

            formMode: formMode,
            metricsLazyLoad: true,

            formatDate: formatDate,
            filter: filter,

            filterQueryString:
                buildFilterQueryString(filter),

            debtWarnDefaultDays:
                SUPPLIER_DEBT_WARN_DEFAULT_DAYS,

            formatFilterMoney:
                formatFilterMoneyDisplay,

            filterDebtRangeLabel: (function() {
                var hasFrom = hasFilterQueryValue(
                    filter.currentDebtFrom
                );

                var hasTo = hasFilterQueryValue(
                    filter.currentDebtTo
                );

                if (!hasFrom && !hasTo) {
                    return '';
                }

                var fromText = hasFrom
                    ? formatFilterMoneyDisplay(
                        filter.currentDebtFrom
                    )
                    : '0';

                var toText = hasTo
                    ? formatFilterMoneyDisplay(
                        filter.currentDebtTo
                    )
                    : 'không giới hạn';

                return fromText + ' – ' + toText;
            })(),

            mapNhapHangStatus:
                mapNhapHangStatus,

            mapTraHangStatus:
                mapTraHangStatus,

            mapSupplierPurchaseHistoryType:
                mapSupplierPurchaseHistoryType,

            mapCongNoLoai:
                mapCongNoLoai,

            mapCongNoDirection:
                mapCongNoDirection
        };
        return res.render(
            'nha-cung-cap/index',
            locals
        );
    } catch (error) {
        next(error);
    }
};

exports.exportExcel = async function(req, res, next) {
    try {
        var storeId = await resolveStoreId(req);
        var filter = normalizeFilterQuery(req?.query || {});
        var supplierQuery = buildSupplierQueryFromFilter(filter);
        var debtWarnSettings = normalizeDebtWarnSettings(filter);
        var suppliers = await NhaCungCap.find(supplierQuery)
            .populate({ path: 'nhom_nha_cung_cap_id', select: 'ten_nhom_ncc ma_nhom_ncc' })
            .populate({ path: 'nguoi_tao_id', select: 'ho_ten username email' })
            .sort({ created_at: 1, ma_ncc: 1 })
            .lean();
        var totalsMap = await aggregateSupplierPurchaseTotals(storeId);
        var debtDayMap = await aggregateSupplierDebtDayInfo(storeId);
        suppliers.forEach(function(s) {
            applySupplierTotalsFromMap(s, totalsMap);
            applySupplierDebtDayInfo(s, debtDayMap);
            applySupplierDebtWarning(s, debtWarnSettings);
        });
        suppliers = filterSuppliersByComputedTotals(suppliers, filter);
        suppliers = filterSuppliersByDebtWarning(suppliers, debtWarnSettings);
        suppliers = sortSuppliersByDebtDaySort(suppliers, filter.debtDaySort);
        var supplierIds = suppliers.map(function(supplier) { return supplier._id; });
        var addresses = supplierIds.length
            ? await DiaChiNhaCungCap.find({ nha_cung_cap_id: { $in: supplierIds } })
                .sort({ mac_dinh: -1, created_at: -1 })
                .lean()
            : [];
        var addressMap = addresses.reduce(function(map, address) {
            var key = String(address.nha_cung_cap_id);
            if (!map[key]) map[key] = address;
            return map;
        }, {});

        var workbook = new ExcelJS.Workbook();
        var worksheet = workbook.addWorksheet('Nhà cung cấp');
        worksheet.columns = SUPPLIER_EXPORT_COLUMNS;
        suppliers.forEach(function(supplier) {
            worksheet.addRow(buildSupplierExportRow(supplier, addressMap[String(supplier._id)]));
        });
        applySupplierWorksheetFormat(worksheet);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="danh-sach-nha-cung-cap.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};

function mapTraHangStatus(value) {
    if (value === 'draft') return 'Phiếu tạm';
    if (value === 'cancelled') return 'Đã hủy';
    return 'Trả hàng nhập';
}

function mapSupplierPurchaseHistoryType(value) {
    if (value === 'tra') return 'Trả hàng hóa';
    if (value === 'nhap_vat_chua') return 'Nhập vật chứa';
    if (value === 'tra_vat_chua') return 'Trả vật chứa';
    return 'Nhập hàng hóa';
}

async function exportSupplierDetailWorkbook(section, supplier, storeId) {
    var workbook = new ExcelJS.Workbook();
    var safeMa = slugifyFilePart(supplier.ma_ncc);
    if (section === 'info') {
        var ws = workbook.addWorksheet('Thông tin');
        ws.columns = [
            { header: 'Mã NCC', key: 'ma_ncc', width: 14 },
            { header: 'Tên NCC', key: 'ten_ncc', width: 28 },
            { header: 'Tên công ty', key: 'ten_cong_ty', width: 28 },
            { header: 'Mã số thuế', key: 'ma_so_thue', width: 16 },
            { header: 'Điện thoại', key: 'sdt', width: 14 },
            { header: 'Email', key: 'email', width: 24 },
            { header: 'Tổng nợ', key: 'tong_no', style: { numFmt: '#,##0' } },
            { header: 'Đã thanh toán', key: 'da_thanh_toan', style: { numFmt: '#,##0' } },
            { header: 'Tổng mua', key: 'tong_mua', style: { numFmt: '#,##0' } },
            { header: 'Trạng thái', key: 'trang_thai', width: 18 },
            { header: 'Ghi chú', key: 'ghi_chu', width: 36 }
        ];
        var totalsMap = await aggregateSupplierPurchaseTotals(storeId);
        applySupplierTotalsFromMap(supplier, totalsMap);
        ws.addRow({
            ma_ncc: supplier.ma_ncc || '',
            ten_ncc: supplier.ten_ncc || '',
            ten_cong_ty: supplier.ten_cong_ty || '',
            ma_so_thue: supplier.ma_so_thue || '',
            sdt: supplier.sdt || '',
            email: supplier.email || '',
            tong_no: Number(supplier.tong_no || 0),
            da_thanh_toan: resolveSupplierDaThanhToan(supplier),
            tong_mua: Number(supplier.tong_mua || 0),
            trang_thai: getSupplierStatusLabel(supplier.trang_thai),
            ghi_chu: supplier.ghi_chu || ''
        });
        applySupplierWorksheetFormat(ws);
        return { workbook: workbook, filename: 'ncc-' + safeMa + '-thong-tin.xlsx' };
    }
    if (section === 'address') {
        var wsA = workbook.addWorksheet('Địa chỉ');
        wsA.columns = [
            { header: 'Mã địa chỉ', key: 'ma_dia_chi', width: 14 },
            { header: 'Tên người nhận', key: 'ten_nguoi_nhan', width: 22 },
            { header: 'SĐT', key: 'sdt', width: 14 },
            { header: 'Địa chỉ đầy đủ', key: 'dia_chi_day_du', width: 36 },
            { header: 'Địa chỉ chi tiết', key: 'dia_chi_chi_tiet', width: 20 },
            { header: 'Phường/Xã', key: 'phuong_xa', width: 16 },
            { header: 'Tỉnh/Thành', key: 'tinh_thanh', width: 16 },
            { header: 'Loại địa chỉ', key: 'loai_dia_chi', width: 14 },
            { header: 'Mặc định', key: 'mac_dinh', width: 10 },
            { header: 'Ghi chú', key: 'ghi_chu', width: 28 },
            { header: 'Tạo lúc', key: 'tao_luc', width: 20 }
        ];
        var addrList = await DiaChiNhaCungCap.find({ nha_cung_cap_id: supplier._id }).sort({ created_at: -1 }).lean();
        addrList.forEach(function(a) {
            wsA.addRow({
                ma_dia_chi: a.ma_dia_chi || '',
                ten_nguoi_nhan: a.ten_nguoi_nhan || '',
                sdt: a.sdt_nguoi_nhan || '',
                dia_chi_day_du: a.dia_chi_day_du || '',
                dia_chi_chi_tiet: a.dia_chi_chi_tiet || '',
                phuong_xa: a.phuong_xa || '',
                tinh_thanh: a.tinh_thanh || '',
                loai_dia_chi: a.loai_dia_chi || '',
                mac_dinh: a.mac_dinh ? 'Có' : 'Không',
                ghi_chu: a.ghi_chu || '',
                tao_luc: formatExportDate(a.created_at)
            });
        });
        applySupplierWorksheetFormat(wsA);
        return { workbook: workbook, filename: 'ncc-' + safeMa + '-dia-chi.xlsx' };
    }
    if (section === 'history') {
        var wsH = workbook.addWorksheet('Lịch sử');
        wsH.columns = [
            { header: 'Loại phiếu', key: 'loai_phieu', width: 22 },
            { header: 'Mã phiếu', key: 'ma_phieu', width: 18 },
            { header: 'Ngày', key: 'ngay', width: 20 },
            { header: 'Tổng tiền', key: 'tong_tien', style: { numFmt: '#,##0' } },
            { header: 'Đã trả', key: 'da_tra', style: { numFmt: '#,##0' } },
            { header: 'Còn nợ', key: 'con_no', style: { numFmt: '#,##0' } },
            { header: 'Trạng thái', key: 'trang_thai', width: 16 }
        ];
        var pnMatch = { nha_cung_cap_id: supplier._id, trang_thai: { $in: ['completed', 'draft', 'cancelled'] } };
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) pnMatch.cua_hang_id = storeId;
        var nhapRows = await PhieuNhap.find(pnMatch).sort({ ngay_nhap: -1, created_at: -1 }).lean();
        nhapRows.forEach(function(row) {
            wsH.addRow({
                loai_phieu: 'Phiếu nhập',
                ma_phieu: row.ma_phieu_nhap || '',
                ngay: formatExportDate(row.ngay_nhap || row.created_at),
                tong_tien: Number(row.can_tra_ncc || row.tong_tien || 0),
                da_tra: Number(row.da_tra_ncc || 0),
                con_no: Number(row.con_no_ncc || 0),
                trang_thai: mapNhapHangStatus(row.trang_thai)
            });
        });
        if (PhieuTraHangNhap) {
            var ptMatch = { nha_cung_cap_id: supplier._id };
            if (storeId && mongoose.Types.ObjectId.isValid(storeId)) ptMatch.cua_hang_id = storeId;
            var traRows = await PhieuTraHangNhap.find(ptMatch).sort({ ngay_tra: -1, created_at: -1 }).lean();
            traRows.forEach(function(row) {
                var can = Number(row.ncc_can_tra || row.tong_tien_tra || 0);
                var da = Number(row.ncc_da_tra || 0);
                wsH.addRow({
                    loai_phieu: 'Phiếu trả hàng nhập',
                    ma_phieu: row.ma_phieu_tra_nhap || '',
                    ngay: formatExportDate(row.ngay_tra || row.created_at),
                    tong_tien: Number(row.tong_tien_tra || 0),
                    da_tra: da,
                    con_no: Math.max(0, can - da),
                    trang_thai: mapTraHangStatus(row.trang_thai)
                });
            });
        }
        applySupplierWorksheetFormat(wsH);
        return { workbook: workbook, filename: 'ncc-' + safeMa + '-lich-su.xlsx' };
    }
    if (section === 'xnb') {
        var wsX = workbook.addWorksheet('Xuat dung noi bo');
        wsX.columns = [
            { header: 'Mã xuất nội bộ', key: 'ma_xuat_noi_bo', width: 18 },
            { header: 'Loại xuất', key: 'loai_xuat', width: 22 },
            { header: 'Kho', key: 'kho', width: 18 },
            { header: 'Tổng SL', key: 'tong_so_luong', style: { numFmt: '#,##0' } },
            { header: 'Tổng giá trị', key: 'tong_gia_tri', style: { numFmt: '#,##0' } },
            { header: 'Ngày xuất', key: 'ngay_xuat', width: 20 },
            { header: 'Người tạo', key: 'nguoi_tao', width: 20 },
            { header: 'Người nhận', key: 'nguoi_nhan', width: 22 },
            { header: 'Trạng thái', key: 'trang_thai', width: 14 },
            { header: 'Ghi chú', key: 'ghi_chu', width: 32 }
        ];
        var xnbRows = await loadSupplierInternalExportHistory(supplier, storeId);
        xnbRows.forEach(function(row) {
            wsX.addRow({
                ma_xuat_noi_bo: row.ma_xuat_noi_bo || '',
                loai_xuat: row.loai_xuat || '',
                kho: row.kho || '',
                tong_so_luong: Number(row.tong_so_luong || 0),
                tong_gia_tri: Number(row.tong_gia_tri || 0),
                ngay_xuat: formatExportDate(row.thoi_gian),
                nguoi_tao: row.nguoi_tao || '',
                nguoi_nhan: row.nguoi_nhan || '',
                trang_thai: mapXuatNoiBoStatus(row.trang_thai),
                ghi_chu: row.ghi_chu || ''
            });
        });
        applySupplierWorksheetFormat(wsX);
        return { workbook: workbook, filename: 'ncc-' + safeMa + '-xuat-dung-noi-bo.xlsx' };
    }
    if (section === 'hang-hoa' || section === 'hang_hoa') {
        return buildSupplierHangHoaExportPack(supplier, storeId);
    }
    if (section === 'hoa-don-gop' || section === 'hoa_don_gop' || section === 'chi-tiet-nhap') {
        return buildSupplierPurchaseInvoiceExportPack(supplier, storeId);
    }
    return null;
}

exports.exportSupplierDetail = async function(req, res, next) {
    try {
        var supplierId = normalizeIdParam(req?.params?.id);
        var section = String(req?.params?.section || '').trim().toLowerCase();
        if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
            return res.redirect('/nha-cung-cap?error=invalid_supplier');
        }
        if (['info', 'address', 'history', 'debt', 'xnb', 'hang-hoa', 'hang_hoa', 'hoa-don-gop', 'hoa_don_gop', 'chi-tiet-nhap'].indexOf(section) < 0) {
            return res.redirect('/nha-cung-cap?error=invalid_export');
        }
        var supplier = await NhaCungCap.findById(supplierId).lean();
        if (!supplier) return res.redirect('/nha-cung-cap?error=invalid_supplier');
        var storeId = await resolveStoreId(req);
        if (section === 'debt') {
            try {
                await handleSupplierDebtExport(res, supplier, storeId, req.query || {});
                return;
            } catch (debtExportError) {
                if (debtExportError && debtExportError.code === 'INVALID_DEBT_PERIOD') {
                    return res.redirect('/nha-cung-cap?error=invalid_debt_period#s-' + encodeURIComponent(String(supplierId)));
                }
                throw debtExportError;
            }
        }

        var pack = await exportSupplierDetailWorkbook(section, supplier, storeId);
        if (!pack) return res.redirect('/nha-cung-cap?error=invalid_export');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="' + pack.filename + '"');
        await pack.workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};

exports.payDebt = async function(req, res, next) {
    var session = null;
    try {
        var storeId = await resolveStoreId(req);
        var supplierId = normalizeIdParam(req?.params?.id);
        if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
            return res.status(400).json({ success: false, message: 'Nhà cung cấp không hợp lệ' });
        }

        var payment = normalizeSupplierPaymentInput(req.body || {});
        if (payment.amount <= 0) return res.status(400).json({ success: false, message: 'Số tiền trả phải lớn hơn 0' });
        var allowOverpayment = req?.body?.enable_overpayment === 'on' || req?.body?.enable_overpayment === 'true' || req?.body?.enable_overpayment === true;

        var result;
        session = await mongoose.startSession();
        await session.withTransaction(async function() {
            var supplier = await NhaCungCap.findById(supplierId).session(session).lean();
            if (!supplier) throw new Error('Không tìm thấy nhà cung cấp');
            if (storeId && mongoose.Types.ObjectId.isValid(storeId) && supplier.cua_hang_id && String(supplier.cua_hang_id) !== String(storeId)) {
                throw new Error('Không tìm thấy nhà cung cấp');
            }

            var purchaseQuery = {
                nha_cung_cap_id: supplier._id,
                trang_thai: 'completed',
                con_no_ncc: { $gt: 0 }
            };
            if (storeId && mongoose.Types.ObjectId.isValid(storeId)) purchaseQuery.cua_hang_id = storeId;
            var purchases = await PhieuNhap.find(purchaseQuery)
                .session(session)
                .sort({ ngay_nhap: 1, created_at: 1 })
                .select('ma_phieu_nhap ngay_nhap tong_tien can_tra_ncc da_tra_ncc con_no_ncc')
                .lean();
            var invoiceDebt = sumInvoiceDebt(purchases);
            var payableDebt = Math.max(0, Number(supplier.tong_no || 0));
            if (!allowOverpayment && payment.amount > payableDebt) {
                throw new Error('Số tiền trả không được vượt quá nợ theo sổ công nợ. Bật trả dư / ứng trước NCC nếu muốn chi vượt.');
            }

            var allocationLimit = Math.min(payment.amount, Math.max(0, payableDebt));
            var remaining = allocationLimit;
            var allocations = [];
            var manualAllocations = [];
            if (req?.body?.allocations_json) {
                try {
                    manualAllocations = JSON.parse(String(req.body.allocations_json || '[]'));
                    if (!Array.isArray(manualAllocations)) manualAllocations = [];
                } catch (parseError) {
                    throw new Error('Phân bổ thanh toán không hợp lệ');
                }
            }
            if (manualAllocations.length) {
                var purchaseMap = {};
                purchases.forEach(function(row) { purchaseMap[String(row._id)] = row; });
                var manualTotal = 0;
                for (var m = 0; m < manualAllocations.length; m++) {
                    var manual = manualAllocations[m] || {};
                    var manualPurchase = purchaseMap[String(manual.phieu_nhap_id || '').trim()];
                    if (!manualPurchase) throw new Error('Phiếu nhập phân bổ không hợp lệ');
                    var manualDebt = Math.max(0, Number(manualPurchase.con_no_ncc || 0));
                    var manualAmount = parseMoney(manual.so_tien);
                    if (manualAmount <= 0) continue;
                    if (manualAmount > manualDebt) throw new Error('Không được phân bổ vượt nợ phiếu nhập');
                    manualTotal += manualAmount;
                    allocations.push({
                        phieu_nhap_id: manualPurchase._id,
                        ma_phieu_nhap: manualPurchase.ma_phieu_nhap || '',
                        so_tien: manualAmount,
                        con_no_truoc: manualDebt,
                        con_no_sau: Math.max(0, manualDebt - manualAmount)
                    });
                }
                if (manualTotal > allocationLimit) throw new Error('Tổng tiền phân bổ không được vượt quá nợ theo sổ công nợ');
            } else {
                for (var i = 0; i < purchases.length && remaining > 0; i++) {
                    var purchase = purchases[i];
                    var purchaseDebt = Math.max(0, Number(purchase.con_no_ncc || 0));
                    var payForPurchase = Math.min(remaining, purchaseDebt);
                    if (payForPurchase <= 0) continue;
                    allocations.push({
                        phieu_nhap_id: purchase._id,
                        ma_phieu_nhap: purchase.ma_phieu_nhap || '',
                        so_tien: payForPurchase,
                        con_no_truoc: purchaseDebt,
                        con_no_sau: Math.max(0, purchaseDebt - payForPurchase)
                    });
                    remaining -= payForPurchase;
                }
            }

            var allocatedTotal = allocations.reduce(function(sum, row) { return sum + Number(row.so_tien || 0); }, 0);
            if (allocatedTotal > allocationLimit) throw new Error('Tổng tiền phân bổ không được vượt quá nợ theo sổ công nợ');
            var overpaymentAmount = Math.max(0, payment.amount - payableDebt);
            var note = String(req?.body?.ghi_chu || '').trim() || ('Thanh toán công nợ nhà cung cấp ' + (supplier.ten_ncc || supplier.ma_ncc || ''));
            var receiptPayload = {
                loai_phieu: 'chi',
                loai_thu_chi: 'thanh_toan_ncc',
                gia_tri: payment.amount,
                nha_cung_cap_id: supplier._id,
                phieu_nhap_id: allocations.length === 1 ? allocations[0].phieu_nhap_id : undefined,
                nhom_doi_tuong: 'nha_cung_cap',
                doi_tuong: supplier.ten_ncc || supplier.ten_cong_ty || supplier.ma_ncc || '',
                nguoi_tao_id: req.user && req.user._id,
                cua_hang_id: storeId || supplier.cua_hang_id,
                trang_thai: 'paid',
                ghi_chu: overpaymentAmount > 0 ? (note + ' - Trả dư / ứng trước NCC: ' + overpaymentAmount.toLocaleString('vi-VN')) : note,
                hach_toan: true,
                allocation_type: 'thanh_toan_ncc',
                overpayment_amount: overpaymentAmount,
                allocations: allocations
            };
            if (payment.isV2) {
                Object.assign(receiptPayload, {
                    payment_v2: true,
                    tien_mat: payment.tien_mat,
                    so_quy_tien_mat_id: payment.so_quy_tien_mat_id,
                    chuyen_khoan: payment.chuyen_khoan,
                    so_quy_chuyen_khoan_id: payment.so_quy_chuyen_khoan_id,
                    tien_tra_khach: 0
                });
                receiptPayload._paymentInfo = await buildReceiptPaymentInfo(receiptPayload, {
                    cuaHangId: receiptPayload.cua_hang_id,
                    chiNhanhId: req.session && req.session.chi_nhanh_id,
                    session: session
                });
            } else {
                var cashBookId = String(req?.body?.so_quy_id || req?.body?.cashBookId || '').trim();
                if (!mongoose.Types.ObjectId.isValid(cashBookId)) throw new Error('Vui lòng chọn sổ quỹ để thanh toán nhà cung cấp.');
                Object.assign(receiptPayload, {
                    so_quy_id: cashBookId,
                    phuong_thuc_thanh_toan: String(req?.body?.phuong_thuc_thanh_toan || '').trim() || 'tien_mat',
                    chi_tiet_thanh_toan: { tien_mat: payment.tien_mat, chuyen_khoan: payment.chuyen_khoan, tien_tra_khach: 0 }
                });
            }

            var receipt = await taoPhieuThuChi(receiptPayload, { session: session });
            for (var j = 0; j < allocations.length; j++) {
                var allocation = allocations[j];
                var matchingPurchase = purchases.find(function(item) { return String(item._id) === String(allocation.phieu_nhap_id); });
                if (!matchingPurchase) continue;
                var payable = Number(matchingPurchase.can_tra_ncc || matchingPurchase.tong_tien || 0);
                if (!payable || payable < Number(matchingPurchase.da_tra_ncc || 0) + allocation.con_no_truoc) {
                    payable = Number(matchingPurchase.da_tra_ncc || 0) + allocation.con_no_truoc;
                }
                await PhieuNhap.updateOne(
                    { _id: allocation.phieu_nhap_id },
                    { $set: { da_tra_ncc: Math.min(Number(matchingPurchase.da_tra_ncc || 0) + allocation.so_tien, payable), con_no_ncc: allocation.con_no_sau } },
                    { session: session }
                );
            }
            result = {
                receipt: receipt,
                paid: payment.amount,
                debt: payableDebt - payment.amount,
                invoice_debt: invoiceDebt,
                allocated: allocatedTotal,
                overpayment_amount: overpaymentAmount
            };
        });

        return res.json({
            success: true,
            message: 'Đã tạo phiếu chi thanh toán nhà cung cấp',
            data: result
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Không tạo được phiếu chi' });
    } finally {
        if (session) await session.endSession();
    }
};

exports.discountDebt = async function(req, res) {
    try {
        var storeId = await resolveStoreId(req);
        var supplierId = normalizeIdParam(req?.params?.id);
        if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
            return res.status(400).json({ success: false, message: 'Nhà cung cấp không hợp lệ' });
        }

        var supplier = await NhaCungCap.findById(supplierId).lean();
        if (!supplier) return res.status(404).json({ success: false, message: 'Không tìm thấy nhà cung cấp' });
        if (storeId && mongoose.Types.ObjectId.isValid(storeId) && supplier.cua_hang_id && String(supplier.cua_hang_id) !== String(storeId)) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy nhà cung cấp' });
        }

        var totalsMap = await aggregateSupplierPurchaseTotals(storeId);
        applySupplierTotalsFromMap(supplier, totalsMap);
        var debt = Math.max(0, Number(supplier.tong_no || 0));
        var amount = parseMoney(req?.body?.gia_tri);
        if (amount <= 0) return res.status(400).json({ success: false, message: 'Số tiền chiết khấu phải lớn hơn 0' });
        if (amount > debt) {
            return res.status(400).json({ success: false, message: 'Số tiền chiết khấu không được vượt quá nợ hiện tại' });
        }

        var storeForTransaction = storeId && mongoose.Types.ObjectId.isValid(storeId) ? storeId : supplier.cua_hang_id;
        if (!storeForTransaction || !mongoose.Types.ObjectId.isValid(String(storeForTransaction))) {
            return res.status(400).json({ success: false, message: 'Không xác định được cửa hàng' });
        }
        var note = String(req?.body?.ghi_chu || '').trim() || ('Chiết khấu thanh toán nhà cung cấp ' + (supplier.ten_ncc || supplier.ma_ncc || ''));
        var transaction = await GiaoDichCongNoNhaCungCap.create({
            cua_hang_id: storeForTransaction,
            nha_cung_cap_id: supplier._id,
            ma_giao_dich: await makeSupplierDebtTransactionCode(storeForTransaction),
            loai_giao_dich: 'chiet_khau_thanh_toan',
            huong_cong_no: 'giam_no',
            gia_tri: amount,
            no_truoc: debt,
            no_sau: Math.max(0, debt - amount),
            ngay_giao_dich: new Date(),
            anh_huong_so_quy: false,
            ghi_chu: note,
            nguoi_tao_id: req.user && req.user._id
        });
        await NhaCungCap.updateOne(
            { _id: supplier._id },
            { $inc: { tong_no: -amount } }
        );

        return res.json({
            success: true,
            message: 'Đã tạo chiết khấu thanh toán nhà cung cấp',
            data: {
                transaction: transaction,
                discount: amount,
                debt: debt - amount
            }
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Không tạo được chiết khấu thanh toán' });
    }
};

exports.add = async function(req, res, next) {
    try {
        var payload = normalizeSupplierPayload(req?.body);
        if (!payload.ten_ncc) return res.redirect('/nha-cung-cap?mode=create&error=missing_name');
        if (!payload.ma_ncc) payload.ma_ncc = await makeSupplierCode();
        var supplier = await NhaCungCap.create(payload);
        res.redirect('/nha-cung-cap?success=created#s-' + String(supplier._id));
    } catch (error) {
        if (error && error.code === 11000) return res.redirect('/nha-cung-cap?mode=create&error=duplicate_code');
        next(error);
    }
};

exports.update = async function(req, res, next) {
    try {
        var supplierId = normalizeIdParam(req?.params?.id);
        if (!supplierId) return res.redirect('/nha-cung-cap?error=invalid_supplier');

        var payload = normalizeSupplierPayload(req?.body);
        if (!payload.ten_ncc) return res.redirect('/nha-cung-cap?error=missing_name#s-' + supplierId);
        if (!payload.ma_ncc) delete payload.ma_ncc;
        await NhaCungCap.findByIdAndUpdate(supplierId, payload, { runValidators: true });
        res.redirect('/nha-cung-cap?success=updated#s-' + supplierId);
    } catch (error) {
        if (error && error.code === 11000) return res.redirect('/nha-cung-cap?error=duplicate_code');
        next(error);
    }
};

exports.remove = async function(req, res, next) {
    try {
        var supplierId = normalizeIdParam(req?.params?.id);
        if (!supplierId) return res.redirect('/nha-cung-cap?error=invalid_supplier');
        await NhaCungCap.findByIdAndDelete(supplierId);
        res.redirect('/nha-cung-cap?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.removeSelected = async function(req, res, next) {
    try {
        var ids = normalizeIdList(req?.body?.ids);
        if (ids.length === 0) return res.redirect('/nha-cung-cap?error=no_selection');
        await NhaCungCap.deleteMany({ _id: { $in: ids } });
        res.redirect('/nha-cung-cap?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.addGroup = async function(req, res, next) {
    try {
        var tenNhom = String(req?.body?.ten_nhom_ncc || '').trim();
        var moTa = String(req?.body?.mo_ta || '').trim();
        var maNhom = String(req?.body?.ma_nhom_ncc || '').trim().toUpperCase();
        if (!tenNhom) return respondSupplierGroupError(req, res, 400, 'Vui lòng nhập tên nhóm nhà cung cấp.');
        if (!maNhom) maNhom = await makeSupplierGroupCode();

        var doc = {
            ma_nhom_ncc: maNhom,
            ten_nhom_ncc: tenNhom,
            mo_ta: moTa,
            trang_thai: 'active'
        };
        var storeId = await resolveStoreId(req);
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) doc.cua_hang_id = storeId;

        var created = await NhomNhaCungCap.create(doc);

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã thêm nhóm nhà cung cấp.',
                data: created,
                selectedId: String(created._id),
                supplierGroups: await loadSupplierGroups()
            });
        }

        res.redirect('/nha-cung-cap?success=created');
    } catch (error) {
        console.error('[SupplierGroup] add failed:', error && error.message ? error.message : error);
        if (error && error.code === 11000) {
            return respondSupplierGroupError(req, res, 409, 'Mã nhóm nhà cung cấp đã tồn tại');
        }
        if (error && error.name === 'ValidationError') {
            return respondSupplierGroupError(req, res, 400, error.message || 'Dữ liệu nhóm nhà cung cấp không hợp lệ.');
        }
        if (shouldRespondJson(req)) {
            return res.status(500).json({ success: false, message: error && error.message ? error.message : 'Có lỗi khi xử lý nhóm nhà cung cấp.' });
        }
        next(error);
    }
};

exports.updateGroup = async function(req, res, next) {
    try {
        var groupId = normalizeIdParam(req?.params?.groupId);
        if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
            return respondSupplierGroupError(req, res, 400, 'Nhóm nhà cung cấp không hợp lệ.');
        }

        var tenNhom = String(req?.body?.ten_nhom_ncc || '').trim();
        var moTa = String(req?.body?.mo_ta || '').trim();
        if (!tenNhom) return respondSupplierGroupError(req, res, 400, 'Vui lòng nhập tên nhóm nhà cung cấp.');

        var updated = await NhomNhaCungCap.findByIdAndUpdate(groupId, { ten_nhom_ncc: tenNhom, mo_ta: moTa }, { runValidators: true, new: true });
        if (!updated) return respondSupplierGroupError(req, res, 404, 'Không tìm thấy nhóm nhà cung cấp.');

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã cập nhật nhóm nhà cung cấp.',
                data: updated,
                selectedId: groupId,
                supplierGroups: await loadSupplierGroups()
            });
        }

        res.redirect('/nha-cung-cap?success=updated');
    } catch (error) {
        console.error('[SupplierGroup] update failed:', error && error.message ? error.message : error);
        if (error && error.name === 'ValidationError') {
            return respondSupplierGroupError(req, res, 400, error.message || 'Dữ liệu nhóm nhà cung cấp không hợp lệ.');
        }
        if (shouldRespondJson(req)) {
            return res.status(500).json({ success: false, message: error && error.message ? error.message : 'Có lỗi khi xử lý nhóm nhà cung cấp.' });
        }
        next(error);
    }
};

exports.removeGroup = async function(req, res, next) {
    try {
        var groupId = normalizeIdParam(req?.params?.groupId);
        if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
            return respondSupplierGroupError(req, res, 400, 'Nhóm nhà cung cấp không hợp lệ.');
        }

        await NhaCungCap.updateMany(
            { nhom_nha_cung_cap_id: groupId },
            { $unset: { nhom_nha_cung_cap_id: 1 } }
        );
        var deleted = await NhomNhaCungCap.findByIdAndDelete(groupId);
        if (!deleted) return respondSupplierGroupError(req, res, 404, 'Không tìm thấy nhóm nhà cung cấp.');

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã xóa nhóm nhà cung cấp.',
                supplierGroups: await loadSupplierGroups()
            });
        }

        res.redirect('/nha-cung-cap?success=deleted');
    } catch (error) {
        console.error('[SupplierGroup] delete failed:', error && error.message ? error.message : error);
        if (shouldRespondJson(req)) {
            return res.status(500).json({ success: false, message: error && error.message ? error.message : 'Có lỗi khi xử lý nhóm nhà cung cấp.' });
        }
        next(error);
    }
};

exports.addAddressType = async function(req, res, next) {
    try {
        if (!LoaiDiaChiKhachHang) return respondAddressTypeError(req, res, 500, 'Chưa cấu hình model loại địa chỉ.');
        var tenLoai = String(req?.body?.ten_loai || '').trim();
        var maLoai = normalizeAddressTypeCode(req?.body?.ma_loai || tenLoai);
        if (!tenLoai) return respondAddressTypeError(req, res, 400, 'Vui lòng nhập tên loại địa chỉ.');
        if (!maLoai) maLoai = await makeAddressTypeCode(tenLoai);
        if (await LoaiDiaChiKhachHang.exists({ ma_loai: maLoai })) maLoai = await makeAddressTypeCode(tenLoai);

        var created = await LoaiDiaChiKhachHang.create({
            ma_loai: maLoai,
            ten_loai: tenLoai,
            trang_thai: 'active'
        });

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã thêm loại địa chỉ.',
                data: created,
                selectedCode: created.ma_loai,
                addressTypes: await loadAddressTypes()
            });
        }

        res.redirect('/nha-cung-cap?success=created_address_type');
    } catch (error) {
        console.error('[AddressType] add failed:', error && error.message ? error.message : error);
        if (error && error.code === 11000) return respondAddressTypeError(req, res, 409, 'Loại địa chỉ đã tồn tại.');
        if (shouldRespondJson(req)) {
            return res.status(500).json({ success: false, message: error && error.message ? error.message : 'Có lỗi khi xử lý loại địa chỉ.' });
        }
        next(error);
    }
};

exports.updateAddressType = async function(req, res, next) {
    try {
        if (!LoaiDiaChiKhachHang) return respondAddressTypeError(req, res, 500, 'Chưa cấu hình model loại địa chỉ.');
        var typeId = normalizeIdParam(req?.params?.typeId);
        if (!typeId || !mongoose.Types.ObjectId.isValid(typeId)) {
            return respondAddressTypeError(req, res, 400, 'Loại địa chỉ không hợp lệ.');
        }

        var tenLoai = String(req?.body?.ten_loai || '').trim();
        if (!tenLoai) return respondAddressTypeError(req, res, 400, 'Vui lòng nhập tên loại địa chỉ.');

        var updated = await LoaiDiaChiKhachHang.findByIdAndUpdate(
            typeId,
            { ten_loai: tenLoai, trang_thai: 'active' },
            { runValidators: true, new: true }
        );
        if (!updated) return respondAddressTypeError(req, res, 404, 'Không tìm thấy loại địa chỉ.');

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã cập nhật loại địa chỉ.',
                data: updated,
                selectedCode: updated.ma_loai,
                addressTypes: await loadAddressTypes()
            });
        }

        res.redirect('/nha-cung-cap?success=updated_address_type');
    } catch (error) {
        console.error('[AddressType] update failed:', error && error.message ? error.message : error);
        if (error && error.code === 11000) return respondAddressTypeError(req, res, 409, 'Tên loại địa chỉ đã tồn tại.');
        if (shouldRespondJson(req)) {
            return res.status(500).json({ success: false, message: error && error.message ? error.message : 'Có lỗi khi xử lý loại địa chỉ.' });
        }
        next(error);
    }
};

exports.removeAddressType = async function(req, res, next) {
    try {
        if (!LoaiDiaChiKhachHang) return respondAddressTypeError(req, res, 500, 'Chưa cấu hình model loại địa chỉ.');
        var typeId = normalizeIdParam(req?.params?.typeId);
        if (!typeId || !mongoose.Types.ObjectId.isValid(typeId)) {
            return respondAddressTypeError(req, res, 400, 'Loại địa chỉ không hợp lệ.');
        }

        var type = await LoaiDiaChiKhachHang.findById(typeId).lean();
        if (!type) return respondAddressTypeError(req, res, 404, 'Không tìm thấy loại địa chỉ.');
        if (String(type.ma_loai || '') === 'khac') {
            return respondAddressTypeError(req, res, 400, 'Không thể xóa loại địa chỉ mặc định.');
        }

        await DiaChiNhaCungCap.updateMany(
            { loai_dia_chi: type.ma_loai },
            { $set: { loai_dia_chi: 'khac' } }
        );
        await LoaiDiaChiKhachHang.findByIdAndDelete(typeId);

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã xóa loại địa chỉ.',
                selectedCode: 'khac',
                addressTypes: await loadAddressTypes()
            });
        }

        res.redirect('/nha-cung-cap?success=deleted_address_type');
    } catch (error) {
        console.error('[AddressType] delete failed:', error && error.message ? error.message : error);
        if (shouldRespondJson(req)) {
            return res.status(500).json({ success: false, message: error && error.message ? error.message : 'Có lỗi khi xử lý loại địa chỉ.' });
        }
        next(error);
    }
};

exports.listAddresses = async function(req, res, next) {
    try {
        var supplierId = normalizeIdParam(req?.params?.id);
        if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
            return res.status(400).json({ success: false, message: 'invalid_supplier' });
        }

        var addresses = await DiaChiNhaCungCap.find({ nha_cung_cap_id: supplierId }).sort({ created_at: -1 }).lean();
        res.json({ success: true, data: addresses });
    } catch (error) {
        next(error);
    }
};

exports.addAddress = async function(req, res, next) {
    try {
        var supplierId = normalizeIdParam(req?.params?.id);
        if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
            return res.redirect('/nha-cung-cap?error=invalid_supplier');
        }

        var payload = normalizeSupplierAddressPayload(req?.body);
        if (!payload.ten_nguoi_nhan && !payload.sdt_nguoi_nhan && !payload.dia_chi_day_du) {
            return res.redirect(buildSupplierReturnUrl(supplierId, req?.body?.returnQuery, { error: 'missing_address_data' }));
        }

        if (!payload.ma_dia_chi) payload.ma_dia_chi = await makeSupplierAddressCode();
        if (!payload.loai_dia_chi) payload.loai_dia_chi = 'khac';
        payload.nha_cung_cap_id = supplierId;

        if (payload.mac_dinh) {
            await DiaChiNhaCungCap.updateMany({ nha_cung_cap_id: supplierId }, { $set: { mac_dinh: false } });
        }

        await DiaChiNhaCungCap.create(payload);
        res.redirect(buildSupplierReturnUrl(supplierId, req?.body?.returnQuery, { success: 'created_address' }));
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/nha-cung-cap?error=duplicate_address_code#s-' + normalizeIdParam(req?.params?.id));
        }
        next(error);
    }
};

exports.updateAddress = async function(req, res, next) {
    try {
        var addressId = normalizeIdParam(req?.params?.addressId);
        if (!addressId || !mongoose.Types.ObjectId.isValid(addressId)) {
            return res.redirect('/nha-cung-cap?error=invalid_address');
        }

        var existingAddress = await DiaChiNhaCungCap.findById(addressId).lean();
        if (!existingAddress) return res.redirect('/nha-cung-cap?error=invalid_address');
        var supplierId = String(existingAddress.nha_cung_cap_id || '');

        var payload = normalizeSupplierAddressPayload(req?.body);
        if (!payload.ten_nguoi_nhan && !payload.sdt_nguoi_nhan && !payload.dia_chi_day_du) {
            return res.redirect(buildSupplierReturnUrl(supplierId, req?.body?.returnQuery, { error: 'missing_address_data' }));
        }

        if (!payload.ma_dia_chi) delete payload.ma_dia_chi;
        if (!payload.loai_dia_chi) payload.loai_dia_chi = 'khac';

        if (payload.mac_dinh) {
            await DiaChiNhaCungCap.updateMany(
                { nha_cung_cap_id: supplierId, _id: { $ne: addressId } },
                { $set: { mac_dinh: false } }
            );
        }

        await DiaChiNhaCungCap.findByIdAndUpdate(addressId, payload, { runValidators: true });
        res.redirect(buildSupplierReturnUrl(supplierId, req?.body?.returnQuery, { success: 'updated_address' }));
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/nha-cung-cap?error=duplicate_address_code');
        }
        next(error);
    }
};

exports.removeAddress = async function(req, res, next) {
    try {
        var addressId = normalizeIdParam(req?.params?.addressId);
        if (!addressId || !mongoose.Types.ObjectId.isValid(addressId)) {
            return res.redirect('/nha-cung-cap?error=invalid_address');
        }

        var existingAddress = await DiaChiNhaCungCap.findById(addressId).lean();
        if (!existingAddress) return res.redirect('/nha-cung-cap?error=invalid_address');
        var supplierId = String(existingAddress.nha_cung_cap_id || '');

        await DiaChiNhaCungCap.findByIdAndDelete(addressId);
        res.redirect(buildSupplierReturnUrl(supplierId, req?.body?.returnQuery, { success: 'deleted_address' }));
    } catch (error) {
        next(error);
    }
};

exports.downloadImportTemplate = async function(req, res, next) {
    try {
        var workbook = await nhaCungCapImportService.buildImportTemplateWorkbook();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="mau-nhap-nha-cung-cap.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};

exports.importExcel = async function(req, res, next) {
    try {
        var file = req?.file;
        if (!file || !file.buffer || !file.buffer.length) {
            return res.redirect('/nha-cung-cap?error=import_missing_file');
        }

        var fileName = String(file.originalname || '').toLowerCase();
        if (!/\.xlsx$/i.test(fileName)) {
            return res.redirect('/nha-cung-cap?error=import_invalid_file_type');
        }

        var parsedRows = await nhaCungCapImportService.parseSupplierImportBuffer(file.buffer);
        if (!parsedRows.length) {
            return res.redirect('/nha-cung-cap?error=import_empty_file');
        }

        nhaCungCapImportService.validateImportRows(parsedRows);

        var inserted = 0;
        var skipped = 0;
        var rowErrors = [];

        for (var i = 0; i < parsedRows.length; i += 1) {
            var item = parsedRows[i];
            var body = nhaCungCapImportService.buildSupplierBodyFromImportRow(item.data);

            try {
                var payload = normalizeSupplierPayload(body);
                if (!payload.ten_ncc) {
                    skipped += 1;
                    rowErrors.push('Dòng ' + item.rowNumber + ': thiếu tên nhà cung cấp.');
                    continue;
                }

                payload.ma_ncc = await makeSupplierCode();
                await NhaCungCap.create(payload);
                inserted += 1;
            } catch (error) {
                skipped += 1;
                rowErrors.push('Dòng ' + item.rowNumber + ': ' + (error && error.message ? error.message : 'không thể thêm.'));
            }
        }

        if (inserted === 0) {
            var failMessage = rowErrors.slice(0, 3).join(' ');
            return res.redirect('/nha-cung-cap?error=' + encodeURIComponent(failMessage || 'import_failed'));
        }

        var successQuery = 'imported=' + inserted + '&import_label=' + encodeURIComponent('nhà cung cấp');
        if (skipped > 0) successQuery += '&import_skipped=' + skipped;
        if (rowErrors.length > 0) {
            successQuery += '&import_warning=' + encodeURIComponent(rowErrors.slice(0, 2).join(' '));
        }

        res.redirect('/nha-cung-cap?success=imported&' + successQuery);
    } catch (error) {
        if (error && error.code === 'import_invalid_headers') {
            return res.redirect('/nha-cung-cap?error=import_invalid_headers');
        }
        if (error && error.code === 'import_invalid_rows') {
            return res.redirect('/nha-cung-cap?error=' + encodeURIComponent(error.message || 'import_invalid_rows'));
        }
        if (error && error.code === 'import_empty_file') {
            return res.redirect('/nha-cung-cap?error=import_empty_file');
        }

        next(error);
    }
};
