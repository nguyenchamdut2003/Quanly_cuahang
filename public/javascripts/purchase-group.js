(function(global) {
  'use strict';
  function el(id) { return document.getElementById(id); }
  function money(value) { return Number(value || 0).toLocaleString('vi-VN') + ' VNĐ'; }
  function escape(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function(char) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]; }); }
  function id(value) { return String(value && value._id || value || ''); }
  function amount(value) {
    if (typeof value === 'number') return value;
    var raw = String(value || '0').replace(/\s/g, '');
    return Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/\./g, ''));
  }
  function errorAt(node, message) {
    if (!node) return;
    node.textContent = message || '';
    node.style.display = message ? 'block' : 'none';
  }
  async function json(url, body) {
    var options = { credentials: 'same-origin', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } };
    if (body !== undefined) {
      options.method = 'POST';
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    var response = await fetch(url, options);
    var result = await response.json();
    if (!response.ok || !result || !result.success) throw new Error(result && result.message || 'Không xử lý được yêu cầu.');
    return result;
  }

  function initMerge() {
    var overlay = el('purchaseMergeModalOverlay');
    if (!overlay) return;
    var selected = new Map();
    var rows = [];
    var page = 1;
    var totalPages = 1;
    var requestNumber = 0;
    var previewed = '';
    var busy = false;
    var timer;
    var supplier = el('purchaseMergeSupplierSelect');
    var status = el('purchaseMergeStatusSelect');
    var search = el('purchaseMergeSearch');
    var checkAll = el('purchaseMergeCheckAll');
    var submit = el('purchaseMergeSubmit');
    var preview = el('purchaseMergePreviewButton');
    function signature() { return Array.from(selected.keys()).sort().join(','); }
    function updateSelection() {
      el('purchaseMergeSelectionCount').textContent = 'Đã chọn ' + selected.size + ' phiếu';
      preview.disabled = busy || selected.size < 2;
      submit.disabled = busy || selected.size < 2 || signature() !== previewed;
      checkAll.checked = rows.length > 0 && rows.every(function(row) { return selected.has(id(row._id)); });
      checkAll.indeterminate = rows.some(function(row) { return selected.has(id(row._id)); }) && !checkAll.checked;
      el('purchaseMergePrev').disabled = busy || page <= 1;
      el('purchaseMergeNext').disabled = busy || page >= totalPages;
    }
    function invalidatePreview() {
      previewed = '';
      el('purchaseMergePreview').style.display = 'none';
      updateSelection();
    }
    function choose(row, checked) {
      var key = id(row._id);
      if (!checked) selected.delete(key);
      else {
        var first = selected.values().next().value;
        if (first && (id(first.nha_cung_cap_id) !== id(row.nha_cung_cap_id) || id(first.kho_id) !== id(row.kho_id))) {
          errorAt(el('purchaseMergeAlert'), 'Các phiếu phải cùng nhà cung cấp và kho. Bỏ chọn các phiếu hiện tại để chọn nhóm khác.');
          return false;
        }
        selected.set(key, row);
      }
      invalidatePreview();
      return true;
    }
    function renderRows() {
      el('purchaseMergeRows').innerHTML = rows.map(function(row) {
        var supplierRow = row.nha_cung_cap_id || {};
        var warehouse = row.kho_id || {};
        var date = new Date(row.ngay_nhap || row.created_at || '');
        return '<tr><td class="purchase-merge-check"><input class="purchase-merge-row-check" type="checkbox" value="' + escape(id(row._id)) + '"' + (selected.has(id(row._id)) ? ' checked' : '') + '></td>'
          + '<td>' + escape(row.ma_phieu_nhap) + '</td><td>' + escape(Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN')) + '</td>'
          + '<td>' + escape(warehouse.ten_kho || warehouse.ma_kho || '--') + '<br>' + (row.trang_thai === 'draft' ? 'Phiếu tạm' : 'Đã nhập hàng') + '</td>'
          + '<td class="num">' + money(row.can_tra_ncc ?? row.tong_tien) + '</td><td class="num">' + money(row.da_tra_ncc) + '</td>'
          + '<td>' + escape(supplierRow.ma_ncc) + '</td><td>' + escape(supplierRow.ten_ncc) + '</td></tr>';
      }).join('');
      el('purchaseMergeEmpty').style.display = rows.length ? 'none' : 'flex';
      el('purchaseMergeEmptyTitle').textContent = 'Không có phiếu đủ điều kiện gộp';
      el('purchaseMergeEmptyDesc').textContent = 'Đã loại phiếu hủy, không còn hiệu lực, gộp kiểu cũ, thuộc nhóm khác hoặc có trả hàng còn hiệu lực.';
      el('purchaseMergePageInfo').textContent = 'Trang ' + page + '/' + totalPages;
      Array.from(el('purchaseMergeRows').querySelectorAll('input')).forEach(function(input) {
        input.addEventListener('change', function() {
          var row = rows.find(function(item) { return id(item._id) === input.value; });
          if (!choose(row, input.checked)) input.checked = false;
          updateSelection();
        });
      });
      updateSelection();
    }
    async function loadRows() {
      var currentRequest = ++requestNumber;
      errorAt(el('purchaseMergeAlert'), '');
      if (!supplier.value) {
        rows = [];
        totalPages = 1;
        page = 1;
        renderRows();
        return;
      }
      var query = new URLSearchParams({ page: String(page), limit: '10', q: search.value || '', nha_cung_cap_id: supplier.value, trang_thai: status.value });
      try {
        var result = await json('/nhap-hang/tong-hop/eligible?' + query.toString());
        if (currentRequest !== requestNumber) return;
        rows = result.items || [];
        totalPages = result.totalPages || 1;
        page = result.page || page;
        renderRows();
      } catch (error) { if (currentRequest === requestNumber) errorAt(el('purchaseMergeAlert'), error.message); }
    }
    function close() { if (!busy) overlay.style.display = 'none'; }
    el('openPurchaseMergeModal').addEventListener('click', function() {
      clearTimeout(timer);
      selected.clear();
      previewed = '';
      page = 1;
      search.value = '';
      status.value = 'completed';
      var pageSupplier = document.querySelector('#poFilterForm [name="nha_cung_cap_id"]');
      var checked = Array.from(document.querySelectorAll('.purchase-select-check:checked'));
      var firstChecked = checked.map(function(input) { return input.closest('.purchase-row'); }).find(function(row) {
        return row && row.dataset.purchaseStatus === 'completed' && row.dataset.grouped !== '1' && row.dataset.hasReturn !== '1';
      });
      var supplierIds = Array.from(supplier.options).map(function(option) { return option.value; }).filter(Boolean);
      var preferredSuppliers = [pageSupplier && pageSupplier.value, firstChecked && firstChecked.dataset.supplierId, supplier.value].filter(Boolean);
      supplier.value = preferredSuppliers.find(function(value) { return supplierIds.includes(value); }) || supplierIds[0] || '';
      Array.from(document.querySelectorAll('.purchase-select-check:checked')).forEach(function(input) {
        var row = input.closest('.purchase-row');
        if (!row || row.dataset.grouped === '1' || row.dataset.hasReturn === '1' || row.dataset.purchaseStatus !== status.value || row.dataset.supplierId !== supplier.value) return;
        choose({ _id: input.value, nha_cung_cap_id: row.dataset.supplierId, kho_id: row.dataset.warehouseId }, true);
      });
      overlay.style.display = 'flex';
      el('purchaseMergeFoot').style.display = 'flex';
      el('purchaseMergePreview').style.display = 'none';
      updateSelection();
      loadRows();
    });
    el('purchaseMergeModalClose').addEventListener('click', close);
    el('purchaseMergeCancel').addEventListener('click', close);
    function resetFilter() {
      clearTimeout(timer);
      selected.clear();
      rows = [];
      invalidatePreview();
      page = 1;
      renderRows();
      loadRows();
    }
    supplier.addEventListener('change', resetFilter);
    status.addEventListener('change', resetFilter);
    search.addEventListener('input', function() { clearTimeout(timer); timer = setTimeout(function() { page = 1; loadRows(); }, 250); });
    el('purchaseMergePrev').addEventListener('click', function() { if (page > 1) { page -= 1; loadRows(); } });
    el('purchaseMergeNext').addEventListener('click', function() { if (page < totalPages) { page += 1; loadRows(); } });
    checkAll.addEventListener('change', function() {
      var checked = checkAll.checked;
      rows.forEach(function(row) { choose(row, checked); });
      renderRows();
    });
    preview.addEventListener('click', async function() {
      if (busy || selected.size < 2) return;
      busy = true;
      updateSelection();
      var requested = signature();
      errorAt(el('purchaseMergeAlert'), '');
      try {
        var result = await json('/nhap-hang/tong-hop/preview', { phieu_nhap_ids: Array.from(selected.keys()) });
        if (requested !== signature()) return;
        var totals = result.data.totals || {};
        el('purchaseMergePreview').textContent = 'Tổng giá trị: ' + money(totals.tong_tien) + ' · Đã nhập thực tế: ' + money(totals.tong_da_nhap) + ' · Dự kiến (phiếu tạm): ' + money(totals.tong_du_kien) + ' · Đã trả NCC: ' + money(totals.da_tra_ncc) + ' · Cần trả NCC: ' + money(totals.con_no_ncc);
        el('purchaseMergePreview').style.display = 'block';
        previewed = requested;
      } catch (error) { errorAt(el('purchaseMergeAlert'), error.message); }
      finally { busy = false; updateSelection(); }
    });
    submit.addEventListener('click', async function() {
      if (busy || !previewed || previewed !== signature()) return;
      busy = true;
      updateSelection();
      errorAt(el('purchaseMergeAlert'), '');
      try {
        var result = await json('/nhap-hang/tong-hop', { phieu_nhap_ids: Array.from(selected.keys()) });
        var groupId = result.data && (result.data._id || result.data.phieu_tong_hop_id);
        if (!groupId) throw new Error('Không nhận được mã phiếu tổng hợp.');
        location.href = '/nhap-hang?group=' + encodeURIComponent(groupId);
      } catch (error) { errorAt(el('purchaseMergeAlert'), error.message); busy = false; updateSelection(); }
    });
    var selectAll = document.querySelector('.po-table thead .row-check');
    var checks = Array.from(document.querySelectorAll('.purchase-select-check'));
    if (selectAll) selectAll.addEventListener('click', function(event) { event.stopPropagation(); checks.forEach(function(input) { input.checked = selectAll.checked; }); });
    checks.forEach(function(input) { input.addEventListener('change', function() {
      if (!selectAll) return;
      selectAll.checked = checks.length > 0 && checks.every(function(item) { return item.checked; });
      selectAll.indeterminate = checks.some(function(item) { return item.checked; }) && !selectAll.checked;
    }); });
  }

  function initSourceDetails() {
    var tables = document.querySelectorAll('.purchase-group-sources-table');
    function toggleSource(row, open) {
      var detail = row.nextElementSibling;
      if (!detail || !detail.matches('.purchase-source-detail-row')) return;
      var willOpen = typeof open === 'boolean' ? open : detail.hidden;
      detail.hidden = !willOpen;
      row.classList.toggle('is-expanded', willOpen);
      var link = row.querySelector('[data-purchase-source-toggle]');
      if (link) link.setAttribute('aria-expanded', String(willOpen));
    }
    tables.forEach(function(table) {
      if (table.dataset.sourcesBound === '1') return;
      table.dataset.sourcesBound = '1';
      table.addEventListener('click', function(event) {
        var row = event.target.closest('.purchase-source-row');
        if (!row || row.closest('table') !== table) return;
        var link = event.target.closest('[data-purchase-source-toggle]');
        if (!link && event.target.closest('a,button,input,select,textarea,label')) return;
        event.preventDefault();
        event.stopPropagation();
        toggleSource(row);
      });
    });
    document.querySelectorAll('[data-purchase-source-open]').forEach(function(link) {
      if (link.dataset.sourceBound === '1') return;
      link.dataset.sourceBound = '1';
      link.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        var group = link.closest('[data-purchase-group-detail]');
        if (!group) return;
        var row = Array.from(group.querySelectorAll('.purchase-source-row')).find(function(item) {
          return item.dataset.purchaseSourceId === link.dataset.purchaseSourceOpen;
        });
        if (!row) return;
        var tab = group.querySelector('.po-detail-tabs > [data-tab-target="sources"]');
        if (tab) tab.click();
        toggleSource(row, true);
      });
    });
  }

  function initDetail() {
    initSourceDetails();
    var overlay = el('purchaseGroupPayOverlay');
    if (!overlay || overlay.dataset.bound === '1') return;
    overlay.dataset.bound = '1';
    var groupId = '';
    var busy = false;
    var loading = false;
    var sequence = 0;
    var form = el('purchaseGroupPayForm');
    var debt = 0;
    var paymentSources = [];
    var payButton = el('purchaseGroupPaySubmit');
    function base() { return '/nhap-hang/tong-hop/' + encodeURIComponent(groupId); }
    async function books(type, select) {
      var result = await json('/api/so-quy/active?loai_so_quy=' + encodeURIComponent(type));
      var rows = (result.items || []).filter(function(row) { return row.loai_so_quy === type && row.trang_thai !== 'inactive'; });
      select.innerHTML = '<option value="">Chọn sổ quỹ</option>' + rows.map(function(row) { return '<option value="' + escape(row._id) + '">' + escape(row.ten_so_quy || row.ma_so_quy) + '</option>'; }).join('');
      var defaults = rows.filter(function(row) { return row.mac_dinh; });
      if (defaults.length || rows.length === 1) select.value = id((defaults[0] || rows[0])._id);
    }
    function readAllocations() {
      return Array.from(el('groupPayAllocations').querySelectorAll('[data-group-pay-source]')).map(function(input) {
        var source = paymentSources.find(function(row) { return id(row._id) === input.dataset.groupPaySource; });
        return { phieu_nhap_id: id(source._id), so_tien: amount(input.value), con_no_truoc: source.payment_debt };
      });
    }
    function sameMoney(left, right) {
      return Math.abs(left - right) <= Number.EPSILON * 8 * Math.max(1, Math.abs(left), Math.abs(right));
    }
    function allocationError(allocations, total) {
      if (!Number.isFinite(total) || total <= 0 || total > debt) return 'Số tiền phải lớn hơn 0 và không vượt công nợ đã phát sinh.';
      if (allocations.some(function(row) { return !Number.isFinite(row.so_tien) || row.so_tien < 0 || row.so_tien > row.con_no_truoc; })) {
        return 'Số tiền phân bổ phải từ 0 đến công nợ của từng phiếu nguồn.';
      }
      if (!sameMoney(allocations.reduce(function(sum, row) { return sum + row.so_tien; }, 0), total)) return 'Tổng phân bổ phải bằng tổng thanh toán.';
      return '';
    }
    function renderAllocations(sources) {
      paymentSources = (sources || []).filter(function(source) {
        return source.trang_thai === 'completed' && source.trang_thai_du_lieu !== 'inactive' && !source.deleted_at;
      }).map(function(source) {
        var current = source.payment_current || {};
        return Object.assign({}, source, { payment_debt: Math.max(0, Number(current.debt ?? source.con_no_ncc) || 0) });
      });
      el('groupPayAllocations').innerHTML = paymentSources.map(function(source) {
        var current = source.payment_current || {};
        return '<tr><td><a class="ref-link" href="/nhap-hang?purchase=' + encodeURIComponent(id(source._id)) + '">' + escape(source.ma_phieu_nhap) + '</a></td>'
          + '<td class="num">' + money(current.payable ?? source.can_tra_ncc ?? source.tong_tien) + '</td>'
          + '<td class="num">' + money(current.paid ?? source.da_tra_ncc) + '</td><td class="num">' + money(source.payment_debt) + '</td>'
          + '<td><input inputmode="decimal" autocomplete="off" value="0" data-group-pay-source="' + escape(id(source._id)) + '" aria-label="Phân bổ ' + escape(source.ma_phieu_nhap) + '"' + (source.payment_debt <= 0 ? ' disabled' : '') + '></td></tr>';
      }).join('') || '<tr><td colspan="5" class="empty-cell">Không có phiếu nguồn đã nhập hàng đủ điều kiện thanh toán.</td></tr>';
    }
    function update() {
      var cash = amount(el('groupPayCash').value);
      var bank = amount(el('groupPayBank').value);
      var allocations = readAllocations();
      var allocated = allocations.reduce(function(sum, row) { return sum + row.so_tien; }, 0);
      el('groupPayTotal').textContent = money(cash + bank);
      el('groupPayAllocated').textContent = money(allocated);
      el('groupPayDifference').textContent = money(sameMoney(cash + bank, allocated) ? 0 : cash + bank - allocated);
      el('groupPayAfter').textContent = money(Math.max(0, debt - cash - bank));
      el('groupPayCashBook').disabled = cash <= 0;
      el('groupPayBankBook').disabled = bank <= 0;
      payButton.disabled = busy || loading || cash < 0 || bank < 0 || Boolean(allocationError(allocations, cash + bank))
        || (cash > 0 && !el('groupPayCashBook').value) || (bank > 0 && !el('groupPayBankBook').value);
    }
    function close() {
      if (busy) return;
      sequence += 1;
      loading = false;
      overlay.classList.remove('open');
    }
    async function openPayment(nextId) {
      if (busy || loading) return;
      groupId = String(nextId || '');
      if (!groupId) return;
      var request = ++sequence;
      loading = true;
      form.reset();
      paymentSources = [];
      el('groupPayAllocations').innerHTML = '';
      errorAt(el('groupPayError'), '');
      debt = 0;
      el('groupPayTitle').textContent = 'Trả NCC';
      el('groupPaySupplier').textContent = '';
      el('groupPayCurrent').textContent = 'Đang tải...';
      overlay.classList.add('open');
      payButton.disabled = true;
      update();
      try {
        var fresh = await json(base());
        if (request !== sequence) return;
        if (fresh.data.trang_thai !== 'active') throw new Error('Phiếu tổng hợp đã tách, vui lòng thao tác trên phiếu nguồn.');
        debt = Number(fresh.data.totals.con_no_ncc || 0);
        renderAllocations(fresh.data.sources);
        el('groupPayTitle').textContent = 'Trả NCC - ' + (fresh.data.ma_phieu_tong_hop || '');
        var supplier = fresh.data.nha_cung_cap_id || {};
        el('groupPaySupplier').textContent = [supplier.ma_ncc, supplier.ten_ncc].filter(Boolean).join(' - ');
        el('groupPayCurrent').textContent = money(debt);
        await Promise.all([books('tien_mat', el('groupPayCashBook')), books('chuyen_khoan', el('groupPayBankBook'))]);
        if (request !== sequence) return;
        payButton.disabled = debt <= 0;
      } catch (error) {
        if (request === sequence) { errorAt(el('groupPayError'), error.message); payButton.disabled = true; }
      } finally {
        if (request === sequence) { loading = false; update(); }
      }
    }
    ['groupPayCash', 'groupPayBank'].forEach(function(name) { el(name).addEventListener('input', update); });
    ['groupPayCashBook', 'groupPayBankBook'].forEach(function(name) { el(name).addEventListener('change', update); });
    el('groupPayAllocations').addEventListener('input', update);
    el('groupPayAll').addEventListener('click', function() {
      el('groupPayCash').value = Number(debt).toLocaleString('vi-VN', { maximumFractionDigits: 20 });
      el('groupPayBank').value = '0';
      Array.from(el('groupPayAllocations').querySelectorAll('[data-group-pay-source]')).forEach(function(input) {
        var source = paymentSources.find(function(row) { return id(row._id) === input.dataset.groupPaySource; });
        input.value = source.payment_debt.toLocaleString('vi-VN', { maximumFractionDigits: 20 });
      });
      update();
    });
    el('purchaseGroupPayClose').addEventListener('click', close);
    el('purchaseGroupPayCancel').addEventListener('click', close);
    form.addEventListener('submit', async function(event) {
      event.preventDefault();
      if (busy || loading) return;
      var cash = amount(el('groupPayCash').value);
      var bank = amount(el('groupPayBank').value);
      var allocations = readAllocations();
      errorAt(el('groupPayError'), '');
      if (!Number.isFinite(cash + bank) || cash < 0 || bank < 0 || cash + bank <= 0 || cash + bank > debt) return errorAt(el('groupPayError'), 'Số tiền phải lớn hơn 0 và không vượt công nợ đã phát sinh.');
      var invalidAllocation = allocationError(allocations, cash + bank);
      if (invalidAllocation) return errorAt(el('groupPayError'), invalidAllocation);
      if (cash > 0 && !el('groupPayCashBook').value) return errorAt(el('groupPayError'), 'Vui lòng chọn sổ tiền mặt.');
      if (bank > 0 && !el('groupPayBankBook').value) return errorAt(el('groupPayError'), 'Vui lòng chọn tài khoản chuyển khoản.');
      busy = true;
      payButton.disabled = true;
      try {
        await json(base() + '/pay', { payment_v2: true, allocations: allocations, ghi_chu: el('groupPayNote').value, chi_tiet_thanh_toan: { tien_mat: cash, chuyen_khoan: bank, so_quy_tien_mat_id: el('groupPayCashBook').value, so_quy_chuyen_khoan_id: el('groupPayBankBook').value, tien_tra_khach: 0 } });
        location.href = '/nhap-hang?group=' + encodeURIComponent(groupId);
      } catch (error) { errorAt(el('groupPayError'), error.message); busy = false; update(); }
    });
    document.addEventListener('click', async function(event) {
      var pay = event.target.closest('[data-purchase-group-pay]');
      if (pay) {
        event.preventDefault();
        openPayment(pay.dataset.purchaseGroupPay);
        return;
      }
      var cancel = event.target.closest('[data-purchase-group-cancel]');
      if (!cancel) return;
      event.preventDefault();
      if (busy || !global.confirm('Tách phiếu tổng hợp này?')) return;
      busy = true;
      cancel.disabled = true;
      try {
        await json('/nhap-hang/tong-hop/' + encodeURIComponent(cancel.dataset.purchaseGroupCancel) + '/cancel', {});
        location.href = '/nhap-hang';
      } catch (error) { global.alert(error.message); busy = false; cancel.disabled = false; }
    });
  }
  global.PurchaseGroups = { initMerge: initMerge, initDetail: initDetail };
})(window);
