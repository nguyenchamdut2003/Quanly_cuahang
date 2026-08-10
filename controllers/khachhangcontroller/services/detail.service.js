var { KhachHang, DiaChiKhachHang, DonHang, HoaDonBanHang, PhieuTraHang, CongNoKhachHang, NhapVatChua, XuatVatChua } = require('../../../models/kiot.model');
var {
    normalizeIdParam,
    formatDate,
    formatDateOnly
} = require('../helpers/common.helper');
var {
    formatGenderLabel,
    formatCustomerStatusLabel,
    formatDetailText,
    getCreatorName
} = require('../helpers/customer.helper');
var {
    normalizeFilterQuery,
    buildFilterQueryString
} = require('../helpers/filter.helper');
var { loadCustomerGroups } = require('./group.service');
var { loadAddressTypes } = require('./addressType.service');

var TAB_PAGE_SIZE = 10;

function parsePage(value) {
    var page = parseInt(value, 10);
    if (!Number.isFinite(page) || page < 1) return 1;
    return page;
}

function buildPagination(page, total, limit) {
    var totalPages = Math.max(1, Math.ceil(Number(total || 0) / limit));
    page = Math.min(Math.max(1, page), totalPages);
    var from = total > 0 ? ((page - 1) * limit) + 1 : 0;
    var to = total > 0 ? Math.min(total, page * limit) : 0;
    return {
        page: page,
        limit: limit,
        total: Number(total || 0),
        totalPages: totalPages,
        from: from,
        to: to,
        hasPrev: page > 1,
        hasNext: page < totalPages
    };
}

function makeTabContext(options) {
    options = options || {};
    var customerId = String(options.customerId || '');
    var tab = options.tab || '';
    return {
        selectedCustomer: options.selectedCustomer,
        baseUrl: '/khach-hang/api/' + encodeURIComponent(customerId) + '/' + tab,
        formatDate: formatDate,
        formatDateOnly: formatDateOnly,
        formatDetailText: formatDetailText
    };
}

async function findCustomer(customerId) {
    var cid = normalizeIdParam(customerId);
    if (!cid || !/^[a-f0-9]{24}$/i.test(cid)) return null;
    return KhachHang.findOne({ _id: cid }).lean();
}

async function loadCustomerDetail(options) {
    options = options || {};
    var cid = normalizeIdParam(options.customerId);
    if (!cid || !/^[a-f0-9]{24}$/i.test(cid)) return null;

    var selectedCustomer = await KhachHang.findOne({ _id: cid })
        .populate({ path: 'nguoi_tao_id', select: 'ho_ten email username' })
        .lean();
    if (!selectedCustomer) return null;

    var customerGroups = await loadCustomerGroups();
    var groupMap = customerGroups.reduce(function(map, group) {
        map[String(group._id)] = group.ten_nhom || '---';
        return map;
    }, {});
    selectedCustomer.nhom_khach_hang_ten = groupMap[String(selectedCustomer.nhom_khach_hang_id || '')] || '---';
    selectedCustomer.nguoi_tao_ten = getCreatorName(selectedCustomer);

    var filter = normalizeFilterQuery(options.query || {});
    var filterQueryString = buildFilterQueryString(filter);

    return {
        selectedCustomer: selectedCustomer,
        filterQueryString: filterQueryString,
        formatDate: formatDate,
        formatDateOnly: formatDateOnly,
        formatGenderLabel: formatGenderLabel,
        formatCustomerStatusLabel: formatCustomerStatusLabel,
        formatDetailText: formatDetailText,
        formatCreatorName: getCreatorName
    };
}

async function loadCustomerAddressesTab(options) {
    options = options || {};
    var selectedCustomer = await findCustomer(options.customerId);
    if (!selectedCustomer) return null;
    var filter = normalizeFilterQuery(options.query || {});
    var customerAddresses = await DiaChiKhachHang.find({
        khach_hang_id: selectedCustomer._id,
        trang_thai: 'active'
    }).sort({ created_at: -1 }).lean();
    var addressTypes = await loadAddressTypes();

    return Object.assign(makeTabContext({
        selectedCustomer: selectedCustomer,
        customerId: selectedCustomer._id,
        tab: 'addresses'
    }), {
        customerAddresses: customerAddresses,
        addressTypes: addressTypes,
        filterQueryString: buildFilterQueryString(filter)
    });
}

