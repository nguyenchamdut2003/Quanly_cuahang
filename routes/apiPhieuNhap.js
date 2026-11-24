var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var traHangNhapController = require('../controllers/traHangNhap.controller');
var xuatHuyController = require('../controllers/xuatHuy.controller');

router.get('/', isAuthenticated, traHangNhapController.apiPurchasesByWarehouse);
router.get('/con-hang-xuat-huy', isAuthenticated, xuatHuyController.apiPurchasesWithStock);
router.get('/tong-hop/:id/chi-tiet-tra-hang', isAuthenticated, traHangNhapController.apiPurchaseGroupReturnDetail);
router.get('/:id/chi-tiet-tra-hang', isAuthenticated, traHangNhapController.apiPurchaseReturnDetail);
router.get('/:id/chi-tiet-xuat-huy', isAuthenticated, xuatHuyController.apiPurchaseDestroyDetail);

module.exports = router;
