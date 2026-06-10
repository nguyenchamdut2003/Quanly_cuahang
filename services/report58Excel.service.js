const path = require('path');
const ExcelJS = require('exceljs');
const mongoose = require('mongoose');
const { HoaDonBanHang, LichSuKho, HangHoa, Kho } = require('../models/kiot.model');
const report58Data = require('./report58Data.service');

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
const STOCK_LEDGER_MAU = new Set(['S2c-DNSN']);
const REVENUE_EXPENSE_MAU = new Set(['S2b-DNSN']);
const CASH_LEDGER_MAU = new Set(['S2d-DNSN']);
const VAT_LEDGER_MAU = new Set(['S3b-DNSN']);
const DEBT_LEDGER_MAU = new Set(['S4a-DNSN']);
const FINANCIAL_REPORT_MAU = new Set(['B01-DNSN', 'B02-DNSN']);
const VOUCHER_MAU = report58Data.VOUCHER_MAU;
const S2A_DNSN_MAU = 'S2a-DNSN';
const S2C_DNSN_MAU = 'S2c-DNSN';

const STOCK_DATA_START_ROW = 7;
const GENERIC_DATA_START_ROW = 7;
const LOAI_PHIEU_LABELS = {
    nhap_hang: 'Nhập hàng',
    tra_hang_nhap: 'Trả hàng nhập',
    tra_hang: 'Trả hàng bán',
    kiem_kho: 'Kiểm kho',
    ban_hang: 'Bán hàng',
    xuat_huy: 'Xuất hủy',
    xuat_noi_bo: 'Xuất dùng nội bộ',
    dieu_chinh: 'Điều chỉnh tồn kho'
};

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

function roundMoney(value) {
    return Math.round(Number(value) || 0);
}

function formatQty(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    if (Number.isInteger(num)) return String(num);
    return num.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
}

function formatDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatDisplayDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN');
}

function createStockState() {
    return { qty: 0, value: 0 };
}

function avgUnitPrice(state) {
    if (state.qty <= 0) return 0;
    return state.value / state.qty;
}

function applyInbound(state, qty, value) {
    const amount = Math.abs(Number(qty) || 0);
    const money = Math.abs(Number(value) || 0);
    state.qty += amount;
    state.value += money;
    return {
        unitPrice: amount > 0 ? money / amount : 0,
        qty: amount,
        value: money
    };
}

function applyOutbound(state, qty) {
    const amount = Math.abs(Number(qty) || 0);
    const unitPrice = avgUnitPrice(state);
    const exportValue = roundMoney(amount * unitPrice);
    state.qty = Math.max(0, state.qty - amount);
    state.value = Math.max(0, state.value - exportValue);
    return {
        unitPrice,
        qty: amount,
        value: exportValue
    };
}

function aggregateStockMovements(records = []) {
    const map = new Map();
    records.forEach(record => {
        const dayKey = formatDateKey(record.ngay);
        const voucherKey = `${record.ma_phieu || ''}|${dayKey}|${record.loai_phieu || ''}`;
        if (!map.has(voucherKey)) {
            map.set(voucherKey, {
                ma_phieu: record.ma_phieu || '',
                ngay: record.ngay,
                loai_phieu: record.loai_phieu || '',
                so_luong: 0,
                gia_tri: 0,
                ghi_chu: record.ghi_chu || ''
            });
        }
        const row = map.get(voucherKey);
        row.so_luong += Number(record.so_luong_thay_doi || 0);
        row.gia_tri += Number(record.gia_tri_thay_doi || 0);
        if (!row.ghi_chu && record.ghi_chu) row.ghi_chu = record.ghi_chu;
    });
    return Array.from(map.values()).sort((a, b) => {
        const diff = new Date(a.ngay).getTime() - new Date(b.ngay).getTime();
        if (diff !== 0) return diff;
        return String(a.ma_phieu || '').localeCompare(String(b.ma_phieu || ''), 'vi');
    });
}

