var express = require('express');
var router = express.Router();
var controller = require('../controllers/health.controller');

router.get('/', controller.status);

module.exports = router;
