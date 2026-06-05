const path = require('path');
const ExcelJS = require('exceljs');
const { HoaDonBanHang } = require('../models/kiot.model');

const TEMPLATE_PATH = path.join(__dirname, '..', 'data', 'templates', 'tt58-2026-bo-mau-excel.xlsx');

const REPORT_58_MAU = [
    'S1-DNSN',
    'S2a-DNSN',
    'S3a-DNSN',
    'S2b-DNSN',
    'S2c-DNSN',
    'S2d-DNSN',
    'S3b-DNSN',
    'S4a-DNSN',
    'S4b-DNSN',
    'S4c-DNSN',
    'S4d-DNSN',
    'B02-DNSN',
    'B01-DNSN',
    '02-VT',
    '01-VT',
    '02-TT',
    '01-TT'
];

/** Các mẫu sổ doanh thu lấy dòng từ hóa đơn bán (khung Excel TT58). */
const INVOICE_LEDGER_MAU = new Set(['S1-DNSN', 'S2a-DNSN', 'S3a-DNSN']);
const S2A_DNSN_MAU = 'S2a-DNSN';

const INVOICE_DATA_START_ROW = 7;
const INVOICE_TEMPLATE_SAMPLE_ROWS = 6;
const VAT_RATE = 0.05;

function formatMoneyVN(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    return num.toLocaleString('vi-VN');
}

function computeLedgerLineAmounts(rawAmount) {
    const doanh_thu = Math.round(Number(rawAmount || 0));
    const thue_gtgt = Math.round(doanh_thu * VAT_RATE);
    const tong_thanh_toan = doanh_thu + thue_gtgt;
    return { doanh_thu, thue_gtgt, tong_thanh_toan };
}

function sumLedgerRows(rows = []) {
    return rows.reduce((acc, row) => {
        acc.doanh_thu += Number(row.doanh_thu || 0);
        acc.thue_gtgt += Number(row.thue_gtgt || 0);
        acc.tong_thanh_toan += Number(row.tong_thanh_toan || 0);
        return acc;
    }, { doanh_thu: 0, thue_gtgt: 0, tong_thanh_toan: 0 });
}

function findLedgerTotalRow(worksheet) {
    const last = Math.max(worksheet.rowCount || 0, INVOICE_DATA_START_ROW + INVOICE_TEMPLATE_SAMPLE_ROWS + 4);
    for (let rowNumber = INVOICE_DATA_START_ROW; rowNumber <= last; rowNumber += 1) {
        const text = cellText(worksheet.getRow(rowNumber).getCell(1).value).trim();
        if (/^tổng cộng$/i.test(text)) return rowNumber;
    }
    return null;
}

function cellText(value) {
    if (value == null) return '';
    if (typeof value === 'number' && Number.isFinite(value)) {
        return formatMoneyVN(value);
    }
    if (typeof value === 'object') {
        if (value.richText) return value.richText.map(part => part.text || '').join('');
        if (value.text) return String(value.text);
        if (value.formula != null) {
            if (value.result != null) return cellText(value.result);
            return '';
        }
        if (value.result != null) return cellText(value.result);
        if (value instanceof Date) return value.toLocaleDateString('vi-VN');
        return '';
    }
    return String(value);
}

function replacePlaceholders(text, context) {
    if (!text) return text;
    const periodLabel = context.range?.from && context.range?.to
        ? `${context.range.from} – ${context.range.to}`
        : '........';
    return String(text)
        .replace(/\[Tên doanh nghiệp\]/gi, context.storeName || '')
        .replace(/Năm\/Kỳ:\s*\[\.\.\.\.\.\.\.\.\]/gi, `Năm/Kỳ: ${context.year || ''} (${periodLabel})`)
        .replace(/\[\.{3,}\]/g, context.year || '........');
}

function fillCommonCells(worksheet, context) {
    worksheet.eachRow(row => {
        row.eachCell(cell => {
            const raw = cell.value;
            if (raw == null) return;
            if (typeof raw === 'string' && (raw.includes('[') || raw.includes('Năm/Kỳ'))) {
                cell.value = replacePlaceholders(raw, context);
                return;
            }
            if (typeof raw === 'object' && raw.richText) {
                const joined = cellText(raw);
                if (joined.includes('[') || joined.includes('Năm/Kỳ')) {
                    cell.value = replacePlaceholders(joined, context);
                }
            }
        });
    });
}

