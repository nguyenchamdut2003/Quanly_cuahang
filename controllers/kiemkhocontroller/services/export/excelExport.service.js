const ExcelJS = require('exceljs');
const { lotDisplayFromPopulated } = require('../../helpers/common.helper');
const { buildKiemKhoFilter } = require('../../helpers/filter.helper');
const { PhieuKiemKho, CTPhieuKiemKho } = require('../../../../models/kiot.model');

const KIEM_KHO_EXPORT_STATUS_MAP = {
    pending: 'Phiếu tạm',
    completed: 'Đã cân bằng kho',
    cancelled: 'Đã hủy'
};

const KIEM_KHO_EXPORT_COLUMN_DEFS = [
    { group: 'phieu', key: 'ma_kiem_kho', header: 'Mã kiểm kho', default: true },
    { group: 'phieu', key: 'thoi_gian', header: 'Thời gian', default: true },
    { group: 'phieu', key: 'ngay_can_bang', header: 'Ngày cân bằng', default: true },
    { group: 'phieu', key: 'kho', header: 'Kho', default: true },
    { group: 'phieu', key: 'cua_hang', header: 'Cửa hàng' },
    { group: 'phieu', key: 'nguoi_tao', header: 'Người tạo', default: true },
    { group: 'phieu', key: 'trang_thai', header: 'Trạng thái', default: true },
    { group: 'phieu', key: 'ghi_chu', header: 'Ghi chú' },
    { group: 'phieu', key: 'tong_so_luong_thuc_te', header: 'SL thực tế', style: { numFmt: '#,##0.##' }, default: true },
    { group: 'phieu', key: 'tong_gia_tri_thuc_te', header: 'Tổng thực tế', style: { numFmt: '#,##0' } },
    { group: 'phieu', key: 'tong_so_luong_lech', header: 'Tổng chênh lệch', style: { numFmt: '#,##0.##' }, default: true },
    { group: 'phieu', key: 'sl_lech_tang', header: 'SL lệch tăng', style: { numFmt: '#,##0.##' }, default: true },
    { group: 'phieu', key: 'sl_lech_giam', header: 'SL lệch giảm', style: { numFmt: '#,##0.##' }, default: true },
    { group: 'phieu', key: 'gia_tri_lech', header: 'Giá trị chênh lệch', style: { numFmt: '#,##0' }, default: true },
    { group: 'chi_tiet', key: 'ma_hang', header: 'Mã hàng', default: true },
    { group: 'chi_tiet', key: 'ten_hang', header: 'Tên hàng', default: true },
    { group: 'chi_tiet', key: 'thuong_hieu', header: 'Thương hiệu' },
    { group: 'chi_tiet', key: 'don_vi_tinh', header: 'Đơn vị tính', default: true },
    { group: 'chi_tiet', key: 'ten_lo', header: 'Tên lô', default: true },
    { group: 'chi_tiet', key: 'ma_lo', header: 'Mã lô' },
    { group: 'chi_tiet', key: 'thuoc_tinh', header: 'Thuộc tính', default: true },
    { group: 'chi_tiet', key: 'ton_kho_he_thong', header: 'Tồn kho', style: { numFmt: '#,##0.##' }, default: true },
    { group: 'chi_tiet', key: 'so_luong_thuc_te', header: 'KiỒm thực tế', style: { numFmt: '#,##0.##' }, default: true },
    { group: 'chi_tiet', key: 'so_luong_lech', header: 'SL lệch', style: { numFmt: '#,##0.##' }, default: true },
    { group: 'chi_tiet', key: 'gia_tri_lech_dong', header: 'Giá trị lệch', style: { numFmt: '#,##0' }, default: true },
    { group: 'chi_tiet', key: 'nguyen_nhan_lech', header: 'Nguyên nhân lệch' }
];

const KIEM_KHO_EXPORT_COLUMN_MAP = KIEM_KHO_EXPORT_COLUMN_DEFS.reduce(function(map, item) {
    map[item.key] = item;
    return map;
}, {});

const KIEM_KHO_EXPORT_COLUMN_GROUPS = [
    { id: 'phieu', title: 'Thông tin phiếu kiểm kho' },
    { id: 'chi_tiet', title: 'Chi tiết kiểm kho' }
].map(function(group) {
    return Object.assign({}, group, {
        columns: KIEM_KHO_EXPORT_COLUMN_DEFS.filter(function(item) { return item.group === group.id; })
    });
});

const KIEM_KHO_EXPORT_COLUMNS = KIEM_KHO_EXPORT_COLUMN_DEFS.map(function(item) {
    return Object.assign({ header: item.header, key: item.key }, item.style ? { style: item.style } : {});
});

