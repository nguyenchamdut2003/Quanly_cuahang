const { PhieuTraHangNhap, PhieuTraHangTongHop } = require('../models/kiot.model');

function refId(value) { return String(value && value._id || value || ''); }
function money(value) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, number) : 0; }
function activeData(row) { return row && row.trang_thai_du_lieu !== 'inactive' && !row.deleted_at; }
function effective(row) { return activeData(row) && row.trang_thai !== 'cancelled'; }
function discountVnd(row) {
  const total = money(row.tong_tien_hang ?? row.tong_tien_tra);
  if (row.tong_tien_hang != null && row.tong_tien_tra != null) return Math.max(0, total - money(row.tong_tien_tra));
  return Math.min(total, row.kieu_giam_gia === 'percent' ? Math.floor(total * Math.min(100, money(row.giam_gia)) / 100) : money(row.giam_gia));
}
function payable(row) { return money(row.ncc_can_tra ?? row.tong_tien_tra); }
function actualPaid(row) { return row.record_type !== 'group' && row.trang_thai === 'draft' ? 0 : money(row.ncc_da_tra); }
function remaining(row) {
  if (row.record_type !== 'group' && row.trang_thai === 'draft') return payable(row);
  return row.ncc_con_phai_tra != null ? money(row.ncc_con_phai_tra) : Math.max(0, payable(row) - actualPaid(row));
}
function normalizeDraftSource(row) {
  return row.trang_thai === 'draft' ? Object.assign({}, row, {
    ncc_hoan_du_kien: money(row.ncc_hoan_du_kien ?? row.ncc_da_tra),
    ncc_da_tra: 0,
    ncc_con_phai_tra: payable(row)
  }) : row;
}
function summarizeReturnSources(children) {
  return children.filter(effective).reduce((totals, row) => {
    totals.tong_tien_hang += money(row.tong_tien_hang ?? row.tong_tien_tra);
    totals.tong_tien_tra += money(row.tong_tien_tra);
    totals.giam_gia += discountVnd(row);
    totals.ncc_can_tra += payable(row);
    totals.ncc_da_tra += actualPaid(row);
    totals.ncc_con_phai_tra += remaining(row);
    totals.gia_tri_can_tru_cong_no += money(row.gia_tri_can_tru_cong_no);
    return totals;
  }, { tong_tien_hang: 0, tong_tien_tra: 0, giam_gia: 0, ncc_can_tra: 0, ncc_da_tra: 0, ncc_con_phai_tra: 0, gia_tri_can_tru_cong_no: 0 });
}

// Management projection only. Stock, debt and financial reports still use THN.
function buildReturnManagementList(sources, groups, filter = {}) {
  const childrenByGroup = new Map();
  const groupById = new Map((groups || []).map(group => [refId(group._id), group]));
  const visibleSources = (sources || []).filter(activeData).map(normalizeDraftSource).map(source => {
    const group = groupById.get(refId(source.phieu_tra_tong_hop_id));
    return Object.assign({}, source, group ? {
      ma_phieu_tra_tong_hop: group.ma_phieu_tra_tong_hop,
      phieu_nhap_tong_hop_id: group.phieu_nhap_tong_hop_id
    } : {});
  });
  visibleSources.forEach(source => {
    const key = refId(source.phieu_tra_tong_hop_id);
    if (!key || !groupById.has(key)) return;
    if (!childrenByGroup.has(key)) childrenByGroup.set(key, []);
    childrenByGroup.get(key).push(source);
  });
  const mode = ['sources', 'groups'].includes(filter.view_mode) ? filter.view_mode : '';
  let items = mode === 'groups' ? [] : visibleSources.filter(source => mode === 'sources' || !childrenByGroup.has(refId(source.phieu_tra_tong_hop_id)))
    .map(source => Object.assign({}, source, { record_type: 'source' }));
  if (mode !== 'sources') childrenByGroup.forEach((children, key) => {
    const group = groupById.get(key);
    const valid = children.filter(effective);
    items.push(Object.assign({}, group, summarizeReturnSources(children), {
      record_type: 'group', children, kieu_giam_gia: 'vnd',
      ma_phieu_tra_nhap: group.ma_phieu_tra_tong_hop,
      group_trang_thai: group.trang_thai,
      trang_thai: !valid.length ? 'cancelled' : (valid.every(row => row.trang_thai === 'completed') ? 'completed' : 'draft'),
      nha_cung_cap_id: group.nha_cung_cap_id || children[0].nha_cung_cap_id,
      kho_id: group.kho_id || children[0].kho_id
    }));
  });
  const statuses = (Array.isArray(filter.trang_thai) ? filter.trang_thai : [filter.trang_thai]).filter(Boolean);
  const keyword = String(filter.q || '').trim().toLocaleLowerCase('vi');
  const now = filter.now ? new Date(filter.now) : new Date();
  const from = filter.time_type === 'this_month' ? new Date(now.getFullYear(), now.getMonth(), 1) : (filter.date_from ? new Date(filter.date_from + 'T00:00:00') : null);
  const to = filter.time_type === 'this_month' ? new Date(now) : (filter.date_to ? new Date(filter.date_to + 'T23:59:59.999') : null);
  if (to && filter.time_type === 'this_month') to.setHours(23, 59, 59, 999);
  items = items.filter(row => {
    const children = row.children || [row];
    const time = new Date(row.ngay_tra || row.created_at || 0).getTime();
    const codes = [row.ma_phieu_tra_nhap, row.ma_phieu_tra_tong_hop].concat(children.flatMap(child => [child.ma_phieu_tra_nhap, child.phieu_nhap_id && child.phieu_nhap_id.ma_phieu_nhap]));
    return (!keyword || codes.some(code => String(code || '').toLocaleLowerCase('vi').includes(keyword)))
      && (!statuses.length || children.some(child => statuses.includes(child.trang_thai)))
      && (!filter.nguoi_tao || refId(row.nguoi_tao_id) === String(filter.nguoi_tao))
      && (!filter.nguoi_tra || children.some(child => refId(child.nguoi_tra_id) === String(filter.nguoi_tra)))
      && (!from || !Number.isFinite(from.getTime()) || time >= from.getTime())
      && (!to || !Number.isFinite(to.getTime()) || time <= to.getTime());
  });
  items.sort((a, b) => {
    const dateDelta = (new Date(b.ngay_tra || b.created_at || 0).getTime() || 0) - (new Date(a.ngay_tra || a.created_at || 0).getTime() || 0);
    const tie = refId(b._id).localeCompare(refId(a._id));
    if (filter.sort === 'oldest') return -dateDelta || tie;
    if (filter.sort === 'amount_high') return money(b.tong_tien_tra) - money(a.tong_tien_tra) || dateDelta || tie;
    return dateDelta || tie;
  });
  return { items, summaryTotals: summarizeReturnSources(items) };
}

