const express = require('express');
const router = express.Router();
const { isAuthenticated, checkRole } = require('../middlewares/auth.middleware');
const { CuaHang } = require('../models/kiot.model');

// Chỉ Admin và Quản lý mới được vào quản lý cửa hàng (Tạm thời cho cả nhân viên để test)
router.use(isAuthenticated, checkRole(['admin']));

// Lấy danh sách cửa hàng
router.get('/', async (req, res, next) => {
    try {
        const list = await CuaHang.find().sort({ created_at: -1 });
        res.render('cua-hang/index', { title: 'Quản lý cửa hàng', stores: list });
    } catch (error) {
        next(error);
    }
});

// Thêm cửa hàng mới
router.post('/add', async (req, res, next) => {
    try {
        const { ma_cua_hang, ten_cua_hang, sdt, email, dia_chi_gui_hang, tinh_thanh, quan_huyen, phuong_xa } = req.body;

        if (!ma_cua_hang || ma_cua_hang.trim() === '') {
            return res.status(400).json({ success: false, message: "Mã cửa hàng không được để trống" });
        }

        // Check trùng mã
        const exist = await CuaHang.findOne({ ma_cua_hang: ma_cua_hang.trim() });
        if (exist) {
            return res.status(400).json({ success: false, message: "Mã cửa hàng đã tồn tại" });
        }

        const newStore = new CuaHang({
            ma_cua_hang: ma_cua_hang.trim(),
            ten_cua_hang: ten_cua_hang?.trim(),
            sdt: sdt?.trim(),
            email: email?.trim(),
            dia_chi_gui_hang: dia_chi_gui_hang?.trim(),
            tinh_thanh: tinh_thanh?.trim(),
            quan_huyen: quan_huyen?.trim(),
            phuong_xa: phuong_xa?.trim(),
            trang_thai: 'active'
        });

        await newStore.save();
        res.json({ success: true, message: "Thêm cửa hàng thành công" });
    } catch (error) {
        next(error);
    }
});

// Cập nhật cửa hàng
router.post('/edit/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { ten_cua_hang, sdt, email, dia_chi_gui_hang, tinh_thanh, quan_huyen, phuong_xa, trang_thai } = req.body;

        const store = await CuaHang.findById(id);
        if (!store) {
            return res.status(404).json({ success: false, message: "Không tìm thấy cửa hàng" });
        }

        store.ten_cua_hang = ten_cua_hang?.trim() || store.ten_cua_hang;
        store.sdt = sdt?.trim() || store.sdt;
        store.email = email?.trim() || store.email;
        store.dia_chi_gui_hang = dia_chi_gui_hang?.trim() || store.dia_chi_gui_hang;
        store.tinh_thanh = tinh_thanh?.trim() || store.tinh_thanh;
        store.quan_huyen = quan_huyen?.trim() || store.quan_huyen;
        store.phuong_xa = phuong_xa?.trim() || store.phuong_xa;
        store.trang_thai = trang_thai || store.trang_thai;

        await store.save();
        res.json({ success: true, message: "Cập nhật thành công" });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
