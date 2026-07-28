var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var caLamViecController = require('../controllers/chamcongcu/caLamViec.controller');

router.use(isAuthenticated);

router.get('/', caLamViecController.apiList);
router.post('/', caLamViecController.apiCreate);
router.put('/:id', caLamViecController.apiUpdate);
router.delete('/:id', caLamViecController.apiDelete);

module.exports = router;