function getKiemKhoExportColumnGroupsForView() {
    return KIEM_KHO_EXPORT_COLUMN_GROUPS.map(function(group) {
        return {
            id: group.id,
            title: group.title,
            columns: group.columns.map(function(col) {
                return { key: col.key, header: col.header, default: !!col.default };
            })
        };
    });
}

function resolveKiemKhoExportColumns(rawKeys) {
    if (!rawKeys) return KIEM_KHO_EXPORT_COLUMNS;
    const keys = Array.isArray(rawKeys) ? rawKeys : [rawKeys];
    const selected = keys.map(function(key) { return String(key || '').trim(); }).filter(function(key) { return KIEM_KHO_EXPORT_COLUMN_MAP[key]; });
    if (!selected.length) return [];
    return selected.map(function(key) {
        const def = KIEM_KHO_EXPORT_COLUMN_MAP[key];
        return Object.assign({ header: def.header, key: def.key }, def.style ? { style: def.style } : {});
    });
}

function formatKiemKhoExportDateTime(value) {
    if (!value) return '';
    return new Date(value).toLocaleString('vi-VN', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
    });
}

function getKiemKhoCreatorName(user) {
    if (!user) return '';
    return user.ho_ten || user.username || user.email || '';
}

function buildKiemKhoTicketSummary(details) {
    const summary = { positive: 0, negative: 0, actual: 0, value: 0 };
    (details || []).forEach(function(item) {
        const diff = Number(item.so_luong_lech || 0);
        if (diff > 0) summary.positive += diff;
        if (diff < 0) summary.negative += Math.abs(diff);
        summary.actual += Number(item.so_luong_thuc_te || 0);
        summary.value += Number(item.gia_tri_lech || 0);
    });
    return summary;
}

function buildKiemKhoExportRow(ticket, detail, summary) {
    const product = detail && detail.hang_hoa_id ? detail.hang_hoa_id : {};
    const lot = detail && detail.lo_hang_id ? detail.lo_hang_id : {};
    const ticketSummary = summary || { positive: 0, negative: 0, actual: 0, value: 0 };
    return {
        ma_kiem_kho: ticket.ma_kiem_kho || '',
        thoi_gian: formatKiemKhoExportDateTime(ticket.ngay_kiem || ticket.created_at),
        ngay_can_bang: ticket.trang_thai === 'completed' ? formatKiemKhoExportDateTime(ticket.ngay_kiem || ticket.updated_at || ticket.created_at) : '',
        kho: ticket.kho_id ? (ticket.kho_id.ten_kho || ticket.kho_id.ma_kho || '') : '',
        cua_hang: ticket.cua_hang_id ? (ticket.cua_hang_id.ten_cua_hang || '') : '',
        nguoi_tao: getKiemKhoCreatorName(ticket.nguoi_tao_id),
        trang_thai: KIEM_KHO_EXPORT_STATUS_MAP[ticket.trang_thai] || ticket.trang_thai || '',
        ghi_chu: ticket.ghi_chu || '',
        tong_so_luong_thuc_te: Number(ticket.tong_so_luong_thuc_te || ticketSummary.actual || 0),
        tong_gia_tri_thuc_te: Number(ticket.tong_gia_tri_thuc_te || 0),
        tong_so_luong_lech: Number(ticket.tong_so_luong_lech || 0),
        sl_lech_tang: Number(ticketSummary.positive || 0),
        sl_lech_giam: Number(ticketSummary.negative || 0),
        gia_tri_lech: Number(ticket.tong_gia_tri_lech || ticketSummary.value || 0),
        ma_hang: detail && product.ma_hang ? product.ma_hang : '',
        ten_hang: detail && product.ten_hang ? product.ten_hang : '',
        thuong_hieu: detail && product.thuong_hieu_id ? (product.thuong_hieu_id.ten_thuong_hieu || '') : '',
        don_vi_tinh: detail && product.don_vi_tinh_id ? (product.don_vi_tinh_id.ten_don_vi || product.don_vi_tinh_id.ma_don_vi || '') : '',
        ten_lo: detail ? lotDisplayFromPopulated(lot) : '',
        ma_lo: detail && lot.ma_lo ? lot.ma_lo : '',
        thuoc_tinh: detail ? (detail.ten_quy_cach || '') : '',
        ton_kho_he_thong: detail ? Number(detail.ton_kho_he_thong || 0) : '',
        so_luong_thuc_te: detail ? Number(detail.so_luong_thuc_te || 0) : '',
        so_luong_lech: detail ? Number(detail.so_luong_lech || 0) : '',
        gia_tri_lech_dong: detail ? Number(detail.gia_tri_lech || 0) : '',
        nguyen_nhan_lech: detail ? (detail.nguyen_nhan_lech || '') : ''
    };
}

