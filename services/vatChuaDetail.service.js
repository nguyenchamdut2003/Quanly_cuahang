const mongoose = require('mongoose');
const {
  VatChua,
  NhapVatChua,
  XuatVatChua,
  PhieuThuChi,
  PhieuNhap, PhieuNhapTongHop, PhieuTraHangNhap, PhieuTraHangTongHop,
  DonHang, HoaDonBanHang, PhieuTraHang
} = require('../models/kiot.model');
const { loadAverageCostByVatChuaIds } = require('./vatChuaImport.service');
const { buildNhapVatChuaReceiptFilter, loadNhapVatChuaReturnTotals } = require('./vatChuaPaymentTotals.service');

function cleanId(value) {
  const id = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(id) ? id : '';
}

const LOAI_DOI_TRA_HANG_LABEL = 'Đổi - Trả hàng';

const LOAI_NHAP_LABEL = {
  mua_moi: 'Mua mới',
  kem_phieu_nhap_hang: 'Kèm phiếu nhập hàng',
  khach_tra_lai: LOAI_DOI_TRA_HANG_LABEL,
  doi_tra_hang: LOAI_DOI_TRA_HANG_LABEL,
  dieu_chinh_tang: 'Điều chỉnh tăng',
  khac: 'Khác'
};

const LOAI_XUAT_LABEL = {
  ban_hang: 'Bán hàng',
  hoa_don: 'Hóa đơn',
  tra_hang_nhap: 'Trả hàng nhập',
  doi_tra_hang: LOAI_DOI_TRA_HANG_LABEL,
  su_dung_noi_bo: 'Sử dụng nội bộ',
  hong_mat: 'Hỏng/mất',
  dieu_chinh_giam: 'Điều chỉnh giảm',
  khac: 'Khác'
};

const SOURCE_TYPE_LABEL = {
  phieu_nhap: 'Phiếu nhập hàng',
  don_hang: 'Đơn hàng',
  hoa_don: 'Hóa đơn',
  tra_hang_ban: 'Trả hàng bán',
  phieu_tra_hang_nhap: 'Trả hàng nhập',
  xuat_noi_bo: 'Xuất dùng nội bộ',
  manual: 'Thủ công',
  khac: 'Khác'
};

function buildSourceHref(sourceType, sourceId, loaiXuat, sourceCode) {
  const id = cleanId(sourceId);
  if (!id) return '';
  if (sourceType === 'phieu_nhap') return '/nhap-hang?purchase=' + encodeURIComponent(id);
  if (sourceType === 'don_hang') return '/don-hang/' + id;
  if (sourceType === 'hoa_don') return '/don-hang/hoa-don/' + id;
  if (sourceType === 'phieu_tra_hang_nhap') {
    const qs = new URLSearchParams();
    const code = String(sourceCode || '').trim();
    if (code) qs.set('q', code);
    qs.set('openReturn', id);
    return '/tra-hang-nhap?' + qs.toString();
  }
  if (sourceType === 'tra_hang_ban') return '/don-hang/tra-hang?return=' + encodeURIComponent(id);
  if (sourceType === 'xuat_noi_bo' || loaiXuat === 'su_dung_noi_bo') {
    return '/xuat-dung-noi-bo?open=' + encodeURIComponent(id);
  }
  return '';
}

function resolveNhapLoaiLabel(row) {
  if (!row) return '---';
  if (row.source_type === 'tra_hang_ban' || row.loai_nhap === 'doi_tra_hang' || row.loai_nhap === 'khach_tra_lai') {
    return LOAI_DOI_TRA_HANG_LABEL;
  }
  return LOAI_NHAP_LABEL[row.loai_nhap] || row.loai_nhap || '---';
}

function resolveXuatLoaiLabel(row) {
  if (!row) return '---';
  if (row.source_type === 'tra_hang_ban' || row.loai_xuat === 'doi_tra_hang') {
    return LOAI_DOI_TRA_HANG_LABEL;
  }
  return LOAI_XUAT_LABEL[row.loai_xuat] || row.loai_xuat || '---';
}

