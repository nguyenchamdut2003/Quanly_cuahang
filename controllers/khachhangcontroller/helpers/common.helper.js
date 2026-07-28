function formatDate(value) {
    if (!value) return '---';
    return new Date(value).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDateOnly(value) {
    if (!value) return '---';
    return new Date(value).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function normalizeIdParam(value) {
    return String(value || '').trim();
}

function normalizeIdList(value) {
    var source = Array.isArray(value) ? value : [value];
    return source
        .map(function(item) { return String(item || '').trim(); })
        .filter(Boolean);
}

function shouldRespondJson(req) {
    var accept = String(req?.headers?.accept || '').toLowerCase();
    var requestedWith = String(req?.headers?.['x-requested-with'] || '').toLowerCase();
    return requestedWith === 'xmlhttprequest' || accept.indexOf('application/json') >= 0;
}

function buildCustomerReturnUrl(customerId, returnQueryRaw) {
    void customerId;
    var returnQuery = String(returnQueryRaw || '').trim().replace(/^\?/, '');
    var params = returnQuery ? returnQuery.split('&').filter(Boolean) : [];
    var paramsWithoutCustomer = params.filter(function(item) {
        return item.indexOf('customer=') !== 0;
    });
    return '/khach-hang' + (paramsWithoutCustomer.length ? '?' + paramsWithoutCustomer.join('&') : '');
}

function appendQueryParam(url, key, value) {
    var separator = url.indexOf('?') === -1 ? '?' : '&';
    return url + separator + encodeURIComponent(key) + '=' + encodeURIComponent(value);
}

module.exports = {
    formatDate,
    formatDateOnly,
    normalizeIdParam,
    normalizeIdList,
    shouldRespondJson,
    buildCustomerReturnUrl,
    appendQueryParam
};
