const { buildFullAddress, normalizeAddress } = require('../../../utils/address');

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

function normalizePage(value) {
    var page = parseInt(value, 10);
    return Number.isFinite(page) && page > 0 ? page : 1;
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

function buildStoreAddress(store) {
    return store.dia_chi_day_du || buildFullAddress(store) || store.dia_chi || '';
}

function normalizeStorePayload(body) {
    body = body || {};
    var address = normalizeAddress(body);
    return {
        ma_cua_hang: String(body.ma_cua_hang || '').trim(),
        ten_cua_hang: String(body.ten_cua_hang || '').trim(),
        ma_so_thue: String(body.ma_so_thue || '').trim(),
        dia_chi_chi_tiet: address.dia_chi_chi_tiet,
        tinh_thanh: address.tinh_thanh,
        tinh_thanh_id: address.tinh_thanh_id,
        phuong_xa: address.phuong_xa,
        phuong_xa_code: address.phuong_xa_code,
        dia_chi_day_du: address.dia_chi_day_du,
        dia_chi: address.dia_chi_day_du,
        sdt: String(body.sdt || '').trim(),
        email: String(body.email || '').trim(),
        trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
    };
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

module.exports = {
    formatDate,
    normalizeIdParam,
    normalizeIdList,
    normalizePage,
    normalizeStorePayload,
    normalizeWarehousePayload,
    enrichWarehouseRow,
    buildStoreAddress
};
