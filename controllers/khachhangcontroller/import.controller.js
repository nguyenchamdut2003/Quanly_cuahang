var importService = require('./services/import.service');

exports.downloadImportTemplate = async function(req, res, next) {
    try {
        var workbook = await importService.buildImportTemplateWorkbook();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="mau-nhap-khach-hang.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};

exports.importExcel = async function(req, res, next) {
    try {
        var file = req?.file;
        if (!file || !file.buffer || !file.buffer.length) {
            return res.redirect('/khach-hang?error=import_missing_file');
        }
        var redirectUrl = await importService.importExcelFile({
            file: file,
            user: req.user
        });
        return res.redirect(redirectUrl);
    } catch (error) {
        next(error);
    }
};
