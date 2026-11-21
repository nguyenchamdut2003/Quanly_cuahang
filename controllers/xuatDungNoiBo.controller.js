const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const {
    PhieuXuatNoiBo,
    CTXuatNoiBo,
    LoaiXuatNoiBo,
    HangHoa,
    NguoiDung,
    Kho,
    KhachHang,
    NhaCungCap,
    TonKho,
    TonKhoLo,
    TonKhoLoQuyCach,
    VatChua
} = require('../models/kiot.model');
const { congTonKho, truTonKho } = require('../services/kho.service');
const { cancelXuatVatChuaBySource, createXuatVatChuaAndDecreaseStock } = require('../services/vatChuaExport.service');
const { loadAverageCostByVatChuaIds } = require('../services/vatChuaImport.service');
const { resolveStoreId } = require('../utils/storeScope');



async function makeXnbCode() {
    const last = await PhieuXuatNoiBo.findOne({ ma_xuat_noi_bo: /^XNB\d{6}$/ })
        .sort({ ma_xuat_noi_bo: -1 })
        .select('ma_xuat_noi_bo')
        .lean();
    const next = last && last.ma_xuat_noi_bo
        ? Number(String(last.ma_xuat_noi_bo).replace(/\D/g, '')) + 1
        : 1;
    return 'XNB' + String(next).padStart(6, '0');
}

function formatDateTimeLocal(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('-') + 'T' + [pad(date.getHours()), pad(date.getMinutes())].join(':');
}

async function loadProductsForXnbKho(khoId, keyword) {
    const [products, tonKhoRows, tonKhoLoRows, quyCachRows] = await Promise.all([
        HangHoa.find({ trang_thai: { $ne: 'inactive' } })
            .populate('don_vi_tinh_id', 'ten_don_vi')
            .select('ma_hang ten_hang gia_von quan_ly_theo_lo don_vi_tinh_id')
            .sort({ ten_hang: 1 })
            .lean(),
        TonKho.find({ kho_id: khoId }).lean(),
        TonKhoLo.find({ kho_id: khoId, so_luong: { $gt: 0 } })
            .populate('lo_hang_id', 'ma_lo ten_lo trang_thai ngay_nhap han_su_dung')
            .lean(),
        TonKhoLoQuyCach.find({ kho_id: khoId, so_luong: { $gt: 0 } })
            .populate('lo_hang_id', 'ma_lo ten_lo trang_thai ngay_nhap han_su_dung')
            .lean()
    ]);

    const stockByNormal = tonKhoRows.reduce(function(map, row) {
        map[String(row.hang_hoa_id)] = Number(row.so_luong || 0);
        return map;
    }, {});

    const stockByLotProduct = tonKhoLoRows.reduce(function(map, row) {
        const lot = row.lo_hang_id;
        if (lot && lot.trang_thai === 'huy') return map;
        const key = String(row.hang_hoa_id);
        map[key] = Number(map[key] || 0) + Number(row.so_luong || 0);
        return map;
    }, {});

    const quyCachByProduct = quyCachRows.reduce(function(map, row) {
        const lot = row.lo_hang_id;
        if (lot && lot.trang_thai === 'huy') return map;
        const key = String(row.hang_hoa_id);
        const tenLo = lot ? String(lot.ten_lo || '').trim() : '';
        const maLo = lot ? String(lot.ma_lo || '').trim() : '';
        if (!map[key]) map[key] = [];
        map[key].push({
            lo_hang_id: row.lo_hang_id ? String(row.lo_hang_id._id || row.lo_hang_id) : '',
            ten_quy_cach: String(row.ten_quy_cach || row.ten_thuoc_tinh || '').trim(),
            ten_thuoc_tinh: String(row.ten_thuoc_tinh || row.ten_quy_cach || '').trim(),
            ten_lo: tenLo,
            ma_lo: maLo,
            lot_label: tenLo || maLo,
            lot_name: tenLo,
            lot_ngay_nhap: lot ? lot.ngay_nhap : null,
            lot_han_su_dung: lot ? lot.han_su_dung : null,
            ton_hien_tai: Number(row.so_luong || 0),
            gia_von: Number(row.gia_von || row.don_gia_nhap || 0)
        });
        return map;
    }, {});

    let items = products.map(function(p) {
        const id = String(p._id);
        const quyCachItems = quyCachByProduct[id] || [];
        let tonKho = Number(stockByNormal[id] || 0);
        if (p.quan_ly_theo_lo) {
            const qcSum = quyCachItems.reduce(function(sum, row) {
                return sum + Number(row.ton_hien_tai || 0);
            }, 0);
            const lotSum = qcSum || Number(stockByLotProduct[id] || 0);
            tonKho = lotSum > 0 ? lotSum : tonKho;
        }
        return {
            _id: id,
            ma_hang: p.ma_hang || '',
            ten_hang: p.ten_hang || '',
            don_vi_tinh: p.don_vi_tinh_id ? (p.don_vi_tinh_id.ten_don_vi || 'cái') : 'cái',
            gia_von: Number(p.gia_von || 0),
            quan_ly_theo_lo: Boolean(p.quan_ly_theo_lo),
            has_quy_cach: Boolean(quyCachItems.length),
            quy_cach_items: quyCachItems,
            ton_kho: tonKho
        };
    });

    const q = String(keyword || '').trim().toLowerCase();
    if (q) {
        items = items.filter(function(p) {
            return String(p.ma_hang || '').toLowerCase().includes(q)
                || String(p.ten_hang || '').toLowerCase().includes(q);
        });
    }
    return items;
}

