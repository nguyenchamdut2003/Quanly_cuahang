var { normalizeIdParam, normalizeIdList } = require('./helpers/common.helper');
var customerService = require('./services/customer.service');

exports.add = async function(req, res, next) {
    try {
        var customer = await customerService.createCustomer({ body: req?.body, user: req.user });
        res.redirect('/khach-hang?success=created#c-' + String(customer._id));
    } catch (error) {
        console.error("LỖI KHI TẠO KHÁCH HÀNG:", error);
        if (error && error.code === 11000) {
            return res.redirect('/khach-hang?mode=create&error=duplicate_code');
        }
        if (error && error.code) {
            return res.redirect('/khach-hang?mode=create&error=' + error.code);
        }
        next(error);
    }
};

exports.update = async function(req, res, next) {
    try {
        var customerId = normalizeIdParam(req?.params?.id);
        if (!customerId) return res.redirect('/khach-hang?error=invalid_customer');
        await customerService.updateCustomer({ customerId: customerId, body: req?.body });
        res.redirect('/khach-hang?success=updated#c-' + customerId);
    } catch (error) {
        var customerId = normalizeIdParam(req?.params?.id);
        if (error && error.code === 11000) {
            return res.redirect('/khach-hang?error=duplicate_code');
        }
        if (error && error.code) {
            return res.redirect('/khach-hang?error=' + encodeURIComponent(error.code) + '#c-' + customerId);
        }
        next(error);
    }
};

exports.remove = async function(req, res, next) {
    try {
        var customerId = normalizeIdParam(req?.params?.id);
        if (!customerId) return res.redirect('/khach-hang?error=invalid_customer');
        await customerService.removeCustomer(customerId);
        res.redirect('/khach-hang?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.removeSelected = async function(req, res, next) {
    try {
        var ids = normalizeIdList(req?.body?.ids);
        if (ids.length === 0) return res.redirect('/khach-hang?error=no_selection');
        await customerService.removeCustomers(ids);
        res.redirect('/khach-hang?success=deleted');
    } catch (error) {
        next(error);
    }
};
