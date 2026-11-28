const mongoose = require('mongoose');
const { createHash } = require('node:crypto');
const models = require('../models/kiot.model');
const stock = require('./kho.service');
const availability = require('./availability.service');

const UNCLASSIFIED = 'Chưa phân loại';
const SCALE = 1000000;
const EPSILON = 1 / SCALE;
const ref = value => String(value && value._id || value || '').trim();
const plain = value => value && typeof value.toObject === 'function' ? value.toObject() : value;
const scoped = (query, session) => session ? query.session(session) : query;
function error(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }); }
function oid(value, label, optional = false) {
  if (optional && (value == null || value === '')) return null;
  if (!mongoose.Types.ObjectId.isValid(ref(value))) throw error(label + ' không hợp lệ.');
  return ref(value);
}
function quantity(value) {
  if (typeof value === 'boolean' || value == null || String(value).trim() === '') throw error('Số lượng chuyển không hợp lệ.');
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || !Number.isSafeInteger(Math.round(number * SCALE))
      || Math.abs(number * SCALE - Math.round(number * SCALE)) > 0.000001) {
    throw error('Số lượng chuyển phải lớn hơn 0 và có tối đa 6 chữ số thập phân.');
  }
  return Math.round(number * SCALE) / SCALE;
}
function roundQty(value) { return Math.round(Number(value) * SCALE) / SCALE; }
function name(value) {
  const result = String(value || '').trim().replace(/\s+/g, ' ');
  if (!result || result.length > 120 || /[\u0000-\u001f\u007f]/.test(result)) throw error('Tên phân loại phải có từ 1 đến 120 ký tự hợp lệ.');
  return result;
}
function rowName(row) { return String(row && (row.ten_quy_cach || row.ten_thuoc_tinh) || '').trim() || UNCLASSIFIED; }
function active(row) { return row && row.trang_thai_du_lieu !== 'inactive' && !row.deleted_at && !['cancelled', 'huy'].includes(row.trang_thai); }
function sameScope(left, right) { return ref(left) === ref(right); }

async function loadScope(params, session, allowDiscovery = false) {
  const storeId = oid(params.cua_hang_id, 'Cửa hàng');
  const productId = oid(params.hang_hoa_id, 'Hàng hóa');
  const product = await scoped(models.HangHoa.findOne({ _id: productId }), session).lean();
  if (!product || !active(product) || product.trang_thai === 'inactive' || product.cua_hang_id && !sameScope(product.cua_hang_id, storeId)) {
    throw error('Hàng hóa không thuộc cửa hàng đang làm việc hoặc đã ngừng hoạt động.', 403);
  }
  const warehouses = await scoped(models.Kho.find({ cua_hang_id: storeId, trang_thai: { $ne: 'inactive' } }).sort({ ten_kho: 1 }), session).lean();
  const khoId = oid(params.kho_id, 'Kho', allowDiscovery);
  if (!khoId) return { storeId, productId, product, warehouses, warehouse: null, lot: null, lots: [] };
  const warehouse = warehouses.find(row => sameScope(row._id, khoId));
  if (!warehouse) throw error('Kho không thuộc cửa hàng đang làm việc hoặc đã ngừng hoạt động.', 403);
  let lot = null, lots = [], lotId = oid(params.lo_hang_id, 'Lô hàng', true);
  if (product.quan_ly_theo_lo) {
    lots = await scoped(models.LoHang.find({ cua_hang_id: storeId, kho_id: khoId, hang_hoa_id: productId,
      trang_thai: { $ne: 'huy' }, trang_thai_du_lieu: { $ne: 'inactive' } }).sort({ ngay_nhap: 1, _id: 1 }), session).lean();
    if (lotId) {
      lot = lots.find(row => sameScope(row._id, lotId));
      if (!lot) throw error('Lô hàng không thuộc đúng cửa hàng, kho và hàng hóa.', 403);
    } else if (!allowDiscovery) throw error('Vui lòng chọn lô hàng cần phân loại.');
  } else if (lotId) throw error('Hàng hóa không quản lý lô phải phân loại với lô trống.');
  return { storeId, productId, product, warehouses, warehouse, khoId, lotId, lot, lots };
}