function refId(value) { return String(value && value._id || value || ''); }
function money(value) { return Math.max(0, Number(value) || 0); }
function validReceipt(row) {
  return row && !row.deleted_at && row.trang_thai_du_lieu !== 'inactive'
    && !['cancelled', 'inactive'].includes(row.trang_thai);
}
function documentHref(kind, id) {
  return id ? '/vat-chua?' + (kind === 'xuat' ? 'xuat_vat_chua' : 'nhap_vat_chua') + '=' + encodeURIComponent(refId(id)) : '';
}
function transactionLine(line, doc) {
  const linked = ['phieu_nhap', 'phieu_tra_hang_nhap', 'don_hang', 'hoa_don', 'tra_hang_ban'].includes(doc.source_type);
  const qty = Math.abs(Number(line.so_luong || 0));
  const price = line.don_gia_giao_dich != null ? money(line.don_gia_giao_dich) : (linked ? 0 : money(line.gia_von));
  const total = line.don_gia_giao_dich != null ? Math.round(price * qty)
    : (linked ? 0 : money(line.thanh_tien != null ? line.thanh_tien : doc.tong_tien));
  return { don_gia_giao_dich: price, thanh_tien_giao_dich: total };
}
function receiptAmountForDocument(receipt, doc, kind, includeCancelled = false) {
  if (!receipt || !doc || (!includeCancelled && !validReceipt(receipt))) return 0;
  if (receipt.loai_phieu && receipt.loai_phieu !== (kind === 'xuat' ? 'thu' : 'chi')) return 0;
  if (receipt.deleted_at || receipt.trang_thai_du_lieu === 'inactive' || receipt.trang_thai === 'inactive') return 0;
  if (receipt.cua_hang_id && doc.cua_hang_id && refId(receipt.cua_hang_id) !== refId(doc.cua_hang_id)) return 0;
  const field = kind === 'xuat' ? 'xuat_vat_chua_id' : 'nhap_vat_chua_id';
  const allocations = Array.isArray(receipt.allocations) ? receipt.allocations : [];
  if (allocations.length) return allocations.reduce((sum, row) => sum + (refId(row[field]) === refId(doc._id) ? money(row.so_tien) : 0), 0);
  const linkedId = refId(receipt[field]);
  const code = doc.ma_nhap_vat_chua || doc.ma_xuat_vat_chua || '';
  return (linkedId ? linkedId === refId(doc._id) : Boolean(code && receipt.ma_chung_tu_goc === code)) ? money(receipt.gia_tri) : 0;
}
function buildVatChuaEditState(doc, receipts = []) {
  const line = doc && Array.isArray(doc.items) && doc.items[0];
  if (!line) return { vat_chua_id: '', so_luong: 0, don_gia_giao_dich: 0, thanh_tien_giao_dich: 0,
    ghi_nhan_thu_chi: false, vat_chua_thanh_toan: {}, has_cash_transactions: false, locked: false };
  const kind = doc.ma_xuat_vat_chua ? 'xuat' : 'nhap';
  const linked = receipts.filter(row => receiptAmountForDocument(row, doc, kind, true) > 0);
  const active = linked.filter(validReceipt);
  const detail = { tien_mat: 0, chuyen_khoan: 0, tien_tra_khach: 0 };
  active.forEach(row => {
    const payment = row.chi_tiet_thanh_toan || {};
    detail.tien_mat += money(payment.tien_mat);
    detail.chuyen_khoan += money(payment.chuyen_khoan);
    detail.so_quy_tien_mat_id = detail.so_quy_tien_mat_id || refId(payment.so_quy_tien_mat_id) || '';
    detail.so_quy_chuyen_khoan_id = detail.so_quy_chuyen_khoan_id || refId(payment.so_quy_chuyen_khoan_id) || '';
  });
  return { vat_chua_id: refId(line.vat_chua_id), so_luong: Number(line.so_luong || 0), ...transactionLine(line, doc),
    ghi_nhan_thu_chi: doc.ghi_nhan_thu_chi === true, vat_chua_thanh_toan: detail, chi_tiet_thanh_toan: detail,
    has_cash_transactions: linked.length > 0, locked: linked.length > 0,
    nhap_vat_chua_id: kind === 'nhap' ? refId(doc._id) : '', xuat_vat_chua_id: kind === 'xuat' ? refId(doc._id) : '' };
}
function mapMovement(row, kind, vatChuaId, receipts, returnedMap) {
  const lines = (row.items || []).filter(line => refId(line.vat_chua_id) === refId(vatChuaId));
  const first = lines[0] || {};
  const values = lines.map(line => transactionLine(line, row));
  const qty = lines.reduce((sum, line) => sum + Math.abs(Number(line.so_luong || 0)), 0) || Number(row.tong_so_luong || 0);
  const linkedReceipts = receipts.filter(receipt => receiptAmountForDocument(receipt, row, kind, true) > 0);
  const paid = linkedReceipts.reduce((sum, receipt) => sum + receiptAmountForDocument(receipt, row, kind), 0);
  const returned = money(returnedMap && returnedMap.get(refId(row._id)));
  const manual = !row.source_type || !['phieu_nhap', 'phieu_tra_hang_nhap', 'don_hang', 'hoa_don', 'tra_hang_ban'].includes(row.source_type);
  const tradeTotal = values.reduce((sum, value) => sum + value.thanh_tien_giao_dich, 0);
  const costTotal = lines.reduce((sum, line) => sum + money(line.thanh_tien), 0) || money(row.tong_tien);
  const samePrice = values.every(value => value.don_gia_giao_dich === (values[0] || {}).don_gia_giao_dich);
  const editState = buildVatChuaEditState(row, receipts);
  const sourceHref = row.source_type === 'manual' && row.source_id && row.loai_xuat === 'tra_hang_nhap'
    ? documentHref('nhap', row.source_id) : buildSourceHref(row.source_type, row.source_id, row.loai_xuat || row.loai_nhap, row.source_code);
  return {
    _id: row._id, doc_kind: kind, doc_kind_label: kind === 'nhap' ? 'Nhập' : 'Xuất',
    doc_href: documentHref(kind, row._id), ma_chung_tu: row.ma_nhap_vat_chua || row.ma_xuat_vat_chua || '---',
    loai: kind === 'nhap' ? row.loai_nhap : row.loai_xuat,
    loai_label: kind === 'nhap' ? resolveNhapLoaiLabel(row) : resolveXuatLoaiLabel(row),
    doi_tuong_ten: row.doi_tuong_ten || '---', doi_tuong_type: row.doi_tuong_type || '', doi_tuong_id: refId(row.doi_tuong_id),
    supplier_href: row.doi_tuong_type === 'nha_cung_cap' && row.doi_tuong_id ? '/nha-cung-cap?supplier=' + encodeURIComponent(refId(row.doi_tuong_id)) : '',
    partner_href: row.doi_tuong_id ? (row.doi_tuong_type === 'nha_cung_cap' ? '/nha-cung-cap?supplier=' : '/khach-hang?customer=') + encodeURIComponent(refId(row.doi_tuong_id)) : '',
    source_type: row.source_type || '', source_id: refId(row.source_id), source_type_label: SOURCE_TYPE_LABEL[row.source_type] || row.source_type || 'Thủ công',
    don_hang_id: refId(row.don_hang_id), hoa_don_id: refId(row.hoa_don_id),
    source_code: row.source_code || '', source_href: sourceHref, source_links: sourceHref ? [{ code: row.source_code || SOURCE_TYPE_LABEL[row.source_type] || 'Chứng từ nguồn', href: sourceHref }] : [],
    vat_chua_id: refId(first.vat_chua_id), ma_vat_chua: first.ma_vat_chua || '', ten_vat_chua: first.ten_vat_chua || '',
    so_luong: qty, so_luong_co_dau: kind === 'nhap' ? qty : -qty,
    gia_von: money(first.gia_von), thanh_tien: costTotal,
    don_gia_giao_dich: samePrice ? money((values[0] || {}).don_gia_giao_dich) : null,
    thanh_tien_giao_dich: tradeTotal, ghi_nhan_thu_chi: row.ghi_nhan_thu_chi === true,
    da_tra_ncc: paid, thuc_thu_chi: paid, returned_amount: returned,
    can_tra_ncc: kind === 'nhap' && manual ? Math.max(0, costTotal - paid - returned) : null,
    cash_documents: linkedReceipts.map(receipt => ({ _id: receipt._id, ma_phieu: receipt.ma_phieu || '---',
      loai_phieu: receipt.loai_phieu || (kind === 'nhap' ? 'chi' : 'thu'), trang_thai: receipt.trang_thai || 'paid',
      href: '/so-quy/phieu-thu-chi/' + encodeURIComponent(refId(receipt._id)) })),
    vat_chua_thanh_toan: editState.vat_chua_thanh_toan,
    chi_tiet_thanh_toan: editState.chi_tiet_thanh_toan,
    has_cash_transactions: editState.has_cash_transactions, locked: editState.locked,
    trang_thai: row.trang_thai || 'active', trang_thai_label: row.trang_thai === 'cancelled' ? 'Đã hủy' : 'Hợp lệ',
    created_at: row.created_at, ghi_chu: row.ghi_chu || ''
  };
}
async function findScopedRows(model, filter, select) {
  if (!model || typeof model.find !== 'function') return [];
  let query = model.find(filter);
  if (select) query = query.select(select);
  return query.lean();
}
async function attachSourceTraces(documents, store) {
  const idsFor = type => [...new Set(documents.filter(doc => doc.source_type === type).map(doc => doc.source_id).filter(Boolean))];
  const purchaseIds = idsFor('phieu_nhap'), returnIds = idsFor('phieu_tra_hang_nhap');
  const orderIds = [...new Set(idsFor('don_hang').concat(documents.map(doc => doc.don_hang_id).filter(Boolean)))];
  const invoiceIds = [...new Set(idsFor('hoa_don').concat(documents.map(doc => doc.hoa_don_id).filter(Boolean)))];
  const saleReturnIds = idsFor('tra_hang_ban');
  const scope = ids => ({ cua_hang_id: store, _id: { $in: ids } });
  const [purchases, returns, groups, orders, invoices, salesReturns] = await Promise.all([
    purchaseIds.length ? findScopedRows(PhieuNhap, scope(purchaseIds), 'ma_phieu_nhap nha_cung_cap_id') : [],
    returnIds.length ? findScopedRows(PhieuTraHangNhap, scope(returnIds), 'ma_phieu_tra_nhap phieu_tra_tong_hop_id nha_cung_cap_id') : [],
    purchaseIds.length ? findScopedRows(PhieuNhapTongHop, { cua_hang_id: store, phieu_nguon_ids: { $in: purchaseIds } }, 'ma_phieu_tong_hop phieu_nguon_ids trang_thai ngay_gop') : [],
    orderIds.length ? findScopedRows(DonHang, scope(orderIds), 'ma_don_hang') : [],
    invoiceIds.length || orderIds.length ? findScopedRows(HoaDonBanHang, { cua_hang_id: store, $or: [{ _id: { $in: invoiceIds } }, { don_hang_id: { $in: orderIds } }] }, 'ma_hoa_don don_hang_id') : [],
    saleReturnIds.length ? findScopedRows(PhieuTraHang, scope(saleReturnIds), 'ma_phieu_tra don_hang_id hoa_don_id') : []
  ]);
  const extraInvoiceIds = salesReturns.map(row => refId(row.hoa_don_id)).filter(value => value && !invoices.some(row => refId(row._id) === value));
  if (extraInvoiceIds.length) invoices.push(...await findScopedRows(HoaDonBanHang, scope(extraInvoiceIds), 'ma_hoa_don don_hang_id'));
  const extraOrderIds = [...new Set(invoices.map(row => refId(row.don_hang_id)).concat(salesReturns.map(row => refId(row.don_hang_id))).filter(value => value && !orders.some(row => refId(row._id) === value)))];
  const returnGroupIds = [...new Set(returns.map(row => refId(row.phieu_tra_tong_hop_id)).filter(Boolean))];
  const [extraOrders, returnGroups] = await Promise.all([
    extraOrderIds.length ? findScopedRows(DonHang, scope(extraOrderIds), 'ma_don_hang') : [],
    returnGroupIds.length ? findScopedRows(PhieuTraHangTongHop, scope(returnGroupIds), 'ma_phieu_tra_tong_hop trang_thai') : []
  ]);
  orders.push(...extraOrders);
  const byId = rows => new Map(rows.map(row => [refId(row._id), row]));
  const purchaseMap = byId(purchases), returnMap = byId(returns), orderMap = byId(orders), invoiceMap = byId(invoices), saleReturnMap = byId(salesReturns), returnGroupMap = byId(returnGroups);
  const purchaseGroups = new Map();
  groups.sort((a, b) => (a.trang_thai === 'active' ? -1 : 1) - (b.trang_thai === 'active' ? -1 : 1) || new Date(b.ngay_gop || 0) - new Date(a.ngay_gop || 0))
    .forEach(group => (group.phieu_nguon_ids || []).forEach(id => { if (!purchaseGroups.has(refId(id))) purchaseGroups.set(refId(id), group); }));
  documents.forEach(doc => {
    const addLink = (code, href) => { if (code && href && !doc.source_links.some(link => link.href === href)) doc.source_links.push({ code, href }); };
    if (doc.source_type === 'phieu_nhap') {
      const source = purchaseMap.get(doc.source_id), group = purchaseGroups.get(doc.source_id);
      if (source) doc.source_code = source.ma_phieu_nhap || doc.source_code;
      if (group) Object.assign(doc, { group_id: refId(group._id), group_code: group.ma_phieu_tong_hop, group_href: '/nhap-hang/tong-hop/' + encodeURIComponent(refId(group._id)), group_type: 'GPN' });
    } else if (doc.source_type === 'phieu_tra_hang_nhap') {
      const source = returnMap.get(doc.source_id), group = source && returnGroupMap.get(refId(source.phieu_tra_tong_hop_id));
      if (source) doc.source_code = source.ma_phieu_tra_nhap || doc.source_code;
      if (group) Object.assign(doc, { group_id: refId(group._id), group_code: group.ma_phieu_tra_tong_hop,
        group_href: '/tra-hang-nhap?q=' + encodeURIComponent(group.ma_phieu_tra_tong_hop || '') + '&openReturn=' + encodeURIComponent(refId(group._id)), group_type: 'THG' });
    }
    let order = orderMap.get(doc.don_hang_id), invoice = invoiceMap.get(doc.hoa_don_id), saleReturn;
    if (doc.source_type === 'don_hang') { order = orderMap.get(doc.source_id); if (order) doc.source_code = order.ma_don_hang || doc.source_code; }
    if (doc.source_type === 'hoa_don') { invoice = invoiceMap.get(doc.source_id); if (invoice) { doc.source_code = invoice.ma_hoa_don || doc.source_code; order = orderMap.get(refId(invoice.don_hang_id)); } }
    if (doc.source_type === 'tra_hang_ban') {
      saleReturn = saleReturnMap.get(doc.source_id);
      if (saleReturn) { doc.source_code = saleReturn.ma_phieu_tra || doc.source_code; invoice = invoiceMap.get(refId(saleReturn.hoa_don_id)); order = orderMap.get(refId(saleReturn.don_hang_id) || refId(invoice && invoice.don_hang_id)); }
    }
    if (order) {
      doc.sales_root_id = 'order:' + refId(order._id);
      addLink(order.ma_don_hang, buildSourceHref('don_hang', order._id));
      if (doc.source_type === 'don_hang' && !invoice) {
        const related = invoices.filter(row => refId(row.don_hang_id) === refId(order._id));
        if (related.length === 1) invoice = related[0];
      }
    } else if (invoice) doc.sales_root_id = 'invoice:' + refId(invoice._id);
    if (invoice) addLink(invoice.ma_hoa_don, buildSourceHref('hoa_don', invoice._id));
    doc.source_href = buildSourceHref(doc.source_type, doc.source_id, doc.loai, doc.source_code) || doc.source_href;
    if (doc.source_links.length) doc.source_links[0] = { code: doc.source_code || doc.source_links[0].code, href: doc.source_href || doc.source_links[0].href };
  });
  const comparisons = new Map();
  documents.filter(doc => doc.sales_root_id && doc.trang_thai !== 'cancelled').forEach(doc => {
    const total = comparisons.get(doc.sales_root_id) || { so_luong_da_xuat: 0, so_luong_da_nhan_lai: 0 };
    if (doc.doc_kind === 'xuat') total.so_luong_da_xuat += Math.abs(doc.so_luong);
    else if (doc.source_type === 'tra_hang_ban') total.so_luong_da_nhan_lai += Math.abs(doc.so_luong);
    comparisons.set(doc.sales_root_id, total);
  });
  documents.forEach(doc => { const totals = comparisons.get(doc.sales_root_id); if (totals) Object.assign(doc, totals, { chenh_lech: totals.so_luong_da_xuat - totals.so_luong_da_nhan_lai }); });
}
function mapCashDocuments(receipts, movements, rawById) {
  return receipts.map(row => {
    const linked = movements.filter(doc => receiptAmountForDocument(row, rawById.get(doc.doc_kind + ':' + refId(doc._id)), doc.doc_kind, true) > 0);
    if (!linked.length) return null;
    const labels = { tien_mat: 'Tiền mặt', chuyen_khoan: 'Chuyển khoản', vi_dien_tu: 'Ví điện tử', khac: 'Khác' };
    const payment = row.chi_tiet_thanh_toan || {};
    const amount = linked.reduce((sum, doc) => sum + receiptAmountForDocument(row, rawById.get(doc.doc_kind + ':' + refId(doc._id)), doc.doc_kind, true), 0);
    const receiptKind = row.loai_phieu || (linked[0].doc_kind === 'xuat' ? 'thu' : 'chi');
    return { _id: row._id, ma_phieu: row.ma_phieu || '---', loai_phieu: receiptKind,
      loai_phieu_label: receiptKind === 'thu' ? 'Thu' : 'Chi', loai_thu_chi_label: row.loai_thu_chi || '---',
      doi_tuong_ten: row.doi_tuong || linked[0].doi_tuong_ten || '---',
      linked_documents: linked.map(doc => ({ code: doc.ma_chung_tu, href: doc.doc_href })),
      source_documents: [...new Map(linked.flatMap(doc => doc.source_links).map(link => [link.href, link])).values()],
      linked_code: linked[0].ma_chung_tu, linked_href: linked[0].doc_href,
      gia_tri: money(row.gia_tri), gia_tri_lien_quan: amount,
      phuong_thuc: money(payment.tien_mat) > 0 && money(payment.chuyen_khoan) > 0 ? 'Tiền mặt + Chuyển khoản' : labels[row.phuong_thuc_thanh_toan] || '---',
      trang_thai: row.trang_thai || 'paid', trang_thai_label: row.trang_thai === 'cancelled' ? 'Đã hủy' : 'Đã thanh toán',
      is_valid: validReceipt(row), created_at: row.ngay_lap || row.created_at, ghi_chu: row.ghi_chu || '' };
  }).filter(Boolean);
}
async function loadVatChuaDetailContext(vatChuaId, storeId) {
  const id = cleanId(vatChuaId), store = cleanId(storeId);
  if (!id || !store) return null;
  const item = await VatChua.findOne({ _id: id, cua_hang_id: store }).lean();
  if (!item) return null;
  const avgMap = await loadAverageCostByVatChuaIds(store, [item._id]);
  item.gia_von_trung_binh = avgMap[refId(item._id)] || 0;
  const itemMatch = { cua_hang_id: store, 'items.vat_chua_id': new mongoose.Types.ObjectId(id), deleted_at: null, trang_thai_du_lieu: { $ne: 'inactive' } };
  const [nhapRows, xuatRows] = await Promise.all([
    NhapVatChua.find(itemMatch).sort({ created_at: -1 }).lean(), XuatVatChua.find(itemMatch).sort({ created_at: -1 }).lean()
  ]);
  const legacyFilter = buildNhapVatChuaReceiptFilter(nhapRows, store, { includeCancelled: true });
  const refs = (legacyFilter.$or || []).concat([
    { xuat_vat_chua_id: { $in: xuatRows.map(row => row._id) } },
    { 'allocations.xuat_vat_chua_id': { $in: xuatRows.map(row => row._id) } }
  ]);
  const exportCodes = xuatRows.map(row => row.ma_xuat_vat_chua).filter(Boolean);
  if (exportCodes.length) refs.push({ ma_chung_tu_goc: { $in: exportCodes } });
  const receiptRows = nhapRows.length || xuatRows.length ? await PhieuThuChi.find({
    cua_hang_id: store, deleted_at: null, trang_thai_du_lieu: { $ne: 'inactive' }, trang_thai: { $nin: ['inactive'] }, $or: refs
  }).setOptions({ strictQuery: false }).sort({ ngay_lap: -1, created_at: -1 }).lean() : [];
  const returnedMap = await loadNhapVatChuaReturnTotals(nhapRows, { storeId: store });
  const rawById = new Map();
  const documents = [];
  for (const [kind, rows] of [['nhap', nhapRows], ['xuat', xuatRows]]) for (const row of rows) {
    const key = kind + ':' + refId(row._id);
    if (rawById.has(key)) continue;
    rawById.set(key, row); documents.push(mapMovement(row, kind, id, receiptRows, returnedMap));
  }
  documents.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  await attachSourceTraces(documents, store);
  const manualDocuments = documents.filter(doc => !['phieu_nhap', 'phieu_tra_hang_nhap', 'don_hang', 'hoa_don', 'tra_hang_ban'].includes(doc.source_type));
  const purchaseDocuments = documents.filter(doc => ['phieu_nhap', 'phieu_tra_hang_nhap'].includes(doc.source_type));
  const salesDocuments = documents.filter(doc => ['don_hang', 'hoa_don', 'tra_hang_ban'].includes(doc.source_type));
  const cashDocuments = mapCashDocuments(receiptRows, documents, rawById);
  const cashTotals = cashDocuments.filter(doc => doc.is_valid).reduce((totals, doc) => {
    totals[doc.loai_phieu === 'thu' ? 'thu' : 'chi'] += doc.gia_tri_lien_quan;
    return totals;
  }, { thu: 0, chi: 0 });
  return { item, documents, manualDocuments, purchaseDocuments, salesDocuments, cashDocuments, cashTotals,
    chiDocuments: cashDocuments.filter(doc => doc.loai_phieu !== 'thu'),
    nhapCount: nhapRows.length, xuatCount: xuatRows.length, chiCount: cashDocuments.filter(doc => doc.loai_phieu !== 'thu').length,
    cashCount: cashDocuments.length };
}
async function loadVatChuaDocumentDetail(kind, docId, storeId) {
  const id = cleanId(docId), store = cleanId(storeId);
  if (!id || !store || !['nhap', 'xuat'].includes(kind)) return null;
  const model = kind === 'nhap' ? NhapVatChua : XuatVatChua;
  const doc = await model.findOne({ _id: id, cua_hang_id: store, deleted_at: null, trang_thai_du_lieu: { $ne: 'inactive' } }).lean();
  if (!doc) return null;
  const field = kind === 'nhap' ? 'nhap_vat_chua_id' : 'xuat_vat_chua_id';
  const receipts = await PhieuThuChi.find({ cua_hang_id: store, deleted_at: null, trang_thai_du_lieu: { $ne: 'inactive' },
    $or: [{ [field]: doc._id }, { ['allocations.' + field]: doc._id }, { ma_chung_tu_goc: doc.ma_nhap_vat_chua || doc.ma_xuat_vat_chua }] })
    .setOptions({ strictQuery: false }).sort({ ngay_lap: -1 }).lean();
  return { kind, kind_label: kind === 'nhap' ? 'Phiếu nhập vật chứa' : 'Phiếu xuất vật chứa',
    ma_chung_tu: doc.ma_nhap_vat_chua || doc.ma_xuat_vat_chua || '---',
    loai_label: kind === 'nhap' ? resolveNhapLoaiLabel(doc) : resolveXuatLoaiLabel(doc),
    doi_tuong_ten: doc.doi_tuong_ten || '---', source_type: doc.source_type || '', source_type_label: SOURCE_TYPE_LABEL[doc.source_type] || doc.source_type || '---',
    source_code: doc.source_code || '', source_href: buildSourceHref(doc.source_type, doc.source_id, doc.loai_xuat || doc.loai_nhap, doc.source_code),
    tong_so_luong: Number(doc.tong_so_luong || 0), tong_tien: money(doc.tong_tien),
    thanh_tien_giao_dich: (doc.items || []).reduce((sum, line) => sum + transactionLine(line, doc).thanh_tien_giao_dich, 0),
    ghi_nhan_thu_chi: doc.ghi_nhan_thu_chi === true,
    thuc_thu_chi: receipts.reduce((sum, receipt) => sum + receiptAmountForDocument(receipt, doc, kind), 0),
    trang_thai: doc.trang_thai || 'active', trang_thai_label: doc.trang_thai === 'cancelled' ? 'Đã hủy' : 'Hợp lệ',
    created_at: doc.created_at, ghi_chu: doc.ghi_chu || '',
    items: (doc.items || []).map(line => ({ ...line, ...transactionLine(line, doc) })) };
}

