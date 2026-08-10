var { KhachHang } = require('../../../models/kiot.model');
var {
    normalizeFilterQuery,
    buildCustomerQueryFromFilter,
    applyCreatorFilter,
    makeRangeFilter,
    buildFilterQueryString
} = require('../helpers/filter.helper');
var {
    formatDate,
    formatDateOnly
} = require('../helpers/common.helper');
var {
    formatGenderLabel,
    formatCustomerStatusLabel,
    formatDetailText,
    getCreatorName
} = require('../helpers/customer.helper');
var { loadCustomerFinancialMetrics } = require('./metrics.service');
var { loadCustomerGroups } = require('./group.service');
var { loadAddressTypes } = require('./addressType.service');

var CUSTOMER_PAGE_SIZE = 10;

async function loadCustomerListPage(options) {
    options = options || {};
    var requestQuery = options.query || {};
    var filter = normalizeFilterQuery(requestQuery);
    var customerQuery = buildCustomerQueryFromFilter(filter);
    await applyCreatorFilter(customerQuery, filter.creatorKeyword);
    var totalSalesRange = makeRangeFilter(filter.totalSalesFrom, filter.totalSalesTo);
    var currentDebtRange = makeRangeFilter(filter.currentDebtFrom, filter.currentDebtTo);

    var customerGroups = await loadCustomerGroups();
    var addressTypes = await loadAddressTypes();
    var groupMap = customerGroups.reduce(function(map, group) {
        map[String(group._id)] = group.ten_nhom || '---';
        return map;
    }, {});

    var customers = await KhachHang.find(customerQuery)
        .populate({ path: 'nguoi_tao_id', select: 'ho_ten email username' })
        .sort({ created_at: -1, ma_khach_hang: 1 })
        .lean();
    var financialMap = await loadCustomerFinancialMetrics(customers.map(function(customer) { return customer._id; }));
    customers = customers.map(function(customer) {
        var metric = financialMap[String(customer._id)] || {};
        customer.tong_ban = Number(metric.tong_ban || 0);
        customer.tong_no = Number(metric.tong_no || 0);
        customer.tong_ban_tru_tra_hang = Number(metric.tong_ban_tru_tra_hang || 0);
        customer.nhom_khach_hang_ten = groupMap[String(customer.nhom_khach_hang_id || '')] || '---';
        customer.nguoi_tao_ten = getCreatorName(customer);
        return customer;
    });
    if (totalSalesRange) {
        customers = customers.filter(function(customer) {
            var value = Number(customer.tong_ban || 0);
            if (totalSalesRange.$gte !== undefined && value < totalSalesRange.$gte) return false;
            if (totalSalesRange.$lte !== undefined && value > totalSalesRange.$lte) return false;
            return true;
        });
    }
    if (currentDebtRange) {
        customers = customers.filter(function(customer) {
            var value = Number(customer.tong_no || 0);
            if (currentDebtRange.$gte !== undefined && value < currentDebtRange.$gte) return false;
            if (currentDebtRange.$lte !== undefined && value > currentDebtRange.$lte) return false;
            return true;
        });
    }
    var summaryTotals = customers.reduce(function(sum, customer) {
        sum.totalDebt += Number(customer.tong_no || 0);
        sum.totalSales += Number(customer.tong_ban || 0);
        sum.totalNetSales += Number(customer.tong_ban_tru_tra_hang || 0);
        return sum;
    }, { totalDebt: 0, totalSales: 0, totalNetSales: 0 });
    var totalCustomers = customers.length;
    var totalPages = Math.max(1, Math.ceil(totalCustomers / CUSTOMER_PAGE_SIZE));
    var page = parseInt(requestQuery.page, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    var start = (page - 1) * CUSTOMER_PAGE_SIZE;
    var pageCustomers = customers.slice(start, start + CUSTOMER_PAGE_SIZE);

    return {
        pageTitle: 'Khách hàng',
        activeMenu: 'khach-hang',
        user: options.user,
        flash: requestQuery,
        customers: pageCustomers,
        customerGroups: customerGroups,
        addressTypes: addressTypes,
        summaryTotals: summaryTotals,
        formMode: requestQuery.mode === 'create' ? 'create' : '',
        formatDate: formatDate,
        formatDateOnly: formatDateOnly,
        formatGenderLabel: formatGenderLabel,
        formatCustomerStatusLabel: formatCustomerStatusLabel,
        formatDetailText: formatDetailText,
        formatCreatorName: getCreatorName,
        filter: filter,
        filterQueryString: buildFilterQueryString(filter),
        pagination: {
            page: page,
            limit: CUSTOMER_PAGE_SIZE,
            total: totalCustomers,
            totalPages: totalPages,
            from: totalCustomers ? start + 1 : 0,
            to: Math.min(start + CUSTOMER_PAGE_SIZE, totalCustomers)
        }
    };
}

module.exports = {
    loadCustomerListPage
};
