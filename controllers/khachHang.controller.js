var {
    KhachHang,
    NhomKhachHang,
    DiaChiKhachHang,
    LoaiDiaChiKhachHang,
    DonHang,
    HoaDonBanHang,
    PhieuTraHang,
    CongNoKhachHang,
    NguoiDung
} = require('../models/kiot.model');
var ExcelJS = require('exceljs');
var { buildFullAddress, normalizeAddress } = require('../utils/address');

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

function formatDateOnly(value) {
    if (!value) return '---';
    return new Date(value).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function formatGenderLabel(value) {
    var gender = String(value || '').trim().toLowerCase();
    if (gender === 'nam' || gender === 'male') return 'Nam';
    if (gender === 'nu' || gender === 'female') return 'Nữ';
    if (gender === 'khac' || gender === 'other') return 'Khác';
    return '---';
}

function formatCustomerStatusLabel(value) {
    return value === 'inactive' ? 'Ngừng hoạt động' : (value === 'active' ? 'Đang hoạt động' : '---');
}

function formatDetailText(value) {
    var text = value === null || value === undefined ? '' : String(value).trim();
    return text || '---';
}

function getCreatorName(customer) {
    if (!customer) return '---';
    var creator = customer.nguoi_tao_id;
    if (creator && typeof creator === 'object') {
        return creator.ho_ten || creator.email || creator.username || '---';
    }
    return '---';
}

async function applyCreatorFilter(customerQuery, creatorKeyword) {
    if (!creatorKeyword) return customerQuery;
    var users = await NguoiDung.find({
        $or: [
            { ho_ten: { $regex: creatorKeyword, $options: 'i' } },
            { email: { $regex: creatorKeyword, $options: 'i' } }
        ]
    }).select('_id').lean();
    var ids = users.map(function(user) { return user._id; });
    customerQuery.nguoi_tao_id = ids.length ? { $in: ids } : { $in: [] };
    return customerQuery;
}

function normalizeCustomerPayload(body) {
    body = body || {};
    var tongNoRaw = Number(body.tong_no || 0);
    var tongBanRaw = Number(body.tong_ban || 0);
    var tongNo = Number.isFinite(tongNoRaw) ? tongNoRaw : 0;
    var tongBan = Number.isFinite(tongBanRaw) ? tongBanRaw : 0;

    var loaiKhachHang = body.loai_khach_hang === 'cong_ty' ? 'cong_ty' : 'ca_nhan';
    var tenCaNhan = String(body.ten_ca_nhan || '').trim();
    var tenCongTy = String(body.ten_cong_ty || '').trim();
    var tenKhachHang = String(body.ten_khach_hang || '').trim();

    if (!tenKhachHang) {
        tenKhachHang = loaiKhachHang === 'cong_ty' ? tenCongTy : tenCaNhan;
    }
    if (loaiKhachHang === 'ca_nhan' && tenKhachHang && !tenCaNhan) {
        tenCaNhan = tenKhachHang;
    }
    if (loaiKhachHang === 'cong_ty' && tenCongTy && !tenKhachHang) {
        tenKhachHang = tenCongTy;
    }

    var parsedNgaySinh = body.ngay_sinh ? new Date(body.ngay_sinh) : null;
    var hasTongNo = body.tong_no !== undefined && String(body.tong_no).trim() !== '';
    var hasTongBan = body.tong_ban !== undefined && String(body.tong_ban).trim() !== '';

    return {
        ma_khach_hang: String(body.ma_khach_hang || '').trim(),
        ten_khach_hang: tenKhachHang,
        ten_ca_nhan: tenCaNhan,
        cccd: String(body.cccd || '').trim(),
        ngay_sinh: parsedNgaySinh && !isNaN(parsedNgaySinh.getTime()) ? parsedNgaySinh : null,
        ten_cong_ty: tenCongTy,
        ma_so_thue: String(body.ma_so_thue || '').trim(),
        nguoi_dai_dien: String(body.nguoi_dai_dien || '').trim(),
        chuc_vu_nguoi_dai_dien: String(body.chuc_vu_nguoi_dai_dien || '').trim(),
        sdt: String(body.sdt || '').trim(),
        sdt2: String(body.sdt2 || '').trim(),
        email: String(body.email || '').trim(),
        facebook: String(body.facebook || '').trim(),
        ngan_hang: String(body.ngan_hang || '').trim(),
        stk_ngan_hang: String(body.stk_ngan_hang || '').trim(),
        chu_tai_khoan: String(body.chu_tai_khoan || '').trim(),
        nhom_khach_hang_id: body.nhom_khach_hang_id ? String(body.nhom_khach_hang_id).trim() : null,
        gioi_tinh: String(body.gioi_tinh || '').trim(),
        loai_khach_hang: loaiKhachHang,
        tong_no: hasTongNo ? (tongNo < 0 ? 0 : tongNo) : undefined,
        tong_ban: hasTongBan ? (tongBan < 0 ? 0 : tongBan) : undefined,
        khu_vuc_giao_hang: String(body.khu_vuc_giao_hang || '').trim(),
        ghi_chu: String(body.ghi_chu || '').trim(),
        trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
    };
}

function finalizeCustomerPayload(payload, existing) {
    if (existing) {
        if (payload.tong_no === undefined) payload.tong_no = Number(existing.tong_no || 0);
        if (payload.tong_ban === undefined) payload.tong_ban = Number(existing.tong_ban || 0);
    } else {
        if (payload.tong_no === undefined) payload.tong_no = 0;
        if (payload.tong_ban === undefined) payload.tong_ban = 0;
    }
    return payload;
}

function validateCustomerPayload(payload) {
    if (!payload.ten_khach_hang) return 'missing_name';
    if (!payload.sdt) return 'missing_phone';
    if (!/^0\d{9}$/.test(payload.sdt)) return 'invalid_phone';
    if (payload.loai_khach_hang === 'ca_nhan') {
        if (!payload.cccd) return 'missing_cccd';
        if (!/^\d{12}$/.test(payload.cccd)) return 'invalid_cccd';
    }
    return '';
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

function normalizeFilterQuery(query) {
    query = query || {};
    var keyword = String(query.keyword || '').trim();
    var status = query.status === 'active' || query.status === 'inactive' ? query.status : 'all';
    var customerType = query.customerType === 'ca_nhan' || query.customerType === 'cong_ty' ? query.customerType : 'all';
    var groupId = String(query.groupId || 'all').trim() || 'all';
    var creatorKeyword = String(query.creatorKeyword || '').trim();
    var genderAliases = {
        male: 'nam',
        female: 'nu',
        other: 'khac',
        nam: 'nam',
        nu: 'nu',
        khac: 'khac'
    };
    var gender = genderAliases[query.gender] || 'all';
    var totalSalesFrom = String(query.totalSalesFrom || '').trim();
    var totalSalesTo = String(query.totalSalesTo || '').trim();
    var currentDebtFrom = String(query.currentDebtFrom || '').trim();
    var currentDebtTo = String(query.currentDebtTo || '').trim();
    var shippingArea = String(query.shippingArea || '').trim();
    var created = ['all', 'today', '7days', '30days', 'custom'].indexOf(query.created) >= 0 ? query.created : 'all';
    var createdFrom = String(query.createdFrom || '').trim();
    var createdTo = String(query.createdTo || '').trim();

    return {
        keyword: keyword,
        status: status,
        customerType: customerType,
        groupId: groupId,
        creatorKeyword: creatorKeyword,
        gender: gender,
        totalSalesFrom: totalSalesFrom,
        totalSalesTo: totalSalesTo,
        currentDebtFrom: currentDebtFrom,
        currentDebtTo: currentDebtTo,
        shippingArea: shippingArea,
        created: created,
        createdFrom: createdFrom,
        createdTo: createdTo
    };
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

    if (filter.keyword) params.push('keyword=' + encodeURIComponent(filter.keyword));
    if (filter.status !== 'all') params.push('status=' + encodeURIComponent(filter.status));
    if (filter.customerType !== 'all') params.push('customerType=' + encodeURIComponent(filter.customerType));
    if (filter.groupId !== 'all') params.push('groupId=' + encodeURIComponent(filter.groupId));
    if (filter.creatorKeyword) params.push('creatorKeyword=' + encodeURIComponent(filter.creatorKeyword));
    if (filter.gender !== 'all') params.push('gender=' + encodeURIComponent(filter.gender));
    if (filter.totalSalesFrom) params.push('totalSalesFrom=' + encodeURIComponent(filter.totalSalesFrom));
    if (filter.totalSalesTo) params.push('totalSalesTo=' + encodeURIComponent(filter.totalSalesTo));
    if (filter.currentDebtFrom) params.push('currentDebtFrom=' + encodeURIComponent(filter.currentDebtFrom));
    if (filter.currentDebtTo) params.push('currentDebtTo=' + encodeURIComponent(filter.currentDebtTo));
    if (filter.shippingArea) params.push('shippingArea=' + encodeURIComponent(filter.shippingArea));
    if (filter.created !== 'all') params.push('created=' + encodeURIComponent(filter.created));
    if (filter.created === 'custom' && filter.createdFrom) params.push('createdFrom=' + encodeURIComponent(filter.createdFrom));
    if (filter.created === 'custom' && filter.createdTo) params.push('createdTo=' + encodeURIComponent(filter.createdTo));

    return params.join('&');
}

async function makeCustomerCode() {
    var customers = await KhachHang.find({ ma_khach_hang: /^KH\d+$/ }).select('ma_khach_hang').lean();
    var maxNumber = 0;
    
    for (var c of customers) {
        if (c.ma_khach_hang) {
            var num = Number(c.ma_khach_hang.replace(/\D/g, ''));
            if (num > maxNumber) maxNumber = num;
        }
    }

    return 'KH' + String(maxNumber + 1).padStart(4, '0');
}

async function makeAddressCode() {
    var addresses = await DiaChiKhachHang.find({ ma_dia_chi: /^DCKH\d+$/ }).select('ma_dia_chi').lean();
    var maxNumber = 0;

    for (var a of addresses) {
        if (a.ma_dia_chi) {
            var num = Number(a.ma_dia_chi.replace(/\D/g, ''));
            if (num > maxNumber) maxNumber = num;
        }
    }

    return 'DCKH' + String(maxNumber + 1).padStart(4, '0');
}

function normalizeAddressPayload(body) {
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
        ghi_chu: String(body.ghi_chu || body.ghi_chu_dia_chi || '').trim(),
        mac_dinh: body.mac_dinh === 'true' || body.mac_dinh === true || body.mac_dinh === 'on'
    };
}

function buildCustomerReturnUrl(customerId, returnQueryRaw) {
    var customer = normalizeIdParam(customerId);
    var returnQuery = String(returnQueryRaw || '').trim().replace(/^\?/, '');
    var params = returnQuery ? returnQuery.split('&').filter(Boolean) : [];
    var paramsWithoutCustomer = params.filter(function(item) {
        return item.indexOf('customer=') !== 0;
    });
    if (customer) paramsWithoutCustomer.push('customer=' + encodeURIComponent(customer));
    return '/khach-hang' + (paramsWithoutCustomer.length ? '?' + paramsWithoutCustomer.join('&') : '');
}

async function seedCustomersIfEmpty() {
    var groupCount = await NhomKhachHang.countDocuments();
    if (groupCount === 0) {
        await NhomKhachHang.insertMany([
            { ten_nhom: 'Khách lẻ', mo_ta: 'Khách mua lẻ', trang_thai: 'active' },
            { ten_nhom: 'Khách sỉ', mo_ta: 'Khách mua sỉ', trang_thai: 'active' },
            { ten_nhom: 'VIP', mo_ta: 'Khách thân thiết', trang_thai: 'active' }
        ]);
    }

    var groups = await NhomKhachHang.find().sort({ created_at: 1 }).lean();
    var count = await KhachHang.countDocuments();
    if (count > 0) return;

    await KhachHang.insertMany([
        {
            ma_khach_hang: 'KH0001',
            ten_khach_hang: 'Nguyễn Văn An',
            sdt: '0902000001',
            email: 'an@example.com',
            loai_khach_hang: 'ca_nhan',
            nhom_khach_hang_id: groups[0] ? groups[0]._id : null,
            nguoi_tao_ten: 'Admin',
            gioi_tinh: 'male',
            tong_ban: 2500000,
            tong_no: 0,
            khu_vuc_giao_hang: 'Hà Nội - Thanh Xuân',
            trang_thai: 'active'
        },
        {
            ma_khach_hang: 'KH0002',
            ten_khach_hang: 'Công ty Minh Phát',
            sdt: '0902000002',
            email: 'minhphat@example.com',
            loai_khach_hang: 'cong_ty',
            ten_cong_ty: 'Công ty Minh Phát',
            ma_so_thue: '0312345678',
            nhom_khach_hang_id: groups[1] ? groups[1]._id : null,
            nguoi_tao_ten: 'Quản lý',
            gioi_tinh: 'other',
            tong_ban: 15000000,
            tong_no: 1200000,
            khu_vuc_giao_hang: 'TP.HCM',
            trang_thai: 'active'
        },
        {
            ma_khach_hang: 'KH0003',
            ten_khach_hang: 'Trần Thị Bình',
            sdt: '0902000003',
            email: 'binh@example.com',
            loai_khach_hang: 'ca_nhan',
            nhom_khach_hang_id: groups[2] ? groups[2]._id : null,
            nguoi_tao_ten: 'Nhân viên A',
            gioi_tinh: 'female',
            tong_ban: 5000000,
            tong_no: 300000,
            khu_vuc_giao_hang: 'Đà Nẵng - Hải Châu',
            trang_thai: 'inactive'
        }
    ]);
}

async function seedAddressTypesIfEmpty() {
    var count = await LoaiDiaChiKhachHang.countDocuments();
    if (count > 0) return;

    await LoaiDiaChiKhachHang.insertMany([
        { ma_loai: 'nha_rieng', ten_loai: 'Nhà riêng', trang_thai: 'active' },
        { ma_loai: 'cong_ty', ten_loai: 'Công ty', trang_thai: 'active' },
        { ma_loai: 'noi_nhan_hang', ten_loai: 'Nơi nhận hàng', trang_thai: 'active' },
        { ma_loai: 'noi_ban_hang', ten_loai: 'Nơi bán hàng', trang_thai: 'active' },
        { ma_loai: 'xuat_hoa_don', ten_loai: 'Xuất hóa đơn', trang_thai: 'active' },
        { ma_loai: 'khac', ten_loai: 'Khác', trang_thai: 'active' }
    ]);
}

function shouldRespondJson(req) {
    var accept = String(req?.headers?.accept || '').toLowerCase();
    var requestedWith = String(req?.headers?.['x-requested-with'] || '').toLowerCase();
    return requestedWith === 'xmlhttprequest' || accept.indexOf('application/json') >= 0;
}

async function loadAddressTypes() {
    return await LoaiDiaChiKhachHang.find({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
}

async function loadCustomerGroups() {
    return await NhomKhachHang.find().sort({ ten_nhom: 1 }).lean();
}

async function loadCustomerHistory(customerId) {
    if (!customerId) {
        return { orders: [], invoices: [], returns: [], debts: [] };
    }

    var query = { khach_hang_id: customerId };
    var orders = await DonHang.find(query)
        .sort({ ngay_dat: -1, created_at: -1 })
        .limit(50)
        .lean();
    var invoices = await HoaDonBanHang.find(query)
        .populate('don_hang_id')
        .sort({ ngay_ban: -1, created_at: -1 })
        .limit(50)
        .lean();
    var returns = await PhieuTraHang.find(query)
        .populate('hoa_don_id')
        .sort({ ngay_tra: -1, created_at: -1 })
        .limit(50)
        .lean();
    var debts = await CongNoKhachHang.find(query)
        .populate('hoa_don_id')
        .populate('don_hang_id')
        .populate('phieu_thu_chi_id')
        .sort({ ngay: -1, created_at: -1 })
        .limit(80)
        .lean();

    return {
        orders: orders,
        invoices: invoices,
        returns: returns,
        debts: debts
    };
}

async function loadFullCustomerHistory(customerId) {
    if (!customerId) {
        return { orders: [], invoices: [], returns: [], debts: [] };
    }

    var query = { khach_hang_id: customerId };
    var orders = await DonHang.find(query)
        .sort({ ngay_dat: -1, created_at: -1 })
        .lean();
    var invoices = await HoaDonBanHang.find(query)
        .populate('don_hang_id')
        .sort({ ngay_ban: -1, created_at: -1 })
        .lean();
    var returns = await PhieuTraHang.find(query)
        .populate('hoa_don_id')
        .sort({ ngay_tra: -1, created_at: -1 })
        .lean();
    var debts = await CongNoKhachHang.find(query)
        .populate('hoa_don_id')
        .populate('don_hang_id')
        .populate('phieu_thu_chi_id')
        .sort({ ngay: -1, created_at: -1 })
        .lean();

    return {
        orders: orders,
        invoices: invoices,
        returns: returns,
        debts: debts
    };
}

function exportText(value) {
    if (value === null || typeof value === 'undefined' || value === '') return '---';
    return value;
}

function exportMoney(value) {
    return Number(value || 0);
}

function exportDate(value) {
    return value ? formatDate(value) : '---';
}

function exportCustomerType(value) {
    return value === 'cong_ty' ? 'Công ty' : 'Cá nhân';
}

function exportGender(value) {
    if (value === 'nam') return 'Nam';
    if (value === 'nu') return 'Nữ';
    if (value === 'khac') return 'Khác';
    return '---';
}

function exportStatus(value) {
    return value === 'inactive' ? 'Ngừng hoạt động' : 'Hoạt động';
}

function exportAddress(address) {
    return address.dia_chi_day_du || buildFullAddress(address) || '---';
}

function exportRelatedCode(item, fields) {
    if (!item) return '---';
    for (var i = 0; i < fields.length; i += 1) {
        if (item[fields[i]]) return item[fields[i]];
    }
    return '---';
}

function safeExportFilenamePart(value) {
    return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function applyExportWorksheetFormat(worksheet) {
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    worksheet.getRow(1).alignment = { vertical: 'middle' };
    worksheet.eachRow(function(row) {
        row.eachCell(function(cell) {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
            };
            cell.alignment = { vertical: 'top', wrapText: true };
        });
    });
}

function addExportSheet(workbook, name, columns, rows) {
    var worksheet = workbook.addWorksheet(name);
    worksheet.columns = columns;
    rows.forEach(function(row) {
        worksheet.addRow(row);
    });
    applyExportWorksheetFormat(worksheet);
    return worksheet;
}

function addInfoSheet(workbook, customer) {
    var worksheet = workbook.addWorksheet('Thông tin');
    worksheet.columns = [
        { header: 'Trường thông tin', key: 'label', width: 28 },
        { header: 'Giá trị', key: 'value', width: 42 }
    ];
    [
        ['Mã khách hàng', customer.ma_khach_hang],
        ['Tên khách hàng', customer.ten_khach_hang],
        ['Nhóm khách hàng', customer.nhom_khach_hang_ten],
        ['Loại khách hàng', exportCustomerType(customer.loai_khach_hang)],
        ['Số điện thoại', customer.sdt],
        ['Email', customer.email],
        ['Facebook', customer.facebook],
        ['Giới tính', exportGender(customer.gioi_tinh)],
        ['CCCD', customer.cccd],
        ['Ngày sinh', exportDate(customer.ngay_sinh)],
        ['Tên công ty', customer.ten_cong_ty],
        ['Mã số thuế', customer.ma_so_thue],
        ['Người đại diện', customer.nguoi_dai_dien],
        ['Chức vụ người đại diện', customer.chuc_vu_nguoi_dai_dien],
        ['Tổng bán', exportMoney(customer.tong_ban)],
        ['Nợ hiện tại', exportMoney(customer.tong_no)],
        ['Khu vực giao hàng', customer.khu_vuc_giao_hang],
        ['Trạng thái', exportStatus(customer.trang_thai)],
        ['Ghi chú', customer.ghi_chu],
        ['Ngày tạo', exportDate(customer.created_at)],
        ['Cập nhật lúc', exportDate(customer.updated_at)]
    ].forEach(function(item) {
        worksheet.addRow({ label: item[0], value: exportText(item[1]) });
    });
    applyExportWorksheetFormat(worksheet);
    worksheet.getColumn('value').numFmt = '#,##0';
    return worksheet;
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

function buildCustomerQueryFromFilter(filter) {
    var dateRange = getDateRange(filter);
    var customerQuery = {};

    if (filter.keyword) {
        customerQuery.$or = [
            { ma_khach_hang: { $regex: filter.keyword, $options: 'i' } },
            { ten_khach_hang: { $regex: filter.keyword, $options: 'i' } },
            { ten_ca_nhan: { $regex: filter.keyword, $options: 'i' } },
            { ten_cong_ty: { $regex: filter.keyword, $options: 'i' } },
            { sdt: { $regex: filter.keyword, $options: 'i' } },
            { email: { $regex: filter.keyword, $options: 'i' } }
        ];
    }
    if (filter.status !== 'all') customerQuery.trang_thai = filter.status;
    if (filter.customerType !== 'all') customerQuery.loai_khach_hang = filter.customerType;
    if (filter.groupId !== 'all') customerQuery.nhom_khach_hang_id = filter.groupId;
    if (filter.gender !== 'all') customerQuery.gioi_tinh = filter.gender;
    if (filter.shippingArea) {
        customerQuery.khu_vuc_giao_hang = { $regex: filter.shippingArea, $options: 'i' };
    }

    var totalSalesRange = makeRangeFilter(filter.totalSalesFrom, filter.totalSalesTo);
    if (totalSalesRange) customerQuery.tong_ban = totalSalesRange;

    var currentDebtRange = makeRangeFilter(filter.currentDebtFrom, filter.currentDebtTo);
    if (currentDebtRange) customerQuery.tong_no = currentDebtRange;

    if (dateRange.start || dateRange.end) {
        customerQuery.created_at = {};
        if (dateRange.start) customerQuery.created_at.$gte = dateRange.start;
        if (dateRange.end) customerQuery.created_at.$lte = dateRange.end;
    }

    return customerQuery;
}

exports.index = async function(req, res, next) {
    try {
        var requestQuery = req?.query || {};
        var filter = normalizeFilterQuery(requestQuery);
        var customerQuery = buildCustomerQueryFromFilter(filter);
        await applyCreatorFilter(customerQuery, filter.creatorKeyword);

        var customerGroups = await loadCustomerGroups();
        var addressTypes = await loadAddressTypes();
        var groupMap = customerGroups.reduce(function(map, group) {
            map[String(group._id)] = group.ten_nhom || '---';
            return map;
        }, {});

        var overallTotals = await KhachHang.aggregate([
            { $match: customerQuery },
            {
                $group: {
                    _id: null,
                    totalDebt: { $sum: { $ifNull: ['$tong_no', 0] } },
                    totalSales: { $sum: { $ifNull: ['$tong_ban', 0] } }
                }
            }
        ]);
        var summaryTotals = overallTotals[0] || { totalDebt: 0, totalSales: 0 };

        var customers = await KhachHang.find(customerQuery)
            .populate({ path: 'nguoi_tao_id', select: 'ho_ten email username' })
            .sort({ created_at: -1, ma_khach_hang: 1 })
            .lean();
        customers = customers.map(function(customer) {
            customer.nhom_khach_hang_ten = groupMap[String(customer.nhom_khach_hang_id || '')] || '---';
            customer.nguoi_tao_ten = getCreatorName(customer);
            return customer;
        });
        var hasCustomerQuery = Object.prototype.hasOwnProperty.call(requestQuery, 'customer');
        var selectedCustomerId = hasCustomerQuery ? String(requestQuery.customer || '') : '';
        var selectedCustomer = selectedCustomerId
            ? customers.find(function(customer) {
                return String(customer._id) === selectedCustomerId;
            }) || null
            : null;
        var customerAddresses = selectedCustomer
            ? await DiaChiKhachHang.find({ khach_hang_id: selectedCustomer._id }).sort({ created_at: -1 }).lean()
            : [];
        var customerHistory = selectedCustomer
            ? await loadCustomerHistory(selectedCustomer._id)
            : { orders: [], invoices: [], returns: [], debts: [] };

        res.render('khach-hang/index', {
            title: 'Khách hàng',
            pageTitle: 'Khách hàng',
            activeMenu: 'khach-hang',
            user: req.user,
            flash: requestQuery,
            customers: customers,
            selectedCustomer: selectedCustomer,
            customerAddresses: customerAddresses,
            customerHistory: customerHistory,
            customerGroups: customerGroups,
            addressTypes: addressTypes,
            summaryTotals: summaryTotals,
            formMode: requestQuery.mode === 'create' ? 'create' : '',
            formatDate: formatDate,
            formatDateOnly: formatDateOnly,
            formatGenderLabel: formatGenderLabel,
            formatCustomerStatusLabel: formatCustomerStatusLabel,
            formatDetailText: formatDetailText,
            formatCreatorName: getCreatorName,
            filter: filter,
            filterQueryString: buildFilterQueryString(filter)
        });
    } catch (error) {
        next(error);
    }
};

exports.exportExcel = async function(req, res, next) {
    try {
        var filter = normalizeFilterQuery(req?.query || {});
        var customerQuery = buildCustomerQueryFromFilter(filter);
        await applyCreatorFilter(customerQuery, filter.creatorKeyword);
        var customerGroups = await loadCustomerGroups();
        var groupMap = customerGroups.reduce(function(map, group) {
            map[String(group._id)] = group.ten_nhom || '---';
            return map;
        }, {});

        var customers = await KhachHang.find(customerQuery)
            .populate({ path: 'nguoi_tao_id', select: 'ho_ten email username' })
            .sort({ created_at: -1, ma_khach_hang: 1 })
            .lean();
        customers = customers.map(function(customer) {
            customer.nguoi_tao_ten = getCreatorName(customer);
            return customer;
        });
        var customerIds = customers.map(function(customer) { return customer._id; });
        var addresses = customerIds.length
            ? await DiaChiKhachHang.find({ khach_hang_id: { $in: customerIds } }).sort({ mac_dinh: -1, created_at: -1 }).lean()
            : [];
        var addressMap = addresses.reduce(function(map, address) {
            var key = String(address.khach_hang_id);
            if (!map[key]) map[key] = address;
            return map;
        }, {});

        var workbook = new ExcelJS.Workbook();
        workbook.creator = 'Quan ly cua hang';
        workbook.created = new Date();
        var worksheet = workbook.addWorksheet('Khách hàng');
        worksheet.columns = [
            { header: 'Mã khách hàng', key: 'ma_khach_hang', width: 16 },
            { header: 'Tên khách hàng', key: 'ten_khach_hang', width: 28 },
            { header: 'Loại khách hàng', key: 'loai_khach_hang', width: 16 },
            { header: 'Nhóm khách hàng', key: 'nhom_khach_hang', width: 22 },
            { header: 'Điện thoại', key: 'sdt', width: 16 },
            { header: 'Email', key: 'email', width: 28 },
            { header: 'Giới tính', key: 'gioi_tinh', width: 12 },
            { header: 'CCCD', key: 'cccd', width: 16 },
            { header: 'Nợ hiện tại', key: 'tong_no', width: 16 },
            { header: 'Tổng bán', key: 'tong_ban', width: 16 },
            { header: 'Tổng bán trừ trả hàng', key: 'tong_ban_tru_tra_hang', width: 22 },
            { header: 'Khu vực giao hàng', key: 'khu_vuc_giao_hang', width: 24 },
            { header: 'Địa chỉ mặc định', key: 'dia_chi_mac_dinh', width: 42 },
            { header: 'Người tạo', key: 'nguoi_tao_ten', width: 20 },
            { header: 'Trạng thái', key: 'trang_thai', width: 16 },
            { header: 'Ngày tạo', key: 'created_at', width: 20 },
            { header: 'Ghi chú', key: 'ghi_chu', width: 32 }
        ];

        customers.forEach(function(customer) {
            var address = addressMap[String(customer._id)];
            worksheet.addRow({
                ma_khach_hang: exportText(customer.ma_khach_hang),
                ten_khach_hang: exportText(customer.ten_khach_hang),
                loai_khach_hang: exportCustomerType(customer.loai_khach_hang),
                nhom_khach_hang: groupMap[String(customer.nhom_khach_hang_id || '')] || '---',
                sdt: exportText(customer.sdt),
                email: exportText(customer.email),
                gioi_tinh: exportGender(customer.gioi_tinh),
                cccd: exportText(customer.cccd),
                tong_no: exportMoney(customer.tong_no),
                tong_ban: exportMoney(customer.tong_ban),
                tong_ban_tru_tra_hang: exportMoney(customer.tong_ban),
                khu_vuc_giao_hang: exportText(customer.khu_vuc_giao_hang),
                dia_chi_mac_dinh: address ? exportAddress(address) : '---',
                nguoi_tao_ten: exportText(customer.nguoi_tao_ten),
                trang_thai: exportStatus(customer.trang_thai),
                created_at: exportDate(customer.created_at),
                ghi_chu: exportText(customer.ghi_chu)
            });
        });

        applyExportWorksheetFormat(worksheet);
        ['tong_no', 'tong_ban', 'tong_ban_tru_tra_hang'].forEach(function(key) {
            worksheet.getColumn(key).numFmt = '#,##0';
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="khach-hang.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};

exports.exportOneExcel = async function(req, res, next) {
    try {
        var customerId = normalizeIdParam(req?.params?.id);
        if (!customerId) return res.redirect('/khach-hang?error=invalid_customer');

        var customerGroups = await loadCustomerGroups();
        var addressTypes = await loadAddressTypes();
        var groupMap = customerGroups.reduce(function(map, group) {
            map[String(group._id)] = group.ten_nhom || '---';
            return map;
        }, {});
        var addressTypeMap = addressTypes.reduce(function(map, type) {
            map[type.ma_loai] = type.ten_loai || type.ma_loai;
            return map;
        }, {});

        var customer = await KhachHang.findById(customerId).lean();
        if (!customer) return res.redirect('/khach-hang?error=invalid_customer');
        customer.nhom_khach_hang_ten = groupMap[String(customer.nhom_khach_hang_id || '')] || '---';

        var addresses = await DiaChiKhachHang.find({ khach_hang_id: customer._id }).sort({ mac_dinh: -1, created_at: -1 }).lean();
        var history = await loadFullCustomerHistory(customer._id);

        var workbook = new ExcelJS.Workbook();
        workbook.creator = 'Quan ly cua hang';
        workbook.created = new Date();

        addInfoSheet(workbook, customer);

        addExportSheet(workbook, 'Danh sách địa chỉ', [
            { header: 'Mã địa chỉ', key: 'ma_dia_chi', width: 16 },
            { header: 'Tên người nhận', key: 'ten_nguoi_nhan', width: 24 },
            { header: 'SĐT', key: 'sdt_nguoi_nhan', width: 16 },
            { header: 'Địa chỉ', key: 'dia_chi', width: 45 },
            { header: 'Loại địa chỉ', key: 'loai_dia_chi', width: 18 },
            { header: 'Mặc định', key: 'mac_dinh', width: 12 },
            { header: 'Ghi chú', key: 'ghi_chu', width: 28 },
            { header: 'Tạo lúc', key: 'created_at', width: 20 }
        ], addresses.map(function(address) {
            return {
                ma_dia_chi: exportText(address.ma_dia_chi),
                ten_nguoi_nhan: exportText(address.ten_nguoi_nhan),
                sdt_nguoi_nhan: exportText(address.sdt_nguoi_nhan),
                dia_chi: exportAddress(address),
                loai_dia_chi: exportText(addressTypeMap[address.loai_dia_chi] || address.loai_dia_chi),
                mac_dinh: address.mac_dinh ? 'Có' : 'Không',
                ghi_chu: exportText(address.ghi_chu),
                created_at: exportDate(address.created_at)
            };
        }));

        addExportSheet(workbook, 'Đơn hàng', [
            { header: 'Mã đơn hàng', key: 'ma_don_hang', width: 18 },
            { header: 'Ngày đặt', key: 'ngay_dat', width: 20 },
            { header: 'Tổng tiền hàng', key: 'tong_tien_hang', width: 16 },
            { header: 'Khách cần trả', key: 'tong_thanh_toan', width: 16 },
            { header: 'Khách đã trả', key: 'khach_thanh_toan', width: 16 },
            { header: 'Trạng thái đơn', key: 'trang_thai', width: 18 },
            { header: 'Giao hàng', key: 'trang_thai_giao_hang', width: 18 },
            { header: 'Ghi chú', key: 'ghi_chu', width: 28 }
        ], history.orders.map(function(order) {
            return {
                ma_don_hang: exportText(order.ma_don_hang),
                ngay_dat: exportDate(order.ngay_dat || order.created_at),
                tong_tien_hang: exportMoney(order.tong_tien_hang || order.tong_tien),
                tong_thanh_toan: exportMoney(order.tong_thanh_toan || order.tong_tien),
                khach_thanh_toan: exportMoney(order.khach_thanh_toan || order.khach_da_tra),
                trang_thai: exportText(order.trang_thai),
                trang_thai_giao_hang: exportText(order.trang_thai_giao_hang),
                ghi_chu: exportText(order.ghi_chu)
            };
        }));

        addExportSheet(workbook, 'Hóa đơn', [
            { header: 'Mã hóa đơn', key: 'ma_hoa_don', width: 18 },
            { header: 'Ngày bán', key: 'ngay_ban', width: 20 },
            { header: 'Tổng tiền', key: 'tong_tien', width: 16 },
            { header: 'Thanh toán', key: 'thanh_toan', width: 16 },
            { header: 'Trạng thái', key: 'trang_thai', width: 18 },
            { header: 'Đơn hàng', key: 'don_hang', width: 18 },
            { header: 'Ghi chú', key: 'ghi_chu', width: 28 }
        ], history.invoices.map(function(invoice) {
            return {
                ma_hoa_don: exportText(invoice.ma_hoa_don),
                ngay_ban: exportDate(invoice.ngay_ban || invoice.created_at),
                tong_tien: exportMoney(invoice.tong_tien),
                thanh_toan: exportMoney(invoice.thanh_toan || invoice.khach_da_tra),
                trang_thai: exportText(invoice.trang_thai),
                don_hang: exportRelatedCode(invoice.don_hang_id, ['ma_don_hang']),
                ghi_chu: exportText(invoice.ghi_chu)
            };
        }));

        addExportSheet(workbook, 'Trả hàng', [
            { header: 'Mã phiếu trả', key: 'ma_phieu_tra', width: 18 },
            { header: 'Ngày trả', key: 'ngay_tra', width: 20 },
            { header: 'Hóa đơn gốc', key: 'hoa_don', width: 18 },
            { header: 'Tổng tiền trả', key: 'tong_tien_tra', width: 16 },
            { header: 'Trạng thái', key: 'trang_thai', width: 18 },
            { header: 'Ghi chú', key: 'ghi_chu', width: 30 }
        ], history.returns.map(function(item) {
            return {
                ma_phieu_tra: exportText(item.ma_phieu_tra),
                ngay_tra: exportDate(item.ngay_tra || item.created_at),
                hoa_don: exportRelatedCode(item.hoa_don_id, ['ma_hoa_don']),
                tong_tien_tra: exportMoney(item.can_tra_khach || item.tong_tien_tra),
                trang_thai: exportText(item.trang_thai),
                ghi_chu: exportText(item.ghi_chu)
            };
        }));

        addExportSheet(workbook, 'Công nợ', [
            { header: 'Ngày', key: 'ngay', width: 20 },
            { header: 'Loại', key: 'loai', width: 16 },
            { header: 'Số tiền', key: 'so_tien', width: 16 },
            { header: 'Hóa đơn', key: 'hoa_don', width: 18 },
            { header: 'Đơn hàng', key: 'don_hang', width: 18 },
            { header: 'Phiếu thu chi', key: 'phieu_thu_chi', width: 18 },
            { header: 'Ghi chú', key: 'ghi_chu', width: 30 }
        ], history.debts.map(function(debt) {
            return {
                ngay: exportDate(debt.ngay || debt.created_at),
                loai: exportText(debt.loai),
                so_tien: exportMoney(debt.so_tien),
                hoa_don: exportRelatedCode(debt.hoa_don_id, ['ma_hoa_don']),
                don_hang: exportRelatedCode(debt.don_hang_id, ['ma_don_hang']),
                phieu_thu_chi: exportRelatedCode(debt.phieu_thu_chi_id, ['ma_phieu', 'ma_phieu_thu_chi']),
                ghi_chu: exportText(debt.ghi_chu)
            };
        }));

        workbook.worksheets.forEach(function(worksheet) {
            worksheet.eachRow(function(row, rowNumber) {
                if (rowNumber === 1) return;
                row.eachCell(function(cell) {
                    if (typeof cell.value === 'number') {
                        cell.numFmt = '#,##0';
                    }
                });
            });
        });

        var filename = 'khach-hang-' + safeExportFilenamePart(customer.ma_khach_hang || customer._id) + '.xlsx';
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};

exports.exportSectionExcel = async function(req, res, next) {
    try {
        var customerId = normalizeIdParam(req?.params?.id);
        var section = normalizeIdParam(req?.params?.section);
        var sectionMap = {
            info: { label: 'thong-tin', sheet: 'Thông tin' },
            address: { label: 'dia-chi', sheet: 'Danh sách địa chỉ' },
            orders: { label: 'don-hang', sheet: 'Đơn hàng' },
            invoices: { label: 'hoa-don', sheet: 'Hóa đơn' },
            returns: { label: 'tra-hang', sheet: 'Trả hàng' },
            debts: { label: 'cong-no', sheet: 'Công nợ' }
        };
        if (!customerId || !sectionMap[section]) return res.redirect('/khach-hang?error=invalid_customer');

        var customerGroups = await loadCustomerGroups();
        var groupMap = customerGroups.reduce(function(map, group) {
            map[String(group._id)] = group.ten_nhom || '---';
            return map;
        }, {});
        var customer = await KhachHang.findById(customerId).lean();
        if (!customer) return res.redirect('/khach-hang?error=invalid_customer');
        customer.nhom_khach_hang_ten = groupMap[String(customer.nhom_khach_hang_id || '')] || '---';

        var workbook = new ExcelJS.Workbook();
        workbook.creator = 'Quan ly cua hang';
        workbook.created = new Date();

        if (section === 'info') {
            addInfoSheet(workbook, customer);
        }

        if (section === 'address') {
            var addressTypes = await loadAddressTypes();
            var addressTypeMap = addressTypes.reduce(function(map, type) {
                map[type.ma_loai] = type.ten_loai || type.ma_loai;
                return map;
            }, {});
            var addresses = await DiaChiKhachHang.find({ khach_hang_id: customer._id }).sort({ mac_dinh: -1, created_at: -1 }).lean();
            addExportSheet(workbook, 'Danh sách địa chỉ', [
                { header: 'Mã địa chỉ', key: 'ma_dia_chi', width: 16 },
                { header: 'Tên người nhận', key: 'ten_nguoi_nhan', width: 24 },
                { header: 'SĐT', key: 'sdt_nguoi_nhan', width: 16 },
                { header: 'Địa chỉ', key: 'dia_chi', width: 45 },
                { header: 'Loại địa chỉ', key: 'loai_dia_chi', width: 18 },
                { header: 'Mặc định', key: 'mac_dinh', width: 12 },
                { header: 'Ghi chú', key: 'ghi_chu', width: 28 },
                { header: 'Tạo lúc', key: 'created_at', width: 20 }
            ], addresses.map(function(address) {
                return {
                    ma_dia_chi: exportText(address.ma_dia_chi),
                    ten_nguoi_nhan: exportText(address.ten_nguoi_nhan),
                    sdt_nguoi_nhan: exportText(address.sdt_nguoi_nhan),
                    dia_chi: exportAddress(address),
                    loai_dia_chi: exportText(addressTypeMap[address.loai_dia_chi] || address.loai_dia_chi),
                    mac_dinh: address.mac_dinh ? 'Có' : 'Không',
                    ghi_chu: exportText(address.ghi_chu),
                    created_at: exportDate(address.created_at)
                };
            }));
        }

        if (section === 'orders') {
            var orders = await DonHang.find({ khach_hang_id: customer._id }).sort({ ngay_dat: -1, created_at: -1 }).lean();
            addExportSheet(workbook, 'Đơn hàng', [
                { header: 'Mã đơn hàng', key: 'ma_don_hang', width: 18 },
                { header: 'Ngày đặt', key: 'ngay_dat', width: 20 },
                { header: 'Tổng tiền hàng', key: 'tong_tien_hang', width: 16 },
                { header: 'Khách cần trả', key: 'tong_thanh_toan', width: 16 },
                { header: 'Khách đã trả', key: 'khach_thanh_toan', width: 16 },
                { header: 'Trạng thái đơn', key: 'trang_thai', width: 18 },
                { header: 'Giao hàng', key: 'trang_thai_giao_hang', width: 18 },
                { header: 'Ghi chú', key: 'ghi_chu', width: 28 }
            ], orders.map(function(order) {
                return {
                    ma_don_hang: exportText(order.ma_don_hang),
                    ngay_dat: exportDate(order.ngay_dat || order.created_at),
                    tong_tien_hang: exportMoney(order.tong_tien_hang || order.tong_tien),
                    tong_thanh_toan: exportMoney(order.tong_thanh_toan || order.tong_tien),
                    khach_thanh_toan: exportMoney(order.khach_thanh_toan || order.khach_da_tra),
                    trang_thai: exportText(order.trang_thai),
                    trang_thai_giao_hang: exportText(order.trang_thai_giao_hang),
                    ghi_chu: exportText(order.ghi_chu)
                };
            }));
        }

        if (section === 'invoices') {
            var invoices = await HoaDonBanHang.find({ khach_hang_id: customer._id })
                .populate('don_hang_id')
                .sort({ ngay_ban: -1, created_at: -1 })
                .lean();
            addExportSheet(workbook, 'Hóa đơn', [
                { header: 'Mã hóa đơn', key: 'ma_hoa_don', width: 18 },
                { header: 'Ngày bán', key: 'ngay_ban', width: 20 },
                { header: 'Tổng tiền', key: 'tong_tien', width: 16 },
                { header: 'Thanh toán', key: 'thanh_toan', width: 16 },
                { header: 'Trạng thái', key: 'trang_thai', width: 18 },
                { header: 'Đơn hàng', key: 'don_hang', width: 18 },
                { header: 'Ghi chú', key: 'ghi_chu', width: 28 }
            ], invoices.map(function(invoice) {
                return {
                    ma_hoa_don: exportText(invoice.ma_hoa_don),
                    ngay_ban: exportDate(invoice.ngay_ban || invoice.created_at),
                    tong_tien: exportMoney(invoice.tong_tien),
                    thanh_toan: exportMoney(invoice.thanh_toan || invoice.khach_da_tra),
                    trang_thai: exportText(invoice.trang_thai),
                    don_hang: exportRelatedCode(invoice.don_hang_id, ['ma_don_hang']),
                    ghi_chu: exportText(invoice.ghi_chu)
                };
            }));
        }

        if (section === 'returns') {
            var returns = await PhieuTraHang.find({ khach_hang_id: customer._id })
                .populate('hoa_don_id')
                .sort({ ngay_tra: -1, created_at: -1 })
                .lean();
            addExportSheet(workbook, 'Trả hàng', [
                { header: 'Mã phiếu trả', key: 'ma_phieu_tra', width: 18 },
                { header: 'Ngày trả', key: 'ngay_tra', width: 20 },
                { header: 'Hóa đơn gốc', key: 'hoa_don', width: 18 },
                { header: 'Tổng tiền trả', key: 'tong_tien_tra', width: 16 },
                { header: 'Trạng thái', key: 'trang_thai', width: 18 },
                { header: 'Ghi chú', key: 'ghi_chu', width: 30 }
            ], returns.map(function(item) {
                return {
                    ma_phieu_tra: exportText(item.ma_phieu_tra),
                    ngay_tra: exportDate(item.ngay_tra || item.created_at),
                    hoa_don: exportRelatedCode(item.hoa_don_id, ['ma_hoa_don']),
                    tong_tien_tra: exportMoney(item.can_tra_khach || item.tong_tien_tra),
                    trang_thai: exportText(item.trang_thai),
                    ghi_chu: exportText(item.ghi_chu)
                };
            }));
        }

        if (section === 'debts') {
            var debts = await CongNoKhachHang.find({ khach_hang_id: customer._id })
                .populate('hoa_don_id')
                .populate('don_hang_id')
                .populate('phieu_thu_chi_id')
                .sort({ ngay: -1, created_at: -1 })
                .lean();
            addExportSheet(workbook, 'Công nợ', [
                { header: 'Ngày', key: 'ngay', width: 20 },
                { header: 'Loại', key: 'loai', width: 16 },
                { header: 'Số tiền', key: 'so_tien', width: 16 },
                { header: 'Hóa đơn', key: 'hoa_don', width: 18 },
                { header: 'Đơn hàng', key: 'don_hang', width: 18 },
                { header: 'Phiếu thu chi', key: 'phieu_thu_chi', width: 18 },
                { header: 'Ghi chú', key: 'ghi_chu', width: 30 }
            ], debts.map(function(debt) {
                return {
                    ngay: exportDate(debt.ngay || debt.created_at),
                    loai: exportText(debt.loai),
                    so_tien: exportMoney(debt.so_tien),
                    hoa_don: exportRelatedCode(debt.hoa_don_id, ['ma_hoa_don']),
                    don_hang: exportRelatedCode(debt.don_hang_id, ['ma_don_hang']),
                    phieu_thu_chi: exportRelatedCode(debt.phieu_thu_chi_id, ['ma_phieu', 'ma_phieu_thu_chi']),
                    ghi_chu: exportText(debt.ghi_chu)
                };
            }));
        }

        workbook.worksheets.forEach(function(worksheet) {
            worksheet.eachRow(function(row, rowNumber) {
                if (rowNumber === 1) return;
                row.eachCell(function(cell) {
                    if (typeof cell.value === 'number') {
                        cell.numFmt = '#,##0';
                    }
                });
            });
        });

        var filename = 'khach-hang-' + safeExportFilenamePart(customer.ma_khach_hang || customer._id) + '-' + sectionMap[section].label + '.xlsx';
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};

exports.add = async function(req, res, next) {
    try {
        var payload = normalizeCustomerPayload(req?.body);
        var validationError = validateCustomerPayload(payload);

        if (validationError) {
            return res.redirect('/khach-hang?mode=create&error=' + validationError);
        }

        if (payload.loai_khach_hang === 'ca_nhan') {
            payload.ten_cong_ty = '';
            payload.ma_so_thue = '';
            payload.nguoi_dai_dien = '';
            payload.chuc_vu_nguoi_dai_dien = '';
        } else {
            payload.ten_ca_nhan = '';
            payload.cccd = '';
            payload.ngay_sinh = null;
        }

        if (!payload.ma_khach_hang) {
            payload.ma_khach_hang = await makeCustomerCode();
        }

        if (!payload.nhom_khach_hang_id) delete payload.nhom_khach_hang_id;
        if (req.user && req.user._id) {
            payload.nguoi_tao_id = req.user._id;
        }
        finalizeCustomerPayload(payload);

        var customer = await KhachHang.create(payload);

        // Save address if provided
        var addressPayload = normalizeAddressPayload(req?.body);
        var hasAddressData = addressPayload.ten_nguoi_nhan || addressPayload.sdt_nguoi_nhan || addressPayload.dia_chi_day_du || addressPayload.dia_chi_chi_tiet || addressPayload.tinh_thanh || addressPayload.phuong_xa;
        if (hasAddressData) {
            if (!addressPayload.ma_dia_chi) addressPayload.ma_dia_chi = await makeAddressCode();
            if (!addressPayload.loai_dia_chi) addressPayload.loai_dia_chi = 'khac';
            addressPayload.khach_hang_id = customer._id;
            await DiaChiKhachHang.create(addressPayload);
        }

        res.redirect('/khach-hang?customer=' + customer._id + '&success=created');
    } catch (error) {
        console.error("LỖI KHI TẠO KHÁCH HÀNG:", error);
        if (error && error.code === 11000) {
            return res.redirect('/khach-hang?mode=create&error=duplicate_code');
        }

        next(error);
    }
};

exports.update = async function(req, res, next) {
    try {
        var customerId = normalizeIdParam(req?.params?.id);
        if (!customerId) return res.redirect('/khach-hang?error=invalid_customer');

        var payload = normalizeCustomerPayload(req?.body);
        var validationError = validateCustomerPayload(payload);

        if (validationError) {
            return res.redirect('/khach-hang?customer=' + customerId + '&error=' + validationError);
        }

        if (payload.loai_khach_hang === 'ca_nhan') {
            payload.ten_cong_ty = '';
            payload.ma_so_thue = '';
            payload.nguoi_dai_dien = '';
            payload.chuc_vu_nguoi_dai_dien = '';
        } else {
            payload.ten_ca_nhan = '';
            payload.cccd = '';
            payload.ngay_sinh = null;
        }

        if (!payload.ma_khach_hang) {
            delete payload.ma_khach_hang;
        }
        if (!payload.nhom_khach_hang_id) delete payload.nhom_khach_hang_id;

        var existingCustomer = await KhachHang.findById(customerId).lean();
        if (!existingCustomer) {
            return res.redirect('/khach-hang?error=invalid_customer');
        }
        finalizeCustomerPayload(payload, existingCustomer);

        await KhachHang.findByIdAndUpdate(customerId, { $set: payload }, { runValidators: true });

        // Save address if provided
        var addressPayload = normalizeAddressPayload(req?.body);
        var hasAddressData = addressPayload.ten_nguoi_nhan || addressPayload.sdt_nguoi_nhan || addressPayload.dia_chi_day_du || addressPayload.dia_chi_chi_tiet || addressPayload.tinh_thanh || addressPayload.phuong_xa;
        if (hasAddressData) {
            if (!addressPayload.loai_dia_chi) addressPayload.loai_dia_chi = 'khac';
            addressPayload.khach_hang_id = customerId;
            
            // If ma_dia_chi is provided and exists, update it. Otherwise, create a new one.
            if (addressPayload.ma_dia_chi) {
                var existingAddress = await DiaChiKhachHang.findOne({ ma_dia_chi: addressPayload.ma_dia_chi, khach_hang_id: customerId });
                if (existingAddress) {
                    if (addressPayload.mac_dinh) {
                        await DiaChiKhachHang.updateMany({ khach_hang_id: customerId, _id: { $ne: existingAddress._id } }, { $set: { mac_dinh: false } });
                    }
                    await DiaChiKhachHang.findByIdAndUpdate(existingAddress._id, addressPayload, { runValidators: true });
                } else {
                    if (addressPayload.mac_dinh) {
                        await DiaChiKhachHang.updateMany({ khach_hang_id: customerId }, { $set: { mac_dinh: false } });
                    }
                    await DiaChiKhachHang.create(addressPayload);
                }
            } else {
                addressPayload.ma_dia_chi = await makeAddressCode();
                if (addressPayload.mac_dinh) {
                    await DiaChiKhachHang.updateMany({ khach_hang_id: customerId }, { $set: { mac_dinh: false } });
                }
                await DiaChiKhachHang.create(addressPayload);
            }
        }

        res.redirect('/khach-hang?customer=' + customerId + '&success=updated');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/khach-hang?error=duplicate_code');
        }

        next(error);
    }
};

exports.remove = async function(req, res, next) {
    try {
        var customerId = normalizeIdParam(req?.params?.id);
        if (!customerId) return res.redirect('/khach-hang?error=invalid_customer');
        await KhachHang.findByIdAndDelete(customerId);
        res.redirect('/khach-hang?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.removeSelected = async function(req, res, next) {
    try {
        var ids = normalizeIdList(req?.body?.ids);

        if (ids.length === 0) {
            return res.redirect('/khach-hang?error=no_selection');
        }

        await KhachHang.deleteMany({ _id: { $in: ids } });
        res.redirect('/khach-hang?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.addGroup = async function(req, res, next) {
    try {
        var tenNhom = String(req.body.ten_nhom || '').trim();
        var moTa = String(req.body.mo_ta || '').trim();
        if (!tenNhom) return res.redirect('/khach-hang?error=missing_group_name');

        var created = await NhomKhachHang.create({ ten_nhom: tenNhom, mo_ta: moTa, trang_thai: 'active' });

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã thêm nhóm khách hàng.',
                selectedId: String(created._id),
                customerGroups: await loadCustomerGroups()
            });
        }

        res.redirect('/khach-hang?success=created');
    } catch (error) {
        next(error);
    }
};

exports.updateGroup = async function(req, res, next) {
    try {
        var groupId = normalizeIdParam(req?.params?.groupId);
        if (!groupId) return res.redirect('/khach-hang?error=invalid_group');

        var tenNhom = String(req.body.ten_nhom || '').trim();
        var moTa = String(req.body.mo_ta || '').trim();
        if (!tenNhom) return res.redirect('/khach-hang?error=missing_group_name');
        await NhomKhachHang.findByIdAndUpdate(groupId, { ten_nhom: tenNhom, mo_ta: moTa }, { runValidators: true });

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã cập nhật nhóm khách hàng.',
                selectedId: groupId,
                customerGroups: await loadCustomerGroups()
            });
        }

        res.redirect('/khach-hang?success=updated');
    } catch (error) {
        next(error);
    }
};

exports.removeGroup = async function(req, res, next) {
    try {
        var groupId = normalizeIdParam(req?.params?.groupId);
        if (!groupId) return res.redirect('/khach-hang?error=invalid_group');

        await KhachHang.updateMany(
            { nhom_khach_hang_id: groupId },
            { $unset: { nhom_khach_hang_id: 1 } }
        );
        await NhomKhachHang.findByIdAndDelete(groupId);

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã xóa nhóm khách hàng.',
                customerGroups: await loadCustomerGroups()
            });
        }

        res.redirect('/khach-hang?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.addAddressType = async function(req, res, next) {
    try {
        var tenLoai = String(req.body.ten_loai || '').trim();
        var maLoai = String(req.body.ma_loai || '').trim().toLowerCase();

        if (!tenLoai) return res.redirect('/khach-hang?error=missing_address_type');
        if (!maLoai) {
            maLoai = tenLoai
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-zA-Z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '')
                .toLowerCase();
        }

        var created = await LoaiDiaChiKhachHang.create({ ma_loai: maLoai, ten_loai: tenLoai, trang_thai: 'active' });

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã thêm loại địa chỉ.',
                selectedId: String(created._id),
                addressTypes: await loadAddressTypes()
            });
        }

        res.redirect('/khach-hang?success=created');
    } catch (error) {
        next(error);
    }
};

exports.updateAddressType = async function(req, res, next) {
    try {
        var addressTypeId = normalizeIdParam(req?.params?.addressTypeId);
        if (!addressTypeId) return res.redirect('/khach-hang?error=invalid_address_type');

        var tenLoai = String(req.body.ten_loai || '').trim();
        if (!tenLoai) return res.redirect('/khach-hang?error=missing_address_type');

        await LoaiDiaChiKhachHang.findByIdAndUpdate(
            addressTypeId,
            { ten_loai: tenLoai },
            { runValidators: true }
        );

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã cập nhật loại địa chỉ.',
                selectedId: addressTypeId,
                addressTypes: await loadAddressTypes()
            });
        }

        res.redirect('/khach-hang?success=updated');
    } catch (error) {
        next(error);
    }
};

