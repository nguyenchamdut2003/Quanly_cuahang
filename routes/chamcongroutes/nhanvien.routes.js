var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../../middlewares/auth.middleware');
var controller = require('../../controllers/chamcongcontroller/nhanvien.controller');

router.use(isAuthenticated);

router.get('/', controller.listNhanVien);
router.post('/', controller.createNhanVien);
router.get('/:id', controller.getNhanVien);
router.get('/:id/detail', controller.detailNhanVienPanel);
router.get('/:id/ngay-cong', controller.listNgayCongNhanVien);
router.get('/:id/tam-ung', controller.listTamUngNhanVien);
router.post('/:id/tam-ung', controller.createTamUngNhanVien);
router.put('/:id', controller.updateNhanVien);
router.patch('/:id/trang-thai', controller.updateTrangThaiNhanVien);

module.exports = router;
