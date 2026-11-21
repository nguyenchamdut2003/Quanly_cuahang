const { mongoose, PhieuNhap, PhieuTraHangNhap, CongNoNhaCungCap, GiaoDichCongNoNhaCungCap, NhapVatChua, XuatVatChua, parseMoney } = require('./common.helper');
const { hasFilterQueryValue } = require('./filter.helper');
const { isVisibleSupplierDebtRow, isManualNhapVatChuaDoc, resolveSupplierDaThanhToan } = require('./debt.helper');
const { loadNhapVatChuaPaymentTotals } = require('../../../services/vatChuaPaymentTotals.service');

var SUPPLIER_DEBT_WARN_DEFAULT_DAYS = 10;

async function aggregateManualVatChuaSupplierTotals(storeId, supplierObjectIds) {
    var map = {};
    if (!NhapVatChua) return map;

    var nhapMatch = {
        doi_tuong_type: 'nha_cung_cap',
        trang_thai: 'active',
        tong_tien: { $gt: 0 },
        doi_tuong_id: { $exists: true, $ne: null },
        $or: [
            { source_type: 'manual' },
            { source_type: { $exists: false } },
            { source_type: null },
            { source_type: '' }
        ]
    };
    var xuatMatch = {
        doi_tuong_type: 'nha_cung_cap',
        source_type: 'manual',
        trang_thai: 'active',
        tong_tien: { $gt: 0 },
        doi_tuong_id: { $exists: true, $ne: null }
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        var storeObjectId = new mongoose.Types.ObjectId(String(storeId));
        nhapMatch.cua_hang_id = storeObjectId;
        xuatMatch.cua_hang_id = storeObjectId;
    }
    if (supplierObjectIds && supplierObjectIds.length) {
        nhapMatch.doi_tuong_id = { $in: supplierObjectIds };
        xuatMatch.doi_tuong_id = { $in: supplierObjectIds };
    }

    var nhapRows = await NhapVatChua.aggregate([
        { $match: nhapMatch },
        {
            $group: {
                _id: '$doi_tuong_id',
                tong_mua: { $sum: { $ifNull: ['$tong_tien', 0] } },
                ids: { $push: '$_id' },
                documents: { $push: { _id: '$_id', ma_nhap_vat_chua: '$ma_nhap_vat_chua', cua_hang_id: '$cua_hang_id' } }
            }
        }
    ]);

    var allNhapDocs = [];
    nhapRows.forEach(function(row) {
        (row.documents || []).forEach(function(doc) { allNhapDocs.push(doc); });
    });
    var paidByNhap = await loadNhapVatChuaPaymentTotals(allNhapDocs, { storeId: storeId });

    nhapRows.forEach(function(row) {
        if (!row._id) return;
        var key = String(row._id);
        var paid = 0;
        (row.ids || []).forEach(function(id) {
            paid += Math.max(0, Number(paidByNhap.get(String(id)) || 0));
        });
        var tongMua = Math.max(0, Number(row.tong_mua || 0));
        map[key] = {
            tong_mua: tongMua,
            tong_no: Math.max(0, tongMua - paid),
            da_tra: paid
        };
    });

    if (XuatVatChua) {
        var xuatRows = await XuatVatChua.find(xuatMatch)
            .select('doi_tuong_id tong_tien source_id')
            .lean();
        var sourceIds = xuatRows.map(function(row) { return row.source_id; }).filter(Boolean);
        var nhapSourceById = Object.create(null);
        if (sourceIds.length) {
            var sourceNhaps = await NhapVatChua.find({ _id: { $in: sourceIds } })
                .select('source_type trang_thai')
                .lean();
            sourceNhaps.forEach(function(nhap) {
                nhapSourceById[String(nhap._id)] = nhap;
            });
        }
        xuatRows.forEach(function(row) {
            if (!row.doi_tuong_id) return;
            if (row.source_id) {
                var src = nhapSourceById[String(row.source_id)];
                if (src && !isManualNhapVatChuaDoc(src)) return;
            }
            var key = String(row.doi_tuong_id);
            if (!map[key]) map[key] = { tong_mua: 0, tong_no: 0, da_tra: 0 };
            var amount = Math.max(0, Number(row.tong_tien || 0));
            // Cho phép âm tạm thời: chỉ xuất thủ công (không có nhập) vẫn phải giảm nợ phiếu nhập.
            map[key].tong_no = Number(map[key].tong_no || 0) - amount;
        });
    }

    return map;
}

