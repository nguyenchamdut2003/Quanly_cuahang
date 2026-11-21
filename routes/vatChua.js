var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var vatChuaController = require('../controllers/vatChua.controller');

router.use(isAuthenticated);

router.get('/', vatChuaController.index);
router.get('/api/document/:kind/:id', vatChuaController.apiDocumentDetail);
router.get('/nhap/:id/edit', vatChuaController.apiImportEditDetail);
router.post('/nhap/:id/edit', vatChuaController.apiImportUpdate);
router.post('/nhap/:id/pay', vatChuaController.apiImportPay);
router.post('/nhap/:id/return', vatChuaController.apiImportReturn);
router.get('/xuat/:id/edit', vatChuaController.apiReturnEditDetail);
router.post('/xuat/:id/edit', vatChuaController.apiReturnUpdate);
router.post('/xuat/:id/delete', vatChuaController.apiReturnDelete);
router.get('/api/:id/detail', vatChuaController.apiDetail);
router.post('/add', vatChuaController.add);
router.post('/nhap', vatChuaController.importStock);
router.post('/xuat', vatChuaController.exportStock);
router.post('/kiem-kho', vatChuaController.stocktake);
router.post('/xuat-huy', vatChuaController.destroyStock);
router.post('/nhap/trash/preview', vatChuaController.previewImportTrash);
router.post('/nhap/trash/move', vatChuaController.moveImportToTrash);
router.post('/delete-selected', vatChuaController.removeSelected);

module.exports = router;
