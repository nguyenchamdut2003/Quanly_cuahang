const ghnAddress = require('../services/ghnAddress.service');

function ok(res, items) {
  res.json({ success: true, items: items || [] });
}

function fail(res, error) {
  res.status(500).json({
    success: false,
    message: error && error.message ? error.message : 'Không lấy được danh mục địa chỉ GHN.'
  });
}

exports.getProvinces = async function(req, res) {
  try {
    ok(res, await ghnAddress.getProvinces());
  } catch (error) {
    fail(res, error);
  }
};

exports.getDistricts = async function(req, res) {
  try {
    ok(res, await ghnAddress.getDistricts(req.query.province_id));
  } catch (error) {
    fail(res, error);
  }
};

exports.getWards = async function(req, res) {
  try {
    ok(res, await ghnAddress.getWards(req.query.district_id));
  } catch (error) {
    fail(res, error);
  }
};

exports.getWardsByProvince = async function(req, res) {
  try {
    ok(res, await ghnAddress.getWardsByProvince(req.query.province_id));
  } catch (error) {
    fail(res, error);
  }
};
