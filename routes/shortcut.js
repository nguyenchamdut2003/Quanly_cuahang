var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var controller = require('../controllers/shortcut.controller');

router.get('/hoa-don/:id', isAuthenticated, controller.redirectInvoice);
router.get('/lo-hang/:id', isAuthenticated, controller.redirectLot);

module.exports = router;
