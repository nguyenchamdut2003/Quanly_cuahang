(function(global) {
    'use strict';

    var modalEl = null;
    var pending = null;

    function qs(sel, root) {
        return (root || document).querySelector(sel);
    }

    function parseExtraQuery(extraQs) {
        var params = new URLSearchParams();
        String(extraQs || '').replace(/^\?/, '').split('&').filter(Boolean).forEach(function(part) {
            var idx = part.indexOf('=');
            if (idx < 0) return;
            params.set(decodeURIComponent(part.slice(0, idx)), decodeURIComponent(part.slice(idx + 1)));
        });
        return params;
    }

    function toggleRangeFields(modal, show) {
        var wrap = qs('[data-debt-period-range]', modal);
        if (!wrap) return;
        wrap.hidden = !show;
        wrap.querySelectorAll('input[type="date"]').forEach(function(input) {
            input.required = !!show;
            if (!show) input.value = '';
        });
    }

    function validatePeriod(modal) {
        var modeInput = modal.querySelector('input[name="debtPeriodMode"]:checked');
        var mode = modeInput ? modeInput.value : 'all';
        if (mode !== 'range') return { ok: true, periodMode: 'all' };

        var fromInput = qs('[data-debt-period-from]', modal);
        var toInput = qs('[data-debt-period-to]', modal);
        var dateFrom = fromInput ? String(fromInput.value || '').trim() : '';
        var dateTo = toInput ? String(toInput.value || '').trim() : '';
        if (!dateFrom || !dateTo) {
            alert('Vui lòng nhập Từ ngày và Đến ngày.');
            return { ok: false };
        }
        if (dateFrom > dateTo) {
            alert('Từ ngày phải nhỏ hơn hoặc bằng Đến ngày.');
            return { ok: false };
        }
        return { ok: true, periodMode: 'range', dateFrom: dateFrom, dateTo: dateTo };
    }

    function buildExportUrl(baseUrl, exportKind, period, extraQs) {
        var params = parseExtraQuery(extraQs);
        params.set('periodMode', period.periodMode);
        if (period.periodMode === 'range') {
            params.set('dateFrom', period.dateFrom);
            params.set('dateTo', period.dateTo);
        }
        if (exportKind === 'quan-tri' || exportKind === 'doi-tac') {
            params.set('file', exportKind);
        }
        var query = params.toString();
        return baseUrl + (query ? '?' + query : '');
    }

    function ensureModal() {
        if (modalEl) return modalEl;
        modalEl = document.getElementById('debtPeriodExportModal');
        if (!modalEl) return null;

        modalEl.querySelectorAll('input[name="debtPeriodMode"]').forEach(function(radio) {
            radio.addEventListener('change', function() {
                toggleRangeFields(modalEl, radio.value === 'range' && radio.checked);
            });
        });

        var closeBtn = qs('.js-close-debt-period-modal', modalEl);
        var cancelBtn = qs('.js-cancel-debt-period-modal', modalEl);
        var submitBtn = qs('.js-submit-debt-period-modal', modalEl);

        function closeModal() {
            modalEl.classList.remove('is-open');
            modalEl.setAttribute('aria-hidden', 'true');
            pending = null;
        }

        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
        modalEl.addEventListener('click', function(ev) {
            if (ev.target === modalEl) closeModal();
        });

        if (submitBtn) {
            submitBtn.addEventListener('click', function() {
                if (!pending) return;
                var period = validatePeriod(modalEl);
                if (!period.ok) return;
                var url = buildExportUrl(pending.baseUrl, pending.exportKind, period, pending.extraQs);
                closeModal();
                window.location.href = url;
            });
        }

        return modalEl;
    }

    function openDebtPeriodExport(payload) {
        var modal = ensureModal();
        if (!modal) return;
        pending = payload || null;
        var allRadio = modal.querySelector('input[name="debtPeriodMode"][value="all"]');
        if (allRadio) allRadio.checked = true;
        toggleRangeFields(modal, false);
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
    }

    function bindTriggers(root) {
        (root || document).querySelectorAll('.js-debt-export-trigger').forEach(function(btn) {
            if (btn.getAttribute('data-debt-period-bound')) return;
            btn.setAttribute('data-debt-period-bound', '1');
            btn.addEventListener('click', function(ev) {
                ev.preventDefault();
                openDebtPeriodExport({
                    baseUrl: btn.getAttribute('data-export-base') || '',
                    exportKind: btn.getAttribute('data-export-kind') || 'both',
                    extraQs: btn.getAttribute('data-extra-qs') || ''
                });
            });
        });
    }

    global.KvDebtPeriodExport = {
        bind: bindTriggers,
        open: openDebtPeriodExport
    };

    document.addEventListener('DOMContentLoaded', function() {
        ensureModal();
        bindTriggers(document);
    });
})(window);
