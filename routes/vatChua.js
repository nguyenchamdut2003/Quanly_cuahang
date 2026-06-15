var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var vatChuaController = require('../controllers/vatChua.controller');

router.use(isAuthenticated);

router.get('/', vatChuaController.index);
router.get('/api/document/:kind/:id', vatChuaController.apiDocumentDetail);
router.get('/api/:id/detail', vatChuaController.apiDetail);
router.post('/add', vatChuaController.add);
router.post('/nhap', vatChuaController.importStock);
router.post('/delete-selected', vatChuaController.removeSelected);

module.exports = router;