function flattenVatChuaDocLines(doc, kind) {
  if (!doc || !doc._id) return [];
  const items = Array.isArray(doc.items) ? doc.items : [];
  const maChungTu = kind === 'xuat' ? (doc.ma_xuat_vat_chua || '') : (doc.ma_nhap_vat_chua || '');
  const docHref = documentHref(kind, doc._id);
  const loaiLabel = kind === 'xuat'
    ? resolveXuatLoaiLabel(doc)
    : resolveNhapLoaiLabel(doc);
  const sourceHref = buildSourceHref(
    doc.source_type,
    doc.source_id,
    kind === 'xuat' ? doc.loai_xuat : doc.loai_nhap,
    doc.source_code
  );
  const createdAt = doc.created_at || null;

  return items.map(function(line) {
    return {
      doc_id: doc._id,
      doc_kind: kind,
      doc_kind_label: kind === 'xuat' ? 'Xuất' : 'Nhập',
      ma_chung_tu: maChungTu || '---',
      doc_href: docHref,
      loai_label: loaiLabel,
      ma_vat_chua: line.ma_vat_chua || '',
      ten_vat_chua: line.ten_vat_chua || line.ma_vat_chua || '---',
      vat_chua_id: refId(line.vat_chua_id),
      so_luong: Number(line.so_luong || 0),
      gia_von: money(line.gia_von), thanh_tien: money(line.thanh_tien),
      ...transactionLine(line, doc),
      ghi_nhan_thu_chi: doc.ghi_nhan_thu_chi === true,
      vat_chua_thanh_toan: doc.chi_tiet_thanh_toan || {},
      source_type: doc.source_type || '',
      source_type_label: SOURCE_TYPE_LABEL[doc.source_type] || doc.source_type || '---',
      source_code: doc.source_code || '',
      source_href: sourceHref,
      created_at: createdAt,
      ghi_chu: doc.ghi_chu || '',
      trang_thai: doc.trang_thai || 'active'
    };
  });
}

