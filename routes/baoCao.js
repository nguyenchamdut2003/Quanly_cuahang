var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var baoCaoController = require('../controllers/baoCao.controller');

router.use(isAuthenticated);
router.get('/', baoCaoController.index);
router.get('/data', baoCaoController.getData);
router.get('/cuoi-ngay/export.csv', baoCaoController.getCuoiNgayExportCsv);
router.get('/ban-hang/export.csv', baoCaoController.getBanHangExportCsv);
router.get('/dat-hang/export.csv', baoCaoController.getDatHangExportCsv);
router.get('/khach-hang/export.csv', baoCaoController.getKhachHangExportCsv);
router.get('/nha-cung-cap/export.csv', baoCaoController.getNhaCungCapExportCsv);
router.get('/58/export.csv', baoCaoController.get58ExportCsv);
router.get('/58/export.xlsx', baoCaoController.get58ExportXlsx);
router.get('/58/preview.pdf', baoCaoController.get58PreviewPdf);
router.get('/58/preview/excel', baoCaoController.get58PreviewExcel);
router.get('/58/export.pdf', baoCaoController.get58ExportPdf);
router.get('/loi-nhuan-lo/export.csv', baoCaoController.getLoiNhuanLoExportCsv);
router.get('/loi-nhuan-lo', baoCaoController.getLoiNhuanLo);
router.get('/58', baoCaoController.get58);
router.get('/:reportType', baoCaoController.getReportType);

module.exports = router;