const STATUS_MAP = {
    draft: 'Phiếu tạm',
    completed: 'Hoàn thành',
    cancelled: 'Đã hủy'
};
const XNB_PAGE_SIZE = 10;

function missingDataStatusFilter() {
    return {
        $or: [
            { trang_thai_du_lieu: { $exists: false } },
            { trang_thai_du_lieu: null },
            { trang_thai_du_lieu: '' }
        ]
    };
}

async function ensureXnbDataStatusDefault() {
    await PhieuXuatNoiBo.updateMany(
        Object.assign({ trang_thai: 'cancelled' }, missingDataStatusFilter()),
        { $set: { trang_thai_du_lieu: 'inactive' } }
    );
    await PhieuXuatNoiBo.updateMany(
        Object.assign({ trang_thai: { $ne: 'cancelled' } }, missingDataStatusFilter()),
        { $set: { trang_thai_du_lieu: 'active' } }
    );
}

const EXPORT_STATUS_MAP = {
    draft: 'Phiếu tạm',
    completed: 'Hoàn thành',
    cancelled: 'Đã hủy'
};

const EXPORT_RECEIVER_TYPE_MAP = {
    nhan_vien: 'Nhân viên',
    khach_hang: 'Khách hàng',
    nha_cung_cap: 'Nhà cung cấp',
    khac: 'Khác'
};

const XUAT_NOI_BO_EXPORT_COLUMNS = [
    { header: 'Mã xuất nội bộ', key: 'ma_xuat_noi_bo' },
    { header: 'Thời gian', key: 'thoi_gian' },
    { header: 'Loại xuất', key: 'loai_xuat' },
    { header: 'Kho xuất', key: 'kho_xuat' },
    { header: 'Người tạo', key: 'nguoi_tao' },
    { header: 'Người nhận', key: 'nguoi_nhan' },
    { header: 'Loại người nhận', key: 'loai_nguoi_nhan' },
    { header: 'Tổng số lượng', key: 'tong_so_luong', style: { numFmt: '#,##0.##' } },
    { header: 'Tổng giá trị', key: 'tong_gia_tri', style: { numFmt: '#,##0' } },
    { header: 'Cộng dồn vào thẻ', key: 'cong_don_vao_the' },
    { header: 'Ghi chú', key: 'ghi_chu' },
    { header: 'Trạng thái', key: 'trang_thai' },
    { header: 'Mã hàng', key: 'ma_hang' },
    { header: 'Tên hàng', key: 'ten_hang' },
    { header: 'Thương hiệu', key: 'thuong_hieu' },
    { header: 'Đơn vị tính', key: 'don_vi_tinh' },
    { header: 'Lô hàng', key: 'lo_hang' },
    { header: 'Số lượng', key: 'so_luong', style: { numFmt: '#,##0.##' } },
    { header: 'Giá vốn', key: 'gia_von', style: { numFmt: '#,##0' } },
    { header: 'Thành tiền', key: 'thanh_tien', style: { numFmt: '#,##0' } }
];

