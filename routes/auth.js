var express = require('express');
var router = express.Router();
var passport = require('../config/passport');
var authController = require('../controllers/auth.controller');

router.post('/current-store', authController.postCurrentStore);
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);
router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/?error=login_failed' }), authController.getGoogleCallback);
router.get('/logout', authController.getLogout);

module.exports = router;
