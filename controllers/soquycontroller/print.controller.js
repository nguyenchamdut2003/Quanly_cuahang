const pdfService = require('../../services/pdf.service');
const {
    buildReceiptPrintViewData,
    safePdfName,
    viewPath
} = require('../../services/receiptPrint.service');

async function renderReceiptPrint(req, res, next, viewName, title) {
    try {
        const data = await buildReceiptPrintViewData(req, title);
        if (!data) return res.status(404).send('Không tìm thấy phiếu thu/chi');
        return res.render(viewName, data);
    } catch (error) {
        next(error);
    }
}

async function renderReceiptPdf(req, res, next, viewName, title, filenamePrefix) {
    try {
        const data = await buildReceiptPrintViewData(req, title, { embeddedPrint: true });
        if (!data) return res.status(404).send('Không tìm thấy phiếu thu/chi');
        const html = await pdfService.renderViewToHtml(viewPath(viewName), data);
        const buffer = await pdfService.generatePdfFromHtml(html, {
            format: 'A4',
            printBackground: true,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safePdfName(filenamePrefix, data.receipt)}"`);
        return res.send(Buffer.from(buffer));
    } catch (error) {
        if (String(error.message || '').includes('puppeteer')) {
            return res.status(503).send('Chưa cài puppeteer. Dùng nút In hoặc Tải PDF qua trình duyệt (window.print).');
        }
        next(error);
    }
}

exports.printBundle = async function(req, res, next) {
    try {
        const data = await buildReceiptPrintViewData(req, 'In phiếu thu/chi');
        if (!data) return res.status(404).send('Không tìm thấy phiếu thu/chi');
        return res.render('so-quy/print-tong-hop', data);
    } catch (error) {
        next(error);
    }
};

exports.printReceipt = function(req, res, next) {
    return renderReceiptPrint(req, res, next, 'so-quy/print-phieu-thu-chi', 'In phiếu thu/chi');
};

exports.printRelatedDocs = function(req, res, next) {
    return renderReceiptPrint(req, res, next, 'so-quy/print-chung-tu-lien-quan', 'Bảng chứng từ liên quan');
};

exports.printReceiptPdf = function(req, res, next) {
    return renderReceiptPdf(req, res, next, 'so-quy/print-phieu-thu-chi', 'In phiếu thu/chi', 'phieu-thu-chi');
};

exports.printRelatedPdf = function(req, res, next) {
    return renderReceiptPdf(req, res, next, 'so-quy/print-chung-tu-lien-quan', 'Bang chung tu lien quan', 'chung-tu-lien-quan');
};
