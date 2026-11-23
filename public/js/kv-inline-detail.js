/**
 * Master–detail inline row: fetch HTML partial, insert <tr> below active row.
 * Một bảng chỉ mở một panel; click lại cùng dòng thì đóng.
 */
(function(global) {
  'use strict';

  function bindDetailTabs(root) {
    if (!root) return;
    bindLotStatusFilters(root);
    initLotExpandRows(root);
    initCardExpandRows(root);
    initLotProfitReport(root);
    initProductNotes(root);
    if (root.querySelector('[data-tab-target]')) {
      var tabs = root.querySelectorAll('.detail-tab');
      var panels = root.querySelectorAll('.detail-pane');
      if (!panels.length) {
        panels = root.querySelectorAll('.customer-detail-pane[data-tab-pane]');
      }
      tabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
          var target = tab.getAttribute('data-tab-target');
          tabs.forEach(function(t) { t.classList.toggle('is-active', t === tab); });
          panels.forEach(function(p) {
            var paneKey = p.getAttribute('data-tab-panel') || p.getAttribute('data-tab-pane');
            p.classList.toggle('is-active', paneKey === target);
          });
        });
      });
      return;
    }
    var tabBtns = root.querySelectorAll('[data-detail-tab]');
    var panes = root.querySelectorAll('[data-detail-pane]');
    if (!tabBtns.length || !panes.length) return;
    tabBtns.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var target = tab.getAttribute('data-detail-tab');
        tabBtns.forEach(function(t) {
          t.classList.toggle('is-active', t.getAttribute('data-detail-tab') === target);
        });
        panes.forEach(function(p) {
          p.classList.toggle('is-active', p.getAttribute('data-detail-pane') === target);
        });
      });
    });
  }

  function initProductNotes(root) {
    if (!root) return;
    var pane = root.querySelector('[data-tab-panel="product-note"]');
    if (!pane || pane._productNoteBound) return;
    pane._productNoteBound = true;

    var productRoot = pane.closest('.product-detail') || root;
    var productId = productRoot.getAttribute('data-product-id') || '';
    if (!productId) return;

    var modal = pane.querySelector('[data-product-note-modal]');
    var editBtn = pane.querySelector('[data-product-note-edit]');
    var saveBtn = pane.querySelector('[data-product-note-save]');
    var statusEl = pane.querySelector('[data-product-note-status]');
    var inputMoTa = pane.querySelector('[data-product-note-input="mo_ta"]');
    var inputGhiChu = pane.querySelector('[data-product-note-input="ghi_chu_dat_hang"]');
    var viewMoTa = pane.querySelector('[data-note-view="mo_ta"]');
    var viewGhiChu = pane.querySelector('[data-note-view="ghi_chu_dat_hang"]');

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function readViewText(viewEl) {
      if (!viewEl) return '';
      var textNode = viewEl.querySelector('.product-note-text');
      return textNode ? textNode.textContent : '';
    }

    function renderNoteView(viewEl, text, emptyLabel) {
      if (!viewEl) return;
      var value = String(text || '').trim();
      if (!value) {
        viewEl.innerHTML = '<p class="product-note-empty">' + escapeHtml(emptyLabel) + '</p>';
        return;
      }
      viewEl.innerHTML = '<div class="product-note-text">' + escapeHtml(value) + '</div>';
    }

    function openModal() {
      if (!modal) return;
      if (inputMoTa) inputMoTa.value = readViewText(viewMoTa);
      if (inputGhiChu) inputGhiChu.value = readViewText(viewGhiChu);
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.classList.remove('is-error');
      }
      modal.hidden = false;
    }

    function closeModal() {
      if (!modal) return;
      modal.hidden = true;
    }

    pane.querySelectorAll('[data-product-note-close]').forEach(function(btn) {
      btn.addEventListener('click', closeModal);
    });

    if (editBtn) editBtn.addEventListener('click', openModal);

    if (saveBtn) {
      saveBtn.addEventListener('click', async function() {
        if (statusEl) {
          statusEl.textContent = 'Đang lưu...';
          statusEl.classList.remove('is-error');
        }
        saveBtn.disabled = true;
        try {
          var res = await fetch('/hang-hoa/api/' + encodeURIComponent(productId) + '/mo-ta-ghi-chu', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
              mo_ta: inputMoTa ? inputMoTa.value : '',
              ghi_chu_dat_hang: inputGhiChu ? inputGhiChu.value : ''
            })
          });
          var json = await res.json();
          if (!res.ok || !json.success) throw new Error(json.message || 'Không lưu được.');
          var data = json.data || {};
          renderNoteView(viewMoTa, data.mo_ta, 'Chưa có mô tả');
          renderNoteView(viewGhiChu, data.ghi_chu_dat_hang, 'Chưa có ghi chú');
          if (statusEl) statusEl.textContent = '';
          closeModal();
        } catch (err) {
          if (statusEl) {
            statusEl.textContent = err.message || 'Lỗi lưu dữ liệu';
            statusEl.classList.add('is-error');
          }
        } finally {
          saveBtn.disabled = false;
        }
      });
    }
  }

  function initLotProfitReport(root) {
    if (!root) return;
    var pane = root.querySelector('[data-tab-panel="product-lot-profit"]');
    if (!pane || pane._lotProfitBound) return;
    pane._lotProfitBound = true;

    var productRoot = pane.closest('.product-detail') || root;
    var productId = productRoot.getAttribute('data-product-id') || '';
    if (!productId) return;

    var loaded = false;
    var money = function(v) { return Math.round(Number(v || 0)).toLocaleString('vi-VN'); };
    var dateFmt = function(v) {
      if (!v) return '---';
      var d = new Date(v);
      return Number.isNaN(d.getTime()) ? '---' : d.toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    };
    var escapeHtml = function(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };

    function filtersQuery() {
      var q = [];
      pane.querySelectorAll('.lot-profit-filter').forEach(function(el) {
        var field = el.getAttribute('data-field');
        var val = String(el.value || '').trim();
        if (field && val) q.push(encodeURIComponent(field) + '=' + encodeURIComponent(val));
      });
      return q.length ? ('?' + q.join('&')) : '';
    }

    function closeDateMenu() {
      var menu = pane.querySelector('[data-lot-profit-date-menu]');
      if (menu) menu.classList.remove('is-open');
    }

    function lotLabel(lot) {
      return lot.label || lot.ten_lo || lot.ma_lo || 'Lô không tên';
    }

    function fillLotSelect(lots) {
      var sel = pane.querySelector('[data-field="lo_hang_id"]');
      if (!sel) return;
      var current = sel.value;
      sel.innerHTML = '';
      if (!lots || !lots.length) {
        var empty = document.createElement('option');
        empty.value = '';
        empty.textContent = 'Chưa có lô';
        empty.disabled = true;
        empty.selected = true;
        sel.appendChild(empty);
        return;
      }
      var all = document.createElement('option');
      all.value = '';
      all.textContent = 'Tất cả';
      sel.appendChild(all);
      lots.forEach(function(lot) {
        var id = String(lot.lo_hang_id || lot._id || '');
        if (!id) return;
        var opt = document.createElement('option');
        opt.value = id;
        opt.textContent = lotLabel(lot);
        sel.appendChild(opt);
      });
      if (current && Array.prototype.some.call(sel.options, function(opt) { return opt.value === current; })) {
        sel.value = current;
      }
    }

    function renderRows(data) {
      var body = pane.querySelector('[data-lot-profit-body]');
      var foot = pane.querySelector('[data-lot-profit-foot]');
      if (!body || !foot) return;
      var rows = data && data.rows || [];
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="11" class="empty-cell">Chưa có dữ liệu xuất bán theo lô này.</td></tr>';
        foot.style.display = 'none';
        return;
      }

      var sumGv = 0;
      var sumDt = 0;
      var sumLn = 0;
      var sumSlXuat = 0;
      body.innerHTML = rows.map(function(r) {
        sumGv += Number(r.tong_gia_von || 0);
        sumDt += Number(r.tong_doanh_thu || 0);
        sumLn += Number(r.loi_nhuan || 0);
        sumSlXuat += Number(r.so_luong_xuat || 0);
        var warn = r.thieu_gia_nhap ? ' <span class="stock-warning-text" title="Chưa có dòng nhập">*</span>' : '';
        return '<tr>' +
          '<td>' + dateFmt(r.ngay_nhap) + '</td>' +
          '<td>' + escapeHtml(r.ten_hang || '---') + '</td>' +
          '<td>' + escapeHtml(r.lo_hien_thi || '---') + warn + '</td>' +
          '<td class="lot-profit-spec-cell">' + escapeHtml(r.ten_quy_cach || '---') + '</td>' +
          '<td class="text-right">' + money(r.so_luong_nhap) + '</td>' +
          '<td class="text-right">' + money(r.don_gia_nhap) + '</td>' +
          '<td class="text-right">' + money(r.tong_gia_von) + '</td>' +
          '<td class="text-right">' + money(r.so_luong_xuat) + '</td>' +
          '<td class="text-right">' + money(r.don_gia_xuat_binh_quan) + '</td>' +
          '<td class="text-right">' + money(r.tong_doanh_thu) + '</td>' +
          '<td class="text-right' + (Number(r.loi_nhuan || 0) < 0 ? ' stock-warning-text' : '') + '">' + money(r.loi_nhuan) + '</td>' +
          '</tr>';
      }).join('');
      foot.style.display = '';
      foot.querySelector('[data-sum-gia-von]').textContent = money(sumGv);
      foot.querySelector('[data-sum-sl-xuat]').textContent = money(sumSlXuat);
      foot.querySelector('[data-sum-doanh-thu]').textContent = money(sumDt);
      foot.querySelector('[data-sum-loi-nhuan]').textContent = money(sumLn);
    }

    function renderLotProfitGroupedRows(data) {
      var body = pane.querySelector('[data-lot-profit-body]');
      var foot = pane.querySelector('[data-lot-profit-foot]');
      if (!body || !foot) return;
      var rows = data && data.rows || [];
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="12" class="empty-cell">Ch&#432;a c&oacute; d&#7919; li&#7879;u xu&#7845;t b&aacute;n theo l&ocirc; n&agrave;y.</td></tr>';
        foot.style.display = 'none';
        return;
      }

      var groupMap = {};
      var groups = [];
      rows.forEach(function(r, index) {
        var lotKey = String(r.lo_hang_id || r.lo_hien_thi || r.ten_lo || r.ma_lo || '') + '|' + String(r.ngay_nhap || '');
        if (!groupMap[lotKey]) {
          groupMap[lotKey] = {
            key: 'lot-profit-' + index,
            row: Object.assign({}, r),
            rows: [],
            so_luong_nhap: 0,
            tong_gia_von: 0,
            so_luong_xuat: 0,
            tong_doanh_thu: 0,
            loi_nhuan: 0,
            thieu_gia_nhap: false
          };
          groups.push(groupMap[lotKey]);
        }
        var group = groupMap[lotKey];
        group.rows.push(r);
        group.so_luong_nhap += Number(r.so_luong_nhap || 0);
        group.tong_gia_von += Number(r.tong_gia_von || 0);
        group.so_luong_xuat += Number(r.so_luong_xuat || 0);
        group.tong_doanh_thu += Number(r.tong_doanh_thu || 0);
        group.loi_nhuan += Number(r.loi_nhuan || 0);
        group.thieu_gia_nhap = group.thieu_gia_nhap || Boolean(r.thieu_gia_nhap);
      });

      var sumGv = 0;
      var sumDt = 0;
      var sumLn = 0;
      var sumSlXuat = 0;
      body.innerHTML = groups.map(function(group) {
        var r = group.row;
        var hasDetails = group.rows.length > 1;
        r.so_luong_nhap = group.so_luong_nhap;
        r.tong_gia_von = group.tong_gia_von;
        r.so_luong_xuat = group.so_luong_xuat;
        r.tong_doanh_thu = group.tong_doanh_thu;
        r.loi_nhuan = group.loi_nhuan;
        r.don_gia_nhap = group.so_luong_nhap > 0 ? group.tong_gia_von / group.so_luong_nhap : Number(r.don_gia_nhap || 0);
        r.don_gia_xuat_binh_quan = group.so_luong_xuat > 0 ? group.tong_doanh_thu / group.so_luong_xuat : 0;
        sumGv += Number(r.tong_gia_von || 0);
        sumDt += Number(r.tong_doanh_thu || 0);
        sumLn += Number(r.loi_nhuan || 0);
        sumSlXuat += Number(r.so_luong_xuat || 0);
        var warn = group.thieu_gia_nhap ? ' <span class="stock-warning-text" title="Ch&#432;a c&oacute; d&ograve;ng nh&#7853;p">*</span>' : '';
        var details = '';
        if (hasDetails) {
          details = '<tr class="lot-detail-row lot-profit-detail-row" data-lot-profit-detail="' + group.key + '" hidden>' +
            '<td colspan="12"><div class="lot-detail-panel">' +
            '<div class="lot-detail-panel-title">Chi ti&#7871;t l&ocirc;</div>' +
            '<table class="admin-table product-inner-table lot-detail-table"><thead><tr>' +
            '<th>Thu&#7897;c t&iacute;nh</th><th class="text-right">S&#7889; l&#432;&#7907;ng nh&#7853;p</th><th class="text-right">&#272;G nh&#7853;p</th>' +
            '<th class="text-right">T&#7893;ng gi&aacute; v&#7889;n</th><th class="text-right">SL xu&#7845;t</th><th class="text-right">&#272;G xu&#7845;t BQ</th>' +
            '<th class="text-right">T&#7893;ng doanh thu</th><th class="text-right">L&#7907;i nhu&#7853;n</th>' +
            '</tr></thead><tbody>' +
            group.rows.map(function(detail) {
              return '<tr>' +
                '<td>' + escapeHtml(detail.ten_quy_cach || '---') + '</td>' +
                '<td class="text-right">' + money(detail.so_luong_nhap) + '</td>' +
                '<td class="text-right">' + money(detail.don_gia_nhap) + '</td>' +
                '<td class="text-right">' + money(detail.tong_gia_von) + '</td>' +
                '<td class="text-right">' + money(detail.so_luong_xuat) + '</td>' +
                '<td class="text-right">' + money(detail.don_gia_xuat_binh_quan) + '</td>' +
                '<td class="text-right">' + money(detail.tong_doanh_thu) + '</td>' +
                '<td class="text-right' + (Number(detail.loi_nhuan || 0) < 0 ? ' stock-warning-text' : '') + '">' + money(detail.loi_nhuan) + '</td>' +
              '</tr>';
            }).join('') +
            '</tbody></table></div></td></tr>';
        }
        return '<tr>' +
          '<td class="lot-col-expand">' + (hasDetails ? '<button type="button" class="lot-expand-btn" data-lot-profit-expand="' + group.key + '" aria-expanded="false" aria-label="Xem chi ti&#7871;t l&ocirc;" title="Chi ti&#7871;t l&ocirc;">+</button>' : '') + '</td>' +
          '<td>' + dateFmt(r.ngay_nhap) + '</td>' +
          '<td>' + escapeHtml(r.ten_hang || '---') + '</td>' +
          '<td>' + escapeHtml(r.lo_hien_thi || '---') + warn + '</td>' +
          '<td class="lot-profit-spec-cell">' + (hasDetails ? escapeHtml(group.rows.length + ' thuộc tính') : escapeHtml(r.ten_quy_cach || '---')) + '</td>' +
          '<td class="text-right">' + money(r.so_luong_nhap) + '</td>' +
          '<td class="text-right">' + money(r.don_gia_nhap) + '</td>' +
          '<td class="text-right">' + money(r.tong_gia_von) + '</td>' +
          '<td class="text-right">' + money(r.so_luong_xuat) + '</td>' +
          '<td class="text-right">' + money(r.don_gia_xuat_binh_quan) + '</td>' +
          '<td class="text-right">' + money(r.tong_doanh_thu) + '</td>' +
          '<td class="text-right' + (Number(r.loi_nhuan || 0) < 0 ? ' stock-warning-text' : '') + '">' + money(r.loi_nhuan) + '</td>' +
          '</tr>' + details;
      }).join('');
      foot.style.display = '';
      foot.querySelector('[data-sum-gia-von]').textContent = money(sumGv);
      foot.querySelector('[data-sum-sl-xuat]').textContent = money(sumSlXuat);
      foot.querySelector('[data-sum-doanh-thu]').textContent = money(sumDt);
      foot.querySelector('[data-sum-loi-nhuan]').textContent = money(sumLn);
      bindLotProfitExpandRows();
    }

    function bindLotProfitExpandRows() {
      pane.querySelectorAll('[data-lot-profit-expand]').forEach(function(btn) {
        if (btn._lotProfitExpandBound) return;
        btn._lotProfitExpandBound = true;
        btn.addEventListener('click', function(event) {
          event.preventDefault();
          event.stopPropagation();
          var id = btn.getAttribute('data-lot-profit-expand');
          if (!id) return;
          var detailRow = pane.querySelector('[data-lot-profit-detail="' + id + '"]');
          if (!detailRow) return;
          var willOpen = detailRow.hidden;
          detailRow.hidden = !willOpen;
          btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
          btn.textContent = willOpen ? '-' : '+';
        });
      });
    }

    async function loadReport() {
      var status = pane.querySelector('[data-lot-profit-status]');
      if (status) status.textContent = 'Đang tải...';
      try {
        var res = await fetch('/hang-hoa/api/' + encodeURIComponent(productId) + '/loi-lo-theo-lo' + filtersQuery(), {
          credentials: 'same-origin',
          headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
        });
        var contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) throw new Error('API không trả JSON.');
        var json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || 'Không tải được báo cáo.');
        var data = json.data || {};
        fillLotSelect(data.filterOptions && data.filterOptions.lots || []);
        if (data.meta && data.meta.ghi_chu_gia_nhap) {
          var metaEl = pane.querySelector('[data-lot-profit-meta]');
          if (metaEl) metaEl.textContent = data.meta.ghi_chu_gia_nhap + ' (' + (data.meta.tong_dong || 0) + ' dòng)';
        }
        renderLotProfitGroupedRows(data);
        if (status) status.textContent = '';
        loaded = true;
      } catch (err) {
        if (status) status.textContent = err.message || 'Lỗi tải báo cáo';
        var body = pane.querySelector('[data-lot-profit-body]');
        if (body) body.innerHTML = '<tr><td colspan="11" class="empty-cell">' + escapeHtml(err.message || 'Lỗi tải báo cáo') + '</td></tr>';
      }
    }

    var lotSelect = pane.querySelector('[data-field="lo_hang_id"]');
    if (lotSelect) lotSelect.addEventListener('change', loadReport);
    var dateToggle = pane.querySelector('[data-lot-profit-date-toggle]');
    var dateMenu = pane.querySelector('[data-lot-profit-date-menu]');
    if (dateToggle && dateMenu) {
      dateToggle.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        dateMenu.classList.toggle('is-open');
      });
      dateMenu.addEventListener('click', function(event) {
        event.stopPropagation();
      });
      var applyDateBtn = pane.querySelector('[data-lot-profit-date-apply]');
      var clearDateBtn = pane.querySelector('[data-lot-profit-date-clear]');
      if (applyDateBtn) {
        applyDateBtn.addEventListener('click', function() {
          closeDateMenu();
          loadReport();
        });
      }
      if (clearDateBtn) {
        clearDateBtn.addEventListener('click', function() {
          pane.querySelectorAll('[data-field="ngay_nhap_from"], [data-field="ngay_nhap_to"]').forEach(function(input) {
            input.value = '';
          });
          closeDateMenu();
          loadReport();
        });
      }
      document.addEventListener('click', closeDateMenu);
    }
    var exportBtn = pane.querySelector('.lot-profit-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', function() {
        window.open('/hang-hoa/api/' + encodeURIComponent(productId) + '/loi-lo-theo-lo/export.xlsx' + filtersQuery(), '_blank');
      });
    }

    root.querySelectorAll('.detail-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        if (tab.getAttribute('data-tab-target') === 'product-lot-profit' && !loaded) loadReport();
      });
    });

  }

  var supplierPurchaseDetailSequence = 0;

  function closeSupplierPurchaseDetail(row) {
    var detail = row.nextElementSibling;
    if (detail && detail.hasAttribute('data-supplier-purchase-detail')) detail.hidden = true;
    if (row._supplierPurchaseRequest) {
      row._supplierPurchaseRequest.abort();
      row._supplierPurchaseRequest = null;
    }
    row._supplierPurchaseOpen = false;
    var link = row.querySelector('[data-supplier-purchase-toggle]');
    if (link) link.setAttribute('aria-expanded', 'false');
  }

  function bindSupplierPurchaseTabs(detail) {
    detail.querySelectorAll('.po-detail').forEach(function(panel) {
      var tabs = Array.from(panel.querySelectorAll('.po-detail-tab')).filter(function(tab) { return tab.closest('.po-detail') === panel; });
      var panes = Array.from(panel.querySelectorAll('[data-tab-pane]')).filter(function(pane) { return pane.closest('.po-detail') === panel; });
      tabs.forEach(function(tab) {
        tab.addEventListener('click', function(event) {
          event.preventDefault();
          event.stopPropagation();
          tabs.forEach(function(item) { item.classList.toggle('is-active', item === tab); });
          panes.forEach(function(pane) { pane.classList.toggle('is-active', pane.dataset.tabPane === tab.dataset.tabTarget); });
        });
      });
    });
  }

  function initSupplierPurchaseDetails(root) {
    root.querySelectorAll('[data-supplier-purchase-history]').forEach(function(table) {
      if (table._supplierPurchaseDetailsBound) return;
      table._supplierPurchaseDetailsBound = true;
      table.addEventListener('click', function(event) {
        var row = event.target.closest('[data-supplier-purchase-id]');
        if (!row || row.closest('table') !== table) return;
        var link = event.target.closest('[data-supplier-purchase-toggle]');
        if (!link && event.target.closest('a,button,input,select,textarea,label')) return;
        event.preventDefault();
        event.stopPropagation();
        if (row._supplierPurchaseOpen) {
          closeSupplierPurchaseDetail(row);
          return;
        }
        var detail = row.nextElementSibling;
        if (!detail || !detail.hasAttribute('data-supplier-purchase-detail')) {
          detail = document.createElement('tr');
          detail.className = 'supplier-purchase-inline-row';
          detail.setAttribute('data-supplier-purchase-detail', row.dataset.supplierPurchaseId);
          detail.id = 'supplier-purchase-detail-' + (++supplierPurchaseDetailSequence);
          var cell = document.createElement('td');
          cell.colSpan = row.cells.length;
          detail.appendChild(cell);
          row.after(detail);
        }
        row._supplierPurchaseOpen = true;
        detail.hidden = false;
        link = row.querySelector('[data-supplier-purchase-toggle]');
        if (link) {
          link.setAttribute('aria-expanded', 'true');
          link.setAttribute('aria-controls', detail.id);
        }
        if (detail._supplierPurchaseLoaded) return;
        var td = detail.cells[0];
        td.innerHTML = '<div class="supplier-purchase-inline-loading" role="status">Đang tải phiếu nhập...</div>';
        var request = typeof AbortController === 'function' ? new AbortController() : null;
        row._supplierPurchaseRequest = request;
        fetch(row.dataset.supplierPurchaseDetailUrl, {
          credentials: 'same-origin', signal: request ? request.signal : undefined,
          headers: { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' }
        }).then(function(response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.text();
        }).then(function(html) {
          if (!row.isConnected || !row._supplierPurchaseOpen || row._supplierPurchaseRequest !== request) return;
          td.innerHTML = html;
          if (!td.querySelector('.po-detail')) throw new Error('Missing purchase detail');
          bindSupplierPurchaseTabs(detail);
          detail._supplierPurchaseLoaded = true;
          row._supplierPurchaseRequest = null;
        }).catch(function(error) {
          if (error.name === 'AbortError' || !row.isConnected || !row._supplierPurchaseOpen || row._supplierPurchaseRequest !== request) return;
          td.innerHTML = '<div class="supplier-purchase-inline-loading" role="status">Không tải được phiếu nhập. Bấm mã phiếu để đóng rồi mở lại.</div>';
          row._supplierPurchaseRequest = null;
        });
      });
    });
  }

  function initLotExpandRows(root) {
    if (!root) return;
    initSupplierPurchaseDetails(root);
    root.querySelectorAll('[data-lot-expand]').forEach(function(btn) {
      if (btn._lotExpandBound) return;
      btn._lotExpandBound = true;
      btn.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        var lotId = btn.getAttribute('data-lot-expand');
        if (!lotId) return;
        // Keep each table independent, including lazily loaded supplier history.
        var pane = btn.closest('table') || root;
        var detailRows = Array.prototype.filter.call(pane.querySelectorAll('[data-lot-detail]'), function(row) {
          return row.getAttribute('data-lot-detail') === lotId;
        });
        if (!detailRows.length) return;
        var willOpen = detailRows[0].hidden;
        detailRows.forEach(function(row) {
          row.hidden = !willOpen;
          if (!willOpen && row.hasAttribute('data-supplier-purchase-id')) closeSupplierPurchaseDetail(row);
        });
        btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        btn.textContent = willOpen ? '-' : '+';
      });
    });
  }

  function bindLotStatusFilters(root) {
    if (!root) return;
    root.querySelectorAll('[data-lot-filter]').forEach(function(filterRoot) {
      if (filterRoot._lotFilterBound) return;
      filterRoot._lotFilterBound = true;
      var pane = filterRoot.closest('[data-tab-panel="product-lots"]') || root;
      var buttons = filterRoot.querySelectorAll('[data-lot-filter-value]');
      var rows = pane.querySelectorAll('.lot-data-row');
      var emptyRow = pane.querySelector('.lot-filter-empty-row');

      function applyFilter(value) {
        var visibleCount = 0;
        rows.forEach(function(row) {
          var status = row.getAttribute('data-lot-status') || '';
          var qty = Number(row.getAttribute('data-lot-qty') || 0);
          var show = value === 'all';
          if (value === 'available') {
            show = status === 'active' && qty > 0;
          } else if (value === 'empty') {
            show = status === 'het_hang' || (status !== 'huy' && qty <= 0);
          }
          row.style.display = show ? '' : 'none';
          var expandBtn = row.querySelector('[data-lot-expand]');
          var lotId = expandBtn ? expandBtn.getAttribute('data-lot-expand') : '';
          if (lotId) {
            var detailRow = pane.querySelector('[data-lot-detail="' + lotId + '"]');
            if (detailRow) {
              detailRow.style.display = show ? '' : 'none';
              if (!show) detailRow.hidden = true;
            }
            if (expandBtn && !show) {
              expandBtn.setAttribute('aria-expanded', 'false');
              expandBtn.textContent = '+';
            }
          }
          if (show) visibleCount += 1;
        });
        if (emptyRow) emptyRow.style.display = visibleCount === 0 ? '' : 'none';
      }

      buttons.forEach(function(button) {
        button.addEventListener('click', function() {
          var value = button.getAttribute('data-lot-filter-value') || 'all';
          buttons.forEach(function(btn) {
            btn.classList.toggle('is-active', btn === button);
          });
          applyFilter(value);
        });
      });
      applyFilter('all');
    });
  }

  function initCardExpandRows(root) {
    if (!root) return;
    var pane = root.matches && root.matches('[data-tab-panel="product-card"]')
      ? root
      : root.querySelector('[data-tab-panel="product-card"]');
    if (!pane) return;

    pane.querySelectorAll('[data-card-expand]').forEach(function(btn) {
      if (btn._cardExpandBound) return;
      btn._cardExpandBound = true;
      btn.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        var cardId = btn.getAttribute('data-card-expand');
        if (!cardId) return;
        var detailRow = pane.querySelector('[data-card-detail="' + cardId + '"]');
        if (!detailRow) return;
        var willOpen = detailRow.hidden;
        detailRow.hidden = !willOpen;
        btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        btn.textContent = willOpen ? '-' : '+';
      });
    });
  }

  function KvInlineDetail(opts) {
    this.table = opts.table;
    if (!this.table) throw new Error('KvInlineDetail: table required');
    this.tbody = this.table.tBodies[0] || this.table;
    this.colspan = opts.colspan || (this.table.tHead && this.table.tHead.rows[0]
      ? this.table.tHead.rows[0].cells.length
      : 1);
    this.buildUrl = opts.buildUrl;
    if (typeof this.buildUrl !== 'function') {
      throw new Error('KvInlineDetail: buildUrl required');
    }
    this.onOpen = opts.onOpen || function() {};
    this.activeRow = null;
    this.activeId = null;
    this.detailTr = null;
    this.abortController = null;
    this.table._kvDetail = this;

    var self = this;
    this.tbody.addEventListener('click', function(ev) {
      var row = ev.target.closest('tr[data-kv-detail-id]');
      if (!row || !self.table.contains(row)) return;
      if (ev.target.closest('a, button, input, select, textarea, label')) return;
      var id = row.getAttribute('data-kv-detail-id');
      if (!id) return;
      ev.preventDefault();
      self.toggle(row, id);
    });

    this.tbody.addEventListener('click', function(ev) {
      var a = ev.target.closest('a.kv-detail-code-link');
      if (!a || !self.table.contains(a)) return;
      var row = a.closest('tr[data-kv-detail-id]');
      if (!row) return;
      ev.preventDefault();
      var id = row.getAttribute('data-kv-detail-id');
      self.toggle(row, id);
    });
  }

  KvInlineDetail.prototype.clearRowSelection = function() {
    this.table.querySelectorAll('tr[data-kv-detail-id].is-selected').forEach(function(r) {
      r.classList.remove('is-selected');
    });
  };

  KvInlineDetail.prototype.closeDetail = function() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.detailTr && this.detailTr.parentNode) {
      this.detailTr.parentNode.removeChild(this.detailTr);
    }
    this.detailTr = null;
    this.clearRowSelection();
    this.activeRow = null;
    this.activeId = null;
  };

  KvInlineDetail.prototype.toggle = function(row, id) {
    if (this.activeId === id && this.detailTr) {
      this.closeDetail();
      return;
    }
    this.open(row, id);
  };

  KvInlineDetail.prototype.open = function(row, id) {
    var self = this;
    this.closeDetail();
    this.clearRowSelection();
    row.classList.add('is-selected');
    this.activeRow = row;
    this.activeId = id;

    var tr = document.createElement('tr');
    tr.className = 'product-detail-row kv-inline-detail-tr';
    var td = document.createElement('td');
    td.colSpan = self.colspan;
    td.innerHTML = '<div class="kv-detail-panel product-detail kv-detail-loading"><p class="kv-detail-loading-text">Đang tải thông tin...</p></div>';
    tr.appendChild(td);
    row.parentNode.insertBefore(tr, row.nextSibling);
    self.detailTr = tr;

    self.abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var signal = self.abortController ? self.abortController.signal : undefined;

    fetch(self.buildUrl(id), {
      signal: signal,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function(html) {
        td.innerHTML = html;
        var root = td.querySelector('.product-detail') || td;
        bindDetailTabs(root);
        self.onOpen(id, root);
      })
      .catch(function(err) {
        if (err.name === 'AbortError') return;
        td.innerHTML = '<div class="kv-detail-panel product-detail kv-detail-error"><p>Không tải được thông tin. Vui lòng thử lại.</p></div>';
      });
  };

  KvInlineDetail.prototype.openById = function(id) {
    if (!id) return;
    var row = this.table.querySelector('tr[data-kv-detail-id="' + String(id) + '"]');
    if (row) this.open(row, id);
  };

  global.KvInlineDetail = KvInlineDetail;
  global.kvInlineBindDetailTabs = bindDetailTabs;
  global.kvInlineBindExpandRows = initLotExpandRows;

  document.addEventListener('click', function(e) {
    var a = e.target.closest('a.ref-link[href^="/hang-hoa/"]');
    if (!a || (global.location.pathname || '') !== '/hang-hoa') return;
    var href = a.getAttribute('href') || '';
    var m = href.match(/^\/hang-hoa\/([a-f0-9]{24})\/?$/i);
    if (!m) return;
    var table = document.querySelector('table[data-kv-master="hang-hoa"]');
    var inst = table && table._kvDetail;
    if (!inst) return;
    e.preventDefault();
    inst.openById(m[1]);
  });
})(typeof window !== 'undefined' ? window : this);
