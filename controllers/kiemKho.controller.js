const path = require('path');
const ExcelJS = require('exceljs');
const pdfService = require('../services/pdf.service');
const {
    PhieuKiemKho,
    CTPhieuKiemKho,
    HangHoa,
    CuaHang,
    NguoiDung,
    Kho,
    TonKho,
    TonKhoLo,
    TonKhoLoQuyCach
} = require('../models/kiot.model');
const {
    congTonKho,
    truTonKho,
    lotHasQuyCachStock,
    resolveTenQuyCachFromParams
} = require('../services/kho.service');
const { formatLotName } = require('../utils/kiemKhoDisplay');
const { ThungRacItem } = require('../models/trash.model');
const { ENTITY_LABELS, buildTrashChildFields } = require('../services/trashLabels.service');

async function shouldSyncQuyCach(khoId, hangHoaId, loHangId, tenQuyCach) {
    if (tenQuyCach) return true;
    if (!loHangId) return false;
    return lotHasQuyCachStock(khoId, hangHoaId, loHangId);
}

function getSelectedStatuses(query) {
    if (Array.isArray(query.trang_thai)) return query.trang_thai;
    if (query.trang_thai) return String(query.trang_thai).split(',').filter(Boolean);
    return ['pending', 'completed'];
}

function buildKiemKhoFilter(query = {}) {
    const filter = { $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] };
    const q = String(query.q || '').trim();
    const dateMode = query.date_mode || 'this_month';
    const statuses = getSelectedStatuses(query);

    if (q) {
        filter.ma_kiem_kho = { $regex: q, $options: 'i' };
    }

    if (statuses.length) {
        filter.trang_thai = { $in: statuses };
    }

    if (query.nguoi_tao_id) {
        filter.nguoi_tao_id = query.nguoi_tao_id;
    }

    const now = new Date();
    if (dateMode === 'this_month') {
        filter.created_at = {
            $gte: new Date(now.getFullYear(), now.getMonth(), 1),
            $lt: new Date(now.getFullYear(), now.getMonth() + 1, 1)
        };
    } else if (dateMode === 'custom' && (query.from_date || query.to_date)) {
        filter.created_at = {};
        if (query.from_date) filter.created_at.$gte = new Date(query.from_date);
        if (query.to_date) {
            const toDate = new Date(query.to_date);
            toDate.setDate(toDate.getDate() + 1);
            filter.created_at.$lt = toDate;
        }
    }

    return { filter, q, dateMode, statuses };
}

function activeKiemKhoDocumentFilter(extra) {
    return Object.assign({}, extra || {}, {
        $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }]
    });
}

function escapeCsv(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function sendCsv(res, filename, rows) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + rows.map(row => row.map(escapeCsv).join(',')).join('\r\n'));
}

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
    { group: 'chi_tiet', key: 'so_luong_thuc_te', header: 'Kiểm thực tế', style: { numFmt: '#,##0.##' }, default: true },
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
    const selected = keys
        .map(function(key) { return String(key || '').trim(); })
        .filter(function(key) { return KIEM_KHO_EXPORT_COLUMN_MAP[key]; });
    if (!selected.length) return [];
    return selected.map(function(key) {
        const def = KIEM_KHO_EXPORT_COLUMN_MAP[key];
        return Object.assign({ header: def.header, key: def.key }, def.style ? { style: def.style } : {});
    });
}

function formatKiemKhoExportDateTime(value) {
    if (!value) return '';
    return new Date(value).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
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
        thoi_gian: formatKiemKhoExportDateTime(ticket.created_at),
        ngay_can_bang: ticket.trang_thai === 'completed'
            ? formatKiemKhoExportDateTime(ticket.updated_at || ticket.ngay_kiem || ticket.created_at)
            : '',
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
    columns.forEach(function(column) {
        picked[column.key] = row[column.key];
    });
    return picked;
}

