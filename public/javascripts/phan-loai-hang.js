(function(window, document) {
  'use strict';
  if (window.KVPhanLoaiHang) return;
  var base = '/api/kho/phan-loai', active = null, overlay, focusBefore, toastTimer;
  function ref(value) { return String(value && value._id || value || ''); }
  function esc(value) { return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function fmt(value) { return Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 6 }); }
  function date(value) { var d = value && new Date(value); return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('vi-VN') : '---'; }
  function nonce() { return window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : 'pl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }
  function number(value) { var text = String(value || '').trim().replace(/\s/g, ''); if (text.indexOf(',') !== -1) text = text.replace(/\./g, '').replace(',', '.'); return Number(text); }
  function key(row) { return ref(row.gia_tri_thuoc_tinh_id) || String(row.ten_quy_cach || '').trim(); }
  function label(row) { return row.ten_quy_cach || row.ten_thuoc_tinh || 'Chưa phân loại'; }
  function option(value, text, selected) { return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(text) + '</option>'; }
  async function request(url, options) {
    var response = await fetch(url, Object.assign({ credentials: 'same-origin', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } }, options || {}));
    var json; try { json = await response.json(); } catch (_) { throw new Error('Không đọc được phản hồi. Hãy thử lại với cùng dữ liệu.'); }
    if (!response.ok || json.success === false) throw Object.assign(new Error(json.message || 'Không thể thực hiện phân loại.'), { statusCode: response.status });
    return json.data !== undefined ? json.data : json;
  }
  function ensureModal() {
    if (overlay) return;
    overlay = document.createElement('div'); overlay.className = 'classification-overlay'; overlay.hidden = true;
    overlay.innerHTML = '<section class="classification-dialog" role="dialog" aria-modal="true" aria-labelledby="classificationTitle"><header class="classification-head"><h2 id="classificationTitle">Phân loại hàng hóa</h2><button type="button" class="classification-close" data-classify-close aria-label="Đóng">×</button></header><div class="classification-body" data-classify-body></div><footer class="classification-foot" data-classify-foot></footer></section>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(event) { if (event.target === overlay || event.target.closest('[data-classify-close]')) close(); });
    overlay.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      var nodes = Array.prototype.filter.call(overlay.querySelectorAll('button,input,select,textarea,a[href]'), function(node) { return !node.disabled && node.getClientRects().length; });
      var first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }
  function close() { if (active && active.saving) return; if (overlay) { overlay.hidden = true; overlay.querySelector('.classification-head [data-classify-close]').disabled = false; } active = null; if (focusBefore && focusBefore.isConnected) focusBefore.focus(); }
  function status(message, type) { var node = overlay.querySelector('[data-classify-status]'); if (node) { node.textContent = message || ''; node.className = 'classification-status' + (type ? ' is-' + type : ''); } }
  function toast(message) { var old = document.querySelector('.classification-toast'); if (old) old.remove(); var node = document.createElement('div'); node.className = 'classification-toast'; node.setAttribute('role', 'status'); node.textContent = message; document.body.appendChild(node); clearTimeout(toastTimer); toastTimer = setTimeout(function() { node.remove(); }, 6000); }
  function contextQuery(state) { var params = new URLSearchParams(); Object.keys(state.input).forEach(function(name) { if (state.input[name] != null && state.input[name] !== '') params.set(name, state.input[name]); }); return params.toString(); }
  async function loadContext(state) {
    var serial = ++state.serial;
    overlay.querySelector('[data-classify-body]').innerHTML = '<p role="status">Đang tải tồn và điều kiện phân loại...</p>';
    overlay.querySelector('[data-classify-foot]').innerHTML = '<button type="button" class="classification-btn" data-classify-close>Đóng</button>';
    try { var data = await request(base + '/context?' + contextQuery(state)); if (active !== state || serial !== state.serial) return; state.context = data; render(state); }
    catch (error) { if (active !== state || serial !== state.serial) return; overlay.querySelector('[data-classify-body]').innerHTML = '<p class="classification-status is-error" role="alert">' + esc(error.message) + '</p><button type="button" class="classification-btn" data-classify-reload>Thử tải lại</button>'; overlay.querySelector('[data-classify-reload]').onclick = function() { loadContext(state); }; }
  }
  function sourceRow(state) { return (state.context.quy_cach || [])[Number(overlay.querySelector('[data-classify-source]').value)] || null; }
  function sourceSelectOptions(state) { return (state.context.quy_cach || []).map(function(row, index) { return option(index, label(row) + ' · khả dụng ' + fmt(row.so_luong_kha_dung), state.preferredSource && label(row) === state.preferredSource); }).join(''); }
  function render(state) {
    var data = state.context, product = data.product || {}, warehouse = data.warehouse || {}, lot = data.lot || {}, purchase = data.purchase || data.phieu_nhap || {};
    if (warehouse._id) state.input.kho_id = ref(warehouse); if (lot._id) state.input.lo_hang_id = ref(lot);
    var warehouses = data.warehouses || (warehouse._id ? [warehouse] : []), lots = data.lots || (lot._id ? [lot] : []);
    var blocked = data.purchase_eligibility && data.purchase_eligibility.allowed === false && state.input.nguon_thao_tac === 'phieu_nhap';
    var warehouseSelect = '<label class="classification-field">Kho<select data-classify-warehouse' + (state.input.nguon_thao_tac === 'phieu_nhap' ? ' disabled' : '') + '>' + option('', 'Chọn kho', !state.input.kho_id) + warehouses.map(function(row) { return option(ref(row), row.ten_kho || row.ma_kho || 'Kho', ref(row) === ref(state.input.kho_id)); }).join('') + '</select></label>';
    var lotSelect = product.quan_ly_theo_lo ? '<label class="classification-field">Lô<select data-classify-lot' + (state.input.nguon_thao_tac === 'phieu_nhap' && state.input.lo_hang_id ? ' disabled' : '') + '>' + option('', 'Chọn lô', !state.input.lo_hang_id) + lots.map(function(row) { return option(ref(row), row.ten_lo || row.ma_lo || 'Lô', ref(row) === ref(state.input.lo_hang_id)); }).join('') + '</select></label>' : '<label class="classification-field">Lô<input readonly value="Không quản lý lô"></label>';
    overlay.querySelector('#classificationTitle').textContent = 'Phân loại hàng hóa';
    var body = overlay.querySelector('[data-classify-body]');
    body.innerHTML = '<p class="classification-meta"><strong>' + esc(product.ma_hang ? product.ma_hang + ' · ' : '') + esc(product.ten_hang || 'Hàng hóa') + '</strong><br>' + (state.input.nguon_thao_tac === 'phieu_nhap' ? 'Từ phiếu nhập ' + esc(purchase.ma_phieu_nhap || data.purchase_code || state.purchaseCode || '') : 'Phân loại trực tiếp tại kho') + '</p><div class="classification-grid">' + warehouseSelect + lotSelect + '</div><div class="classification-status' + (blocked ? ' is-error' : '') + '" role="alert" data-classify-status>' + (blocked ? esc(data.purchase_eligibility.reason || 'Phiếu nhập không còn đủ điều kiện phân loại. Hãy sử dụng Phân loại tại kho.') : '') + '</div>' + (blocked ? '<button type="button" class="classification-btn" data-classify-at-warehouse>Phân loại tại kho</button>' : '') + '<label class="classification-field">Phân loại nguồn<select data-classify-source>' + (sourceSelectOptions(state) || option('', 'Chưa có tồn theo phân loại')) + '</select></label><div class="classification-stats"><span>Tồn thực tế<strong data-classify-stock>0</strong></span><span>Khách đang đặt<strong data-classify-reserved>0</strong></span><span>Khả dụng<strong data-classify-available>0</strong></span></div><div class="classification-section-head"><h3>Phân loại đích</h3><button type="button" class="classification-btn" data-classify-add>+ Thêm dòng</button></div><div data-classify-targets></div><div class="classification-summary"><span>Tổng chuyển<strong data-classify-total>0</strong></span><span>Khả dụng còn lại<strong data-classify-remaining>0</strong></span><span>Chênh lệch tăng / giảm<strong data-classify-difference>0</strong></span></div><label class="classification-field">Ghi chú<textarea rows="2" maxlength="2000" data-classify-note></textarea></label>' + (data.bootstrap_required ? '<p class="classification-status is-info">Tồn cũ sẽ được đối soát và khởi tạo tồn theo phân loại trong cùng giao dịch khi xác nhận. Tổng tồn không tăng.</p>' : '');
    overlay.querySelector('[data-classify-foot]').innerHTML = '<button type="button" class="classification-btn" data-classify-close>Bỏ qua</button><button type="button" class="classification-btn primary" data-classify-submit>Xác nhận phân loại</button>';
    state.blocked = blocked;
    body.querySelector('[data-classify-warehouse]').onchange = function(event) { state.input.kho_id = event.target.value; state.input.lo_hang_id = null; loadContext(state); };
    var lotInput = body.querySelector('[data-classify-lot]'); if (lotInput) lotInput.onchange = function(event) { state.input.lo_hang_id = event.target.value || null; loadContext(state); };
    body.querySelector('[data-classify-source]').onchange = function() { updateTargets(state); updateSummary(state); };
    body.querySelector('[data-classify-add]').onclick = function() { addTarget(state); };
    var warehouseButton = body.querySelector('[data-classify-at-warehouse]'); if (warehouseButton) warehouseButton.onclick = function() { state.input.nguon_thao_tac = 'ton_kho'; delete state.input.phieu_nhap_id; delete state.input.ct_phieu_nhap_id; state.requestKey = nonce(); loadContext(state); };
    overlay.querySelector('[data-classify-submit]').onclick = function() { submit(state); };
    addTarget(state); updateSummary(state);
    var focus = body.querySelector('[data-classify-source]'); if (focus) focus.focus();
  }
  function targetOptions(state) { var src = sourceRow(state); return (state.context.options || []).filter(function(row) { return !src || key(row) !== key(src); }).map(function(row) { return '<option value="' + esc(label(row)) + '"></option>'; }).join(''); }
  function addTarget(state) {
    var row = document.createElement('div'); row.className = 'classification-target';
    var listId = 'classificationTargets-' + nonce();
    row.innerHTML = '<div><input type="text" maxlength="120" list="' + listId + '" data-classify-target-name aria-label="Phân loại đích" placeholder="Chọn hoặc nhập phân loại đích"><datalist id="' + listId + '">' + targetOptions(state) + '</datalist></div><input type="text" inputmode="decimal" data-classify-target-qty aria-label="Số lượng chuyển" placeholder="Số lượng"><button type="button" aria-label="Xóa dòng đích">×</button>';
    overlay.querySelector('[data-classify-targets]').appendChild(row);
    row.querySelector('[data-classify-target-name]').oninput = function() { updateSummary(state); };
    row.querySelector('[data-classify-target-qty]').oninput = function() { updateSummary(state); };
    row.querySelector('button').onclick = function() { row.remove(); updateSummary(state); };
    updateSummary(state);
  }
  function updateTargets(state) { overlay.querySelectorAll('.classification-target datalist').forEach(function(list) { list.innerHTML = targetOptions(state); }); }
  function readTargets(state) { return Array.prototype.map.call(overlay.querySelectorAll('.classification-target'), function(row) { var name = row.querySelector('[data-classify-target-name]').value.trim(), target = (state.context.options || []).find(function(option) { return label(option) === name; }); return !name ? null : Object.assign({}, target || { ten_quy_cach: name }, { so_luong: number(row.querySelector('[data-classify-target-qty]').value) }); }); }
  function validate(state) {
    if (state.blocked) return state.context.purchase_eligibility.reason || 'Phiếu nhập không đủ điều kiện phân loại.';
    if (!state.input.kho_id) return 'Vui lòng chọn kho.';
    if (state.context.product && state.context.product.quan_ly_theo_lo && !state.input.lo_hang_id) return 'Vui lòng chọn lô.';
    var src = sourceRow(state); if (!src) return 'Chưa có tồn ở phân loại nguồn.';
    var targets = readTargets(state); if (!targets.length || targets.some(function(row) { return !row; })) return 'Vui lòng chọn đầy đủ phân loại đích.';
    var seen = {}, sum = 0;
    for (var i = 0; i < targets.length; i++) { var row = targets[i], identity = key(row); if (!String(row.ten_quy_cach || '').trim() || String(row.ten_quy_cach).length > 120 || /[\u0000-\u001f\u007f]/.test(row.ten_quy_cach)) return 'Tên phân loại đích không hợp lệ.'; if (identity === key(src) || label(row) === label(src)) return 'Phân loại đích phải khác phân loại nguồn.'; if (seen[identity]) return 'Mỗi phân loại đích chỉ chọn một lần.'; seen[identity] = true; if (!Number.isFinite(row.so_luong) || row.so_luong <= 0 || Math.abs(row.so_luong * 1e6 - Math.round(row.so_luong * 1e6)) > .00001) return 'Số lượng chuyển phải lớn hơn 0, tối đa 6 chữ số thập phân.'; sum += row.so_luong; }
    if (sum - Number(src.so_luong_kha_dung || 0) > .0000001) return 'Tổng chuyển vượt tồn khả dụng của phân loại nguồn.';
    return '';
  }
  function updateSummary(state) {
    if (active !== state) return;
    var src = sourceRow(state) || {}, targets = readTargets(state), sum = targets.reduce(function(total, row) { return total + (row && Number.isFinite(row.so_luong) && row.so_luong > 0 ? row.so_luong : 0); }, 0);
    [['stock',src.so_luong],['reserved',src.so_luong_dang_dat],['available',src.so_luong_kha_dung],['total',sum],['remaining',Number(src.so_luong_kha_dung || 0)-sum],['difference',0]].forEach(function(pair) { overlay.querySelector('[data-classify-' + pair[0] + ']').textContent = fmt(pair[1]); });
    var error = validate(state); overlay.querySelector('[data-classify-submit]').disabled = Boolean(error) || state.saving;
    var touched = Array.prototype.some.call(overlay.querySelectorAll('[data-classify-target-name],[data-classify-target-qty]'), function(node) { return node.value.trim() !== ''; });
    if (!state.blocked) status(touched ? error : '', touched && error ? 'error' : '');
  }
  async function submit(state) {
    if (active !== state || state.saving) return;
    var error = validate(state); if (error) { status(error, 'error'); return; }
    var src = sourceRow(state), body = Object.assign({}, state.input, { lo_hang_id: state.input.lo_hang_id || null, nguon: { ten_quy_cach: label(src), gia_tri_thuoc_tinh_id: ref(src.gia_tri_thuoc_tinh_id) || null }, dich: readTargets(state).map(function(row) { return { ten_quy_cach: label(row), gia_tri_thuoc_tinh_id: ref(row.gia_tri_thuoc_tinh_id) || null, so_luong: row.so_luong }; }), request_key: state.requestKey, ghi_chu: overlay.querySelector('[data-classify-note]').value.trim() });
    state.saving = true; overlay.querySelectorAll('button,input,select,textarea').forEach(function(node) { node.disabled = true; }); status('Đang phân loại...', 'info');
    try { var result = await request(base, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify(body) }); state.saving = false; close(); toast('Đã phân loại hàng hóa. Tổng tồn được giữ nguyên.'); document.dispatchEvent(new CustomEvent('stock:classified', { detail: { hang_hoa_id: body.hang_hoa_id, kho_id: body.kho_id, lo_hang_id: body.lo_hang_id, history: result } })); refreshProduct(body.hang_hoa_id); }
    catch (error) { if (active !== state) return; state.saving = false; overlay.querySelectorAll('button,input,select,textarea').forEach(function(node) { node.disabled = false; }); if (state.input.nguon_thao_tac === 'phieu_nhap') { overlay.querySelector('[data-classify-warehouse]').disabled = true; var lotSelect = overlay.querySelector('[data-classify-lot]'); if (lotSelect && state.input.lo_hang_id) lotSelect.disabled = true; } status(error.message, 'error'); overlay.querySelector('[data-classify-submit]').disabled = Boolean(validate(state)); }
  }
  async function open(input, trigger) { ensureModal(); focusBefore = trigger || document.activeElement; overlay.querySelector('.classification-head [data-classify-close]').disabled = false; active = { input: Object.assign({ nguon_thao_tac: 'ton_kho' }, input), serial: 0, requestKey: nonce(), preferredSource: input.ten_quy_cach || '', purchaseCode: input.purchase_code || '' }; delete active.input.ten_quy_cach; delete active.input.purchase_code; overlay.hidden = false; await loadContext(active); }
  function inputFromTrigger(trigger) { var panel = trigger.closest('[data-product-id]'); return { hang_hoa_id: trigger.getAttribute('data-hang-hoa-id') || panel && panel.getAttribute('data-product-id') || '', kho_id: trigger.getAttribute('data-kho-id') || '', lo_hang_id: trigger.getAttribute('data-lo-hang-id') || null, nguon_thao_tac: trigger.getAttribute('data-nguon-thao-tac') || 'ton_kho', phieu_nhap_id: trigger.getAttribute('data-phieu-nhap-id') || undefined, ct_phieu_nhap_id: trigger.getAttribute('data-ct-phieu-nhap-id') || undefined, ten_quy_cach: trigger.getAttribute('data-ten-quy-cach') || '', purchase_code: trigger.getAttribute('data-purchase-code') || '' }; }
  function classificationCode(row) { return row.ma_phan_loai || 'PL-' + ref(row); }
  function sourceLink(row) { var purchase = row.phieu_nhap_id; return purchase ? '<a href="/nhap-hang?purchase=' + encodeURIComponent(ref(purchase)) + '">' + esc(purchase.ma_phieu_nhap || row.ma_phieu_nhap || 'Phiếu nhập') + '</a>' : '---'; }
  function historySummary(row) { return (row.chi_tiet || []).map(function(line) { return esc(label(line)) + ': ' + fmt(line.so_luong_truoc) + ' → ' + fmt(line.so_luong_sau); }).join('<br>'); }
  async function loadHistory(pane, page) {
    var productRoot = pane.closest('[data-product-id]'), productId = pane.getAttribute('data-product-id') || productRoot && productRoot.getAttribute('data-product-id'); if (!productId) return;
    pane._classificationPage = Math.max(1, Number(page || 1)); var serial = (pane._classificationSerial || 0) + 1; pane._classificationSerial = serial;
    pane.innerHTML = '<div class="classification-history"><p role="status">Đang tải lịch sử phân loại...</p></div>';
    try { var data = await request(base + '/history?hang_hoa_id=' + encodeURIComponent(productId) + '&page=' + pane._classificationPage + '&limit=10'); if (!pane.isConnected || pane._classificationSerial !== serial) return; var rows = data.items || data.rows || (Array.isArray(data) ? data : []), paging = data.pagination || data, totalPages = Number(paging.totalPages || 1), current = Number(paging.page || pane._classificationPage);
      pane.innerHTML = '<div class="classification-history"><div class="classification-history-toolbar"><strong>Lịch sử phân loại</strong><button type="button" class="classification-btn" data-classification-history-reload>Làm mới</button></div><div class="classification-history-table-wrap"><table><thead><tr><th>Mã phân loại</th><th>Ngày</th><th>Người thao tác</th><th>Kho / Lô</th><th>PN nguồn</th><th>Phân loại trước / sau</th><th class="num">Số lượng chuyển</th><th>Ghi chú</th><th></th></tr></thead><tbody>' + (rows.length ? rows.map(function(row) { var warehouse = row.kho_id || {}, lot = row.lo_hang_id || {}, user = row.nguoi_thuc_hien_id || {}; return '<tr><td>' + esc(classificationCode(row)) + '</td><td>' + esc(date(row.ngay_thuc_hien || row.created_at)) + '</td><td>' + esc(user.ho_ten || user.ten_nhan_vien || user.email || '---') + '</td><td>' + esc(warehouse.ten_kho || row.kho_ten || '---') + '<br>' + esc(lot.ten_lo || lot.ma_lo || 'Không lô') + '</td><td>' + sourceLink(row) + '</td><td>' + historySummary(row) + '</td><td class="num">' + fmt(row.tong_so_luong_chuyen) + '</td><td>' + esc(row.ghi_chu || '') + '</td><td><button type="button" class="classification-btn" data-classification-history-id="' + esc(ref(row)) + '">Chi tiết</button></td></tr>'; }).join('') : '<tr><td colspan="9">Chưa có lịch sử phân loại.</td></tr>') + '</tbody></table></div><div class="classification-history-pages"><button class="classification-btn" type="button" data-classification-page="' + (current - 1) + '"' + (current <= 1 ? ' disabled' : '') + '>Trước</button><span>Trang ' + current + ' / ' + totalPages + '</span><button class="classification-btn" type="button" data-classification-page="' + (current + 1) + '"' + (current >= totalPages ? ' disabled' : '') + '>Sau</button></div></div>'; pane.setAttribute('data-classification-loaded', '1');
    } catch (error) { if (pane._classificationSerial !== serial) return; pane.innerHTML = '<div class="classification-history"><p class="classification-status is-error">' + esc(error.message) + '</p><button type="button" class="classification-btn" data-classification-history-reload>Thử lại</button></div>'; }
  }
  async function openHistory(id, trigger) { ensureModal(); focusBefore = trigger; var state = { history: true }; active = state; overlay.hidden = false; overlay.querySelector('#classificationTitle').textContent = 'Chi tiết phân loại'; overlay.querySelector('[data-classify-body]').innerHTML = '<p role="status">Đang tải lịch sử...</p>'; overlay.querySelector('[data-classify-foot]').innerHTML = '<button class="classification-btn" type="button" data-classify-close>Đóng</button>'; try { var row = await request(base + '/history/' + encodeURIComponent(id)); if (active !== state) return; var warehouse = row.kho_id || {}, lot = row.lo_hang_id || {}, user = row.nguoi_thuc_hien_id || {}; overlay.querySelector('[data-classify-body]').innerHTML = '<p class="classification-meta"><strong>' + esc(classificationCode(row)) + '</strong><br>' + esc(date(row.ngay_thuc_hien || row.created_at)) + ' · ' + esc(user.ho_ten || user.email || '---') + '<br>Kho: ' + esc(warehouse.ten_kho || '---') + ' · Lô: ' + esc(lot.ten_lo || lot.ma_lo || 'Không lô') + '<br>PN nguồn: ' + sourceLink(row) + '</p><table><thead><tr><th>Loại dòng</th><th>Phân loại</th><th class="num">Trước</th><th class="num">Thay đổi</th><th class="num">Sau</th><th class="num">Giá vốn</th></tr></thead><tbody>' + (row.chi_tiet || []).map(function(line) { return '<tr><td>' + (line.loai_dong === 'nguon' ? 'Nguồn' : 'Đích') + '</td><td>' + esc(label(line)) + '</td><td class="num">' + fmt(line.so_luong_truoc) + '</td><td class="num">' + fmt(line.so_luong_thay_doi) + '</td><td class="num">' + fmt(line.so_luong_sau) + '</td><td class="num">' + fmt(line.gia_von) + '</td></tr>'; }).join('') + '</tbody></table><p>Tổng chuyển: <strong>' + fmt(row.tong_so_luong_chuyen) + '</strong></p><p>Ghi chú: ' + esc(row.ghi_chu || '---') + '</p>'; overlay.querySelector('[data-classify-close]').focus(); } catch (error) { if (active === state) overlay.querySelector('[data-classify-body]').innerHTML = '<p class="classification-status is-error" role="alert">' + esc(error.message) + '</p>'; } }
  function refreshProduct(productId) { document.querySelectorAll('.product-detail[data-product-id="' + productId + '"]').forEach(function(root) { var stock = root.querySelector('[data-tab-panel="product-stock"]'); if (stock) { stock.removeAttribute('data-lazy-loaded'); if (stock.classList.contains('is-active') && stock.getAttribute('data-lazy-url')) fetch(stock.getAttribute('data-lazy-url'), { credentials: 'same-origin', headers: { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' } }).then(function(res) { if (!res.ok) throw new Error('Không tải được tồn mới.'); return res.text(); }).then(function(html) { stock.innerHTML = html; stock.setAttribute('data-lazy-loaded', '1'); }).catch(function() { stock.innerHTML = '<div class="empty-cell">Phân loại đã lưu. Chọn lại tab để tải tồn mới.</div>'; }); } var history = root.querySelector('[data-classification-history]'); if (history) { history.removeAttribute('data-classification-loaded'); if (history.classList.contains('is-active')) loadHistory(history, 1); } }); }
  document.addEventListener('click', function(event) {
    var trigger = event.target.closest('[data-classify-open]'); if (trigger) { event.preventDefault(); event.stopPropagation(); if (!trigger.disabled) open(inputFromTrigger(trigger), trigger); return; }
    var historyTab = event.target.closest('[data-tab-target="product-classification-history"]'); if (historyTab) { var root = historyTab.closest('[data-product-id]'), pane = root && root.querySelector('[data-classification-history]'); if (pane && pane.getAttribute('data-classification-loaded') !== '1') loadHistory(pane, 1); return; }
    var detail = event.target.closest('[data-classification-history-id]'); if (detail) { event.preventDefault(); openHistory(detail.getAttribute('data-classification-history-id'), detail); return; }
    var reload = event.target.closest('[data-classification-history-reload]'), page = event.target.closest('[data-classification-page]'); if (reload || page) { event.preventDefault(); var pane = (reload || page).closest('[data-classification-history]'); if (pane && !(reload || page).disabled) loadHistory(pane, page ? Number(page.getAttribute('data-classification-page')) : pane._classificationPage); }
  }, true);
  function watchPurchaseEligibility() {
    var watched = new WeakSet();
    async function check(trigger) {
      if (!trigger.isConnected || trigger.disabled || !trigger.hasAttribute('data-classify-check')) return;
      trigger.removeAttribute('data-classify-check');
      var input = inputFromTrigger(trigger); delete input.ten_quy_cach; delete input.purchase_code;
      var params = new URLSearchParams(); Object.keys(input).forEach(function(name) { if (input[name]) params.set(name, input[name]); });
      try { var data = await request(base + '/context?' + params.toString()), eligibility = data.purchase_eligibility; if (!trigger.isConnected || !eligibility) return; var reason = trigger.parentElement.querySelector('[data-classify-reason]'); trigger.disabled = eligibility.allowed === false; if (reason) { reason.textContent = eligibility.allowed === false ? (eligibility.reason || 'Nguồn nhập không đủ điều kiện. Hãy sử dụng Phân loại tại kho.') : ''; reason.hidden = eligibility.allowed !== false; } }
      catch (error) { if ([400, 403, 404, 409].indexOf(error.statusCode) !== -1 && trigger.isConnected) { trigger.disabled = true; var reason = trigger.parentElement.querySelector('[data-classify-reason]'); if (reason) { reason.textContent = error.message; reason.hidden = false; } } /* Network failures remain retryable by opening the modal. */ }
    }
    var intersection = window.IntersectionObserver ? new IntersectionObserver(function(entries) { entries.forEach(function(entry) { if (entry.isIntersecting) { intersection.unobserve(entry.target); check(entry.target); } }); }) : null;
    function scan() { document.querySelectorAll('[data-classify-check]').forEach(function(trigger) { if (watched.has(trigger)) return; watched.add(trigger); if (intersection) intersection.observe(trigger); else check(trigger); }); }
    scan(); new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchPurchaseEligibility); else watchPurchaseEligibility();
  window.KVPhanLoaiHang = { open: open, close: close, loadHistory: loadHistory };
})(window, document);
