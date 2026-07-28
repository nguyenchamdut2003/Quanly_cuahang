const path = require('path');
const pdfService = require('../../../services/pdf.service');
const report58Excel = require('../../../services/report58Excel.service');
const report58Data = require('../../../services/report58Data.service');
const report58Pdf = require('../../../services/report58Pdf.service');
const { getSalesRange } = require('../helpers/date.helper');
const { normalizeReport58Query } = require('../helpers/query.helper');
const reportTitles = require('../helpers/reportTitles');

const REPORT_58_MAU = report58Excel.REPORT_58_MAU;

function resolveReport58Mau(value) {
    const mau = String(value || '').trim();
    return REPORT_58_MAU.includes(mau) ? mau : REPORT_58_MAU[0];
}

function buildReport58ViewData(query = {}, extras = {}) {
    const range = getSalesRange(query);
    const mau = resolveReport58Mau(query.mau);
    const store = extras.store || null;
    const year = query.year || (range.to ? String(range.to).slice(0, 4) : String(new Date().getFullYear()));
    return {
        title: reportTitles['58'],
        heading: reportTitles['58'],
        reportType: '58',
        range,
        mau,
        mauList: REPORT_58_MAU,
        generatedAt: new Date(),
        store,
        storeName: store?.ten_cua_hang || '',
        storeAddress: store?.dia_chi_day_du || [
            store?.dia_chi_chi_tiet,
            store?.phuong_xa,
            store?.tinh_thanh
        ].filter(Boolean).join(', '),
        year,
        donViTinh: query.don_vi_tinh || 'Đồng',
        s2aData: extras.s2aData || {},
        s2cData: extras.s2cData || {},
        s2dFilters: extras.s2dFilters || {},
        voucherFilters: extras.voucherFilters || {}
    };
}

async function buildInvoiceLedgerViewData(query = {}, store = null) {
    const range = getSalesRange(query);
    const rows = await report58Excel.fetchInvoiceLedgerRows({ range }, store);
    const detailRows = rows.map(row => ({
        so_hieu: row.so_chung_tu,
        ngay_thang: row.ngay ? new Date(row.ngay).toLocaleDateString('vi-VN') : '',
        dien_giai: row.dien_giai,
        so_tien: Number(row.tong_thanh_toan || 0),
        doanh_thu: Number(row.doanh_thu || 0),
        thue_gtgt: Number(row.thue_gtgt || 0),
        ghi_chu: row.ghi_chu || ''
    }));
    const totals = report58Excel.sumLedgerRows(rows);
    return {
        detailRows,
        ledgerRows: rows,
        totals,
        tongCong1: totals.tong_thanh_toan
    };
}

async function enrichReport58Data(query = {}, store = null) {
    const normalizedQuery = normalizeReport58Query(query);
    const base = buildReport58ViewData(normalizedQuery, { store });
    base.sheetMeta = await report58Excel.getMauSheetMeta(base.mau);
    if (base.mau === report58Excel.S2A_DNSN_MAU) {
        base.s2aData = await report58Excel.buildS2aDnsnData(normalizedQuery, store, base.range);
    } else if (base.mau === report58Excel.S2C_DNSN_MAU) {
        base.s2cData = await report58Excel.buildS2cDnsnData(normalizedQuery, store, base.range);
    } else if (report58Excel.INVOICE_LEDGER_MAU.has(base.mau)) {
        base.ledgerData = await buildInvoiceLedgerViewData(normalizedQuery, store);
    }
    if (base.mau === 'S2d-DNSN') {
        base.s2dFilters = await report58Data.loadS2dFilterOptions(store);
    }
    if (base.mau === '01-TT' || base.mau === '02-TT') {
        base.voucherFilters = await report58Data.loadVoucherFilterOptions(store);
    }
    if (base.mau === '01-VT') {
        base.purchaseFilters = { purchases: await report58Pdf.loadPurchaseVoucherOptions(store) };
    }
    if (base.mau === '02-VT') {
        base.exportFilters = { options: await report58Pdf.loadExportVoucherOptions(store) };
    }
    return base;
}

/**
 * Render PDF Báo cáo 58 qua report58Pdf.service (nguồn dữ liệu chuẩn hóa từng mẫu).
 * Excel/CSV vẫn dùng report58Excel.service — không đổi.
 */

async function buildReport58PdfBuffer(query = {}, store = null) {
    const normalizedQuery = normalizeReport58Query(query);
    const mau = resolveReport58Mau(normalizedQuery.mau);
    const range = getSalesRange(normalizedQuery);
    const pdfView = await report58Pdf.buildReport58PdfData({ mau, query: normalizedQuery, store, range });
    const viewPath = path.join(
        __dirname,
        '..',
        '..',
        '..',
        'views',
        'bao-cao',
        'mau',
        pdfView.view
    );
    const html = await pdfService.renderViewToHtml(viewPath, pdfView.locals);
    const buffer = await pdfService.generatePdfFromHtml(html, {
        format: 'A4',
        landscape: pdfView.landscape === true,
        printBackground: true,
        margin: pdfView.landscape
            ? { top: '10mm', right: '8mm', bottom: '10mm', left: '10mm' }
            : { top: '12mm', right: '12mm', bottom: '12mm', left: '14mm' }
    });
    return { buffer, mau };
}

module.exports = {
    REPORT_58_MAU,
    resolveReport58Mau,
    buildReport58ViewData,
    buildInvoiceLedgerViewData,
    enrichReport58Data,
    buildReport58PdfBuffer
};

