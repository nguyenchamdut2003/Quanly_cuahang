var { NguoiDung } = require('../../../models/kiot.model');

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

    if (dateRange.start || dateRange.end) {
        customerQuery.created_at = {};
        if (dateRange.start) customerQuery.created_at.$gte = dateRange.start;
        if (dateRange.end) customerQuery.created_at.$lte = dateRange.end;
    }

    return customerQuery;
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


module.exports = {
    normalizeFilterQuery,
    getDateRange,
    buildFilterQueryString,
    makeRangeFilter,
    buildCustomerQueryFromFilter,
    applyCreatorFilter
};

