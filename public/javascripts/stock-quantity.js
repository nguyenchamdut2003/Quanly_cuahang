(function(window) {
  'use strict';
  if (window.KVStockQuantity) return;
  function parse(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    var raw = String(value == null ? '' : value).replace(/\s/g, '');
    if (!raw) return 0;
    var normalized = raw.indexOf(',') !== -1 ? raw.replace(/\./g, '').replace(',', '.')
      : (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw);
    if (!/^-?\d*(\.\d*)?$/.test(normalized)) return 0;
    var number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  }
  function format(value) { return parse(value).toLocaleString('vi-VN', { maximumFractionDigits: 6 }); }
  window.KVStockQuantity = { parse: parse, format: format };
})(window);
