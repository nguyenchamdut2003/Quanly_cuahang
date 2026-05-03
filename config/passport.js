require('dotenv').config();
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { NguoiDung } = require('../models/kiot.model');

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

function normalizeNonAdmin(user) {
    if (user.vai_tro !== 'admin') {
        user.vai_tro = 'user';
    }
}

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const email = profile.emails?.[0]?.value;
        if (!email) {
            return done(new Error('Không tìm thấy email từ Google profile'), null);
        }

        let user = await NguoiDung.findOne({ google_id: profile.id });

        if (user) {
            normalizeNonAdmin(user);
            user.lan_dang_nhap_cuoi = new Date();
            await user.save();
            return done(null, user);
        }

        user = await NguoiDung.findOne({ email });

        if (user) {
            user.google_id = profile.id;
            user.anh_dai_dien = profile.photos?.[0]?.value || user.anh_dai_dien;
            normalizeNonAdmin(user);
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
            trang_thai: 'inactive',
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
