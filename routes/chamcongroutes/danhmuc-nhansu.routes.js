var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../../middlewares/auth.middleware');
var controller = require('../../controllers/chamcongcontroller/danhmuc-nhansu.controller');

router.use(isAuthenticated);

router.get('/phong-ban', controller.phongBanIndex);
router.post('/api/phong-ban', controller.createPhongBan);
router.put('/api/phong-ban/:id', controller.updatePhongBan);
router.patch('/api/phong-ban/:id/inactive', controller.inactivePhongBan);

router.get('/chuc-danh', controller.chucDanhIndex);
router.post('/api/chuc-danh', controller.createChucDanh);
router.put('/api/chuc-danh/:id', controller.updateChucDanh);
router.patch('/api/chuc-danh/:id/inactive', controller.inactiveChucDanh);

router.get('/phu-cap', controller.phuCapIndex);
router.post('/api/phu-cap', controller.createPhuCap);
router.put('/api/phu-cap/:id', controller.updatePhuCap);
router.patch('/api/phu-cap/:id/inactive', controller.inactivePhuCap);

module.exports = router;
