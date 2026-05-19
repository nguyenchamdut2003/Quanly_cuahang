var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var phongBanController = require('../controllers/phongBan.controller');

router.use(isAuthenticated);

router.get('/', phongBanController.index);

module.exports = router;
