const path = require('path');
const pdfService = require('../../services/pdf.service');
const previewService = require('./services/previewPrint.service');

const PREVIEW_EXPIRED_MESSAGE = 'Phiếu xem trước đã hết hạn. Quay lại màn Kiểm kho và bấm in lại.';

exports.postPreviewTonHeThong = async function(req, res, next) {
    try {
        const result = await previewService.saveTonPreview({ body: req.body || {}, session: req.session });
        return res.status(result.status).json(result.body);
    } catch (error) {
        next(error);
    }
};

exports.getInTonHeThongPreviewPdf = async function(req, res, next) {
    try {
        const data = await previewService.loadTonPreview({ session: req.session, user: req.user });
        if (!data) return res.status(410).send(PREVIEW_EXPIRED_MESSAGE);
        const viewPath = path.join(__dirname, '..', '..', 'views', 'kiem-kho', 'print-ton-he-thong.ejs');
        const locals = { title: 'Phiếu số lượng tồn hiện tại', embeddedPrint: false, ...data };
        const html = await pdfService.renderViewToHtml(viewPath, locals);
        const buffer = await pdfService.generatePdfFromHtml(html, { format: 'A4', printBackground: true, margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="kiem-kho-ton-he-thong.pdf"');
        return res.send(Buffer.from(buffer));
    } catch (error) {
        next(error);
    }
};

exports.postPreviewGiaTriKho = async function(req, res, next) {
    try {
        const result = await previewService.saveGiaTriPreview({ body: req.body || {}, session: req.session });
        return res.status(result.status).json(result.body);
    } catch (error) {
        next(error);
    }
};

exports.getInGiaTriKhoPreviewPdf = async function(req, res, next) {
    try {
        const data = await previewService.loadGiaTriPreview({ session: req.session, user: req.user });
        if (!data) return res.status(410).send(PREVIEW_EXPIRED_MESSAGE);
        const viewPath = path.join(__dirname, '..', '..', 'views', 'kiem-kho', 'print-gia-tri-kho.ejs');
        const locals = { title: 'Phiếu giá trị kho', embeddedPrint: false, ...data };
        const html = await pdfService.renderViewToHtml(viewPath, locals);
        const buffer = await pdfService.generatePdfFromHtml(html, { format: 'A4', printBackground: true, margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="kiem-kho-gia-tri-kho.pdf"');
        return res.send(Buffer.from(buffer));
    } catch (error) {
        next(error);
    }
};

exports.getInGiaTriKhoPreview = async function(req, res, next) {
    try {
        const data = await previewService.loadGiaTriPreview({ session: req.session, user: req.user });
        if (!data) return res.status(410).send(PREVIEW_EXPIRED_MESSAGE);
        res.render('kiem-kho/print-gia-tri-kho', { title: 'Phiếu giá trị kho', embeddedPrint: String(req.query.embed || '') === '1', ...data });
    } catch (error) {
        next(error);
    }
};

exports.getInTonHeThongPreview = async function(req, res, next) {
    try {
        const data = await previewService.loadTonPreview({ session: req.session, user: req.user });
        if (!data) return res.status(410).send(PREVIEW_EXPIRED_MESSAGE);
        res.render('kiem-kho/print-ton-he-thong', { title: 'Phiếu số lượng tồn hiện tại', embeddedPrint: String(req.query.embed || '') === '1', ...data });
    } catch (error) {
        next(error);
    }
};