function copyWorksheet(sourceSheet, targetSheet) {
    sourceSheet.columns?.forEach((col, index) => {
        if (!col) return;
        const targetCol = targetSheet.getColumn(index + 1);
        if (col.width) targetCol.width = col.width;
    });

    sourceSheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        const targetRow = targetSheet.getRow(rowNumber);
        if (row.height) targetRow.height = row.height;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            const targetCell = targetRow.getCell(colNumber);
            targetCell.value = cell.value;
            if (cell.style) targetCell.style = { ...cell.style };
            if (cell.numFmt) targetCell.numFmt = cell.numFmt;
            if (cell.alignment) targetCell.alignment = { ...cell.alignment };
            if (cell.border) targetCell.border = { ...cell.border };
            if (cell.font) targetCell.font = { ...cell.font };
            if (cell.fill) targetCell.fill = { ...cell.fill };
        });
    });

    (sourceSheet.model.merges || []).forEach(merge => {
        try {
            targetSheet.mergeCells(merge);
        } catch (error) {
            // Bỏ qua merge trùng khi copy lại sheet.
        }
    });
}

async function loadTemplateWorkbook() {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(TEMPLATE_PATH);
    return workbook;
}

async function buildS2aDnsnData(query = {}, store = null, range = null) {
    const safeRange = range || query.range || {};
    const rows = await fetchInvoiceLedgerRows({ range: safeRange }, store);
    const detailRows = rows.map(row => ({
        so_hieu: row.so_chung_tu,
        ngay_thang: row.ngay ? new Date(row.ngay).toLocaleDateString('vi-VN') : '',
        dien_giai: row.dien_giai,
        so_tien: Number(row.doanh_thu || 0)
    }));
    const totals = sumLedgerRows(rows);
    const tongCong1 = totals.doanh_thu;
    const thueGtgt1 = totals.thue_gtgt;
    const gtgtDauKy = 0;
    const gtgtPhaiNopKy = thueGtgt1;
    const gtgtDaNopKy = 0;
    const gtgtCuoiKy = gtgtDauKy + gtgtPhaiNopKy - gtgtDaNopKy;

    return {
        detailRows,
        tongCong1,
        thueGtgt1,
        gtgtDauKy,
        gtgtPhaiNopKy,
        gtgtDaNopKy,
        gtgtCuoiKy
    };
}

async function fetchInvoiceLedgerRows(query = {}, store = null) {
    const range = query.range || {};
    const start = range.start ? new Date(range.start) : new Date();
    const end = range.end ? new Date(range.end) : new Date();
    const filter = {
        ngay_ban: { $gte: start, $lt: end },
        trang_thai: { $ne: 'cancelled' }
    };
    if (store?._id) filter.cua_hang_id = store._id;

    const invoices = await HoaDonBanHang.find(filter)
        .select('ma_hoa_don ngay_ban thanh_toan tong_tien ghi_chu')
        .populate('khach_hang_id', 'ten_khach_hang')
        .sort({ ngay_ban: 1, ma_hoa_don: 1 })
        .lean();

    return invoices.map((invoice, index) => {
        const amounts = computeLedgerLineAmounts(invoice.tong_tien ?? invoice.thanh_toan ?? 0);
        return {
            stt: index + 1,
            ngay: invoice.ngay_ban ? new Date(invoice.ngay_ban) : '',
            so_chung_tu: invoice.ma_hoa_don || '',
            dien_giai: invoice.khach_hang_id?.ten_khach_hang
                || invoice.ghi_chu
                || 'Doanh thu bán hàng',
            ...amounts,
            ghi_chu: invoice.ghi_chu || ''
        };
    });
}

function fillInvoiceLedgerRows(worksheet, rows) {
    const totalRowBefore = findLedgerTotalRow(worksheet);
    if (!totalRowBefore) return;

    const templateDataRowCount = totalRowBefore - INVOICE_DATA_START_ROW;
    if (templateDataRowCount > 0) {
        worksheet.spliceRows(INVOICE_DATA_START_ROW, templateDataRowCount);
    }

    if (rows.length > 0) {
        worksheet.spliceRows(
            INVOICE_DATA_START_ROW,
            0,
            ...Array.from({ length: rows.length }, () => [])
        );
        rows.forEach((row, index) => {
            const excelRow = worksheet.getRow(INVOICE_DATA_START_ROW + index);
            excelRow.getCell(1).value = row.stt;
            excelRow.getCell(2).value = row.ngay || '';
            excelRow.getCell(3).value = row.so_chung_tu || '';
            excelRow.getCell(4).value = row.dien_giai || '';
            excelRow.getCell(5).value = row.doanh_thu ?? 0;
            excelRow.getCell(6).value = row.thue_gtgt ?? 0;
            excelRow.getCell(7).value = row.tong_thanh_toan ?? 0;
            excelRow.getCell(8).value = row.ghi_chu || '';
        });
    }

    const totalRowNumber = findLedgerTotalRow(worksheet);
    if (!totalRowNumber) return;

    const totals = sumLedgerRows(rows);
    const totalRow = worksheet.getRow(totalRowNumber);
    totalRow.getCell(1).value = 'Tổng cộng';
    totalRow.getCell(5).value = totals.doanh_thu;
    totalRow.getCell(6).value = totals.thue_gtgt;
    totalRow.getCell(7).value = totals.tong_thanh_toan;
}

