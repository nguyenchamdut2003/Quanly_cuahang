const service = require('./services/product.service');

exports.add = function(req, res, next) {
    return service.add(req, res, next);
};

exports.update = function(req, res, next) {
    return service.update(req, res, next);
};

exports.remove = function(req, res, next) {
    return service.remove(req, res, next);
};

exports.removeSelected = function(req, res, next) {
    return service.removeSelected(req, res, next);
};


