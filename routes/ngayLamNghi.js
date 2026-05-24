var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var ngayLamNghiController = require('../controllers/ngayLamNghi.controller');

router.use(isAuthenticated);

router.get('/', ngayLamNghiController.index);

module.exports = router;
