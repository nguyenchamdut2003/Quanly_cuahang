const service = require('./services/productDetail.service');

exports.apiProductDetail = function(req, res, next) {
    return service.apiProductDetail(req, res, next);
};

exports.apiUpdateProductNotes = function(req, res, next) {
    return service.apiUpdateProductNotes(req, res, next);
};

exports.apiProductCard = function(req, res, next) {
    return service.apiProductCard(req, res, next);
};

exports.apiProductStock = function(req, res, next) {
    return service.apiProductStock(req, res, next);
};

exports.apiProductLots = function(req, res, next) {
    return service.apiProductLots(req, res, next);
};

exports.redirectDetail = function(req, res, next) {
    return service.redirectDetail(req, res, next);
};



