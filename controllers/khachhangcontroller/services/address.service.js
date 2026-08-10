var { DiaChiKhachHang } = require('../../../models/kiot.model');
var { normalizeAddressPayload } = require('../helpers/address.helper');
var { makeAddressCode } = require('../helpers/code.helper');

function hasRequiredAddressData(payload) {
    return payload.ten_nguoi_nhan || payload.sdt_nguoi_nhan || payload.dia_chi_day_du;
}

async function addAddress(options) {
    options = options || {};
    var payload = normalizeAddressPayload(options.body);
    if (!hasRequiredAddressData(payload)) {
        var error = new Error('missing_address_data');
        error.code = 'missing_address_data';
        throw error;
    }
    if (!payload.ma_dia_chi) payload.ma_dia_chi = await makeAddressCode();
    if (!payload.loai_dia_chi) payload.loai_dia_chi = 'khac';
    payload.khach_hang_id = options.customerId;

    if (payload.mac_dinh) {
        await DiaChiKhachHang.updateMany({ khach_hang_id: options.customerId }, { $set: { mac_dinh: false } });
    }
    return await DiaChiKhachHang.create(payload);
}

async function updateAddress(options) {
    options = options || {};
    var payload = normalizeAddressPayload(options.body);
    if (!hasRequiredAddressData(payload)) {
        var error = new Error('missing_address_data');
        error.code = 'missing_address_data';
        throw error;
    }
    if (!payload.ma_dia_chi) delete payload.ma_dia_chi;
    if (!payload.loai_dia_chi) payload.loai_dia_chi = 'khac';

    if (payload.mac_dinh) {
        await DiaChiKhachHang.updateMany(
            { khach_hang_id: options.customerId, _id: { $ne: options.addressId } },
            { $set: { mac_dinh: false } }
        );
    }

    await DiaChiKhachHang.findOneAndUpdate(
        { _id: options.addressId, khach_hang_id: options.customerId },
        payload,
        { runValidators: true }
    );
}

async function removeAddress(options) {
    await DiaChiKhachHang.findOneAndUpdate(
        { _id: options.addressId, khach_hang_id: options.customerId },
        { $set: { trang_thai: 'inactive', mac_dinh: false } },
        { runValidators: true }
    );
}

module.exports = {
    addAddress,
    updateAddress,
    removeAddress
};