async function loadOrderLinkedVatChuaLines(orderId, invoiceIds, storeId) {
  const orderOid = cleanId(orderId);
  const store = cleanId(storeId);
  if (!orderOid || !store) return [];

  const sourceOr = [{ source_type: 'don_hang', source_id: new mongoose.Types.ObjectId(orderOid) }, { don_hang_id: new mongoose.Types.ObjectId(orderOid) }];
  const invoiceObjectIds = (Array.isArray(invoiceIds) ? invoiceIds : [])
    .map(function(id) { return cleanId(id); })
    .filter(Boolean)
    .map(function(id) { return new mongoose.Types.ObjectId(id); });
  if (invoiceObjectIds.length) {
    sourceOr.push({ source_type: 'hoa_don', source_id: { $in: invoiceObjectIds } });
  }

  const baseMatch = {
    cua_hang_id: new mongoose.Types.ObjectId(store),
    trang_thai: 'active',
    deleted_at: null,
    $or: sourceOr
  };

  const [xuatRows, nhapRows] = await Promise.all([
    XuatVatChua.find(baseMatch).sort({ created_at: -1 }).lean(),
    NhapVatChua.find(baseMatch).sort({ created_at: -1 }).lean()
  ]);

  const lines = []
    .concat((xuatRows || []).flatMap(function(row) { return flattenVatChuaDocLines(row, 'xuat'); }))
    .concat((nhapRows || []).flatMap(function(row) { return flattenVatChuaDocLines(row, 'nhap'); }));

  lines.sort(function(a, b) {
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return tb - ta;
  });

  return lines;
}

