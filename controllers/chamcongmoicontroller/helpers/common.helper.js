function uniqueValues(items) {
  var seen = {};
  return items.filter(function(item) {
    if (!item || seen[item]) return false;
    seen[item] = true;
    return true;
  });
}

function cleanTime(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  var match24 = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (match24) {
    return pad2(Number(match24[1])) + ':' + match24[2];
  }
  var match12 = raw.match(/^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i);
  if (match12) {
    var hour = Number(match12[1]) % 12;
    if (/pm/i.test(match12[3])) hour += 12;
    return pad2(hour) + ':' + match12[2];
  }
  return null;
}

function toMoneyNumber(value) {
  var num = Number(String(value == null ? '' : value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num));
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
}

module.exports = { uniqueValues, cleanTime, toMoneyNumber, toBoolean };
