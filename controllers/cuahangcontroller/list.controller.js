const { CuaHang, Kho } = require('../../models/kiot.model');
const { formatDate, normalizePage, enrichWarehouseRow } = require('./helpers/common.helper');
const { STORE_PAGE_SIZE, normalizeFilterQuery, buildStoreQueryFromFilter, buildFilterQueryString } = require('./helpers/filter.helper');

const index = async function(req, res, next) {
    try {
        var requestQuery = req?.query || {};
        var filter = normalizeFilterQuery(requestQuery);
        var storeQuery = await buildStoreQueryFromFilter(filter);
        var page = normalizePage(requestQuery.page);
        var totalStores = await CuaHang.countDocuments(storeQuery);
        var totalPages = Math.max(1, Math.ceil(totalStores / STORE_PAGE_SIZE));
        if (page > totalPages) page = totalPages;
        var skip = (page - 1) * STORE_PAGE_SIZE;

        var stores = await CuaHang.find(storeQuery)
            .sort({ created_at: 1, ma_cua_hang: 1 })
            .skip(skip)
            .limit(STORE_PAGE_SIZE)
            .lean();
        var storeIds = stores.map(function(store) { return store._id; });
        var warehouseRows = storeIds.length > 0
            ? await Kho.find({ cua_hang_id: { $in: storeIds } }).select('cua_hang_id').lean()
            : [];

        var warehouseCountMap = warehouseRows.reduce(function(map, warehouse) {
            var key = String(warehouse.cua_hang_id || '');
            map[key] = (map[key] || 0) + 1;
            return map;
        }, {});

        var provinceRows = await CuaHang.find().select('tinh_thanh').lean();
        var provinceOptions = provinceRows
            .map(function(store) { return String(store.tinh_thanh || '').trim(); })
            .filter(Boolean)
            .filter(function(city, index, cities) { return cities.indexOf(city) === index; })
            .sort(function(a, b) { return a.localeCompare(b, 'vi'); });

        var hasStoreQuery = Object.prototype.hasOwnProperty.call(requestQuery, 'store');
        var selectedStoreId = hasStoreQuery ? String(requestQuery.store || '') : '';
        var selectedStore = selectedStoreId
            ? stores.find(function(store) {
                return String(store._id) === selectedStoreId;
            }) || null
            : null;

        var warehouses = selectedStore
            ? (await Kho.find({ cua_hang_id: selectedStore._id }).sort({ created_at: 1, ma_kho: 1 }).lean())
                .map(enrichWarehouseRow)
            : [];

        var editingStore = requestQuery.edit
            ? stores.find(function(store) {
                return String(store._id) === String(requestQuery.edit);
            })
            : null;

        res.render('cua-hang/index', {
            title: 'Cửa hàng',
            pageTitle: 'Cửa hàng',
            activeMenu: 'cua-hang',
            user: req.user,
            flash: requestQuery,
            stores: stores,
            selectedStore: selectedStore,
            editingStore: editingStore,
            formMode: editingStore ? 'edit' : (requestQuery.mode === 'create' ? 'create' : ''),
            warehouses: warehouses,
            warehouseCountMap: warehouseCountMap,
            formatDate: formatDate,
            filter: filter,
            filterQueryString: buildFilterQueryString(filter),
            pagination: {
                page: page,
                limit: STORE_PAGE_SIZE,
                total: totalStores,
                totalPages: totalPages,
                from: totalStores ? skip + 1 : 0,
                to: Math.min(skip + stores.length, totalStores)
            },
            provinceOptions: provinceOptions
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    index
};
