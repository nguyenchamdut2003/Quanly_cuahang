var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var banHangController = require('../controllers/dathangcontroller/banHang.controller');

router.use(isAuthenticated);
router.get('/', banHangController.index);
router.post('/add', banHangController.postAdd);
router.post('/draft', banHangController.postDraft);
router.delete('/draft/:id', banHangController.deleteDraftId);

module.exports = router;
