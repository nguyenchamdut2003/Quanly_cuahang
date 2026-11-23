const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const { PhieuNhap, CTPhieuNhap } = require('../models/kiot.model');

const EXPORT_COLUMNS = [
    { key: 'stt', header: 'STT', width: 8 },
    { key: 'ngay_nhap', header: 'Ngày nhập', width: 18 },
    { key: 'ma_phieu_nhap', header: 'Mã phiếu nhập', width: 18 },
    { key: 'ma_ncc', header: 'Mã NCC', width: 14 },
    { key: 'ten_ncc', header: 'Tên NCC', width: 28 },
    { key: 'ma_hang', header: 'Mã hàng', width: 16 },
    { key: 'ten_hang', header: 'Tên hàng', width: 32 },
    { key: 'ten_lo', header: 'Lô', width: 22 },
    { key: 'thuoc_tinh', header: 'Thuộc tính', width: 18 },
    { key: 'dvt', header: 'ĐVT', width: 10 },
    { key: 'so_luong', header: 'Số lượng', width: 12, numeric: true },
    { key: 'don_gia', header: 'Đơn giá', width: 14, numeric: true },
    { key: 'giam_gia_dong', header: 'Giảm giá dòng', width: 14, numeric: true },
    { key: 'thanh_tien', header: 'Thành tiền', width: 16, numeric: true }
];

