var express = require('express');
var router = express.Router();
var indexController = require('../controllers/index.controller');

router.get('/', indexController.index);

module.exports = router;
