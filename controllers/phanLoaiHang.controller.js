const mongoose = require('mongoose');
const { resolveUserStoreId } = require('../utils/storeScope');
const classification = require('../services/phanLoaiHang.service');

function contextInput(req, source = {}) {
  const storeId = resolveUserStoreId(req);
  if (!storeId) throw Object.assign(new Error('Chưa chọn cửa hàng trong phiên đăng nhập.'), { statusCode: 403 });
  // Store and operator always come from the authenticated session.
  return {
    cua_hang_id: storeId,
    kho_id: source.kho_id,
    hang_hoa_id: source.hang_hoa_id || req.params.productId,
    lo_hang_id: source.lo_hang_id || null,
    nguon_thao_tac: source.nguon_thao_tac || 'ton_kho',
    phieu_nhap_id: source.phieu_nhap_id || req.params.purchaseId || null,
    ct_phieu_nhap_id: source.ct_phieu_nhap_id || req.params.lineId || null
  };
}

function fail(res, error) {
  const status = Number(error.statusCode || error.status);
  return res.status(status >= 400 && status <= 599 ? status : 400)
    .json({ success: false, message: error.message || 'Không thể xử lý phân loại hàng hóa.' });
}

exports.context = async (req, res) => {
  try {
    const data = await classification.getClassificationContext(contextInput(req, req.query));
    return res.json({ success: true, data });
  } catch (error) { return fail(res, error); }
};

exports.classify = async (req, res) => {
  try {
    const body = req.body || {};
    const input = contextInput(req, body);
    const operator = req.user && (req.user._id || req.user.id);
    if (!operator || !mongoose.Types.ObjectId.isValid(String(operator))) {
      throw Object.assign(new Error('Không xác định được người thực hiện phân loại.'), { statusCode: 403 });
    }
    const data = await classification.classifyStock({ ...input,
      nguon: body.nguon, dich: body.dich,
      request_key: body.request_key, ghi_chu: body.ghi_chu,
      nguoi_thuc_hien_id: String(operator)
    });
    return res.json({ success: true, message: 'Đã phân loại hàng hóa.', data });
  } catch (error) { return fail(res, error); }
};

exports.history = async (req, res) => {
  try {
    const input = contextInput(req, req.query);
    if (!Object.prototype.hasOwnProperty.call(req.query, 'lo_hang_id')) delete input.lo_hang_id;
    const data = await classification.listClassificationHistory({ ...input,
      page: req.query.page, limit: req.query.limit,
      tu_ngay: req.query.tu_ngay, den_ngay: req.query.den_ngay
    });
    return res.json({ success: true, data });
  } catch (error) { return fail(res, error); }
};

exports.historyDetail = async (req, res) => {
  try {
    const data = await classification.getClassificationHistoryDetail({
      cua_hang_id: contextInput(req).cua_hang_id, id: req.params.historyId
    });
    if (!data) return res.status(404).json({ success: false, message: 'Không tìm thấy lịch sử phân loại.' });
    return res.json({ success: true, data });
  } catch (error) { return fail(res, error); }
};
