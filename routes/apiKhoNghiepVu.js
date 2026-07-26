var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var traHangNhapController = require('../controllers/traHangNhap.controller');
var xuatHuyController = require('../controllers/xuatHuy.controller');

router.get('/:khoId/phieu-nhap', isAuthenticated, traHangNhapController.apiPurchasesByWarehouse);
router.get('/:khoId/hang-xuat-huy', isAuthenticated, xuatHuyController.apiWarehouseProducts);

module.exports = router;