function parseMoney(value) {
    const n = Number(String(value ?? '').replace(/\./g, '').replace(/,/g, '').trim());
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function formatExportDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function formatLotName(loHang, lotInfo) {
    const ten = String(loHang?.ten_lo || lotInfo?.ten_lo || '').trim();
    const ma = String(loHang?.ma_lo || lotInfo?.ma_lo || '').trim();
    if (ten) return ten;
    if (ma) return ma;
    if (loHang || lotInfo?.ten_lo || lotInfo?.ma_lo) return 'Lô không tên';
    return '';
}

function normalizeQuyCachItems(items) {
    return (Array.isArray(items) ? items : [])
        .map((item) => {
            const qty = Math.max(0, Number(item?.so_luong || 0));
            const unitCost = parseMoney(item?.don_gia_nhap ?? item?.don_gia ?? item?.gia_von ?? item?.gia_von_snapshot);
            const name = String(item?.ten_quy_cach || item?.ten_thuoc_tinh || '').trim();
            const storedTotal = Number(item?.thanh_tien || 0);
            return {
                ten_quy_cach: name,
                so_luong: qty,
                don_gia: unitCost,
                thanh_tien: storedTotal > 0 ? Math.floor(storedTotal) : Math.floor(qty * unitCost)
            };
        })
        .filter((item) => item.ten_quy_cach || item.so_luong > 0 || item.don_gia > 0);
}

function resolveLineUnitPrice(ctRow, qcItem) {
    if (qcItem) {
        return parseMoney(qcItem.don_gia_nhap ?? qcItem.don_gia ?? qcItem.gia_von ?? qcItem.gia_von_snapshot);
    }
    const lotInfo = ctRow.lot_info && typeof ctRow.lot_info === 'object' ? ctRow.lot_info : null;
    return parseMoney(
        ctRow.don_gia_nhap
        ?? ctRow.don_gia
        ?? lotInfo?.don_gia_nhap
        ?? lotInfo?.don_gia
        ?? lotInfo?.gia_von_snapshot
    );
}

function calcLineDiscountAmount(qty, unitPrice, giamGia, kieuGiam) {
    const base = Math.floor(Number(qty || 0) * Number(unitPrice || 0));
    const discountRaw = Number(giamGia || 0);
    if (!discountRaw) return 0;
    if (kieuGiam === 'percent') {
        return Math.floor(base * Math.min(discountRaw, 100) / 100);
    }
    return Math.min(Math.floor(discountRaw), base);
}

function resolveLineThanhTien({ qty, unitPrice, giamGia, kieuGiam, storedThanhTien }) {
    const stored = Number(storedThanhTien || 0);
    if (stored > 0) return Math.floor(stored);
    const discount = calcLineDiscountAmount(qty, unitPrice, giamGia, kieuGiam);
    return Math.max(0, Math.floor(Number(qty || 0) * Number(unitPrice || 0) - discount));
}

function resolveThuocTinhLabel(ctRow, qcName) {
    if (qcName) return qcName;
    const attr = ctRow.gia_tri_thuoc_tinh_id;
    if (!attr || typeof attr !== 'object') return '';
    const group = attr.thuoc_tinh_id?.ten_thuoc_tinh || attr.thuoc_tinh_id?.ma_thuoc_tinh || '';
    const value = attr.ten_gia_tri || attr.ma_gia_tri || '';
    if (group && value) return `${group}: ${value}`;
    return value || group || '';
}

function expandCtRowToExportLines(ctRow, phieu, supplier) {
    const product = ctRow.hang_hoa_id || {};
    const dvt = ctRow.don_vi_tinh_id?.ten_don_vi || '';
    const base = {
        ngay_nhap: formatExportDate(phieu.ngay_nhap || phieu.created_at),
        ma_phieu_nhap: phieu.ma_phieu_nhap || '',
        ma_ncc: supplier.ma_ncc || '',
        ten_ncc: supplier.ten_ncc || '',
        ma_hang: product.ma_hang || '',
        ten_hang: product.ten_hang || '',
        ten_lo: formatLotName(ctRow.lo_hang_id, ctRow.lot_info),
        dvt
    };

    const qcList = normalizeQuyCachItems(ctRow.lot_info?.quy_cach_items);
    if (qcList.length) {
        return qcList.map((qc) => {
            const qty = qc.so_luong;
            const unitPrice = resolveLineUnitPrice(ctRow, qc);
            const thanhTien = resolveLineThanhTien({
                qty,
                unitPrice,
                giamGia: 0,
                kieuGiam: 'vnd',
                storedThanhTien: qc.thanh_tien
            });
            return Object.assign({}, base, {
                thuoc_tinh: resolveThuocTinhLabel(ctRow, qc.ten_quy_cach),
                so_luong: qty,
                don_gia: unitPrice,
                giam_gia_dong: 0,
                thanh_tien: thanhTien
            });
        });
    }

    const qty = Math.max(0, Number(ctRow.so_luong || 0));
    const unitPrice = resolveLineUnitPrice(ctRow, null);
    const kieuGiam = ctRow.kieu_giam_gia_dong === 'percent' ? 'percent' : 'vnd';
    const giamGiaRaw = Number(ctRow.giam_gia_dong || 0);
    const discountAmount = calcLineDiscountAmount(qty, unitPrice, giamGiaRaw, kieuGiam);
    const thanhTien = resolveLineThanhTien({
        qty,
        unitPrice,
        giamGia: giamGiaRaw,
        kieuGiam,
        storedThanhTien: ctRow.thanh_tien
    });

    return [Object.assign({}, base, {
        thuoc_tinh: resolveThuocTinhLabel(ctRow, ''),
        so_luong: qty,
        don_gia: unitPrice,
        giam_gia_dong: discountAmount,
        thanh_tien: thanhTien
    })];
}

function applyWorksheetFormat(worksheet) {
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FF111827' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: worksheet.columnCount }
    };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    const numericKeys = EXPORT_COLUMNS.filter((c) => c.numeric).map((c) => c.key);
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        numericKeys.forEach((key) => {
            const col = worksheet.getColumn(key);
            if (!col?.number) return;
            const cell = row.getCell(col.number);
            if (cell.value !== '' && cell.value != null && typeof cell.value === 'number') {
                cell.numFmt = '#,##0';
            }
        });
    });
}

