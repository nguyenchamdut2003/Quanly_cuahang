var { CuaHang, Kho } = require('../models/kiot.model');

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

function normalizeFilterQuery(query) {
    query = query || {};
    var status = query.status === 'active' || query.status === 'inactive' ? query.status : 'all';
    var city = String(query.city || 'all').trim() || 'all';
    var warehouse = ['all', 'none', 'has', 'gte1', 'gte2'].indexOf(query.warehouse) >= 0 ? query.warehouse : 'all';
    var created = ['all', 'today', '7days', '30days', 'custom'].indexOf(query.created) >= 0 ? query.created : 'all';
    var createdFrom = String(query.createdFrom || '').trim();
    var createdTo = String(query.createdTo || '').trim();

    return {
        status: status,
        city: city,
        warehouse: warehouse,
        created: created,
        createdFrom: createdFrom,
        createdTo: createdTo
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

    return params.join('&');
}

async function seedStoresIfEmpty() {
    var count = await CuaHang.countDocuments();
    if (count > 0) return;

    var stores = await CuaHang.insertMany([
        {
            ma_cua_hang: 'CH0001',
            ten_cua_hang: 'Cua hang trung tam',
            dia_chi: '12 Nguyen Trai',
            dia_chi_gui_hang: '12 Nguyen Trai',
            tinh_thanh: 'Ha Noi',
            quan_huyen: 'Thanh Xuan',
            phuong_xa: 'Thuong Dinh',
            sdt: '0901000001',
            email: 'trungtam@example.com',
            trang_thai: 'active'
        },
        {
            ma_cua_hang: 'CH0002',
            ten_cua_hang: 'Cua hang Quan 1',
            dia_chi: '25 Le Loi',
            dia_chi_gui_hang: '25 Le Loi',
            tinh_thanh: 'TP Ho Chi Minh',
            quan_huyen: 'Quan 1',
            phuong_xa: 'Ben Nghe',
            sdt: '0901000002',
            email: 'quan1@example.com',
            trang_thai: 'active'
        },
        {
            ma_cua_hang: 'CH0003',
            ten_cua_hang: 'Cua hang Da Nang',
            dia_chi: '40 Bach Dang',
            dia_chi_gui_hang: '40 Bach Dang',
            tinh_thanh: 'Da Nang',
            quan_huyen: 'Hai Chau',
            phuong_xa: 'Thach Thang',
            sdt: '0901000003',
            email: 'danang@example.com',
            trang_thai: 'active'
        }
    ]);

    await Kho.insertMany([
        {
            cua_hang_id: stores[0]._id,
            ma_kho: 'KHO0001',
            ten_kho: 'Kho ban hang trung tam',
            dia_chi: '12 Nguyen Trai, Thanh Xuan, Ha Noi',
            trang_thai: 'active'
        },
        {
            cua_hang_id: stores[0]._id,
            ma_kho: 'KHO0002',
            ten_kho: 'Kho du tru trung tam',
            dia_chi: '18 Nguyen Trai, Thanh Xuan, Ha Noi',
            trang_thai: 'active'
        },
        {
            cua_hang_id: stores[1]._id,
            ma_kho: 'KHO0003',
            ten_kho: 'Kho Quan 1',
            dia_chi: '25 Le Loi, Quan 1, TP Ho Chi Minh',
            trang_thai: 'active'
        },
        {
            cua_hang_id: stores[2]._id,
            ma_kho: 'KHO0004',
            ten_kho: 'Kho Da Nang',
            dia_chi: '40 Bach Dang, Hai Chau, Da Nang',
            trang_thai: 'active'
        }
    ]);
}

function normalizeStorePayload(body) {
    body = body || {};
    return {
        ma_cua_hang: String(body.ma_cua_hang || '').trim(),
        ten_cua_hang: String(body.ten_cua_hang || '').trim(),
        dia_chi: String(body.dia_chi || '').trim(),
        dia_chi_gui_hang: String(body.dia_chi_gui_hang || '').trim(),
        tinh_thanh: String(body.tinh_thanh || '').trim(),
        quan_huyen: String(body.quan_huyen || '').trim(),
        phuong_xa: String(body.phuong_xa || '').trim(),
        sdt: String(body.sdt || '').trim(),
        email: String(body.email || '').trim(),
        trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
    };
}

async function makeStoreCode() {
    var lastStore = await CuaHang.findOne({ ma_cua_hang: /^CH\d+$/ }).sort({ ma_cua_hang: -1 }).lean();
    var nextNumber = 1;

    if (lastStore && lastStore.ma_cua_hang) {
        nextNumber = Number(lastStore.ma_cua_hang.replace(/\D/g, '')) + 1;
    }

    return 'CH' + String(nextNumber).padStart(4, '0');
}

function normalizeWarehousePayload(body) {
    body = body || {};
    return {
        ma_kho: String(body.ma_kho || '').trim(),
        ten_kho: String(body.ten_kho || '').trim(),
        dia_chi: String(body.dia_chi || '').trim(),
        trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
    };
}

async function makeWarehouseCode() {
    var lastWarehouse = await Kho.findOne({ ma_kho: /^KHO\d+$/ }).sort({ ma_kho: -1 }).lean();
    var nextNumber = 1;

    if (lastWarehouse && lastWarehouse.ma_kho) {
        nextNumber = Number(lastWarehouse.ma_kho.replace(/\D/g, '')) + 1;
    }

    return 'KHO' + String(nextNumber).padStart(4, '0');
}

exports.index = async function(req, res, next) {
    try {
        var requestQuery = req?.query || {};
        var filter = normalizeFilterQuery(requestQuery);
        var dateRange = getDateRange(filter);
        var storeQuery = {};

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

        var stores = await CuaHang.find(storeQuery).sort({ created_at: 1, ma_cua_hang: 1 }).lean();
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
            ? await Kho.find({ cua_hang_id: selectedStore._id }).sort({ created_at: 1, ma_kho: 1 }).lean()
            : [];

        var editingStore = requestQuery.edit
            ? stores.find(function(store) {
                return String(store._id) === String(requestQuery.edit);
            })
            : null;

        res.render('cua-hang/index', {
            title: 'Cua hang',
            pageTitle: 'Cua hang',
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
            provinceOptions: provinceOptions
        });
    } catch (error) {
        next(error);
    }
};

exports.add = async function(req, res, next) {
    try {
        var payload = normalizeStorePayload(req?.body);

        if (!payload.ten_cua_hang) {
            return res.redirect('/cua-hang?mode=create&error=missing_name');
        }

        if (!payload.ma_cua_hang) {
            payload.ma_cua_hang = await makeStoreCode();
        }

        var store = await CuaHang.create(payload);
        res.redirect('/cua-hang?store=' + store._id + '&success=created');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/cua-hang?mode=create&error=duplicate_code');
        }

        next(error);
    }
};

