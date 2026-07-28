const { mongoose, NhaCungCap, parseMoney, SUPPLIER_DEBT_WARN_DEFAULT_DAYS } = require('./common.helper');

function normalizeFilterQuery(query) {
    query = query || {};
    var groupId = String(query.groupId || query.groupid || 'all').trim() || 'all';
    var status = query.status === 'active' || query.status === 'inactive' ? query.status : 'all';
    var totalBuyFrom = normalizeFilterMoneyField(query.totalBuyFrom);
    var totalBuyTo = normalizeFilterMoneyField(query.totalBuyTo);
    var currentDebtFrom = normalizeFilterMoneyField(query.currentDebtFrom);
    var currentDebtTo = normalizeFilterMoneyField(query.currentDebtTo);
    var created = ['all', 'today', '7days', '30days', 'custom'].indexOf(query.created) >= 0 ? query.created : 'all';
    var createdFrom = String(query.createdFrom || '').trim();
    var createdTo = String(query.createdTo || '').trim();
    var debtDaySort = String(query.debtDaySort || '').trim();
    if (['oldest', 'newest'].indexOf(debtDaySort) < 0) debtDaySort = '';
    var warnMinDaysRaw = parseInt(String(query.warnMinDays != null && query.warnMinDays !== '' ? query.warnMinDays : SUPPLIER_DEBT_WARN_DEFAULT_DAYS), 10);
    var warnMinDays = Number.isFinite(warnMinDaysRaw) && warnMinDaysRaw >= 0 ? warnMinDaysRaw : SUPPLIER_DEBT_WARN_DEFAULT_DAYS;

    return {
        groupId: groupId,
        status: status,
        totalBuyFrom: totalBuyFrom,
        totalBuyTo: totalBuyTo,
        currentDebtFrom: currentDebtFrom,
        currentDebtTo: currentDebtTo,
        created: created,
        createdFrom: createdFrom,
        createdTo: createdTo,
        debtDaySort: debtDaySort,
        warnOnly: String(query.warnOnly || '') === '1' ? '1' : '',
        warnMinDays: String(warnMinDays),
        warnMinAmount: normalizeFilterMoneyField(query.warnMinAmount)
    };
}

function normalizeFilterMoneyField(value) {
    var raw = String(value || '').trim();
    if (raw === '') return '';
    var amount = parseMoney(raw);
    if (!Number.isFinite(amount) || amount < 0) return '';
    return String(Math.floor(amount));
}

function formatFilterMoneyDisplay(value) {
    if (value === '' || value == null) return '';
    var amount = parseMoney(value);
    if (!Number.isFinite(amount)) return '';
    return amount.toLocaleString('vi-VN');
}

function hasFilterQueryValue(value) {
    return String(value ?? '').trim() !== '';
}

function getDateRange(filter) {
    var now = new Date();
    var start = null;
    var end = null;

    if (filter.created === 'today') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }
    if (filter.created === '7days') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }
    if (filter.created === '30days') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }
    if (filter.created === 'custom') {
        if (filter.createdFrom) {
            var parsedFrom = new Date(filter.createdFrom + 'T00:00:00');
            if (!isNaN(parsedFrom.getTime())) start = parsedFrom;
        }
        if (filter.createdTo) {
            var parsedTo = new Date(filter.createdTo + 'T23:59:59.999');
            if (!isNaN(parsedTo.getTime())) end = parsedTo;
        }
    }

    return { start: start, end: end };
}

