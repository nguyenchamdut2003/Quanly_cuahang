const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const hangHoaController = require('../controllers/hangHoa.controller');

router.use(isAuthenticated);

router.get('/', hangHoaController.index);
router.get('/thiet-lap-gia', hangHoaController.priceSetup);
router.post('/thiet-lap-gia/update', hangHoaController.updatePrices);
router.post('/add', hangHoaController.uploadProductImages, hangHoaController.add);
router.post('/:id/update', hangHoaController.uploadProductImages, hangHoaController.update);
router.post('/:id/delete', hangHoaController.remove);
router.post('/import', hangHoaController.importProductFile, hangHoaController.importCsv);
router.post('/nhom-hang/add', hangHoaController.addCategory);
router.post('/thuong-hieu/add', hangHoaController.addBrand);
router.post('/don-vi-tinh/add', hangHoaController.addUnit);
router.post('/vi-tri/add', hangHoaController.addLocation);

module.exports = router;
