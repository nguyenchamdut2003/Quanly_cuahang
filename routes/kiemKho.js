var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var kiemKhoController = require('../controllers/kiemkhocontroller');

router.use(isAuthenticated);
router.post('/preview-ton-he-thong', kiemKhoController.postPreviewTonHeThong);
router.get('/in-ton-he-thong-preview/pdf', kiemKhoController.getInTonHeThongPreviewPdf);
router.post('/preview-gia-tri-kho', kiemKhoController.postPreviewGiaTriKho);
router.get('/in-gia-tri-kho-preview/pdf', kiemKhoController.getInGiaTriKhoPreviewPdf);
router.get('/in-gia-tri-kho-preview', kiemKhoController.getInGiaTriKhoPreview);
router.get('/in-ton-he-thong-preview', kiemKhoController.getInTonHeThongPreview);
router.get('/', kiemKhoController.index);
router.get('/export.csv', kiemKhoController.getExportCsv);
router.post('/export-excel', kiemKhoController.postExportExcel);
router.post('/deactivate', kiemKhoController.moveToTrash);
router.post('/trash/preview', kiemKhoController.previewTrash);
router.post('/trash/move', kiemKhoController.moveToTrash);
router.get('/:id/export.csv', kiemKhoController.getIdExportCsv);
router.get('/create', kiemKhoController.getCreate);
router.post('/:id/cancel', kiemKhoController.postIdCancel);
router.post('/', kiemKhoController.saveKiemKho);
router.post('/add', kiemKhoController.saveKiemKho);

module.exports = router;
