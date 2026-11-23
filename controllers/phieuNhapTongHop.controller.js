const mongoose = require('mongoose');
const { PhieuNhapTongHop } = require('../models/phieunhap.model');
const { resolveStoreId } = require('../utils/storeScope');
const { createPurchaseGroup, previewPurchaseGroup, cancelPurchaseGroup } = require('../services/purchaseGroup.service');
const { getPurchaseGroupDetail, loadPurchaseGroupDetails, listEligiblePurchases } = require('../services/purchaseGroupQuery.service');
const { payPurchaseGroup } = require('../services/purchaseGroupPayment.service');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function storeScope(req) {
  const storeId = await resolveStoreId(req);
  if (!storeId || !mongoose.Types.ObjectId.isValid(String(storeId))) throw httpError(400, 'Chưa chọn cửa hàng làm việc.');
  return String(storeId);
}

function groupId(req) {
  const id = String(req.params && req.params.id || '');
  if (!mongoose.Types.ObjectId.isValid(id)) throw httpError(400, 'Mã phiếu tổng hợp không hợp lệ.');
  return id;
}

function input(req, storeId) {
  const body = req.body || {};
  return {
    sourceIds: body.phieu_nhap_ids || body.phieu_nguon_ids || [],
    storeId,
    userId: req.user && req.user._id,
    note: String(body.ghi_chu || '').trim()
  };
}

function fail(res, error) {
  const status = Number(error && (error.status || error.statusCode)) || (error && error.code === 11000 ? 409 : 400);
  return res.status(status).json({ success: false, message: error && error.code === 11000
    ? 'Một phiếu nguồn đã được gộp bởi thao tác khác. Vui lòng tải lại danh sách.'
    : (error && error.message || 'Không xử lý được phiếu tổng hợp.') });
}

exports.list = async function(req, res, next) {
  try {
    const storeId = await storeScope(req);
    if (!String(req.get('accept') || '').includes('application/json')) return res.redirect('/nhap-hang?view_mode=groups');
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const filter = { cua_hang_id: storeId, trang_thai: req.query.trang_thai === 'cancelled' ? 'cancelled' : 'active' };
    const total = await PhieuNhapTongHop.countDocuments(filter);
    const rows = await PhieuNhapTongHop.find(filter).sort({ ngay_gop: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).select('_id').lean();
    const items = await loadPurchaseGroupDetails(rows.map(row => row._id), storeId);
    return res.json({ success: true, items, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) { return fail(res, error); }
};

exports.eligible = async function(req, res) {
  try {
    const storeId = await storeScope(req);
    const result = await listEligiblePurchases({
      storeId,
      keyword: String(req.query.q || '').trim(),
      page: req.query.page,
      limit: req.query.limit,
      supplierId: req.query.nha_cung_cap_id,
      warehouseId: req.query.kho_id
    });
    return res.json(Object.assign({ success: true }, result));
  } catch (error) { return fail(res, error); }
};

exports.preview = async function(req, res) {
  try {
    const result = await previewPurchaseGroup(input(req, await storeScope(req)));
    return res.json({ success: true, data: result });
  } catch (error) { return fail(res, error); }
};

exports.create = async function(req, res) {
  try {
    const group = await createPurchaseGroup(input(req, await storeScope(req)));
    return res.json({ success: true, message: 'Đã tạo phiếu tổng hợp. Các phiếu nguồn được giữ nguyên.', data: group });
  } catch (error) { return fail(res, error); }
};

exports.detail = async function(req, res, next) {
  try {
    const group = await getPurchaseGroupDetail(groupId(req), await storeScope(req));
    if (!group) throw httpError(404, 'Không tìm thấy phiếu tổng hợp.');
    if (String(req.get('accept') || '').includes('application/json')) return res.json({ success: true, data: group });
    return res.redirect(group.trang_thai === 'active'
      ? '/nhap-hang?group=' + encodeURIComponent(String(group._id))
      : '/nhap-hang?view_mode=sources');
  } catch (error) {
    if (String(req.get('accept') || '').includes('application/json')) return fail(res, error);
    error.status = error.status || error.statusCode || 400;
    return next(error);
  }
};

exports.cancel = async function(req, res) {
  try {
    const result = await cancelPurchaseGroup({ groupId: groupId(req), storeId: await storeScope(req), userId: req.user && req.user._id, note: String(req.body && req.body.ghi_chu || '').trim() });
    return res.json({ success: true, message: 'Đã tách phiếu tổng hợp. Kho, công nợ và thanh toán nguồn được giữ nguyên.', data: result });
  } catch (error) { return fail(res, error); }
};

exports.pay = async function(req, res) {
  try {
    const result = await payPurchaseGroup({ groupId: groupId(req), storeId: await storeScope(req), userId: req.user && req.user._id, data: req.body || {} });
    return res.json({ success: true, message: 'Đã tạo phiếu chi và phân bổ về các phiếu nhập nguồn.', data: result });
  } catch (error) { return fail(res, error); }
};

exports.returnToSource = async function(req, res, next) {
  try {
    const group = await getPurchaseGroupDetail(groupId(req), await storeScope(req));
    if (!group) throw httpError(404, 'Không tìm thấy phiếu tổng hợp.');
    if (group.trang_thai !== 'active') throw httpError(400, 'Phiếu tổng hợp đã tách, vui lòng thao tác trên phiếu nguồn.');
    const sourceId = String(req.query.source_id || '');
    const source = (group.sources || []).find(row => String(row._id) === sourceId);
    if (!source || source.trang_thai !== 'completed' || source.trang_thai_du_lieu === 'inactive' || source.deleted_at) {
      throw httpError(400, 'Vui lòng chọn phiếu nguồn đã nhập hàng còn hiệu lực thuộc nhóm này.');
    }
    return res.redirect('/tra-hang-nhap/create?phieu_nhap_id=' + encodeURIComponent(sourceId));
  } catch (error) { return fail(res, error); }
};