function buildMovementDescription(movement) {
    const label = LOAI_PHIEU_LABELS[movement.loai_phieu] || movement.loai_phieu || 'Phát sinh kho';
    if (movement.ghi_chu) return `${label} — ${movement.ghi_chu}`;
    return label;
}

function movementToLedgerRow(movement, state, fallbackUnitCost = 0) {
    const qtyChange = Number(movement.so_luong || 0);
    const row = {
        so_hieu: movement.ma_phieu || '',
        ngay_thang: formatDisplayDate(movement.ngay),
        dien_giai: buildMovementDescription(movement),
        don_vi_tinh: '',
        don_gia: '',
        nhap_sl: '',
        nhap_tien: '',
        xuat_sl: '',
        xuat_tien: '',
        ton_sl: '',
        ton_tien: '',
        ghi_chu: movement.ghi_chu || '',
        kind: 'movement'
    };

    if (qtyChange > 0) {
        let importValue = Math.abs(Number(movement.gia_tri || 0));
        if (!importValue && fallbackUnitCost) {
            importValue = roundMoney(qtyChange * fallbackUnitCost);
        }
        const inbound = applyInbound(state, qtyChange, importValue);
        row.don_gia = inbound.unitPrice;
        row.nhap_sl = inbound.qty;
        row.nhap_tien = inbound.value;
    } else if (qtyChange < 0) {
        const outbound = applyOutbound(state, qtyChange);
        row.don_gia = outbound.unitPrice;
        row.xuat_sl = outbound.qty;
        row.xuat_tien = outbound.value;
    }

    row.ton_sl = state.qty;
    row.ton_tien = roundMoney(state.value);
    return row;
}

function replayStockMovements(movements, fallbackUnitCost = 0) {
    const state = createStockState();
    movements.forEach(movement => {
        movementToLedgerRow(movement, state, fallbackUnitCost);
    });
    return state;
}

function buildStockLedgerRows(movements, openingState, fallbackUnitCost = 0) {
    const state = {
        qty: Number(openingState.qty || 0),
        value: Number(openingState.value || 0)
    };
    const detailRows = [];
    let periodInQty = 0;
    let periodInValue = 0;
    let periodOutQty = 0;
    let periodOutValue = 0;

    movements.forEach(movement => {
        const row = movementToLedgerRow(movement, state, fallbackUnitCost);
        detailRows.push(row);
        periodInQty += Number(row.nhap_sl || 0);
        periodInValue += Number(row.nhap_tien || 0);
        periodOutQty += Number(row.xuat_sl || 0);
        periodOutValue += Number(row.xuat_tien || 0);
    });

    return {
        detailRows,
        closing: { qty: state.qty, value: roundMoney(state.value) },
        periodIn: { qty: periodInQty, value: roundMoney(periodInValue) },
        periodOut: { qty: periodOutQty, value: roundMoney(periodOutValue) }
    };
}

async function loadS2cFilterOptions(store = null) {
    const storeId = store?._id;
    const productFilter = { trang_thai: 'active' };
    const warehouseFilter = { trang_thai: 'active' };
    if (storeId) {
        productFilter.cua_hang_id = storeId;
        warehouseFilter.cua_hang_id = storeId;
    }

    const [products, warehouses] = await Promise.all([
        HangHoa.find(productFilter).select('ten_hang ma_hang').sort({ ten_hang: 1 }).lean(),
        Kho.find(warehouseFilter).select('ten_kho').sort({ ten_kho: 1 }).lean()
    ]);

    return { products, warehouses };
}

