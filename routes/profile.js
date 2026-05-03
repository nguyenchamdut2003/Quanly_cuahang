var express = require('express');
var router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const { NguoiDung } = require('../models/kiot.model');

// Bắt buộc đăng nhập để vào trang cá nhân
router.use(isAuthenticated);

// Hiện trang hồ sơ cá nhân
router.get('/', function(req, res, next) {
    try {
        // req.user đã có sẵn từ passport
        res.render('profile/index', { title: 'Thông tin cá nhân', user: req.user });
    } catch (error) {
        next(error);
    }
});

// Xử lý cập nhật thông tin
router.post('/update', async function(req, res, next) {
    try {
        const userId = req.user._id;
        if (!userId) {
            return res.status(400).send("Không tìm thấy thông tin người dùng");
        }

        const ho_ten = req.body.ho_ten?.trim();
        const sdt = req.body.sdt?.trim();
        const dia_chi = req.body.dia_chi?.trim();

        if (!ho_ten || ho_ten === '') {
            return res.status(400).send("Họ tên không được để trống");
        }

        const user = await NguoiDung.findById(userId);
        if (!user) {
            return res.status(404).send("Người dùng không tồn tại");
        }

        user.ho_ten = ho_ten;
        user.sdt = sdt || '';
        user.dia_chi = dia_chi || '';

        await user.save();

        // Redirect về trang profile kèm theo báo thành công (nếu cần thiết có thể thêm flash message)
        res.redirect('/profile?success=1');
    } catch (error) {
        next(error);
    }
});

module.exports = router;
