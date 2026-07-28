var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var chamCongController = require('../controllers/chamcongcu/chamCong.controller');

router.use(isAuthenticated);

router.get('/', chamCongController.index);

module.exports = router;