function sourceLotMatches(line, lotId) {
  return sameScope(line.lo_hang_id, lotId) || (line.lot_allocations || []).some(row => sameScope(row.lo_hang_id, lotId));
}
async function isIndependentPurchaseLine(line, header, scope, purchase, session) {
  const raw = [line, header];
  let purchaseId = '', lineId = '';
  for (const row of raw) {
    purchaseId = purchaseId || ref(row.phieu_nhap_id || row.phieu_nhap_nguon_id);
    lineId = lineId || ref(row.ct_phieu_nhap_id || row.ct_phieu_nhap_nguon_id);
    if (row.source_type === 'phieu_nhap') purchaseId = purchaseId || ref(row.source_id);
    if (['ct_phieu_nhap', 'chi_tiet_phieu_nhap'].includes(row.source_type)) lineId = lineId || ref(row.source_id);
  }
  let linkedLine = null;
  if (lineId && mongoose.Types.ObjectId.isValid(lineId)) {
    linkedLine = await scoped(models.CTPhieuNhap.findOne({ _id: lineId, hang_hoa_id: scope.productId }), session).lean();
    if (!linkedLine || purchaseId && !sameScope(linkedLine.phieu_nhap_id, purchaseId)) return false;
    purchaseId = ref(linkedLine.phieu_nhap_id);
  }
  if (!mongoose.Types.ObjectId.isValid(purchaseId) || sameScope(purchaseId, purchase._id)) return false;
  const independent = await scoped(models.PhieuNhap.findOne({ _id: purchaseId, cua_hang_id: scope.storeId,
    kho_id: scope.khoId, trang_thai: 'completed', trang_thai_du_lieu: { $ne: 'inactive' }, deleted_at: null }), session).lean();
  if (!independent) return false;
  if (!linkedLine) linkedLine = await scoped(models.CTPhieuNhap.findOne({ phieu_nhap_id: purchaseId, hang_hoa_id: scope.productId }), session).lean();
  return Boolean(linkedLine);
}
async function sourceHasSales(scope, purchase, session) {
  scope.independentSalesCodes = new Set();
  const since = purchase.ngay_nhap || purchase.created_at;
  if (!since || !Number.isFinite(new Date(since).getTime())) return 'Không xác định được thời điểm nhập để đối chiếu lịch sử bán hàng.';
  for (const [Line, Header, link, label] of [
    [models.CTDonHang, models.DonHang, 'don_hang_id', 'Đặt hàng'],
    [models.CTHoaDonBanHang, models.HoaDonBanHang, 'hoa_don_id', 'Hóa đơn bán hàng']
  ]) {
    const lines = await scoped(Line.find({ hang_hoa_id: scope.productId }).setOptions({ strictQuery: false }), session).lean();
    const relevant = scope.product.quan_ly_theo_lo ? lines.filter(row => sourceLotMatches(row, scope.lotId))
      : lines.filter(row => !ref(row.lo_hang_id) && !(row.lot_allocations || []).some(allocation => ref(allocation.lo_hang_id)));
    const ids = [...new Set(relevant.map(row => ref(row[link])).filter(Boolean))];
    if (!ids.length) continue;
    const headers = await scoped(Header.find({ _id: { $in: ids }, cua_hang_id: scope.storeId, kho_id: scope.khoId,
      trang_thai_du_lieu: { $ne: 'inactive' }, trang_thai: { $nin: ['cancelled', 'huy'] }, deleted_at: null }), session).lean();
    for (const header of headers) {
      const activityTime = header.created_at || header.ngay_dat || header.ngay_ban;
      const inPeriod = scope.product.quan_ly_theo_lo || !activityTime || !Number.isFinite(new Date(activityTime).getTime())
        || new Date(activityTime).getTime() >= new Date(since).getTime();
      if (!inPeriod) continue;
      const headerLines = relevant.filter(row => sameScope(row[link], header._id));
      let hasUnprovenSource = scope.product.quan_ly_theo_lo;
      if (!hasUnprovenSource) for (const row of headerLines) {
        if (!await isIndependentPurchaseLine(row, header, scope, purchase, session)) { hasUnprovenSource = true; break; }
      }
      if (hasUnprovenSource) return label + ' đã phát sinh liên quan đến nguồn hàng này. Với hàng không lô, không thể quy chính xác lần xuất về từng PN.';
      const independentCode = String(header.ma_don_hang || header.ma_hoa_don || '').trim();
      if (independentCode) scope.independentSalesCodes.add(independentCode);
    }
  }
  return '';
}

