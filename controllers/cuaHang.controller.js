var { CuaHang, Kho } = require('../models/kiot.model');
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

async function buildStoreQueryFromFilter(filter) {
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

    return storeQuery;
}

function exportText(value) {
    if (value === null || typeof value === 'undefined' || value === '') return '---';
    return value;
}

function exportStatus(value) {
    return value === 'inactive' ? 'Ngừng hoạt động' : 'Đang hoạt động';
}

function exportDate(value) {
    return value ? formatDate(value) : '---';
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

function buildStoreAddress(store) {
    return store.dia_chi_day_du || buildFullAddress(store) || store.dia_chi_gui_hang_day_du || '';
}

async function seedStoresIfEmpty() {
    var count = await CuaHang.countDocuments();
    if (count > 0) return;

    var stores = await CuaHang.insertMany([
        {
            ma_cua_hang: 'CH0001',
            ten_cua_hang: 'Cua hang trung tam',
            dia_chi_chi_tiet: '12 Nguyen Trai',
            tinh_thanh: 'Ha Noi',
            phuong_xa: 'Thuong Dinh',
            dia_chi_day_du: buildFullAddress({ dia_chi_chi_tiet: '12 Nguyen Trai', phuong_xa: 'Thuong Dinh', tinh_thanh: 'Ha Noi' }),
            sdt: '0901000001',
            email: 'trungtam@example.com',
            trang_thai: 'active'
        },
        {
            ma_cua_hang: 'CH0002',
            ten_cua_hang: 'Cua hang Quan 1',
            dia_chi_chi_tiet: '25 Le Loi',
            tinh_thanh: 'TP Ho Chi Minh',
            phuong_xa: 'Ben Nghe',
            dia_chi_day_du: buildFullAddress({ dia_chi_chi_tiet: '25 Le Loi', phuong_xa: 'Ben Nghe', tinh_thanh: 'TP Ho Chi Minh' }),
            sdt: '0901000002',
            email: 'quan1@example.com',
            trang_thai: 'active'
        },
        {
            ma_cua_hang: 'CH0003',
            ten_cua_hang: 'Cua hang Da Nang',
            dia_chi_chi_tiet: '40 Bach Dang',
            tinh_thanh: 'Da Nang',
            phuong_xa: 'Thach Thang',
            dia_chi_day_du: buildFullAddress({ dia_chi_chi_tiet: '40 Bach Dang', phuong_xa: 'Thach Thang', tinh_thanh: 'Da Nang' }),
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
            dia_chi_chi_tiet: '12 Nguyen Trai',
            phuong_xa: 'Thuong Dinh',
            tinh_thanh: 'Ha Noi',
            dia_chi_day_du: buildFullAddress({ dia_chi_chi_tiet: '12 Nguyen Trai', phuong_xa: 'Thuong Dinh', tinh_thanh: 'Ha Noi' }),
            trang_thai: 'active'
        },
        {
            cua_hang_id: stores[0]._id,
            ma_kho: 'KHO0002',
            ten_kho: 'Kho du tru trung tam',
            dia_chi_chi_tiet: '18 Nguyen Trai',
            phuong_xa: 'Thuong Dinh',
            tinh_thanh: 'Ha Noi',
            dia_chi_day_du: buildFullAddress({ dia_chi_chi_tiet: '18 Nguyen Trai', phuong_xa: 'Thuong Dinh', tinh_thanh: 'Ha Noi' }),
            trang_thai: 'active'
        },
        {
            cua_hang_id: stores[1]._id,
            ma_kho: 'KHO0003',
            ten_kho: 'Kho Quan 1',
            dia_chi_chi_tiet: '25 Le Loi',
            phuong_xa: 'Ben Nghe',
            tinh_thanh: 'TP Ho Chi Minh',
            dia_chi_day_du: buildFullAddress({ dia_chi_chi_tiet: '25 Le Loi', phuong_xa: 'Ben Nghe', tinh_thanh: 'TP Ho Chi Minh' }),
            trang_thai: 'active'
        },
        {
            cua_hang_id: stores[2]._id,
            ma_kho: 'KHO0004',
            ten_kho: 'Kho Da Nang',
            dia_chi_chi_tiet: '40 Bach Dang',
            phuong_xa: 'Thach Thang',
            tinh_thanh: 'Da Nang',
            dia_chi_day_du: buildFullAddress({ dia_chi_chi_tiet: '40 Bach Dang', phuong_xa: 'Thach Thang', tinh_thanh: 'Da Nang' }),
            trang_thai: 'active'
        }
    ]);
}

function normalizeStorePayload(body) {
    body = body || {};
    var address = normalizeAddress(body);
    var shippingAddress = normalizeAddress({
        dia_chi_chi_tiet: body.dia_chi_gui_hang_chi_tiet,
        phuong_xa: body.phuong_xa_gui_hang,
        tinh_thanh: body.tinh_thanh_gui_hang,
        dia_chi_day_du: body.dia_chi_gui_hang_day_du
    });
    return {
        ma_cua_hang: String(body.ma_cua_hang || '').trim(),
        ten_cua_hang: String(body.ten_cua_hang || '').trim(),
        dia_chi_chi_tiet: address.dia_chi_chi_tiet,
        tinh_thanh: address.tinh_thanh,
        phuong_xa: address.phuong_xa,
        dia_chi_day_du: address.dia_chi_day_du,
        dia_chi_gui_hang_chi_tiet: shippingAddress.dia_chi_chi_tiet,
        tinh_thanh_gui_hang: shippingAddress.tinh_thanh,
        phuong_xa_gui_hang: shippingAddress.phuong_xa,
        dia_chi_gui_hang_day_du: shippingAddress.dia_chi_day_du,
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
    var address = normalizeAddress(body);
    var diaChiDayDu = address.dia_chi_day_du || address.dia_chi_chi_tiet;
    return {
        ma_kho: String(body.ma_kho || '').trim(),
        ten_kho: String(body.ten_kho || '').trim(),
        dia_chi_chi_tiet: address.dia_chi_chi_tiet,
        tinh_thanh: address.tinh_thanh,
        phuong_xa: address.phuong_xa,
        dia_chi_day_du: diaChiDayDu,
        dia_chi: diaChiDayDu,
        trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
    };
}

function enrichWarehouseRow(warehouse) {
    if (!warehouse) return warehouse;
    var row = Object.assign({}, warehouse);
    var legacyAddress = String(row.dia_chi || '').trim();
    if (!String(row.dia_chi_chi_tiet || '').trim() && legacyAddress) {
        row.dia_chi_chi_tiet = legacyAddress;
    }
    if (!String(row.dia_chi_day_du || '').trim()) {
        row.dia_chi_day_du = buildFullAddress(row) || legacyAddress;
    }
    if (!String(row.dia_chi || '').trim() && row.dia_chi_day_du) {
        row.dia_chi = row.dia_chi_day_du;
    }
    return row;
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
        var storeQuery = await buildStoreQueryFromFilter(filter);

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
            provinceOptions: provinceOptions
        });
    } catch (error) {
        next(error);
    }
};