async function buildS2cDnsnData(query = {}, store = null, range = null) {
    const safeRange = range || {};
    const hangHoaId = String(query.hang_hoa_id || '').trim();
    const khoId = String(query.kho_id || '').trim();
    const filters = await loadS2cFilterOptions(store);

    if (!hangHoaId || !khoId || !mongoose.Types.ObjectId.isValid(hangHoaId) || !mongoose.Types.ObjectId.isValid(khoId)) {
        return {
            missingFilters: true,
            tenHang: '',
            maHang: '',
            donViTinhLabel: '',
            tenKho: '',
            detailRows: [],
            opening: { qty: 0, value: 0 },
            periodIn: { qty: 0, value: 0 },
            periodOut: { qty: 0, value: 0 },
            closing: { qty: 0, value: 0 },
            filters: {
                ...filters,
                hang_hoa_id: hangHoaId,
                kho_id: khoId
            }
        };
    }

    const [product, warehouse] = await Promise.all([
        HangHoa.findById(hangHoaId).populate('don_vi_tinh_id', 'ten_don_vi ma_don_vi').lean(),
        Kho.findById(khoId).select('ten_kho cua_hang_id').lean()
    ]);

    if (!product || !warehouse) {
        return {
            missingFilters: true,
            missingData: true,
            tenHang: product?.ten_hang || '',
            maHang: product?.ma_hang || '',
            donViTinhLabel: product?.don_vi_tinh_id?.ten_don_vi || product?.don_vi_tinh_id?.ma_don_vi || '',
            tenKho: warehouse?.ten_kho || '',
            detailRows: [],
            opening: { qty: 0, value: 0 },
            periodIn: { qty: 0, value: 0 },
            periodOut: { qty: 0, value: 0 },
            closing: { qty: 0, value: 0 },
            filters: {
                ...filters,
                hang_hoa_id: hangHoaId,
                kho_id: khoId
            }
        };
    }

    const historyFilter = {
        hang_hoa_id: hangHoaId,
        kho_id: khoId
    };
    if (store?._id) historyFilter.cua_hang_id = store._id;

    const periodEnd = safeRange.end ? new Date(safeRange.end) : new Date();
    const periodStart = safeRange.start ? new Date(safeRange.start) : new Date(periodEnd.getTime() - 6 * 86400000);

    const [beforeRecords, periodRecords] = await Promise.all([
        LichSuKho.find({
            ...historyFilter,
            ngay: { $lt: periodStart }
        }).sort({ ngay: 1, created_at: 1 }).lean(),
        LichSuKho.find({
            ...historyFilter,
            ngay: { $gte: periodStart, $lt: periodEnd }
        }).sort({ ngay: 1, created_at: 1 }).lean()
    ]);

    const fallbackUnitCost = Number(product.gia_von || product.gia_nhap_cuoi || 0);
    const beforeMovements = aggregateStockMovements(beforeRecords);
    const opening = replayStockMovements(beforeMovements, fallbackUnitCost);
    const periodMovements = aggregateStockMovements(periodRecords);
    const ledger = buildStockLedgerRows(periodMovements, opening, fallbackUnitCost);

    return {
        missingFilters: false,
        tenHang: product.ten_hang || '',
        maHang: product.ma_hang || '',
        donViTinhLabel: product.don_vi_tinh_id?.ten_don_vi || product.don_vi_tinh_id?.ma_don_vi || '',
        tenKho: warehouse.ten_kho || '',
        detailRows: ledger.detailRows,
        opening: {
            qty: opening.qty,
            value: roundMoney(opening.value)
        },
        periodIn: ledger.periodIn,
        periodOut: ledger.periodOut,
        closing: ledger.closing,
        filters: {
            ...filters,
            hang_hoa_id: hangHoaId,
            kho_id: khoId
        }
    };
}

function findDataTotalRow(worksheet, startRow = GENERIC_DATA_START_ROW) {
    const last = Math.max(worksheet.rowCount || 0, startRow + 20);
    for (let rowNumber = startRow; rowNumber <= last; rowNumber += 1) {
        const text = cellText(worksheet.getRow(rowNumber).getCell(1).value).trim();
        if (/^tổng cộng$/i.test(text)) return rowNumber;
    }
    return null;
}

function spliceTemplateDataRows(worksheet, startRow, totalRowBefore) {
    const templateDataRowCount = totalRowBefore - startRow;
    if (templateDataRowCount > 0) {
        worksheet.spliceRows(startRow, templateDataRowCount);
    }
}

