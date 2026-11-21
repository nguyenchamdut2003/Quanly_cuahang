var { KhachHang, DiaChiKhachHang } = require('../../../models/kiot.model');
var {
    normalizeCustomerPayload,
    finalizeCustomerPayload,
    validateCustomerPayload
} = require('../helpers/customer.helper');
var { normalizeAddressPayload } = require('../helpers/address.helper');
var { makeCustomerCode, makeAddressCode } = require('../helpers/code.helper');

function applyCustomerTypeFields(payload) {
    if (payload.loai_khach_hang === 'ca_nhan') {
        payload.ten_cong_ty = '';
        payload.ma_so_thue = '';
        payload.nguoi_dai_dien = '';
        payload.chuc_vu_nguoi_dai_dien = '';
    } else {
        payload.ten_ca_nhan = '';
        payload.mst = '';
        payload.ngay_sinh = null;
    }
}

function hasAddressData(addressPayload) {
    return addressPayload.ten_nguoi_nhan
        || addressPayload.sdt_nguoi_nhan
        || addressPayload.dia_chi_day_du
        || addressPayload.dia_chi_chi_tiet
        || addressPayload.tinh_thanh
        || addressPayload.phuong_xa;
}

async function createCustomer(options) {
    options = options || {};
    var payload = normalizeCustomerPayload(options.body);
    var validationError = validateCustomerPayload(payload);
    if (validationError) {
        var error = new Error(validationError);
        error.code = validationError;
        throw error;
    }

    applyCustomerTypeFields(payload);
    payload.ma_khach_hang = await makeCustomerCode();
    if (!payload.nhom_khach_hang_id) delete payload.nhom_khach_hang_id;
    if (options.user && options.user._id) payload.nguoi_tao_id = options.user._id;
    finalizeCustomerPayload(payload);

    var customer = await KhachHang.create(payload);
    var addressPayload = normalizeAddressPayload(options.body);
    if (hasAddressData(addressPayload)) {
        addressPayload.ma_dia_chi = await makeAddressCode();
        if (!addressPayload.loai_dia_chi) addressPayload.loai_dia_chi = 'khac';
        addressPayload.khach_hang_id = customer._id;
        await DiaChiKhachHang.create(addressPayload);
    }
    return customer;
}

async function updateCustomer(options) {
    options = options || {};
    var customerId = options.customerId;
    var payload = normalizeCustomerPayload(options.body);
    var validationError = validateCustomerPayload(payload);
    if (validationError) {
        var error = new Error(validationError);
        error.code = validationError;
        throw error;
    }

    applyCustomerTypeFields(payload);
    delete payload.ma_khach_hang;

    var existingCustomer = await KhachHang.findOne({ _id: customerId }).lean();
    if (!existingCustomer) {
        var notFound = new Error('invalid_customer');
        notFound.code = 'invalid_customer';
        throw notFound;
    }
    if (!Object.prototype.hasOwnProperty.call(options.body || {}, 'trang_thai')) {
        payload.trang_thai = existingCustomer.trang_thai || 'active';
    }
    if (!Object.prototype.hasOwnProperty.call(options.body || {}, 'nhom_khach_hang_id')) {
        payload.nhom_khach_hang_id = existingCustomer.nhom_khach_hang_id || null;
    }
    finalizeCustomerPayload(payload, existingCustomer);
    await KhachHang.findByIdAndUpdate(customerId, { $set: payload }, { runValidators: true });

    var addressPayload = normalizeAddressPayload(options.body);
    if (hasAddressData(addressPayload)) {
        if (!addressPayload.loai_dia_chi) addressPayload.loai_dia_chi = 'khac';
        addressPayload.khach_hang_id = customerId;
        if (addressPayload.ma_dia_chi) {
            var existingAddress = await DiaChiKhachHang.findOne({ ma_dia_chi: addressPayload.ma_dia_chi, khach_hang_id: customerId });
            if (existingAddress) {
                if (addressPayload.mac_dinh) {
                    await DiaChiKhachHang.updateMany({ khach_hang_id: customerId, _id: { $ne: existingAddress._id } }, { $set: { mac_dinh: false } });
                }
                await DiaChiKhachHang.findByIdAndUpdate(existingAddress._id, addressPayload, { runValidators: true });
            } else {
                if (addressPayload.mac_dinh) {
                    await DiaChiKhachHang.updateMany({ khach_hang_id: customerId }, { $set: { mac_dinh: false } });
                }
                await DiaChiKhachHang.create(addressPayload);
            }
        } else {
            addressPayload.ma_dia_chi = await makeAddressCode();
            if (addressPayload.mac_dinh) {
                await DiaChiKhachHang.updateMany({ khach_hang_id: customerId }, { $set: { mac_dinh: false } });
            }
            await DiaChiKhachHang.create(addressPayload);
        }
    }
}

async function removeCustomer(customerId) {
    throw Object.assign(new Error('Chức năng xóa/đưa vào thùng rác đã được tắt.'), { statusCode: 410 });
}

async function removeCustomerWithContext(customerId, context) {
    throw Object.assign(new Error('Chức năng xóa/đưa vào thùng rác đã được tắt.'), { statusCode: 410 });
}

async function removeCustomers(ids, context) {
    var results = [];
    for (var i = 0; i < ids.length; i += 1) {
        results.push(await softDeleteCustomer(ids[i], context));
    }
    return results;
}

module.exports = {
    createCustomer,
    updateCustomer,
    removeCustomer,
    removeCustomerWithContext,
    removeCustomers
};
