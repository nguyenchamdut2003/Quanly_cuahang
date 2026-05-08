var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var hangHoaController = require('../controllers/hangHoa.controller');

router.use(isAuthenticated);

router.get('/', hangHoaController.index);
router.get('/thiet-lap-gia', hangHoaController.priceSetup);
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

module.exports = router;
