const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const { ZipArchive } = require('archiver');
const {
    PhieuNhap,
    PhieuTraHangNhap,
    CongNoNhaCungCap,
    GiaoDichCongNoNhaCungCap
} = require('../models/kiot.model');
const {
    SUMMARY_EXPORT_COLUMNS,
    aggregateLedgerByPeriod,
    buildPeriodNote,
    normalizeDebtPeriodQuery
} = require('../utils/debtPeriodExport');

const PARTNER_COLUMNS = [
    { key: 'stt', header: 'STT', width: 8 },
    { key: 'ngay_phieu', header: 'Ngày phiếu nhập', width: 18 },
    { key: 'ma_phieu_nhap', header: 'Mã phiếu nhập', width: 18 },
    { key: 'ten_ncc', header: 'Nhà cung cấp', width: 28 },
    { key: 'tong_tien_nhap', header: 'Tổng tiền nhập', width: 16, numeric: true },
    { key: 'giam_tru_tra_hang', header: 'Giảm trừ / trả hàng', width: 18, numeric: true },
    { key: 'da_thanh_toan', header: 'Đã thanh toán', width: 16, numeric: true },
    { key: 'con_phai_tra', header: 'Còn phải trả', width: 16, numeric: true },
    { key: 'ghi_chu_doi_soat', header: 'Ghi chú đối soát', width: 36 }
];

function slugifyFilePart(value) {
    const s = String(value || 'ncc').trim().replace(/[/\\?%*:|"<>]/g, '-');
    return s.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'ncc';
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

function mapCongNoLoai(value) {
    if (value === 'thanh_toan') return 'Thanh toán';
    if (value === 'giam_no') return 'Giảm nợ';
    return 'Nhập hàng';
}

function getDebtDocumentInfo(row) {
    if (row.phieu_tra_nhap_id) {
        return {
            label: 'Trả hàng nhập',
            code: row.phieu_tra_nhap_id.ma_phieu_tra_nhap || '--'
        };
    }
    if (row.phieu_thu_chi_id) {
        return {
            label: 'Phiếu thu/chi',
            code: row.phieu_thu_chi_id.ma_phieu || '--'
        };
    }
    if (row.phieu_nhap_id) {
        return {
            label: 'Phiếu nhập',
            code: row.phieu_nhap_id.ma_phieu_nhap || '--'
        };
    }
    return { label: 'Khác', code: '--' };
}

function applyWorksheetFormat(worksheet, numericKeys) {
    const keys = numericKeys || [];
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FF111827' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            bottom: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            left: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            right: { style: 'thin', color: { argb: 'FFD8E8FB' } }
        };
    });
    worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: worksheet.columnCount }
    };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        keys.forEach((key) => {
            const col = worksheet.getColumn(key);
            if (!col?.number) return;
            const cell = row.getCell(col.number);
            if (cell.value !== '' && cell.value != null && typeof cell.value === 'number') {
                cell.numFmt = '#,##0';
            }
        });
    });
}

function buildPurchaseQuery(supplierId, storeId) {
    const query = {
        nha_cung_cap_id: new mongoose.Types.ObjectId(String(supplierId)),
        trang_thai: 'completed',
        con_no_ncc: { $gt: 0 }
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        query.cua_hang_id = new mongoose.Types.ObjectId(String(storeId));
    }
    return query;
}

async function loadUnpaidPurchases(supplierId, storeId) {
    return PhieuNhap.find(buildPurchaseQuery(supplierId, storeId))
        .sort({ ngay_nhap: 1, created_at: 1 })
        .select('ma_phieu_nhap ngay_nhap created_at tong_tien can_tra_ncc da_tra_ncc con_no_ncc ghi_chu')
        .lean();
}

async function loadReturnDeductionsByPurchase(purchaseIds, storeId) {
    const map = {};
    if (!purchaseIds.length || !PhieuTraHangNhap) return map;

    const match = {
        phieu_nhap_id: { $in: purchaseIds },
        trang_thai: 'completed'
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        match.cua_hang_id = new mongoose.Types.ObjectId(String(storeId));
    }

    const rows = await PhieuTraHangNhap.find(match)
        .select('phieu_nhap_id ma_phieu_tra_nhap tong_tien_tra ncc_can_tra tinh_vao_cong_no')
        .lean();

    rows.forEach((row) => {
        const pid = String(row.phieu_nhap_id || '');
        if (!pid) return;
        if (!map[pid]) map[pid] = { amount: 0, codes: [] };
        const amount = Math.max(0, Number(row.tong_tien_tra || row.ncc_can_tra || 0));
        if (row.tinh_vao_cong_no === false) return;
        map[pid].amount += amount;
        const code = String(row.ma_phieu_tra_nhap || '').trim();
        if (code) map[pid].codes.push(code);
    });
    return map;
}

