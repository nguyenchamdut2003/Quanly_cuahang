const service = require('./services/contractPrint.service');

exports.printContract = function(req, res, next) {
    return service.printContract(req, res, next);
};

exports.printContractPdf = function(req, res, next) {
    return service.printContractPdf(req, res, next);
};