function insertDataRows(worksheet, startRow, rowCount) {
    if (rowCount > 0) {
        worksheet.spliceRows(
            startRow,
            0,
            ...Array.from({ length: rowCount }, () => [])
        );
    }
}

function fillNumericTotals(totalRow, totalsMap) {
    Object.entries(totalsMap).forEach(([col, value]) => {
        totalRow.getCell(Number(col)).value = Number(value || 0);
    });
}

function fillRevenueExpenseRows(worksheet, rows = []) {
    const totalRowBefore = findDataTotalRow(worksheet);
    if (!totalRowBefore) return;
    spliceTemplateDataRows(worksheet, GENERIC_DATA_START_ROW, totalRowBefore);
    insertDataRows(worksheet, GENERIC_DATA_START_ROW, rows.length);
    rows.forEach((row, index) => {
        const excelRow = worksheet.getRow(GENERIC_DATA_START_ROW + index);
        excelRow.getCell(1).value = row.stt;
        excelRow.getCell(2).value = row.ngay || '';
        excelRow.getCell(3).value = row.chung_tu || '';
        excelRow.getCell(4).value = row.dien_giai || '';
        excelRow.getCell(5).value = row.doanh_thu ?? 0;
        excelRow.getCell(6).value = row.chi_mua ?? 0;
        excelRow.getCell(7).value = row.chi_ban_hang ?? 0;
        excelRow.getCell(8).value = row.chi_khac ?? 0;
        excelRow.getCell(9).value = row.loi_nhuan ?? 0;
        excelRow.getCell(10).value = row.ghi_chu || '';
    });
    const totalRowNumber = findDataTotalRow(worksheet);
    if (!totalRowNumber) return;
    const totalRow = worksheet.getRow(totalRowNumber);
    totalRow.getCell(1).value = 'Tổng cộng';
    fillNumericTotals(totalRow, {
        5: rows.reduce((sum, row) => sum + Number(row.doanh_thu || 0), 0),
        6: rows.reduce((sum, row) => sum + Number(row.chi_mua || 0), 0),
        7: rows.reduce((sum, row) => sum + Number(row.chi_ban_hang || 0), 0),
        8: rows.reduce((sum, row) => sum + Number(row.chi_khac || 0), 0),
        9: rows.reduce((sum, row) => sum + Number(row.loi_nhuan || 0), 0)
    });
}

function fillCashLedgerRows(worksheet, rows = []) {
    const totalRowBefore = findDataTotalRow(worksheet);
    if (!totalRowBefore) return;
    spliceTemplateDataRows(worksheet, GENERIC_DATA_START_ROW, totalRowBefore);
    insertDataRows(worksheet, GENERIC_DATA_START_ROW, rows.length);
    rows.forEach((row, index) => {
        const excelRow = worksheet.getRow(GENERIC_DATA_START_ROW + index);
        excelRow.getCell(1).value = row.stt;
        excelRow.getCell(2).value = row.ngay || '';
        excelRow.getCell(3).value = row.chung_tu || '';
        excelRow.getCell(4).value = row.dien_giai || '';
        excelRow.getCell(5).value = row.thu ?? 0;
        excelRow.getCell(6).value = row.chi ?? 0;
        excelRow.getCell(7).value = row.ton_quy ?? 0;
        excelRow.getCell(8).value = row.so_quy || '';
        excelRow.getCell(9).value = row.ghi_chu || '';
    });
    const totalRowNumber = findDataTotalRow(worksheet);
    if (!totalRowNumber) return;
    const totalRow = worksheet.getRow(totalRowNumber);
    totalRow.getCell(1).value = 'Tổng cộng';
    fillNumericTotals(totalRow, {
        5: rows.reduce((sum, row) => sum + Number(row.thu || 0), 0),
        6: rows.reduce((sum, row) => sum + Number(row.chi || 0), 0),
        7: rows.length ? Number(rows[rows.length - 1].ton_quy || 0) : 0
    });
}

