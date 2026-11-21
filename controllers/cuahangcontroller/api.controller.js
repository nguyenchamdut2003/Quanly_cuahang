const mongoose = require('mongoose');
const { CuaHang, Kho } = require('../../models/kiot.model');
const { formatDate, enrichWarehouseRow } = require('./helpers/common.helper');

function ok(res, data) {
    return res.json(Object.assign({ success: true }, data || {}));
}

function normalizeObjectIds(value) {
    var raw = Array.isArray(value) ? value : String(value || '').split(',');
    return raw
        .map(function(item) { return String(item || '').trim(); })
        .filter(function(id, index, ids) {
            return id && ids.indexOf(id) === index && mongoose.Types.ObjectId.isValid(id);
        })
        .map(function(id) { return new mongoose.Types.ObjectId(id); });
}


function renderDetail(res, view, data) {
    return new Promise(function(resolve, reject) {
        res.render(view, data, function(error, html) {
            if (error) return reject(error);
            resolve(html);
        });
    });
}

function escapeAttr(value) {
    return String(value || '').replace(/[&<>"']/g, function(ch) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
}

function buildWarehouseFormsHtml(storeId, warehouses) {
    var sid = escapeAttr(storeId);
    var html = '<form id="warehouseAddForm" method="post" action="/cua-hang/' + sid + '/warehouse/add"></form>';
    warehouses.forEach(function(warehouse) {
        var wid = escapeAttr(warehouse._id);
        html += '<form id="warehouseForm_' + wid + '" method="post" action="/cua-hang/' + sid + '/warehouse/' + wid + '/update"></form>';
        html += '<form id="warehouseDeleteForm_' + wid + '" method="post" action="/cua-hang/' + sid + '/warehouse/' + wid + '/delete"></form>';
    });
    return html;
}

exports.warehouseCounts = async function(req, res, next) {
    try {
        var ids = normalizeObjectIds(req.query && req.query.ids);
        if (!ids.length) return ok(res, { counts: {} });

        var rows = await Kho.aggregate([
            { $match: { cua_hang_id: { $in: ids } } },
            { $group: { _id: '$cua_hang_id', total: { $sum: 1 } } }
        ]);

        var counts = {};
        rows.forEach(function(row) {
            counts[String(row._id)] = Number(row.total || 0);
        });
        return ok(res, { counts: counts });
    } catch (error) {
        next(error);
    }
};

exports.detail = async function(req, res, next) {
    try {
        var storeId = String(req.params && req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(storeId)) {
            return res.status(400).json({ success: false, message: 'Cửa hàng không hợp lệ' });
        }

        var store = await CuaHang.findOne({ _id: storeId })
            .select('ma_cua_hang ten_cua_hang ma_so_thue dia_chi dia_chi_chi_tiet dia_chi_day_du tinh_thanh tinh_thanh_id phuong_xa phuong_xa_code sdt email ghi_chu trang_thai created_at updated_at')
            .lean();
        if (!store) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy cửa hàng' });
        }

        var warehouses = await Kho.find({ cua_hang_id: store._id })
            .select('ma_kho ten_kho dia_chi dia_chi_chi_tiet dia_chi_day_du phuong_xa tinh_thanh trang_thai created_at updated_at')
            .sort({ created_at: 1, ma_kho: 1 })
            .lean();

        var html = await renderDetail(res, 'cua-hang/_detail-panel', {
            selectedStore: store,
            warehouses: warehouses.map(enrichWarehouseRow),
            formatDate: formatDate
        });
        return ok(res, {
            html: html,
            forms_html: buildWarehouseFormsHtml(store._id, warehouses),
            store_id: String(store._id),
            warehouse_count: warehouses.length
        });
    } catch (error) {
        next(error);
    }
};

exports.provinceOptions = async function(req, res, next) {
    try {
        var rows = await CuaHang.distinct('tinh_thanh', {});
        var items = (rows || [])
            .map(function(city) { return String(city || '').trim(); })
            .filter(Boolean)
            .sort(function(a, b) { return a.localeCompare(b, 'vi'); });
        return ok(res, { items: items });
    } catch (error) {
        next(error);
    }
};

exports.warehouses = async function(req, res, next) {
    try {
        var storeId = String(req.params && req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(storeId)) {
            return res.status(400).json({ success: false, message: 'Cửa hàng không hợp lệ' });
        }

        var store = await CuaHang.findOne({ _id: storeId }).select('_id').lean();
        if (!store) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy cửa hàng' });
        }

        var warehouses = await Kho.find({ cua_hang_id: store._id })
            .select('ma_kho ten_kho dia_chi dia_chi_chi_tiet dia_chi_day_du phuong_xa tinh_thanh trang_thai created_at updated_at')
            .sort({ created_at: 1, ma_kho: 1 })
            .lean();
        var items = warehouses.map(enrichWarehouseRow).map(function(warehouse) {
            return {
                _id: String(warehouse._id),
                ma_kho: warehouse.ma_kho || '',
                ten_kho: warehouse.ten_kho || '',
                dia_chi: warehouse.dia_chi || '',
                dia_chi_chi_tiet: warehouse.dia_chi_chi_tiet || '',
                dia_chi_day_du: warehouse.dia_chi_day_du || '',
                phuong_xa: warehouse.phuong_xa || '',
                tinh_thanh: warehouse.tinh_thanh || '',
                trang_thai: warehouse.trang_thai || 'active',
                created_at: warehouse.created_at || null,
                created_at_text: formatDate(warehouse.created_at)
            };
        });
        return ok(res, { items: items, total: items.length });
    } catch (error) {
        next(error);
    }
};
