var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var xuatDungNoiBoController = require('../controllers/xuatDungNoiBo.controller');

router.use(isAuthenticated);
router.get('/', xuatDungNoiBoController.index);
router.get('/api/san-pham', xuatDungNoiBoController.getApiSanPham);
router.get('/api/vat-chua', xuatDungNoiBoController.getApiVatChua);
router.get('/create', xuatDungNoiBoController.getCreate);
router.post('/loai-xuat/add', xuatDungNoiBoController.postLoaiXuatAdd);
router.post('/loai-xuat/:id/update', xuatDungNoiBoController.postLoaiXuatIdUpdate);
router.post('/loai-xuat/:id/delete', xuatDungNoiBoController.postLoaiXuatIdDelete);
router.post('/add', xuatDungNoiBoController.postAdd);
router.get('/export.csv', xuatDungNoiBoController.getExportCsv);
router.get('/export.xlsx', xuatDungNoiBoController.getExportXlsx);
router.get('/details', xuatDungNoiBoController.getDetails);
router.get('/:id/details', xuatDungNoiBoController.getIdDetails);
router.get('/:id/export.xlsx', xuatDungNoiBoController.getIdExportXlsx);

module.exports = router;
