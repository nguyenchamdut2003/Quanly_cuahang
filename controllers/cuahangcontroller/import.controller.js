const { buildImportTemplateWorkbook } = require('./helpers/excel.helper');
const { parseStoreImportBuffer, validateImportRows, persistImportWithBestEffortTransaction } = require('./services/import.service');

const downloadImportTemplate = async function(req, res, next) {
    try {
        var workbook = await buildImportTemplateWorkbook();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="mau-nhap-cua-hang.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};

const importExcel = async function(req, res, next) {
    try {
        var file = req?.file;
        if (!file || !file.buffer || !file.buffer.length) {
            return res.redirect('/cua-hang?error=import_missing_file');
        }

        var fileName = String(file.originalname || '').toLowerCase();
        if (!/\.xlsx$/i.test(fileName)) {
            return res.redirect('/cua-hang?error=import_invalid_file_type');
        }

        var parsedImport = await parseStoreImportBuffer(file.buffer);
        if (!parsedImport.storeRows.length && !parsedImport.warehouseRows.length) {
            return res.redirect('/cua-hang?error=import_empty_file');
        }

        var importPlan = await validateImportRows(parsedImport);
        var persisted = await persistImportWithBestEffortTransaction(importPlan);
        var insertedStores = persisted.result.insertedStores;
        var insertedWarehouses = persisted.result.insertedWarehouses;

        if (insertedStores === 0 && insertedWarehouses === 0) {
            return res.redirect('/cua-hang?error=import_empty_file');
        }

        var successQuery = 'imported=' + insertedStores
            + '&import_label=' + encodeURIComponent('cửa hàng')
            + '&imported_kho=' + insertedWarehouses;
        if (!persisted.usedTransaction) {
            successQuery += '&import_warning=' + encodeURIComponent('MongoDB hiện không hỗ trợ transaction; file đã được validate toàn bộ trước khi ghi.');
        }

        res.redirect('/cua-hang?success=imported&' + successQuery);
    } catch (error) {
        if (error && error.code === 'import_invalid_headers') {
            return res.redirect('/cua-hang?error=import_invalid_headers');
        }
        if (error && error.code === 'import_invalid_rows') {
            return res.redirect('/cua-hang?error=' + encodeURIComponent(error.message || 'import_invalid_rows'));
        }
        if (error && error.code === 'import_empty_file') {
            return res.redirect('/cua-hang?error=import_empty_file');
        }

        next(error);
    }
};

module.exports = {
    downloadImportTemplate,
    importExcel
};
