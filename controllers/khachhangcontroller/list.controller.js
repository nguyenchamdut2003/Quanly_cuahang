var querystring = require('querystring');
var listService = require('./services/list.service');

exports.index = async function(req, res, next) {
    try {
        var requestQuery = req?.query || {};
        if (Object.prototype.hasOwnProperty.call(requestQuery, 'customer')) {
            var redirectQuery = Object.assign({}, requestQuery);
            delete redirectQuery.customer;
            var qsStr = querystring.stringify(redirectQuery);
            return res.redirect(302, '/khach-hang' + (qsStr ? '?' + qsStr : ''));
        }

        var locals = await listService.loadCustomerListPage({
            query: requestQuery,
            user: req.user
        });
        res.render('khach-hang/index', locals);
    } catch (error) {
        next(error);
    }
};
