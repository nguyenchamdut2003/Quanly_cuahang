var express = require('express');
var multer = require('multer');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var cuaHangController = require('../controllers/cuahangcontroller');

var upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

router.use(isAuthenticated);

router.get('/', cuaHangController.index);
router.get('/export.xlsx', cuaHangController.exportExcel);
router.get('/import/template.xlsx', cuaHangController.downloadImportTemplate);
router.post('/import', upload.single('file'), cuaHangController.importExcel);
router.post('/add', cuaHangController.add);
router.get('/:id/export/:section.xlsx', cuaHangController.exportSectionExcel);
router.post('/:id/update', cuaHangController.update);
router.post('/:id/delete', cuaHangController.remove);
router.post('/:id/warehouse/add', cuaHangController.addWarehouse);
router.post('/:id/warehouse/:warehouseId/update', cuaHangController.updateWarehouse);
router.post('/:id/warehouse/:warehouseId/delete', cuaHangController.removeWarehouse);
router.post('/delete-selected', cuaHangController.removeSelected);

module.exports = router;
