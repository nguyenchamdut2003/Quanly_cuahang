var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../../middlewares/auth.middleware');
var chamCongController = require('../../controllers/chamcongcontroller/chamcong.controller');
var bangLuongController = require('../../controllers/chamcongcontroller/bangluong.controller');
var thanhToanLuongController = require('../../controllers/chamcongcontroller/thanhtoanluong.controller');

router.use(isAuthenticated);

router.get('/', chamCongController.index);
router.get('/tuan', chamCongController.getTuan);
router.post('/tuan', chamCongController.saveTuan);
router.get('/bang-luong', bangLuongController.listBangLuong);
router.get('/bang-luong/:id/export.xlsx', bangLuongController.exportBangLuongExcel);
router.get('/bang-luong/:id/thanh-toan', thanhToanLuongController.getBangLuongThanhToan);
router.post('/bang-luong/:id/phieu-chi', thanhToanLuongController.createBangLuongPhieuChi);
router.delete('/bang-luong/:id', bangLuongController.deleteBangLuong);

module.exports = router;