function fillVatLedgerRows(worksheet, rows = []) {
    const totalRowBefore = findDataTotalRow(worksheet);
    if (!totalRowBefore) return;
    spliceTemplateDataRows(worksheet, GENERIC_DATA_START_ROW, totalRowBefore);
    insertDataRows(worksheet, GENERIC_DATA_START_ROW, rows.length);
    rows.forEach((row, index) => {
        const excelRow = worksheet.getRow(GENERIC_DATA_START_ROW + index);
        excelRow.getCell(1).value = row.stt;
        excelRow.getCell(2).value = row.ky_thue || '';
        excelRow.getCell(3).value = row.chung_tu || '';
        excelRow.getCell(4).value = row.dien_giai || '';
        excelRow.getCell(5).value = row.doanh_thu_chiu_thue ?? 0;
        excelRow.getCell(6).value = row.thue_suat || '';
        excelRow.getCell(7).value = row.thue_dau_ra ?? 0;
        excelRow.getCell(8).value = row.thue_dau_vao ?? 0;
        excelRow.getCell(9).value = row.thue_phai_nop ?? 0;
        excelRow.getCell(10).value = row.ghi_chu || '';
    });
    const totalRowNumber = findDataTotalRow(worksheet);
    if (!totalRowNumber) return;
    const totalRow = worksheet.getRow(totalRowNumber);
    totalRow.getCell(1).value = 'Tổng cộng';
    fillNumericTotals(totalRow, {
        5: rows.reduce((sum, row) => sum + Number(row.doanh_thu_chiu_thue || 0), 0),
        7: rows.reduce((sum, row) => sum + Number(row.thue_dau_ra || 0), 0),
        8: rows.reduce((sum, row) => sum + Number(row.thue_dau_vao || 0), 0),
        9: rows.reduce((sum, row) => sum + Number(row.thue_phai_nop || 0), 0)
    });
}

function fillDebtLedgerRows(worksheet, rows = []) {
    const totalRowBefore = findDataTotalRow(worksheet);
    if (!totalRowBefore) return;
    spliceTemplateDataRows(worksheet, GENERIC_DATA_START_ROW, totalRowBefore);
    insertDataRows(worksheet, GENERIC_DATA_START_ROW, rows.length);
    rows.forEach((row, index) => {
        const excelRow = worksheet.getRow(GENERIC_DATA_START_ROW + index);
        excelRow.getCell(1).value = row.stt;
        excelRow.getCell(2).value = row.ngay || '';
        excelRow.getCell(3).value = row.chung_tu || '';
        excelRow.getCell(4).value = row.doi_tuong || '';
        excelRow.getCell(5).value = row.loai_doi_tuong || '';
        excelRow.getCell(6).value = row.dien_giai || '';
        excelRow.getCell(7).value = row.no_tang ?? 0;
        excelRow.getCell(8).value = row.no_giam ?? 0;
        excelRow.getCell(9).value = row.so_du ?? 0;
        excelRow.getCell(10).value = row.ghi_chu || '';
    });
    const totalRowNumber = findDataTotalRow(worksheet);
    if (!totalRowNumber) return;
    const totalRow = worksheet.getRow(totalRowNumber);
    totalRow.getCell(1).value = 'Tổng cộng';
    fillNumericTotals(totalRow, {
        7: rows.reduce((sum, row) => sum + Number(row.no_tang || 0), 0),
        8: rows.reduce((sum, row) => sum + Number(row.no_giam || 0), 0),
        9: rows.length ? Number(rows[rows.length - 1].so_du || 0) : 0
    });
}

