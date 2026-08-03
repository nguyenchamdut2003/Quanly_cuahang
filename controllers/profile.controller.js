const { NguoiDung } = require('../models/kiot.model');
const bcrypt = require('bcrypt');
const { normalizeAddress } = require('../utils/address');

const SALT_ROUNDS = 12;

function isValidPassword(password) {
    return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(String(password || ''));
}

// Bắt buộc đăng nhập để vào trang cá nhân

// Hiện trang hồ sơ cá nhân
exports.index = async function(req, res, next) {
    try {
        // req.user đã có sẵn từ passport
        res.render('profile/index', { title: 'Thông tin cá nhân', user: req.user });
    } catch (error) {
        next(error);
    }
};

// Xử lý cập nhật thông tin
exports.postUpdate = async function(req, res, next) {
    try {
        const userId = req.user._id;
        if (!userId) {
            return res.status(400).send("Không tìm thấy thông tin người dùng");
        }

        const ho_ten = req.body.ho_ten?.trim();
        const sdt = req.body.sdt?.trim();
        const address = normalizeAddress(req.body);

        if (!ho_ten || ho_ten === '') {
            return res.status(400).send("Họ tên không được để trống");
        }

        const user = await NguoiDung.findById(userId);
        if (!user) {
            return res.status(404).send("Người dùng không tồn tại");
        }

        user.ho_ten = ho_ten;
        user.sdt = sdt || '';
        user.dia_chi_chi_tiet = address.dia_chi_chi_tiet;
        user.phuong_xa = address.phuong_xa;
        user.tinh_thanh = address.tinh_thanh;
        user.dia_chi_day_du = address.dia_chi_day_du;

        await user.save();

        // Redirect về trang profile kèm theo báo thành công (nếu cần thiết có thể thêm flash message)
        res.redirect('/profile?success=1');
    } catch (error) {
        next(error);
    }
};

exports.postChangePassword = async function(req, res, next) {
    try {
        const userId = req.user && req.user._id;
        const currentPassword = String(req.body && req.body.current_password || '');
        const password = String(req.body && req.body.password || '');
        const confirmPassword = String(req.body && req.body.confirm_password || '');

        if (!userId) return res.status(400).send('Khong tim thay thong tin nguoi dung');
        if (!password || password !== confirmPassword) {
            return res.redirect('/profile?password_error=confirm');
        }
        if (!isValidPassword(password)) {
            return res.redirect('/profile?password_error=weak');
        }

        const user = await NguoiDung.findById(userId).select('+password_hash');
        if (!user) return res.status(404).send('Nguoi dung khong ton tai');

        if (user.password_hash) {
            const matched = await bcrypt.compare(currentPassword, user.password_hash);
            if (!matched) return res.redirect('/profile?password_error=current');
        }

        user.password_hash = await bcrypt.hash(password, SALT_ROUNDS);
        user.must_change_password = false;
        await user.save();

        if (req.user) req.user.must_change_password = false;
        res.redirect('/profile?password_success=1');
    } catch (error) {
        next(error);
    }
};

exports.postSkipPasswordChange = async function(req, res, next) {
    try {
        const userId = req.user && req.user._id;
        if (!userId) return res.status(400).json({ success: false, message: 'Khong tim thay thong tin nguoi dung' });

        await NguoiDung.updateOne({ _id: userId }, { $set: { must_change_password: false } });
        if (req.user) req.user.must_change_password = false;

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
};
