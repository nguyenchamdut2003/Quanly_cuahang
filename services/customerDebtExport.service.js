const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const { ZipArchive } = require('archiver');
const {
    CongNoKhachHang,
    GiaoDichCongNoKhachHang,
    DonHang,
    PhieuTraHang
} = require('../models/kiot.model');
const {
    SUMMARY_EXPORT_COLUMNS,
    aggregateLedgerByPeriod,
    buildPeriodNote,
    normalizeDebtPeriodQuery
} = require('../utils/debtPeriodExport');

const PARTNER_COLUMNS = [
    { key: 'stt', header: 'STT', width: 8 },
    { key: 'ngay_chung_tu', header: 'Ngày chứng từ', width: 18 },
    { key: 'ma_chung_tu', header: 'Mã chứng từ', width: 18 },
    { key: 'ten_khach', header: 'Khách hàng', width: 28 },
    { key: 'tong_tien', header: 'Tổng tiền', width: 16, numeric: true },
    { key: 'giam_tru_tra_hang', header: 'Giảm trừ / trả hàng', width: 18, numeric: true },
    { key: 'da_thanh_toan', header: 'Đã thanh toán', width: 16, numeric: true },
    { key: 'con_phai_tra', header: 'Còn phải trả', width: 16, numeric: true },
    { key: 'ghi_chu_doi_soat', header: 'Ghi chú đối soát', width: 36 }
];

