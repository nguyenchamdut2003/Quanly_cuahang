var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var chucDanhController = require('../controllers/chamcongcu/chucDanh.controller');

router.use(isAuthenticated);

router.get('/', chucDanhController.index);

module.exports = router;
