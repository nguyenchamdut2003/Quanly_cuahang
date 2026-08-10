var express = require('express');
var multer = require('multer');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var khachHangController = require('../controllers/khachhangcontroller');

var upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

router.use(isAuthenticated);

router.get('/', khachHangController.index);
router.get('/export.xlsx', khachHangController.exportExcel);
router.get('/import/template.xlsx', khachHangController.downloadImportTemplate);
router.post('/import', upload.single('file'), khachHangController.importExcel);
router.get('/api/:id/delete-check', khachHangController.deleteCheck);
router.get('/api/:id/detail', khachHangController.apiCustomerDetail);
router.get('/api/:id/addresses', khachHangController.apiCustomerAddresses);
router.get('/api/:id/orders', khachHangController.apiCustomerOrders);
router.get('/api/:id/invoices', khachHangController.apiCustomerInvoices);
router.get('/api/:id/returns', khachHangController.apiCustomerReturns);
router.get('/api/:id/vat-chua', khachHangController.apiCustomerVatChua);
router.get('/api/:id/debts', khachHangController.apiCustomerDebts);
router.post('/add', khachHangController.add);
router.post('/:id/update', khachHangController.update);
router.post('/:id/delete', khachHangController.remove);
router.post('/delete-selected', khachHangController.removeSelected);
router.post('/groups/add', khachHangController.addGroup);
router.post('/groups/:groupId/update', khachHangController.updateGroup);
router.post('/groups/:groupId/delete', khachHangController.removeGroup);
router.post('/address-types/add', khachHangController.addAddressType);
router.post('/address-types/:addressTypeId/update', khachHangController.updateAddressType);
router.post('/address-types/:addressTypeId/delete', khachHangController.removeAddressType);
router.get('/:id/export/debt', khachHangController.exportCustomerDebt);
router.get('/:id/export/:section.xlsx', khachHangController.exportSectionExcel);
router.get('/:id/export.xlsx', khachHangController.exportOneExcel);
router.post('/:id/addresses/add', khachHangController.addAddress);
router.post('/:id/addresses/:addressId/update', khachHangController.updateAddress);
router.post('/:id/addresses/:addressId/deactivate', khachHangController.removeAddress);
router.get('/:id', khachHangController.redirectDetail);

module.exports = router;
