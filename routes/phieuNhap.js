var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var phieuNhapController = require('../controllers/phieuNhap.controller');

router.use(isAuthenticated);
router.get('/', phieuNhapController.index);
router.get('/export.csv', phieuNhapController.getExportCsv);
router.get('/hoa-don-dau-vao', phieuNhapController.getHoaDonDauVao);
router.post('/hoa-don-dau-vao/add', phieuNhapController.postHoaDonDauVaoAdd);
router.get('/tra-hang-nhap', phieuNhapController.getTraHangNhap);
router.post('/tra-hang-nhap/add', phieuNhapController.postTraHangNhapAdd);
router.get('/create', phieuNhapController.getCreate);
router.get('/:id/detail', phieuNhapController.getIdDetail);
router.post('/:id/complete', phieuNhapController.postIdComplete);
router.post('/:id/cancel', phieuNhapController.postIdCancel);
router.post('/add', phieuNhapController.postAdd);
router.post('/add-old', phieuNhapController.postAddOld);

module.exports = router;
