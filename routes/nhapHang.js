var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var nhapHangController = require('../controllers/nhapHang.controller');

router.use(isAuthenticated);

router.get('/', nhapHangController.index);
router.get('/create', nhapHangController.createPage);
router.post('/create', nhapHangController.createSubmit);

router.get('/tra-hang-nhap', nhapHangController.traHangNhapPage);
router.post('/tra-hang-nhap/add', nhapHangController.traHangNhapSubmit);

module.exports = router;