exports.exportExcel = async function(req, res, next) {
    try {
        var filter = normalizeFilterQuery(req?.query || {});
        var storeQuery = await buildStoreQueryFromFilter(filter);
        var stores = await CuaHang.find(storeQuery).sort({ created_at: 1, ma_cua_hang: 1 }).lean();
        var storeIds = stores.map(function(store) { return store._id; });
        var warehouseRows = storeIds.length
            ? await Kho.find({ cua_hang_id: { $in: storeIds } }).select('cua_hang_id').lean()
            : [];
        var warehouseCountMap = warehouseRows.reduce(function(map, warehouse) {
            var key = String(warehouse.cua_hang_id || '');
            map[key] = (map[key] || 0) + 1;
            return map;
        }, {});

        var workbook = new ExcelJS.Workbook();
        workbook.creator = 'Quan ly cua hang';
        workbook.created = new Date();
        addExportSheet(workbook, 'Cửa hàng', [
            { header: 'Mã cửa hàng', key: 'ma_cua_hang', width: 16 },
            { header: 'Tên cửa hàng', key: 'ten_cua_hang', width: 28 },
            { header: 'Địa chỉ', key: 'dia_chi', width: 42 },
            { header: 'Điện thoại', key: 'sdt', width: 16 },
            { header: 'Email', key: 'email', width: 28 },
            { header: 'Số lượng kho', key: 'so_luong_kho', width: 14 },
            { header: 'Trạng thái', key: 'trang_thai', width: 18 },
            { header: 'Thời gian tạo', key: 'created_at', width: 20 }
        ], stores.map(function(store) {
            return {
                ma_cua_hang: exportText(store.ma_cua_hang),
                ten_cua_hang: exportText(store.ten_cua_hang),
                dia_chi: exportText(buildStoreAddress(store)),
                sdt: exportText(store.sdt),
                email: exportText(store.email),
                so_luong_kho: warehouseCountMap[String(store._id)] || 0,
                trang_thai: exportStatus(store.trang_thai),
                created_at: exportDate(store.created_at)
            };
        }));

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="danh-sach-cua-hang.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};

exports.exportSectionExcel = async function(req, res, next) {
    try {
        var storeId = normalizeIdParam(req?.params?.id);
        var section = normalizeIdParam(req?.params?.section);
        var sectionMap = {
            info: { label: 'thong-tin', sheet: 'Thông tin' },
            warehouses: { label: 'danh-sach-kho', sheet: 'Danh sách kho' },
            notes: { label: 'ghi-chu', sheet: 'Ghi chú' }
        };
        if (!storeId || !sectionMap[section]) return res.redirect('/cua-hang?error=invalid_store');

        var store = await CuaHang.findById(storeId).lean();
        if (!store) return res.redirect('/cua-hang?error=invalid_store');

        var workbook = new ExcelJS.Workbook();
        workbook.creator = 'Quan ly cua hang';
        workbook.created = new Date();

        if (section === 'info') {
            addExportSheet(workbook, 'Thông tin', [
                { header: 'Trường thông tin', key: 'label', width: 28 },
                { header: 'Giá trị', key: 'value', width: 44 }
            ], [
                { label: 'Mã cửa hàng', value: exportText(store.ma_cua_hang) },
                { label: 'Tên cửa hàng', value: exportText(store.ten_cua_hang) },
                { label: 'Địa chỉ', value: exportText(store.dia_chi_day_du) },
                { label: 'Địa chỉ gửi hàng', value: exportText(store.dia_chi_gui_hang_day_du) },
                { label: 'Phường/xã', value: exportText(store.phuong_xa) },
                { label: 'Tỉnh/thành', value: exportText(store.tinh_thanh) },
                { label: 'Điện thoại', value: exportText(store.sdt) },
                { label: 'Email', value: exportText(store.email) },
                { label: 'Trạng thái', value: exportStatus(store.trang_thai) },
                { label: 'Thời gian tạo', value: exportDate(store.created_at) },
                { label: 'Cập nhật lúc', value: exportDate(store.updated_at) }
            ]);
        }

        if (section === 'warehouses') {
            var warehouses = await Kho.find({ cua_hang_id: store._id }).sort({ created_at: 1, ma_kho: 1 }).lean();
            addExportSheet(workbook, 'Danh sách kho', [
                { header: 'Mã kho', key: 'ma_kho', width: 16 },
                { header: 'Tên kho', key: 'ten_kho', width: 28 },
                { header: 'Địa chỉ', key: 'dia_chi', width: 42 },
                { header: 'Trạng thái', key: 'trang_thai', width: 18 },
                { header: 'Thời gian tạo', key: 'created_at', width: 20 }
            ], warehouses.map(function(warehouse) {
                return {
                    ma_kho: exportText(warehouse.ma_kho),
                    ten_kho: exportText(warehouse.ten_kho),
                    dia_chi: exportText(warehouse.dia_chi_day_du),
                    trang_thai: exportStatus(warehouse.trang_thai),
                    created_at: exportDate(warehouse.created_at)
                };
            }));
        }

        if (section === 'notes') {
            addExportSheet(workbook, 'Ghi chú', [
                { header: 'Nội dung ghi chú', key: 'ghi_chu', width: 60 }
            ], [
                { ghi_chu: exportText(store.ghi_chu) }
            ]);
        }

        var filename = 'cua-hang-' + safeExportFilenamePart(store.ma_cua_hang || store._id) + '-' + sectionMap[section].label + '.xlsx';
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
