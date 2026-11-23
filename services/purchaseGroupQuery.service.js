const mongoose = require('mongoose');
const { PhieuNhap, CTPhieuNhap, PhieuNhapTongHop, PhieuTraHangNhap, PhieuThuChi } = require('../models/kiot.model');

function refId(value) { return String(value && value._id || value || '').trim(); }
function money(value) { const amount = Number(value); return Number.isFinite(amount) ? Math.max(0, amount) : 0; }
function isValidId(value) { return mongoose.Types.ObjectId.isValid(refId(value)); }
function scoped(query, session) { return session ? query.session(session) : query; }
function escapeRegex(value) { return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function activeData(row) { return row && !row.deleted_at && row.trang_thai_du_lieu !== 'inactive' && !['cancelled', 'inactive', 'merged'].includes(row.trang_thai); }

function receiptAmountForSource(receipt, source) {
  if (!activeData(receipt) || receipt.loai_phieu !== 'chi') return 0;
  if (refId(receipt.cua_hang_id) !== refId(source.cua_hang_id)) return 0;
  const allocations = Array.isArray(receipt.allocations) ? receipt.allocations : [];
  if (allocations.length) return allocations.reduce((sum, row) => sum + (refId(row.phieu_nhap_id) === refId(source._id) ? money(row.so_tien) : 0), 0);
  const linkedId = refId(receipt.phieu_nhap_id);
  return (linkedId ? linkedId === refId(source._id) : Boolean(source.ma_phieu_nhap && receipt.ma_chung_tu_goc === source.ma_phieu_nhap)) ? money(receipt.gia_tri) : 0;
}

function receiptReferencesSource(receipt, source) {
  if (refId(receipt.cua_hang_id) !== refId(source.cua_hang_id)) return false;
  const allocations = Array.isArray(receipt.allocations) ? receipt.allocations : [];
  if (allocations.length) return allocations.some(row => refId(row.phieu_nhap_id) === refId(source._id));
  const linkedId = refId(receipt.phieu_nhap_id);
  return linkedId ? linkedId === refId(source._id) : Boolean(source.ma_phieu_nhap && receipt.ma_chung_tu_goc === source.ma_phieu_nhap);
}

function sourcePaymentRows(source, payments) {
  const methodLabel = value => value === 'tien_mat' ? 'Tiền mặt' : (value === 'chuyen_khoan' ? 'Chuyển khoản' : 'Công nợ');
  const rows = payments.filter(receipt => !receipt.deleted_at && receipt.trang_thai_du_lieu !== 'inactive' && receiptReferencesSource(receipt, source)).map(receipt => {
    const detail = receipt.chi_tiet_thanh_toan || {};
    const parts = [];
    if (Number(detail.tien_mat || 0) > 0) parts.push('TM ' + Number(detail.tien_mat).toLocaleString('vi-VN'));
    if (Number(detail.chuyen_khoan || 0) > 0) parts.push('CK ' + Number(detail.chuyen_khoan).toLocaleString('vi-VN'));
    if (Number(detail.tien_tra_khach || 0) > 0) parts.push('Trả KH ' + Number(detail.tien_tra_khach).toLocaleString('vi-VN'));
    const allocations = Array.isArray(receipt.allocations) ? receipt.allocations : [];
    // History retains a cancelled receipt's allocation; balances intentionally
    // exclude it through receiptAmountForSource instead.
    const amount = allocations.length
      ? allocations.reduce((sum, allocation) => sum + (refId(allocation.phieu_nhap_id) === refId(source._id) ? money(allocation.so_tien) : 0), 0)
      : money(receipt.so_tien || receipt.gia_tri || 0);
    return {
      _id: receipt._id,
      ma_phieu: receipt.ma_phieu || receipt.ma_thu_chi || '--',
      thoi_gian: receipt.ngay_lap || receipt.created_at,
      nguoi_tao: receipt.nguoi_tao_id && (receipt.nguoi_tao_id.ho_ten || receipt.nguoi_tao_id.email) || '--',
      phuong_thuc: methodLabel(receipt.phuong_thuc_thanh_toan || receipt.phuong_thuc || source.phuong_thuc_thanh_toan),
      trang_thai: receipt.trang_thai === 'cancelled' ? 'Đã hủy' : 'Đã thanh toán',
      tien_chi: amount,
      so_quy: parts.length ? parts.join(' · ') : (receipt.so_quy_id && receipt.so_quy_id.ten_so_quy || '--'),
      ghi_chu: receipt.ghi_chu || ''
    };
  });
  const current = source.payment_current || {};
  const legacyPaid = money(current.legacy_paid_fallback ? current.paid : current.legacy_paid_baseline);
  if (legacyPaid > 0) rows.push({
    ma_phieu: 'TT' + String(source.ma_phieu_nhap || ''),
    thoi_gian: source.ngay_nhap || source.created_at,
    nguoi_tao: source.nguoi_tao_id && (source.nguoi_tao_id.ho_ten || source.nguoi_tao_id.email) || '--',
    phuong_thuc: methodLabel(source.phuong_thuc_thanh_toan),
    trang_thai: 'Đã thanh toán',
    tien_chi: legacyPaid,
    so_quy: '--',
    ghi_chu: 'Thanh toán khi tạo phiếu'
  });
  return rows;
}

async function loadSourceContext(sourceIds, storeId, { session } = {}) {
  const store = refId(storeId);
  if (!isValidId(store)) throw Object.assign(new Error('Chưa chọn cửa hàng làm việc hợp lệ.'), { statusCode: 400 });
  const ids = [...new Set((sourceIds || []).map(refId).filter(isValidId))];
  if (!ids.length) return { sources: [], payments: [], returns: [] };
  const sources = await scoped(PhieuNhap.find({ _id: { $in: ids }, cua_hang_id: store })
    .populate('nha_cung_cap_id', 'ten_ncc ma_ncc')
    .populate('kho_id', 'ten_kho ma_kho')
    .populate('nguoi_tao_id', 'ho_ten email ten_dang_nhap'), session).lean();
  const codes = sources.map(row => row.ma_phieu_nhap).filter(Boolean);
  const payments = await scoped(PhieuThuChi.find({
    cua_hang_id: store,
    loai_phieu: 'chi',
    $or: [{ phieu_nhap_id: { $in: ids } }, { 'allocations.phieu_nhap_id': { $in: ids } }, { ma_chung_tu_goc: { $in: codes } }]
  }).setOptions({ strictQuery: false })
    .populate('nguoi_tao_id', 'ho_ten email')
    .populate('so_quy_id', 'ten_so_quy loai')
    .sort({ ngay_lap: -1, created_at: -1 }), session).lean();
  const returns = await scoped(PhieuTraHangNhap.find({ cua_hang_id: store, phieu_nhap_id: { $in: ids } })
    .setOptions({ strictQuery: false }).sort({ ngay_tra: -1, created_at: -1 }), session).lean();
  const enriched = sources.map(source => {
    const related = payments.filter(receipt => receiptReferencesSource(receipt, source));
    const fallback = related.length === 0;
    // Bridge payments recorded only on legacy PN headers when the first new
    // receipt is created. This opening amount remains historical after that
    // receipt is cancelled; only its newly paid allocation is cancelled.
    const legacyBaseline = related.reduce((baseline, receipt) => Math.max(baseline,
      (Array.isArray(receipt.allocations) ? receipt.allocations : []).reduce((value, row) =>
        refId(row.phieu_nhap_id) === refId(source._id) ? Math.max(value, money(row.legacy_paid_baseline)) : value, 0)), 0);
    const sourceValid = activeData(source);
    const completed = sourceValid && source.trang_thai === 'completed';
    const payable = sourceValid ? money(source.can_tra_ncc != null ? source.can_tra_ncc : source.tong_tien) : 0;
    const paid = completed ? (fallback ? money(source.da_tra_ncc) : legacyBaseline + related.reduce((sum, receipt) => sum + receiptAmountForSource(receipt, source), 0)) : 0;
    const effectiveReturns = returns.filter(row => refId(row.phieu_nhap_id) === refId(source._id) && activeData(row) && row.trang_thai === 'completed');
    // Preserve the existing return ledger convention: only ncc_da_tra reduces supplier debt.
    const reduction = completed ? effectiveReturns.reduce((sum, row) => sum + (row.tinh_vao_cong_no === false ? 0 : money(row.ncc_da_tra)), 0) : 0;
    const returnedAmount = effectiveReturns.reduce((sum, row) => sum + money(row.ncc_can_tra != null ? row.ncc_can_tra : row.tong_tien_tra), 0);
    const debt = completed ? Math.max(0, payable - paid - reduction) : 0;
    return Object.assign({}, source, {
      stored_da_tra_ncc: money(source.da_tra_ncc), stored_con_no_ncc: money(source.con_no_ncc),
      da_tra_ncc: paid, con_no_ncc: debt,
      payment_current: { payable, paid, debt, return_debt_reduction: reduction, returned_amount: returnedAmount, legacy_paid_fallback: fallback, legacy_paid_baseline: legacyBaseline }
    });
  });
  return { sources: enriched, payments, returns };
}

async function loadPurchaseSourceBalances(sourceIds, storeId, options = {}) {
  return (await loadSourceContext(sourceIds, storeId, options)).sources;
}

function summarizeSources(sources) {
  return (sources || []).reduce((totals, source) => {
    if (!activeData(source)) return totals;
    const current = source.payment_current || {};
    const total = money(source.tong_tien);
    totals.tong_tien += total;
    totals.tong_tien_hang += money(source.tong_tien_hang);
    if (source.trang_thai === 'draft') totals.tong_du_kien += total;
    if (source.trang_thai === 'completed') {
      totals.tong_da_nhap += total;
      totals.da_tra_ncc += money(current.paid);
      totals.con_no_ncc += money(current.debt);
      totals.returned_amount += money(current.returned_amount);
      totals.return_debt_reduction += money(current.return_debt_reduction);
    }
    return totals;
  }, { tong_tien: 0, tong_tien_hang: 0, tong_du_kien: 0, tong_da_nhap: 0, da_tra_ncc: 0, con_no_ncc: 0, returned_amount: 0, return_debt_reduction: 0 });
}

async function loadSourceDetailContext(sourceIds, storeId, { session } = {}) {
  const context = await loadSourceContext(sourceIds, storeId, { session });
  const ids = context.sources.map(source => refId(source._id));
  if (!ids.length) return Object.assign({}, context, { lines: [] });
  const lines = await scoped(CTPhieuNhap.find({ phieu_nhap_id: { $in: ids } })
    .populate('hang_hoa_id', 'ma_hang ten_hang quan_ly_theo_lo')
    .populate('lo_hang_id', 'ma_lo ten_lo ngay_nhap ngay_san_xuat han_su_dung')
    .populate('don_vi_tinh_id', 'ten_don_vi')
    .populate('gia_tri_thuoc_tinh_id', 'gia_tri ten_gia_tri')
    .sort({ created_at: 1 }), session).lean();
  const linesBySource = new Map();
  lines.forEach(line => {
    const sourceId = refId(line.phieu_nhap_id);
    if (!linesBySource.has(sourceId)) linesBySource.set(sourceId, []);
    linesBySource.get(sourceId).push(line);
  });
  const sources = context.sources.map(source => {
    const rows = linesBySource.get(refId(source._id)) || [];
    return Object.assign({}, source, {
      detail_rows: rows,
      detail_summary: { tong_mat_hang: rows.length, tong_so_luong: rows.reduce((sum, row) => sum + Number(row.so_luong || 0), 0) },
      payment_rows: sourcePaymentRows(source, context.payments)
    });
  });
  return Object.assign({}, context, { sources, lines });
}

async function getPurchaseSourceDetail(purchaseId, storeId, { supplierId, session } = {}) {
  if (!isValidId(purchaseId) || !isValidId(storeId) || (supplierId && !isValidId(supplierId))) return null;
  const context = await loadSourceDetailContext([refId(purchaseId)], storeId, { session });
  const source = context.sources[0];
  if (!source || source.deleted_at || source.trang_thai_du_lieu === 'inactive' || refId(source.cua_hang_id) !== refId(storeId)) return null;
  if (supplierId && refId(source.nha_cung_cap_id) !== refId(supplierId)) return null;
  return source;
}

async function buildDetails(groups, storeId, { session } = {}) {
  if (!groups.length) return [];
  const sourceIds = [...new Set(groups.flatMap(group => (group.phieu_nguon_ids || []).map(refId)))];
  const context = await loadSourceDetailContext(sourceIds, storeId, { session });
  const lines = context.lines;
  const bySource = new Map(context.sources.map(source => [refId(source._id), source]));
  return groups.map(group => {
    const ids = (group.phieu_nguon_ids || []).map(refId);
    const sourceSet = new Set(ids);
    const sources = ids.map(id => bySource.get(id)).filter(Boolean);
    const groupLines = lines.filter(line => sourceSet.has(refId(line.phieu_nhap_id))).map(line => {
      const source = bySource.get(refId(line.phieu_nhap_id));
      return Object.assign({}, line, { source_code: source && source.ma_phieu_nhap || '', source_status: source && source.trang_thai || '', source_href: '/nhap-hang?purchase=' + encodeURIComponent(refId(line.phieu_nhap_id)) });
    });
    const payments = context.payments.filter(receipt => sources.some(source => receiptReferencesSource(receipt, source))).map(receipt => Object.assign({}, receipt, {
      group_allocated_amount: sources.reduce((sum, source) => sum + receiptAmountForSource(receipt, source), 0),
      group_amount: sources.reduce((sum, source) => sum + receiptAmountForSource(receipt, source), 0)
    }));
    return Object.assign({}, group, {
      nha_cung_cap_id: group.nha_cung_cap_id || sources[0] && sources[0].nha_cung_cap_id,
      kho_id: group.kho_id || sources[0] && sources[0].kho_id,
      sources,
      lines: groupLines,
      payments,
      returns: context.returns.filter(row => sourceSet.has(refId(row.phieu_nhap_id))),
      totals: summarizeSources(sources),
      source_count: ids.length,
      missing_source_count: ids.length - sources.length,
      source_status_label: !sources.length ? 'Không tìm thấy phiếu nguồn' : (sources.every(row => row.trang_thai === 'completed') ? 'Đã nhập hàng' : (sources.every(row => row.trang_thai === 'draft') ? 'Phiếu tạm' : 'Nhập một phần'))
    });
  });
}

async function loadPurchaseGroupDetails(groupIds, storeId, { session } = {}) {
  if (!isValidId(storeId)) return [];
  const ids = [...new Set((groupIds || []).map(refId).filter(isValidId))];
  if (!ids.length) return [];
  const groups = await scoped(PhieuNhapTongHop.find({ _id: { $in: ids }, cua_hang_id: refId(storeId) })
    .populate('nha_cung_cap_id', 'ma_ncc ten_ncc')
    .populate('kho_id', 'ma_kho ten_kho')
    .populate('nguoi_tao_id', 'ho_ten ten_dang_nhap'), session).lean();
  const byId = new Map(groups.map(group => [refId(group._id), group]));
  return buildDetails(ids.map(id => byId.get(id)).filter(Boolean), storeId, { session });
}

async function getPurchaseGroupDetail(groupId, storeId, options = {}) {
  const groups = await loadPurchaseGroupDetails([groupId], storeId, options);
  return groups[0] || null;
}

async function previewSourceDetails(sources, storeId, options = {}) {
  return (await buildDetails([{ _id: null, ma_phieu_tong_hop: '', cua_hang_id: storeId, phieu_nguon_ids: sources.map(row => row._id), trang_thai: 'active' }], storeId, options))[0];
}

async function listEligiblePurchases({ storeId, keyword = '', page = 1, limit = 20, supplierId, warehouseId } = {}) {
  if (!isValidId(storeId)) throw Object.assign(new Error('Chưa chọn cửa hàng làm việc hợp lệ.'), { statusCode: 400 });
  if ((supplierId && !isValidId(supplierId)) || (warehouseId && !isValidId(warehouseId))) {
    throw Object.assign(new Error('Nhà cung cấp hoặc kho lọc không hợp lệ.'), { statusCode: 400 });
  }
  const store = refId(storeId);
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 20));
  const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
  const groups = await PhieuNhapTongHop.find({ cua_hang_id: store, trang_thai: 'active' }).select('phieu_nguon_ids').lean();
  const groupedIds = groups.flatMap(group => group.phieu_nguon_ids || []);
  const returns = await PhieuTraHangNhap.find({ cua_hang_id: store, trang_thai: { $ne: 'cancelled' }, trang_thai_du_lieu: { $ne: 'inactive' }, deleted_at: null })
    .setOptions({ strictQuery: false }).select('phieu_nhap_id').lean();
  const excluded = groupedIds.concat(returns.map(row => row.phieu_nhap_id).filter(Boolean));
  const filter = {
    cua_hang_id: store, trang_thai: { $in: ['draft', 'completed'] }, trang_thai_du_lieu: { $ne: 'inactive' }, deleted_at: null,
    is_merged_purchase: { $ne: true }, merged_to_phieu_nhap_id: null, merged_to_ma_phieu_nhap: { $in: [null, ''] },
    'merged_from_phieu_nhap_ids.0': { $exists: false }, 'merged_from_ma_phieu_nhaps.0': { $exists: false },
    merged_at: null, merged_by: null, merge_note: { $in: [null, ''] },
    _id: { $nin: excluded }, nha_cung_cap_id: { $ne: null }, kho_id: { $ne: null }
  };
  if (supplierId && isValidId(supplierId)) filter.nha_cung_cap_id = refId(supplierId);
  if (warehouseId && isValidId(warehouseId)) filter.kho_id = refId(warehouseId);
  if (String(keyword).trim()) filter.ma_phieu_nhap = new RegExp(escapeRegex(String(keyword).trim()), 'i');
  const total = await PhieuNhap.countDocuments(filter).setOptions({ strictQuery: false });
  const items = await PhieuNhap.find(filter).setOptions({ strictQuery: false })
    .populate('nha_cung_cap_id', 'ma_ncc ten_ncc').populate('kho_id', 'ma_kho ten_kho')
    .sort({ ngay_nhap: -1, created_at: -1, _id: -1 }).skip((pageNumber - 1) * pageSize).limit(pageSize).lean();
  return { items, total, page: pageNumber, limit: pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

module.exports = { getPurchaseGroupDetail, getPurchaseSourceDetail, loadPurchaseGroupDetails, loadPurchaseSourceBalances, listEligiblePurchases, previewSourceDetails, summarizeSources, receiptAmountForSource };
