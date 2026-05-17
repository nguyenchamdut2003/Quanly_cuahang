var express = require('express');
var mongoose = require('mongoose');
var router = express.Router();
var passport = require('../config/passport');
var { CuaHang, NguoiDung } = require('../models/kiot.model');

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

router.post('/current-store', async function(req, res, next) {
  try {
    if (typeof req.isAuthenticated !== 'function' || !req.isAuthenticated() || !req.user) {
      return res.redirect('/?error=login_required');
    }

    var storeId = String(req.body && req.body.cua_hang_id || '').trim();
    if (!isObjectId(storeId)) {
      return res.status(400).redirect('/?error=invalid_store');
    }

    var store = await CuaHang.findOne({ _id: storeId, trang_thai: 'active' }).lean();
    if (!store) {
      return res.status(400).redirect('/?error=invalid_store');
    }

    await NguoiDung.findByIdAndUpdate(req.user._id, { cua_hang_id: storeId }, { new: false });

    if (req.session) req.session.cua_hang_id = storeId;
    req.user.cua_hang_id = storeId;

    var back = String((req.body && req.body.returnTo) || req.get('referer') || '/');
    if (!back.startsWith('/')) back = '/';
    res.redirect(back);
  } catch (error) {
    next(error);
  }
});

router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=login_failed' }),
  function(req, res, next) {
    try {
      const user = req.user;
      if (!user) return res.redirect('/?error=user_not_found');

      return res.redirect('/');
    } catch (error) {
      next(error);
    }
  }
);

router.get('/logout', function(req, res, next) {
  try {
    if (req.session) delete req.session.cua_hang_id;
    req.logout(function(err) {
      if (err) return next(err);
      res.redirect('/');
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