function slugifyFilePart(value) {
    const s = String(value || 'kh').trim().replace(/[/\\?%*:|"<>]/g, '-');
    return s.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'kh';
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
    return 'Phát sinh nợ';
}

function getCustomerDebtDocumentInfo(row) {
    if (row.hoa_don_id && typeof row.hoa_don_id === 'object') {
        return { label: 'Hóa đơn', code: row.hoa_don_id.ma_hoa_don || '--' };
    }
    if (row.don_hang_id && typeof row.don_hang_id === 'object') {
        return { label: 'Đơn hàng', code: row.don_hang_id.ma_don_hang || '--' };
    }
    if (row.phieu_thu_chi_id && typeof row.phieu_thu_chi_id === 'object') {
        return { label: 'Phiếu thu/chi', code: row.phieu_thu_chi_id.ma_phieu || '--' };
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

function normalizeDebtExportFileMode(raw) {
    const mode = String(raw || '').trim().toLowerCase();
    if (['quan-tri', 'quan_tri', 'admin', 'internal'].includes(mode)) return 'quan-tri';
    if (['doi-tac', 'doi_tac', 'partner', 'gui-doi-tac', 'gui_doi_tac'].includes(mode)) return 'doi-tac';
    return 'both';
}

async function loadCustomerLedgerRows(customerId) {
    const legacyRows = await CongNoKhachHang.find({ khach_hang_id: customerId })
        .select('ngay created_at loai so_tien')
        .sort({ ngay: 1, created_at: 1 })
        .lean();

    const normalized = legacyRows.map((row) => ({
        ngay: row.ngay || row.created_at,
        loai: row.loai,
        so_tien: row.so_tien
    }));

    if (GiaoDichCongNoKhachHang) {
        const txRows = await GiaoDichCongNoKhachHang.find({
            khach_hang_id: customerId,
            trang_thai: 'active'
        })
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

async function buildCustomerDebtAdminPack(customer) {
    const workbook = new ExcelJS.Workbook();
    const safeMa = slugifyFilePart(customer.ma_khach_hang);
    const ws = workbook.addWorksheet('Công nợ');
    ws.columns = [
        { header: 'Ngày', key: 'ngay', width: 20 },
        { header: 'Khách hàng', key: 'khach_hang', width: 28 },
        { header: 'Loại phát sinh', key: 'loai_phat_sinh', width: 16 },
        { header: 'Loại chứng từ', key: 'loai_chung_tu', width: 18 },
        { header: 'Mã chứng từ', key: 'ma_chung_tu', width: 18 },
        { header: 'Số tiền tăng nợ', key: 'tang_no', style: { numFmt: '#,##0' } },
        { header: 'Số tiền giảm nợ', key: 'giam_no', style: { numFmt: '#,##0' } },
        { header: 'Nợ còn lại', key: 'no_con_lai', style: { numFmt: '#,##0' } },
        { header: 'Ghi chú', key: 'ghi_chu', width: 36 }
    ];

    const debtRows = await CongNoKhachHang.find({ khach_hang_id: customer._id })
        .populate('hoa_don_id', 'ma_hoa_don')
        .populate('don_hang_id', 'ma_don_hang')
        .populate('phieu_thu_chi_id', 'ma_phieu')
        .sort({ ngay: 1, created_at: 1 })
        .lean();

    let runningDebt = 0;
    debtRows.forEach((row) => {
        const amount = Number(row.so_tien || 0);
        if (row.loai === 'tang_no') runningDebt += amount;
        if (row.loai === 'giam_no' || row.loai === 'thanh_toan') runningDebt -= amount;
        const docInfo = getCustomerDebtDocumentInfo(row);
        ws.addRow({
            ngay: formatExportDate(row.ngay || row.created_at),
            khach_hang: customer.ten_khach_hang || customer.ma_khach_hang || '',
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
        filename: `khach-hang-${safeMa}-cong-no.xlsx`
    };
}

async function loadReturnDeductionsByOrder(orderIds) {
    const map = {};
    if (!orderIds.length || !PhieuTraHang) return map;

    const rows = await PhieuTraHang.find({
        don_hang_id: { $in: orderIds },
        trang_thai: { $ne: 'cancelled' }
    })
        .select('don_hang_id ma_phieu_tra can_tra_khach tong_tien_tra')
        .lean();

    rows.forEach((row) => {
        const oid = String(row.don_hang_id || '');
        if (!oid) return;
        if (!map[oid]) map[oid] = { amount: 0, codes: [] };
        map[oid].amount += Math.max(0, Number(row.can_tra_khach || row.tong_tien_tra || 0));
        const code = String(row.ma_phieu_tra || '').trim();
        if (code) map[oid].codes.push(code);
    });
    return map;
}

async function buildCustomerDebtPartnerPack(customer) {
    const workbook = new ExcelJS.Workbook();
    const safeMa = slugifyFilePart(customer.ma_khach_hang);
    const ws = workbook.addWorksheet('Gửi đối tác');
    ws.columns = PARTNER_COLUMNS;

    const orders = await DonHang.find({
        khach_hang_id: customer._id,
        khach_can_tra: { $gt: 0 },
        trang_thai: { $nin: ['cancelled', 'draft', 'huy'] }
    })
        .sort({ ngay_dat: 1, created_at: 1 })
        .select('ma_don_hang ngay_dat created_at tong_thanh_toan tong_tien khach_thanh_toan khach_can_tra ghi_chu')
        .lean();

    const orderIds = orders.map((row) => row._id);
    const returnMap = await loadReturnDeductionsByOrder(orderIds);
    const customerName = customer.ten_khach_hang || customer.ten_ca_nhan || customer.ma_khach_hang || '';

    let totalConPhaiTra = 0;
    orders.forEach((order, index) => {
        const returnInfo = returnMap[String(order._id)] || { amount: 0, codes: [] };
        const tongTien = Math.max(0, Number(order.tong_thanh_toan || order.tong_tien || 0));
        const giamTru = Math.max(0, Number(returnInfo.amount || 0));
        const daThanhToan = Math.max(0, Number(order.khach_thanh_toan || 0));
        const conPhaiTra = Math.max(0, Number(order.khach_can_tra || 0));
        totalConPhaiTra += conPhaiTra;

        const note = returnInfo.codes.length
            ? 'Phiếu trả hàng: ' + [...new Set(returnInfo.codes)].join(', ')
            : '';

        ws.addRow({
            stt: index + 1,
            ngay_chung_tu: formatExportDate(order.ngay_dat || order.created_at),
            ma_chung_tu: order.ma_don_hang || '',
            ten_khach: customerName,
            tong_tien: tongTien,
            giam_tru_tra_hang: giamTru,
            da_thanh_toan: daThanhToan,
            con_phai_tra: conPhaiTra,
            ghi_chu_doi_soat: note
        });
    });

    if (orders.length) {
        ws.addRow({});
        const totalRow = ws.addRow({
            stt: '',
            ngay_chung_tu: '',
            ma_chung_tu: '',
            ten_khach: '',
            tong_tien: '',
            giam_tru_tra_hang: '',
            da_thanh_toan: 'Tổng còn phải trả',
            con_phai_tra: totalConPhaiTra,
            ghi_chu_doi_soat: ''
        });
        totalRow.font = { bold: true };
    }

    applyWorksheetFormat(ws, PARTNER_COLUMNS.filter((col) => col.numeric).map((col) => col.key));
    return {
        workbook,
        filename: `kh-${safeMa}-cong-no-gui-doi-tac.xlsx`
    };
}

function computeCustomerPeriodSummary(customer, ledgerRows, period) {
    const totals = aggregateLedgerByPeriod(ledgerRows, period.rangeStart, period.rangeEnd);
    return {
        ma_doi_tuong: customer.ma_khach_hang || '',
        ten_doi_tuong: customer.ten_khach_hang || customer.ten_ca_nhan || '',
        ...totals
    };
}

function buildCustomerPeriodSummaryWorkbook(rows, period, sheetTitle) {
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

async function buildCustomerDebtPeriodPack(customer, period, fileKind) {
    const ledgerRows = await loadCustomerLedgerRows(customer._id);
    const summary = computeCustomerPeriodSummary(customer, ledgerRows, period);
    const isPartner = fileKind === 'doi-tac';
    summary.ghi_chu = buildPeriodNote(
        period,
        isPartner ? 'Đối soát công nợ khách hàng' : 'Báo cáo công nợ quản trị KH'
    );

    const workbook = buildCustomerPeriodSummaryWorkbook(
        [summary],
        period,
        isPartner ? 'Gửi đối tác' : 'Quản trị'
    );

    const suffix = period.fileSuffix;
    const filename = isPartner
        ? `kh-cong-no-gui-doi-tac-${suffix}.xlsx`
        : `kh-cong-no-quan-tri-${suffix}.xlsx`;

    return { workbook, filename };
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

async function sendCustomerDebtZip(res, customer) {
    const safeMa = slugifyFilePart(customer.ma_khach_hang);
    const adminPack = await buildCustomerDebtAdminPack(customer);
    const partnerPack = await buildCustomerDebtPartnerPack(customer);
    const adminBuffer = await workbookToBuffer(adminPack.workbook);
    const partnerBuffer = await workbookToBuffer(partnerPack.workbook);

    return streamZipToResponse(res, [
        { filename: adminPack.filename, buffer: adminBuffer },
        { filename: partnerPack.filename, buffer: partnerBuffer }
    ], `kh-${safeMa}-cong-no.zip`);
}

async function sendCustomerDebtPeriodZip(res, customer, period) {
    const adminPack = await buildCustomerDebtPeriodPack(customer, period, 'quan-tri');
    const partnerPack = await buildCustomerDebtPeriodPack(customer, period, 'doi-tac');
    const adminBuffer = await workbookToBuffer(adminPack.workbook);
    const partnerBuffer = await workbookToBuffer(partnerPack.workbook);

    return streamZipToResponse(res, [
        { filename: adminPack.filename, buffer: adminBuffer },
        { filename: partnerPack.filename, buffer: partnerBuffer }
    ], `kh-cong-no-${period.fileSuffix}.zip`);
}

async function handleCustomerDebtExport(res, customer, query) {
    const period = normalizeDebtPeriodQuery(query);
    if (period.error) {
        const err = new Error(period.error);
        err.code = 'INVALID_DEBT_PERIOD';
        throw err;
    }

    const fileMode = normalizeDebtExportFileMode(query.file || query.variant);

    if (period.periodMode === 'range') {
        if (fileMode === 'both') {
            await sendCustomerDebtPeriodZip(res, customer, period);
            return;
        }
        const pack = await buildCustomerDebtPeriodPack(customer, period, fileMode);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="' + pack.filename + '"');
        await pack.workbook.xlsx.write(res);
        res.end();
        return;
    }

    if (fileMode === 'both') {
        await sendCustomerDebtZip(res, customer);
        return;
    }

    const pack = fileMode === 'doi-tac'
        ? await buildCustomerDebtPartnerPack(customer)
        : await buildCustomerDebtAdminPack(customer);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + pack.filename + '"');
    await pack.workbook.xlsx.write(res);
    res.end();
}

module.exports = {
    handleCustomerDebtExport,
    normalizeDebtPeriodQuery,
    normalizeDebtExportFileMode
};
