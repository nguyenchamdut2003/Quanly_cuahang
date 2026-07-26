var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var controller = require('../controllers/nhapHang.controller');

router.get('/', isAuthenticated, controller.apiHangHoa);
router.get('/:id/lo-hang', isAuthenticated, controller.apiProductLots);
router.post('/quick-create', isAuthenticated, controller.quickCreateProduct);
router.post('/:id/quick-update', isAuthenticated, controller.quickUpdateProduct);
router.put('/:id/quick-update', isAuthenticated, controller.quickUpdateProduct);
router.post('/:id/inactive', isAuthenticated, controller.inactiveProduct);

module.exports = router;
