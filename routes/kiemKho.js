const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const { PhieuKiemKho, CTPhieuKiemKho, HangHoa, CuaHang } = require('../models/kiot.model');

router.use(isAuthenticated);

// Danh sách phiếu kiểm kho
router.get('/', async (req, res, next) => {
    try {
        const list = await PhieuKiemKho.find()
            .populate('cua_hang_id')
            .populate('nguoi_tao_id')
            .sort({ created_at: -1 });
        res.render('kiem-kho/index', { title: 'Kiểm kho', tickets: list });
    } catch (error) {
        next(error);
    }
});

// Trang lập phiếu kiểm kho mới
router.get('/create', async (req, res, next) => {
    try {
        const stores = await CuaHang.find();
        const products = await HangHoa.find();
        res.render('kiem-kho/create', { title: 'Kiểm kho mới', stores, products });
    } catch (error) {
        next(error);
    }
});

// Xử lý hoàn thành kiểm kho
router.post('/add', async (req, res, next) => {
    try {
        const { cua_hang_id, ghi_chu, items } = req.body;
        // items: [{ hang_hoa_id, ton_kho_he_thong, so_luong_thuc_te }]

        if (!items || items.length === 0) {
            return res.status(400).json({ success: false, message: "Chưa chọn hàng hóa kiểm kho" });
        }

        let tong_thuc_te = 0;
        let tong_lech = 0;

        const ma_kiem_kho = 'KK' + Date.now();
        const phieu = new PhieuKiemKho({
            ma_kiem_kho,
            cua_hang_id,
            nguoi_tao_id: req.user._id,
            ghi_chu,
            trang_thai: 'completed'
        });

        await phieu.save();

        for (const item of items) {
            const lech = Number(item.so_luong_thuc_te) - Number(item.ton_kho_he_thong);
            tong_thuc_te += Number(item.so_luong_thuc_te);
            tong_lech += lech;

            const ct = new CTPhieuKiemKho({
                phieu_kiem_kho_id: phieu._id,
                hang_hoa_id: item.hang_hoa_id,
                ton_kho_he_thong: item.ton_kho_he_thong,
                so_luong_thuc_te: item.so_luong_thuc_te,
                so_luong_lech: lech,
                gia_tri_lech: 0 // Có thể tính dựa trên giá vốn nếu cần
            });
            await ct.save();

            // Cập nhật tồn kho theo số lượng thực tế
            await HangHoa.findByIdAndUpdate(item.hang_hoa_id, {
                ton_kho: item.so_luong_thuc_te
            });
        }

        phieu.tong_so_luong_thuc_te = tong_thuc_te;
        phieu.tong_so_luong_lech = tong_lech;
        await phieu.save();

        res.json({ success: true, message: "Hoàn thành kiểm kho", ma_kiem_kho });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