async function aggregateSupplierPurchaseTotals(storeId, supplierIds) {
    var purchaseMatch = {
        trang_thai: 'completed',
        trang_thai_du_lieu: { $ne: 'inactive' },
        nha_cung_cap_id: { $exists: true, $ne: null }
    };
    var purchaseReturnMatch = {
        trang_thai: 'completed',
        trang_thai_du_lieu: { $ne: 'inactive' },
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
        .populate({ path: 'phieu_nhap_id', select: '_id tong_tien can_tra_ncc con_no_ncc trang_thai trang_thai_du_lieu' })
        .populate({ path: 'nhap_vat_chua_id', select: '_id source_type trang_thai' })
        .populate({ path: 'phieu_tra_nhap_id', select: '_id ncc_da_tra trang_thai trang_thai_du_lieu' })
        .populate({ path: 'phieu_thu_chi_id', select: 'trang_thai' })
        .lean();
    var debtTransactionRows = GiaoDichCongNoNhaCungCap ? await GiaoDichCongNoNhaCungCap.find(debtTransactionMatch)
        .populate({ path: 'phieu_nhap_id', select: 'trang_thai trang_thai_du_lieu' })
        .populate({ path: 'phieu_tra_hang_nhap_id', select: 'trang_thai trang_thai_du_lieu' })
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
    var vatChuaTotals = await aggregateManualVatChuaSupplierTotals(storeId, supplierObjectIds);
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
    Object.keys(vatChuaTotals).forEach(function(key) {
        var vc = vatChuaTotals[key] || {};
        if (!map[key]) map[key] = { tong_mua: 0, tong_no: 0, da_tra_tong: 0, da_tra_phieu_nhap: 0 };
        map[key].tong_mua += Number(vc.tong_mua || 0);
        map[key].tong_no += Number(vc.tong_no || 0);
        map[key].da_tra_tong = Number(map[key].da_tra_tong || 0) + Number(vc.da_tra || 0);
    });
    debtRows.filter(isVisibleSupplierDebtRow).forEach(function(r) {
        if (!r.nha_cung_cap_id) return;
        // Công nợ VC thủ công đã cộng qua aggregate riêng.
        if (r.nhap_vat_chua_id || r.xuat_vat_chua_id) return;
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
        map[key].da_tra_tong = Number(map[key].da_tra_tong || 0) + Number(map[key].da_tra_phieu_nhap || 0);
        map[key].tong_no = Math.max(0, Number(map[key].tong_no || 0));
        map[key].tong_mua = Number(map[key].tong_mua || 0);
    });
    return map;
}

async function aggregateSupplierDebtDayInfo(storeId, supplierIds) {
    var match = {
        trang_thai: 'completed',
        trang_thai_du_lieu: { $ne: 'inactive' },
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

async function aggregateSupplierAdvanceBalances(storeId, supplierIds) {
    var map = {};
    var PhieuTamUng;
    try {
        PhieuTamUng = require('../../../models/tamung.model').PhieuTamUng;
    } catch (err) {
        return map;
    }
    if (!PhieuTamUng) return map;

    var match = {
        loai_doi_tuong: 'nha_cung_cap',
        trang_thai_du_lieu: 'active',
        trang_thai: { $in: ['active', 'da_dung_het'] },
        nha_cung_cap_id: { $exists: true, $ne: null },
        con_lai: { $gt: 0 }
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        match.cua_hang_id = new mongoose.Types.ObjectId(String(storeId));
    }
    var supplierObjectIds = normalizeSupplierObjectIds(supplierIds);
    if (supplierObjectIds.length) {
        match.nha_cung_cap_id = { $in: supplierObjectIds };
    }

    var rows = await PhieuTamUng.aggregate([
        { $match: match },
        {
            $group: {
                _id: '$nha_cung_cap_id',
                tam_ung: { $sum: { $ifNull: ['$con_lai', 0] } }
            }
        }
    ]);

    rows.forEach(function(row) {
        if (!row || !row._id) return;
        map[String(row._id)] = Math.max(0, Number(row.tam_ung || 0));
    });
    return map;
}

function applySupplierAdvanceFromMap(supplier, advanceMap) {
    if (!supplier) return;
    var tamUng = advanceMap ? Number(advanceMap[String(supplier._id)] || 0) : 0;
    supplier.tam_ung = Math.max(0, tamUng);
    supplier.tong_no_cuoi = Number(supplier.tong_no || 0) - supplier.tam_ung;
}

module.exports = {
  SUPPLIER_DEBT_WARN_DEFAULT_DAYS,
  aggregateSupplierPurchaseTotals,
  aggregateSupplierDebtDayInfo,
  aggregateSupplierAdvanceBalances,
  applySupplierTotalsFromMap,
  applySupplierDebtDayInfo,
  applySupplierAdvanceFromMap,
  normalizeDebtWarnSettings,
  evaluateSupplierDebtWarning,
  applySupplierDebtWarning,
  filterSuppliersByDebtWarning,
  sortSuppliersByDebtDaySort,
  normalizeSupplierMetricIds,
  countSupplierMetricIdCandidates,
  normalizeSupplierObjectIds
};