async function loadCustomerOrdersTab(options) {
    options = options || {};
    var selectedCustomer = await findCustomer(options.customerId);
    if (!selectedCustomer) return null;
    var page = parsePage((options.query || {}).page);
    var query = { khach_hang_id: selectedCustomer._id };
    var total = await DonHang.countDocuments(query);
    var pagination = buildPagination(page, total, TAB_PAGE_SIZE);
    var historyOrders = await DonHang.find(query)
        .sort({ ngay_dat: -1, created_at: -1 })
        .skip((pagination.page - 1) * TAB_PAGE_SIZE)
        .limit(TAB_PAGE_SIZE)
        .lean();

    return Object.assign(makeTabContext({
        selectedCustomer: selectedCustomer,
        customerId: selectedCustomer._id,
        tab: 'orders'
    }), {
        historyOrders: historyOrders,
        pagination: pagination
    });
}

async function loadCustomerInvoicesTab(options) {
    options = options || {};
    var selectedCustomer = await findCustomer(options.customerId);
    if (!selectedCustomer) return null;
    var page = parsePage((options.query || {}).page);
    var query = { khach_hang_id: selectedCustomer._id };
    var total = await HoaDonBanHang.countDocuments(query);
    var pagination = buildPagination(page, total, TAB_PAGE_SIZE);
    var historyInvoices = await HoaDonBanHang.find(query)
        .populate('don_hang_id')
        .sort({ ngay_ban: -1, created_at: -1 })
        .skip((pagination.page - 1) * TAB_PAGE_SIZE)
        .limit(TAB_PAGE_SIZE)
        .lean();

    return Object.assign(makeTabContext({
        selectedCustomer: selectedCustomer,
        customerId: selectedCustomer._id,
        tab: 'invoices'
    }), {
        historyInvoices: historyInvoices,
        pagination: pagination
    });
}

async function loadCustomerReturnsTab(options) {
    options = options || {};
    var selectedCustomer = await findCustomer(options.customerId);
    if (!selectedCustomer) return null;
    var page = parsePage((options.query || {}).page);
    var query = { khach_hang_id: selectedCustomer._id };
    var total = await PhieuTraHang.countDocuments(query);
    var pagination = buildPagination(page, total, TAB_PAGE_SIZE);
    var historyReturns = await PhieuTraHang.find(query)
        .populate('hoa_don_id')
        .sort({ ngay_tra: -1, created_at: -1 })
        .skip((pagination.page - 1) * TAB_PAGE_SIZE)
        .limit(TAB_PAGE_SIZE)
        .lean();

    return Object.assign(makeTabContext({
        selectedCustomer: selectedCustomer,
        customerId: selectedCustomer._id,
        tab: 'returns'
    }), {
        historyReturns: historyReturns,
        pagination: pagination
    });
}

function mapNhapVatChua(row) {
    return {
        loai: 'nhap_vat_chua',
        nhap_vat_chua_id: row._id,
        ma_phieu: row.ma_nhap_vat_chua || '--',
        thoi_gian: row.created_at,
        nguoi_tao: '--',
        so_luong: Number(row.tong_so_luong || row.so_luong || 0),
        tong_cong: Number(row.tong_tien || 0),
        trang_thai: row.trang_thai || 'active'
    };
}

function mapXuatVatChua(row) {
    return {
        loai: 'tra_vat_chua',
        xuat_vat_chua_id: row._id,
        ma_phieu: row.ma_xuat_vat_chua || '--',
        thoi_gian: row.created_at,
        nguoi_tao: '--',
        so_luong: Number(row.tong_so_luong || row.so_luong || 0),
        tong_cong: Number(row.tong_tien || 0),
        trang_thai: row.trang_thai || 'active'
    };
}

