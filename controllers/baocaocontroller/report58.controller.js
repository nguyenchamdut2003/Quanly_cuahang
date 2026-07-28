const report58Excel = require('../../services/report58Excel.service');
const { getSalesRange } = require('./helpers/date.helper');
const { normalizeReport58Query } = require('./helpers/query.helper');
const { REPORT_58_MAU, resolveReport58Mau, enrichReport58Data, buildReport58PdfBuffer } = require('./builders/report58.builder');

const get58ExportCsv = async (req, res, next) => {
    try {
        const mau = resolveReport58Mau(req.query.mau);
        const range = getSalesRange(req.query || {});
        const store = res.locals.currentStore || null;
        const workbook = await report58Excel.exportMauExcel(mau, req.query || {}, store, range);
        const sheet = workbook.getWorksheet(mau);
        const csv = await report58Excel.sheetToCsvBuffer(sheet);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="bao-cao-58-${mau}.csv"`);
        res.send(csv);
    } catch (error) {
        next(error);
    }
};

const get58ExportXlsx = async (req, res, next) => {
    try {
        const range = getSalesRange(req.query || {});
        const store = res.locals.currentStore || null;
        const exportAll = req.query.all === '1' || req.query.all === 'true';
        const workbook = exportAll
            ? await report58Excel.exportAllMauExcel(req.query || {}, store, range)
            : await report58Excel.exportMauExcel(
                resolveReport58Mau(req.query.mau),
                req.query || {},
                store,
                range
            );
        const buffer = await report58Excel.workbookToBuffer(workbook);
        const filename = exportAll
            ? 'TT58-2026-bo-mau-excel.xlsx'
            : `${resolveReport58Mau(req.query.mau)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(Buffer.from(buffer));
    } catch (error) {
        next(error);
    }
};

const get58PreviewPdf = async (req, res, next) => {
    try {
        const mau = resolveReport58Mau(req.query.mau);
        if (!REPORT_58_MAU.includes(mau)) {
            return res.status(404).send('Không tìm thấy mẫu báo cáo.');
        }
        const { buffer } = await buildReport58PdfBuffer(req.query || {}, res.locals.currentStore || null);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${mau}-preview.pdf"`);
        return res.send(Buffer.from(buffer));
    } catch (error) {
        next(error);
    }
};

const get58PreviewExcel = async (req, res, next) => {
    try {
        const mau = resolveReport58Mau(req.query.mau);
        const range = getSalesRange(req.query || {});
        const store = res.locals.currentStore || null;
        const workbook = await report58Excel.exportMauExcel(mau, req.query || {}, store, range);
        const sheet = workbook.getWorksheet(mau);
        const preview = report58Excel.worksheetToPreviewModel(sheet);
        res.render('bao-cao/58-excel-preview', {
            mau,
            preview
        });
    } catch (error) {
        next(error);
    }
};

const get58ExportPdf = async (req, res, next) => {
    try {
        const mau = resolveReport58Mau(req.query.mau);
        if (REPORT_58_MAU.includes(mau)) {
            const { buffer } = await buildReport58PdfBuffer(req.query || {}, res.locals.currentStore || null);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${mau}.pdf"`);
            return res.send(Buffer.from(buffer));
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="bao-cao-58-${mau}.txt"`);
        res.send(`Mẫu PDF cho ${mau} sẽ được bổ sung sau khi nhận file mẫu.\n`);
    } catch (error) {
        next(error);
    }
};

const get58 = async (req, res, next) => {
    try {
        const query = normalizeReport58Query(req.query || {});
        const data = await enrichReport58Data(query, res.locals.currentStore || null);
        data.view = query.view === 'excel' ? 'excel' : 'pdf';
        data.query = query;
        res.render('bao-cao/58', data);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    get58,
    get58ExportCsv,
    get58ExportXlsx,
    get58PreviewPdf,
    get58PreviewExcel,
    get58ExportPdf
};