async function validatePurchaseClassification(params = {}, session) {
  let purchase = null, line = null;
  const denied = reason => ({ allowed: false, reason: reason + ' Vui lòng sử dụng Phân loại tại kho nếu còn tồn khả dụng.', purchase, line });
  const storeId = oid(params.cua_hang_id, 'Cửa hàng');
  const purchaseId = oid(params.phieu_nhap_id, 'Phiếu nhập');
  const lineId = oid(params.ct_phieu_nhap_id, 'Dòng phiếu nhập');
  purchase = await scoped(models.PhieuNhap.findOne({ _id: purchaseId, cua_hang_id: storeId }), session).lean();
  if (!purchase) return denied('Phiếu nhập phải hoàn thành, còn hiệu lực và thuộc cửa hàng hiện tại.');
  line = await scoped(models.CTPhieuNhap.findOne({ _id: lineId, phieu_nhap_id: purchaseId }), session).lean();
  if (!line || params.hang_hoa_id && !sameScope(line.hang_hoa_id, params.hang_hoa_id) || params.kho_id && !sameScope(purchase.kho_id, params.kho_id)) {
    return denied('Dòng hàng hóa không thuộc phiếu nhập hoặc kho đã chọn.');
  }
  if (!active(purchase) || purchase.trang_thai !== 'completed') return denied('Phiếu nhập phải hoàn thành, còn hiệu lực và thuộc cửa hàng hiện tại.');
  const derived = { ...params, cua_hang_id: storeId, kho_id: purchase.kho_id, hang_hoa_id: line.hang_hoa_id,
    lo_hang_id: params.lo_hang_id || line.lo_hang_id || null };
  const scope = await loadScope(derived, session);
  if (scope.product.quan_ly_theo_lo) {
    const linked = sameScope(line.lo_hang_id, scope.lotId) || sameScope(scope.lot.ct_phieu_nhap_id, lineId)
      && sameScope(scope.lot.phieu_nhap_id, purchaseId);
    if (!linked) return denied('Không có liên kết lô xác định đến dòng phiếu nhập này.');
    if (scope.lot.phieu_nhap_id && !sameScope(scope.lot.phieu_nhap_id, purchaseId)) return denied('Lô hàng đang liên kết với phiếu nhập khác.');
  }
  const saleReason = await sourceHasSales(scope, purchase, session);
  if (saleReason) return denied(saleReason);
  // Non-sale decreases and warehouse classifications can make a purchase's
  // remaining source indistinguishable. Never guess it from the original qty.
  if (!scope.product.quan_ly_theo_lo) {
    const decreases = await scoped(models.LichSuKho.find({ cua_hang_id: storeId, kho_id: scope.khoId,
      hang_hoa_id: scope.productId, so_luong_thay_doi: { $lt: 0 }, loai_phieu: { $ne: 'phan_loai' },
      ngay: { $gte: new Date(purchase.ngay_nhap || purchase.created_at) } }), session).lean();
    const unprovenDecreases = decreases.filter(row => !(['ban_hang', 'dieu_chinh_ban_hang'].includes(row.loai_phieu)
      && scope.independentSalesCodes.has(String(row.ma_phieu || '').trim())));
    if (unprovenDecreases.length) return denied('Nguồn không lô đã có biến động giảm, không thể đối soát tồn riêng của dòng PN.');
    const warehouseChanges = await scoped(models.LichSuPhanLoai.find({ cua_hang_id: storeId, kho_id: scope.khoId,
      hang_hoa_id: scope.productId, nguon_thao_tac: 'ton_kho', ngay_thuc_hien: { $gte: new Date(purchase.ngay_nhap || purchase.created_at) } }), session).lean();
    if (warehouseChanges.length) return denied('Hàng không lô đã được phân loại trực tiếp tại kho, không còn đủ căn cứ tách nguồn PN.');
  }
  return { allowed: true, reason: '', purchase, line, lot: scope.lot, scope };
}

