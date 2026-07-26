var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var controller = require('../controllers/xuatHuy.controller');

router.get('/lo-hang/:loHangId/quy-cach-ton', isAuthenticated, controller.apiLotQuyCachTon);

module.exports = router;