async function loadPurchaseLinkedVatChuaLines(purchaseId, storeId) {
  const map = await loadPurchasesLinkedVatChuaMap([purchaseId], storeId);
  const key = cleanId(purchaseId);
  return key ? (map[key] || []) : [];
}

async function loadPurchasesLinkedVatChuaMap(purchaseIds, storeId) {
  const store = cleanId(storeId);
  const ids = (Array.isArray(purchaseIds) ? purchaseIds : [])
    .map(function(id) { return cleanId(id); })
    .filter(Boolean)
    .map(function(id) { return new mongoose.Types.ObjectId(id); });
  if (!store || !ids.length) return {};

  const nhapRows = await NhapVatChua.find({
    cua_hang_id: new mongoose.Types.ObjectId(store),
    trang_thai: 'active',
    deleted_at: null,
    source_type: 'phieu_nhap',
    source_id: { $in: ids }
  }).sort({ created_at: -1 }).lean();

  const map = {};
  nhapRows.forEach(function(row) {
    const key = String(row.source_id || '');
    if (!key) return;
    if (!map[key]) map[key] = [];
    const flat = flattenVatChuaDocLines(row, 'nhap');
    map[key] = map[key].concat(flat);
  });

  Object.keys(map).forEach(function(key) {
    map[key].sort(function(a, b) {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });
  });

  return map;
}

