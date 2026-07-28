var { KhachHang, DiaChiKhachHang } = require('../../../../models/kiot.model');
var {
    normalizeFilterQuery,
    buildCustomerQueryFromFilter,
    applyCreatorFilter,
    makeRangeFilter
} = require('../../helpers/filter.helper');
var { getCreatorName } = require('../../helpers/customer.helper');
var { loadCustomerFinancialMetrics } = require('../metrics.service');
var { loadCustomerGroups } = require('../group.service');
var {
    ExcelJS,
    exportText,
    exportMoney,
    exportDate,
    exportCustomerType,
    exportGender,
    exportStatus,
    exportAddress,
    safeExportFilenamePart,
    applyExportWorksheetFormat,
    addExportSheet,
    addInfoSheet,
    exportRelatedCode
} = require('../../helpers/excel.helper');
async function buildCustomerListWorkbook(query) {
    try {
        var filter = normalizeFilterQuery(query || {});
        var customerQuery = buildCustomerQueryFromFilter(filter);
        await applyCreatorFilter(customerQuery, filter.creatorKeyword);
        var totalSalesRange = makeRangeFilter(filter.totalSalesFrom, filter.totalSalesTo);
        var currentDebtRange = makeRangeFilter(filter.currentDebtFrom, filter.currentDebtTo);
        var customerGroups = await loadCustomerGroups();
        var groupMap = customerGroups.reduce(function(map, group) {
            map[String(group._id)] = group.ten_nhom || '---';
            return map;
        }, {});

        var customers = await KhachHang.find(customerQuery)
            .populate({ path: 'nguoi_tao_id', select: 'ho_ten email username' })
            .sort({ created_at: -1, ma_khach_hang: 1 })
            .lean();
        customers = customers.map(function(customer) {
            customer.nguoi_tao_ten = getCreatorName(customer);
            return customer;
        });
        var financialMap = await loadCustomerFinancialMetrics(customers.map(function(customer) { return customer._id; }));
        customers = customers.map(function(customer) {
            var metric = financialMap[String(customer._id)] || {};
            customer.tong_ban = Number(metric.tong_ban || 0);
            customer.tong_no = Number(metric.tong_no || 0);
            customer.tong_ban_tru_tra_hang = Number(metric.tong_ban_tru_tra_hang || 0);
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
        var customerIds = customers.map(function(customer) { return customer._id; });
        var addresses = customerIds.length
            ? await DiaChiKhachHang.find({ khach_hang_id: { $in: customerIds } }).sort({ mac_dinh: -1, created_at: -1 }).lean()
            : [];
        var addressMap = addresses.reduce(function(map, address) {
            var key = String(address.khach_hang_id);
            if (!map[key]) map[key] = address;
            return map;
        }, {});

        var workbook = new ExcelJS.Workbook();
        workbook.creator = 'Quan ly cua hang';
        workbook.created = new Date();
        var worksheet = workbook.addWorksheet('Khách hàng');
        worksheet.columns = [
            { header: 'Mã khách hàng', key: 'ma_khach_hang', width: 16 },
            { header: 'Tên khách hàng', key: 'ten_khach_hang', width: 28 },
            { header: 'Loại khách hàng', key: 'loai_khach_hang', width: 16 },
            { header: 'Nhóm khách hàng', key: 'nhom_khach_hang', width: 22 },
            { header: 'Điện thoại', key: 'sdt', width: 16 },
            { header: 'Email', key: 'email', width: 28 },
            { header: 'Giới tính', key: 'gioi_tinh', width: 12 },
            { header: 'MST', key: 'mst', width: 16 },
            { header: 'Nợ hiện tại', key: 'tong_no', width: 16 },
            { header: 'Tổng bán', key: 'tong_ban', width: 16 },
            { header: 'Tổng bán trừ trả hàng', key: 'tong_ban_tru_tra_hang', width: 22 },
            { header: 'Khu vực giao hàng', key: 'khu_vuc_giao_hang', width: 24 },
            { header: 'Địa chỉ mặc định', key: 'dia_chi_mac_dinh', width: 42 },
            { header: 'Người tạo', key: 'nguoi_tao_ten', width: 20 },
            { header: 'Trạng thái', key: 'trang_thai', width: 16 },
            { header: 'Ngày tạo', key: 'created_at', width: 20 },
            { header: 'Ghi chú', key: 'ghi_chu', width: 32 }
        ];

        customers.forEach(function(customer) {
            var address = addressMap[String(customer._id)];
            worksheet.addRow({
                ma_khach_hang: exportText(customer.ma_khach_hang),
                ten_khach_hang: exportText(customer.ten_khach_hang),
                loai_khach_hang: exportCustomerType(customer.loai_khach_hang),
                nhom_khach_hang: groupMap[String(customer.nhom_khach_hang_id || '')] || '---',
                sdt: exportText(customer.sdt),
                email: exportText(customer.email),
                gioi_tinh: exportGender(customer.gioi_tinh),
                mst: exportText(customer.mst),
                tong_no: exportMoney(customer.tong_no),
                tong_ban: exportMoney(customer.tong_ban),
                tong_ban_tru_tra_hang: exportMoney(customer.tong_ban_tru_tra_hang),
                khu_vuc_giao_hang: exportText(customer.khu_vuc_giao_hang),
                dia_chi_mac_dinh: address ? exportAddress(address) : '---',
                nguoi_tao_ten: exportText(customer.nguoi_tao_ten),
                trang_thai: exportStatus(customer.trang_thai),
                created_at: exportDate(customer.created_at),
                ghi_chu: exportText(customer.ghi_chu)
            });
        });

        applyExportWorksheetFormat(worksheet);
        ['tong_no', 'tong_ban', 'tong_ban_tru_tra_hang'].forEach(function(key) {
            worksheet.getColumn(key).numFmt = '#,##0';
        });
        return { workbook: workbook, filename: 'khach-hang.xlsx' };
    } catch (error) {
        throw error;
    }
}

module.exports = {
    buildCustomerListWorkbook
};
