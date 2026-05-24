var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var bangLuongController = require('../controllers/bangLuong.controller');

router.use(isAuthenticated);

router.get('/:id', bangLuongController.detail);
router.get('/', bangLuongController.index);

module.exports = router;
