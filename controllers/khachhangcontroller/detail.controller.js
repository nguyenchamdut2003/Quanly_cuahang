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

exports.redirectDetail = async function(req, res) {
    return res.redirect('/khach-hang#c-' + encodeURIComponent(req.params.id));
};
