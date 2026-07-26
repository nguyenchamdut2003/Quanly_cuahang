var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var controller = require('../controllers/nhapHang.controller');

router.get('/:id/in', isAuthenticated, controller.printPurchase);
router.get('/:id/in/pdf', isAuthenticated, controller.printPhieuNhapPdf);
router.get('/:id/in-tong-hop', isAuthenticated, controller.printPurchaseBundle);
router.get('/:id/bang-ke-02-tndn', isAuthenticated, controller.printBangKe02Tndn);
router.get('/:id/bang-ke-02-tndn/pdf', isAuthenticated, controller.printBangKe02TndnPdf);
router.get('/:id/hd-mua-ban-nguyen-tac', isAuthenticated, controller.printContract);
router.get('/:id/hd-mua-ban-nguyen-tac/pdf', isAuthenticated, controller.printHdMuaBanNguyenTacPdf);

module.exports = router;
