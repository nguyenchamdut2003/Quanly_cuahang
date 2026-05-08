var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var cuaHangController = require('../controllers/cuaHang.controller');

router.use(isAuthenticated);

router.get('/', cuaHangController.index);
router.post('/add', cuaHangController.add);
router.post('/:id/update', cuaHangController.update);
router.post('/:id/delete', cuaHangController.remove);
router.post('/:id/warehouse/add', cuaHangController.addWarehouse);
router.post('/:id/warehouse/:warehouseId/update', cuaHangController.updateWarehouse);
router.post('/:id/warehouse/:warehouseId/delete', cuaHangController.removeWarehouse);
router.post('/delete-selected', cuaHangController.removeSelected);

module.exports = router;
