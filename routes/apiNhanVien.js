var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var nhanVienController = require('../controllers/nhanVien.controller');

router.use(isAuthenticated);

router.get('/', nhanVienController.apiList);
router.get('/:id', nhanVienController.apiGet);
router.post('/', nhanVienController.apiCreate);
router.put('/:id', nhanVienController.apiUpdate);
router.delete('/:id', nhanVienController.apiDelete);

module.exports = router;