async function loadInvoiceLinkedVatChuaLines(invoiceId, orderId, storeId) {
  const invoiceOid = cleanId(invoiceId);
  const orderOid = cleanId(orderId);
  const store = cleanId(storeId);
  if (!store || !invoiceOid) return [];

  const sourceOr = [{ source_type: 'hoa_don', source_id: new mongoose.Types.ObjectId(invoiceOid) },
    { hoa_don_id: new mongoose.Types.ObjectId(invoiceOid) }];

  let xuatRows = await XuatVatChua.find({
    cua_hang_id: new mongoose.Types.ObjectId(store),
    trang_thai: 'active',
    deleted_at: null,
    $or: sourceOr
  }).sort({ created_at: -1 }).lean();

  if (!xuatRows.length && orderOid) {
    const legacyRows = await XuatVatChua.find({
      cua_hang_id: new mongoose.Types.ObjectId(store), trang_thai: 'active', deleted_at: null,
      source_type: 'don_hang', source_id: new mongoose.Types.ObjectId(orderOid),
      $or: [{ hoa_don_id: null }, { hoa_don_id: { $exists: false } }]
    }).sort({ created_at: -1 }).lean();
    if (legacyRows.length === 1) xuatRows = legacyRows;
  }

  const lines = (xuatRows || []).flatMap(function(row) { return flattenVatChuaDocLines(row, 'xuat'); });
  lines.sort(function(a, b) {
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return tb - ta;
  });
  return lines;
}

