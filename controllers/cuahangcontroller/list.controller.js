const { CuaHang } = require('../../models/kiot.model');
const { formatDate, normalizePage } = require('./helpers/common.helper');
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
            .select('ma_cua_hang ten_cua_hang ma_so_thue dia_chi dia_chi_chi_tiet dia_chi_day_du tinh_thanh tinh_thanh_id phuong_xa phuong_xa_code sdt email trang_thai created_at updated_at')
            .sort({ created_at: 1, ma_cua_hang: 1 })
            .skip(skip)
            .limit(STORE_PAGE_SIZE)
            .lean();

        var editingStore = requestQuery.edit
            ? stores.find(function(store) {
                return String(store._id) === String(requestQuery.edit);
            })
            : null;

        res.render('cua-hang/index', {
            pageTitle: 'Cửa hàng',
            activeMenu: 'cua-hang',
            user: req.user,
            flash: requestQuery,
            stores: stores,
            editingStore: editingStore,
            formMode: editingStore ? 'edit' : (requestQuery.mode === 'create' ? 'create' : ''),
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
            provinceOptions: []
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    index
};
