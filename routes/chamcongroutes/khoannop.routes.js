var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../../middlewares/auth.middleware');
var controller = require('../../controllers/chamcongcontroller/khoannop.controller');

router.use(isAuthenticated);

router.get('/danh-muc', controller.getDanhMucKhoanNop);
router.post('/danh-muc', controller.createDanhMucKhoanNop);
router.put('/danh-muc/:id', controller.updateDanhMucKhoanNop);
router.patch('/danh-muc/:id/trang-thai', controller.updateTrangThaiDanhMuc);
router.post('/noi-nop', controller.createNoiNop);

module.exports = router;