function slugifyLoaiXuat(text) {
    return String(text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}

async function seedLoaiXuatIfEmpty() {
    const count = await LoaiXuatNoiBo.countDocuments();
    if (count > 0) return;

    await LoaiXuatNoiBo.insertMany([
        { ma_loai: 'van_phong_pham', ten_loai: 'Xuất văn phòng phẩm, dụng cụ làm việc', trang_thai: 'active' },
        { ma_loai: 'vat_tu_tieu_hao', ten_loai: 'Xuất vật tư tiêu hao, công cụ dụng cụ', trang_thai: 'active' },
        { ma_loai: 'su_kien_noi_bo', ten_loai: 'Xuất phục vụ sự kiện, hội nghị nội bộ', trang_thai: 'active' },
        { ma_loai: 'boi_thuong', ten_loai: 'Xuất bồi thường, đền bù', trang_thai: 'active' },
        { ma_loai: 'mau_trung_bay', ten_loai: 'Xuất mẫu trưng bày, demo sản phẩm', trang_thai: 'active' },
        { ma_loai: 'qua_tang', ten_loai: 'Xuất quà tặng khách hàng, đối tác', trang_thai: 'active' },
        { ma_loai: 'khac', ten_loai: 'Khác', trang_thai: 'active' }
    ]);
}

async function loadLoaiXuatList() {
    await seedLoaiXuatIfEmpty();
    return LoaiXuatNoiBo.find({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
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

function parseVatChuaItems(rawItems) {
    const items = parseItems(rawItems);
    const map = new Map();
    items.forEach(function(item) {
        const id = String(item.vat_chua_id || item._id || '').trim();
        const qty = Math.floor(Number(item.so_luong || item.qty || 0));
        if (!mongoose.Types.ObjectId.isValid(id) || qty <= 0) return;
        map.set(id, Number(map.get(id) || 0) + qty);
    });
    return Array.from(map.entries()).map(function(entry) {
        return { vat_chua_id: entry[0], so_luong: entry[1] };
    });
}

async function normalizeVatChuaXnbItems(rawItems, storeId) {
    const parsedItems = parseVatChuaItems(rawItems);
    if (!parsedItems.length) return [];
    const store = String(storeId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(store)) {
        throw Object.assign(new Error('Vui lòng chọn cửa hàng trước khi xuất vật chứa.'), { statusCode: 400 });
    }

    const ids = parsedItems.map(function(item) { return item.vat_chua_id; });
    const vatChuaRows = await VatChua.find({
        _id: { $in: ids },
        cua_hang_id: store,
        trang_thai: 'active'
    }).lean();
    const rowMap = vatChuaRows.reduce(function(map, row) {
        map[String(row._id)] = row;
        return map;
    }, {});

    const costMap = await loadAverageCostByVatChuaIds(store, ids);

    return parsedItems.map(function(item) {
        const row = rowMap[item.vat_chua_id];
        if (!row) {
            throw Object.assign(new Error('Vật chứa không hợp lệ hoặc đã ngừng sử dụng.'), { statusCode: 400 });
        }
        const ton = Math.max(0, Number(row.so_luong_ton || 0));
        if (ton < item.so_luong) {
            throw Object.assign(
                new Error('Tồn vật chứa không đủ để xuất: ' + (row.ten_vat_chua || row.ma_vat_chua || '') + ' còn ' + ton + ', cần ' + item.so_luong),
                { statusCode: 400 }
            );
        }
        const giaVon = Math.max(0, Number(costMap[item.vat_chua_id] || 0));
        const thanhTien = Math.round(giaVon * item.so_luong);
        return {
            vat_chua_id: row._id,
            ma_vat_chua: row.ma_vat_chua || '',
            ten_vat_chua: row.ten_vat_chua || '',
            so_luong: item.so_luong,
            gia_von: giaVon,
            thanh_tien: thanhTien
        };
    });
}

function queryValue(query, key) {
    const raw = query && query[key];
    const value = Array.isArray(raw) ? raw.find(item => String(item || '').trim()) : raw;
    return String(value || '').trim();
}

function buildFilter(query) {
    const filter = { trang_thai_du_lieu: 'active' };
    const allowedStatuses = ['draft', 'completed', 'cancelled'];
    const rawStatuses = Array.isArray(query.trang_thai)
        ? query.trang_thai
        : (query.trang_thai ? [query.trang_thai] : []);
    const statuses = rawStatuses
        .map(status => String(status || '').trim())
        .filter(status => allowedStatuses.includes(status));
    const selectedStatuses = statuses.length ? statuses : ['draft', 'completed'];

    filter.trang_thai = { $in: selectedStatuses };
    const q = queryValue(query, 'q');
    const loaiXuat = queryValue(query, 'loai_xuat');
    const nguoiTaoId = queryValue(query, 'nguoi_tao_id');
    const nguoiNhan = queryValue(query, 'nguoi_nhan');

    if (q) filter.ma_xuat_noi_bo = { $regex: q, $options: 'i' };
    if (loaiXuat) filter.loai_xuat = loaiXuat;
    if (nguoiTaoId) filter.nguoi_tao_id = nguoiTaoId;
    if (nguoiNhan) filter.nguoi_nhan = { $regex: nguoiNhan, $options: 'i' };
    return {
        filter,
        statuses: selectedStatuses,
        filters: {
            q,
            trang_thai: selectedStatuses,
            loai_xuat: loaiXuat,
            nguoi_tao_id: nguoiTaoId,
            nguoi_nhan: nguoiNhan
        }
    };
}

function parsePage(query) {
    const page = Number(query && query.page);
    return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function buildListQueryString(query, overrides) {
    const params = new URLSearchParams();
    Object.entries(query || {}).forEach(([key, value]) => {
        if (key === 'page' || key === 'page_size') return;
        if (Array.isArray(value)) {
            value.forEach(item => params.append(key, item));
        } else if (value !== undefined && value !== null && String(value) !== '') {
            params.append(key, value);
        }
    });
    const page = Number(overrides && overrides.page);
    if (Number.isFinite(page) && page > 1) params.set('page', String(Math.floor(page)));
    return params.toString();
}

function formatDateTime(value) {
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

function getCreatorName(user) {
    return user ? (user.ho_ten || user.username || user.email || '') : '';
}

function getLotName(lot) {
    return lot ? (lot.ten_lo || lot.ma_lo || '') : '';
}

function buildExportRow(ticket, detail) {
    const product = detail?.hang_hoa_id || {};
    return {
        ma_xuat_noi_bo: ticket.ma_xuat_noi_bo || '',
        thoi_gian: formatDateTime(ticket.ngay_xuat || ticket.created_at),
        loai_xuat: ticket.loai_xuat || '',
        kho_xuat: ticket.kho_id ? ticket.kho_id.ten_kho : '',
        nguoi_tao: getCreatorName(ticket.nguoi_tao_id),
        nguoi_nhan: ticket.nguoi_nhan || '',
        loai_nguoi_nhan: EXPORT_RECEIVER_TYPE_MAP[ticket.loai_nguoi_nhan] || ticket.loai_nguoi_nhan || '',
        tong_so_luong: Number(ticket.tong_so_luong || 0),
        tong_gia_tri: Number(ticket.tong_gia_tri || 0),
        cong_don_vao_the: ticket.cong_don_vao_the ? 'Có' : 'Không',
        ghi_chu: ticket.ghi_chu || '',
        trang_thai: EXPORT_STATUS_MAP[ticket.trang_thai] || ticket.trang_thai || '',
        ma_hang: product.ma_hang || '',
        ten_hang: product.ten_hang || '',
        thuong_hieu: product.thuong_hieu_id ? product.thuong_hieu_id.ten_thuong_hieu : '',
        don_vi_tinh: product.don_vi_tinh_id ? product.don_vi_tinh_id.ten_don_vi : '',
        lo_hang: getLotName(detail?.lo_hang_id),
        ten_quy_cach: detail ? (detail.ten_quy_cach || '') : '',
        so_luong: detail ? Number(detail.so_luong || 0) : 0,
        gia_von: detail ? Number(detail.gia_von || 0) : 0,
        thanh_tien: detail ? Number(detail.thanh_tien || 0) : 0
    };
}

function buildDetailSummary(details) {
    const summaryMap = new Map();
    let totalQuantity = 0;
    let totalValue = 0;

    details.forEach(detail => {
        const product = detail.hang_hoa_id || {};
        const productId = String(product._id || detail.hang_hoa_id || '');
        const tenQuyCach = String(detail.ten_quy_cach || '').trim();
        const thuocTinh = tenQuyCach || 'Không có';
        const summaryKey = productId + '::' + tenQuyCach;
        const quantity = Number(detail.so_luong || 0);
        const unitCost = Number(detail.gia_von || 0);
        const lineValue = Number(detail.thanh_tien != null ? detail.thanh_tien : quantity * unitCost);

        totalQuantity += quantity;
        totalValue += lineValue;

        if (!summaryMap.has(summaryKey)) {
            summaryMap.set(summaryKey, {
                hang_hoa_id: productId,
                ma_hang: product.ma_hang || '',
                ten_hang: product.ten_hang || '',
                ten_quy_cach: tenQuyCach,
                thuoc_tinh: thuocTinh,
                don_vi_tinh: product.don_vi_tinh_id ? product.don_vi_tinh_id.ten_don_vi : '',
                so_luong: 0,
                thanh_tien: 0
            });
        }

        const row = summaryMap.get(summaryKey);
        row.so_luong += quantity;
        row.thanh_tien += lineValue;
    });

    return {
        items: Array.from(summaryMap.values()).map(row => ({
            ...row,
            gia_tri_binh_quan: row.so_luong ? row.thanh_tien / row.so_luong : 0
        })),
        totalQuantity,
        totalValue
    };
}

function buildVatChuaDetailItems(rawItems) {
    const items = Array.isArray(rawItems) ? rawItems : [];
    return items.map(function(item) {
        const soLuong = Number(item.so_luong || 0);
        const giaVon = Number(item.gia_von || 0);
        const thanhTien = Number(item.thanh_tien != null ? item.thanh_tien : soLuong * giaVon);
        return {
            ma_vat_chua: item.ma_vat_chua || '',
            ten_vat_chua: item.ten_vat_chua || '',
            so_luong: soLuong,
            gia_von: giaVon,
            thanh_tien: thanhTien
        };
    }).filter(function(item) {
        return item.so_luong > 0;
    });
}

function sendDetailJsonError(res, error, fallbackMessage) {
    const status = error && Number(error.status || error.statusCode) || 500;
    const message = error && error.message ? error.message : fallbackMessage;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
        success: false,
        message
    });
}

function applyWorksheetFormat(worksheet) {
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell(cell => {
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
        to: { row: 1, column: XUAT_NOI_BO_EXPORT_COLUMNS.length }
    };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        row.eachCell(cell => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
            };
            cell.alignment = { vertical: 'middle' };
        });
    });

    worksheet.columns.forEach(column => {
        let maxLength = String(column.header || '').length;
        column.eachCell({ includeEmpty: true }, cell => {
            const value = cell.value == null ? '' : String(cell.value);
            maxLength = Math.max(maxLength, value.length);
        });
        column.width = Math.min(Math.max(maxLength + 2, 12), 36);
    });
}

async function loadExportTickets(filter) {
    const tickets = await PhieuXuatNoiBo.find(filter)
        .populate('kho_id')
        .populate('nguoi_tao_id')
        .sort({ ngay_xuat: -1, created_at: -1 });
    const ticketIds = tickets.map(ticket => ticket._id);
    const details = ticketIds.length
        ? await CTXuatNoiBo.find({ phieu_xuat_id: { $in: ticketIds } })
            .populate({
                path: 'hang_hoa_id',
                populate: [
                    { path: 'thuong_hieu_id' },
                    { path: 'don_vi_tinh_id' }
                ]
            })
            .populate('lo_hang_id')
        : [];
    const detailMap = details.reduce((acc, detail) => {
        const key = String(detail.phieu_xuat_id);
        if (!acc[key]) acc[key] = [];
        acc[key].push(detail);
        return acc;
    }, {});
    return { tickets, detailMap };
}

async function sendXuatNoiBoWorkbook(res, filename, tickets, detailMap) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Xuất nội bộ');
    worksheet.columns = XUAT_NOI_BO_EXPORT_COLUMNS;

    tickets.forEach(ticket => {
        const details = detailMap[String(ticket._id)] || [];
        if (!details.length) {
            worksheet.addRow(buildExportRow(ticket, null));
            return;
        }
        details.forEach(detail => worksheet.addRow(buildExportRow(ticket, detail)));
    });

    applyWorksheetFormat(worksheet);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
}

