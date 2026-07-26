var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var controller = require('../controllers/system.controller');

router.post('/reset-data', isAuthenticated, controller.resetData);

module.exports = router;
