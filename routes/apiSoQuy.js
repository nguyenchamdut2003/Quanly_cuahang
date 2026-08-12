var express = require('express');
var multer = require('multer');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var apiSoQuyController = require('../controllers/soquycontroller/api.controller');

var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    if (!file || /^image\//i.test(String(file.mimetype || ''))) return cb(null, true);
    return cb(new Error('File tai len phai la anh.'));
  }
});

router.use(isAuthenticated);
router.get('/', apiSoQuyController.index);
router.get('/active', apiSoQuyController.getActive);
router.post('/', upload.single('anh_so_quy'), apiSoQuyController.create);
router.put('/:id', upload.single('anh_so_quy'), apiSoQuyController.putId);
router.post('/trash/preview', apiSoQuyController.postTrashPreview);
router.post('/trash/move', apiSoQuyController.postTrashMove);
router.delete('/:id', apiSoQuyController.deleteId);

module.exports = router;