exports.index = async (req, res, next) => {
    try {
        await ensureXnbDataStatusDefault();
        const { filter, statuses, filters } = buildFilter(req.query);
        let page = parsePage(req.query);
        const pageSize = XNB_PAGE_SIZE;
        const [total, totalAgg, users, loaiXuatList] = await Promise.all([
            PhieuXuatNoiBo.countDocuments(filter),
            PhieuXuatNoiBo.aggregate([
                { $match: filter },
                { $group: { _id: null, totalValue: { $sum: { $ifNull: ['$tong_gia_tri', 0] } } } }
            ]),
            NguoiDung.find().sort({ ho_ten: 1 }),
            loadLoaiXuatList()
        ]);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        if (page > totalPages) page = totalPages;
        const skip = (page - 1) * pageSize;
        const tickets = await PhieuXuatNoiBo.find(filter)
            .populate('cua_hang_id')
            .populate('kho_id')
            .populate('nguoi_tao_id')
            .sort({ ngay_xuat: -1, created_at: -1 })
            .skip(skip)
            .limit(pageSize);

        res.render('xuat-dung-noi-bo/index', {
            tickets,
            users,
            loaiXuatList,
            filters,
            selectedStatuses: statuses,
            statusMap: STATUS_MAP,
            tongGiaTriXuat: totalAgg[0] ? Number(totalAgg[0].totalValue || 0) : 0,
            pagination: {
                total,
                page,
                limit: pageSize,
                totalPages,
                from: total === 0 ? 0 : skip + 1,
                to: Math.min(skip + pageSize, total)
            },
            qs: function(overrides) {
                return buildListQueryString(filters || {}, overrides || {});
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.getApiSanPham = async (req, res, next) => {
    try {
        const khoId = String(req.query.kho_id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(khoId)) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho.' });
        }
        const kho = await Kho.findById(khoId).lean();
        if (!kho) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy kho.' });
        }
        const items = await loadProductsForXnbKho(khoId, req.query.keyword);
        return res.json({ success: true, items: items.slice(0, 100) });
    } catch (error) {
        next(error);
    }
};

exports.getApiVatChua = async (req, res, next) => {
    try {
        const storeId = await resolveStoreId(req);
        if (!storeId) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn cửa hàng.' });
        }
        const keyword = String(req.query.keyword || '').trim();
        const query = {
            cua_hang_id: storeId,
            trang_thai: 'active',
            so_luong_ton: { $gt: 0 }
        };
        if (keyword) {
            query.$or = [
                { ma_vat_chua: { $regex: keyword, $options: 'i' } },
                { ten_vat_chua: { $regex: keyword, $options: 'i' } }
            ];
        }
        const items = await VatChua.find(query)
            .sort({ ten_vat_chua: 1, ma_vat_chua: 1 })
            .select('ma_vat_chua ten_vat_chua so_luong_ton')
            .limit(100)
            .lean();

        return res.json({
            success: true,
            items: items.map(function(item) {
                return {
                    _id: String(item._id),
                    ma_vat_chua: item.ma_vat_chua || '',
                    ten_vat_chua: item.ten_vat_chua || '',
                    so_luong_ton: Number(item.so_luong_ton || 0)
                };
            })
        });
    } catch (error) {
        next(error);
    }
};

exports.getCreate = async (req, res, next) => {
    try {
        const storeId = await resolveStoreId(req);
        const [users, warehouses, customers, suppliers] = await Promise.all([
            NguoiDung.find().sort({ ho_ten: 1 }),
            storeId
                ? Kho.find({ trang_thai: 'active', cua_hang_id: storeId }).sort({ ten_kho: 1 })
                : [],
            KhachHang.find().sort({ ten_khach_hang: 1 }),
            NhaCungCap.find().sort({ ten_ncc: 1 })
        ]);
        const loaiXuatList = await loadLoaiXuatList();
        const nextCode = await makeXnbCode();
        res.render('xuat-dung-noi-bo/create', {
            currentStoreId: storeId || '',
            nextCode,
            users,
            warehouses,
            customers,
            suppliers,
            loaiXuatList,
            todayValue: formatDateTimeLocal()
        });
    } catch (error) {
        next(error);
    }
};

exports.postLoaiXuatAdd = async (req, res, next) => {
    try {
        const tenLoai = String(req.body.ten_loai || '').trim();
        let maLoai = String(req.body.ma_loai || '').trim().toLowerCase();
        if (!tenLoai) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập tên loại xuất.' });
        }
        if (!maLoai) maLoai = slugifyLoaiXuat(tenLoai);
        if (!maLoai) maLoai = 'loai_' + Date.now();

        const created = await LoaiXuatNoiBo.create({
            ma_loai: maLoai,
            ten_loai: tenLoai,
            trang_thai: 'active'
        });

        return res.json({
            success: true,
            message: 'Đã thêm loại xuất.',
            selectedId: String(created._id),
            loaiXuatList: await loadLoaiXuatList()
        });
    } catch (error) {
        if (error && error.code === 11000) {
            return res.status(400).json({ success: false, message: 'Loại xuất đã tồn tại.' });
        }
        next(error);
    }
};

exports.postLoaiXuatIdUpdate = async (req, res, next) => {
    try {
        const id = String(req.params.id || '');
        const tenLoai = String(req.body.ten_loai || '').trim();
        if (!tenLoai) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập tên loại xuất.' });
        }

        const existing = await LoaiXuatNoiBo.findById(id).lean();
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy loại xuất.' });
        }

        await ensureXnbDataStatusDefault();
        await LoaiXuatNoiBo.findByIdAndUpdate(id, { ten_loai: tenLoai }, { runValidators: true });
        if (existing.ten_loai && existing.ten_loai !== tenLoai) {
            await PhieuXuatNoiBo.updateMany(
                { loai_xuat: existing.ten_loai, trang_thai_du_lieu: 'active' },
                { $set: { loai_xuat: tenLoai } }
            );
        }

        return res.json({
            success: true,
            message: 'Đã cập nhật loại xuất.',
            selectedId: id,
            loaiXuatList: await loadLoaiXuatList()
        });
    } catch (error) {
        if (error && error.code === 11000) {
            return res.status(400).json({ success: false, message: 'Tên loại xuất đã tồn tại.' });
        }
        next(error);
    }
};

