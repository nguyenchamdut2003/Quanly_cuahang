require('dotenv').config();
const bcrypt = require('bcrypt');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { NguoiDung } = require('../models/kiot.model');

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function isUserAllowed(user) {
    return user && user.trang_thai === 'active';
}

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await NguoiDung.findById(id);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

passport.use('local', new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password'
}, async (email, password, done) => {
    try {
        const user = await NguoiDung.findOne({ email: normalizeEmail(email) }).select('+password_hash');
        const loginMessage = 'Email hoặc mật khẩu không chính xác.';

        if (!user || !user.password_hash) {
            return done(null, false, { message: loginMessage });
        }

        if (!isUserAllowed(user)) {
            return done(null, false, { message: 'Tài khoản đã bị khóa hoặc ngừng hoạt động.' });
        }

        const matched = await bcrypt.compare(String(password || ''), user.password_hash);
        if (!matched) {
            return done(null, false, { message: loginMessage });
        }

        if (user.vai_tro === 'super_admin' && String(password || '') === 'admin') {
            user.must_change_password = true;
        }
        user.lan_dang_nhap_cuoi = new Date();
        await user.save();
        return done(null, user);
    } catch (error) {
        return done(error);
    }
}));

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const email = normalizeEmail(profile.emails?.[0]?.value);
        if (!email) {
            return done(new Error('Không tìm thấy email từ Google profile'), null);
        }

        let user = await NguoiDung.findOne({ google_id: profile.id });

        if (user) {
            if (!isUserAllowed(user)) {
                return done(null, false, { message: 'Tài khoản đã bị khóa hoặc ngừng hoạt động.' });
            }
            user.lan_dang_nhap_cuoi = new Date();
            await user.save();
            return done(null, user);
        }

        user = await NguoiDung.findOne({ email });

        if (user) {
            if (!isUserAllowed(user)) {
                return done(null, false, { message: 'Tài khoản đã bị khóa hoặc ngừng hoạt động.' });
            }
            user.google_id = profile.id;
            user.anh_dai_dien = profile.photos?.[0]?.value || user.anh_dai_dien;
            user.lan_dang_nhap_cuoi = new Date();
            await user.save();
            return done(null, user);
        }

        const newUser = new NguoiDung({
            google_id: profile.id,
            email,
            ho_ten: profile.displayName || 'Người dùng',
            anh_dai_dien: profile.photos?.[0]?.value || '',
            vai_tro: 'user',
            trang_thai: 'active',
            lan_dang_nhap_cuoi: new Date()
        });

        await newUser.save();
        return done(null, newUser);
    } catch (error) {
        console.error('Lỗi xác thực Google:', error);
        return done(error, null);
    }
}));

module.exports = passport;
