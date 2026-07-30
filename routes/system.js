var express = require('express');
var router = express.Router();
var { isAuthenticated, isSuperAdmin } = require('../middlewares/auth.middleware');
var controller = require('../controllers/system.controller');

router.post('/reset-data', isAuthenticated, isSuperAdmin, controller.resetData);

module.exports = router;