async function catalogOptions(scope, rows, session, line) {
  const prices = await scoped(models.GiaBanHangHoa.find({ hang_hoa_id: scope.productId, trang_thai: { $ne: 'inactive' },
    $or: [{ cua_hang_id: scope.storeId }, { cua_hang_id: null }] }), session).lean();
  const candidates = [...rows, ...prices, ...((line && line.lot_info && line.lot_info.quy_cach_items) || []), { ten_quy_cach: UNCLASSIFIED }];
  const byName = new Map();
  for (const row of candidates) {
    const key = rowName(row);
    if (!byName.has(key) || ref(row.gia_tri_thuoc_tinh_id)) byName.set(key, { ten_quy_cach: key, gia_tri_thuoc_tinh_id: ref(row.gia_tri_thuoc_tinh_id) || null });
  }
  return [...byName.values()];
}
function reservedFor(maps, scope, row) {
  return availability.getReservedQuantityForScope(maps, { hang_hoa_id: scope.productId, lo_hang_id: scope.lotId,
    ten_quy_cach: rowName(row), gia_tri_thuoc_tinh_id: row.gia_tri_thuoc_tinh_id });
}
async function getClassificationContext(params = {}, session) {
  let eligibility = { allowed: true, reason: '' };
  if (params.nguon_thao_tac === 'phieu_nhap') {
    eligibility = await validatePurchaseClassification(params, session);
    if (eligibility.purchase && eligibility.line) params = { ...params, kho_id: eligibility.purchase.kho_id,
      hang_hoa_id: eligibility.line.hang_hoa_id, lo_hang_id: params.lo_hang_id || eligibility.line.lo_hang_id || null };
  }
  const scope = await loadScope(params, session, true);
  const result = { product: scope.product, warehouse: scope.warehouse, warehouses: scope.warehouses,
    warehouse_options: scope.warehouses, lot: scope.lot, lots: scope.lots, lot_options: scope.lots,
    quy_cach: [], options: [], purchase_eligibility: { allowed: eligibility.allowed, reason: eligibility.reason }, bootstrap_required: false };
  if (!scope.warehouse || scope.product.quan_ly_theo_lo && !scope.lot) return result;
  const snapshot = await stock.ensureQuyCachStock({ ...params, cua_hang_id: scope.storeId, kho_id: scope.khoId,
    hang_hoa_id: scope.productId, lo_hang_id: scope.lotId, read_only: true, session });
  const maps = await availability.getReservedQuantitiesForSale({ kho_id: scope.khoId, hang_hoa_ids: [scope.productId], session });
  result.quy_cach = snapshot.rows.map(row => ({ ...plain(row), ten_quy_cach: rowName(row),
    so_luong_dang_dat: roundQty(reservedFor(maps, scope, row)),
    so_luong_kha_dung: Math.max(0, roundQty(Number(row.so_luong || 0) - reservedFor(maps, scope, row))) }));
  result.options = await catalogOptions(scope, snapshot.rows, session, eligibility.line);
  result.bootstrap_required = Boolean(snapshot.bootstrap_required);
  return result;
}