function buildPartnerReconcileNote(returnInfo) {
    if (!returnInfo || !returnInfo.codes.length) return '';
    const unique = [...new Set(returnInfo.codes)];
    return 'Phiếu trả hàng nhập: ' + unique.join(', ');
}

function resolvePartnerRowAmounts(purchase, returnInfo) {
    const tongTienNhap = Math.max(0, Number(purchase.can_tra_ncc || purchase.tong_tien || 0));
    const giamTru = Math.max(0, Number(returnInfo?.amount || 0));
    const daThanhToan = Math.max(0, Number(purchase.da_tra_ncc || 0));
    const conNoStored = Math.max(0, Number(purchase.con_no_ncc || 0));
    const conPhaiTra = conNoStored > 0
        ? conNoStored
        : Math.max(0, tongTienNhap - giamTru - daThanhToan);
    return { tongTienNhap, giamTru, daThanhToan, conPhaiTra };
}

async function buildSupplierDebtAdminPack(supplier, storeId) {
    const workbook = new ExcelJS.Workbook();
    const safeMa = slugifyFilePart(supplier.ma_ncc);
    const ws = workbook.addWorksheet('Công nợ');
    ws.columns = [
        { header: 'Ngày', key: 'ngay', width: 20 },
        { header: 'Nhà cung cấp', key: 'nha_cung_cap', width: 28 },
        { header: 'Loại phát sinh', key: 'loai_phat_sinh', width: 16 },
        { header: 'Loại chứng từ', key: 'loai_chung_tu', width: 18 },
        { header: 'Mã chứng từ', key: 'ma_chung_tu', width: 18 },
        { header: 'Số tiền tăng nợ', key: 'tang_no', style: { numFmt: '#,##0' } },
        { header: 'Số tiền giảm nợ', key: 'giam_no', style: { numFmt: '#,##0' } },
        { header: 'Nợ còn lại', key: 'no_con_lai', style: { numFmt: '#,##0' } },
        { header: 'Ghi chú', key: 'ghi_chu', width: 36 }
    ];

    const debtMatch = { nha_cung_cap_id: supplier._id };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        debtMatch.cua_hang_id = storeId;
    }

    const debtRows = await CongNoNhaCungCap.find(debtMatch)
        .populate({ path: 'phieu_nhap_id', select: 'ma_phieu_nhap' })
        .populate({ path: 'phieu_tra_nhap_id', select: 'ma_phieu_tra_nhap' })
        .populate({ path: 'phieu_thu_chi_id', select: 'ma_phieu loai_phieu loai_thu_chi' })
        .sort({ ngay: 1, created_at: 1 })
        .lean();

    let runningDebt = 0;
    debtRows.forEach((row) => {
        const amount = Number(row.so_tien || 0);
        if (row.loai === 'tang_no') runningDebt += amount;
        if (row.loai === 'giam_no' || row.loai === 'thanh_toan') runningDebt -= amount;
        const docInfo = getDebtDocumentInfo(row);
        ws.addRow({
            ngay: formatExportDate(row.ngay || row.created_at),
            nha_cung_cap: supplier.ten_ncc || supplier.ma_ncc || '',
            loai_phat_sinh: mapCongNoLoai(row.loai),
            loai_chung_tu: docInfo.label,
            ma_chung_tu: docInfo.code,
            tang_no: row.loai === 'tang_no' ? amount : 0,
            giam_no: row.loai === 'giam_no' || row.loai === 'thanh_toan' ? amount : 0,
            no_con_lai: runningDebt,
            ghi_chu: row.ghi_chu || ''
        });
    });

    applyWorksheetFormat(ws, ['tang_no', 'giam_no', 'no_con_lai']);
    return {
        workbook,
        filename: `ncc-${safeMa}-cong-no-quan-tri.xlsx`
    };
}

