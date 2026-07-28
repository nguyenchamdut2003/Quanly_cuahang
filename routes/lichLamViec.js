var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var lichLamViecController = require('../controllers/chamcongcu/lichLamViec.controller');

router.use(isAuthenticated);

router.get('/', lichLamViecController.index);

module.exports = router;