function buildFilterQueryString(filter) {
    var params = [];
    if (filter.groupId !== 'all') params.push('groupId=' + encodeURIComponent(filter.groupId));
    if (filter.status !== 'all') params.push('status=' + encodeURIComponent(filter.status));
    if (hasFilterQueryValue(filter.totalBuyFrom)) params.push('totalBuyFrom=' + encodeURIComponent(filter.totalBuyFrom));
    if (hasFilterQueryValue(filter.totalBuyTo)) params.push('totalBuyTo=' + encodeURIComponent(filter.totalBuyTo));
    if (hasFilterQueryValue(filter.currentDebtFrom)) params.push('currentDebtFrom=' + encodeURIComponent(filter.currentDebtFrom));
    if (hasFilterQueryValue(filter.currentDebtTo)) params.push('currentDebtTo=' + encodeURIComponent(filter.currentDebtTo));
    if (filter.created !== 'all') params.push('created=' + encodeURIComponent(filter.created));
    if (filter.created === 'custom' && filter.createdFrom) params.push('createdFrom=' + encodeURIComponent(filter.createdFrom));
    if (filter.created === 'custom' && filter.createdTo) params.push('createdTo=' + encodeURIComponent(filter.createdTo));
    if (filter.debtDaySort === 'oldest' || filter.debtDaySort === 'newest') {
        params.push('debtDaySort=' + encodeURIComponent(filter.debtDaySort));
    }
    if (filter.warnOnly === '1') params.push('warnOnly=1');
    if (filter.warnMinDays && String(filter.warnMinDays) !== String(SUPPLIER_DEBT_WARN_DEFAULT_DAYS)) {
        params.push('warnMinDays=' + encodeURIComponent(filter.warnMinDays));
    }
    if (hasFilterQueryValue(filter.warnMinAmount)) {
        params.push('warnMinAmount=' + encodeURIComponent(filter.warnMinAmount));
    }
    return params.join('&');
}

function makeRangeFilter(minRaw, maxRaw) {
    var hasMinValue = hasFilterQueryValue(minRaw);
    var hasMaxValue = hasFilterQueryValue(maxRaw);
    if (!hasMinValue && !hasMaxValue) return null;

    var min = hasMinValue ? parseMoney(minRaw) : NaN;
    var max = hasMaxValue ? parseMoney(maxRaw) : NaN;
    var hasMin = hasMinValue && Number.isFinite(min);
    var hasMax = hasMaxValue && Number.isFinite(max);
    if (!hasMin && !hasMax) return null;

    var range = {};
    if (hasMin) range.$gte = min < 0 ? 0 : min;
    if (hasMax) range.$lte = max < 0 ? 0 : max;
    if (hasMin && hasMax && range.$gte > range.$lte) {
        var swap = range.$gte;
        range.$gte = range.$lte;
        range.$lte = swap;
    }
    return range;
}

function buildSupplierQueryFromFilter(filter) {
    var dateRange = getDateRange(filter);
    var supplierQuery = {};

    if (filter.groupId !== 'all') supplierQuery.nhom_nha_cung_cap_id = filter.groupId;
    if (filter.status !== 'all') supplierQuery.trang_thai = filter.status;
    if (dateRange.start || dateRange.end) {
        supplierQuery.created_at = {};
        if (dateRange.start) supplierQuery.created_at.$gte = dateRange.start;
        if (dateRange.end) supplierQuery.created_at.$lte = dateRange.end;
    }

    return supplierQuery;
}

function filterSuppliersByComputedTotals(suppliers, filter) {
    var totalBuyRange = makeRangeFilter(filter.totalBuyFrom, filter.totalBuyTo);
    var currentDebtRange = makeRangeFilter(filter.currentDebtFrom, filter.currentDebtTo);
    if (!totalBuyRange && !currentDebtRange) return suppliers;
    return suppliers.filter(function(supplier) {
        return isInRange(supplier.tong_mua, totalBuyRange) && isInRange(supplier.tong_no, currentDebtRange);
    });
}

function requiresComputedSupplierData(filter) {
    filter = filter || {};
    return Boolean(
        hasFilterQueryValue(filter.totalBuyFrom) ||
        hasFilterQueryValue(filter.totalBuyTo) ||
        hasFilterQueryValue(filter.currentDebtFrom) ||
        hasFilterQueryValue(filter.currentDebtTo) ||
        filter.warnOnly === '1' ||
        filter.debtDaySort === 'oldest' ||
        filter.debtDaySort === 'newest'
    );
}

module.exports = {
  normalizeFilterQuery,
  normalizeFilterMoneyField,
  formatFilterMoneyDisplay,
  hasFilterQueryValue,
  getDateRange,
  buildFilterQueryString,
  makeRangeFilter,
  buildSupplierQueryFromFilter,
  filterSuppliersByComputedTotals,
  requiresComputedSupplierData
};