function parseTransfer(params) {
  const source = params.nguon || params.source || {};
  const destinationInput = params.dich || params.destinations;
  const destinations = typeof destinationInput === 'string' ? (() => { try { return JSON.parse(destinationInput); } catch (_) { throw error('Danh sách phân loại đích không hợp lệ.'); } })() : destinationInput;
  if (!Array.isArray(destinations) || !destinations.length || destinations.length > 100) throw error('Vui lòng nhập từ 1 đến 100 phân loại đích.');
  const parsed = { nguon: { ten_quy_cach: name(source.ten_quy_cach), gia_tri_thuoc_tinh_id: oid(source.gia_tri_thuoc_tinh_id, 'Thuộc tính nguồn', true) }, dich: [] };
  const names = new Set([parsed.nguon.ten_quy_cach]);
  for (const row of destinations) {
    const targetName = name(row.ten_quy_cach);
    if (names.has(targetName)) throw error('Phân loại đích không được trùng nhau hoặc trùng phân loại nguồn.');
    names.add(targetName);
    parsed.dich.push({ ten_quy_cach: targetName, gia_tri_thuoc_tinh_id: oid(row.gia_tri_thuoc_tinh_id, 'Thuộc tính đích', true), so_luong: quantity(row.so_luong) });
  }
  parsed.total = roundQty(parsed.dich.reduce((sum, row) => sum + row.so_luong, 0));
  if (!Number.isSafeInteger(Math.round(parsed.total * SCALE)) || parsed.total <= 0) throw error('Tổng số lượng chuyển không hợp lệ.');
  const stated = params.tong_so_luong_chuyen ?? source.so_luong;
  if (stated != null && Math.abs(quantity(stated) - parsed.total) >= EPSILON) throw error('Tổng số lượng chuyển vào các phân loại đích phải bằng số lượng giảm ở phân loại nguồn.');
  return parsed;
}
function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function requestIdentity(params, transfer) {
  return createHash('sha256').update(stableJson({ kho_id: ref(params.kho_id), hang_hoa_id: ref(params.hang_hoa_id),
    lo_hang_id: ref(params.lo_hang_id), nguon_thao_tac: params.nguon_thao_tac || 'ton_kho',
    phieu_nhap_id: ref(params.phieu_nhap_id), ct_phieu_nhap_id: ref(params.ct_phieu_nhap_id),
    nguon: transfer.nguon, dich: transfer.dich.slice().sort((a, b) => a.ten_quy_cach.localeCompare(b.ten_quy_cach)), ghi_chu: String(params.ghi_chu || '').trim() })).digest('hex');
}
async function validateWarehouseClassification(params, session, snapshot, transfer) {
  const scope = await loadScope(params, session);
  snapshot = snapshot || await stock.ensureQuyCachStock({ ...params, read_only: true, session });
  transfer = transfer || parseTransfer(params);
  const source = snapshot.rows.find(row => rowName(row) === transfer.nguon.ten_quy_cach);
  if (!source) throw error('Không tìm thấy tồn của phân loại nguồn.');
  const options = await catalogOptions(scope, snapshot.rows, session);
  for (const row of [transfer.nguon, ...transfer.dich]) {
    if (row.gia_tri_thuoc_tinh_id && !options.some(option => option.ten_quy_cach === row.ten_quy_cach && sameScope(option.gia_tri_thuoc_tinh_id, row.gia_tri_thuoc_tinh_id))) {
      throw error('Thuộc tính không khớp phân loại của hàng hóa.');
    }
  }
  const maps = await availability.getReservedQuantitiesForSale({ kho_id: scope.khoId, hang_hoa_ids: [scope.productId], session });
  const reserved = reservedFor(maps, scope, source);
  if (roundQty(Number(source.so_luong || 0) - reserved - transfer.total) < 0) {
    throw error('Số lượng chuyển vượt tồn khả dụng của phân loại nguồn (đã trừ lượng khách đang đặt/chưa giao).', 409);
  }
  return { scope, source, reserved, snapshot, transfer };
}
async function validatePurchaseSourceQuantity(eligibility, transfer, session) {
  const line = eligibility.line;
  const sourceMap = new Map();
  const initial = (line.lot_info && line.lot_info.quy_cach_items) || [];
  if (initial.length) initial.forEach(row => sourceMap.set(rowName(row), roundQty((sourceMap.get(rowName(row)) || 0) + Number(row.so_luong || 0))));
  else sourceMap.set(rowName(line), Number(line.so_luong || 0));
  const histories = await scoped(models.LichSuPhanLoai.find({ cua_hang_id: eligibility.scope.storeId,
    ct_phieu_nhap_id: line._id }), session).lean();
  histories.forEach(history => (history.chi_tiet || []).forEach(row => sourceMap.set(rowName(row), roundQty((sourceMap.get(rowName(row)) || 0) + Number(row.so_luong_thay_doi || 0)))));
  if ((sourceMap.get(transfer.nguon.ten_quy_cach) || 0) + EPSILON / 10 < transfer.total) {
    throw error('Số lượng thuộc phân loại nguồn còn truy vết được từ dòng PN không đủ. Vui lòng sử dụng Phân loại tại kho.', 409);
  }
}

