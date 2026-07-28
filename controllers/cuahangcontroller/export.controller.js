const ExcelJS = require('exceljs');
const { CuaHang, Kho } = require('../../models/kiot.model');
const { normalizeIdParam, buildStoreAddress } = require('./helpers/common.helper');
const { normalizeFilterQuery, buildStoreQueryFromFilter } = require('./helpers/filter.helper');
const { addExportSheet, exportText, exportStatus, exportDate, safeExportFilenamePart } = require('./helpers/excel.helper');

const exportExcel = async function(req, res, next) {
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
            { header: 'Mã số thuế', key: 'ma_so_thue', width: 18 },
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
                ma_so_thue: exportText(store.ma_so_thue),
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

const exportSectionExcel = async function(req, res, next) {
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
                { label: 'Mã số thuế', value: exportText(store.ma_so_thue) },
                { label: 'Địa chỉ', value: exportText(store.dia_chi_day_du) },
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

module.exports = {
    exportExcel,
    exportSectionExcel
};
