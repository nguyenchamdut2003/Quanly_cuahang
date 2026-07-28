const mongoose = require('mongoose');
const { resolveStoreId } = require('../../utils/storeScope');
const { jsonError } = require('./helpers/response.helper');
const { getEmployeeAttendanceView, saveEmployeeAttendance } = require('./services/attendance.service');

const apiWeek = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var employeeId = String(req.query.nhan_vien_id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(employeeId)) return jsonError(res, 400, 'Chọn nhân viên');
    return res.json(await getEmployeeAttendanceView(storeId, employeeId, req.query || {}));
  } catch (error) {
    if (error && error.status) return jsonError(res, error.status, error.message);
    next(error);
  }
};

const apiSaveWeek = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var body = req.body || {};
    var employeeId = String(body.nhan_vien_id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(employeeId)) return jsonError(res, 400, 'Chọn nhân viên');
    return res.json(await saveEmployeeAttendance(storeId, employeeId, body));
  } catch (error) {
    if (error && error.status) return jsonError(res, error.status, error.message);
    next(error);
  }
};

module.exports = { apiWeek, apiSaveWeek };
