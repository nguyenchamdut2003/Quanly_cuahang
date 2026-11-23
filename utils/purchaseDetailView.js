'use strict';

const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function createPurchaseDetailViewHelpers(options = {}) {
  const fmt = value => Number(value || 0).toLocaleString('vi-VN');
  const fmtMoney = value => fmt(value) + ' VNĐ';
  const refLink = options.refLink || ((type, doc, text) => escape(text || '--'));
  const formatDate = options.formatDate || (value => {
    if (!value) return '---';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '---' : date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  });
  const statusLabel = options.statusLabel || (value => ({ draft: 'Phiếu tạm', completed: 'Đã nhập hàng', cancelled: 'Đã hủy', merged: 'Đã gộp' })[value] || value || '--');
  const statusBadge = value => value === 'draft' ? 'draft' : (value === 'merged' ? 'merged' : '');
  const formatDateOnly = value => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN');
  };
  const lotLabel = row => {
    const product = row && row.hang_hoa_id || {};
    if (!product.quan_ly_theo_lo) return 'Không theo lô';
    const lot = row && row.lo_hang_id;
    if (!lot) return '--';
    const label = lot.ten_lo || lot.ma_lo || '--';
    const lotText = lot._id ? refLink('lot', lot, label) : escape(label);
    const date = formatDateOnly(lot.ngay_nhap) || '--';
    const expiry = formatDateOnly(lot.han_su_dung) || '--';
    return `${lotText}<br><span class="lot-cell-date">${date} - HSD: ${expiry}</span>`;
  };
  const detailGroups = rows => {
    const groups = [];
    const index = new Map();
    (rows || []).forEach(row => {
      const product = row && row.hang_hoa_id || {};
      const lot = row && row.lo_hang_id || null;
      const productId = String(product._id || row.hang_hoa_id || '');
      const lotId = product.quan_ly_theo_lo ? String(lot?._id || row.lo_hang_id || 'missing') : 'no-lot';
      const key = productId + '::' + lotId;
      if (!index.has(key)) {
        const group = { product, lot, lot_label: lotLabel(row), rows: [], total: 0 };
        index.set(key, group);
        groups.push(group);
      }
      index.get(key).rows.push(row);
      index.get(key).total += Number(row.thanh_tien || 0);
    });
    return groups;
  };
  const detailRowsForGroup = group => {
    const result = [];
    (group.rows || []).forEach(row => {
      const info = row && row.lot_info;
      const attrs = info && Array.isArray(info.quy_cach_items)
        ? info.quy_cach_items.filter(item => Number(item.so_luong || 0) > 0 || item.ten_quy_cach || item.ten_thuoc_tinh) : [];
      if (!attrs.length) {
        result.push({ ten_thuoc_tinh: '--', so_luong: Number(row.so_luong || 0), don_gia_nhap: Number(row.don_gia_nhap || 0), thanh_tien: Number(row.thanh_tien || 0) });
        return;
      }
      attrs.forEach(item => {
        const qty = Number(item.so_luong || 0);
        const price = Number(item.don_gia_nhap || item.gia_von || row.don_gia_nhap || 0);
        result.push({ ten_thuoc_tinh: item.ten_quy_cach || item.ten_thuoc_tinh || '--', so_luong: qty, don_gia_nhap: price, thanh_tien: Number(item.thanh_tien || qty * price) });
      });
    });
    return result.length ? result : [{ ten_thuoc_tinh: '--', so_luong: 0, don_gia_nhap: 0, thanh_tien: 0 }];
  };
  return { fmt, fmtMoney, formatDate, statusLabel, statusBadge, lotLabel, detailGroups, detailRowsForGroup, refLink };
}

module.exports = { createPurchaseDetailViewHelpers };
