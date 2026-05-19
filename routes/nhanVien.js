var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var nhanVienController = require('../controllers/nhanVien.controller');
var phongBanController = require('../controllers/phongBan.controller');
var chucDanhController = require('../controllers/chucDanh.controller');

router.use(isAuthenticated);

router.get('/', nhanVienController.index);
router.get('/chuc-danh', nhanVienController.chucDanhPlaceholder);

router.post('/groups/phong-ban/add', phongBanController.ajaxAdd);
router.post('/groups/phong-ban/:id/update', phongBanController.ajaxUpdate);
router.post('/groups/phong-ban/:id/delete', phongBanController.ajaxDelete);
router.post('/groups/chuc-danh/add', chucDanhController.ajaxAdd);
router.post('/groups/chuc-danh/:id/update', chucDanhController.ajaxUpdate);
router.post('/groups/chuc-danh/:id/delete', chucDanhController.ajaxDelete);

module.exports = router;
