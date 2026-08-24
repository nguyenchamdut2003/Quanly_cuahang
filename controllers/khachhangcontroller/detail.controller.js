var detailService = require('./services/detail.service');

exports.apiCustomerDetail = async function(req, res, next) {
    try {
        var ctx = await detailService.loadCustomerDetail({
            customerId: req.params.id,
            query: req.query || {}
        });
        if (!ctx) {
            return res.status(404).type('html').send('<div class="kv-detail-panel product-detail kv-detail-error"><p>Không tìm thấy khách hàng.</p></div>');
        }
        res.render('khach-hang/_detail-panel', ctx);
    } catch (err) {
        next(err);
    }
};

async function renderCustomerTab(req, res, next, loader, viewName) {
    try {
        var ctx = await loader({
            customerId: req.params.id,
            query: req.query || {},
            req: req
        });
        if (!ctx) {
            return res.status(404).type('html').send('<div class="empty-cell">Không tìm thấy khách hàng.</div>');
        }
        res.render(viewName, ctx);
    } catch (err) {
        next(err);
    }
}

exports.apiCustomerAddresses = function(req, res, next) {
    return renderCustomerTab(req, res, next, detailService.loadCustomerAddressesTab, 'khach-hang/partials/_tab-addresses');
};

exports.apiCustomerOrders = function(req, res, next) {
    return renderCustomerTab(req, res, next, detailService.loadCustomerOrdersTab, 'khach-hang/partials/_tab-orders');
};

exports.apiCustomerInvoices = function(req, res, next) {
    return renderCustomerTab(req, res, next, detailService.loadCustomerInvoicesTab, 'khach-hang/partials/_tab-invoices');
};

exports.apiCustomerReturns = function(req, res, next) {
    return renderCustomerTab(req, res, next, detailService.loadCustomerReturnsTab, 'khach-hang/partials/_tab-returns');
};

exports.apiCustomerVatChua = function(req, res, next) {
    return renderCustomerTab(req, res, next, detailService.loadCustomerVatChuaTab, 'khach-hang/partials/_tab-vat-chua');
};

exports.apiCustomerDebts = function(req, res, next) {
    return renderCustomerTab(req, res, next, detailService.loadCustomerDebtsTab, 'khach-hang/partials/_tab-debts');
};

exports.redirectDetail = async function(req, res) {
    return res.redirect('/khach-hang#c-' + encodeURIComponent(req.params.id));
};
