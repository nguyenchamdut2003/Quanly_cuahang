var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var controller = require('../controllers/chamcongcu/thietLapNhanVien.controller');

router.use(isAuthenticated);

router.get('/', controller.index);

module.exports = router;
