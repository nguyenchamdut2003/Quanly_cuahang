const { mongoose, PhieuNhap, PhieuTraHangNhap, CongNoNhaCungCap, GiaoDichCongNoNhaCungCap, parseMoney } = require('./common.helper');
const { hasFilterQueryValue } = require('./filter.helper');
const { isVisibleSupplierDebtRow, resolveSupplierDaThanhToan } = require('./debt.helper');

var SUPPLIER_DEBT_WARN_DEFAULT_DAYS = 10;

async function aggregateSupplierPurchaseTotals(storeId, supplierIds) {
    var purchaseMatch = {
        trang_thai: 'completed',
        nha_cung_cap_id: { $exists: true, $ne: null }
    };
    var purchaseReturnMatch = {
        trang_thai: 'completed',
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
        purchaseReturnMatch.cua_hang_id = storeObjectId;
        debtMatch.cua_hang_id = storeObjectId;
        debtTransactionMatch.cua_hang_id = storeObjectId;
    }
    var supplierObjectIds = normalizeSupplierObjectIds(supplierIds);
    if (supplierObjectIds.length) {
        purchaseMatch.nha_cung_cap_id = { $in: supplierObjectIds };
        purchaseReturnMatch.nha_cung_cap_id = { $in: supplierObjectIds };
        debtMatch.nha_cung_cap_id = { $in: supplierObjectIds };
        debtTransactionMatch.nha_cung_cap_id = { $in: supplierObjectIds };
    }
    var purchaseRows = await PhieuNhap.aggregate([
        { $match: purchaseMatch },
        {
            $group: {
                _id: '$nha_cung_cap_id',
                tong_mua: { $sum: { $ifNull: ['$tong_tien', 0] } },
                da_tra_phieu_nhap: { $sum: { $ifNull: ['$da_tra_ncc', 0] } },
                tong_no_phieu_nhap: { $sum: { $ifNull: ['$con_no_ncc', 0] } }
            }
        }
    ]);
    var debtRows = await CongNoNhaCungCap.find(debtMatch)
        .populate({ path: 'phieu_nhap_id', select: '_id tong_tien can_tra_ncc con_no_ncc trang_thai' })
        .populate({ path: 'nhap_vat_chua_id', select: '_id' })
        .populate({ path: 'phieu_tra_nhap_id', select: '_id ncc_da_tra' })
        .populate({ path: 'phieu_thu_chi_id', select: 'trang_thai' })
        .lean();
    var debtTransactionRows = GiaoDichCongNoNhaCungCap ? await GiaoDichCongNoNhaCungCap.find(debtTransactionMatch)
        .populate({ path: 'phieu_nhap_id', select: 'trang_thai' })
        .populate({ path: 'phieu_tra_hang_nhap_id', select: 'trang_thai' })
        .populate({ path: 'phieu_thu_chi_id', select: 'trang_thai' })
        .lean() : [];
    var purchaseReturnRows = PhieuTraHangNhap ? await PhieuTraHangNhap.aggregate([
        { $match: purchaseReturnMatch },
        {
            $group: {
                _id: '$nha_cung_cap_id',
                tong_tra_hang: { $sum: { $ifNull: ['$ncc_can_tra', '$tong_tien_tra'] } },
                da_tra_hang: { $sum: { $ifNull: ['$ncc_da_tra', 0] } }
            }
        }
    ]) : [];
    var map = {};
    purchaseRows.forEach(function(r) {
        if (!r._id) return;
        map[String(r._id)] = {
            tong_mua: Number(r.tong_mua || 0),
            tong_no: Number(r.tong_no_phieu_nhap || 0),
            da_tra_tong: 0,
            da_tra_phieu_nhap: Number(r.da_tra_phieu_nhap || 0)
        };
    });
    purchaseReturnRows.forEach(function(r) {
        if (!r._id) return;
        var key = String(r._id);
        if (!map[key]) map[key] = { tong_mua: 0, tong_no: 0, da_tra_tong: 0, da_tra_phieu_nhap: 0 };
        map[key].tong_mua -= Number(r.tong_tra_hang || 0);
        map[key].tong_no -= Number(r.da_tra_hang || 0);
    });
    debtRows.filter(isVisibleSupplierDebtRow).forEach(function(r) {
        if (!r.nha_cung_cap_id) return;
        if (r.nhap_vat_chua_id) return;
        if (r.phieu_nhap_id || r.phieu_tra_nhap_id) return;
        if (r.loai === 'thanh_toan') return;
        var key = String(r.nha_cung_cap_id);
        if (!map[key]) map[key] = { tong_mua: 0, tong_no: 0, da_tra_tong: 0, da_tra_phieu_nhap: 0 };
        var amount = Number(r.so_tien || 0);
        if (r.loai === 'tang_no' && r.phieu_nhap_id && typeof r.phieu_nhap_id === 'object') {
            amount = Number(r.phieu_nhap_id.can_tra_ncc || r.phieu_nhap_id.tong_tien || r.phieu_nhap_id.con_no_ncc || r.so_tien || 0);
        }
        if (r.loai === 'tang_no') map[key].tong_no += amount;
        if (r.loai === 'giam_no' && r.phieu_tra_nhap_id && typeof r.phieu_tra_nhap_id === 'object') {
            amount = Number(r.phieu_tra_nhap_id.ncc_da_tra || 0);
        }
        if (r.loai === 'giam_no' || r.loai === 'thanh_toan') map[key].tong_no -= amount;
        if (r.loai === 'thanh_toan') map[key].da_tra_tong = Number(map[key].da_tra_tong || 0) + amount;
    });
    debtTransactionRows.filter(isVisibleSupplierDebtRow).forEach(function(r) {
        if (!r.nha_cung_cap_id) return;
        if (r.nhap_vat_chua_id) return;
        if (r.phieu_nhap_id || r.phieu_tra_hang_nhap_id) return;
        if (r.loai_giao_dich === 'thanh_toan') return;
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

function applySupplierTotalsFromMap(supplier, totalsMap) {
    if (!supplier) return;
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
    supplier.tong_no = supplier.tong_no_theo_so;
    supplier.da_thanh_toan = resolveSupplierDaThanhToan(supplier);
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

module.exports = {
  SUPPLIER_DEBT_WARN_DEFAULT_DAYS,
  aggregateSupplierPurchaseTotals,
  aggregateSupplierDebtDayInfo,
  applySupplierTotalsFromMap,
  applySupplierDebtDayInfo,
  normalizeDebtWarnSettings,
  evaluateSupplierDebtWarning,
  applySupplierDebtWarning,
  filterSuppliersByDebtWarning,
  sortSuppliersByDebtDaySort,
  normalizeSupplierMetricIds,
  countSupplierMetricIdCandidates,
  normalizeSupplierObjectIds
};
