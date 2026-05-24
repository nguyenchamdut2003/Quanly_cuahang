var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var caLamViecController = require('../controllers/caLamViec.controller');

router.use(isAuthenticated);

router.get('/', caLamViecController.index);

module.exports = router;
