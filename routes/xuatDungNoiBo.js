const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { isAuthenticated } = require('../middlewares/auth.middleware');
const {
    PhieuXuatNoiBo,
    CTXuatNoiBo,
    HangHoa,
    CuaHang,
    NguoiDung,
    Kho,
    KhachHang,
    NhaCungCap
} = require('../models/kiot.model');
const { truTonKho } = require('../services/kho.service');

router.use(isAuthenticated);

const STATUS_MAP = {
    draft: 'Phieu tam',
    completed: 'Hoan thanh',
    cancelled: 'Da huy'
};

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

function buildFilter(query) {
    const filter = {};
    const statuses = Array.isArray(query.trang_thai)
        ? query.trang_thai
        : (query.trang_thai ? [query.trang_thai] : ['draft', 'completed']);

    if (statuses.length) filter.trang_thai = { $in: statuses };
    if (query.q && query.q.trim()) {
        filter.ma_xuat_noi_bo = { $regex: query.q.trim(), $options: 'i' };
    }
    if (query.loai_xuat) filter.loai_xuat = query.loai_xuat;
    if (query.nguoi_tao_id) filter.nguoi_tao_id = query.nguoi_tao_id;
    if (query.nguoi_nhan) filter.nguoi_nhan = { $regex: query.nguoi_nhan.trim(), $options: 'i' };
    return { filter, statuses };
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
    return lot ? (lot.ma_lo || lot.ten_lo || '') : '';
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
        so_luong: detail ? Number(detail.so_luong || 0) : 0,
        gia_von: detail ? Number(detail.gia_von || 0) : 0,
        thanh_tien: detail ? Number(detail.thanh_tien || 0) : 0
    };
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
        .sort({ created_at: -1 });
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

router.get('/', async (req, res, next) => {
    try {
        const { filter, statuses } = buildFilter(req.query);
        const tickets = await PhieuXuatNoiBo.find(filter)
            .populate('cua_hang_id')
            .populate('kho_id')
            .populate('nguoi_tao_id')
            .sort({ created_at: -1 });
        const users = await NguoiDung.find().sort({ ho_ten: 1 });

        res.render('xuat-dung-noi-bo/index', {
            title: 'Xuat dung noi bo',
            tickets,
            users,
            filters: req.query,
            selectedStatuses: statuses,
            statusMap: STATUS_MAP
        });
    } catch (error) {
        next(error);
    }
});

router.get('/create', async (req, res, next) => {
    try {
        const [products, stores, users, warehouses, customers, suppliers] = await Promise.all([
            HangHoa.find().sort({ ten_hang: 1 }),
            CuaHang.find().sort({ ten_cua_hang: 1 }),
            NguoiDung.find().sort({ ho_ten: 1 }),
            Kho.find({ trang_thai: 'active' }).sort({ ten_kho: 1 }),
            KhachHang.find().sort({ ten_khach_hang: 1 }),
            NhaCungCap.find().sort({ ten_ncc: 1 })
        ]);
        res.render('xuat-dung-noi-bo/create', {
            title: 'Xuat dung noi bo',
            products,
            stores,
            users,
            warehouses,
            customers,
            suppliers
        });
    } catch (error) {
        next(error);
    }
});