async function classifyStock(params = {}, options = {}) {
  const transfer = parseTransfer(params);
  const storeId = oid(params.cua_hang_id, 'Cửa hàng');
  const userId = oid(params.nguoi_thuc_hien_id, 'Người thực hiện');
  const requestKey = String(params.request_key || '').trim();
  if (!requestKey || requestKey.length > 120 || /[\u0000-\u001f\u007f]/.test(requestKey)) throw error('Thiếu hoặc sai mã yêu cầu phân loại.');
  if (!['ton_kho', 'phieu_nhap'].includes(params.nguon_thao_tac || 'ton_kho')) throw error('Nguồn thao tác phân loại không hợp lệ.');
  if (String(params.ghi_chu || '').trim().length > 2000) throw error('Ghi chú không được vượt quá 2.000 ký tự.');
  const digest = requestIdentity(params, transfer);
  async function operation(session) {
    // Serializes both request replay and stock writers. Lock precedes reads so
    // a transaction retry observes the latest quantity and reservation snapshot.
    await models.Counter.updateOne({ _id: 'classification:' + storeId }, { $inc: { seq: 1 } }, { upsert: true, session });
    const existing = await scoped(models.LichSuPhanLoai.findOne({ cua_hang_id: storeId, request_key: requestKey }), session).lean();
    if (existing) {
      if (existing.request_digest !== digest) throw error('Mã yêu cầu đã dùng cho nội dung phân loại khác. Hãy tạo thao tác mới.', 409);
      return { ...existing, replayed: true };
    }
    const scope = await loadScope(params, session);
    await stock.lockStockScope({ ...params, cua_hang_id: storeId, session });
    const snapshot = await stock.ensureQuyCachStock({ ...params, cua_hang_id: storeId, session });
    let eligibility = null;
    if (params.nguon_thao_tac === 'phieu_nhap') {
      eligibility = await validatePurchaseClassification(params, session);
      if (!eligibility.allowed) throw error(eligibility.reason, 409);
      await validatePurchaseSourceQuantity(eligibility, transfer, session);
    }
    const checked = await validateWarehouseClassification(params, session, snapshot, transfer);
    const source = checked.source;
    const sourceBefore = Number(source.so_luong || 0);
    const cost = Number(source.gia_von ?? source.don_gia_nhap);
    if (!Number.isFinite(cost) || cost < 0) throw error('Giá vốn của phân loại nguồn chưa đủ căn cứ đối soát.');
    const beforeTotal = roundQty(snapshot.rows.reduce((sum, row) => sum + Number(row.so_luong || 0), 0));
    const beforeValue = snapshot.rows.reduce((sum, row) => sum + Number(row.so_luong || 0) * Number(row.gia_von ?? row.don_gia_nhap ?? 0), 0);
    if (!Number.isFinite(beforeValue) || beforeValue < 0) throw error('Giá trị vốn tồn hiện tại không hợp lệ để phân loại.');
    const sourceAfter = roundQty(sourceBefore - transfer.total);
    const sourceUpdate = await models.TonKhoLoQuyCach.updateOne({ _id: source._id, so_luong: sourceBefore },
      { $set: { ten_quy_cach: rowName(source), ten_thuoc_tinh: rowName(source), so_luong: sourceAfter, thanh_tien: sourceAfter * cost } }, { session });
    if (Number(sourceUpdate.matchedCount ?? sourceUpdate.n ?? 0) !== 1) throw error('Tồn nguồn vừa thay đổi. Vui lòng tải lại và thử lại.', 409);
    const details = [{ ten_quy_cach: rowName(source), gia_tri_thuoc_tinh_id: source.gia_tri_thuoc_tinh_id || transfer.nguon.gia_tri_thuoc_tinh_id,
      so_luong_truoc: sourceBefore, so_luong_thay_doi: -transfer.total, so_luong_sau: sourceAfter, gia_von: cost,
      gia_von_truoc: cost, gia_von_sau: cost, loai_dong: 'nguon' }];
    for (const destination of transfer.dich) {
      const current = snapshot.rows.find(row => rowName(row) === destination.ten_quy_cach);
      const before = Number(current && current.so_luong || 0);
      const previousCost = Number(current && (current.gia_von ?? current.don_gia_nhap) || 0);
      if (!Number.isFinite(previousCost) || previousCost < 0 || before < 0) throw error('Tồn hoặc giá vốn của phân loại đích không thể đối soát.');
      const after = roundQty(before + destination.so_luong);
      const nextCost = (before * previousCost + destination.so_luong * cost) / after;
      if (!Number.isFinite(nextCost) || nextCost < 0) throw error('Giá trị vốn của phân loại đích không hợp lệ.');
      const attrId = current && current.gia_tri_thuoc_tinh_id || destination.gia_tri_thuoc_tinh_id;
      await models.TonKhoLoQuyCach.findOneAndUpdate(current && current._id ? { _id: current._id } : { kho_id: scope.khoId, hang_hoa_id: scope.productId,
        lo_hang_id: scope.lotId || null, ten_quy_cach: destination.ten_quy_cach }, {
        $setOnInsert: { cua_hang_id: storeId, kho_id: scope.khoId, hang_hoa_id: scope.productId,
          lo_hang_id: scope.lotId || null, ten_quy_cach: destination.ten_quy_cach },
        $set: { ten_thuoc_tinh: destination.ten_quy_cach, gia_tri_thuoc_tinh_id: attrId || null,
          so_luong: after, gia_von: nextCost, don_gia_nhap: nextCost, thanh_tien: before * previousCost + destination.so_luong * cost }
      }, { upsert: true, new: true, session, setDefaultsOnInsert: true });
      details.push({ ten_quy_cach: destination.ten_quy_cach, gia_tri_thuoc_tinh_id: attrId || null,
        so_luong_truoc: before, so_luong_thay_doi: destination.so_luong, so_luong_sau: after,
        gia_von: cost, gia_von_truoc: previousCost, gia_von_sau: nextCost, loai_dong: 'dich' });
    }
    const afterRows = await scoped(models.TonKhoLoQuyCach.find({ kho_id: scope.khoId, hang_hoa_id: scope.productId, lo_hang_id: scope.lotId || null }), session).lean();
    const afterTotal = roundQty(afterRows.reduce((sum, row) => sum + Number(row.so_luong || 0), 0));
    const afterValue = afterRows.reduce((sum, row) => sum + Number(row.so_luong || 0) * Number(row.gia_von ?? row.don_gia_nhap ?? 0), 0);
    if (!Number.isFinite(afterValue) || afterTotal !== beforeTotal || Math.abs(afterValue - beforeValue) > Math.max(0.000001, Math.abs(beforeValue) * 1e-12)) {
      throw error('Không thể bảo toàn số lượng hoặc giá trị vốn khi phân loại.');
    }
    const synced = await stock.syncTonKhoSauQuyCach(scope.khoId, scope.productId, scope.lotId || null, scope.warehouse, cost, { session });
    if (scope.lotId && Math.abs(Number(synced.lotTotal) - beforeTotal) >= EPSILON ||
        Math.abs(Number(synced.productTotal) - Number(snapshot.inventory.so_luong)) >= EPSILON) throw error('Tổng tồn không khớp sau khi phân loại.');
    let sourcePurchase = eligibility && eligibility.purchase._id || null;
    let sourceLine = eligibility && eligibility.line._id || null;
    if (!eligibility && scope.lot && scope.lot.phieu_nhap_id && scope.lot.ct_phieu_nhap_id) {
      const known = await scoped(models.CTPhieuNhap.findOne({ _id: scope.lot.ct_phieu_nhap_id,
        phieu_nhap_id: scope.lot.phieu_nhap_id, hang_hoa_id: scope.productId }), session).lean();
      const knownPurchase = known && await scoped(models.PhieuNhap.findOne({ _id: scope.lot.phieu_nhap_id,
        cua_hang_id: storeId, kho_id: scope.khoId }), session).lean();
      if (knownPurchase) { sourcePurchase = knownPurchase._id; sourceLine = known._id; }
    }
    // Allocate only for a new voucher; a replay keeps its code and a failed
    // transaction rolls the sequence back together with stock and audit rows.
    const counter = await models.Counter.findOneAndUpdate({ _id: 'classification-code:' + storeId },
      { $inc: { seq: 1 } }, { upsert: true, new: true, session }).lean();
    if (!counter || !Number.isSafeInteger(counter.seq) || counter.seq < 1) throw error('Không thể cấp mã phân loại hợp lệ.', 409);
    const classificationCode = 'PL' + String(counter.seq).padStart(5, '0');
    const now = new Date();
    const historyRows = await models.LichSuPhanLoai.create([{ cua_hang_id: storeId, ma_phan_loai: classificationCode, kho_id: scope.khoId,
      hang_hoa_id: scope.productId, lo_hang_id: scope.lotId || null, nguon_thao_tac: params.nguon_thao_tac || 'ton_kho',
      phieu_nhap_id: sourcePurchase, ct_phieu_nhap_id: sourceLine, chi_tiet: details, tong_so_luong_chuyen: transfer.total,
      nguoi_thuc_hien_id: userId, ngay_thuc_hien: now, ghi_chu: String(params.ghi_chu || '').trim(), request_key: requestKey, request_digest: digest }], { session });
    const history = historyRows[0];
    // Mongoose requires sequential saves for multiple documents in a transaction.
    await models.LichSuKho.create(details.map(row => ({ cua_hang_id: storeId, kho_id: scope.khoId,
      hang_hoa_id: scope.productId, lo_hang_id: scope.lotId || null, gia_tri_thuoc_tinh_id: row.gia_tri_thuoc_tinh_id,
      nguoi_tao_id: userId, loai_phieu: 'phan_loai', ma_phieu: history.ma_phan_loai, cap_ton: 'quy_cach',
      ten_quy_cach: row.ten_quy_cach, so_luong_thay_doi: row.so_luong_thay_doi,
      ton_kho_truoc: row.so_luong_truoc, ton_kho_sau: row.so_luong_sau,
      gia_tri_thay_doi: row.so_luong_thay_doi * cost, ghi_chu: String(params.ghi_chu || '').trim(), ngay: now })), { session, ordered: true });
    return plain(history);
  }
  if (options.session) return operation(options.session);
  const session = await mongoose.startSession();
  try { let result; await session.withTransaction(async () => { result = await operation(session); }); return result; }
  finally { await session.endSession(); }
}

