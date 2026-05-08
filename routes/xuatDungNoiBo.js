const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const {
    PhieuXuatNoiBo,
    CTXuatNoiBo,
    HangHoa,
    CuaHang,
    NguoiDung,
    Kho
} = require('../models/kiot.model');
const { truTonKho } = require('../services/kho.service');

router.use(isAuthenticated);

const STATUS_MAP = {
    draft: 'Phieu tam',
    completed: 'Hoan thanh',
    cancelled: 'Da huy'
};

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
        const [products, stores, users, warehouses] = await Promise.all([
            HangHoa.find().sort({ ten_hang: 1 }),
            CuaHang.find().sort({ ten_cua_hang: 1 }),
            NguoiDung.find().sort({ ho_ten: 1 }),
            Kho.find({ trang_thai: 'active' }).sort({ ten_kho: 1 })
        ]);
        res.render('xuat-dung-noi-bo/create', {
            title: 'Xuat dung noi bo',
            products,
            stores,
            users,
            warehouses
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
            nguoi_nhan: nguoi_nhan || '',
            loai_nguoi_nhan: ['nhan_vien', 'khach_hang', 'nha_cung_cap', 'khac'].includes(loai_nguoi_nhan) ? loai_nguoi_nhan : 'khac',
            tong_so_luong: tongSoLuong,
            tong_gia_tri: tongGiaTri,
            cong_don_vao_the: cong_don_vao_the === true || cong_don_vao_the === 'true',
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

module.exports = router;
