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
    var money = function(v) { return Number(v || 0).toLocaleString('vi-VN'); };
    var dateFmt = function(v) {
      if (!v) return '---';
      var d = new Date(v);
      return Number.isNaN(d.getTime()) ? '---' : d.toLocaleDateString('vi-VN');
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
          '<td>' + escapeHtml(r.ten_quy_cach || '---') + '</td>' +
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
        renderRows(data);
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

    loadReport();
  }

  function initLotExpandRows(root) {
    if (!root) return;
    var pane = root.querySelector('[data-tab-panel="product-lots"]');
    if (!pane || pane._lotExpandBound) return;
    pane._lotExpandBound = true;

    pane.querySelectorAll('[data-lot-expand]').forEach(function(btn) {
      btn.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        var lotId = btn.getAttribute('data-lot-expand');
        if (!lotId) return;
        var detailRow = pane.querySelector('[data-lot-detail="' + lotId + '"]');
        if (!detailRow) return;
        var willOpen = detailRow.hidden;
        detailRow.hidden = !willOpen;
        btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        btn.textContent = willOpen ? '−' : '+';
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