function buildExportContext(query = {}, store = null, range = null) {
    const safeRange = range || {};
    return {
        store,
        storeName: store?.ten_cua_hang || '',
        storeAddress: store?.dia_chi_day_du || [
            store?.dia_chi_chi_tiet,
            store?.phuong_xa,
            store?.tinh_thanh
        ].filter(Boolean).join(', '),
        year: query.year || (safeRange.to ? String(safeRange.to).slice(0, 4) : String(new Date().getFullYear())),
        donViTinh: query.don_vi_tinh || 'đồng',
        range: safeRange
    };
}

async function prepareWorksheet(templateWb, mau, context) {
    const source = templateWb.getWorksheet(mau);
    if (!source) {
        throw new Error(`Không tìm thấy sheet mẫu "${mau}" trong file TT58.`);
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(mau);
    copyWorksheet(source, sheet);
    fillCommonCells(sheet, context);

    if (INVOICE_LEDGER_MAU.has(mau)) {
        const rows = await fetchInvoiceLedgerRows(
            { range: context.range },
            context.store
        );
        fillInvoiceLedgerRows(sheet, rows);
    }

    return workbook;
}

async function exportMauExcel(mau, query = {}, store = null, range = null) {
    const templateWb = await loadTemplateWorkbook();
    const context = buildExportContext(query, store, range);
    return prepareWorksheet(templateWb, mau, context);
}

async function exportAllMauExcel(query = {}, store = null, range = null) {
    const templateWb = await loadTemplateWorkbook();
    const context = buildExportContext(query, store, range);
    const outWb = new ExcelJS.Workbook();

    templateWb.worksheets.forEach(sourceSheet => {
        if (!REPORT_58_MAU.includes(sourceSheet.name)) return;
        const sheet = outWb.addWorksheet(sourceSheet.name);
        copyWorksheet(sourceSheet, sheet);
    });

    for (const mau of REPORT_58_MAU) {
        const sheet = outWb.getWorksheet(mau);
        if (!sheet) continue;
        fillCommonCells(sheet, context);
        if (INVOICE_LEDGER_MAU.has(mau)) {
            const rows = await fetchInvoiceLedgerRows({ range: context.range }, context.store);
            fillInvoiceLedgerRows(sheet, rows);
        }
    }

    return outWb;
}

async function workbookToBuffer(workbook) {
    return workbook.xlsx.writeBuffer();
}

async function sheetToCsvBuffer(worksheet) {
    const lines = [];
    worksheet.eachRow(row => {
        const cells = [];
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            while (cells.length < colNumber - 1) cells.push('');
            const text = cellText(cell.value).replace(/"/g, '""');
            cells[colNumber - 1] = `"${text}"`;
        });
        lines.push(cells.join(','));
    });
    return '\uFEFF' + lines.join('\n');
}

function listTemplateSheets() {
    return [...REPORT_58_MAU];
}

let sheetMetaCache = null;

async function ensureSheetMetaCache() {
    if (sheetMetaCache) return sheetMetaCache;
    const workbook = await loadTemplateWorkbook();
    sheetMetaCache = {};
    for (const mau of REPORT_58_MAU) {
        const worksheet = workbook.getWorksheet(mau);
        if (!worksheet) continue;
        const columns = [];
        worksheet.getRow(6).eachCell({ includeEmpty: true }, (cell, colNumber) => {
            const label = cellText(cell.value).trim();
            if (label) columns.push(label);
        });
        sheetMetaCache[mau] = {
            mauCode: mau,
            title: cellText(worksheet.getRow(2).getCell(1).value).trim(),
            hint: cellText(worksheet.getRow(4).getCell(1).value).trim(),
            columns,
            hasInvoiceLedger: INVOICE_LEDGER_MAU.has(mau)
        };
    }
    return sheetMetaCache;
}

async function getMauSheetMeta(mau) {
    const cache = await ensureSheetMetaCache();
    return cache[mau] || {
        mauCode: mau,
        title: mau,
        hint: '',
        columns: [],
        hasInvoiceLedger: INVOICE_LEDGER_MAU.has(mau)
    };
}

function colLettersToNumber(letters) {
    let value = 0;
    const text = String(letters || '').toUpperCase();
    for (let i = 0; i < text.length; i += 1) {
        value = value * 26 + (text.charCodeAt(i) - 64);
    }
    return value;
}