exports.postLoaiXuatIdDelete = async (req, res, next) => {
    try {
        const id = String(req.params.id || '');
        const existing = await LoaiXuatNoiBo.findById(id).lean();
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy loại xuất.' });
        }

        await ensureXnbDataStatusDefault();
        const inUse = await PhieuXuatNoiBo.countDocuments({ loai_xuat: existing.ten_loai, trang_thai_du_lieu: 'active' });
        if (inUse > 0) {
            await LoaiXuatNoiBo.findByIdAndUpdate(id, { trang_thai: 'inactive' });
            return res.json({
                success: true,
                message: 'Loại xuất đang được dùng — đã ẩn khỏi danh sách chọn.',
                loaiXuatList: await loadLoaiXuatList()
            });
        }

        await LoaiXuatNoiBo.findByIdAndDelete(id);
        return res.json({
            success: true,
            message: 'Đã xóa loại xuất.',
            loaiXuatList: await loadLoaiXuatList()
        });
    } catch (error) {
        next(error);
    }
};

exports.postAdd = async (req, res, next) => {
    try {
        const {
            cua_hang_id,
            kho_id,
            loai_xuat,
            loai_nguoi_nhan,
            nguoi_nhan,
            ghi_chu,
            trang_thai,
            cong_don_vao_the,
            ngay_xuat
        } = req.body || {};
        const items = parseItems(req.body?.items);
        const sessionStoreId = await resolveStoreId(req);
        const effectiveStoreId = cua_hang_id || sessionStoreId;
        const ngayXuat = ngay_xuat ? new Date(ngay_xuat) : new Date();
        let normalizedVatChuaItems = [];

        if (Number.isNaN(ngayXuat.getTime())) {
            return res.status(400).json({ success: false, message: 'Ngày tạo không hợp lệ' });
        }

        if (!kho_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho.' });
        }

        const kho = await Kho.findById(kho_id);
        if (!kho) {
            return res.status(400).json({ success: false, message: 'Kho xuất không hợp lệ' });
        }

        const finalReceiverType = ['nhan_vien', 'khach_hang', 'nha_cung_cap', 'khac'].includes(loai_nguoi_nhan) ? loai_nguoi_nhan : 'khac';
        const finalReceiverName = String(nguoi_nhan || '').trim();
        if (!finalReceiverName) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn hoặc nhập người nhận' });
        }

        const finalStatus = trang_thai === 'completed' ? 'completed' : (trang_thai === 'cancelled' ? 'cancelled' : 'draft');
        try {
            normalizedVatChuaItems = await normalizeVatChuaXnbItems(req.body?.vat_chua_items, effectiveStoreId || kho.cua_hang_id);
        } catch (error) {
            return res.status(error.statusCode || 400).json({ success: false, message: error.message || 'Dữ liệu vật chứa không hợp lệ' });
        }
        let tongGiaTri = 0;
        let tongSoLuong = 0;
        const normalizedItems = [];

        for (const item of items) {
            const product = await HangHoa.findById(item.hang_hoa_id);
            if (!product) continue;

            const quyCachItems = Array.isArray(item.quy_cach_items) ? item.quy_cach_items : [];
            if (quyCachItems.length) {
                for (const qc of quyCachItems) {
                    const soLuong = Number(qc.so_luong) || 0;
                    const tenQuyCach = String(qc.ten_quy_cach || qc.ten_thuoc_tinh || '').trim();
                    const loHangId = qc.lo_hang_id || item.lo_hang_id || null;
                    if (soLuong <= 0 || !tenQuyCach || !loHangId) continue;

                    const qcStock = await TonKhoLoQuyCach.findOne({
                        kho_id,
                        hang_hoa_id: product._id,
                        lo_hang_id: loHangId,
                        $or: [{ ten_quy_cach: tenQuyCach }, { ten_thuoc_tinh: tenQuyCach }]
                    }).lean();
                    if (!qcStock || Number(qcStock.so_luong || 0) < soLuong) {
                        return res.status(400).json({ success: false, message: 'Số lượng xuất theo quy cách không đủ tồn kho' });
                    }

                    const giaVon = Number(qcStock.gia_von || qcStock.don_gia_nhap || product.gia_von || 0);
                    const thanhTien = soLuong * giaVon;
                    tongSoLuong += soLuong;
                    tongGiaTri += thanhTien;
                    normalizedItems.push({ product, loHangId, tenQuyCach, soLuong, giaVon, thanhTien });
                }
                continue;
            }

            const soLuong = Number(item.so_luong) || 0;
            if (soLuong <= 0) continue;

            const giaVon = Number(product.gia_von || 0);
            const thanhTien = soLuong * giaVon;
            tongSoLuong += soLuong;
            tongGiaTri += thanhTien;
            normalizedItems.push({ product, loHangId: item.lo_hang_id || null, tenQuyCach: '', soLuong, giaVon, thanhTien });
        }

        if (!normalizedItems.length && !normalizedVatChuaItems.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất 1 hàng hóa hoặc vật chứa' });
        }

        normalizedVatChuaItems.forEach(function(item) {
            tongSoLuong += Number(item.so_luong || 0);
            tongGiaTri += Number(item.thanh_tien || 0);
        });

        const ma_xuat_noi_bo = await makeXnbCode();
        const phieu = await PhieuXuatNoiBo.create({
            ma_xuat_noi_bo,
            ngay_xuat: ngayXuat,
            loai_xuat: loai_xuat || 'xuat_dung_noi_bo',
            cua_hang_id: effectiveStoreId || kho.cua_hang_id,
            kho_id: kho._id,
            nguoi_tao_id: req.user?._id,
            nguoi_nhan: finalReceiverName,
            loai_nguoi_nhan: finalReceiverType,
            tong_so_luong: tongSoLuong,
            tong_gia_tri: tongGiaTri,
            vat_chua_items: normalizedVatChuaItems,
            cong_don_vao_the: false,
            trang_thai: finalStatus,
            trang_thai_du_lieu: 'active',
            ghi_chu: ghi_chu || ''
        });

        for (const item of normalizedItems) {
            await CTXuatNoiBo.create({
                phieu_xuat_id: phieu._id,
                hang_hoa_id: item.product._id,
                lo_hang_id: item.loHangId,
                ten_quy_cach: item.tenQuyCach || '',
                so_luong: item.soLuong,
                gia_von: item.giaVon,
                thanh_tien: item.thanhTien
            });

            if (finalStatus === 'completed') {
                try {
                    await truTonKho({
                        kho_id: kho._id,
                        hang_hoa_id: item.product._id,
                        lo_hang_id: item.loHangId,
                        ten_quy_cach: item.tenQuyCach || '',
                        sync_quy_cach: Boolean(item.tenQuyCach),
                        so_luong: item.soLuong,
                        gia_von: item.giaVon,
                        nguoi_tao_id: req.user?._id,
                        loai_phieu: 'xuat_noi_bo',
                        ma_phieu: ma_xuat_noi_bo,
                        ngay: ngayXuat,
                        ghi_chu: ghi_chu || 'Xuat dung noi bo'
                    });
                } catch (_) {
                    return res.status(400).json({ success: false, message: 'Không đủ tồn kho để xuất' });
                }

                await HangHoa.findByIdAndUpdate(item.product._id, { $inc: { ton_kho: -item.soLuong } });
            }
        }

        if (finalStatus === 'completed' && normalizedVatChuaItems.length) {
            for (const item of normalizedVatChuaItems) {
                try {
                    await createXuatVatChuaAndDecreaseStock({
                        storeId: phieu.cua_hang_id,
                        vatChuaId: item.vat_chua_id,
                        qty: item.so_luong,
                        loaiXuat: 'su_dung_noi_bo',
                        doiTuongType: finalReceiverType === 'nha_cung_cap' ? 'nha_cung_cap' : (finalReceiverType === 'khach_hang' ? 'khach_hang' : 'khac'),
                        doiTuongTen: finalReceiverName,
                        sourceType: 'xuat_noi_bo',
                        sourceId: phieu._id,
                        sourceCode: ma_xuat_noi_bo,
                        ghiChu: ghi_chu || 'Xuất vật chứa dùng nội bộ'
                    });
                } catch (error) {
                    return res.status(400).json({ success: false, message: error.message || 'Không đủ tồn vật chứa để xuất' });
                }
            }
        }

        return res.json({
            success: true,
            message: finalStatus === 'completed' ? 'Đã hoàn thành phiếu xuất' : 'Đã lưu phiếu',
            ma_xuat_noi_bo,
            id: phieu._id,
            print_url: '/chung-tu-kho/xuat-noi-bo/' + phieu._id
        });
    } catch (error) {
        next(error);
    }
};