exports.update = async function(req, res, next) {
    try {
        var storeId = normalizeIdParam(req?.params?.id);
        if (!storeId) return res.redirect('/cua-hang?error=invalid_store');

        var payload = normalizeStorePayload(req?.body);

        if (!payload.ten_cua_hang) {
            return res.redirect('/cua-hang?edit=' + storeId + '&error=missing_name');
        }

        if (!payload.ma_cua_hang) {
            delete payload.ma_cua_hang;
        }

        await CuaHang.findByIdAndUpdate(storeId, payload, { runValidators: true });
        res.redirect('/cua-hang?store=' + storeId + '&success=updated');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/cua-hang?error=duplicate_code');
        }

        next(error);
    }
};

exports.remove = async function(req, res, next) {
    try {
        var storeId = normalizeIdParam(req?.params?.id);
        if (!storeId) return res.redirect('/cua-hang?error=invalid_store');
        await Kho.deleteMany({ cua_hang_id: storeId });
        await CuaHang.findByIdAndDelete(storeId);
        res.redirect('/cua-hang?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.removeSelected = async function(req, res, next) {
    try {
        var ids = normalizeIdList(req?.body?.ids);

        if (ids.length === 0) {
            return res.redirect('/cua-hang?error=no_selection');
        }

        await Kho.deleteMany({ cua_hang_id: { $in: ids } });
        await CuaHang.deleteMany({ _id: { $in: ids } });

        res.redirect('/cua-hang?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.addWarehouse = async function(req, res, next) {
    try {
        var storeId = normalizeIdParam(req?.params?.id);
        if (!storeId) {
            return res.redirect('/cua-hang?error=invalid_store');
        }

        var payload = normalizeWarehousePayload(req?.body);
        if (!payload.ten_kho) {
            return res.redirect('/cua-hang?store=' + storeId + '&error=missing_warehouse_name');
        }

        if (!payload.ma_kho) {
            payload.ma_kho = await makeWarehouseCode();
        }

        payload.cua_hang_id = storeId;
        await Kho.create(payload);
        res.redirect('/cua-hang?store=' + storeId + '&success=created');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/cua-hang?store=' + req.params.id + '&error=duplicate_code');
        }
        next(error);
    }
};

exports.updateWarehouse = async function(req, res, next) {
    try {
        var payload = normalizeWarehousePayload(req?.body);
        var warehouseId = normalizeIdParam(req?.params?.warehouseId);
        var storeId = normalizeIdParam(req?.params?.id);

        if (!warehouseId || !storeId) {
            return res.redirect('/cua-hang?error=invalid_warehouse');
        }

        if (!payload.ten_kho) {
            return res.redirect('/cua-hang?store=' + storeId + '&error=missing_warehouse_name');
        }

        if (!payload.ma_kho) {
            delete payload.ma_kho;
        }

        await Kho.findOneAndUpdate(
            { _id: warehouseId, cua_hang_id: storeId },
            payload,
            { runValidators: true }
        );

        res.redirect('/cua-hang?store=' + storeId + '&success=updated');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/cua-hang?store=' + req.params.id + '&error=duplicate_code');
        }
        next(error);
    }
};

exports.removeWarehouse = async function(req, res, next) {
    try {
        var warehouseId = normalizeIdParam(req?.params?.warehouseId);
        var storeId = normalizeIdParam(req?.params?.id);

        if (!warehouseId || !storeId) {
            return res.redirect('/cua-hang?error=invalid_warehouse');
        }

        await Kho.findOneAndDelete({ _id: warehouseId, cua_hang_id: storeId });
        res.redirect('/cua-hang?store=' + storeId + '&success=deleted');
    } catch (error) {
        next(error);
    }
};