async function buildSupplierDebtPartnerPack(supplier, storeId) {
    const workbook = new ExcelJS.Workbook();
    const safeMa = slugifyFilePart(supplier.ma_ncc);
    const ws = workbook.addWorksheet('Gửi đối tác');
    ws.columns = PARTNER_COLUMNS;

    const purchases = await loadUnpaidPurchases(supplier._id, storeId);
    const purchaseIds = purchases.map((row) => row._id);
    const returnMap = await loadReturnDeductionsByPurchase(purchaseIds, storeId);
    const supplierName = supplier.ten_ncc || supplier.ten_cong_ty || supplier.ma_ncc || '';

    let totalConPhaiTra = 0;
    purchases.forEach((purchase, index) => {
        const returnInfo = returnMap[String(purchase._id)] || { amount: 0, codes: [] };
        const amounts = resolvePartnerRowAmounts(purchase, returnInfo);
        totalConPhaiTra += amounts.conPhaiTra;
        ws.addRow({
            stt: index + 1,
            ngay_phieu: formatExportDate(purchase.ngay_nhap || purchase.created_at),
            ma_phieu_nhap: purchase.ma_phieu_nhap || '',
            ten_ncc: supplierName,
            tong_tien_nhap: amounts.tongTienNhap,
            giam_tru_tra_hang: amounts.giamTru,
            da_thanh_toan: amounts.daThanhToan,
            con_phai_tra: amounts.conPhaiTra,
            ghi_chu_doi_soat: buildPartnerReconcileNote(returnInfo)
        });
    });

    if (purchases.length) {
        ws.addRow({});
        const totalRow = ws.addRow({
            stt: '',
            ngay_phieu: '',
            ma_phieu_nhap: '',
            ten_ncc: '',
            tong_tien_nhap: '',
            giam_tru_tra_hang: '',
            da_thanh_toan: 'Tổng còn phải trả',
            con_phai_tra: totalConPhaiTra,
            ghi_chu_doi_soat: ''
        });
        totalRow.font = { bold: true };
        const labelCol = ws.getColumn('da_thanh_toan').number;
        if (labelCol) {
            totalRow.getCell(labelCol).alignment = { horizontal: 'right' };
        }
    }

    applyWorksheetFormat(
        ws,
        PARTNER_COLUMNS.filter((col) => col.numeric).map((col) => col.key)
    );

    return {
        workbook,
        filename: `ncc-${safeMa}-cong-no-gui-doi-tac.xlsx`,
        meta: { purchaseCount: purchases.length, totalConPhaiTra }
    };
}

async function workbookToBuffer(workbook) {
    return workbook.xlsx.writeBuffer();
}

function streamZipToResponse(res, entries, zipFilename) {
    return new Promise((resolve, reject) => {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="' + zipFilename + '"');

        const archive = new ZipArchive({ zlib: { level: 9 } });
        archive.on('error', reject);
        res.on('error', reject);
        res.on('finish', resolve);
        archive.pipe(res);

        entries.forEach((entry) => {
            const body = Buffer.isBuffer(entry.buffer) ? entry.buffer : Buffer.from(entry.buffer);
            archive.append(body, { name: entry.filename });
        });

        archive.finalize();
    });
}

async function sendSupplierDebtZip(res, supplier, storeId) {
    const safeMa = slugifyFilePart(supplier.ma_ncc);
    const adminPack = await buildSupplierDebtAdminPack(supplier, storeId);
    const partnerPack = await buildSupplierDebtPartnerPack(supplier, storeId);
    const adminBuffer = await workbookToBuffer(adminPack.workbook);
    const partnerBuffer = await workbookToBuffer(partnerPack.workbook);

    return streamZipToResponse(res, [
        { filename: adminPack.filename, buffer: adminBuffer },
        { filename: partnerPack.filename, buffer: partnerBuffer }
    ], `ncc-${safeMa}-cong-no.zip`);
}

function normalizeDebtExportFileMode(raw) {
    const mode = String(raw || '').trim().toLowerCase();
    if (['quan-tri', 'quan_tri', 'admin', 'internal', 'quan-tri-noi-bo'].includes(mode)) return 'quan-tri';
    if (['doi-tac', 'doi_tac', 'partner', 'gui-doi-tac', 'gui_doi_tac'].includes(mode)) return 'doi-tac';
    return 'both';
}

async function loadSupplierLedgerRows(supplierId, storeId) {
    const debtMatch = { nha_cung_cap_id: supplierId };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        debtMatch.cua_hang_id = storeId;
    }

    const legacyRows = await CongNoNhaCungCap.find(debtMatch)
        .select('ngay created_at loai so_tien')
        .sort({ ngay: 1, created_at: 1 })
        .lean();

    const normalized = legacyRows.map((row) => ({
        ngay: row.ngay || row.created_at,
        loai: row.loai,
        so_tien: row.so_tien
    }));

    if (GiaoDichCongNoNhaCungCap) {
        const txMatch = { nha_cung_cap_id: supplierId };
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
            txMatch.cua_hang_id = storeId;
        }
        const txRows = await GiaoDichCongNoNhaCungCap.find(txMatch)
            .select('ngay_giao_dich created_at huong_cong_no gia_tri')
            .sort({ ngay_giao_dich: 1, created_at: 1 })
            .lean();
        txRows.forEach((row) => {
            normalized.push({
                ngay: row.ngay_giao_dich || row.created_at,
                loai: row.huong_cong_no,
                so_tien: row.gia_tri
            });
        });
    }

    normalized.sort((a, b) => new Date(a.ngay || 0).getTime() - new Date(b.ngay || 0).getTime());
    return normalized;
}

