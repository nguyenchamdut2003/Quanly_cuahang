var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var apiSoQuyController = require('../controllers/soquycontroller/api.controller');

router.use(isAuthenticated);
router.get('/', apiSoQuyController.index);
router.get('/active', apiSoQuyController.getActive);
router.post('/', apiSoQuyController.create);
router.put('/:id', apiSoQuyController.putId);
router.post('/trash/preview', apiSoQuyController.postTrashPreview);
router.post('/trash/move', apiSoQuyController.postTrashMove);
router.delete('/:id', apiSoQuyController.deleteId);

module.exports = router;