function fillFinancialReportRows(worksheet, rows = [], mau = '') {
    const totalRowBefore = findDataTotalRow(worksheet);
    if (!totalRowBefore) return;
    spliceTemplateDataRows(worksheet, GENERIC_DATA_START_ROW, totalRowBefore);
    insertDataRows(worksheet, GENERIC_DATA_START_ROW, rows.length);
    const isBalance = mau === 'B01-DNSN';
    rows.forEach((row, index) => {
        const excelRow = worksheet.getRow(GENERIC_DATA_START_ROW + index);
        excelRow.getCell(1).value = row.ma_so || row.stt;
        excelRow.getCell(2).value = row.chi_tieu || '';
        excelRow.getCell(3).value = row.thuyet_minh || '';
        excelRow.getCell(4).value = isBalance ? (row.cuoi_nam ?? 0) : (row.nam_nay ?? 0);
        excelRow.getCell(5).value = isBalance ? (row.dau_nam ?? 0) : (row.nam_truoc ?? 0);
        excelRow.getCell(6).value = row.ghi_chu || '';
    });
    const totalRowNumber = findDataTotalRow(worksheet);
    if (!totalRowNumber) return;
    const totalRow = worksheet.getRow(totalRowNumber);
    totalRow.getCell(1).value = 'Tổng cộng';
    if (isBalance) {
        fillNumericTotals(totalRow, {
            4: rows.reduce((sum, row) => sum + Number(row.cuoi_nam || 0), 0),
            5: rows.reduce((sum, row) => sum + Number(row.dau_nam || 0), 0)
        });
    } else {
        fillNumericTotals(totalRow, {
            4: rows.reduce((sum, row) => sum + Number(row.nam_nay || 0), 0),
            5: rows.reduce((sum, row) => sum + Number(row.nam_truoc || 0), 0)
        });
    }
}

function fillVoucherFormRows(worksheet, data = {}) {
    if (!data || data.missingPhieu) return;
    worksheet.getRow(4).getCell(1).value = data.ngay_so || worksheet.getRow(4).getCell(1).value;
    worksheet.getRow(6).getCell(2).value = data.person_name || '';
    worksheet.getRow(7).getCell(2).value = data.address || '';
    worksheet.getRow(8).getCell(2).value = data.reason || '';
    worksheet.getRow(9).getCell(2).value = Number(data.amount || 0);
    worksheet.getRow(10).getCell(2).value = data.amount_text || '';
    const detailRows = Array.isArray(data.detail_rows) ? data.detail_rows : [];
    const totalRowBefore = findDataTotalRow(worksheet, 14);
    if (!totalRowBefore) return;
    spliceTemplateDataRows(worksheet, 14, totalRowBefore);
    insertDataRows(worksheet, 14, detailRows.length);
    detailRows.forEach((row, index) => {
        const excelRow = worksheet.getRow(14 + index);
        excelRow.getCell(1).value = row.stt;
        excelRow.getCell(2).value = row.noi_dung || '';
        excelRow.getCell(3).value = row.tai_khoan || '';
        excelRow.getCell(4).value = row.so_tien ?? 0;
        excelRow.getCell(5).value = row.chung_tu_lien_quan || '';
        excelRow.getCell(6).value = row.doi_tuong || '';
        excelRow.getCell(7).value = row.ghi_chu || '';
    });
}