router.post('/add', async (req, res, next) => {
    try {
        const {
            cua_hang_id,
            kho_id,
            loai_xuat,
            loai_nguoi_nhan,
            nguoi_nhan,
            ghi_chu,
            trang_thai,
            cong_don_vao_the
        } = req.body || {};
        const items = parseItems(req.body?.items);

        if (!kho_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho.' });
        }

        const kho = await Kho.findById(kho_id);
        if (!kho) {
            return res.status(400).json({ success: false, message: 'Kho xuat khong hop le' });
        }

        if (!items.length) {
            return res.status(400).json({ success: false, message: 'Vui long chon it nhat 1 hang hoa' });
        }
        const finalReceiverType = ['nhan_vien', 'khach_hang', 'nha_cung_cap', 'khac'].includes(loai_nguoi_nhan) ? loai_nguoi_nhan : 'khac';
        const finalReceiverName = String(nguoi_nhan || '').trim();
        if (!finalReceiverName) {
            return res.status(400).json({ success: false, message: 'Vui long chon hoac nhap nguoi nhan' });
        }

        const finalStatus = trang_thai === 'completed' ? 'completed' : (trang_thai === 'cancelled' ? 'cancelled' : 'draft');
        let tongGiaTri = 0;
        let tongSoLuong = 0;
        const normalizedItems = [];

        for (const item of items) {
            const product = await HangHoa.findById(item.hang_hoa_id);
            if (!product) continue;

            const soLuong = Number(item.so_luong) || 0;
            if (soLuong <= 0) continue;

            const giaVon = Number(item.gia_von ?? product.gia_von) || 0;
            const thanhTien = soLuong * giaVon;
            tongSoLuong += soLuong;
            tongGiaTri += thanhTien;
            normalizedItems.push({ product, loHangId: item.lo_hang_id || null, soLuong, giaVon, thanhTien });
        }

        if (!normalizedItems.length) {
            return res.status(400).json({ success: false, message: 'So luong xuat khong hop le' });
        }

        const ma_xuat_noi_bo = 'XNB' + Date.now();
        const phieu = await PhieuXuatNoiBo.create({
            ma_xuat_noi_bo,
            loai_xuat: loai_xuat || 'xuat_dung_noi_bo',
            cua_hang_id: cua_hang_id || kho.cua_hang_id,
            kho_id: kho._id,
            nguoi_tao_id: req.user?._id,
            nguoi_nhan: finalReceiverName,
            loai_nguoi_nhan: finalReceiverType,
            tong_so_luong: tongSoLuong,
            tong_gia_tri: tongGiaTri,
            cong_don_vao_the: false,
            trang_thai: finalStatus,
            ghi_chu: ghi_chu || ''
        });

        for (const item of normalizedItems) {
            await CTXuatNoiBo.create({
                phieu_xuat_id: phieu._id,
                hang_hoa_id: item.product._id,
                lo_hang_id: item.loHangId,
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
                        so_luong: item.soLuong,
                        nguoi_tao_id: req.user?._id,
                        loai_phieu: 'xuat_noi_bo',
                        ma_phieu: ma_xuat_noi_bo,
                        ghi_chu: ghi_chu || 'Xuat dung noi bo'
                    });
                } catch (_) {
                    return res.status(400).json({ success: false, message: 'Khong du ton kho de xuat' });
                }

                await HangHoa.findByIdAndUpdate(item.product._id, { $inc: { ton_kho: -item.soLuong } });
            }
        }

        return res.json({
            success: true,
            message: finalStatus === 'completed' ? 'Da hoan thanh phieu xuat' : 'Da luu phieu',
            ma_xuat_noi_bo
        });
    } catch (error) {
        next(error);
    }
});

router.get('/export.csv', async (req, res, next) => {
    try {
        const { filter } = buildFilter(req.query);
        const tickets = await PhieuXuatNoiBo.find(filter)
            .populate('cua_hang_id')
            .populate('kho_id')
            .sort({ created_at: -1 });

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
});

router.get('/export.xlsx', async (req, res, next) => {
    try {
        const { filter } = buildFilter(req.query);
        const { tickets, detailMap } = await loadExportTickets(filter);
        await sendXuatNoiBoWorkbook(res, 'xuat-noi-bo.xlsx', tickets, detailMap);
    } catch (error) {
        next(error);
    }
});

router.get('/:id/export.xlsx', async (req, res, next) => {
    try {
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
            return res.status(404).send('Khong tim thay phieu xuat noi bo');
        }

        const { tickets, detailMap } = await loadExportTickets({ _id: req.params.id });
        if (!tickets.length) {
            return res.status(404).send('Khong tim thay phieu xuat noi bo');
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
});

module.exports = router;
