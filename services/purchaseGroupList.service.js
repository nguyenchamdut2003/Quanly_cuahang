function refId(value) { return String(value && value._id || value || ''); }
function money(value) { return Math.max(0, Number(value) || 0); }
function timestamp(row) { return new Date(row.ngay_nhap || row.created_at || 0).getTime() || 0; }
function debtTimestamp(row) { return new Date(row.ngay_no || row.ngay_nhap || row.created_at || 0).getTime() || 0; }

// A view projection only: source accounting documents remain the reporting basis.
function buildPurchaseManagementList(sources, groups, filter = {}) {
  const activeGroups = (groups || []).filter(group => group.trang_thai === 'active');
  const memberships = new Map();
  activeGroups.forEach(group => (group.phieu_nguon_ids || []).forEach(id => memberships.set(refId(id), group)));
  const mode = filter.view_mode || '';
  const statuses = filter.statuses || ['draft', 'completed'];
  const keyword = String(filter.q || '').trim().toLocaleLowerCase('vi');
  const supplierId = filter.nha_cung_cap_id || '';
  const matchSourceStatus = source => statuses.includes(source.trang_thai);
  const matchCode = value => !keyword || String(value || '').toLocaleLowerCase('vi').includes(keyword);
  let items = mode === 'groups' ? [] : (sources || []).filter(source => {
    return source.trang_thai_du_lieu !== 'inactive' && !source.deleted_at && matchSourceStatus(source)
      && (!supplierId || refId(source.nha_cung_cap_id) === supplierId)
      && matchCode(source.ma_phieu_nhap)
      && (mode === 'sources' || !memberships.has(refId(source._id)));
  }).map(source => {
    const group = memberships.get(refId(source._id));
    return Object.assign({}, source, { record_type: 'source',
      group_url: group ? '/nhap-hang/tong-hop/' + encodeURIComponent(refId(group._id)) : '',
      ma_phieu_tong_hop: group ? group.ma_phieu_tong_hop : '' });
  });
  if (mode !== 'sources') {
    items = items.concat(activeGroups.filter(group => {
      return (!supplierId || refId(group.nha_cung_cap_id) === supplierId)
        && (group.sources || []).some(matchSourceStatus)
        && (matchCode(group.ma_phieu_tong_hop) || (group.sources || []).some(source => matchCode(source.ma_phieu_nhap)));
    }).map(group => {
      const totals = group.totals || {};
      const debtDates = (group.sources || []).filter(source => source.trang_thai === 'completed' && money(source.con_no_ncc) > 0)
        .map(source => timestamp(source)).filter(value => value > 0);
      return Object.assign({}, group, {
        record_type: 'group', group_url: '/nhap-hang/tong-hop/' + encodeURIComponent(refId(group._id)),
        ma_phieu_nhap: group.ma_phieu_tong_hop,
        ngay_nhap: group.ngay_gop || group.created_at,
        ngay_no: debtDates.length ? new Date(Math.min(...debtDates)) : null,
        trang_thai_label: group.source_status_label || 'Tổng hợp',
        tong_tien: money(totals.tong_tien), can_tra_ncc: money(totals.tong_tien),
        tong_tien_hang: money(totals.tong_tien_hang), tong_du_kien: money(totals.tong_du_kien), tong_da_nhap: money(totals.tong_da_nhap),
        da_tra_ncc: money(totals.da_tra_ncc), con_no_ncc: money(totals.con_no_ncc)
      });
    }));
  }
  items.sort((left, right) => {
    const debtDelta = money(right.con_no_ncc) - money(left.con_no_ncc);
    const dateDelta = timestamp(right) - timestamp(left);
    if (filter.sort === 'debt_high') return debtDelta || dateDelta;
    if (filter.sort === 'debt_low') return -debtDelta || dateDelta;
    if (filter.sort === 'oldest') return -dateDelta;
    if (filter.sort === 'oldest_debt') return Number(money(left.con_no_ncc) <= 0) - Number(money(right.con_no_ncc) <= 0)
      || debtTimestamp(left) - debtTimestamp(right);
    return dateDelta;
  });
  return {
    items,
    summaryTotals: sumPurchaseListTotals(items)
  };
}
function sumPurchaseListTotals(items) {
  return (items || []).reduce((sum, row) => {
    sum.orderTotal += money(row.tong_tien);
    sum.paid += money(row.da_tra_ncc);
    sum.debt += money(row.con_no_ncc);
    return sum;
  }, { orderTotal: 0, paid: 0, debt: 0 });
}
module.exports = { buildPurchaseManagementList, sumPurchaseListTotals };
