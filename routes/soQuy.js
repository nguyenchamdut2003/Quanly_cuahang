var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var soQuyController = require('../controllers/soQuy.controller');
var soQuyPrint = require('../controllers/soQuyPrint.controller');

router.use(isAuthenticated);
router.get('/', soQuyController.index);
router.get('/export.csv', soQuyController.getExportCsv);
router.get('/phieu-thu-chi/:id', soQuyController.getPhieuThuChiId);
router.get('/related-documents', soQuyController.getRelatedDocuments);
router.get('/:id/in-tong-hop', soQuyPrint.printBundle);
router.get('/:id/in-phieu', soQuyPrint.printReceipt);
router.get('/:id/in-phieu/pdf', soQuyPrint.printReceiptPdf);
router.get('/:id/in-chung-tu-lien-quan', soQuyPrint.printRelatedDocs);
router.get('/:id/in-chung-tu-lien-quan/pdf', soQuyPrint.printRelatedPdf);
router.get('/:id/detail', soQuyController.getIdDetail);
router.post('/add', soQuyController.postAdd);

module.exports = router;
