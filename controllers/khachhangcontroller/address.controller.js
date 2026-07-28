var {
    normalizeIdParam,
    buildCustomerReturnUrl,
    appendQueryParam
} = require('./helpers/common.helper');
var addressService = require('./services/address.service');

function addressReturnUrl(customerId, body, key, value) {
    return appendQueryParam(buildCustomerReturnUrl(customerId, body?.returnQuery), key, value);
}

exports.addAddress = async function(req, res, next) {
    try {
        var customerId = normalizeIdParam(req?.params?.id);
        if (!customerId) return res.redirect('/khach-hang?error=invalid_customer');
        await addressService.addAddress({ customerId: customerId, body: req?.body });
        res.redirect(addressReturnUrl(customerId, req?.body, 'success', 'created'));
    } catch (error) {
        var customerId = normalizeIdParam(req?.params?.id);
        if (error && error.code === 'missing_address_data') {
            return res.redirect(addressReturnUrl(customerId, req?.body, 'error', 'missing_address_data'));
        }
        if (error && error.code === 11000) return res.redirect('/khach-hang?error=duplicate_address_code');
        next(error);
    }
};

exports.updateAddress = async function(req, res, next) {
    try {
        var customerId = normalizeIdParam(req?.params?.id);
        var addressId = normalizeIdParam(req?.params?.addressId);
        if (!customerId || !addressId) return res.redirect('/khach-hang?error=invalid_address');
        await addressService.updateAddress({ customerId: customerId, addressId: addressId, body: req?.body });
        res.redirect(addressReturnUrl(customerId, req?.body, 'success', 'updated'));
    } catch (error) {
        var customerId = normalizeIdParam(req?.params?.id);
        if (error && error.code === 'missing_address_data') {
            return res.redirect(addressReturnUrl(customerId, req?.body, 'error', 'missing_address_data'));
        }
        if (error && error.code === 11000) return res.redirect('/khach-hang?error=duplicate_address_code');
        next(error);
    }
};

exports.removeAddress = async function(req, res, next) {
    try {
        var customerId = normalizeIdParam(req?.params?.id);
        var addressId = normalizeIdParam(req?.params?.addressId);
        if (!customerId || !addressId) return res.redirect('/khach-hang?error=invalid_address');
        await addressService.removeAddress({ customerId: customerId, addressId: addressId });
        res.redirect(addressReturnUrl(customerId, req?.body, 'success', 'deleted'));
    } catch (error) {
        next(error);
    }
};