exports.removeAddressType = async function(req, res, next) {
    try {
        var addressTypeId = normalizeIdParam(req?.params?.addressTypeId);
        if (!addressTypeId) return res.redirect('/khach-hang?error=invalid_address_type');

        var addressType = await LoaiDiaChiKhachHang.findById(addressTypeId).lean();
        if (addressType && addressType.ma_loai) {
            await DiaChiKhachHang.updateMany(
                { loai_dia_chi: addressType.ma_loai },
                { $set: { loai_dia_chi: 'khac' } }
            );
        }
        await LoaiDiaChiKhachHang.findByIdAndDelete(addressTypeId);

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã xóa loại địa chỉ.',
                addressTypes: await loadAddressTypes()
            });
        }

        res.redirect('/khach-hang?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.addAddress = async function(req, res, next) {
    try {
        var customerId = normalizeIdParam(req?.params?.id);
        if (!customerId) return res.redirect('/khach-hang?error=invalid_customer');

        var payload = normalizeAddressPayload(req?.body);
        if (!payload.ten_nguoi_nhan && !payload.sdt_nguoi_nhan && !payload.dia_chi_day_du) {
            return res.redirect(buildCustomerReturnUrl(customerId, req?.body?.returnQuery) + '&error=missing_address_data');
        }

        if (!payload.ma_dia_chi) payload.ma_dia_chi = await makeAddressCode();
        if (!payload.loai_dia_chi) payload.loai_dia_chi = 'khac';
        payload.khach_hang_id = customerId;

        if (payload.mac_dinh) {
            await DiaChiKhachHang.updateMany({ khach_hang_id: customerId }, { $set: { mac_dinh: false } });
        }

        await DiaChiKhachHang.create(payload);
        res.redirect(buildCustomerReturnUrl(customerId, req?.body?.returnQuery) + '&success=created');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/khach-hang?error=duplicate_address_code');
        }
        next(error);
    }
};

