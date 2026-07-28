const mongoose = require('mongoose');
const { ChamCongMoiNhanVien } = require('../../models/chamcongmoi.model');
const { resolveStoreId } = require('../../utils/storeScope');
const { getNextCode } = require('../../utils/hrCode');
const { jsonError } = require('./helpers/response.helper');
const { normalizeEmployeePayload, serializeEmployee, buildEmployeeFilter } = require('./helpers/employee.helper');

const apiEmployees = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var employees = await ChamCongMoiNhanVien.find(buildEmployeeFilter(storeId, req.query))
      .sort({ created_at: -1 })
      .lean();
    return res.json({ success: true, items: employees.map(serializeEmployee) });
  } catch (error) {
    next(error);
  }
};

const apiCreateEmployee = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var payload = normalizeEmployeePayload(req.body);
    if (!payload.ten_nhan_vien) return jsonError(res, 400, 'Tên nhân viên là bắt buộc');
    if (!payload.ma_nhan_vien) {
      payload.ma_nhan_vien = await getNextCode('chamcongmoi_nhan_vien_' + String(storeId), 'NVM', 6);
    }
    var doc = await ChamCongMoiNhanVien.create(Object.assign({ cua_hang_id: storeId }, payload));
    return res.json({ success: true, item: serializeEmployee(doc.toObject()) });
  } catch (error) {
    if (error && error.code === 11000) return jsonError(res, 400, 'Mã nhân viên đã tồn tại');
    next(error);
  }
};

const apiGetEmployee = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã nhân viên không hợp lệ');
    var item = await ChamCongMoiNhanVien.findOne({ _id: id, cua_hang_id: storeId }).lean();
    if (!item) return jsonError(res, 404, 'Không tìm thấy nhân viên');
    return res.json({ success: true, item: serializeEmployee(item) });
  } catch (error) {
    next(error);
  }
};

const apiUpdateEmployee = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã nhân viên không hợp lệ');
    var payload = normalizeEmployeePayload(req.body);
    if (!payload.ten_nhan_vien) return jsonError(res, 400, 'Tên nhân viên là bắt buộc');
    delete payload.ma_nhan_vien;
    var item = await ChamCongMoiNhanVien.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      { $set: payload },
      { new: true }
    ).lean();
    if (!item) return jsonError(res, 404, 'Không tìm thấy nhân viên');
    return res.json({ success: true, item: serializeEmployee(item) });
  } catch (error) {
    if (error && error.code === 11000) return jsonError(res, 400, 'Mã nhân viên đã tồn tại');
    next(error);
  }
};

const apiDeleteEmployee = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã nhân viên không hợp lệ');
    var item = await ChamCongMoiNhanVien.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      { $set: { trang_thai: 'inactive' } },
      { new: true }
    ).lean();
    if (!item) return jsonError(res, 404, 'Không tìm thấy nhân viên');
    return res.json({ success: true, item: serializeEmployee(item) });
  } catch (error) {
    next(error);
  }
};

module.exports = { apiEmployees, apiCreateEmployee, apiGetEmployee, apiUpdateEmployee, apiDeleteEmployee };