async function loadReturnLinkedVatChuaLines(returnId, storeId) {
  const map = await loadReturnsLinkedVatChuaMap([returnId], storeId);
  const key = cleanId(returnId);
  return key ? (map[key] || []) : [];
}

async function loadSalesReturnLinkedNhapVatChuaLines(returnId, storeId) {
  const store = cleanId(storeId), id = cleanId(returnId);
  if (!store || !id) return [];
  const match = { cua_hang_id: new mongoose.Types.ObjectId(store), trang_thai: 'active', deleted_at: null,
    source_type: 'tra_hang_ban', source_id: new mongoose.Types.ObjectId(id) };
  const [nhapRows, xuatRows] = await Promise.all([
    NhapVatChua.find(match).sort({ created_at: -1 }).lean(), XuatVatChua.find(match).sort({ created_at: -1 }).lean()
  ]);
  return nhapRows.flatMap(row => flattenVatChuaDocLines(row, 'nhap'))
    .concat(xuatRows.flatMap(row => flattenVatChuaDocLines(row, 'xuat')).map(line => ({ ...line, so_luong: -Math.abs(line.so_luong) })))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

async function loadReturnsLinkedVatChuaMap(returnIds, storeId) {
  const store = cleanId(storeId);
  const ids = (Array.isArray(returnIds) ? returnIds : [])
    .map(function(id) { return cleanId(id); })
    .filter(Boolean)
    .map(function(id) { return new mongoose.Types.ObjectId(id); });
  if (!store || !ids.length) return {};

  const xuatRows = await XuatVatChua.find({
    cua_hang_id: new mongoose.Types.ObjectId(store),
    trang_thai: 'active',
    deleted_at: null,
    source_type: 'phieu_tra_hang_nhap',
    source_id: { $in: ids }
  }).sort({ created_at: -1 }).lean();

  const map = {};
  xuatRows.forEach(function(row) {
    const key = String(row.source_id || '');
    if (!key) return;
    if (!map[key]) map[key] = [];
    map[key] = map[key].concat(flattenVatChuaDocLines(row, 'xuat'));
  });

  Object.keys(map).forEach(function(key) {
    map[key].sort(function(a, b) {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });
  });

  return map;
}

module.exports = {
  loadVatChuaDetailContext,
  loadVatChuaDocumentDetail,
  buildVatChuaEditState,
  loadOrderLinkedVatChuaLines,
  loadPurchaseLinkedVatChuaLines,
  loadPurchasesLinkedVatChuaMap,
  loadInvoiceLinkedVatChuaLines,
  loadReturnLinkedVatChuaLines,
  loadSalesReturnLinkedNhapVatChuaLines,
  loadReturnsLinkedVatChuaMap,
  LOAI_NHAP_LABEL,
  LOAI_XUAT_LABEL,
  SOURCE_TYPE_LABEL
};
