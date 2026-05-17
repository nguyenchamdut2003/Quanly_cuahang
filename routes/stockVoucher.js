const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const controller = require('../controllers/stockVoucher.controller');

router.use(isAuthenticated);

router.get('/:type/:id/pdf', controller.pdf);
router.get('/:type/:id', controller.print);

module.exports = router;
