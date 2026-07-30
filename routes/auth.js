var express = require('express');
var router = express.Router();
var passport = require('../config/passport');
var authController = require('../controllers/auth.controller');
var passwordResetController = require('../controllers/passwordReset.controller');
var { isGuest, isLoggedInActive } = require('../middlewares/auth.middleware');

router.get('/login', isGuest, authController.getLogin);
router.post('/login', isGuest, authController.postLogin);
router.get('/register', isGuest, authController.getRegister);
router.post('/register', isGuest, authController.postRegister);
router.get('/forgot-password', isGuest, passwordResetController.getForgotPassword);
router.post('/forgot-password', isGuest, passwordResetController.postForgotPassword);
router.get('/verify-reset-code', isGuest, passwordResetController.getVerifyResetCode);
router.post('/verify-reset-code', isGuest, passwordResetController.postVerifyResetCode);
router.post('/resend-reset-code', isGuest, passwordResetController.postResendResetCode);
router.get('/reset-password', isGuest, passwordResetController.getResetPassword);
router.post('/reset-password', isGuest, passwordResetController.postResetPassword);
router.post('/logout', authController.postLogout);
router.get('/cho-phan-quyen', isLoggedInActive, authController.getPendingPermission);

router.post('/auth/current-store', authController.postCurrentStore);
router.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);
router.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=login_failed' }),
  authController.getGoogleCallback
);
router.post('/auth/logout', authController.postLogout);
router.get('/auth/logout', authController.getLogout);

module.exports = router;
