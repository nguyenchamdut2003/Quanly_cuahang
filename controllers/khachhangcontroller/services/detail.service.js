var { KhachHang, DiaChiKhachHang, NhapVatChua, XuatVatChua } = require('../../../models/kiot.model');
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
var { loadCustomerHistory } = require('./history.service');
var { loadCustomerGroups } = require('./group.service');
var { loadAddressTypes } = require('./addressType.service');

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

    var customerAddresses = await DiaChiKhachHang.find({ khach_hang_id: selectedCustomer._id }).sort({ created_at: -1 }).lean();
    var customerHistory = await loadCustomerHistory(selectedCustomer._id);
    var historyOrders = Array.isArray(customerHistory.orders) ? customerHistory.orders : [];
    var historyInvoices = Array.isArray(customerHistory.invoices) ? customerHistory.invoices : [];
    var historyReturns = Array.isArray(customerHistory.returns) ? customerHistory.returns : [];
    var historyDebts = Array.isArray(customerHistory.debts) ? customerHistory.debts : [];
    var nhapVatChuaRows = await NhapVatChua.find({
        doi_tuong_type: 'khach_hang',
        doi_tuong_id: selectedCustomer._id,
        trang_thai: 'active'
    }).sort({ created_at: -1 }).lean();
    var xuatVatChuaRows = await XuatVatChua.find({
        doi_tuong_type: 'khach_hang',
        doi_tuong_id: selectedCustomer._id,
        trang_thai: 'active'
    }).sort({ created_at: -1 }).lean();
    var customerVatChuaHistory = nhapVatChuaRows.map(function(row) {
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
    }).concat(xuatVatChuaRows.map(function(row) {
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
    }));
    customerVatChuaHistory.sort(function(a, b) {
        return new Date(b.thoi_gian || 0).getTime() - new Date(a.thoi_gian || 0).getTime();
    });

    var filter = normalizeFilterQuery(options.query || {});
    var filterQueryString = buildFilterQueryString(filter);
    var addressTypes = await loadAddressTypes();

    return {
        selectedCustomer: selectedCustomer,
        customerAddresses: customerAddresses,
        customerHistory: customerHistory,
        historyOrders: historyOrders,
        historyInvoices: historyInvoices,
        historyReturns: historyReturns,
        historyDebts: historyDebts,
        customerVatChuaHistory: customerVatChuaHistory,
        addressTypes: addressTypes,
        filterQueryString: filterQueryString,
        formatDate: formatDate,
        formatDateOnly: formatDateOnly,
        formatGenderLabel: formatGenderLabel,
        formatCustomerStatusLabel: formatCustomerStatusLabel,
        formatDetailText: formatDetailText,
        formatCreatorName: getCreatorName
    };
}

module.exports = {
    loadCustomerDetail
};