async function buildSupplierPurchaseInvoiceExportPack(supplier, storeId) {
    const supplierOid = new mongoose.Types.ObjectId(String(supplier._id));
    const pnMatch = {
        nha_cung_cap_id: supplierOid,
        trang_thai: 'completed',
        trang_thai_du_lieu: { $ne: 'inactive' },
        deleted_at: null
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        pnMatch.cua_hang_id = new mongoose.Types.ObjectId(String(storeId));
    }

    const phieuList = await PhieuNhap.find(pnMatch)
        .setOptions({ strictQuery: false })
        .sort({ ngay_nhap: 1, created_at: 1 })
        .lean();

    const workbook = new ExcelJS.Workbook();
    const wsHeader = workbook.addWorksheet('Thông tin');
    wsHeader.columns = [
        { header: 'Mã NCC', key: 'ma_ncc', width: 14 },
        { header: 'Tên NCC', key: 'ten_ncc', width: 30 },
        { header: 'Số phiếu nhập', key: 'so_phieu', width: 14 },
        { header: 'Ghi chú', key: 'ghi_chu', width: 40 }
    ];
    wsHeader.addRow({
        ma_ncc: supplier.ma_ncc || '',
        ten_ncc: supplier.ten_ncc || '',
        so_phieu: phieuList.length,
        ghi_chu: 'Chi tiết sản phẩm, đơn giá, thành tiền — hóa đơn gộp từ phiếu nhập'
    });
    wsHeader.getRow(1).font = { bold: true };

    const ws = workbook.addWorksheet('Chi tiết hóa đơn gộp');
    ws.columns = EXPORT_COLUMNS;

    if (!phieuList.length) {
        applyWorksheetFormat(ws);
        const safeMa = String(supplier.ma_ncc || 'ncc').replace(/[^\w.-]+/g, '-');
        return { workbook, filename: `ncc-${safeMa}-chi-tiet-san-pham-hoa-don-gop.xlsx` };
    }

    const phieuMap = phieuList.reduce((acc, row) => {
        acc[String(row._id)] = row;
        return acc;
    }, {});
    const phieuIds = phieuList.map((row) => row._id);

    const detailRows = await CTPhieuNhap.find({ phieu_nhap_id: { $in: phieuIds } })
        .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang' })
        .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi' })
        .populate({ path: 'lo_hang_id', select: 'ten_lo ma_lo' })
        .populate({
            path: 'gia_tri_thuoc_tinh_id',
            select: 'ten_gia_tri ma_gia_tri',
            populate: { path: 'thuoc_tinh_id', select: 'ten_thuoc_tinh ma_thuoc_tinh' }
        })
        .lean();

    const orderIndex = phieuIds.reduce((acc, id, index) => {
        acc[String(id)] = index;
        return acc;
    }, {});

    detailRows.sort((a, b) => {
        const pa = orderIndex[String(a.phieu_nhap_id)] ?? 0;
        const pb = orderIndex[String(b.phieu_nhap_id)] ?? 0;
        if (pa !== pb) return pa - pb;
        return String(a._id).localeCompare(String(b._id));
    });

    const exportLines = [];
    detailRows.forEach((ctRow) => {
        const phieu = phieuMap[String(ctRow.phieu_nhap_id)];
        if (!phieu) return;
        expandCtRowToExportLines(ctRow, phieu, supplier).forEach((line) => exportLines.push(line));
    });

    let totalQty = 0;
    let totalAmount = 0;
    exportLines.forEach((line, index) => {
        totalQty += Number(line.so_luong || 0);
        totalAmount += Number(line.thanh_tien || 0);
        ws.addRow({
            stt: index + 1,
            ngay_nhap: line.ngay_nhap,
            ma_phieu_nhap: line.ma_phieu_nhap,
            ma_ncc: line.ma_ncc,
            ten_ncc: line.ten_ncc,
            ma_hang: line.ma_hang,
            ten_hang: line.ten_hang,
            ten_lo: line.ten_lo,
            thuoc_tinh: line.thuoc_tinh,
            dvt: line.dvt,
            so_luong: line.so_luong,
            don_gia: line.don_gia,
            giam_gia_dong: line.giam_gia_dong,
            thanh_tien: line.thanh_tien
        });
    });

    const totalRowIndex = ws.rowCount + 2;
    ws.addRow({});
    const totalRow = ws.addRow({
        stt: '',
        ngay_nhap: '',
        ma_phieu_nhap: '',
        ma_ncc: '',
        ten_ncc: '',
        ma_hang: '',
        ten_hang: 'TỔNG CỘNG',
        ten_lo: '',
        thuoc_tinh: '',
        dvt: '',
        so_luong: totalQty,
        don_gia: '',
        giam_gia_dong: '',
        thanh_tien: totalAmount
    });
    totalRow.font = { bold: true };
    totalRow.getCell(ws.getColumn('ten_hang').number).alignment = { horizontal: 'right' };

    applyWorksheetFormat(ws);

    const safeMa = String(supplier.ma_ncc || 'ncc').replace(/[^\w.-]+/g, '-');
    return {
        workbook,
        filename: `ncc-${safeMa}-chi-tiet-san-pham-hoa-don-gop.xlsx`,
        meta: {
            phieuCount: phieuList.length,
            lineCount: exportLines.length,
            totalQty,
            totalAmount
        }
    };
}

module.exports = {
    buildSupplierPurchaseInvoiceExportPack,
    expandCtRowToExportLines
};
