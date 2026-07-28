const productExportService = require('../services/export/productExport.service');
const lotProfitExportService = require('../services/export/lotProfitExport.service');

module.exports = {
    exportExcel: productExportService.exportExcel,
    exportLotProfitReport: lotProfitExportService.exportLotProfitReport
};


