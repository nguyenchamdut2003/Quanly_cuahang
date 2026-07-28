const service = require('./services/export/productExport.service');

exports.exportExcel = function(req, res, next) {
    return service.exportExcel(req, res, next);
};


const lotProfitExportService = require('./services/export/lotProfitExport.service');

exports.exportLotProfitReport = function(req, res, next) {
    return lotProfitExportService.exportLotProfitReport(req, res, next);
};


