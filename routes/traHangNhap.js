const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const controller = require('../controllers/traHangNhap.controller');

router.use(isAuthenticated);

router.get('/', controller.index);
router.get('/export.csv', controller.exportCsv);
router.get('/export.xlsx', controller.exportExcel);
router.get('/create', controller.createPage);
router.post('/', controller.createSubmit);
router.post('/deactivate', controller.deactivateSelected);
router.post('/trash/preview', controller.previewTrash);
router.post('/trash/move', controller.moveToTrash);
router.get('/:id/export.xlsx', controller.exportOneExcel);
router.get('/:id/in/pdf', controller.printPdf);
router.get('/:id/in', controller.print);
router.post('/:id/phieu-thu', controller.createReceipt);
router.get('/:id', controller.detail);
router.post('/:id/complete', controller.complete);
router.post('/:id/cancel', controller.cancel);

module.exports = router;
