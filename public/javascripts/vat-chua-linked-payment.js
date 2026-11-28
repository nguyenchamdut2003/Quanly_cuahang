(function () {
  'use strict';
  if (window.KVVatChuaPayment) return;
  var instances = new WeakMap(), books = {};
  function newRequestKey() { return window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID()
    : 'container-' + Date.now() + '-' + Math.random().toString(36).slice(2); }
  function amount(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return 0;
    if (!/^[\d.,\s]+$/.test(raw)) return NaN;
    return Number(raw.replace(/[.,\s]/g, ''));
  }
  function qty(value) { var raw = String(value || '').trim().replace(/[.,\s]/g, ''); return /^-?\d+$/.test(raw) ? Number(raw) : 0; }
  function money(value) { return Number(value || 0).toLocaleString('vi-VN'); }
  function escape(value) { return String(value || '').replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  async function loadBooks(type) {
    if (!books[type]) books[type] = fetch('/api/so-quy/active?loai_so_quy=' + encodeURIComponent(type), { credentials: 'same-origin' })
      .then(function (res) { return res.json(); }).then(function (json) {
        if (!json.success) throw new Error(json.message || 'Không tải được sổ quỹ vật chứa.');
        return Array.isArray(json.items) ? json.items : [];
      }).catch(function (error) { delete books[type]; throw error; });
    return books[type];
  }
  function mount(host) {
    if (instances.has(host)) return instances.get(host);
    var idInput = document.getElementById(host.dataset.vcId), qtyInput = document.getElementById(host.dataset.vcQty);
    if (!idInput || !qtyInput) return null;
    var panel = document.createElement('div'); panel.className = 'vc-linked-panel';
    panel.innerHTML = '<label class="vc-linked-line"><span>Ghi vào Thu chi</span><span class="vc-linked-switch"><input type="checkbox" data-vc-toggle aria-label="Ghi vật chứa vào Thu chi"><span class="vc-linked-track" aria-hidden="true"></span></span></label>'
      + '<label class="vc-linked-line" data-vc-price-row hidden><span>Đơn giá vật chứa</span><input class="vc-linked-price" data-vc-price name="vat_chua_don_gia_giao_dich" inputmode="numeric" autocomplete="off" value="0" aria-label="Đơn giá giao dịch vật chứa"></label>'
      + '<div class="vc-linked-line" data-vc-total-row hidden><span>Thành tiền vật chứa</span><output class="vc-linked-total" data-vc-total>0đ</output></div>'
      + '<input type="hidden" name="vat_chua_ghi_nhan_thu_chi" data-vc-flag value="false">'
      + '<input type="hidden" name="vat_chua_request_key" data-vc-request>'
      + '<div class="vc-linked-money" data-vc-money hidden>'
      + '<label><span data-vc-cash-label>Tiền mặt vật chứa</span><input data-vc-cash name="vat_chua_thanh_toan[tien_mat]" inputmode="numeric" value="0" aria-label="Tiền mặt thực thu hoặc chi vật chứa"></label>'
      + '<label>Sổ tiền mặt vật chứa<select data-vc-cash-book name="vat_chua_thanh_toan[so_quy_tien_mat_id]" aria-label="Sổ tiền mặt vật chứa"><option value="">Chọn sổ tiền mặt</option></select></label>'
      + '<label><span data-vc-bank-label>Chuyển khoản vật chứa</span><input data-vc-bank name="vat_chua_thanh_toan[chuyen_khoan]" inputmode="numeric" value="0" aria-label="Chuyển khoản thực thu hoặc chi vật chứa"></label>'
      + '<label>Tài khoản vật chứa<select data-vc-bank-book name="vat_chua_thanh_toan[so_quy_chuyen_khoan_id]" aria-label="Tài khoản chuyển khoản vật chứa"><option value="">Chọn tài khoản</option></select></label>'
      + '<p class="vc-linked-note">Chỉ nhập tiền vật chứa thực nhận/chi, tách riêng thanh toán hàng hóa.</p></div>'
      + '<p class="vc-linked-note" data-vc-lock hidden></p><p class="vc-linked-error" data-vc-error role="alert" hidden></p>';
    host.appendChild(panel);
    var el = function (name) { return panel.querySelector('[data-vc-' + name + ']'); }, pendingBooks = false, locked = false, requestKey = '';
    var priceContainerId = '', hasPrice = false;
    var initialDisabled = { id: idInput.disabled, qty: qtyInput.disabled };
    function showError(message) { el('error').textContent = message || ''; el('error').hidden = !message; }
    function refresh() {
      var count = qty(qtyInput.value);
      var eligible = Boolean(idInput.value && count && (host.dataset.vcDirection === 'signed' || count > 0));
      if (priceContainerId !== idInput.value) { priceContainerId = idInput.value; hasPrice = false; el('price').value = '0'; }
      el('toggle').disabled = locked || !eligible;
      el('price').disabled = locked;
      if (!eligible) el('toggle').checked = false;
      var enabled = el('toggle').checked;
      if (enabled && !hasPrice) {
        var option = idInput.selectedOptions && idInput.selectedOptions[0];
        var average = Number(option && option.dataset.vcAverageCost || 0);
        el('price').value = money(Number.isFinite(average) && average > 0 ? Math.round(average) : 0);
        hasPrice = true;
      }
      var price = amount(el('price').value), total = Math.abs(count) * (Number.isFinite(price) ? price : 0);
      el('price-row').hidden = !enabled; el('total-row').hidden = !enabled;
      el('flag').value = enabled ? 'true' : 'false'; el('total').textContent = money(total) + 'đ'; el('money').hidden = !enabled;
      el('request').value = requestKey;
      var direction = host.dataset.vcDirection === 'signed' ? (count > 0 ? 'chi' : 'thu') : (host.dataset.vcDirection || 'thu');
      el('cash-label').textContent = (direction === 'chi' ? 'Thực chi tiền mặt' : 'Thực thu tiền mặt') + ' vật chứa';
      el('bank-label').textContent = (direction === 'chi' ? 'Thực chi chuyển khoản' : 'Thực thu chuyển khoản') + ' vật chứa';
      ['cash', 'bank', 'cash-book', 'bank-book'].forEach(function (name) { el(name).disabled = locked || !enabled; });
      if (enabled && !locked && !pendingBooks) {
        pendingBooks = true;
        Promise.all(['tien_mat', 'chuyen_khoan'].map(function (type, index) {
          var select = el(index ? 'bank-book' : 'cash-book'), keep = select.value || select.dataset.savedValue || '';
          return loadBooks(type).then(function (rows) {
            select.innerHTML = '<option value="">' + (index ? 'Chọn tài khoản' : 'Chọn sổ tiền mặt') + '</option>' + rows.map(function (book) {
              var bank = book.thong_tin_ngan_hang || {}, label = index ? [bank.ten_ngan_hang, bank.so_tai_khoan, book.ten_so_quy].filter(Boolean).join(' - ') : book.ten_so_quy;
              return '<option value="' + escape(book._id) + '">' + escape(label) + '</option>';
            }).join('');
            if (keep && !rows.some(function (book) { return String(book._id) === keep; })) select.insertAdjacentHTML('beforeend', '<option value="' + escape(keep) + '">Sổ đã lưu (kiểm tra khi thanh toán)</option>');
            select.value = keep;
          });
        })).catch(function (error) { showError(error.message); pendingBooks = false; });
      }
    }
    function payload() {
      refresh(); var enabled = el('toggle').checked;
      return { vat_chua_request_key: requestKey, vat_chua_don_gia_giao_dich: idInput.value ? (amount(el('price').value) || 0) : 0,
        vat_chua_ghi_nhan_thu_chi: enabled,
        vat_chua_thanh_toan: { tien_mat: enabled ? (amount(el('cash').value) || 0) : 0, chuyen_khoan: enabled ? (amount(el('bank').value) || 0) : 0,
          so_quy_tien_mat_id: enabled ? el('cash-book').value : '', so_quy_chuyen_khoan_id: enabled ? el('bank-book').value : '', tien_tra_khach: 0 } };
    }
    function validate(options) {
      if (locked) return '';
      refresh(); var message = '', price = amount(el('price').value), count = qty(qtyInput.value), p = payload(), payment = p.vat_chua_thanh_toan;
      if (p.vat_chua_ghi_nhan_thu_chi) {
        if (!Number.isFinite(price) || price < 0) message = 'Đơn giá vật chứa phải là số không âm.';
        else if (price * Math.abs(count) <= 0) message = 'Thành tiền vật chứa phải lớn hơn 0 khi ghi vào Thu chi.';
        else if (![amount(el('cash').value), amount(el('bank').value)].every(Number.isFinite)) message = 'Tiền vật chứa phải là số không âm.';
        else if (payment.tien_mat + payment.chuyen_khoan > price * Math.abs(count)) message = 'Tiền vật chứa thực thu/chi không được vượt thành tiền vật chứa.';
        else if (!(options && options.draft) && payment.tien_mat > 0 && !payment.so_quy_tien_mat_id) message = 'Vui lòng chọn sổ tiền mặt cho vật chứa.';
        else if (!(options && options.draft) && payment.chuyen_khoan > 0 && !payment.so_quy_chuyen_khoan_id) message = 'Vui lòng chọn tài khoản chuyển khoản cho vật chứa.';
      }
      showError(message); return message;
    }
    function hydrate(data, options) {
      data = data || {};
      requestKey = options && options.preserveRequestKey && data.vat_chua_request_key || newRequestKey();
      locked = data.locked === true || data.has_cash_transactions === true;
      idInput.disabled = locked || initialDisabled.id;
      qtyInput.disabled = locked || initialDisabled.qty;
      el('lock').hidden = !locked;
      el('lock').textContent = locked ? (data.lock_reason || 'Vật chứa đã phát sinh Thu chi. Vui lòng dùng quy trình điều chỉnh chứng từ tiền trước khi thay đổi.') : '';
      var payment = data.vat_chua_thanh_toan || data.chi_tiet_thanh_toan || {};
      priceContainerId = idInput.value;
      hasPrice = Number(data.don_gia_giao_dich ?? data.vat_chua_don_gia_giao_dich ?? 0) > 0;
      el('price').value = money(data.don_gia_giao_dich ?? data.vat_chua_don_gia_giao_dich ?? 0);
      el('toggle').checked = data.ghi_nhan_thu_chi === true || data.vat_chua_ghi_nhan_thu_chi === true;
      el('cash').value = money(payment.tien_mat || 0); el('bank').value = money(payment.chuyen_khoan || 0);
      ['cash-book', 'bank-book'].forEach(function (name, index) {
        var value = payment[index ? 'so_quy_chuyen_khoan_id' : 'so_quy_tien_mat_id']; value = String(value && (value._id || value) || '');
        el(name).dataset.savedValue = value;
        if (value && !Array.from(el(name).options).some(function (option) { return option.value === value; })) el(name).insertAdjacentHTML('beforeend', '<option value="' + escape(value) + '">Sổ đã lưu</option>');
        el(name).value = value;
      });
      showError(''); refresh();
    }
    [idInput, qtyInput, el('toggle')].forEach(function (input) { input.addEventListener('input', refresh); input.addEventListener('change', refresh); });
    ['price', 'cash', 'bank'].forEach(function (name) {
      el(name).addEventListener('input', function () { if (name === 'price') hasPrice = true; refresh(); showError(''); });
      el(name).addEventListener('blur', function () { var value = amount(el(name).value); if (Number.isFinite(value)) el(name).value = money(value); refresh(); });
    });
    var api = { payload: payload, validate: validate, hydrate: hydrate, refresh: refresh, host: host };
    instances.set(host, api); hydrate({}); return api;
  }
  function scan(root) { (root || document).querySelectorAll('[data-vat-chua-payment]').forEach(mount); }
  function get(inputId) {
    var host = Array.from(document.querySelectorAll('[data-vat-chua-payment]')).find(function (node) { return node.dataset.vcId === inputId; });
    return host ? mount(host) : null;
  }
  window.KVVatChuaPayment = { scan: scan, get: get,
    payload: function (id) { var api = get(id); return api ? api.payload() : {}; },
    validate: function (id, options) { var api = get(id); return api ? api.validate(options) : ''; },
    hydrate: function (id, data, options) { var api = get(id); if (api) api.hydrate(data, options); } };
  function start() { scan(); new MutationObserver(function () { scan(); }).observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}());
