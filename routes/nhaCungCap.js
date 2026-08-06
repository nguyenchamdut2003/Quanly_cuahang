var express = require('express');
var multer = require('multer');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var nhaCungCapController = require('../controllers/nhacungcapcontroller');

var upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

router.use(isAuthenticated);

router.get('/', nhaCungCapController.index);
router.get('/export.xlsx', nhaCungCapController.exportExcel);
router.get('/import/template.xlsx', nhaCungCapController.downloadImportTemplate);
router.post('/import', upload.single('file'), nhaCungCapController.importExcel);
router.get('/api/table-metrics', nhaCungCapController.apiTableMetrics);
router.get('/api/:id/detail', nhaCungCapController.apiSupplierDetail);
router.get('/api/:id/tab/:tab(address|history|vat-chua|debt|xnb)', nhaCungCapController.apiSupplierDetailTab);
router.get('/:id/export/:section', nhaCungCapController.exportSupplierDetail);
router.post('/add', nhaCungCapController.add);
router.post('/:id/pay-debt', nhaCungCapController.payDebt);
router.post('/:id/discount-debt', nhaCungCapController.discountDebt);
router.post('/:id/update', nhaCungCapController.update);
router.post('/:id/delete', nhaCungCapController.remove);
router.post('/delete-selected', nhaCungCapController.removeSelected);
router.post('/groups/add', nhaCungCapController.addGroup);
router.post('/groups/:groupId/update', nhaCungCapController.updateGroup);
router.post('/groups/:groupId/delete', nhaCungCapController.removeGroup);
router.post('/address-types/add', nhaCungCapController.addAddressType);
router.post('/address-types/:typeId/update', nhaCungCapController.updateAddressType);
router.post('/address-types/:typeId/delete', nhaCungCapController.removeAddressType);
router.get('/:id/dia-chi', nhaCungCapController.listAddresses);
router.post('/:id/dia-chi', nhaCungCapController.addAddress);
router.post('/dia-chi/:addressId/update', nhaCungCapController.updateAddress);
router.post('/dia-chi/:addressId/delete', nhaCungCapController.removeAddress);
router.get('/:id', nhaCungCapController.redirectDetail);

module.exports = router;