async function fillMauWorksheetData(worksheet, mau, context) {
    const query = context.query || {};
    const range = context.range || {};
    const store = context.store || null;
    const needsInvoiceRows = INVOICE_LEDGER_MAU.has(mau) || VAT_LEDGER_MAU.has(mau);
    const invoiceRows = needsInvoiceRows
        ? await fetchInvoiceLedgerRows({ range }, store)
        : [];

    if (INVOICE_LEDGER_MAU.has(mau)) {
        fillInvoiceLedgerRows(worksheet, invoiceRows);
        return;
    }
    if (STOCK_LEDGER_MAU.has(mau)) {
        const s2cData = await buildS2cDnsnData(query, store, range);
        fillStockLedgerRows(worksheet, s2cData);
        return;
    }
    if (REVENUE_EXPENSE_MAU.has(mau)) {
        const { rows } = await report58Data.buildMauDataset(mau, query, store, range, { invoiceRows, fetchInvoiceLedgerRows });
        fillRevenueExpenseRows(worksheet, rows);
        return;
    }
    if (CASH_LEDGER_MAU.has(mau)) {
        const { rows } = await report58Data.buildMauDataset(mau, query, store, range, { invoiceRows, fetchInvoiceLedgerRows });
        fillCashLedgerRows(worksheet, rows);
        return;
    }
    if (VAT_LEDGER_MAU.has(mau)) {
        const { rows } = await report58Data.buildMauDataset(mau, query, store, range, { invoiceRows, fetchInvoiceLedgerRows });
        fillVatLedgerRows(worksheet, rows);
        return;
    }
    if (DEBT_LEDGER_MAU.has(mau)) {
        const { rows } = await report58Data.buildMauDataset(mau, query, store, range, { invoiceRows, fetchInvoiceLedgerRows });
        fillDebtLedgerRows(worksheet, rows);
        return;
    }
    if (FINANCIAL_REPORT_MAU.has(mau)) {
        const { rows } = await report58Data.buildMauDataset(mau, query, store, range, { invoiceRows, fetchInvoiceLedgerRows });
        fillFinancialReportRows(worksheet, rows, mau);
        return;
    }
    if (VOUCHER_MAU.has(mau)) {
        const voucherData = await report58Data.buildMauDataset(mau, query, store, range, { invoiceRows, fetchInvoiceLedgerRows });
        fillVoucherFormRows(worksheet, voucherData);
    }
}

function findStockLedgerTotalRow(worksheet) {
    const last = Math.max(worksheet.rowCount || 0, STOCK_DATA_START_ROW + 20);
    for (let rowNumber = STOCK_DATA_START_ROW; rowNumber <= last; rowNumber += 1) {
        const text = cellText(worksheet.getRow(rowNumber).getCell(1).value).trim();
        if (/^tổng cộng$/i.test(text)) return rowNumber;
    }
    return null;
}

