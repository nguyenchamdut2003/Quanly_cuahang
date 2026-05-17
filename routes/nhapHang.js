var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var nhapHangController = require('../controllers/nhapHang.controller');

router.use(isAuthenticated);

router.get('/', nhapHangController.index);
router.get('/create', nhapHangController.createPage);
router.get('/api/nha-cung-cap/:id/hang-hoa', nhapHangController.apiSupplierProducts);
router.post('/create', nhapHangController.createSubmit);
router.get('/:id/in-tong-hop', nhapHangController.printPurchaseBundle);
router.get('/:id/in', nhapHangController.printPurchase);
router.get('/:id/in/pdf', nhapHangController.printPhieuNhapPdf);
router.get('/:id/bang-ke-02-tndn', nhapHangController.printBangKe02Tndn);
router.get('/:id/bang-ke-02-tndn/pdf', nhapHangController.printBangKe02TndnPdf);
router.get('/:id/hd-mua-ban-nguyen-tac', nhapHangController.printContract);
router.get('/:id/hd-mua-ban-nguyen-tac/pdf', nhapHangController.printHdMuaBanNguyenTacPdf);
router.get('/:id/detail', nhapHangController.detail);
router.get('/:id', function(req, res) {
  res.redirect('/nhap-hang?purchase=' + encodeURIComponent(req.params.id));
});
router.get('/:id/export.csv', nhapHangController.exportOneCsv);
router.get('/:id/export.xlsx', nhapHangController.exportOneExcel);
router.post('/:id/cancel', nhapHangController.cancel);
router.post('/:id/copy', nhapHangController.copy);
router.post('/:id/pay-supplier', nhapHangController.paySupplier);
router.post('/:id/save', nhapHangController.save);

router.get('/tra-hang-nhap', nhapHangController.traHangNhapPage);
router.post('/tra-hang-nhap/add', nhapHangController.traHangNhapSubmit);

module.exports = router;
