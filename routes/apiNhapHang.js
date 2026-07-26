var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var controller = require('../controllers/nhapHang.controller');

router.post('/gop-phieu-nhap', isAuthenticated, controller.mergePurchases);

module.exports = router;
