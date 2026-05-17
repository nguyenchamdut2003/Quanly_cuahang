var mongoose = require('mongoose');
var ExcelJS = require('exceljs');
var { NhaCungCap, NhomNhaCungCap, PhieuNhap, PhieuTraHangNhap, CongNoNhaCungCap, CuaHang, DiaChiNcc, DiaChiDoiTuong, LoaiDiaChiKhachHang } = require('../models/kiot.model');
var DiaChiNhaCungCap = DiaChiNcc || DiaChiDoiTuong;

var SUPPLIER_EXPORT_COLUMNS = [
    { header: 'Mã NCC', key: 'ma_ncc' },
    { header: 'Tên nhà cung cấp', key: 'ten_ncc' },
    { header: 'Người liên hệ', key: 'nguoi_lien_he' },
    { header: 'Điện thoại', key: 'dien_thoai' },
    { header: 'Email', key: 'email' },
    { header: 'Địa chỉ', key: 'dia_chi' },
    { header: 'Tỉnh/TP', key: 'tinh_tp' },
    { header: 'Quận/Huyện', key: 'quan_huyen' },
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

/** Tổng mua / tổng nợ / đã trả tích lũy từ phiếu nhập đã hoàn thành (theo cửa hàng nếu có). */
async function aggregateSupplierPurchaseTotals(storeId) {
    var match = {
        trang_thai: 'completed',
        nha_cung_cap_id: { $exists: true, $ne: null }
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        match.cua_hang_id = new mongoose.Types.ObjectId(String(storeId));
    }
    var rows = await PhieuNhap.aggregate([
        { $match: match },
        {
            $group: {
                _id: '$nha_cung_cap_id',
                tong_mua: { $sum: { $ifNull: ['$tong_tien', 0] } },
                tong_no: { $sum: { $ifNull: ['$con_no_ncc', 0] } },
                da_tra_tong: { $sum: { $ifNull: ['$da_tra_ncc', 0] } }
            }
        }
    ]);
    var map = {};
    rows.forEach(function(r) {
        if (!r._id) return;
        map[String(r._id)] = {
            tong_mua: Number(r.tong_mua || 0),
            tong_no: Number(r.tong_no || 0),
            da_tra_tong: Number(r.da_tra_tong || 0)
        };
    });
    return map;
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
    var totalBuyRange = makeRangeFilter(filter.totalBuyFrom, filter.totalBuyTo);
    if (totalBuyRange) supplierQuery.tong_mua = totalBuyRange;
    var currentDebtRange = makeRangeFilter(filter.currentDebtFrom, filter.currentDebtTo);
    if (currentDebtRange) supplierQuery.tong_no = currentDebtRange;
    if (dateRange.start || dateRange.end) {
        supplierQuery.created_at = {};
        if (dateRange.start) supplierQuery.created_at.$gte = dateRange.start;
        if (dateRange.end) supplierQuery.created_at.$lte = dateRange.end;
    }

    return supplierQuery;
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
        dia_chi: address ? (address.dia_chi_day_du || address.so_nha || '') : '',
        tinh_tp: address ? (address.tinh_thanh || '') : '',
        quan_huyen: address ? (address.quan_huyen || '') : '',
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

function normalizeSupplierAddressPayload(body) {
    body = body || {};
    return {
        ma_dia_chi: String(body.ma_dia_chi || '').trim(),
        ten_nguoi_nhan: String(body.ten_nguoi_nhan || '').trim(),
        sdt_nguoi_nhan: String(body.sdt_nguoi_nhan || '').trim(),
        so_nha: String(body.so_nha || '').trim(),
        dia_chi_day_du: String(body.dia_chi_day_du || '').trim(),
        tinh_thanh: String(body.tinh_thanh || '').trim(),
        quan_huyen: String(body.quan_huyen || '').trim(),
        phuong_xa: String(body.phuong_xa || '').trim(),
        loai_dia_chi: String(body.loai_dia_chi || '').trim(),
        ghi_chu: String(body.ghi_chu || '').trim(),
        mac_dinh: body.mac_dinh === 'true' || body.mac_dinh === true || body.mac_dinh === 'on'
    };
}

function buildSupplierReturnUrl(supplierId, returnQueryRaw) {
    var supplier = normalizeIdParam(supplierId);
    var returnQuery = String(returnQueryRaw || '').trim().replace(/^\?/, '');
    var params = returnQuery ? returnQuery.split('&').filter(Boolean) : [];
    var paramsWithoutSupplier = params.filter(function(item) {
        return item.indexOf('supplier=') !== 0;
    });
    if (supplier) paramsWithoutSupplier.push('supplier=' + encodeURIComponent(supplier));
    return '/nha-cung-cap' + (paramsWithoutSupplier.length ? '?' + paramsWithoutSupplier.join('&') : '');
}

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
        var filter = normalizeFilterQuery(requestQuery);
        var supplierQuery = buildSupplierQueryFromFilter(filter);

        var supplierGroups = await loadSupplierGroups();
        var addressTypes = await loadAddressTypes();
        var suppliers = await NhaCungCap.find(supplierQuery).sort({ created_at: 1, ma_ncc: 1 }).lean();
        var totalsMap = await aggregateSupplierPurchaseTotals(storeId);
        suppliers.forEach(function(s) { applySupplierTotalsFromMap(s, totalsMap); });

        var selectedSupplierId = String(requestQuery.supplier || '').trim();
        var selectedSupplier = null;
        if (selectedSupplierId && mongoose.Types.ObjectId.isValid(selectedSupplierId)) {
            selectedSupplier = await NhaCungCap.findOne({ _id: selectedSupplierId }).lean();
            if (selectedSupplier) applySupplierTotalsFromMap(selectedSupplier, totalsMap);
        }
        var supplierPurchaseHistory = [];
        var supplierDebtHistory = [];
        var supplierAddresses = [];

        if (selectedSupplier) {
            supplierAddresses = await DiaChiNhaCungCap.find({ nha_cung_cap_id: selectedSupplier._id }).sort({ created_at: -1 }).lean();

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
            supplierPurchaseHistory = nhapRows.map(function(row) {
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
                .sort({ ngay: -1, created_at: -1 })
                .lean();
            var runningDebt = 0;
            var debtAsc = debtRows.slice().reverse();
            var mappedDebtAsc = debtAsc.map(function(row) {
                var soTien = Number(row.so_tien || 0);
                if (row.loai === 'tang_no') runningDebt += soTien;
                if (row.loai === 'giam_no' || row.loai === 'thanh_toan') runningDebt = Math.max(0, runningDebt - soTien);
                return {
                    phieu_nhap_id: row.phieu_nhap_id,
                    ma_phieu: row?.phieu_nhap_id?.ma_phieu_nhap || '--',
                    thoi_gian: row.ngay || row.created_at,
                    loai: row.loai || 'tang_no',
                    gia_tri: soTien,
                    no_con_lai: runningDebt
                };
            });
            supplierDebtHistory = mappedDebtAsc.reverse();
        }

        res.render('nha-cung-cap/index', {
            title: 'Nhà cung cấp',
            pageTitle: 'Nhà cung cấp',
            activeMenu: 'nha-cung-cap',
            user: req.user,
            flash: requestQuery,
            suppliers: suppliers,
            supplierGroups: supplierGroups,
            addressTypes: addressTypes,
            selectedSupplier: selectedSupplier,
            supplierAddresses: supplierAddresses,
            supplierPurchaseHistory: supplierPurchaseHistory,
            supplierDebtHistory: supplierDebtHistory,
            formMode: requestQuery.mode === 'create' ? 'create' : '',
            formatDate: formatDate,
            filter: filter,
            filterQueryString: buildFilterQueryString(filter),
            mapNhapHangStatus: mapNhapHangStatus,
            mapCongNoLoai: mapCongNoLoai
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
    return 'Đã trả';
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
            { header: 'Số nhà', key: 'so_nha', width: 12 },
            { header: 'Phường/Xã', key: 'phuong_xa', width: 16 },
            { header: 'Quận/Huyện', key: 'quan_huyen', width: 16 },
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
                so_nha: a.so_nha || '',
                phuong_xa: a.phuong_xa || '',
                quan_huyen: a.quan_huyen || '',
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
            { header: 'Mã phiếu nhập', key: 'ma_phieu', width: 18 },
            { header: 'Ngày nhập', key: 'ngay_nhap', width: 20 },
            { header: 'Cần trả NCC', key: 'can_tra', style: { numFmt: '#,##0' } },
            { header: 'Đã trả NCC', key: 'da_tra', style: { numFmt: '#,##0' } },
            { header: 'Còn nợ NCC', key: 'con_no', style: { numFmt: '#,##0' } },
            { header: 'Tuổi nợ (ngày)', key: 'tuoi_no', width: 16 },
            { header: 'Trạng thái', key: 'trang_thai', width: 16 }
        ];
        var debtMatch = { nha_cung_cap_id: supplier._id, trang_thai: { $ne: 'cancelled' } };
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) debtMatch.cua_hang_id = storeId;
        var slips = await PhieuNhap.find(debtMatch).sort({ ngay_nhap: -1, created_at: -1 }).lean();
        var today = Date.now();
        slips.forEach(function(row) {
            var conNo = Number(row.con_no_ncc || 0);
            var ngay = row.ngay_nhap || row.created_at;
            var tuoi = '';
            if (conNo > 0 && ngay) {
                var d = new Date(ngay).getTime();
                if (!isNaN(d)) tuoi = String(Math.max(0, Math.floor((today - d) / 86400000)));
            } else {
                tuoi = '0';
            }
            wsD.addRow({
                ma_phieu: row.ma_phieu_nhap || '',
                ngay_nhap: formatExportDate(ngay),
                can_tra: Number(row.can_tra_ncc || row.tong_tien || 0),
                da_tra: Number(row.da_tra_ncc || 0),
                con_no: conNo,
                tuoi_no: tuoi,
                trang_thai: mapNhapHangStatus(row.trang_thai)
            });
        });
        applySupplierWorksheetFormat(wsD);
        return { workbook: workbook, filename: 'ncc-' + safeMa + '-cong-no.xlsx' };
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
        if (['info', 'address', 'history', 'debt'].indexOf(section) < 0) {
            return res.redirect('/nha-cung-cap?supplier=' + supplierId + '&error=invalid_export');
        }
        var supplier = await NhaCungCap.findById(supplierId).lean();
        if (!supplier) return res.redirect('/nha-cung-cap?error=invalid_supplier');
        var storeId = await resolveStoreId(req);
        var pack = await exportSupplierDetailWorkbook(section, supplier, storeId);
        if (!pack) return res.redirect('/nha-cung-cap?supplier=' + supplierId + '&error=invalid_export');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="' + pack.filename + '"');
        await pack.workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};

exports.add = async function(req, res, next) {
    try {
        var payload = normalizeSupplierPayload(req?.body);
        if (!payload.ten_ncc) return res.redirect('/nha-cung-cap?mode=create&error=missing_name');
        if (!payload.ma_ncc) payload.ma_ncc = await makeSupplierCode();
        var supplier = await NhaCungCap.create(payload);
        res.redirect('/nha-cung-cap?supplier=' + supplier._id + '&success=created');
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
        if (!payload.ten_ncc) return res.redirect('/nha-cung-cap?supplier=' + supplierId + '&error=missing_name');
        if (!payload.ma_ncc) delete payload.ma_ncc;
        await NhaCungCap.findByIdAndUpdate(supplierId, payload, { runValidators: true });
        res.redirect('/nha-cung-cap?supplier=' + supplierId + '&success=updated');
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
            return res.redirect('/nha-cung-cap?supplier=' + normalizeIdParam(req?.params?.id) + '&error=duplicate_address_code');
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
