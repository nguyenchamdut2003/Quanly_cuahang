const service = require('./services/lot.service');

exports.apiLotProfitReport = function(req, res, next) {
    return service.apiLotProfitReport(req, res, next);
};



