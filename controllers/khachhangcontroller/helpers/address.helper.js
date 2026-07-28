var { LoaiDiaChiKhachHang } = require('../../../models/kiot.model');
var { normalizeAddress } = require('../../../utils/address');

function normalizeImportLookupText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function slugifyAddressType(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase() || 'loai_dia_chi';
}

async function resolveImportAddressType(text, typeState) {
    typeState = typeState || {};
    var raw = String(text || '').trim();
    var key = normalizeImportLookupText(raw || 'Khác');

    if (typeState.lookup[key]) {
        return typeState.lookup[key].ma_loai;
    }

    var tenLoai = raw || 'Khác';
    var baseCode = raw ? slugifyAddressType(raw) : 'khac';
    var maLoai = baseCode;
    var suffix = 2;

    while (typeState.codes[maLoai]) {
        maLoai = baseCode + '_' + suffix;
        suffix += 1;
    }

    var created = await LoaiDiaChiKhachHang.create({
        ma_loai: maLoai,
        ten_loai: tenLoai,
        trang_thai: 'active'
    });

    var type = created.toObject ? created.toObject() : created;
    typeState.codes[maLoai] = true;
    typeState.lookup[normalizeImportLookupText(maLoai)] = type;
    typeState.lookup[normalizeImportLookupText(tenLoai)] = type;
    return maLoai;
}

async function buildImportAddressTypeState() {
    var types = await LoaiDiaChiKhachHang.find().lean();
    var state = {
        lookup: {},
        codes: {}
    };

    types.forEach(function(type) {
        if (!type || !type.ma_loai) return;
        state.codes[type.ma_loai] = true;
        state.lookup[normalizeImportLookupText(type.ma_loai)] = type;
        if (type.ten_loai) {
            state.lookup[normalizeImportLookupText(type.ten_loai)] = type;
        }
    });

    if (!state.lookup[normalizeImportLookupText('khac')] && !state.lookup[normalizeImportLookupText('Khác')]) {
        var created = await LoaiDiaChiKhachHang.create({ ma_loai: 'khac', ten_loai: 'Khác', trang_thai: 'active' });
        var type = created.toObject ? created.toObject() : created;
        state.codes.khac = true;
        state.lookup[normalizeImportLookupText('khac')] = type;
        state.lookup[normalizeImportLookupText('Khác')] = type;
    }

    return state;
}

function normalizeAddressPayload(body) {
    body = body || {};
    var address = normalizeAddress(body);
    return {
        ma_dia_chi: String(body.ma_dia_chi || '').trim(),
        ten_nguoi_nhan: String(body.ten_nguoi_nhan || '').trim(),
        sdt_nguoi_nhan: String(body.sdt_nguoi_nhan || '').trim(),
        so_nha: address.dia_chi_chi_tiet,
        dia_chi_chi_tiet: address.dia_chi_chi_tiet,
        dia_chi_day_du: address.dia_chi_day_du,
        tinh_thanh: address.tinh_thanh,
        tinh_thanh_id: address.tinh_thanh_id,
        quan_huyen: address.quan_huyen,
        quan_huyen_id: address.quan_huyen_id,
        phuong_xa: address.phuong_xa,
        phuong_xa_code: address.phuong_xa_code,
        loai_dia_chi: String(body.loai_dia_chi || '').trim(),
        ghi_chu: String(body.ghi_chu || body.ghi_chu_dia_chi || '').trim(),
        mac_dinh: body.mac_dinh === 'true' || body.mac_dinh === true || body.mac_dinh === 'on'
    };
}

function buildCustomerReturnUrl(customerId, returnQueryRaw) {
    void customerId;
    var returnQuery = String(returnQueryRaw || '').trim().replace(/^\?/, '');
    var params = returnQuery ? returnQuery.split('&').filter(Boolean) : [];
    var paramsWithoutCustomer = params.filter(function(item) {
        return item.indexOf('customer=') !== 0;
    });
    return '/khach-hang' + (paramsWithoutCustomer.length ? '?' + paramsWithoutCustomer.join('&') : '');
}

function appendQueryParam(url, key, value) {
    var separator = url.indexOf('?') === -1 ? '?' : '&';
    return url + separator + encodeURIComponent(key) + '=' + encodeURIComponent(value);
}


module.exports = {
    normalizeAddressPayload,
    normalizeImportLookupText,
    slugifyAddressType,
    resolveImportAddressType,
    buildImportAddressTypeState
};