exports.updateAddress = async function(req, res, next) {
    try {
        var customerId = normalizeIdParam(req?.params?.id);
        var addressId = normalizeIdParam(req?.params?.addressId);
        if (!customerId || !addressId) return res.redirect('/khach-hang?error=invalid_address');

        var payload = normalizeAddressPayload(req?.body);
        if (!payload.ten_nguoi_nhan && !payload.sdt_nguoi_nhan && !payload.dia_chi_day_du) {
            return res.redirect(buildCustomerReturnUrl(customerId, req?.body?.returnQuery) + '&error=missing_address_data');
        }

        if (!payload.ma_dia_chi) delete payload.ma_dia_chi;
        if (!payload.loai_dia_chi) payload.loai_dia_chi = 'khac';

        if (payload.mac_dinh) {
            await DiaChiKhachHang.updateMany(
                { khach_hang_id: customerId, _id: { $ne: addressId } },
                { $set: { mac_dinh: false } }
            );
        }

        await DiaChiKhachHang.findOneAndUpdate(
            { _id: addressId, khach_hang_id: customerId },
            payload,
            { runValidators: true }
        );

        res.redirect(buildCustomerReturnUrl(customerId, req?.body?.returnQuery) + '&success=updated');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/khach-hang?error=duplicate_address_code');
        }
        next(error);
    }
};

exports.removeAddress = async function(req, res, next) {
    try {
        var customerId = normalizeIdParam(req?.params?.id);
        var addressId = normalizeIdParam(req?.params?.addressId);
        if (!customerId || !addressId) return res.redirect('/khach-hang?error=invalid_address');

        await DiaChiKhachHang.findOneAndDelete({ _id: addressId, khach_hang_id: customerId });
        res.redirect(buildCustomerReturnUrl(customerId, req?.body?.returnQuery) + '&success=deleted');
    } catch (error) {
        next(error);
    }
};