const TOTAL_FIELDS = ['tong_tien_hang', 'tong_tien_tra', 'giam_gia', 'ncc_can_tra', 'ncc_da_tra', 'ncc_con_phai_tra', 'gia_tri_can_tru_cong_no'];
function castId(value) {
  const field = PhieuTraHangNhap.schema && PhieuTraHangNhap.schema.path('cua_hang_id');
  return field && value != null ? field.cast(value) : value;
}
function castSourceFilter(value, key) {
  if (Array.isArray(value)) return value.map(item => castSourceFilter(item, key));
  if (value && typeof value === 'object' && !value._bsontype && !(value instanceof Date) && !(value instanceof RegExp)) {
    return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, castSourceFilter(item, field.startsWith('$') ? key : field)]));
  }
  return key && (key === '_id' || key.endsWith('_id')) && value != null ? castId(value) : value;
}
function nonnegativeExpr(value) { return { $max: [0, { $ifNull: [value, 0] }] }; }
function returnListScope(storeId, sourceFilter) {
  if (!storeId) throw Object.assign(new Error('Chưa chọn cửa hàng làm việc hợp lệ.'), { statusCode: 403 });
  return { $and: [castSourceFilter(sourceFilter || {}), {
    cua_hang_id: castId(storeId), trang_thai_du_lieu: { $ne: 'inactive' }, deleted_at: null
  }] };
}
function buildReturnListPipeline(storeId, filter = {}, sourceFilter) {
  const mode = ['sources', 'groups'].includes(filter.view_mode) ? filter.view_mode : '';
  const keyword = String(filter.q || '').trim();
  const statuses = (Array.isArray(filter.trang_thai) ? filter.trang_thai : [filter.trang_thai]).filter(Boolean);
  const pipeline = [
    { $match: returnListScope(storeId, sourceFilter) },
    { $lookup: {
      from: PhieuTraHangTongHop.collection && PhieuTraHangTongHop.collection.name || 'phieu_tra_hang_nhap_tong_hop',
      let: { groupId: '$phieu_tra_tong_hop_id', storeId: '$cua_hang_id' },
      pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$_id', '$$groupId'] }, { $eq: ['$cua_hang_id', '$$storeId'] }] } } }],
      as: '_returnGroups'
    } },
    { $set: { _returnGroup: { $arrayElemAt: ['$_returnGroups', 0] } } }
  ];
  if (keyword) pipeline.push({ $lookup: {
    from: 'phieu_nhap', let: { purchaseId: '$phieu_nhap_id', storeId: '$cua_hang_id' },
    pipeline: [
      { $match: { $expr: { $and: [{ $eq: ['$_id', '$$purchaseId'] }, { $eq: ['$cua_hang_id', '$$storeId'] }] } } },
      { $project: { ma_phieu_nhap: 1 } }
    ], as: '_purchase'
  } });
  const isGroup = mode === 'sources' ? false : { $ne: [{ $ifNull: ['$_returnGroup._id', null] }, null] };
  if (mode === 'groups') pipeline.push({ $match: { '_returnGroup._id': { $ne: null } } });
  const regex = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const codeMatches = path => ({ $regexMatch: { input: { $ifNull: [path, ''] }, regex, options: 'i' } });
  pipeline.push({ $set: {
    _isGroup: isGroup,
    _effective: { $ne: ['$trang_thai', 'cancelled'] },
    _payable: nonnegativeExpr({ $ifNull: ['$ncc_can_tra', '$tong_tien_tra'] }),
    _gross: nonnegativeExpr({ $ifNull: ['$tong_tien_hang', '$tong_tien_tra'] }),
    _actualPaid: { $cond: [{ $eq: ['$trang_thai', 'draft'] }, 0, nonnegativeExpr('$ncc_da_tra')] },
    _keywordMatch: !keyword || { $or: [codeMatches('$ma_phieu_tra_nhap'), codeMatches('$_returnGroup.ma_phieu_tra_tong_hop'), codeMatches({ $arrayElemAt: ['$_purchase.ma_phieu_nhap', 0] })] },
    _statusMatch: !statuses.length || { $in: ['$trang_thai', statuses] },
    _returnerMatch: !filter.nguoi_tra || { $eq: ['$nguoi_tra_id', castId(filter.nguoi_tra)] }
  } });
  pipeline.push({ $set: {
    _remaining: { $cond: [{ $eq: ['$trang_thai', 'draft'] }, '$_payable',
      { $cond: [{ $ne: [{ $ifNull: ['$ncc_con_phai_tra', null] }, null] }, nonnegativeExpr('$ncc_con_phai_tra'),
        { $max: [0, { $subtract: ['$_payable', '$_actualPaid'] }] }] }] },
    _discount: { $cond: [{ $and: [{ $ne: [{ $ifNull: ['$tong_tien_hang', null] }, null] }, { $ne: [{ $ifNull: ['$tong_tien_tra', null] }, null] }] },
      { $max: [0, { $subtract: ['$_gross', nonnegativeExpr('$tong_tien_tra')] }] },
      { $min: ['$_gross', { $cond: [{ $eq: ['$kieu_giam_gia', 'percent'] },
        { $floor: { $divide: [{ $multiply: ['$_gross', { $min: [100, nonnegativeExpr('$giam_gia')] }] }, 100] } }, nonnegativeExpr('$giam_gia')] }] }] }
  } });
  const amounts = { tong_tien_hang: '$_gross', tong_tien_tra: nonnegativeExpr('$tong_tien_tra'), giam_gia: '$_discount',
    ncc_can_tra: '$_payable', ncc_da_tra: '$_actualPaid', ncc_con_phai_tra: '$_remaining', gia_tri_can_tru_cong_no: nonnegativeExpr('$gia_tri_can_tru_cong_no') };
  pipeline.push({ $group: {
    _id: { $cond: ['$_isGroup', '$_returnGroup._id', '$_id'] },
    _header: { $first: { $cond: ['$_isGroup', '$_returnGroup', '$$ROOT'] } },
    record_type: { $first: { $cond: ['$_isGroup', 'group', 'source'] } },
    _keywordMatch: { $max: '$_keywordMatch' }, _statusMatch: { $max: '$_statusMatch' }, _returnerMatch: { $max: '$_returnerMatch' },
    ...Object.fromEntries(TOTAL_FIELDS.map(field => [field, { $sum: { $cond: ['$_effective', amounts[field], 0] } }]))
  } });
  const match = { _keywordMatch: true, _statusMatch: true, _returnerMatch: true };
  if (filter.nguoi_tao) match['_header.nguoi_tao_id'] = castId(filter.nguoi_tao);
  const now = filter.now ? new Date(filter.now) : new Date();
  const from = filter.time_type === 'this_month' ? new Date(now.getFullYear(), now.getMonth(), 1) : (filter.date_from ? new Date(filter.date_from + 'T00:00:00') : null);
  const to = filter.time_type === 'this_month' ? new Date(now) : (filter.date_to ? new Date(filter.date_to + 'T23:59:59.999') : null);
  if (to && filter.time_type === 'this_month') to.setHours(23, 59, 59, 999);
  const range = {};
  if (from && Number.isFinite(from.getTime())) range.$gte = from;
  if (to && Number.isFinite(to.getTime())) range.$lte = to;
  if (Object.keys(range).length) match._time = range;
  pipeline.push({ $set: {
    _time: { $ifNull: ['$_header.ngay_tra', { $ifNull: ['$_header.created_at', new Date(0)] }] },
    // Cancelled sources retain their displayed amount/order while contributing
    // zero to financial totals; grouped amounts already exclude cancelled THNs.
    _sortAmount: { $cond: [{ $eq: ['$record_type', 'group'] }, '$tong_tien_tra', nonnegativeExpr('$_header.tong_tien_tra')] }
  } },
    { $match: match },
    { $project: { _id: 1, record_type: 1, _time: 1, _sortAmount: 1, ...Object.fromEntries(TOTAL_FIELDS.map(field => [field, 1])) } });
  return pipeline;
}
async function aggregateReturns(pipeline) {
  return PhieuTraHangNhap.aggregate(pipeline).allowDiskUse(true);
}
function populateReturnSources(query) {
  return query.setOptions({ strictQuery: false })
    .populate('nha_cung_cap_id', 'ma_ncc ten_ncc').populate('kho_id', 'ma_kho ten_kho')
    .populate('phieu_nhap_id', 'ma_phieu_nhap').populate('nguoi_tao_id', 'ho_ten email').populate('nguoi_tra_id', 'ho_ten email')
    .sort({ ngay_tra: -1, created_at: -1, _id: -1 }).lean();
}
async function loadReturnManagementList(storeId, filter = {}, sourceFilter, pagination) {
  const requestedPage = Math.max(1, Math.floor(Number(pagination && pagination.page) || 1));
  const pageSize = pagination ? Math.max(1, Math.min(100, Math.floor(Number(pagination.pageSize) || 10))) : 0;
  const pipeline = buildReturnListPipeline(storeId, filter, sourceFilter);
  const sort = filter.sort === 'amount_high' ? { _sortAmount: -1, _time: -1, _id: -1 }
    : { _time: filter.sort === 'oldest' ? 1 : -1, _id: -1 };
  const itemsPipeline = [{ $sort: sort }, { $project: { _id: 1, record_type: 1 } }];
  if (pageSize) itemsPipeline.push({ $skip: (requestedPage - 1) * pageSize }, { $limit: pageSize });
  const [result = {}] = await aggregateReturns(pipeline.concat({ $facet: {
    items: itemsPipeline,
    count: [{ $count: 'total' }],
    totals: [{ $group: { _id: null, ...Object.fromEntries(TOTAL_FIELDS.map(field => [field, { $sum: '$' + field }])) } }]
  } }));
  const total = Number(result.count && result.count[0] && result.count[0].total || 0);
  const totalPages = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const page = pageSize ? Math.min(requestedPage, totalPages) : 1;
  let selected = result.items || [];
  if (page !== requestedPage && total) selected = await aggregateReturns(pipeline.concat({ $sort: sort },
    { $skip: (page - 1) * pageSize }, { $limit: pageSize }, { $project: { _id: 1, record_type: 1 } }));
  const summaryTotals = Object.fromEntries(TOTAL_FIELDS.map(field => [field, Number(result.totals && result.totals[0] && result.totals[0][field] || 0)]));
  if (!selected.length) return { items: [], summaryTotals, total, page, pageSize, totalPages };
  const groupIds = selected.filter(row => row.record_type === 'group').map(row => row._id);
  const sourceIds = selected.filter(row => row.record_type === 'source').map(row => row._id);
  const sources = await populateReturnSources(PhieuTraHangNhap.find({ $and: [returnListScope(storeId, sourceFilter),
    { $or: [{ _id: { $in: sourceIds } }, { phieu_tra_tong_hop_id: { $in: groupIds } }] }] }));
  const hydrateGroupIds = [...new Set(groupIds.concat(sources.map(row => row.phieu_tra_tong_hop_id).filter(Boolean)).map(refId))];
  const groups = hydrateGroupIds.length ? await PhieuTraHangTongHop.find({ cua_hang_id: storeId, _id: { $in: hydrateGroupIds } })
    .populate('phieu_nhap_tong_hop_id', 'ma_phieu_tong_hop').populate('nguoi_tao_id', 'ho_ten email')
    .populate('nha_cung_cap_id', 'ma_ncc ten_ncc').populate('kho_id', 'ma_kho ten_kho').lean() : [];
  const projected = buildReturnManagementList(sources, groups, { view_mode: filter.view_mode }).items;
  const byId = new Map(projected.map(row => [refId(row._id), row]));
  return { items: selected.map(row => byId.get(refId(row._id))).filter(Boolean), summaryTotals, total, page, pageSize, totalPages };
}

module.exports = { buildReturnManagementList, loadReturnManagementList, buildReturnListPipeline, summarizeReturnSources, discountVnd, remaining };
