const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const controller = require('../controllers/xuatHuy.controller');

router.use(isAuthenticated);

router.get('/', controller.index);
router.get('/export.xlsx', controller.exportExcel);
router.get('/create', controller.createPage);
router.post('/', controller.createSubmit);
router.get('/:id/export.xlsx', controller.exportOneExcel);
router.get('/:id', controller.detail);
router.post('/:id/complete', controller.complete);
router.post('/:id/cancel', controller.cancel);

module.exports = router;
