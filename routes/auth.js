var express = require('express');
var router = express.Router();
var passport = require('../config/passport');

router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=login_failed' }),
  function(req, res, next) {
    try {
      const user = req.user;
      if (!user) return res.redirect('/?error=user_not_found');

      if (user.vai_tro !== 'admin' || user.trang_thai !== 'active') {
        return req.logout(function() {
          res.redirect('/?error=admin_required');
        });
      }

      return res.redirect('/');
    } catch (error) {
      next(error);
    }
  }
);

router.get('/logout', function(req, res, next) {
  try {
    req.logout(function(err) {
      if (err) return next(err);
      res.redirect('/');
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