async function cancelXnbTicket(ticketId, userId) {
    if (!mongoose.Types.ObjectId.isValid(String(ticketId || ''))) {
        return { skipped: true };
    }
    const ticket = await PhieuXuatNoiBo.findOne({ _id: ticketId, trang_thai_du_lieu: 'active' });
    if (!ticket) {
        return { skipped: true };
    }

    if (ticket.trang_thai === 'completed') {
        const details = await CTXuatNoiBo.find({ phieu_xuat_id: ticket._id }).lean();
        for (const item of details) {
            const qty = Number(item.so_luong || 0);
            if (qty <= 0 || !item.hang_hoa_id) continue;
            await congTonKho({
                kho_id: ticket.kho_id,
                hang_hoa_id: item.hang_hoa_id,
                lo_hang_id: item.lo_hang_id || null,
                ten_quy_cach: item.ten_quy_cach || '',
                sync_quy_cach: Boolean(item.ten_quy_cach),
                so_luong: qty,
                gia_von: Number(item.gia_von || 0),
                nguoi_tao_id: userId,
                loai_phieu: 'xuat_noi_bo',
                ma_phieu: ticket.ma_xuat_noi_bo,
                ghi_chu: 'Huy xuat dung noi bo ' + (ticket.ma_xuat_noi_bo || '')
            });
            await HangHoa.findByIdAndUpdate(item.hang_hoa_id, { $inc: { ton_kho: qty } });
        }

        await cancelXuatVatChuaBySource(ticket.cua_hang_id, 'xuat_noi_bo', ticket._id);
    }

    ticket.trang_thai_du_lieu = 'inactive';
    await ticket.save();
    return { skipped: false };
}

