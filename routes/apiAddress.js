const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const ghnAddress = require('../services/ghnAddress.service');

router.use(isAuthenticated);

function ok(res, items) {
  res.json({ success: true, items: items || [] });
}

function fail(res, error) {
  res.status(500).json({
    success: false,
    message: error && error.message ? error.message : 'Không lấy được danh mục địa chỉ GHN.'
  });
}

router.get('/provinces', async function(req, res) {
  try {
    ok(res, await ghnAddress.getProvinces());
  } catch (error) {
    fail(res, error);
  }
});

router.get('/districts', async function(req, res) {
  try {
    ok(res, await ghnAddress.getDistricts(req.query.province_id));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/wards', async function(req, res) {
  try {
    ok(res, await ghnAddress.getWards(req.query.district_id));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/wards-by-province', async function(req, res) {
  try {
    ok(res, await ghnAddress.getWardsByProvince(req.query.province_id));
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
