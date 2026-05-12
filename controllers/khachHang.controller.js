var {
    KhachHang,
    NhomKhachHang,
    DiaChiKhachHang,
    LoaiDiaChiKhachHang,
    DonHang,
    HoaDonBanHang,
    PhieuTraHang,
    CongNoKhachHang
} = require('../models/kiot.model');

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

    var parsedNgaySinh = body.ngay_sinh ? new Date(body.ngay_sinh) : null;

    return {
        ma_khach_hang: String(body.ma_khach_hang || '').trim(),
        ten_khach_hang: tenKhachHang,
        ten_ca_nhan: tenCaNhan,
        cccd: String(body.cccd || '').trim(),
        so_ho_chieu: String(body.so_ho_chieu || '').trim(),
        ngay_sinh: parsedNgaySinh && !isNaN(parsedNgaySinh.getTime()) ? parsedNgaySinh : null,
        ten_cong_ty: tenCongTy,
        ma_so_thue: String(body.ma_so_thue || '').trim(),
        nguoi_dai_dien: String(body.nguoi_dai_dien || '').trim(),
        chuc_vu_nguoi_dai_dien: String(body.chuc_vu_nguoi_dai_dien || '').trim(),
        sdt: String(body.sdt || '').trim(),
        email: String(body.email || '').trim(),
        nhom_khach_hang_id: body.nhom_khach_hang_id ? String(body.nhom_khach_hang_id).trim() : null,
        nguoi_tao_ten: String(body.nguoi_tao_ten || '').trim(),
        gioi_tinh: String(body.gioi_tinh || '').trim(),
        loai_khach_hang: loaiKhachHang,
        tong_no: tongNo < 0 ? 0 : tongNo,
        tong_ban: tongBan < 0 ? 0 : tongBan,
        khu_vuc_giao_hang: String(body.khu_vuc_giao_hang || '').trim(),
        ghi_chu: String(body.ghi_chu || '').trim(),
        trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
    };
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
            khu_vuc_giao_hang: 'TP.HCM - Quận 1',
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

exports.index = async function(req, res, next) {
    try {
        var requestQuery = req?.query || {};
        var filter = normalizeFilterQuery(requestQuery);
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
        if (filter.creatorKeyword) {
            customerQuery.nguoi_tao_ten = { $regex: filter.creatorKeyword, $options: 'i' };
        }
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

        var customers = await KhachHang.find(customerQuery).sort({ created_at: -1, ma_khach_hang: 1 }).lean();
        customers = customers.map(function(customer) {
            customer.nhom_khach_hang_ten = groupMap[String(customer.nhom_khach_hang_id || '')] || '---';
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
            title: 'Khach hang',
            pageTitle: 'Khach hang',
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
            filter: filter,
            filterQueryString: buildFilterQueryString(filter)
        });
    } catch (error) {
        next(error);
    }
};

exports.add = async function(req, res, next) {
    try {
        var payload = normalizeCustomerPayload(req?.body);

        if (!payload.ten_khach_hang) {
            return res.redirect('/khach-hang?mode=create&error=missing_name');
        }

        if (payload.loai_khach_hang === 'ca_nhan') {
            payload.ten_cong_ty = '';
            payload.ma_so_thue = '';
            payload.nguoi_dai_dien = '';
            payload.chuc_vu_nguoi_dai_dien = '';
        } else {
            payload.ten_ca_nhan = '';
            payload.cccd = '';
            payload.so_ho_chieu = '';
            payload.ngay_sinh = null;
        }

        if (!payload.ma_khach_hang) {
            payload.ma_khach_hang = await makeCustomerCode();
        }

        if (!payload.nhom_khach_hang_id) delete payload.nhom_khach_hang_id;

        var customer = await KhachHang.create(payload);

        // Save address if provided
        var addressPayload = normalizeAddressPayload(req?.body);
        var hasAddressData = addressPayload.ten_nguoi_nhan || addressPayload.sdt_nguoi_nhan || addressPayload.dia_chi_day_du || addressPayload.so_nha || addressPayload.tinh_thanh || addressPayload.quan_huyen || addressPayload.phuong_xa;
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

        if (!payload.ten_khach_hang) {
            return res.redirect('/khach-hang?customer=' + customerId + '&error=missing_name');
        }

        if (payload.loai_khach_hang === 'ca_nhan') {
            payload.ten_cong_ty = '';
            payload.ma_so_thue = '';
            payload.nguoi_dai_dien = '';
            payload.chuc_vu_nguoi_dai_dien = '';
        } else {
            payload.ten_ca_nhan = '';
            payload.cccd = '';
            payload.so_ho_chieu = '';
            payload.ngay_sinh = null;
        }

        if (!payload.ma_khach_hang) {
            delete payload.ma_khach_hang;
        }
        if (!payload.nhom_khach_hang_id) delete payload.nhom_khach_hang_id;

        await KhachHang.findByIdAndUpdate(customerId, payload, { runValidators: true });

        // Save address if provided
        var addressPayload = normalizeAddressPayload(req?.body);
        var hasAddressData = addressPayload.ten_nguoi_nhan || addressPayload.sdt_nguoi_nhan || addressPayload.dia_chi_day_du || addressPayload.so_nha || addressPayload.tinh_thanh || addressPayload.quan_huyen || addressPayload.phuong_xa;
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