exports.deleteSelected = async (req, res, next) => {
    try {
        await ensureXnbDataStatusDefault();
        const rawIds = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
        const ids = Array.from(new Set(rawIds.map(function(id) { return String(id || '').trim(); })))
            .filter(function(id) { return mongoose.Types.ObjectId.isValid(id); });
        if (!ids.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn phiếu cần xóa.' });
        }

        let modifiedCount = 0;
        for (const id of ids) {
            const result = await cancelXnbTicket(id, req.user && req.user._id);
            if (!result.skipped) modifiedCount += 1;
        }

        return res.json({
            success: true,
            modified_count: modifiedCount,
            message: modifiedCount ? 'Đã xóa phiếu xuất dùng nội bộ.' : 'Không có phiếu nào cần xóa.'
        });
    } catch (error) {
        next(error);
    }
};

exports.getExportCsv = async (req, res, next) => {
    try {
        await ensureXnbDataStatusDefault();
        const { filter } = buildFilter(req.query);
        const tickets = await PhieuXuatNoiBo.find(filter)
            .populate('cua_hang_id')
            .populate('kho_id')
            .sort({ ngay_xuat: -1, created_at: -1 });

        const rows = [['ma_xuat_noi_bo', 'loai_xuat', 'tong_so_luong', 'tong_gia_tri', 'kho', 'trang_thai']];
        tickets.forEach(t => {
            rows.push([
                t.ma_xuat_noi_bo,
                t.loai_xuat || '',
                t.tong_so_luong || 0,
                t.tong_gia_tri || 0,
                t.kho_id ? t.kho_id.ten_kho : '',
                t.trang_thai || ''
            ]);
        });

        const csv = rows.map(row => row.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="xuat-dung-noi-bo.csv"');
        res.send('\ufeff' + csv);
    } catch (error) {
        next(error);
    }
};

exports.getExportXlsx = async (req, res, next) => {
    try {
        await ensureXnbDataStatusDefault();
        const { filter } = buildFilter(req.query);
        const { tickets, detailMap } = await loadExportTickets(filter);
        await sendXuatNoiBoWorkbook(res, 'xuat-noi-bo.xlsx', tickets, detailMap);
    } catch (error) {
        next(error);
    }
};

exports.getDetails = async (req, res, next) => {
    try {
        await ensureXnbDataStatusDefault();
        const { filter } = buildFilter(req.query);
        const tickets = await PhieuXuatNoiBo.find(filter).select('_id').lean();
        const ticketIds = tickets.map(ticket => ticket._id);
        const details = ticketIds.length
            ? await CTXuatNoiBo.find({ phieu_xuat_id: { $in: ticketIds } })
                .populate({
                    path: 'hang_hoa_id',
                    populate: { path: 'don_vi_tinh_id' }
                })
                .lean()
            : [];
        const summary = buildDetailSummary(details);

        return res.json({
            success: true,
            ticket: {
                ma_xuat_noi_bo: 'Tổng hợp xuất dùng nội bộ',
                loai_xuat: '',
                kho: '',
                chi_nhanh: '',
                tong_so_luong: summary.totalQuantity,
                tong_gia_tri: summary.totalValue
            },
            items: summary.items,
            totalQuantity: summary.totalQuantity,
            totalValue: summary.totalValue
        });
    } catch (error) {
        return sendDetailJsonError(res, error, 'Không tải được chi tiết tổng xuất dùng nội bộ');
    }
};

exports.getIdDetails = async (req, res, next) => {
    try {
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu xuất nội bộ' });
        }

        await ensureXnbDataStatusDefault();
        const ticket = await PhieuXuatNoiBo.findOne({ _id: req.params.id, trang_thai_du_lieu: 'active' })
            .populate('cua_hang_id')
            .populate('kho_id')
            .lean();
        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu xuất nội bộ' });
        }

        const details = await CTXuatNoiBo.find({ phieu_xuat_id: ticket._id })
            .populate({
                path: 'hang_hoa_id',
                populate: { path: 'don_vi_tinh_id' }
            })
            .lean();
        const summary = buildDetailSummary(details);
        const vatChuaItems = buildVatChuaDetailItems(ticket.vat_chua_items);
        const vatChuaQty = vatChuaItems.reduce(function(sum, item) { return sum + Number(item.so_luong || 0); }, 0);
        const vatChuaValue = vatChuaItems.reduce(function(sum, item) { return sum + Number(item.thanh_tien || 0); }, 0);
        const totalQuantity = Number(ticket.tong_so_luong || summary.totalQuantity + vatChuaQty);
        const totalValue = Number(ticket.tong_gia_tri || summary.totalValue + vatChuaValue);

        return res.json({
            success: true,
            ticket: {
                id: String(ticket._id),
                ma_xuat_noi_bo: ticket.ma_xuat_noi_bo || '',
                loai_xuat: ticket.loai_xuat || '',
                ngay_xuat: ticket.ngay_xuat || ticket.created_at || null,
                kho: ticket.kho_id ? ticket.kho_id.ten_kho : '',
                chi_nhanh: ticket.cua_hang_id ? ticket.cua_hang_id.ten_cua_hang : '',
                tong_so_luong: totalQuantity,
                tong_gia_tri: totalValue
            },
            items: summary.items,
            vatChuaItems: vatChuaItems,
            totalQuantity: totalQuantity,
            totalValue: totalValue
        });
    } catch (error) {
        return sendDetailJsonError(res, error, 'Không tải được chi tiết phiếu xuất dùng nội bộ');
    }
};

exports.getIdExportXlsx = async (req, res, next) => {
    try {
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
            return res.status(404).send('Không tìm thấy phiếu xuất nội bộ');
        }

        const { tickets, detailMap } = await loadExportTickets({ _id: req.params.id });
        if (!tickets.length) {
            return res.status(404).send('Không tìm thấy phiếu xuất nội bộ');
        }

        const ticket = tickets[0];
        await sendXuatNoiBoWorkbook(
            res,
            `xuat-noi-bo-${ticket.ma_xuat_noi_bo || 'unknown'}.xlsx`,
            tickets,
            detailMap
        );
    } catch (error) {
        next(error);
    }
};
