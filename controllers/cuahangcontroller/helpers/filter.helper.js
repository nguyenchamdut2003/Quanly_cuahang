const { Kho } = require('../../../models/kiot.model');

const STORE_PAGE_SIZE = 10;
const NOT_DELETED_QUERY = {
    $or: [
        { deleted_at: null },
        { deleted_at: { $exists: false } }
    ]
};

function normalizeFilterQuery(query) {
    query = query || {};
    var status = query.status === 'active' || query.status === 'inactive' ? query.status : 'all';
    var city = String(query.city || 'all').trim() || 'all';
    var warehouse = ['all', 'none', 'has', 'gte1', 'gte2'].indexOf(query.warehouse) >= 0 ? query.warehouse : 'all';
    var created = ['all', 'today', '7days', '30days', 'custom'].indexOf(query.created) >= 0 ? query.created : 'all';
    var createdFrom = String(query.createdFrom || '').trim();
    var createdTo = String(query.createdTo || '').trim();
    var keyword = String(query.keyword || '').trim();

    return {
        status: status,
        city: city,
        warehouse: warehouse,
        created: created,
        createdFrom: createdFrom,
        createdTo: createdTo,
        keyword: keyword
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
            if (!isNaN(parsedFrom.getTime())) {
                start = parsedFrom;
            }
        }

        if (filter.createdTo) {
            var parsedTo = new Date(filter.createdTo + 'T23:59:59.999');
            if (!isNaN(parsedTo.getTime())) {
                end = parsedTo;
            }
        }
    }

    return { start: start, end: end };
}

function buildFilterQueryString(filter) {
    var params = [];

    if (filter.status !== 'all') params.push('status=' + encodeURIComponent(filter.status));
    if (filter.city !== 'all') params.push('city=' + encodeURIComponent(filter.city));
    if (filter.warehouse !== 'all') params.push('warehouse=' + encodeURIComponent(filter.warehouse));
    if (filter.created !== 'all') params.push('created=' + encodeURIComponent(filter.created));
    if (filter.created === 'custom' && filter.createdFrom) params.push('createdFrom=' + encodeURIComponent(filter.createdFrom));
    if (filter.created === 'custom' && filter.createdTo) params.push('createdTo=' + encodeURIComponent(filter.createdTo));
    if (filter.keyword) params.push('keyword=' + encodeURIComponent(filter.keyword));

    return params.join('&');
}

async function buildStoreQueryFromFilter(filter) {
    var dateRange = getDateRange(filter);
    var storeQuery = { $and: [NOT_DELETED_QUERY] };

    if (filter.keyword) {
        storeQuery.$or = [
            { ma_cua_hang: { $regex: filter.keyword, $options: 'i' } },
            { ten_cua_hang: { $regex: filter.keyword, $options: 'i' } }
        ];
    }

    if (filter.status !== 'all') {
        storeQuery.trang_thai = filter.status;
    }

    if (filter.city !== 'all') {
        storeQuery.tinh_thanh = filter.city;
    }

    if (dateRange.start || dateRange.end) {
        storeQuery.created_at = {};
        if (dateRange.start) storeQuery.created_at.$gte = dateRange.start;
        if (dateRange.end) storeQuery.created_at.$lte = dateRange.end;
    }

    if (filter.warehouse === 'none') {
        var storeIdsHaveWarehouse = await Kho.distinct('cua_hang_id');
        storeQuery._id = { $nin: storeIdsHaveWarehouse };
    }

    if (filter.warehouse === 'has' || filter.warehouse === 'gte1') {
        var storeIdsWithAtLeastOneWarehouse = await Kho.distinct('cua_hang_id');
        storeQuery._id = { $in: storeIdsWithAtLeastOneWarehouse };
    }

    if (filter.warehouse === 'gte2') {
        var groupedWarehouses = await Kho.aggregate([
            { $group: { _id: '$cua_hang_id', total: { $sum: 1 } } },
            { $match: { total: { $gte: 2 } } }
        ]);

        storeQuery._id = {
            $in: groupedWarehouses.map(function(item) {
                return item._id;
            })
        };
    }

    return storeQuery;
}

module.exports = {
    STORE_PAGE_SIZE,
    NOT_DELETED_QUERY,
    normalizeFilterQuery,
    getDateRange,
    buildFilterQueryString,
    buildStoreQueryFromFilter
};