function pickKiemKhoExportRowValues(row, columns) {
    const picked = {};
    columns.forEach(function(column) { picked[column.key] = row[column.key]; });
    return picked;
}

function applyKiemKhoExportWorksheetFormat(worksheet, columnCount) {
    const totalColumns = columnCount || worksheet.columnCount || KIEM_KHO_EXPORT_COLUMNS.length;
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell(function(cell) {
        cell.font = { bold: true, color: { argb: 'FF111827' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = { top: { style: 'thin', color: { argb: 'FFD8E8FB' } }, bottom: { style: 'thin', color: { argb: 'FFD8E8FB' } }, left: { style: 'thin', color: { argb: 'FFD8E8FB' } }, right: { style: 'thin', color: { argb: 'FFD8E8FB' } } };
    });
    worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: totalColumns } };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.eachRow(function(row, rowNumber) {
        if (rowNumber === 1) return;
        row.eachCell(function(cell) {
            cell.border = { top: { style: 'thin', color: { argb: 'FFE5E7EB' } }, bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } }, left: { style: 'thin', color: { argb: 'FFE5E7EB' } }, right: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
            cell.alignment = { vertical: 'middle' };
        });
    });
    worksheet.columns.forEach(function(column) {
        let maxLength = String(column.header || '').length;
        column.eachCell({ includeEmpty: true }, function(cell) {
            const value = cell.value == null ? '' : String(cell.value);
            maxLength = Math.max(maxLength, value.length);
        });
        column.width = Math.min(Math.max(maxLength + 2, 12), 36);
    });
}

async function loadKiemKhoExportData(query) {
    const { filter } = buildKiemKhoFilter(query || {});
    const tickets = await PhieuKiemKho.find(filter).populate('cua_hang_id').populate('kho_id').populate('nguoi_tao_id').sort({ ngay_kiem: -1, created_at: -1 });
    const ticketIds = tickets.map(function(ticket) { return ticket._id; });
    const details = ticketIds.length
        ? await CTPhieuKiemKho.find({ phieu_kiem_kho_id: { $in: ticketIds } }).populate({ path: 'hang_hoa_id', populate: [{ path: 'thuong_hieu_id' }, { path: 'don_vi_tinh_id' }] }).populate('lo_hang_id').sort({ created_at: 1 })
        : [];
    const detailMap = details.reduce(function(acc, detail) {
        const key = String(detail.phieu_kiem_kho_id);
        if (!acc[key]) acc[key] = [];
        acc[key].push(detail);
        return acc;
    }, {});
    return { tickets, detailMap };
}

async function buildKiemKhoWorkbook({ tickets, detailMap, columns }) {
    const selectedColumns = columns && columns.length ? columns : KIEM_KHO_EXPORT_COLUMNS;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('KiỒm kho');
    worksheet.columns = selectedColumns;
    tickets.forEach(function(ticket) {
        const details = detailMap[String(ticket._id)] || [];
        const summary = buildKiemKhoTicketSummary(details);
        if (!details.length) {
            worksheet.addRow(pickKiemKhoExportRowValues(buildKiemKhoExportRow(ticket, null, summary), selectedColumns));
            return;
        }
        details.forEach(function(detail) {
            worksheet.addRow(pickKiemKhoExportRowValues(buildKiemKhoExportRow(ticket, detail, summary), selectedColumns));
        });
    });
    applyKiemKhoExportWorksheetFormat(worksheet, selectedColumns.length);
    return { workbook, filename: 'kiem-kho.xlsx' };
}

module.exports = {
    KIEM_KHO_EXPORT_STATUS_MAP,
    KIEM_KHO_EXPORT_COLUMN_DEFS,
    KIEM_KHO_EXPORT_COLUMN_MAP,
    KIEM_KHO_EXPORT_COLUMN_GROUPS,
    KIEM_KHO_EXPORT_COLUMNS,
    getKiemKhoExportColumnGroupsForView,
    resolveKiemKhoExportColumns,
    formatKiemKhoExportDateTime,
    getKiemKhoCreatorName,
    buildKiemKhoTicketSummary,
    buildKiemKhoExportRow,
    pickKiemKhoExportRowValues,
    applyKiemKhoExportWorksheetFormat,
    loadKiemKhoExportData,
    buildKiemKhoWorkbook
};
