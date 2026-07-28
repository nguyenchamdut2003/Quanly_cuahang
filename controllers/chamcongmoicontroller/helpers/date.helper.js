function pad2(value) {
  return String(value).padStart(2, '0');
}

function normalizeDate(value) {
  var raw = String(value || '').trim();
  if (!raw) return null;
  var parts = raw.split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function parseDateInput(value) {
  return normalizeDate(value) || undefined;
}

function formatDate(date) {
  if (!date) return '';
  date = new Date(date);
  if (Number.isNaN(date.getTime())) return '';
  return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
}

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfWeek(value) {
  var date = normalizeDate(value) || new Date();
  date = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  var day = date.getUTCDay() || 7;
  return addDays(date, 1 - day);
}

function todayUtc() {
  var now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function minDate(a, b) {
  return a.getTime() <= b.getTime() ? a : b;
}

function formatMonth(date) {
  if (!date) return '';
  date = new Date(date);
  if (Number.isNaN(date.getTime())) return '';
  return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1);
}

function normalizeMonth(value) {
  var raw = String(value || '').trim();
  if (!raw) return null;
  var parts = raw.split('-').map(Number);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, 1));
}

function addMonths(date, months) {
  date = new Date(date);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function monthLabel(monthKey) {
  var parts = String(monthKey || '').split('-');
  if (parts.length !== 2) return '';
  return 'Tháng ' + parts[1] + '/' + parts[0];
}

function monthShortLabel(monthKey) {
  var parts = String(monthKey || '').split('-');
  if (parts.length !== 2) return '';
  return parts[1] + '/' + parts[0];
}

function monthBounds(monthKey) {
  var start = normalizeMonth(monthKey);
  if (!start) return null;
  return {
    start: start,
    end: addMonths(start, 1)
  };
}

function formatAttendanceDayDisplay(date) {
  if (!date) return '';
  date = new Date(date);
  if (Number.isNaN(date.getTime())) return '';
  return pad2(date.getUTCDate()) + '/' + pad2(date.getUTCMonth() + 1) + '/' + date.getUTCFullYear();
}

module.exports = {
  pad2, normalizeDate, parseDateInput, formatDate, addDays, startOfWeek, todayUtc, minDate,
  formatMonth, normalizeMonth, addMonths, monthLabel, monthShortLabel, monthBounds, formatAttendanceDayDisplay
};