function historyQuery(params) {
  const query = { cua_hang_id: oid(params.cua_hang_id, 'Cửa hàng') };
  for (const key of ['hang_hoa_id', 'kho_id', 'phieu_nhap_id', 'ct_phieu_nhap_id']) if (params[key]) query[key] = oid(params[key], key);
  if (Object.prototype.hasOwnProperty.call(params, 'lo_hang_id')) query.lo_hang_id = oid(params.lo_hang_id, 'Lô hàng', true);
  const range = {};
  for (const [key, operator] of [['tu_ngay', '$gte'], ['den_ngay', '$lte']]) if (params[key]) {
    const raw = String(params[key]).trim();
    // Day filters use the application's Asia/Bangkok calendar, independently
    // of the server timezone. Timestamp filters retain their explicit offset.
    const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
    const parsed = new Date(dayOnly ? raw + (operator === '$gte' ? 'T00:00:00.000+07:00' : 'T23:59:59.999+07:00') : raw);
    if (!Number.isFinite(parsed.getTime())) throw error('Khoảng ngày lịch sử phân loại không hợp lệ.');
    if (dayOnly && new Date(raw + 'T00:00:00.000Z').toISOString().slice(0, 10) !== raw) throw error('Khoảng ngày lịch sử phân loại không hợp lệ.');
    range[operator] = parsed;
  }
  if (range.$gte && range.$lte && range.$gte > range.$lte) throw error('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
  if (Object.keys(range).length) query.ngay_thuc_hien = range;
  return query;
}
function enrichHistoryQuery(query, storeId) {
  return query.populate({ path: 'kho_id', select: 'ten_kho ma_kho', match: { cua_hang_id: storeId } })
    .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo', match: { cua_hang_id: storeId } })
    .populate({ path: 'phieu_nhap_id', select: 'ma_phieu_nhap', match: { cua_hang_id: storeId } })
    .populate({ path: 'nguoi_thuc_hien_id', select: 'ho_ten ten_nguoi_dung ten_dang_nhap' });
}
async function listClassificationHistory(params = {}) {
  const query = historyQuery(params);
  const requestedPage = Number(params.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit = Math.min(100, Math.max(1, Math.floor(Number(params.limit) || 20)));
  const total = await models.LichSuPhanLoai.countDocuments(query);
  const items = await enrichHistoryQuery(models.LichSuPhanLoai.find(query).sort({ ngay_thuc_hien: -1, _id: -1 })
    .skip((page - 1) * limit).limit(limit), query.cua_hang_id).lean();
  return { items, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
async function getClassificationHistoryDetail(params = {}) {
  const storeId = oid(params.cua_hang_id, 'Cửa hàng');
  const id = oid(params.id, 'Lịch sử phân loại');
  const doc = await enrichHistoryQuery(models.LichSuPhanLoai.findOne({ _id: id, cua_hang_id: storeId }), storeId).lean();
  if (!doc) throw error('Không tìm thấy lịch sử phân loại trong cửa hàng hiện tại.', 404);
  return doc;
}

module.exports = { getClassificationContext, validatePurchaseClassification, validateWarehouseClassification,
  classifyStock, listClassificationHistory, getClassificationHistoryDetail, UNCLASSIFIED };
