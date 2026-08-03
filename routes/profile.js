var express = require('express');
var router = express.Router();
var { isLoggedInActive } = require('../middlewares/auth.middleware');
var profileController = require('../controllers/profile.controller');

router.use(isLoggedInActive);
router.get('/', profileController.index);
router.post('/update', profileController.postUpdate);
router.post('/change-password', profileController.postChangePassword);
router.post('/skip-password-change', profileController.postSkipPasswordChange);

module.exports = router;