function computeSupplierPeriodSummary(supplier, ledgerRows, period) {
    const totals = aggregateLedgerByPeriod(ledgerRows, period.rangeStart, period.rangeEnd);
    return {
        ma_doi_tuong: supplier.ma_ncc || '',
        ten_doi_tuong: supplier.ten_ncc || supplier.ten_cong_ty || '',
        opening: Math.floor(totals.opening),
        periodIncrease: totals.periodIncrease,
        periodDecrease: totals.periodDecrease,
        closing: totals.closing
    };
}

function buildSupplierPeriodSummaryWorkbook(rows, period, sheetTitle) {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet(sheetTitle || 'Tổng hợp công nợ');
    ws.columns = SUMMARY_EXPORT_COLUMNS;

    rows.forEach((row, index) => {
        ws.addRow({
            stt: index + 1,
            ma_doi_tuong: row.ma_doi_tuong || '',
            ten_doi_tuong: row.ten_doi_tuong || '',
            so_du_dau_ky: row.opening,
            phat_sinh_trong_ky: row.periodIncrease,
            da_tra_giam_trong_ky: row.periodDecrease,
            con_lai_cuoi_ky: row.closing,
            ghi_chu: row.ghi_chu || ''
        });
    });

    applyWorksheetFormat(
        ws,
        SUMMARY_EXPORT_COLUMNS.filter((col) => col.numeric).map((col) => col.key)
    );
    return workbook;
}

async function buildSupplierDebtPeriodPack(supplier, storeId, period, fileKind) {
    const ledgerRows = await loadSupplierLedgerRows(supplier._id, storeId);
    const summary = computeSupplierPeriodSummary(supplier, ledgerRows, period);
    const isPartner = fileKind === 'doi-tac';
    summary.ghi_chu = buildPeriodNote(
        period,
        isPartner ? 'Đối soát công nợ nhà cung cấp' : 'Báo cáo công nợ quản trị NCC'
    );

    const workbook = buildSupplierPeriodSummaryWorkbook(
        [summary],
        period,
        isPartner ? 'Gửi đối tác' : 'Quản trị'
    );

    const suffix = period.fileSuffix;
    const filename = isPartner
        ? `ncc-cong-no-gui-doi-tac-${suffix}.xlsx`
        : `ncc-cong-no-quan-tri-${suffix}.xlsx`;

    return { workbook, filename };
}

async function sendSupplierDebtPeriodZip(res, supplier, storeId, period) {
    const adminPack = await buildSupplierDebtPeriodPack(supplier, storeId, period, 'quan-tri');
    const partnerPack = await buildSupplierDebtPeriodPack(supplier, storeId, period, 'doi-tac');
    const adminBuffer = await workbookToBuffer(adminPack.workbook);
    const partnerBuffer = await workbookToBuffer(partnerPack.workbook);
    return streamZipToResponse(res, [
        { filename: adminPack.filename, buffer: adminBuffer },
        { filename: partnerPack.filename, buffer: partnerBuffer }
    ], `ncc-cong-no-${period.fileSuffix}.zip`);
}

async function handleSupplierDebtExport(res, supplier, storeId, query) {
    const period = normalizeDebtPeriodQuery(query);
    if (period.error) {
        const err = new Error(period.error);
        err.code = 'INVALID_DEBT_PERIOD';
        throw err;
    }

    const fileMode = normalizeDebtExportFileMode(query.file || query.variant);

    if (period.periodMode === 'range') {
        if (fileMode === 'both') {
            await sendSupplierDebtPeriodZip(res, supplier, storeId, period);
            return;
        }
        const pack = await buildSupplierDebtPeriodPack(supplier, storeId, period, fileMode);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="' + pack.filename + '"');
        await pack.workbook.xlsx.write(res);
        res.end();
        return;
    }

    if (fileMode === 'both') {
        await sendSupplierDebtZip(res, supplier, storeId);
        return;
    }
    const pack = fileMode === 'doi-tac'
        ? await buildSupplierDebtPartnerPack(supplier, storeId)
        : await buildSupplierDebtAdminPack(supplier, storeId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + pack.filename + '"');
    await pack.workbook.xlsx.write(res);
    res.end();
}

module.exports = {
    buildSupplierDebtAdminPack,
    buildSupplierDebtPartnerPack,
    sendSupplierDebtZip,
    normalizeDebtExportFileMode,
    normalizeDebtPeriodQuery,
    handleSupplierDebtExport,
    loadUnpaidPurchases,
    resolvePartnerRowAmounts
};
