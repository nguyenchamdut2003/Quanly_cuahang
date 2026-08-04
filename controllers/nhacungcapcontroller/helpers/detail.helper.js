const { mongoose, querystring, NhaCungCap, NhomNhaCungCap, PhieuNhap, PhieuTraHangNhap, CongNoNhaCungCap, GiaoDichCongNoNhaCungCap, DiaChiNhaCungCap, PhieuXuatNoiBo, CTXuatNoiBo, NhapVatChua, XuatVatChua, buildSupplierHangHoaExportPack, buildSupplierPurchaseInvoiceExportPack, handleSupplierDebtExport, formatDate, getUserName, SUPPLIER_DEBT_WARN_DEFAULT_DAYS, resolveStoreId, normalizeIdParam, loadAddressTypes } = require('./common.helper');
const { normalizeFilterQuery, buildFilterQueryString } = require('./filter.helper');
const { aggregateSupplierPurchaseTotals, applySupplierTotalsFromMap, normalizeDebtWarnSettings } = require('./metrics.helper');
const { isVisibleSupplierDebtRow, getDebtDocumentInfo, getSupplierDebtAmountInfo, getLegacySupplierDebtDelta, getDebtEventTime, getDebtDisplayDate, sortDebtLedgerAsc, enrichSupplierDebtHistory, mapSupplierDebtTransactionLabel, resolveSupplierDaThanhToan, loadSupplierUnpaidPurchases, sumInvoiceDebt, buildDebtReconciliation, loadActiveCashBooks } = require('./debt.helper');
const { buildProfitBySupplierAddressReport } = require('../../../services/profitReport.service');

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
    var addressProfitReport = await buildProfitBySupplierAddressReport({
        cua_hang_id: storeId,
        supplier_id: selectedSupplier._id,
        addresses: supplierAddresses
    });
    var addressProfitById = new Map((addressProfitReport.rows || []).map(function(row) {
        return [String(row.address_id || row.id || ''), row];
    }));
    supplierAddresses = supplierAddresses.map(function(address) {
        var profit = addressProfitById.get(String(address._id || '')) || {};
        return Object.assign({}, address, {
            doanh_thu: Number(profit.doanh_thu || 0),
            gia_von: Number(profit.gia_von || 0),
            loi_nhuan: Number(profit.loi_nhuan || 0),
            ty_le_loi_nhuan: Number(profit.ty_le_loi_nhuan || 0),
            so_luong_ban: Number(profit.so_luong || 0),
            thieu_gia_von: Boolean(profit.thieu_gia_von),
            profit_detail_rows: Array.isArray(profit.detailRows) ? profit.detailRows : []
        });
    });

    var phieuNhapQuery = {
        nha_cung_cap_id: selectedSupplier._id,
        trang_thai: { $in: ['completed', 'draft', 'cancelled'] }
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
        var phieuTraQuery = { nha_cung_cap_id: selectedSupplier._id };
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
        
        .sort({ created_at: -1 })
        .lean();
    var supplierVatChuaHistory = nhapVatChuaRows.map(function(row) {
        return {
            loai: 'nhap_vat_chua',
            nhap_vat_chua_id: row._id,
            ma_phieu: row.ma_nhap_vat_chua || '--',
            thoi_gian: row.created_at,
            nguoi_tao: '--',
            so_luong: Number(row.tong_so_luong || row.so_luong || 0),
            tong_cong: Number(row.tong_tien || 0),
            trang_thai: row.trang_thai || 'active'
        };
    });

    var traVatChuaQuery = {
        doi_tuong_type: 'nha_cung_cap',
        doi_tuong_id: selectedSupplier._id,
        loai_xuat: 'tra_hang_nhap',
        trang_thai: 'active'
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        traVatChuaQuery.cua_hang_id = storeId;
    }
    var traVatChuaRows = await XuatVatChua.find(traVatChuaQuery)
        .sort({ created_at: -1 })
        .lean();
    supplierVatChuaHistory = supplierVatChuaHistory.concat(traVatChuaRows.map(function(row) {
        return {
            loai: 'tra_vat_chua',
            xuat_vat_chua_id: row._id,
            ma_phieu: row.ma_xuat_vat_chua || '--',
            thoi_gian: row.created_at,
            nguoi_tao: '--',
            so_luong: Number(row.tong_so_luong || row.so_luong || 0),
            tong_cong: Number(row.tong_tien || 0),
            trang_thai: row.trang_thai || 'active'
        };
    }));
    supplierPurchaseHistory.sort(function(a, b) {
        return new Date(b.thoi_gian || 0).getTime() - new Date(a.thoi_gian || 0).getTime();
    });
    supplierVatChuaHistory.sort(function(a, b) {
        return new Date(b.thoi_gian || 0).getTime() - new Date(a.thoi_gian || 0).getTime();
    });

    var debtQuery = { nha_cung_cap_id: selectedSupplier._id };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        debtQuery.cua_hang_id = storeId;
    }
    var debtRows = await CongNoNhaCungCap.find(debtQuery)
        .populate({ path: 'phieu_nhap_id', select: 'ma_phieu_nhap ngay_nhap created_at tong_tien can_tra_ncc da_tra_ncc con_no_ncc trang_thai' })
        .populate({ path: 'nhap_vat_chua_id', select: 'ma_nhap_vat_chua created_at tong_tien tong_so_luong trang_thai' })
        .populate({
            path: 'phieu_tra_nhap_id',
            select: 'ma_phieu_tra_nhap ngay_tra created_at tong_tien_tra ncc_can_tra ncc_da_tra phieu_nhap_id trang_thai',
            populate: { path: 'phieu_nhap_id', select: 'ngay_nhap created_at' }
        })
        .populate({ path: 'phieu_thu_chi_id', select: 'ma_phieu loai_phieu loai_thu_chi trang_thai' })
        .sort({ ngay: -1, created_at: -1 })
        .lean();
    debtRows = debtRows.filter(isVisibleSupplierDebtRow);
    var debtTransactionRows = GiaoDichCongNoNhaCungCap ? await GiaoDichCongNoNhaCungCap.find({
        nha_cung_cap_id: selectedSupplier._id,
        ...(storeId && mongoose.Types.ObjectId.isValid(storeId) ? { cua_hang_id: storeId } : {}),
        trang_thai: 'active'
    })
        .populate({ path: 'phieu_nhap_id', select: 'trang_thai' })
        .populate({ path: 'phieu_tra_hang_nhap_id', select: 'trang_thai' })
        .populate({ path: 'phieu_thu_chi_id', select: 'trang_thai' })
        .sort({ ngay_giao_dich: -1, created_at: -1 })
        .lean() : [];
    debtTransactionRows = debtTransactionRows.filter(isVisibleSupplierDebtRow);
    var vatChuaReturnQuery = {
        doi_tuong_type: 'nha_cung_cap',
        doi_tuong_id: selectedSupplier._id,
        loai_xuat: 'tra_hang_nhap',
        trang_thai: 'active'
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
        supplierVatChuaHistory: supplierVatChuaHistory,
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
            ten_hang_hoa: itemNames.length ? itemNames.join(', ') : 'Kh\u00f4ng c\u00f3',
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

function buildSupplierInternalExportReceiverNames(supplier) {
    var names = [];
    [supplier?.ten_ncc, supplier?.ten_cong_ty, supplier?.sdt].forEach(function(value) {
        var text = String(value || '').trim();
        if (text && names.indexOf(text) < 0) names.push(text);
    });
    return names;
}

function mapNhapHangStatus(value) {
    if (value === 'draft') return 'Phi\u1ebfu t\u1ea1m';
    if (value === 'cancelled') return '\u0110\u00e3 h\u1ee7y';
    return '\u0110\u00e3 nh\u1eadp h\u00e0ng';
}

function mapTraHangStatus(value) {
    if (value === 'draft') return 'Phi\u1ebfu t\u1ea1m';
    if (value === 'cancelled') return '\u0110\u00e3 h\u1ee7y';
    return 'Tr\u1ea3 h\u00e0ng nh\u1eadp';
}

function mapXuatNoiBoStatus(status) {
    if (status === 'completed') return 'Ho\u00e0n th\u00e0nh';
    if (status === 'draft') return 'Phi\u1ebfu t\u1ea1m';
    if (status === 'cancelled') return '\u0110\u00e3 h\u1ee7y';
    return status || '--';
}

function mapCongNoLoai(value) {
    if (value === 'thanh_toan') return 'Thanh to\u00e1n';
    if (value === 'giam_no') return 'Gi\u1ea3m n\u1ee3';
    return 'Nh\u1eadp h\u00e0ng';
}

function mapCongNoDirection(value) {
    return value === 'tang_no' ? 'T\u0103ng n\u1ee3' : 'Gi\u1ea3m n\u1ee3';
}

function mapSupplierPurchaseHistoryType(value) {
    if (value === 'tra') return 'Tr\u1ea3 h\u00e0ng h\u00f3a';
    if (value === 'nhap_vat_chua') return 'Nh\u1eadp v\u1eadt ch\u1ee9a';
    if (value === 'tra_vat_chua') return 'Tr\u1ea3 v\u1eadt ch\u1ee9a';
    return 'Nh\u1eadp h\u00e0ng h\u00f3a';
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

module.exports = {
  loadSupplierDetailRenderLocals,
  loadSupplierInternalExportHistory,
  buildSupplierInternalExportFilter,
  buildSupplierInternalExportReceiverNames,
  mapNhapHangStatus,
  mapTraHangStatus,
  mapXuatNoiBoStatus,
  mapCongNoLoai,
  mapCongNoDirection,
  mapSupplierPurchaseHistoryType,
  buildSupplierReturnUrl
};

