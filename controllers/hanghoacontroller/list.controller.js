const service = require('./services/productList.service');

exports.index = function(req, res, next) {
    return service.index(req, res, next);
};



