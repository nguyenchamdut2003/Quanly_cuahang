const mongoose = require('mongoose');
const { PhieuNhap, PhieuNhapTongHop, PhieuTraHangNhap, GopPhieuNhap, Counter } = require('../models/kiot.model');
const { previewSourceDetails } = require('./purchaseGroupQuery.service');

function refId(value) { return String(value && value._id || value || '').trim(); }
function validId(value) { return mongoose.Types.ObjectId.isValid(refId(value)); }
function httpError(statusCode, message) { return Object.assign(new Error(message), { statusCode, status: statusCode }); }
function scoped(query, session) { return session ? query.session(session) : query; }

function normalizeSources(sourceIds) {
  if (!Array.isArray(sourceIds) || sourceIds.length < 2) throw httpError(400, 'Vui lòng chọn ít nhất 2 phiếu nhập để tổng hợp.');
  const ids = sourceIds.map(refId);
  if (ids.some(id => !validId(id))) throw httpError(400, 'ID phiếu nhập không hợp lệ.');
  if (new Set(ids).size !== ids.length) throw httpError(400, 'Danh sách phiếu nguồn không được trùng lặp.');
  return ids;
}

async function acquirePurchaseGroupMutationLock(storeId, session) {
  if (!validId(storeId)) throw httpError(400, 'Chưa chọn cửa hàng làm việc hợp lệ.');
  if (!session) throw httpError(400, 'Thao tác nhóm phiếu nhập phải chạy trong giao dịch.');
  return Counter.findOneAndUpdate(
    { _id: 'purchase_group_mutation:' + refId(storeId) },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session }
  ).lean();
}

async function findActivePurchaseGroupForSource(sourceId, storeId, { session } = {}) {
  if (!validId(sourceId) || !validId(storeId)) return null;
  return scoped(PhieuNhapTongHop.findOne({ cua_hang_id: refId(storeId), phieu_nguon_ids: refId(sourceId), trang_thai: 'active' }), session).lean();
}

async function validateSources({ sourceIds, storeId }, session) {
  const ids = normalizeSources(sourceIds);
  if (!validId(storeId)) throw httpError(400, 'Chưa chọn cửa hàng làm việc hợp lệ.');
  const store = refId(storeId);
  const sources = await scoped(PhieuNhap.find({ _id: { $in: ids }, cua_hang_id: store, deleted_at: null })
    .setOptions({ strictQuery: false }), session).lean();
  if (sources.length !== ids.length) throw httpError(400, 'Một hoặc nhiều phiếu nguồn không tồn tại hoặc không thuộc cửa hàng đang làm việc.');
  for (const source of sources) {
    if (!['draft', 'completed'].includes(source.trang_thai) || source.trang_thai_du_lieu === 'inactive' || source.deleted_at) {
      throw httpError(400, 'Phiếu ' + source.ma_phieu_nhap + ' đã hủy, ngừng hiệu lực hoặc không đủ điều kiện tổng hợp.');
    }
    if (source.is_merged_purchase || source.merged_to_phieu_nhap_id || (source.merged_from_phieu_nhap_ids || []).length || (source.merged_from_ma_phieu_nhaps || []).length || source.merged_to_ma_phieu_nhap || source.merged_at || source.merged_by || source.merge_note) {
      throw httpError(400, 'Phiếu ' + source.ma_phieu_nhap + ' thuộc cơ chế gộp cũ, cần đối soát trước khi tổng hợp.');
    }
    if (!validId(source.kho_id) || !validId(source.nha_cung_cap_id)) throw httpError(400, 'Các phiếu nguồn phải có kho và nhà cung cấp hợp lệ.');
  }
  if (new Set(sources.map(row => refId(row.kho_id))).size !== 1) throw httpError(400, 'Không thể tổng hợp phiếu nhập khác kho.');
  if (new Set(sources.map(row => refId(row.nha_cung_cap_id))).size !== 1) throw httpError(400, 'Không thể tổng hợp phiếu nhập khác nhà cung cấp.');
  const existing = await scoped(PhieuNhapTongHop.findOne({ cua_hang_id: store, trang_thai: 'active', phieu_nguon_ids: { $in: ids } }), session).lean();
  if (existing) throw httpError(409, 'Một hoặc nhiều phiếu nguồn đã thuộc phiếu tổng hợp ' + existing.ma_phieu_tong_hop + ' đang hoạt động.');
  const activeReturn = await scoped(PhieuTraHangNhap.findOne({
    cua_hang_id: store, phieu_nhap_id: { $in: ids }, trang_thai: { $ne: 'cancelled' }, trang_thai_du_lieu: { $ne: 'inactive' }, deleted_at: null
  }).setOptions({ strictQuery: false }).select('ma_phieu_tra_nhap'), session).lean();
  if (activeReturn) throw httpError(400, 'Không thể tổng hợp phiếu đã có trả hàng nhập còn hiệu lực.');
  return ids.map(id => sources.find(source => refId(source._id) === id));
}

