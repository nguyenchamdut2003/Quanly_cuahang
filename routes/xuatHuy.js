const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const {
    PhieuXuatHuy,
    CTXuatHuy,
    HangHoa,
    Kho
} = require('../models/kiot.model');
const { truTonKho } = require('../services/kho.service');

router.use(isAuthenticated);

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

router.get('/', async (req, res, next) => {
    try {
        const tickets = await PhieuXuatHuy.find()
            .populate('kho_id')
            .populate('nguoi_tao_id')
            .sort({ created_at: -1 });
        res.json({ success: true, data: tickets });
    } catch (error) {
        next(error);
    }
});

router.post('/add', async (req, res, next) => {
    try {
        const { kho_id, ly_do_huy, ghi_chu, trang_thai } = req.body || {};
        const items = parseItems(req.body?.items);

        if (!kho_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho.' });
        }

        if (!ly_do_huy) {
            return res.status(400).json({ success: false, message: 'Vui long nhap ly do huy' });
        }

        const kho = await Kho.findById(kho_id);
        if (!kho) {
            return res.status(400).json({ success: false, message: 'Kho xuat huy khong hop le' });
        }

        if (!items.length) {
            return res.status(400).json({ success: false, message: 'Vui long chon hang can huy' });
        }

        const finalStatus = trang_thai === 'cancelled' ? 'cancelled' : (trang_thai === 'draft' ? 'draft' : 'completed');
        let tongSoLuong = 0;
        let tongGiaTri = 0;
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
            return res.status(400).json({ success: false, message: 'So luong xuat huy khong hop le' });
        }

        const ma_xuat_huy = 'XH' + Date.now();
        const phieu = await PhieuXuatHuy.create({
            ma_xuat_huy,
            cua_hang_id: kho.cua_hang_id,
            chi_nhanh_id: kho.chi_nhanh_id,
            kho_id: kho._id,
            nguoi_tao_id: req.user?._id,
            ly_do_huy,
            tong_so_luong: tongSoLuong,
            tong_gia_tri: tongGiaTri,
            trang_thai: finalStatus,
            ghi_chu
        });

        for (const item of normalizedItems) {
            await CTXuatHuy.create({
                phieu_xuat_huy_id: phieu._id,
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
                        loai_phieu: 'xuat_huy',
                        ma_phieu: ma_xuat_huy,
                        ghi_chu: ly_do_huy
                    });
                } catch (_) {
                    return res.status(400).json({ success: false, message: 'Khong du ton kho de xuat huy' });
                }

                await HangHoa.findByIdAndUpdate(item.product._id, { $inc: { ton_kho: -item.soLuong } });
            }
        }

        return res.json({ success: true, message: 'Da tao phieu xuat huy', ma_xuat_huy });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
