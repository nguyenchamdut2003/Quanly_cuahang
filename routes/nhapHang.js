var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var nhapHangController = require('../controllers/nhapHang.controller');
var groupController = require('../controllers/phieuNhapTongHop.controller');
var phanLoaiHangController = require('../controllers/phanLoaiHang.controller');

router.use(isAuthenticated);
router.get('/:purchaseId/items/:lineId/phan-loai/context', function(req, res) {
  req.query.nguon_thao_tac = 'phieu_nhap';
  return phanLoaiHangController.context(req, res);
});

router.get('/', nhapHangController.index);
router.get('/create', nhapHangController.createPage);
router.get('/api/nha-cung-cap/:id/hang-hoa', nhapHangController.apiSupplierProducts);
router.get('/api/nha-cung-cap/:id/dia-chi', nhapHangController.apiSupplierAddresses);
router.post('/create', nhapHangController.createSubmit);
router.post('/deactivate', nhapHangController.deactivateSelected);
router.post('/trash/preview', nhapHangController.previewTrash);
router.post('/trash/move', nhapHangController.moveToTrash);
router.get('/tong-hop/eligible', groupController.eligible);
router.post('/tong-hop/preview', groupController.preview);
router.get('/tong-hop', groupController.list);
router.post('/tong-hop', groupController.create);
router.get('/tong-hop/:id/return', groupController.returnToSource);
router.post('/tong-hop/:id/return', groupController.createReturn);
router.post('/tong-hop/:id/pay', groupController.pay);
router.post('/tong-hop/:id/cancel', groupController.cancel);
router.get('/tong-hop/:id', groupController.detail);
router.post('/gop-phieu-nhap', groupController.create);
router.get('/tra-hang-nhap', nhapHangController.traHangNhapPage);
router.post('/tra-hang-nhap/add', nhapHangController.traHangNhapSubmit);
router.get('/:id/in-tong-hop', nhapHangController.printPurchaseBundle);
router.get('/:id/in', nhapHangController.printPurchase);
router.get('/:id/in/pdf', nhapHangController.printPhieuNhapPdf);
router.get('/:id/bang-ke-02-tndn', nhapHangController.printBangKe02Tndn);
router.get('/:id/bang-ke-02-tndn/pdf', nhapHangController.printBangKe02TndnPdf);
router.get('/:id/hd-mua-ban-nguyen-tac', nhapHangController.printContract);
router.get('/:id/hd-mua-ban-nguyen-tac/pdf', nhapHangController.printHdMuaBanNguyenTacPdf);
router.get('/:id/detail', nhapHangController.detail);
router.get('/:id', nhapHangController.redirectDetail);
router.get('/:id/export.csv', nhapHangController.exportOneCsv);
router.get('/:id/export.xlsx', nhapHangController.exportOneExcel);
router.post('/:id/cancel', nhapHangController.cancel);
router.post('/:id/complete', nhapHangController.complete);
router.post('/:id/copy', nhapHangController.copy);
router.post('/:id/pay-supplier', nhapHangController.paySupplier);
router.post('/:id/save', nhapHangController.save);


module.exports = router;
