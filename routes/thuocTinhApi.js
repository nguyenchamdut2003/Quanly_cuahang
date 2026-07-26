var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var controller = require('../controllers/hangHoa.controller');

router.get('/thuoc-tinh', isAuthenticated, controller.apiAttributes);
router.post('/thuoc-tinh', isAuthenticated, controller.apiCreateAttribute);
router.put('/thuoc-tinh/:id', isAuthenticated, controller.apiUpdateAttribute);
router.delete('/thuoc-tinh/:id', isAuthenticated, controller.apiDeleteAttribute);
router.get('/gia-tri-thuoc-tinh', isAuthenticated, controller.apiAttributeValues);
router.post('/gia-tri-thuoc-tinh', isAuthenticated, controller.apiCreateAttributeValue);
router.put('/gia-tri-thuoc-tinh/:id', isAuthenticated, controller.apiUpdateAttributeValue);
router.delete('/gia-tri-thuoc-tinh/:id', isAuthenticated, controller.apiDeleteAttributeValue);

module.exports = router;
