const service = require('./services/allocation.service');

exports.allocationPage = function(req, res, next) {
    return service.allocationPage(req, res, next);
};

exports.submitAllocation = function(req, res, next) {
    return service.submitAllocation(req, res, next);
};