function fillStockLedgerRows(worksheet, s2cData = {}) {
    const totalRowBefore = findStockLedgerTotalRow(worksheet);
    if (!totalRowBefore) return;

    const templateDataRowCount = totalRowBefore - STOCK_DATA_START_ROW;
    if (templateDataRowCount > 0) {
        worksheet.spliceRows(STOCK_DATA_START_ROW, templateDataRowCount);
    }

    const exportRows = [];
    if (Number(s2cData.opening?.qty || 0) > 0 || Number(s2cData.opening?.value || 0) > 0) {
        exportRows.push({
            ngay: '',
            so_chung_tu: '',
            ma_hang: s2cData.maHang || '',
            ten_hang: s2cData.tenHang || '',
            don_vi_tinh: s2cData.donViTinhLabel || '',
            nhap_sl: '',
            nhap_tien: '',
            xuat_sl: '',
            xuat_tien: '',
            ton_sl: s2cData.opening.qty,
            ton_tien: s2cData.opening.value,
            ghi_chu: 'Số dư đầu kỳ'
        });
    }

    (s2cData.detailRows || []).forEach(row => {
        exportRows.push({
            ngay: row.ngay_thang || '',
            so_chung_tu: row.so_hieu || '',
            ma_hang: s2cData.maHang || '',
            ten_hang: s2cData.tenHang || '',
            don_vi_tinh: s2cData.donViTinhLabel || '',
            nhap_sl: row.nhap_sl || '',
            nhap_tien: row.nhap_tien || '',
            xuat_sl: row.xuat_sl || '',
            xuat_tien: row.xuat_tien || '',
            ton_sl: row.ton_sl || '',
            ton_tien: row.ton_tien || '',
            ghi_chu: row.ghi_chu || row.dien_giai || ''
        });
    });

    if (exportRows.length > 0) {
        worksheet.spliceRows(
            STOCK_DATA_START_ROW,
            0,
            ...Array.from({ length: exportRows.length }, () => [])
        );
        exportRows.forEach((row, index) => {
            const excelRow = worksheet.getRow(STOCK_DATA_START_ROW + index);
            excelRow.getCell(1).value = index + 1;
            excelRow.getCell(2).value = row.ngay || '';
            excelRow.getCell(3).value = row.so_chung_tu || '';
            excelRow.getCell(4).value = row.ma_hang || '';
            excelRow.getCell(5).value = row.ten_hang || '';
            excelRow.getCell(6).value = row.don_vi_tinh || '';
            excelRow.getCell(7).value = row.nhap_sl === '' ? '' : Number(row.nhap_sl);
            excelRow.getCell(8).value = row.nhap_tien === '' ? '' : Number(row.nhap_tien);
            excelRow.getCell(9).value = row.xuat_sl === '' ? '' : Number(row.xuat_sl);
            excelRow.getCell(10).value = row.xuat_tien === '' ? '' : Number(row.xuat_tien);
            excelRow.getCell(11).value = row.ton_sl === '' ? '' : Number(row.ton_sl);
            excelRow.getCell(12).value = row.ton_tien === '' ? '' : Number(row.ton_tien);
        });
    }

    const totalRowNumber = findStockLedgerTotalRow(worksheet);
    if (!totalRowNumber) return;

    const totalRow = worksheet.getRow(totalRowNumber);
    totalRow.getCell(1).value = 'Tổng cộng';
    totalRow.getCell(7).value = Number(s2cData.periodIn?.qty || 0);
    totalRow.getCell(8).value = Number(s2cData.periodIn?.value || 0);
    totalRow.getCell(9).value = Number(s2cData.periodOut?.qty || 0);
    totalRow.getCell(10).value = Number(s2cData.periodOut?.value || 0);
    totalRow.getCell(11).value = Number(s2cData.closing?.qty || 0);
    totalRow.getCell(12).value = Number(s2cData.closing?.value || 0);
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
        range: safeRange,
        query
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

    await fillMauWorksheetData(sheet, mau, context);

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
        await fillMauWorksheetData(sheet, mau, { ...context, query, range });
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
            hasInvoiceLedger: INVOICE_LEDGER_MAU.has(mau),
            hasStockLedger: STOCK_LEDGER_MAU.has(mau),
            hasDataFill: INVOICE_LEDGER_MAU.has(mau)
                || STOCK_LEDGER_MAU.has(mau)
                || REVENUE_EXPENSE_MAU.has(mau)
                || CASH_LEDGER_MAU.has(mau)
                || VAT_LEDGER_MAU.has(mau)
                || DEBT_LEDGER_MAU.has(mau)
                || FINANCIAL_REPORT_MAU.has(mau)
                || VOUCHER_MAU.has(mau),
            landscape: report58Data.LANDSCAPE_MAU.has(mau) || STOCK_LEDGER_MAU.has(mau)
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
        hasInvoiceLedger: INVOICE_LEDGER_MAU.has(mau),
        hasStockLedger: STOCK_LEDGER_MAU.has(mau),
        hasDataFill: false,
        landscape: report58Data.LANDSCAPE_MAU.has(mau)
    };
}

function isLandscapeMau(mau) {
    return mau === S2C_DNSN_MAU || report58Data.LANDSCAPE_MAU.has(mau);
}

async function buildFilledMauPreview(mau, query = {}, store = null, range = null) {
    const workbook = await exportMauExcel(mau, query, store, range);
    const sheet = workbook.getWorksheet(mau);
    return worksheetToPreviewModel(sheet);
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
    buildS2cDnsnData,
    loadS2cFilterOptions,
    S2A_DNSN_MAU,
    S2C_DNSN_MAU,
    STOCK_LEDGER_MAU,
    REVENUE_EXPENSE_MAU,
    CASH_LEDGER_MAU,
    VAT_LEDGER_MAU,
    DEBT_LEDGER_MAU,
    FINANCIAL_REPORT_MAU,
    VOUCHER_MAU,
    isLandscapeMau,
    buildFilledMauPreview,
    VAT_RATE,
    formatMoneyVN,
    computeLedgerLineAmounts,
    sumLedgerRows
};
