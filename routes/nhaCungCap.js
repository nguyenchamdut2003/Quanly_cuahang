var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var nhaCungCapController = require('../controllers/nhaCungCap.controller');

router.use(isAuthenticated);

router.get('/', nhaCungCapController.index);
router.get('/export.xlsx', nhaCungCapController.exportExcel);
router.get('/:id/export/:section', nhaCungCapController.exportSupplierDetail);
router.post('/add', nhaCungCapController.add);
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
router.get('/:id', function(req, res) {
  res.redirect('/nha-cung-cap?supplier=' + encodeURIComponent(req.params.id));
});

module.exports = router;
