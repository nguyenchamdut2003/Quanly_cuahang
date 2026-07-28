var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var lichLamViecController = require('../controllers/chamcongcu/lichLamViec.controller');

router.use(isAuthenticated);

router.get('/lookup-options', lichLamViecController.apiLookupOptions);
router.get('/loai-ngay', lichLamViecController.apiPreviewLoaiNgay);
router.get('/', lichLamViecController.apiList);
router.post('/', lichLamViecController.apiCreate);
router.put('/:id', lichLamViecController.apiUpdate);
router.delete('/:id', lichLamViecController.apiDelete);

module.exports = router;
