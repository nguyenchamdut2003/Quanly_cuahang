const service = require('./services/productList.service');

exports.index = function(req, res, next) {
    return service.index(req, res, next);
};

exports.tableMetrics = function(req, res, next) {
    return service.tableMetrics(req, res, next);
};

exports.filterOptions = function(req, res, next) {
    return service.filterOptions(req, res, next);
};

