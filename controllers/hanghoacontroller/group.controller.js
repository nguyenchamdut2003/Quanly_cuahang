const service = require('./services/productGroup.service');

exports.addGroup = function(req, res, next) {
    return service.addGroup(req, res, next);
};

exports.updateGroup = function(req, res, next) {
    return service.updateGroup(req, res, next);
};

exports.removeGroup = function(req, res, next) {
    return service.removeGroup(req, res, next);
};