function applyKiemKhoExportWorksheetFormat(worksheet, columnCount) {
    const totalColumns = columnCount || worksheet.columnCount || KIEM_KHO_EXPORT_COLUMNS.length;
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell(function(cell) {
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
        to: { row: 1, column: totalColumns }
    };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.eachRow(function(row, rowNumber) {
        if (rowNumber === 1) return;
        row.eachCell(function(cell) {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
            };
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
    const tickets = await PhieuKiemKho.find(filter)
        .populate('cua_hang_id')
        .populate('kho_id')
        .populate('nguoi_tao_id')
        .sort({ created_at: -1 });
    const ticketIds = tickets.map(function(ticket) { return ticket._id; });
    const details = ticketIds.length
        ? await CTPhieuKiemKho.find({ phieu_kiem_kho_id: { $in: ticketIds } })
            .populate({
                path: 'hang_hoa_id',
                populate: [
                    { path: 'thuong_hieu_id' },
                    { path: 'don_vi_tinh_id' }
                ]
            })
            .populate('lo_hang_id')
            .sort({ created_at: 1 })
        : [];
    const detailMap = details.reduce(function(acc, detail) {
        const key = String(detail.phieu_kiem_kho_id);
        if (!acc[key]) acc[key] = [];
        acc[key].push(detail);
        return acc;
    }, {});
    return { tickets, detailMap };
}

async function sendKiemKhoWorkbook(res, filename, tickets, detailMap, selectedColumns) {
    const columns = selectedColumns && selectedColumns.length ? selectedColumns : KIEM_KHO_EXPORT_COLUMNS;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Kiểm kho');
    worksheet.columns = columns;

    tickets.forEach(function(ticket) {
        const details = detailMap[String(ticket._id)] || [];
        const summary = buildKiemKhoTicketSummary(details);
        if (!details.length) {
            worksheet.addRow(pickKiemKhoExportRowValues(buildKiemKhoExportRow(ticket, null, summary), columns));
            return;
        }
        details.forEach(function(detail) {
            worksheet.addRow(pickKiemKhoExportRowValues(buildKiemKhoExportRow(ticket, detail, summary), columns));
        });
    });

    applyKiemKhoExportWorksheetFormat(worksheet, columns.length);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    await workbook.xlsx.write(res);
    res.end();
}

function parseItems(rawItems) {
    if (Array.isArray(rawItems)) return rawItems;
    if (typeof rawItems === 'string' && rawItems.trim() !== '') {
        try {
            const parsed = JSON.parse(rawItems);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    }
    return [];
}

function normalizeTenQuyCach(value) {
    return String(value || '').trim();
}

const SESSION_TON_PREVIEW = 'kiemKhoTonPreview';
const SESSION_GIA_TRI_PREVIEW = 'kiemKhoGiaTriPreview';
const TON_PREVIEW_MAX_MS = 60 * 60 * 1000;
const TON_PREVIEW_MAX_ROWS = 2500;

function lotDisplayFromPopulated(lo) {
    if (!lo) return '';
    return formatLotName(lo);
}

function isObjectId(value) {
    return /^[0-9a-fA-F]{24}$/.test(String(value || '').trim());
}

function normalizeKiemKhoIds(rawIds) {
    const list = Array.isArray(rawIds) ? rawIds : [rawIds];
    return [...new Set(list.map(id => String(id || '').trim()).filter(isObjectId))];
}

function sanitizeTonPreviewRows(rawItems) {
    const list = parseItems(rawItems);
    const out = [];
    for (const row of list.slice(0, TON_PREVIEW_MAX_ROWS)) {
        out.push({
            ma_hang: String(row.ma_hang || '').slice(0, 120),
            ten_hang: String(row.ten_hang || '').slice(0, 400),
            don_vi_tinh: String(row.don_vi_tinh || '').slice(0, 60),
            ma_lo: String(row.ma_lo || '').slice(0, 200),
            ten_lo: String(row.ten_lo || '').slice(0, 200),
            lo_hang_label: String(row.lo_hang_label || formatLotName(row) || '').slice(0, 240),
            han_su_dung: row.han_su_dung || null,
            ten_quy_cach: String(row.ten_quy_cach || '').slice(0, 200),
            ton_kho_he_thong: Number(row.ton_kho_he_thong || 0),
            don_gia_von: Number(row.don_gia_von || 0),
            ten_ncc: String(row.ten_ncc || '---').slice(0, 200),
            gia_tri_kho: Number(row.gia_tri_kho || 0)
        });
    }
    return out;
}

function sanitizeGiaTriPreviewRows(rawItems) {
    const list = parseItems(rawItems);
    const out = [];
    for (const row of list.slice(0, TON_PREVIEW_MAX_ROWS)) {
        const qty = Number(row.ton_kho_he_thong || row.so_luong_ton || 0);
        const cost = Number(row.don_gia_von || 0);
        out.push({
            ma_hang: String(row.ma_hang || '').slice(0, 120),
            ten_hang: String(row.ten_hang || '').slice(0, 400),
            don_vi_tinh: String(row.don_vi_tinh || '').slice(0, 60),
            ma_lo: String(row.ma_lo || '').slice(0, 200),
            ten_lo: String(row.ten_lo || '').slice(0, 200),
            lo_hang_label: String(row.lo_hang_label || formatLotName(row) || '').slice(0, 240),
            han_su_dung: row.han_su_dung || null,
            ten_quy_cach: String(row.ten_quy_cach || '').slice(0, 200),
            ton_kho_he_thong: qty,
            don_gia_von: cost,
            ten_ncc: String(row.ten_ncc || '---').slice(0, 200),
            gia_tri_kho: Number(row.gia_tri_kho != null ? row.gia_tri_kho : qty * cost)
        });
    }
    return out;
}

async function loadGiaTriPreviewFromSession(req) {
    const raw = req.session && req.session[SESSION_GIA_TRI_PREVIEW];
    if (!raw || typeof raw.savedAt !== 'number' || Date.now() - raw.savedAt > TON_PREVIEW_MAX_MS) {
        return null;
    }
    const kho = raw.kho_id && isObjectId(raw.kho_id) ? await Kho.findById(raw.kho_id).lean() : null;
    if (!kho) return null;
    let store = null;
    if (raw.cua_hang_id && isObjectId(raw.cua_hang_id)) {
        store = await CuaHang.findById(raw.cua_hang_id).lean();
    }
    if (!store && kho.cua_hang_id) {
        store = await CuaHang.findById(kho.cua_hang_id).lean();
    }
    const items = Array.isArray(raw.items) ? raw.items : [];
    const totalTon = items.reduce((s, r) => s + Number(r.ton_kho_he_thong || 0), 0);
    const totalGiaTri = items.reduce((s, r) => s + Number(r.gia_tri_kho || 0), 0);
    return {
        store: store || {},
        warehouse: kho,
        creator: req.user || {},
        ghi_chu: String(raw.ghi_chu || ''),
        items,
        totalTon,
        totalGiaTri,
        printedAt: raw.savedAt
    };
}

async function loadTonPreviewFromSession(req) {
    const raw = req.session && req.session[SESSION_TON_PREVIEW];
    if (!raw || typeof raw.savedAt !== 'number' || Date.now() - raw.savedAt > TON_PREVIEW_MAX_MS) {
        return null;
    }
    const kho = raw.kho_id && isObjectId(raw.kho_id) ? await Kho.findById(raw.kho_id).lean() : null;
    if (!kho) return null;
    let store = null;
    if (raw.cua_hang_id && isObjectId(raw.cua_hang_id)) {
        store = await CuaHang.findById(raw.cua_hang_id).lean();
    }
    if (!store && kho.cua_hang_id) {
        store = await CuaHang.findById(kho.cua_hang_id).lean();
    }
    const items = Array.isArray(raw.items) ? raw.items : [];
    const totalTon = items.reduce((s, r) => s + Number(r.ton_kho_he_thong || 0), 0);
    return {
        store: store || {},
        warehouse: kho,
        creator: req.user || {},
        ghi_chu: String(raw.ghi_chu || ''),
        items,
        totalTon,
        printedAt: raw.savedAt
    };
}

exports.postPreviewTonHeThong = async (req, res, next) => {
    try {
        const body = req.body || {};
        const kho_id = String(body.kho_id || '').trim();
        if (!isObjectId(kho_id)) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho hợp lệ.' });
        }
        const kho = await Kho.findById(kho_id).lean();
        if (!kho) {
            return res.status(400).json({ success: false, message: 'Không tìm thấy kho.' });
        }
        const items = sanitizeTonPreviewRows(body.items);
        if (!items.length) {
            return res.status(400).json({ success: false, message: 'Không có hàng để in.' });
        }
        req.session[SESSION_TON_PREVIEW] = {
            cua_hang_id: body.cua_hang_id ? String(body.cua_hang_id).trim() : '',
            kho_id,
            ghi_chu: String(body.ghi_chu || ''),
            items,
            savedAt: Date.now()
        };
        res.json({ success: true, url: '/kiem-kho/in-ton-he-thong-preview' });
    } catch (error) {
        next(error);
    }
};

exports.getInTonHeThongPreviewPdf = async (req, res, next) => {
    try {
        const data = await loadTonPreviewFromSession(req);
        if (!data) {
            return res.status(410).send('Phiếu xem trước đã hết hạn. Quay lại màn Kiểm kho và bấm in lại.');
        }
        const viewPath = path.join(__dirname, '..', 'views', 'kiem-kho', 'print-ton-he-thong.ejs');
        const locals = {
            title: 'Phiếu số lượng tồn hiện tại',
            embeddedPrint: false,
            ...data
        };
        const html = await pdfService.renderViewToHtml(viewPath, locals);
        const buffer = await pdfService.generatePdfFromHtml(html, {
            format: 'A4',
            printBackground: true,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
        });
        const fname = 'kiem-kho-ton-he-thong.pdf';
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
        return res.send(Buffer.from(buffer));
    } catch (error) {
        next(error);
    }
};

exports.postPreviewGiaTriKho = async (req, res, next) => {
    try {
        const body = req.body || {};
        const kho_id = String(body.kho_id || '').trim();
        if (!isObjectId(kho_id)) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho hợp lệ.' });
        }
        const kho = await Kho.findById(kho_id).lean();
        if (!kho) {
            return res.status(400).json({ success: false, message: 'Không tìm thấy kho.' });
        }
        const items = sanitizeGiaTriPreviewRows(body.items);
        if (!items.length) {
            return res.status(400).json({ success: false, message: 'Không có hàng để in.' });
        }
        req.session[SESSION_GIA_TRI_PREVIEW] = {
            cua_hang_id: body.cua_hang_id ? String(body.cua_hang_id).trim() : '',
            kho_id,
            ghi_chu: String(body.ghi_chu || ''),
            items,
            savedAt: Date.now()
        };
        res.json({ success: true, url: '/kiem-kho/in-gia-tri-kho-preview' });
    } catch (error) {
        next(error);
    }
};

exports.getInGiaTriKhoPreviewPdf = async (req, res, next) => {
    try {
        const data = await loadGiaTriPreviewFromSession(req);
        if (!data) {
            return res.status(410).send('Phiếu xem trước đã hết hạn. Quay lại màn Kiểm kho và bấm in lại.');
        }
        const viewPath = path.join(__dirname, '..', 'views', 'kiem-kho', 'print-gia-tri-kho.ejs');
        const locals = {
            title: 'Phiếu giá trị kho',
            embeddedPrint: false,
            ...data
        };
        const html = await pdfService.renderViewToHtml(viewPath, locals);
        const buffer = await pdfService.generatePdfFromHtml(html, {
            format: 'A4',
            printBackground: true,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
        });
        const fname = 'kiem-kho-gia-tri-kho.pdf';
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
        return res.send(Buffer.from(buffer));
    } catch (error) {
        next(error);
    }
};

exports.getInGiaTriKhoPreview = async (req, res, next) => {
    try {
        const data = await loadGiaTriPreviewFromSession(req);
        if (!data) {
            return res.status(410).send('Phiếu xem trước đã hết hạn. Quay lại màn Kiểm kho và bấm in lại.');
        }
        res.render('kiem-kho/print-gia-tri-kho', {
            title: 'Phiếu giá trị kho',
            embeddedPrint: String(req.query.embed || '') === '1',
            ...data
        });
    } catch (error) {
        next(error);
    }
};

exports.getInTonHeThongPreview = async (req, res, next) => {
    try {
        const data = await loadTonPreviewFromSession(req);
        if (!data) {
            return res.status(410).send('Phiếu xem trước đã hết hạn. Quay lại màn Kiểm kho và bấm in lại.');
        }
        res.render('kiem-kho/print-ton-he-thong', {
            title: 'Phiếu số lượng tồn hiện tại',
            embeddedPrint: String(req.query.embed || '') === '1',
            ...data
        });
    } catch (error) {
        next(error);
    }
};

exports.index = async (req, res, next) => {
    try {
        const { filter, q, dateMode, statuses } = buildKiemKhoFilter(req.query);

        const pageSize = Math.min(Math.max(Number(req.query.page_size || 15), 1), 100);
        const [list, users] = await Promise.all([
            PhieuKiemKho.find(filter)
                .populate('cua_hang_id')
                .populate('kho_id')
                .populate('nguoi_tao_id')
                .sort({ created_at: -1 })
                .limit(pageSize),
            NguoiDung.find().sort({ ho_ten: 1, username: 1 })
        ]);

        const ticketIds = list.map(item => item._id);
        const details = ticketIds.length
            ? await CTPhieuKiemKho.find({ phieu_kiem_kho_id: { $in: ticketIds } })
                .populate('hang_hoa_id')
                .populate({
                    path: 'lo_hang_id',
                    select: 'ten_lo ma_lo han_su_dung'
                })
            : [];
        const detailMap = details.reduce((acc, item) => {
            const key = String(item.phieu_kiem_kho_id);
            if (!acc[key]) acc[key] = { positive: 0, negative: 0, actual: 0, value: 0, items: [] };
            const diff = Number(item.so_luong_lech || 0);
            if (diff > 0) acc[key].positive += diff;
            if (diff < 0) acc[key].negative += Math.abs(diff);
            acc[key].actual += Number(item.so_luong_thuc_te || 0);
            acc[key].value += Number(item.gia_tri_lech || 0);
            acc[key].items.push(item.toObject());
            return acc;
        }, {});

        const tickets = list.map(item => {
            const obj = item.toObject();
            obj.summary = detailMap[String(item._id)] || { positive: 0, negative: 0, actual: 0, value: 0, items: [] };
            return obj;
        });

        res.render('kiem-kho/index', {
            title: 'Phiếu kiểm kho',
            tickets,
            users,
            exportColumnGroups: getKiemKhoExportColumnGroupsForView(),
            filters: {
                q,
                date_mode: dateMode,
                from_date: req.query.from_date || '',
                to_date: req.query.to_date || '',
                trang_thai: statuses,
                nguoi_tao_id: req.query.nguoi_tao_id || '',
                page_size: req.query.page_size || '15'
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.getExportCsv = async (req, res, next) => {
    try {
        const { filter } = buildKiemKhoFilter(req.query);
        const tickets = await PhieuKiemKho.find(filter)
            .populate('kho_id')
            .populate('nguoi_tao_id')
            .sort({ created_at: -1 });

        const ticketIds = tickets.map(item => item._id);
        const details = ticketIds.length
            ? await CTPhieuKiemKho.find({ phieu_kiem_kho_id: { $in: ticketIds } })
            : [];
        const summaryMap = details.reduce((acc, item) => {
            const key = String(item.phieu_kiem_kho_id);
            if (!acc[key]) acc[key] = { positive: 0, negative: 0, actual: 0, value: 0 };
            const diff = Number(item.so_luong_lech || 0);
            if (diff > 0) acc[key].positive += diff;
            if (diff < 0) acc[key].negative += Math.abs(diff);
            acc[key].actual += Number(item.so_luong_thuc_te || 0);
            acc[key].value += Number(item.gia_tri_lech || 0);
            return acc;
        }, {});

        const rows = [[
            'Mã kiểm kho',
            'Ngày tạo',
            'Ngày cân bằng',
            'Kho',
            'Người tạo',
            'SL thực tế',
            'Tổng chênh lệch',
            'SL lệch tăng',
            'SL lệch giảm',
            'Giá trị chênh lệch',
            'Trạng thái',
            'Ghi chú'
        ]];

        tickets.forEach(ticket => {
            const summary = summaryMap[String(ticket._id)] || {};
            const creator = ticket.nguoi_tao_id
                ? (ticket.nguoi_tao_id.ho_ten || ticket.nguoi_tao_id.username || ticket.nguoi_tao_id.email || '')
                : '';
            rows.push([
                ticket.ma_kiem_kho || '',
                ticket.created_at ? ticket.created_at.toISOString() : '',
                ticket.trang_thai === 'completed' && ticket.updated_at ? ticket.updated_at.toISOString() : '',
                ticket.kho_id ? ticket.kho_id.ten_kho : '',
                creator,
                ticket.tong_so_luong_thuc_te || summary.actual || 0,
                ticket.tong_so_luong_lech || 0,
                summary.positive || 0,
                summary.negative || 0,
                ticket.tong_gia_tri_lech || summary.value || 0,
                ticket.trang_thai || '',
                ticket.ghi_chu || ''
            ]);
        });

        sendCsv(res, 'kiem-kho.csv', rows);
    } catch (error) {
        next(error);
    }
};

exports.postExportExcel = async (req, res, next) => {
    try {
        const columns = resolveKiemKhoExportColumns(req.body.columns);
        if (!columns.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất 1 cột để xuất.' });
        }
        const { tickets, detailMap } = await loadKiemKhoExportData(req.body || {});
        await sendKiemKhoWorkbook(res, 'kiem-kho.xlsx', tickets, detailMap, columns);
    } catch (error) {
        next(error);
    }
};

exports.getIdExportCsv = async (req, res, next) => {
    try {
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
            return res.status(404).send('Không tìm thấy phiếu kiểm kho');
        }

        const ticket = await PhieuKiemKho.findOne(activeKiemKhoDocumentFilter({ _id: req.params.id }))
            .populate('kho_id')
            .populate('nguoi_tao_id');
        if (!ticket) {
            return res.status(404).send('Không tìm thấy phiếu kiểm kho');
        }

        const details = await CTPhieuKiemKho.find({ phieu_kiem_kho_id: ticket._id })
            .populate({
                path: 'hang_hoa_id',
                populate: [
                    { path: 'thuong_hieu_id' },
                    { path: 'don_vi_tinh_id' }
                ]
            })
            .populate('lo_hang_id');
        const creator = ticket.nguoi_tao_id
            ? (ticket.nguoi_tao_id.ho_ten || ticket.nguoi_tao_id.username || ticket.nguoi_tao_id.email || '')
            : '';
        const totalActual = details.reduce((sum, item) => sum + Number(item.so_luong_thuc_te || 0), 0);
        const positiveDiff = details.reduce((sum, item) => {
            const diff = Number(item.so_luong_lech || 0);
            return diff > 0 ? sum + diff : sum;
        }, 0);
        const negativeDiff = details.reduce((sum, item) => {
            const diff = Number(item.so_luong_lech || 0);
            return diff < 0 ? sum + Math.abs(diff) : sum;
        }, 0);
        const rows = [[
            'Mã kiểm kho',
            'Thời gian',
            'Ngày cân bằng',
            'SL thực tế',
            'Tổng thực tế',
            'Tổng chênh lệch',
            'SL lệch tăng',
            'SL lệch giảm',
            'Ghi chú',
            'Trạng thái',
            'Mã hàng',
            'Tên hàng',
            'Thương hiệu',
            'Đơn vị tính',
            'Tên lô',
            'Mã lô',
            'Thuộc tính',
            'Tồn kho',
            'Kiểm thực tế',
            'SL lệch',
            'Giá trị lệch'
        ]];

        details.forEach(item => {
            const product = item.hang_hoa_id || {};
            const lot = item.lo_hang_id || {};
            rows.push([
                ticket.ma_kiem_kho || '',
                ticket.created_at ? ticket.created_at.toISOString() : '',
                ticket.trang_thai === 'completed' && ticket.updated_at ? ticket.updated_at.toISOString() : '',
                ticket.tong_so_luong_thuc_te || totalActual || 0,
                ticket.tong_gia_tri_thuc_te || 0,
                ticket.tong_so_luong_lech || 0,
                positiveDiff,
                negativeDiff,
                ticket.ghi_chu || '',
                ticket.trang_thai || '',
                product.ma_hang || '',
                product.ten_hang || '',
                product.thuong_hieu_id ? product.thuong_hieu_id.ten_thuong_hieu : '',
                product.don_vi_tinh_id ? product.don_vi_tinh_id.ten_don_vi : '',
                lotDisplayFromPopulated(lot),
                lot.ma_lo || '',
                item.ten_quy_cach || '',
                item.ton_kho_he_thong || 0,
                item.so_luong_thuc_te || 0,
                item.so_luong_lech || 0,
                item.gia_tri_lech || 0
            ]);
        });

        if (!details.length) {
            rows.push([
                ticket.ma_kiem_kho || '',
                ticket.created_at ? ticket.created_at.toISOString() : '',
                ticket.trang_thai === 'completed' && ticket.updated_at ? ticket.updated_at.toISOString() : '',
                ticket.tong_so_luong_thuc_te || 0,
                ticket.tong_gia_tri_thuc_te || 0,
                ticket.tong_so_luong_lech || 0,
                0,
                0,
                ticket.ghi_chu || '',
                ticket.trang_thai || '',
                '', '', '', '', '', '', '', '', '', '', ''
            ]);
        }

        sendCsv(res, `${ticket.ma_kiem_kho || 'kiem-kho'}.csv`, rows);
    } catch (error) {
        next(error);
    }
};

async function loadKiemKhoCopyDraft(copyFromId) {
    if (!/^[0-9a-fA-F]{24}$/.test(String(copyFromId || ''))) return null;
    const ticket = await PhieuKiemKho.findOne(activeKiemKhoDocumentFilter({ _id: copyFromId })).lean();
    if (!ticket) return null;
    const lines = await CTPhieuKiemKho.find({ phieu_kiem_kho_id: ticket._id })
        .populate('hang_hoa_id')
        .populate('lo_hang_id')
        .lean();
    if (!lines.length) return null;
    return {
        cua_hang_id: ticket.cua_hang_id ? String(ticket.cua_hang_id) : '',
        kho_id: ticket.kho_id ? String(ticket.kho_id) : '',
        ghi_chu: ticket.ghi_chu || '',
        items: lines.map(row => ({
            hang_hoa_id: String(row.hang_hoa_id?._id || row.hang_hoa_id || ''),
            lo_hang_id: row.lo_hang_id ? String(row.lo_hang_id._id || row.lo_hang_id) : '',
            ma_hang: row.hang_hoa_id?.ma_hang || '',
            ten_hang: row.hang_hoa_id?.ten_hang || '',
            ton_kho_he_thong: Number(row.ton_kho_he_thong || 0),
            so_luong_thuc_te: Number(row.so_luong_thuc_te || 0),
            ten_quy_cach: row.ten_quy_cach || '',
            nguyen_nhan_lech: row.nguyen_nhan_lech || ''
        })).filter(row => row.hang_hoa_id)
    };
}

exports.getCreate = async (req, res, next) => {
    try {
        const [stores, warehouses, products] = await Promise.all([
            CuaHang.find(),
            Kho.find({ trang_thai: 'active' }).sort({ ten_kho: 1 }),
            HangHoa.find()
        ]);
        let copyDraft = null;
        let copyFromError = '';
        const copyFromId = String(req.query?.copy_from || '').trim();
        if (copyFromId) {
            copyDraft = await loadKiemKhoCopyDraft(copyFromId);
            if (!copyDraft) copyFromError = 'Không tải được phiếu kiểm kho để sao chép.';
        }
        const copyDraftJson = copyDraft ? JSON.stringify(copyDraft).replace(/</g, '\\u003c') : '';
        res.render('kiem-kho/create', {
            title: 'Kiểm kho mới',
            user: req.user,
            stores,
            warehouses,
            products,
            copyDraftJson,
            copyFromError
        });
    } catch (error) {
        next(error);
    }
};

exports.saveKiemKho = async function(req, res, next) {
    try {
        const { cua_hang_id, kho_id, ghi_chu } = req.body || {};
        const items = parseItems(req.body?.items);

        if (!kho_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho.' });
        }

        const kho = await Kho.findById(kho_id);
        if (!kho) {
            return res.status(400).json({ success: false, message: 'Kho kiểm không hợp lệ' });
        }

        if (!items.length) {
            return res.status(400).json({ success: false, message: 'Chưa chọn hàng hóa kiểm kho' });
        }

        const ma_kiem_kho = 'KK' + Date.now();
        const phieu = await PhieuKiemKho.create({
            ma_kiem_kho,
            cua_hang_id: cua_hang_id || kho.cua_hang_id,
            chi_nhanh_id: kho.chi_nhanh_id,
            kho_id: kho._id,
            nguoi_tao_id: req.user?._id,
            ghi_chu,
            trang_thai: 'completed'
        });

        let tongThucTe = 0;
        let tongLech = 0;
        let tongGiaTriLech = 0;

        for (const item of items) {
            const actualQuantity = Number(item.so_luong_thuc_te);
            if (!item.hang_hoa_id || !Number.isFinite(actualQuantity) || actualQuantity < 0) {
                return res.status(400).json({ success: false, message: 'Dữ liệu kiểm kho không hợp lệ' });
            }

            const product = await HangHoa.findById(item.hang_hoa_id);
            if (!product) {
                return res.status(400).json({ success: false, message: 'Hàng hóa không hợp lệ' });
            }
            if (product.quan_ly_theo_lo && !item.lo_hang_id) {
                return res.status(400).json({ success: false, message: 'Hàng quản lý theo lô phải có lô hàng' });
            }

            const stock = item.lo_hang_id
                ? await TonKhoLo.findOne({ kho_id: kho._id, hang_hoa_id: item.hang_hoa_id, lo_hang_id: item.lo_hang_id })
                : await TonKho.findOne({ kho_id: kho._id, hang_hoa_id: item.hang_hoa_id });
            const tenQuyCach = normalizeTenQuyCach(
                item.ten_quy_cach || item.ten_thuoc_tinh || await resolveTenQuyCachFromParams(item)
            );
            if (item.lo_hang_id && await shouldSyncQuyCach(kho._id, item.hang_hoa_id, item.lo_hang_id, tenQuyCach) && !tenQuyCach) {
                return res.status(400).json({
                    success: false,
                    message: 'Lô có quản lý quy cách, vui lòng kiểm kho theo từng quy cách'
                });
            }
            let systemQuantity = Number(stock?.so_luong || 0);
            if (item.lo_hang_id && tenQuyCach) {
                const qcStock = await TonKhoLoQuyCach.findOne({
                    kho_id: kho._id,
                    hang_hoa_id: item.hang_hoa_id,
                    lo_hang_id: item.lo_hang_id,
                    $or: [{ ten_quy_cach: tenQuyCach }, { ten_thuoc_tinh: tenQuyCach }]
                });
                systemQuantity = Number(qcStock?.so_luong || 0);
            }
            const difference = actualQuantity - systemQuantity;
            const differenceReason = String(item.nguyen_nhan_lech || '').trim();
            if (difference !== 0 && !differenceReason) {
                return res.status(400).json({
                    success: false,
                    message: 'Vui lòng nhập nguyên nhân lệch cho hàng hóa có chênh lệch'
                });
            }

            const cost = Number(product.gia_von) || 0;
            const differenceValue = difference * cost;
            tongThucTe += actualQuantity;
            tongLech += difference;
            tongGiaTriLech += differenceValue;

            if (difference > 0) {
                try {
                    await congTonKho({
                        kho_id: kho._id,
                        hang_hoa_id: item.hang_hoa_id,
                        lo_hang_id: item.lo_hang_id,
                        ten_quy_cach: tenQuyCach,
                        gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id,
                        sync_quy_cach: await shouldSyncQuyCach(kho._id, item.hang_hoa_id, item.lo_hang_id, tenQuyCach),
                        so_luong: difference,
                        gia_von: cost,
                        nguoi_tao_id: req.user?._id,
                        loai_phieu: 'kiem_kho',
                        ma_phieu: ma_kiem_kho,
                        ghi_chu: differenceReason || ghi_chu
                    });
                } catch (error) {
                    return res.status(400).json({ success: false, message: error.message || 'Không thể điều chỉnh kiểm kho' });
                }
            } else if (difference < 0) {
                try {
                    await truTonKho({
                        kho_id: kho._id,
                        hang_hoa_id: item.hang_hoa_id,
                        lo_hang_id: item.lo_hang_id,
                        ten_quy_cach: tenQuyCach,
                        gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id,
                        sync_quy_cach: await shouldSyncQuyCach(kho._id, item.hang_hoa_id, item.lo_hang_id, tenQuyCach),
                        so_luong: Math.abs(difference),
                        nguoi_tao_id: req.user?._id,
                        loai_phieu: 'kiem_kho',
                        ma_phieu: ma_kiem_kho,
                        ghi_chu: differenceReason || ghi_chu
                    });
                } catch (error) {
                    return res.status(400).json({ success: false, message: error.message || 'Không đủ tồn kho để điều chỉnh kiểm kho' });
                }
            }

            await CTPhieuKiemKho.create({
                phieu_kiem_kho_id: phieu._id,
                hang_hoa_id: item.hang_hoa_id,
                lo_hang_id: item.lo_hang_id || null,
                ton_kho_he_thong: systemQuantity,
                so_luong_thuc_te: actualQuantity,
                so_luong_lech: difference,
                gia_tri_lech: differenceValue,
                ten_quy_cach: tenQuyCach,
                nguyen_nhan_lech: differenceReason
            });
        }

        phieu.tong_so_luong_thuc_te = tongThucTe;
        phieu.tong_so_luong_lech = tongLech;
        phieu.tong_gia_tri_lech = tongGiaTriLech;
        await phieu.save();

        return res.json({ success: true, message: 'Hoàn thành kiểm kho', ma_kiem_kho, id: phieu._id, print_url: '/chung-tu-kho/kiem-kho/' + phieu._id });
    } catch (error) {
        next(error);
    }
};

exports.postTrashPreview = async (req, res, next) => {
    try {
        const ids = normalizeKiemKhoIds(req.body?.phieu_kiem_kho_ids || req.body?.ids);
        if (!ids.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất một phiếu kiểm kho.' });
        }

        const tickets = await PhieuKiemKho.find({ _id: { $in: ids } })
            .populate('kho_id')
            .populate('nguoi_tao_id')
            .lean();
        if (tickets.length !== ids.length) {
            return res.status(404).json({ success: false, message: 'Một hoặc nhiều phiếu kiểm kho không tồn tại.' });
        }

        const detailCounts = await CTPhieuKiemKho.aggregate([
            { $match: { phieu_kiem_kho_id: { $in: tickets.map(item => item._id) } } },
            { $group: { _id: '$phieu_kiem_kho_id', count: { $sum: 1 } } }
        ]);
        const countMap = detailCounts.reduce((map, row) => {
            map[String(row._id)] = row.count;
            return map;
        }, {});
        const ticketMap = tickets.reduce((map, row) => {
            map[String(row._id)] = row;
            return map;
        }, {});
        const trashRows = await ThungRacItem.find({
            entity_type: 'PhieuKiemKho',
            entity_id: { $in: tickets.map(item => item._id) },
            restored_at: null
        }).select('entity_id').lean();
        const trashMap = trashRows.reduce((map, row) => {
            map[String(row.entity_id)] = true;
            return map;
        }, {});
        const items = ids.map(id => {
            const ticket = ticketMap[id];
            const isDeleted = Boolean(ticket.deleted_at || trashMap[id]);
            const diff = Number(ticket.tong_so_luong_lech || 0);
            return {
                phieu_kiem_kho_id: id,
                ma_kiem_kho: ticket.ma_kiem_kho || '',
                kho: ticket.kho_id ? (ticket.kho_id.ten_kho || ticket.kho_id.ma_kho || '') : '',
                trang_thai: ticket.trang_thai || '',
                can_trash: !isDeleted,
                block_reason: isDeleted ? 'Phiếu kiểm kho đã nằm trong thùng rác.' : '',
                warnings: ticket.trang_thai === 'completed' && diff ? ['Phiếu đã cân bằng kho. Khi đưa vào thùng rác, hệ thống sẽ đảo lại phần tồn kho do phiếu này đã ghi nhận.'] : [],
                groups: [
                    { entity_type: 'CTPhieuKiemKho', label: ENTITY_LABELS.CTPhieuKiemKho || 'Chi tiết kiểm kho', count: Number(countMap[id] || 0), samples: [] },
                    { entity_type: 'LichSuKho', label: 'Lịch sử kho liên quan', count: Math.abs(diff) > 0 ? 1 : 0, samples: [] }
                ].filter(group => Number(group.count || 0) > 0)
            };
        });
        const blocked = items.filter(item => !item.can_trash);
        const aggregateMap = {};
        items.forEach(item => {
            item.groups.forEach(group => {
                if (!aggregateMap[group.entity_type]) {
                    aggregateMap[group.entity_type] = { entity_type: group.entity_type, label: group.label, count: 0, samples: [] };
                }
                aggregateMap[group.entity_type].count += Number(group.count || 0);
            });
        });

        return res.json({
            success: true,
            data: {
                items,
                allowed_count: items.length - blocked.length,
                blocked_count: blocked.length,
                can_proceed: blocked.length === 0 && items.length > 0,
                aggregate_groups: Object.keys(aggregateMap).map(key => aggregateMap[key])
            }
        });
    } catch (error) {
        next(error);
    }
};

async function rollbackKiemKhoStock(phieu, userId) {
    if (!phieu || phieu.stock_rollback_at || phieu.trang_thai === 'cancelled') return false;
    const lines = await CTPhieuKiemKho.find({ phieu_kiem_kho_id: phieu._id }).lean();
    const maPhieu = phieu.ma_kiem_kho || String(phieu._id);
    for (const row of lines) {
        const diff = Number(row.so_luong_lech || 0);
        if (!diff) continue;
        const product = await HangHoa.findById(row.hang_hoa_id).select('gia_von').lean();
        const cost = Number(product?.gia_von || 0);
        const tenQuyCach = normalizeTenQuyCach(row.ten_quy_cach);
        const syncQuyCach = await shouldSyncQuyCach(phieu.kho_id, row.hang_hoa_id, row.lo_hang_id, tenQuyCach);
        if (diff > 0) {
            await truTonKho({
                kho_id: phieu.kho_id,
                hang_hoa_id: row.hang_hoa_id,
                lo_hang_id: row.lo_hang_id,
                ten_quy_cach: tenQuyCach,
                sync_quy_cach: syncQuyCach,
                so_luong: diff,
                nguoi_tao_id: userId,
                loai_phieu: 'kiem_kho',
                ma_phieu: maPhieu,
                ghi_chu: `Huy kiem kho ${maPhieu}`
            });
        } else {
            await congTonKho({
                kho_id: phieu.kho_id,
                hang_hoa_id: row.hang_hoa_id,
                lo_hang_id: row.lo_hang_id,
                ten_quy_cach: tenQuyCach,
                sync_quy_cach: syncQuyCach,
                so_luong: Math.abs(diff),
                gia_von: cost,
                nguoi_tao_id: userId,
                loai_phieu: 'kiem_kho',
                ma_phieu: maPhieu,
                ghi_chu: `Huy kiem kho ${maPhieu}`
            });
        }
    }
    phieu.stock_rollback_at = new Date();
    await phieu.save();
    return true;
}

exports.postTrashMove = async (req, res, next) => {
    try {
        const ids = normalizeKiemKhoIds(req.body?.phieu_kiem_kho_ids || req.body?.ids);
        if (!ids.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất một phiếu kiểm kho.' });
        }

        const tickets = await PhieuKiemKho.find({ _id: { $in: ids } });
        if (tickets.length !== ids.length) {
            return res.status(404).json({ success: false, message: 'Một hoặc nhiều phiếu kiểm kho không tồn tại.' });
        }
        const existingTrash = await ThungRacItem.exists({
            entity_type: 'PhieuKiemKho',
            entity_id: { $in: tickets.map(ticket => ticket._id) },
            restored_at: null
        });
        if (existingTrash || tickets.some(ticket => ticket.deleted_at)) {
            return res.status(400).json({ success: false, message: 'Danh sách chọn có phiếu kiểm kho đã nằm trong thùng rác.' });
        }

        const detailCounts = await CTPhieuKiemKho.aggregate([
            { $match: { phieu_kiem_kho_id: { $in: tickets.map(ticket => ticket._id) } } },
            { $group: { _id: '$phieu_kiem_kho_id', count: { $sum: 1 } } }
        ]);
        const countMap = detailCounts.reduce((map, row) => {
            map[String(row._id)] = row.count;
            return map;
        }, {});
        const now = new Date();
        const moved = [];
        for (const ticket of tickets) {
            await rollbackKiemKhoStock(ticket, req.user?._id);
            ticket.deleted_at = now;
            ticket.deleted_by = req.user?._id || null;
            await ticket.save();

            const root = await ThungRacItem.create({
                entity_type: 'PhieuKiemKho',
                entity_id: ticket._id,
                ma_chung_tu: ticket.ma_kiem_kho || '',
                ten_hien_thi: ticket.ma_kiem_kho || 'Phiếu kiểm kho',
                mo_ta_phu: ticket.trang_thai === 'completed' ? 'Đã cân bằng kho' : (ticket.trang_thai === 'cancelled' ? 'Đã hủy' : 'Phiếu tạm'),
                cua_hang_id: ticket.cua_hang_id || null,
                deleted_at: now,
                deleted_by: req.user?._id || null,
                is_trash_root: true,
                trash_group_id: null,
                sort_order: 0
            });

            const childGroups = [
                { entity_type: 'CTPhieuKiemKho', label: ENTITY_LABELS.CTPhieuKiemKho || 'Chi tiết kiểm kho', count: Number(countMap[String(ticket._id)] || 0), samples: [] },
                { entity_type: 'LichSuKho', label: 'Lịch sử kho liên quan', count: Math.abs(Number(ticket.tong_so_luong_lech || 0)) > 0 ? 1 : 0, samples: [] }
            ].filter(group => Number(group.count || 0) > 0);
            let sortOrder = 1;
            for (const group of childGroups) {
                const childFields = buildTrashChildFields(group);
                await ThungRacItem.create({
                    entity_type: group.entity_type,
                    entity_id: ticket._id,
                    ma_chung_tu: childFields.ma_chung_tu,
                    ten_hien_thi: childFields.ten_hien_thi,
                    mo_ta_phu: childFields.mo_ta_phu,
                    cua_hang_id: ticket.cua_hang_id || null,
                    deleted_at: now,
                    deleted_by: req.user?._id || null,
                    is_trash_root: false,
                    trash_group_id: root._id,
                    sort_order: sortOrder
                });
                sortOrder += 1;
            }

            moved.push({ phieu_kiem_kho_id: String(ticket._id), ma_kiem_kho: ticket.ma_kiem_kho || '', trash_root_id: String(root._id) });
        }

        return res.json({ success: true, message: 'Đã đưa ' + moved.length + ' phiếu kiểm kho vào thùng rác.', data: { moved } });
    } catch (error) {
        next(error);
    }
};

exports.postIdCancel = async (req, res, next) => {
    try {
        const phieu = await PhieuKiemKho.findOne(activeKiemKhoDocumentFilter({ _id: req.params.id }));
        if (!phieu) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu kiểm kho' });
        if (phieu.trang_thai === 'cancelled') {
            return res.json({ success: true, message: 'Phiếu đã hủy' });
        }

        await rollbackKiemKhoStock(phieu, req.user?._id);

        phieu.trang_thai = 'cancelled';
        await phieu.save();
        res.json({ success: true, message: 'Đã hủy phiếu kiểm kho' });
    } catch (error) {
        next(error);
    }
};
