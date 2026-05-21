var mongoose = require('mongoose');
var querystring = require('querystring');
var ExcelJS = require('exceljs');
var { NhaCungCap, NhomNhaCungCap, PhieuNhap, PhieuTraHangNhap, CongNoNhaCungCap, CuaHang, DiaChiNcc, DiaChiDoiTuong, LoaiDiaChiKhachHang, PhieuXuatNoiBo, SoQuy } = require('../models/kiot.model');
var { taoPhieuThuChi, parseMoney } = require('../services/soQuy.service');
var { normalizeAddress } = require('../utils/address');
var DiaChiNhaCungCap = DiaChiNcc || DiaChiDoiTuong;

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

/** Tổng mua từ phiếu nhập, tổng nợ từ sổ công nợ NCC (theo cửa hàng nếu có). */
async function aggregateSupplierPurchaseTotals(storeId) {
    var purchaseMatch = {
        trang_thai: 'completed',
        nha_cung_cap_id: { $exists: true, $ne: null }
    };
    var debtMatch = {
        nha_cung_cap_id: { $exists: true, $ne: null }
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        var storeObjectId = new mongoose.Types.ObjectId(String(storeId));
        purchaseMatch.cua_hang_id = storeObjectId;
        debtMatch.cua_hang_id = storeObjectId;
    }
    var purchaseRows = await PhieuNhap.aggregate([
        { $match: purchaseMatch },
        {
            $group: {
                _id: '$nha_cung_cap_id',
                tong_mua: { $sum: { $ifNull: ['$tong_tien', 0] } },
                da_tra_tong: { $sum: { $ifNull: ['$da_tra_ncc', 0] } }
            }
        }
    ]);
    var debtRows = await CongNoNhaCungCap.aggregate([
        { $match: debtMatch },
        {
            $group: {
                _id: '$nha_cung_cap_id',
                tang_no: {
                    $sum: { $cond: [{ $eq: ['$loai', 'tang_no'] }, { $ifNull: ['$so_tien', 0] }, 0] }
                },
                giam_no: {
                    $sum: { $cond: [{ $in: ['$loai', ['giam_no', 'thanh_toan']] }, { $ifNull: ['$so_tien', 0] }, 0] }
                },
                thanh_toan: {
                    $sum: { $cond: [{ $eq: ['$loai', 'thanh_toan'] }, { $ifNull: ['$so_tien', 0] }, 0] }
                }
            }
        }
    ]);
    var map = {};
    purchaseRows.forEach(function(r) {
        if (!r._id) return;
        map[String(r._id)] = {
            tong_mua: Number(r.tong_mua || 0),
            tong_no: 0,
            da_tra_tong: Number(r.da_tra_tong || 0)
        };
    });
    debtRows.forEach(function(r) {
        if (!r._id) return;
        var key = String(r._id);
        if (!map[key]) map[key] = { tong_mua: 0, tong_no: 0, da_tra_tong: 0 };
        map[key].tong_no = Number(r.tang_no || 0) - Number(r.giam_no || 0);
        map[key].da_tra_tong = Number(r.thanh_toan || 0);
    });
    return map;
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
        return {
            type: 'phieu_thu_chi',
            label: 'Phiếu thu/chi',
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
    return { type: '', label: 'Khác', doc: null, code: '--' };
}

function applySupplierTotalsFromMap(supplier, totalsMap) {
    if (!supplier) return;
    var t = totalsMap[String(supplier._id)];
    if (t) {
        supplier.tong_mua = t.tong_mua;
        supplier.tong_no = t.tong_no;
        supplier.da_tra_tong = t.da_tra_tong;
    } else {
        supplier.tong_mua = 0;
        supplier.tong_no = 0;
        supplier.da_tra_tong = 0;
    }
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

function normalizeFilterQuery(query) {
    query = query || {};
    var groupId = String(query.groupId || 'all').trim() || 'all';
    var status = query.status === 'active' || query.status === 'inactive' ? query.status : 'all';
    var totalBuyFrom = String(query.totalBuyFrom || '').trim();
    var totalBuyTo = String(query.totalBuyTo || '').trim();
    var currentDebtFrom = String(query.currentDebtFrom || '').trim();
    var currentDebtTo = String(query.currentDebtTo || '').trim();
    var created = ['all', 'today', '7days', '30days', 'custom'].indexOf(query.created) >= 0 ? query.created : 'all';
    var createdFrom = String(query.createdFrom || '').trim();
    var createdTo = String(query.createdTo || '').trim();

    return {
        groupId: groupId,
        status: status,
        totalBuyFrom: totalBuyFrom,
        totalBuyTo: totalBuyTo,
        currentDebtFrom: currentDebtFrom,
        currentDebtTo: currentDebtTo,
        created: created,
        createdFrom: createdFrom,
        createdTo: createdTo
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
    if (filter.totalBuyFrom) params.push('totalBuyFrom=' + encodeURIComponent(filter.totalBuyFrom));
    if (filter.totalBuyTo) params.push('totalBuyTo=' + encodeURIComponent(filter.totalBuyTo));
    if (filter.currentDebtFrom) params.push('currentDebtFrom=' + encodeURIComponent(filter.currentDebtFrom));
    if (filter.currentDebtTo) params.push('currentDebtTo=' + encodeURIComponent(filter.currentDebtTo));
    if (filter.created !== 'all') params.push('created=' + encodeURIComponent(filter.created));
    if (filter.created === 'custom' && filter.createdFrom) params.push('createdFrom=' + encodeURIComponent(filter.createdFrom));
    if (filter.created === 'custom' && filter.createdTo) params.push('createdTo=' + encodeURIComponent(filter.createdTo));
    return params.join('&');
}

function makeRangeFilter(minRaw, maxRaw) {
    var hasMinValue = String(minRaw || '').trim() !== '';
    var hasMaxValue = String(maxRaw || '').trim() !== '';
    if (!hasMinValue && !hasMaxValue) return null;

    var min = Number(minRaw);
    var max = Number(maxRaw);
    var hasMin = hasMinValue && Number.isFinite(min);
    var hasMax = hasMaxValue && Number.isFinite(max);
    if (!hasMin && !hasMax) return null;

    var range = {};
    if (hasMin) range.$gte = min < 0 ? 0 : min;
    if (hasMax) range.$lte = max < 0 ? 0 : max;
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
    var number = Number(value || 0);
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
    var paid = Number(supplier.da_tra_tong || 0);
    if (!Number.isFinite(paid) || paid < 0) paid = 0;
    if (!paid && (totalBuy || debt)) paid = Math.max(0, totalBuy - debt);
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
    return rows.map(function(row) {
        return {
            _id: row._id,
            ma_xuat_noi_bo: row.ma_xuat_noi_bo || '--',
            loai_xuat: row.loai_xuat || '--',
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
    var debtByLedger = Number(ledgerDebt || 0);
    var debtDiff = debtByInvoices - debtByLedger;
    return {
        debtByInvoices: debtByInvoices,
        debtByLedger: debtByLedger,
        debtDiff: debtDiff,
        hasDebtMismatch: Math.abs(debtDiff) > 1
    };
}

async function loadActiveCashBooks(storeId) {
    var query = { trang_thai: 'active' };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
    var rows = await SoQuy.find(query).sort({ ten_so_quy: 1, loai: 1 }).lean();
    if (!rows.length && query.cua_hang_id) {
        rows = await SoQuy.find({ trang_thai: 'active' }).sort({ ten_so_quy: 1, loai: 1 }).lean();
    }
    return rows;
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

function buildSupplierReturnUrl(supplierId, returnQueryRaw) {
    void supplierId;
    var returnQuery = String(returnQueryRaw || '').trim().replace(/^\?/, '');
    var params = returnQuery ? returnQuery.split('&').filter(Boolean) : [];
    var paramsWithoutSupplier = params.filter(function(item) {
        return item.indexOf('supplier=') !== 0;
    });
    return '/nha-cung-cap' + (paramsWithoutSupplier.length ? '?' + paramsWithoutSupplier.join('&') : '');
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

    var supplierAddresses = await DiaChiNhaCungCap.find({ nha_cung_cap_id: selectedSupplier._id }).sort({ created_at: -1 }).lean();

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
                thoi_gian: row.ngay_tra || row.created_at,
                nguoi_tao: row?.nguoi_tao_id?.ho_ten || row?.nguoi_tao_id?.email || '--',
                tong_cong: Number(row.tong_tien_tra || 0),
                trang_thai: row.trang_thai || 'completed'
            };
        }));
    }
    supplierPurchaseHistory.sort(function(a, b) {
        return new Date(b.thoi_gian || 0).getTime() - new Date(a.thoi_gian || 0).getTime();
    });

    var debtQuery = { nha_cung_cap_id: selectedSupplier._id };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        debtQuery.cua_hang_id = storeId;
    }
    var debtRows = await CongNoNhaCungCap.find(debtQuery)
        .populate({ path: 'phieu_nhap_id', select: 'ma_phieu_nhap' })
        .populate({ path: 'phieu_tra_nhap_id', select: 'ma_phieu_tra_nhap' })
        .populate({ path: 'phieu_thu_chi_id', select: 'ma_phieu loai_phieu loai_thu_chi' })
        .sort({ ngay: -1, created_at: -1 })
        .lean();
    var runningDebt = 0;
    var debtAsc = debtRows.slice().reverse();
    var mappedDebtAsc = debtAsc.map(function(row) {
        var soTien = Number(row.so_tien || 0);
        if (row.loai === 'tang_no') runningDebt += soTien;
        if (row.loai === 'giam_no' || row.loai === 'thanh_toan') runningDebt -= soTien;
        var docInfo = getDebtDocumentInfo(row);
        return {
            phieu_nhap_id: row.phieu_nhap_id,
            phieu_tra_nhap_id: row.phieu_tra_nhap_id,
            phieu_thu_chi_id: row.phieu_thu_chi_id,
            ma_phieu: docInfo.code,
            loai_chung_tu: docInfo.label,
            thoi_gian: row.ngay || row.created_at,
            loai: row.loai || 'tang_no',
            gia_tri: soTien,
            no_con_lai: runningDebt,
            ghi_chu: row.ghi_chu || ''
        };
    });
    var supplierDebtHistory = mappedDebtAsc.reverse();

    var supplierInternalExportHistory = await loadSupplierInternalExportHistory(selectedSupplier, storeId);
    var supplierUnpaidPurchases = await loadSupplierUnpaidPurchases(selectedSupplier._id, storeId);
    var debtReconciliation = buildDebtReconciliation(sumInvoiceDebt(supplierUnpaidPurchases), selectedSupplier.tong_no);
    var cashBooks = await loadActiveCashBooks(storeId);

    var filter = normalizeFilterQuery(req?.query || {});
    var filterQueryString = buildFilterQueryString(filter);
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
        currentUserName: getUserName(req?.user) || 'test',
        addressTypes: addressTypes,
        filterQueryString: filterQueryString,
        formatDate: formatDate,
        mapNhapHangStatus: mapNhapHangStatus,
        mapTraHangStatus: mapTraHangStatus,
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

async function seedSuppliersIfEmpty() {
    var count = await NhaCungCap.countDocuments();
    if (count > 0) return;

    await NhaCungCap.insertMany([
        { ma_ncc: 'NCC0001', ten_ncc: 'Nhà cung cấp An Phú', sdt: '0911000001', email: 'anphu@example.com', tong_no: 0, tong_mua: 5000000, trang_thai: 'active' },
        { ma_ncc: 'NCC0002', ten_ncc: 'Công ty Hoàng Gia', sdt: '0911000002', email: 'hoanggia@example.com', ten_cong_ty: 'Công ty Hoàng Gia', ma_so_thue: '0309998887', tong_no: 2400000, tong_mua: 12000000, trang_thai: 'active' },
        { ma_ncc: 'NCC0003', ten_ncc: 'Nhà cung cấp Minh Tâm', sdt: '0911000003', email: 'minhtam@example.com', tong_no: 900000, tong_mua: 3000000, trang_thai: 'inactive' }
    ]);
}

exports.index = async function(req, res, next) {
    try {
        var storeId = await resolveStoreId(req);

        var requestQuery = req?.query || {};
        if (Object.prototype.hasOwnProperty.call(requestQuery, 'supplier')) {
            var redirectQuery = Object.assign({}, requestQuery);
            delete redirectQuery.supplier;
            var qsStr = querystring.stringify(redirectQuery);
            return res.redirect(302, '/nha-cung-cap' + (qsStr ? '?' + qsStr : ''));
        }

        var filter = normalizeFilterQuery(requestQuery);
        var supplierQuery = buildSupplierQueryFromFilter(filter);

        var supplierGroups = await loadSupplierGroups();
        var addressTypes = await loadAddressTypes();
        var suppliers = await NhaCungCap.find(supplierQuery).sort({ created_at: 1, ma_ncc: 1 }).lean();
        var totalsMap = await aggregateSupplierPurchaseTotals(storeId);
        suppliers.forEach(function(s) { applySupplierTotalsFromMap(s, totalsMap); });
        suppliers = filterSuppliersByComputedTotals(suppliers, filter);

        res.render('nha-cung-cap/index', {
            title: 'Nhà cung cấp',
            pageTitle: 'Nhà cung cấp',
            activeMenu: 'nha-cung-cap',
            user: req.user,
            flash: requestQuery,
            suppliers: suppliers,
            supplierGroups: supplierGroups,
            addressTypes: addressTypes,
            formMode: requestQuery.mode === 'create' ? 'create' : '',
            formatDate: formatDate,
            filter: filter,
            filterQueryString: buildFilterQueryString(filter),
            mapNhapHangStatus: mapNhapHangStatus,
            mapTraHangStatus: mapTraHangStatus,
            mapCongNoLoai: mapCongNoLoai,
            mapCongNoDirection: mapCongNoDirection
        });
    } catch (error) {
        next(error);
    }
};

exports.exportExcel = async function(req, res, next) {
    try {
        var storeId = await resolveStoreId(req);
        var filter = normalizeFilterQuery(req?.query || {});
        var supplierQuery = buildSupplierQueryFromFilter(filter);
        var suppliers = await NhaCungCap.find(supplierQuery)
            .populate({ path: 'nhom_nha_cung_cap_id', select: 'ten_nhom_ncc ma_nhom_ncc' })
            .populate({ path: 'nguoi_tao_id', select: 'ho_ten username email' })
            .sort({ created_at: 1, ma_ncc: 1 })
            .lean();
        var totalsMap = await aggregateSupplierPurchaseTotals(storeId);
        suppliers.forEach(function(s) { applySupplierTotalsFromMap(s, totalsMap); });
        suppliers = filterSuppliersByComputedTotals(suppliers, filter);
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
    if (section === 'debt') {
        var wsD = workbook.addWorksheet('Công nợ');
        wsD.columns = [
            { header: 'Ngày', key: 'ngay', width: 20 },
            { header: 'Nhà cung cấp', key: 'nha_cung_cap', width: 28 },
            { header: 'Loại phát sinh', key: 'loai_phat_sinh', width: 16 },
            { header: 'Loại chứng từ', key: 'loai_chung_tu', width: 18 },
            { header: 'Mã chứng từ', key: 'ma_chung_tu', width: 18 },
            { header: 'Số tiền tăng nợ', key: 'tang_no', style: { numFmt: '#,##0' } },
            { header: 'Số tiền giảm nợ', key: 'giam_no', style: { numFmt: '#,##0' } },
            { header: 'Nợ còn lại', key: 'no_con_lai', style: { numFmt: '#,##0' } },
            { header: 'Ghi chú', key: 'ghi_chu', width: 36 }
        ];
        var debtMatch = { nha_cung_cap_id: supplier._id };
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) debtMatch.cua_hang_id = storeId;
        var debtRows = await CongNoNhaCungCap.find(debtMatch)
            .populate({ path: 'phieu_nhap_id', select: 'ma_phieu_nhap' })
            .populate({ path: 'phieu_tra_nhap_id', select: 'ma_phieu_tra_nhap' })
            .populate({ path: 'phieu_thu_chi_id', select: 'ma_phieu loai_phieu loai_thu_chi' })
            .sort({ ngay: 1, created_at: 1 })
            .lean();
        var runningDebt = 0;
        debtRows.forEach(function(row) {
            var amount = Number(row.so_tien || 0);
            if (row.loai === 'tang_no') runningDebt += amount;
            if (row.loai === 'giam_no' || row.loai === 'thanh_toan') runningDebt -= amount;
            var docInfo = getDebtDocumentInfo(row);
            wsD.addRow({
                ngay: formatExportDate(row.ngay || row.created_at),
                nha_cung_cap: supplier.ten_ncc || supplier.ma_ncc || '',
                loai_phat_sinh: mapCongNoLoai(row.loai),
                loai_chung_tu: docInfo.label,
                ma_chung_tu: docInfo.code,
                tang_no: row.loai === 'tang_no' ? amount : 0,
                giam_no: row.loai === 'giam_no' || row.loai === 'thanh_toan' ? amount : 0,
                no_con_lai: runningDebt,
                ghi_chu: row.ghi_chu || ''
            });
        });
        applySupplierWorksheetFormat(wsD);
        return { workbook: workbook, filename: 'ncc-' + safeMa + '-cong-no.xlsx' };
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
    return null;
}

exports.exportSupplierDetail = async function(req, res, next) {
    try {
        var supplierId = normalizeIdParam(req?.params?.id);
        var section = String(req?.params?.section || '').trim().toLowerCase();
        if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
            return res.redirect('/nha-cung-cap?error=invalid_supplier');
        }
        if (['info', 'address', 'history', 'debt', 'xnb'].indexOf(section) < 0) {
            return res.redirect('/nha-cung-cap?error=invalid_export');
        }
        var supplier = await NhaCungCap.findById(supplierId).lean();
        if (!supplier) return res.redirect('/nha-cung-cap?error=invalid_supplier');
        var storeId = await resolveStoreId(req);
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
        var debt = Number(supplier.tong_no || 0);

        var purchases = await loadSupplierUnpaidPurchases(supplier._id, storeId);

        var amount = parseMoney(req?.body?.gia_tri);
        if (amount <= 0) return res.status(400).json({ success: false, message: 'Số tiền trả phải lớn hơn 0' });
        var allowOverpayment = req?.body?.enable_overpayment === 'on' || req?.body?.enable_overpayment === 'true' || req?.body?.enable_overpayment === true;
        var payableDebt = Math.max(0, debt);
        if (!allowOverpayment && amount > payableDebt) {
            return res.status(400).json({
                success: false,
                message: 'Số tiền trả không được vượt quá nợ theo sổ công nợ. Bật trả dư / ứng trước NCC nếu muốn chi vượt.'
            });
        }

        var cashBookId = String(req?.body?.so_quy_id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(cashBookId)) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ' });
        }
        var paymentMethod = String(req?.body?.phuong_thuc_thanh_toan || '').trim();
        if (['tien_mat', 'chuyen_khoan', 'vi_dien_tu', 'khac'].indexOf(paymentMethod) < 0) paymentMethod = 'tien_mat';
        var note = String(req?.body?.ghi_chu || '').trim() || ('Thanh toán công nợ nhà cung cấp ' + (supplier.ten_ncc || supplier.ma_ncc || ''));

        var allocationLimit = Math.min(amount, payableDebt);
        var remaining = allocationLimit;
        var allocations = [];
        var manualAllocations = [];
        if (req?.body?.allocations_json) {
            try {
                manualAllocations = JSON.parse(String(req.body.allocations_json || '[]'));
                if (!Array.isArray(manualAllocations)) manualAllocations = [];
            } catch (parseError) {
                return res.status(400).json({ success: false, message: 'Phân bổ thanh toán không hợp lệ' });
            }
        }
        if (manualAllocations.length) {
            var purchaseMap = {};
            purchases.forEach(function(row) { purchaseMap[String(row._id)] = row; });
            var manualTotal = 0;
            for (var m = 0; m < manualAllocations.length; m++) {
                var manual = manualAllocations[m] || {};
                var manualPurchaseId = String(manual.phieu_nhap_id || '').trim();
                var manualPurchase = purchaseMap[manualPurchaseId];
                if (!manualPurchase) return res.status(400).json({ success: false, message: 'Phiếu nhập phân bổ không hợp lệ' });
                var manualDebt = Math.max(0, Number(manualPurchase.con_no_ncc || 0));
                var manualAmount = parseMoney(manual.so_tien);
                if (manualAmount <= 0) continue;
                if (manualAmount > manualDebt) return res.status(400).json({ success: false, message: 'Không được phân bổ vượt nợ phiếu nhập' });
                manualTotal += manualAmount;
                allocations.push({
                    phieu_nhap_id: manualPurchase._id,
                    ma_phieu_nhap: manualPurchase.ma_phieu_nhap || '',
                    so_tien: manualAmount,
                    con_no_truoc: manualDebt,
                    con_no_sau: Math.max(0, manualDebt - manualAmount)
                });
            }
            if (manualTotal > allocationLimit) return res.status(400).json({ success: false, message: 'Tổng tiền phân bổ không được vượt quá nợ theo sổ công nợ' });
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
        var allocatedTotal = allocations.reduce(function(sum, row) {
            return sum + Number(row.so_tien || 0);
        }, 0);
        if (allocatedTotal > allocationLimit) {
            return res.status(400).json({ success: false, message: 'Tổng tiền phân bổ không được vượt quá nợ theo sổ công nợ' });
        }
        var overpaymentAmount = Math.max(0, amount - payableDebt);
        var receiptNote = overpaymentAmount > 0
            ? (note + ' - Trả dư / ứng trước NCC: ' + overpaymentAmount.toLocaleString('vi-VN'))
            : note;

        var receipt = await taoPhieuThuChi({
            loai_phieu: 'chi',
            loai_thu_chi: 'thanh_toan_ncc',
            gia_tri: amount,
            nha_cung_cap_id: supplier._id,
            phieu_nhap_id: allocations.length === 1 ? allocations[0].phieu_nhap_id : undefined,
            nhom_doi_tuong: 'nha_cung_cap',
            phuong_thuc_thanh_toan: paymentMethod,
            so_quy_id: cashBookId,
            nguoi_tao_id: req.user && req.user._id,
            cua_hang_id: storeId || supplier.cua_hang_id,
            trang_thai: 'paid',
            ghi_chu: receiptNote,
            hach_toan: true,
            allocation_type: 'thanh_toan_ncc',
            overpayment_amount: overpaymentAmount,
            allocations: allocations
        });

        for (var j = 0; j < allocations.length; j++) {
            var allocation = allocations[j];
            var matchingPurchase = purchases.find(function(item) {
                return String(item._id) === String(allocation.phieu_nhap_id);
            });
            if (!matchingPurchase) continue;
            var payable = Number(matchingPurchase.can_tra_ncc || matchingPurchase.tong_tien || 0);
            if (!payable || payable < Number(matchingPurchase.da_tra_ncc || 0) + allocation.con_no_truoc) {
                payable = Number(matchingPurchase.da_tra_ncc || 0) + allocation.con_no_truoc;
            }
            var nextPaid = Math.min(Number(matchingPurchase.da_tra_ncc || 0) + allocation.so_tien, payable);
            var nextDebt = allocation.con_no_sau;
            await PhieuNhap.updateOne(
                { _id: allocation.phieu_nhap_id },
                { $set: { da_tra_ncc: nextPaid, con_no_ncc: nextDebt } }
            );
        }

        return res.json({
            success: true,
            message: 'Đã tạo phiếu chi thanh toán nhà cung cấp',
            data: {
                receipt: receipt,
                paid: amount,
                debt: debt - amount,
                allocated: allocatedTotal,
                overpayment_amount: overpaymentAmount
            }
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Không tạo được phiếu chi' });
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
            return res.redirect(buildSupplierReturnUrl(supplierId, req?.body?.returnQuery) + '&error=missing_address_data');
        }

        if (!payload.ma_dia_chi) payload.ma_dia_chi = await makeSupplierAddressCode();
        if (!payload.loai_dia_chi) payload.loai_dia_chi = 'khac';
        payload.nha_cung_cap_id = supplierId;

        if (payload.mac_dinh) {
            await DiaChiNhaCungCap.updateMany({ nha_cung_cap_id: supplierId }, { $set: { mac_dinh: false } });
        }

        await DiaChiNhaCungCap.create(payload);
        res.redirect(buildSupplierReturnUrl(supplierId, req?.body?.returnQuery) + '&success=created_address');
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
            return res.redirect(buildSupplierReturnUrl(supplierId, req?.body?.returnQuery) + '&error=missing_address_data');
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
        res.redirect(buildSupplierReturnUrl(supplierId, req?.body?.returnQuery) + '&success=updated_address');
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
        res.redirect(buildSupplierReturnUrl(supplierId, req?.body?.returnQuery) + '&success=deleted_address');
    } catch (error) {
        next(error);
    }
};
