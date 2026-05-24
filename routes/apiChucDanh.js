var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var chucDanhController = require('../controllers/chucDanh.controller');

router.use(isAuthenticated);

router.get('/', chucDanhController.apiList);
router.post('/', chucDanhController.apiCreate);
router.put('/:id', chucDanhController.apiUpdate);
router.delete('/:id', chucDanhController.apiDelete);

module.exports = router;
