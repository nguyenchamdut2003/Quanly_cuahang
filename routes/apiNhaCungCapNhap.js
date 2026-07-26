var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var controller = require('../controllers/nhapHang.controller');

router.get('/:id/hang-hoa', isAuthenticated, controller.apiSupplierProducts);

module.exports = router;
