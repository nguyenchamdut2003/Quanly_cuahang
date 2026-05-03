const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const {
    PhieuXuatNoiBo,
    CTXuatNoiBo,
    HangHoa,
    CuaHang,
    NguoiDung
} = require('../models/kiot.model');

router.use(isAuthenticated);

const STATUS_MAP = {
    draft: 'Phiếu tạm',
    completed: 'Hoàn thành',
    cancelled: 'Đã hủy'
};

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

router.get('/', async (req, res, next) => {
    try {
        const { filter, statuses } = buildFilter(req.query);
        const tickets = await PhieuXuatNoiBo.find(filter)
            .populate('cua_hang_id')
            .populate('nguoi_tao_id')
            .sort({ created_at: -1 });
        const users = await NguoiDung.find().sort({ ho_ten: 1 });

        res.render('xuat-dung-noi-bo/index', {
            title: 'Xuất dùng nội bộ',
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
        const products = await HangHoa.find().sort({ ten_hang: 1 });
        const stores = await CuaHang.find().sort({ ten_cua_hang: 1 });
        const users = await NguoiDung.find().sort({ ho_ten: 1 });
        res.render('xuat-dung-noi-bo/create', {
            title: 'Xuất dùng nội bộ',
            products,
            stores,
            users
        });
    } catch (error) {
        next(error);
    }
});

router.post('/add', async (req, res, next) => {
    try {
        const { cua_hang_id, loai_xuat, nguoi_nhan, ghi_chu, trang_thai, items } = req.body;
        if (!items || !Array.isArray(items) || !items.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất 1 hàng hóa' });
        }

        const finalStatus = trang_thai === 'completed' ? 'completed' : 'draft';
        let tongGiaTri = 0;
        const normalizedItems = [];

        for (const item of items) {
            const product = await HangHoa.findById(item.hang_hoa_id);
            if (!product) continue;

            const soLuong = Number(item.so_luong) || 0;
            if (soLuong <= 0) continue;
            if (finalStatus === 'completed' && product.ton_kho < soLuong) {
                return res.status(400).json({
                    success: false,
                    message: `${product.ten_hang} không đủ tồn kho để xuất`
                });
            }

            const giaVon = Number(product.gia_von) || 0;
            const thanhTien = soLuong * giaVon;
            tongGiaTri += thanhTien;
            normalizedItems.push({ product, soLuong, giaVon, thanhTien });
        }

        if (!normalizedItems.length) {
            return res.status(400).json({ success: false, message: 'Số lượng xuất không hợp lệ' });
        }

        const ma_xuat_noi_bo = 'XNB' + Date.now();
        const phieu = await PhieuXuatNoiBo.create({
            ma_xuat_noi_bo,
            loai_xuat: loai_xuat || 'Xuất dùng nội bộ',
            cua_hang_id: cua_hang_id || null,
            nguoi_tao_id: req.user._id,
            nguoi_nhan: nguoi_nhan || '',
            tong_gia_tri: tongGiaTri,
            trang_thai: finalStatus,
            ghi_chu: ghi_chu || ''
        });

        for (const item of normalizedItems) {
            await CTXuatNoiBo.create({
                phieu_xuat_id: phieu._id,
                hang_hoa_id: item.product._id,
                so_luong: item.soLuong,
                gia_von: item.giaVon,
                thanh_tien: item.thanhTien
            });

            if (finalStatus === 'completed') {
                await HangHoa.findByIdAndUpdate(item.product._id, { $inc: { ton_kho: -item.soLuong } });
            }
        }

        res.json({ success: true, message: finalStatus === 'completed' ? 'Đã hoàn thành phiếu xuất' : 'Đã lưu phiếu tạm', ma_xuat_noi_bo });
    } catch (error) {
        next(error);
    }
});

router.get('/export.csv', async (req, res, next) => {
    try {
        const { filter } = buildFilter(req.query);
        const tickets = await PhieuXuatNoiBo.find(filter)
            .populate('cua_hang_id')
            .sort({ created_at: -1 });

        const rows = [['Mã xuất dùng nội bộ', 'Loại xuất', 'Tổng giá trị', 'Thời gian', 'Chi nhánh', 'Ghi chú', 'Trạng thái']];
        tickets.forEach(t => {
            rows.push([
                t.ma_xuat_noi_bo,
                t.loai_xuat || '',
                t.tong_gia_tri || 0,
                t.ngay_xuat ? t.ngay_xuat.toLocaleString('vi-VN') : '',
                t.cua_hang_id ? t.cua_hang_id.ten_cua_hang : '',
                t.ghi_chu || '',
                STATUS_MAP[t.trang_thai] || t.trang_thai
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

module.exports = router;
