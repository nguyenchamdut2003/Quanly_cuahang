const { NguoiDung } = require('../models/kiot.model');
const bcrypt = require('bcrypt');
const { normalizeAddress } = require('../utils/address');

const SALT_ROUNDS = 12;
const PROFILE_FIELDS = 'email ho_ten sdt dia_chi_chi_tiet phuong_xa tinh_thanh dia_chi_day_du vai_tro trang_thai';

function profileDto(user) {
    const data = {};
    for (const key of PROFILE_FIELDS.split(' ')) data[key] = String(user && user[key] || '');
    return data;
}

function wantsJson(req) {
    const accept = typeof req.get === 'function' ? req.get('accept') : req.headers && req.headers.accept;
    return Boolean(req.xhr || String(accept || '').includes('application/json'));
}

function ownUserId(req) {
    const id = String(req.user && req.user._id || '').trim();
    if (!/^[a-f\d]{24}$/i.test(id)) throw profileError(401, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    return id;
}

function profileError(statusCode, message) {
    return Object.assign(new Error(message), { statusCode });
}

function canEdit(user) { return Boolean(user && user.vai_tro === 'super_admin' && user.trang_thai === 'active'); }

function assertActive(user) {
    if (!user) throw profileError(404, 'Không tìm thấy thông tin người dùng.');
    if (user.trang_thai !== 'active') throw profileError(403, 'Tài khoản đã bị khóa hoặc ngừng hoạt động.');
}

function profileFailure(req, res, next, error, user) {
    const status = error.statusCode || (error.code === 11000 ? 409 : 0);
    if (!status) return next(error);
    const message = error.code === 11000 ? 'Tài khoản đăng nhập đã được sử dụng.' : error.message;
    if (wantsJson(req)) return res.status(status).json({ success: false, message });
    if (!user) return res.status(status).send(message);
    return res.status(status).render('profile/index', { user: profileDto(user), canEdit: canEdit(user), profileError: message, profileSuccess: '' });
}

function readText(body, user, key, limit, label, required = false) {
    const value = Object.prototype.hasOwnProperty.call(body, key) ? body[key] : user[key];
    if (value != null && typeof value !== 'string') throw profileError(400, label + ' không hợp lệ.');
    const text = String(value || '').trim();
    if ((required && !text) || text.length > limit || /[\u0000-\u001f\u007f]/.test(text)) {
        throw profileError(400, label + (required && !text ? ' không được để trống.' : ' không hợp lệ hoặc quá dài.'));
    }
    return text;
}

function normalizeLogin(value) {
    const login = String(value || '').trim().toLowerCase();
    const username = /^[a-z0-9._-]{3,100}$/.test(login);
    const email = login.length <= 254 && /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(login)
        && !/\s|\.\./.test(login) && !login.startsWith('.') && !login.split('@')[0].endsWith('.')
        && login.split('@')[0].length <= 64;
    if (!username && !email) throw profileError(400, 'Tài khoản phải là tên đăng nhập từ 3–100 ký tự (chữ, số, dấu chấm, gạch dưới, gạch ngang) hoặc email hợp lệ.');
    return login;
}

function isValidPassword(password) {
    return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(String(password || ''));
}

// Bắt buộc đăng nhập để vào trang cá nhân

// Hiện trang hồ sơ cá nhân
exports.index = async function(req, res, next) {
    try {
        const user = await NguoiDung.findById(ownUserId(req)).select(PROFILE_FIELDS);
        assertActive(user);
        res.render('profile/index', { user: profileDto(user), canEdit: canEdit(user), profileError: '',
            profileSuccess: req.query && req.query.success === '1' ? 'Cập nhật thông tin thành công!' : '' });
    } catch (error) {
        profileFailure(req, res, next, error);
    }
};

exports.api = async function(req, res, next) {
    try {
        const user = await NguoiDung.findById(ownUserId(req)).select(PROFILE_FIELDS);
        assertActive(user);
        return res.json({ success: true, data: profileDto(user), canEdit: canEdit(user) });
    } catch (error) {
        profileFailure(req, res, next, error);
    }
};

// Xử lý cập nhật thông tin
exports.postUpdate = async function(req, res, next) {
    let user;
    let submitted;
    try {
        const userId = ownUserId(req);
        user = await NguoiDung.findById(userId).select(PROFILE_FIELDS + ' +password_hash');
        assertActive(user);
        if (!canEdit(user)) throw profileError(403, 'Chỉ quản trị viên cao nhất mới được sửa thông tin tài khoản.');
        const body = req.body || {};
        submitted = { ...profileDto(user) };
        for (const [key, limit] of Object.entries({ ho_ten: 150, sdt: 30, dia_chi_chi_tiet: 500,
            phuong_xa: 150, tinh_thanh: 150, email: 254 })) {
            if (typeof body[key] === 'string') submitted[key] = body[key].trim().slice(0, limit);
        }
        const changes = {
            ho_ten: readText(body, user, 'ho_ten', 150, 'Họ tên', true),
            sdt: readText(body, user, 'sdt', 30, 'Số điện thoại'),
            dia_chi_chi_tiet: readText(body, user, 'dia_chi_chi_tiet', 500, 'Địa chỉ chi tiết'),
            phuong_xa: readText(body, user, 'phuong_xa', 150, 'Phường/Xã'),
            tinh_thanh: readText(body, user, 'tinh_thanh', 150, 'Tỉnh/Thành phố')
        };
        const login = normalizeLogin(readText(body, user, 'email', 254, 'Tài khoản đăng nhập', true));
        changes.dia_chi_day_du = normalizeAddress(changes).dia_chi_day_du;
        changes.email = login;
        submitted = { ...submitted, ...changes };
        const currentLogin = String(user.email || '').trim().toLowerCase();
        const loginChanged = login !== currentLogin;
        if (loginChanged) {
            if (!user.password_hash) throw profileError(400, 'Vui lòng thiết lập mật khẩu trước khi đổi tài khoản đăng nhập.');
            const password = typeof body.current_password === 'string' ? body.current_password : '';
            if (!password || !await bcrypt.compare(password, user.password_hash)) {
                throw profileError(400, 'Mật khẩu hiện tại không đúng.');
            }
            const duplicate = await NguoiDung.findOne({ email: login, _id: { $ne: userId } }).select('_id').lean();
            if (duplicate) throw profileError(409, 'Tài khoản đăng nhập đã được sử dụng.');
        }
        // Recheck role, active status and login while writing. A request that
        // raced with a role or credential change cannot overwrite those changes.
        const filter = { _id: userId, vai_tro: 'super_admin', trang_thai: 'active', email: user.email };
        if (loginChanged) filter.password_hash = user.password_hash;
        const updated = await NguoiDung.findOneAndUpdate(filter, { $set: changes }, { new: true, runValidators: true })
            .select(PROFILE_FIELDS);
        if (!updated) throw profileError(409, 'Thông tin hoặc quyền tài khoản vừa thay đổi. Vui lòng tải lại và thử lại.');
        if (req.user) Object.assign(req.user, changes);
        if (wantsJson(req)) return res.json({ success: true, message: 'Đã cập nhật thông tin cá nhân.', data: profileDto(updated), canEdit: true });
        return res.redirect('/profile?success=1');
    } catch (error) {
        // Submitted values are safe DTO fields only; passwords are never echoed.
        return profileFailure(req, res, next, error, user && { ...profileDto(user), ...submitted });
    }
};

exports.postChangePassword = async function(req, res, next) {
    try {
        const userId = req.user && req.user._id;
        const currentPassword = String(req.body && req.body.current_password || '');
        const password = String(req.body && req.body.password || '');
        const confirmPassword = String(req.body && req.body.confirm_password || '');

        if (!userId) return res.status(400).send('Không tìm thấy thông tin người dùng');
        if (!password || password !== confirmPassword) {
            return res.redirect('/profile?password_error=confirm');
        }
        if (!isValidPassword(password)) {
            return res.redirect('/profile?password_error=weak');
        }

        const user = await NguoiDung.findById(userId).select('+password_hash');
        if (!user) return res.status(404).send('Người dùng không tồn tại');

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
        if (!userId) return res.status(400).json({ success: false, message: 'Không tìm thấy thông tin người dùng' });

        await NguoiDung.updateOne({ _id: userId }, { $set: { must_change_password: false } });
        if (req.user) req.user.must_change_password = false;

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
};
