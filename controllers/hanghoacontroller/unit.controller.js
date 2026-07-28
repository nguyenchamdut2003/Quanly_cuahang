const service = require('./services/unit.service');

exports.addUnit = function(req, res, next) {
    return service.addUnit(req, res, next);
};

exports.updateUnit = function(req, res, next) {
    return service.updateUnit(req, res, next);
};

exports.removeUnit = function(req, res, next) {
    return service.removeUnit(req, res, next);
};



