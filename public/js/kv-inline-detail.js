/**
 * Master–detail inline row: fetch HTML partial, insert <tr> below active row.
 * Một bảng chỉ mở một panel; click lại cùng dòng thì đóng.
 */
(function(global) {
  'use strict';

  function bindDetailTabs(root) {
    if (!root) return;
    if (root.querySelector('[data-tab-target]')) {
      var tabs = root.querySelectorAll('.detail-tab');
      var panels = root.querySelectorAll('.detail-pane');
      tabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
          var target = tab.getAttribute('data-tab-target');
          tabs.forEach(function(t) { t.classList.toggle('is-active', t === tab); });
          panels.forEach(function(p) {
            p.classList.toggle('is-active', p.getAttribute('data-tab-panel') === target);
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
