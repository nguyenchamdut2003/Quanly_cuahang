const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const controller = require('../controllers/xuatHuy.controller');

router.use(isAuthenticated);

router.get('/', controller.index);
router.get('/export.xlsx', controller.exportExcel);
router.get('/create', controller.createPage);
router.post('/', controller.createSubmit);
router.get('/:id/export.xlsx', controller.exportOneExcel);
router.get('/:id', function(req, res) {
  if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
    return res.redirect('/xuat-huy');
  }
  return res.redirect(302, '/xuat-huy?open=' + encodeURIComponent(req.params.id));
});
router.post('/:id/complete', controller.complete);
router.post('/:id/cancel', controller.cancel);

module.exports = router;