async function loadCustomerVatChuaTab(options) {
    options = options || {};
    var selectedCustomer = await findCustomer(options.customerId);
    if (!selectedCustomer) return null;
    var page = parsePage((options.query || {}).page);
    var nhapQuery = {
        doi_tuong_type: 'khach_hang',
        doi_tuong_id: selectedCustomer._id,
        trang_thai: 'active'
    };
    var xuatQuery = {
        doi_tuong_type: 'khach_hang',
        doi_tuong_id: selectedCustomer._id,
        trang_thai: 'active'
    };
    var nhapCount = await NhapVatChua.countDocuments(nhapQuery);
    var xuatCount = await XuatVatChua.countDocuments(xuatQuery);
    var nhapTotals = await NhapVatChua.aggregate([
        { $match: nhapQuery },
        {
            $group: {
                _id: null,
                so_luong: { $sum: { $ifNull: ['$tong_so_luong', { $ifNull: ['$so_luong', 0] }] } },
                tong_tien: { $sum: { $ifNull: ['$tong_tien', 0] } }
            }
        }
    ]);
    var xuatTotals = await XuatVatChua.aggregate([
        { $match: xuatQuery },
        {
            $group: {
                _id: null,
                so_luong: { $sum: { $ifNull: ['$tong_so_luong', { $ifNull: ['$so_luong', 0] }] } },
                tong_tien: { $sum: { $ifNull: ['$tong_tien', 0] } }
            }
        }
    ]);
    var total = nhapCount + xuatCount;
    var pagination = buildPagination(page, total, TAB_PAGE_SIZE);
    var fetchLimit = pagination.page * TAB_PAGE_SIZE;
    var nhapVatChuaRows = await NhapVatChua.find(nhapQuery).sort({ created_at: -1 }).limit(fetchLimit).lean();
    var xuatVatChuaRows = await XuatVatChua.find(xuatQuery).sort({ created_at: -1 }).limit(fetchLimit).lean();
    var allRows = nhapVatChuaRows.map(mapNhapVatChua).concat(xuatVatChuaRows.map(mapXuatVatChua));
    allRows.sort(function(a, b) {
        return new Date(b.thoi_gian || 0).getTime() - new Date(a.thoi_gian || 0).getTime();
    });
    var start = (pagination.page - 1) * TAB_PAGE_SIZE;
    var customerVatChuaHistory = allRows.slice(start, start + TAB_PAGE_SIZE);
    var nhapTotal = nhapTotals[0] || {};
    var xuatTotal = xuatTotals[0] || {};
    var totals = {
        so_luong: Number(nhapTotal.so_luong || 0) - Number(xuatTotal.so_luong || 0),
        tong_tien: Number(nhapTotal.tong_tien || 0) - Number(xuatTotal.tong_tien || 0)
    };

    return Object.assign(makeTabContext({
        selectedCustomer: selectedCustomer,
        customerId: selectedCustomer._id,
        tab: 'vat-chua'
    }), {
        customerVatChuaHistory: customerVatChuaHistory,
        customerVatChuaTotals: totals,
        pagination: pagination
    });
}

async function loadCustomerDebtsTab(options) {
    options = options || {};
    var selectedCustomer = await findCustomer(options.customerId);
    if (!selectedCustomer) return null;
    var page = parsePage((options.query || {}).page);
    var query = { khach_hang_id: selectedCustomer._id };
    var total = await CongNoKhachHang.countDocuments(query);
    var pagination = buildPagination(page, total, TAB_PAGE_SIZE);
    var historyDebts = await CongNoKhachHang.find(query)
        .populate('hoa_don_id')
        .populate('don_hang_id')
        .populate('phieu_thu_chi_id')
        .sort({ ngay: -1, created_at: -1 })
        .skip((pagination.page - 1) * TAB_PAGE_SIZE)
        .limit(TAB_PAGE_SIZE)
        .lean();

    return Object.assign(makeTabContext({
        selectedCustomer: selectedCustomer,
        customerId: selectedCustomer._id,
        tab: 'debts'
    }), {
        historyDebts: historyDebts,
        pagination: pagination
    });
}

module.exports = {
    loadCustomerDetail,
    loadCustomerAddressesTab,
    loadCustomerOrdersTab,
    loadCustomerInvoicesTab,
    loadCustomerReturnsTab,
    loadCustomerVatChuaTab,
    loadCustomerDebtsTab
};
