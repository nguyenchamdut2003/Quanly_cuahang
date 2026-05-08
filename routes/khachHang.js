var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var khachHangController = require('../controllers/khachHang.controller');

router.use(isAuthenticated);

router.get('/', khachHangController.index);
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
router.post('/:id/addresses/add', khachHangController.addAddress);
router.post('/:id/addresses/:addressId/update', khachHangController.updateAddress);
router.post('/:id/addresses/:addressId/delete', khachHangController.removeAddress);

module.exports = router;
