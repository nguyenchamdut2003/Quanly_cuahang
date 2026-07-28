const csvExportService = require('./services/export/csvExport.service');
const excelExportService = require('./services/export/excelExport.service');

function sendCsv(res, filename, content) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
}

exports.getExportCsv = async function(req, res, next) {
    try {
        const result = await csvExportService.buildKiemKhoListCsv(req.query || {});
        return sendCsv(res, result.filename, result.content);
    } catch (error) {
        next(error);
    }
};

exports.postExportExcel = async function(req, res, next) {
    try {
        const columns = excelExportService.resolveKiemKhoExportColumns(req.body.columns);
        if (!columns.length) return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất 1 cột để xuất.' });
        const { tickets, detailMap } = await excelExportService.loadKiemKhoExportData(req.body || {});
        const { workbook, filename } = await excelExportService.buildKiemKhoWorkbook({ tickets, detailMap, columns });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};

exports.getIdExportCsv = async function(req, res, next) {
    try {
        const result = await csvExportService.buildKiemKhoDetailCsv(req.params.id);
        return sendCsv(res, result.filename, result.content);
    } catch (error) {
        if (error.status || error.statusCode) return res.status(error.status || error.statusCode).send(error.message);
        next(error);
    }
};
