var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var controller = require('../controllers/phieuNhapTongHop.controller');

router.use(isAuthenticated);
router.get('/tong-hop/eligible', controller.eligible);
router.post('/tong-hop/preview', controller.preview);
router.post('/tong-hop', controller.create);
router.post('/gop-phieu-nhap', controller.create);

module.exports = router;
