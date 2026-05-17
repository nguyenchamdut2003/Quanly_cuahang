var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var hangHoaController = require('../controllers/hangHoa.controller');

router.use(isAuthenticated);

router.get('/api/:id/detail', hangHoaController.apiProductDetail);
router.get('/', hangHoaController.index);
router.get('/thiet-lap-gia', hangHoaController.priceSetup);
router.get('/thuoc-tinh', hangHoaController.attributesPage);
router.get('/:id/thuoc-tinh', hangHoaController.apiProductAttributes);
router.post('/thuoc-tinh/add', hangHoaController.addAttribute);
router.post('/thuoc-tinh/:id/update', hangHoaController.updateAttribute);
router.post('/thuoc-tinh/:id/delete', hangHoaController.deleteAttribute);
router.post('/thuoc-tinh/:attributeId/gia-tri/add', hangHoaController.addAttributeValue);
router.post('/thuoc-tinh/gia-tri/:id/update', hangHoaController.updateAttributeValue);
router.post('/thuoc-tinh/gia-tri/:id/delete', hangHoaController.deleteAttributeValue);
router.post('/thiet-lap-gia/ct-bang-gia', hangHoaController.updateCTBangGiaPrice);
router.post('/thiet-lap-gia/:id/retail-price', hangHoaController.updateRetailPrice);
router.post('/bang-gia/add', hangHoaController.addBangGia);
router.post('/add', hangHoaController.add);
router.post('/:id/update', hangHoaController.update);
router.post('/:id/delete', hangHoaController.remove);
router.post('/delete-selected', hangHoaController.removeSelected);
router.post('/groups/add', hangHoaController.addGroup);
router.post('/groups/:groupId/update', hangHoaController.updateGroup);
router.post('/groups/:groupId/delete', hangHoaController.removeGroup);
router.post('/units/add', hangHoaController.addUnit);
router.post('/units/:unitId/update', hangHoaController.updateUnit);
router.post('/units/:unitId/delete', hangHoaController.removeUnit);
router.post('/export-excel', hangHoaController.exportExcel);
router.get('/:id', function(req, res) {
  var id = String(req.params.id || '');
  if (!/^[a-f0-9]{24}$/i.test(id)) {
    return res.redirect('/hang-hoa');
  }
  res.redirect(302, '/hang-hoa#p-' + id);
});

module.exports = router;
