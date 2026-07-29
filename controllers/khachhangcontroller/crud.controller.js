var { normalizeIdParam, normalizeIdList, shouldRespondJson } = require('./helpers/common.helper');
var customerService = require('./services/customer.service');

function deleteContext(req, res) {
    return {
        user: req.user,
        session: req.session,
        currentStore: res.locals && res.locals.currentStore
    };
}

function sendDeleteError(req, res, error) {
    var status = error.statusCode || error.status || 500;
    if (shouldRespondJson(req)) {
        return res.status(status).json({
            success: false,
            message: error.message || 'Không xóa được khách hàng.',
            deleteCheck: error.deleteCheck
        });
    }
    if (status === 404) return res.redirect('/khach-hang?error=invalid_customer');
    return res.redirect('/khach-hang?error=delete_failed');
}

exports.deleteCheck = async function(req, res, next) {
    return res.status(410).json({ success: false, message: 'Chức năng xóa/đưa vào thùng rác đã được tắt.' });
};

exports.add = async function(req, res, next) {
    try {
        var customer = await customerService.createCustomer({ body: req?.body, user: req.user });
        res.redirect('/khach-hang?success=created#c-' + String(customer._id));
    } catch (error) {
        console.error('LỖI KHI TẠO KHÁCH HÀNG:', error);
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
    if (shouldRespondJson(req)) return res.status(410).json({ success: false, message: 'Chức năng xóa/đưa vào thùng rác đã được tắt.' });
    return res.redirect('/khach-hang?error=delete_disabled');
};

exports.removeSelected = async function(req, res, next) {
    if (shouldRespondJson(req)) return res.status(410).json({ success: false, message: 'Chức năng xóa/đưa vào thùng rác đã được tắt.' });
    return res.redirect('/khach-hang?error=delete_disabled');
};
