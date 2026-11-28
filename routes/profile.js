var express = require('express');
var router = express.Router();
var { isLoggedInActive, isSuperAdmin } = require('../middlewares/auth.middleware');
var profileController = require('../controllers/profile.controller');

router.use(isLoggedInActive);
router.get('/', profileController.index);
router.get('/api', profileController.api);
router.post('/update', isSuperAdmin, profileController.postUpdate);
router.post('/change-password', profileController.postChangePassword);
router.post('/skip-password-change', profileController.postSkipPasswordChange);

module.exports = router;