async function generatePurchaseGroupCode(session) {
  const legacy = await scoped(GopPhieuNhap.find({ ma_gop_phieu_nhap: /^GPN\d+$/ }).select('ma_gop_phieu_nhap'), session).lean();
  const groups = await scoped(PhieuNhapTongHop.find({ ma_phieu_tong_hop: /^GPN\d+$/ }).select('ma_phieu_tong_hop'), session).lean();
  const max = legacy.concat(groups).reduce((current, row) => Math.max(current, Number(String(row.ma_gop_phieu_nhap || row.ma_phieu_tong_hop).replace(/^GPN/, '')) || 0), 0);
  await Counter.updateOne({ _id: 'gop_phieu_nhap' }, { $max: { seq: max } }, { upsert: true, session });
  const next = await Counter.findOneAndUpdate({ _id: 'gop_phieu_nhap' }, { $inc: { seq: 1 } }, { upsert: true, new: true, session }).lean();
  if (!Number.isSafeInteger(Number(next.seq))) throw httpError(409, 'Không thể cấp mã phiếu tổng hợp hợp lệ.');
  return 'GPN' + String(next.seq).padStart(6, '0');
}

async function runTransaction(session, operation) {
  if (session) return operation(session);
  const ownSession = await mongoose.startSession();
  try {
    let result;
    await ownSession.withTransaction(async () => { result = await operation(ownSession); });
    return result;
  } finally { await ownSession.endSession(); }
}

async function createPurchaseGroup(input = {}, { session } = {}) {
  normalizeSources(input.sourceIds);
  if (!validId(input.userId)) throw httpError(403, 'Vui lòng đăng nhập để tạo phiếu tổng hợp.');
  try {
    return await runTransaction(session, async currentSession => {
      await acquirePurchaseGroupMutationLock(input.storeId, currentSession);
      const sources = await validateSources(input, currentSession);
      const rows = await PhieuNhapTongHop.create([{
        ma_phieu_tong_hop: await generatePurchaseGroupCode(currentSession),
        cua_hang_id: refId(input.storeId), kho_id: refId(sources[0].kho_id), nha_cung_cap_id: refId(sources[0].nha_cung_cap_id),
        phieu_nguon_ids: sources.map(source => source._id), ngay_gop: new Date(), nguoi_tao_id: refId(input.userId),
        ghi_chu: String(input.note || '').trim(), trang_thai: 'active'
      }], { session: currentSession });
      return rows[0];
    });
  } catch (error) {
    if (error && error.code === 11000) throw httpError(409, 'Phiếu nguồn vừa được tổng hợp ở thao tác khác. Vui lòng tải lại danh sách.');
    throw error;
  }
}

async function previewPurchaseGroup(input = {}) {
  const sources = await validateSources(input, null);
  return previewSourceDetails(sources, refId(input.storeId));
}

async function cancelPurchaseGroup({ groupId, storeId, userId, note } = {}) {
  if (!validId(groupId) || !validId(storeId)) throw httpError(400, 'ID phiếu tổng hợp không hợp lệ.');
  if (!validId(userId)) throw httpError(403, 'Vui lòng đăng nhập để tách phiếu tổng hợp.');
  return runTransaction(null, async session => {
    await acquirePurchaseGroupMutationLock(storeId, session);
    const group = await PhieuNhapTongHop.findOneAndUpdate(
      { _id: refId(groupId), cua_hang_id: refId(storeId), trang_thai: 'active' },
      { $set: { trang_thai: 'cancelled', nguoi_huy_id: refId(userId), ngay_huy: new Date(), ly_do_huy: String(note || '').trim() } },
      { new: true, session, runValidators: true }
    ).lean();
    if (!group) throw httpError(404, 'Không tìm thấy phiếu tổng hợp đang hoạt động.');
    return group;
  });
}

module.exports = { createPurchaseGroup, previewPurchaseGroup, cancelPurchaseGroup, findActivePurchaseGroupForSource, acquirePurchaseGroupMutationLock };