function parseCellAddress(address) {
    const match = String(address || '').match(/^([A-Z]+)(\d+)$/i);
    if (!match) return null;
    return {
        col: colLettersToNumber(match[1]),
        row: parseInt(match[2], 10)
    };
}

function parseMergeRange(ref) {
    const parts = String(ref || '').split(':');
    if (parts.length !== 2) return null;
    const start = parseCellAddress(parts[0]);
    const end = parseCellAddress(parts[1]);
    if (!start || !end) return null;
    return {
        startRow: start.row,
        startCol: start.col,
        endRow: end.row,
        endCol: end.col,
        rowSpan: end.row - start.row + 1,
        colSpan: end.col - start.col + 1
    };
}

function buildMergeMaps(mergeRefs = []) {
    const skip = new Set();
    const master = new Map();
    mergeRefs.forEach(ref => {
        const range = parseMergeRange(ref);
        if (!range) return;
        master.set(`${range.startRow},${range.startCol}`, {
            rowSpan: range.rowSpan,
            colSpan: range.colSpan
        });
        for (let row = range.startRow; row <= range.endRow; row += 1) {
            for (let col = range.startCol; col <= range.endCol; col += 1) {
                if (row !== range.startRow || col !== range.startCol) {
                    skip.add(`${row},${col}`);
                }
            }
        }
    });
    return { skip, master };
}

function isEmptyInvoiceLedgerDataRow(row, rowNumber) {
    if (rowNumber < INVOICE_DATA_START_ROW) return false;
    const stt = cellText(row.getCell(1).value).trim();
    if (/^tổng cộng$/i.test(stt)) return false;
    const soChungTu = cellText(row.getCell(3).value).trim();
    const dienGiai = cellText(row.getCell(4).value).trim();
    const doanhThu = cellText(row.getCell(5).value).trim();
    const tongTt = cellText(row.getCell(7).value).trim();
    const ngay = row.getCell(2).value;
    if (soChungTu || dienGiai || doanhThu || tongTt || ngay) return false;
    return /^\d+$/.test(stt);
}

function worksheetToPreviewModel(worksheet, maxRows = 90) {
    if (!worksheet) {
        return { sheetName: '', rows: [], colCount: 1, colWidths: [] };
    }

    const mergeRefs = worksheet.model?.merges || [];
    const { skip, master } = buildMergeMaps(mergeRefs);

    let colCount = 0;
    worksheet.eachRow(row => {
        row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
            colCount = Math.max(colCount, colNumber);
        });
    });
    mergeRefs.forEach(ref => {
        const range = parseMergeRange(ref);
        if (range) colCount = Math.max(colCount, range.endCol);
    });
    colCount = Math.max(colCount, 8);

    const colWidths = [];
    for (let col = 1; col <= colCount; col += 1) {
        const width = worksheet.getColumn(col).width;
        colWidths.push(width ? Math.round(width * 7) : 72);
    }

    const lastRow = Math.min(worksheet.rowCount || 0, maxRows);
    const rows = [];

    for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        if (isEmptyInvoiceLedgerDataRow(row, rowNumber)) continue;

        const cells = [];
        const isTableRow = rowNumber >= 6;

        for (let col = 1; col <= colCount; col += 1) {
            const key = `${rowNumber},${col}`;
            if (skip.has(key)) continue;

            const cell = row.getCell(col);
            const text = cellText(cell.value).trim();
            if (!text && !isTableRow) continue;

            const span = master.get(key) || { rowSpan: 1, colSpan: 1 };
            let align = cell.alignment?.horizontal || '';
            if (!align && span.colSpan === colCount) align = 'center';
            if (!align && (cell.numFmt && cell.numFmt !== '@')) align = 'right';
            if (!align) align = col === 1 && isTableRow && /^\d+$/.test(text) ? 'center' : 'left';

            cells.push({
                col,
                text,
                colSpan: span.colSpan,
                rowSpan: span.rowSpan,
                bold: !!cell.font?.bold,
                italic: !!cell.font?.italic,
                align,
                wrap: !!cell.alignment?.wrapText
            });
        }

        if (cells.length) rows.push({ rowNumber, cells });
    }

    return {
        sheetName: worksheet.name,
        rows,
        colCount,
        colWidths
    };
}

module.exports = {
    TEMPLATE_PATH,
    REPORT_58_MAU,
    INVOICE_LEDGER_MAU,
    listTemplateSheets,
    getMauSheetMeta,
    exportMauExcel,
    exportAllMauExcel,
    workbookToBuffer,
    sheetToCsvBuffer,
    worksheetToPreviewModel,
    fetchInvoiceLedgerRows,
    buildS2aDnsnData,
    S2A_DNSN_MAU,
    VAT_RATE,
    formatMoneyVN,
    computeLedgerLineAmounts,
    sumLedgerRows
};
