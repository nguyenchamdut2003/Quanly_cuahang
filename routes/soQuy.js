var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var soQuyController = require('../controllers/soquycontroller');

router.use(isAuthenticated);
router.get('/', soQuyController.index);
router.get('/export.csv', soQuyController.getExportCsv);
router.get('/phieu-thu-chi/:id', soQuyController.getPhieuThuChiId);
router.get('/related-documents', soQuyController.getRelatedDocuments);
router.get('/:id/in-tong-hop', soQuyController.printBundle);
router.get('/:id/in-phieu', soQuyController.printReceipt);
router.get('/:id/in-phieu/pdf', soQuyController.printReceiptPdf);
router.get('/:id/in-chung-tu-lien-quan', soQuyController.printRelatedDocs);
router.get('/:id/in-chung-tu-lien-quan/pdf', soQuyController.printRelatedPdf);
router.get('/:id/detail', soQuyController.getIdDetail);
router.post('/add', soQuyController.postAdd);

module.exports = router;
