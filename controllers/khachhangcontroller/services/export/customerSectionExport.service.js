var { KhachHang, DiaChiKhachHang, DonHang, HoaDonBanHang, PhieuTraHang, CongNoKhachHang } = require('../../../../models/kiot.model');
var { normalizeIdParam } = require('../../helpers/common.helper');
var { loadCustomerGroups } = require('../group.service');
var { loadAddressTypes } = require('../addressType.service');
var {
    ExcelJS,
    exportText,
    exportMoney,
    exportDate,
    exportCustomerType,
    exportGender,
    exportStatus,
    exportAddress,
    exportRelatedCode,
    safeExportFilenamePart,
    addExportSheet,
    addInfoSheet
} = require('../../helpers/excel.helper');
async function buildCustomerSectionWorkbook(customerId, section) {
    try {
        customerId = normalizeIdParam(customerId);
        section = normalizeIdParam(section);
        var sectionMap = {
            info: { label: 'thong-tin', sheet: 'Thong tin' },
            address: { label: 'dia-chi', sheet: 'Danh sach dia chi' },
            orders: { label: 'don-hang', sheet: 'Don hang' },
            invoices: { label: 'hoa-don', sheet: 'Hoa don' },
            returns: { label: 'tra-hang', sheet: 'Tra hang' },
            debts: { label: 'cong-no', sheet: 'Cong no' }
        };
        if (!customerId) { var invalidCustomer = new Error('invalid_customer'); invalidCustomer.code = 'invalid_customer'; throw invalidCustomer; }
        if (!sectionMap[section]) { var invalidSection = new Error('invalid_export_section'); invalidSection.code = 'invalid_export_section'; throw invalidSection; }

        var customerGroups = await loadCustomerGroups();
        var groupMap = customerGroups.reduce(function(map, group) {
            map[String(group._id)] = group.ten_nhom || '---';
            return map;
        }, {});
        var customer = await KhachHang.findOne({ _id: customerId }).lean();
        if (!customer) { var invalidCustomer = new Error('invalid_customer'); invalidCustomer.code = 'invalid_customer'; throw invalidCustomer; }
        customer.nhom_khach_hang_ten = groupMap[String(customer.nhom_khach_hang_id || '')] || '---';

        var workbook = new ExcelJS.Workbook();
        workbook.creator = 'Quan ly cua hang';
        workbook.created = new Date();

        if (section === 'info') {
            addInfoSheet(workbook, customer);
        }

        if (section === 'address') {
            var addressTypes = await loadAddressTypes();
            var addressTypeMap = addressTypes.reduce(function(map, type) {
                map[type.ma_loai] = type.ten_loai || type.ma_loai;
                return map;
            }, {});
            var addresses = await DiaChiKhachHang.find({
                khach_hang_id: customer._id,
                trang_thai: 'active'
            }).sort({ mac_dinh: -1, created_at: -1 }).lean();
            addExportSheet(workbook, 'Danh sách địa chỉ', [
                { header: 'Mã địa chỉ', key: 'ma_dia_chi', width: 16 },
                { header: 'Tên người nhận', key: 'ten_nguoi_nhan', width: 24 },
                { header: 'SĐT', key: 'sdt_nguoi_nhan', width: 16 },
                { header: 'Địa chỉ', key: 'dia_chi', width: 45 },
                { header: 'Loại địa chỉ', key: 'loai_dia_chi', width: 18 },
                { header: 'Mặc định', key: 'mac_dinh', width: 12 },
                { header: 'Ghi chú', key: 'ghi_chu', width: 28 },
                { header: 'Tạo lúc', key: 'created_at', width: 20 }
            ], addresses.map(function(address) {
                return {
                    ma_dia_chi: exportText(address.ma_dia_chi),
                    ten_nguoi_nhan: exportText(address.ten_nguoi_nhan),
                    sdt_nguoi_nhan: exportText(address.sdt_nguoi_nhan),
                    dia_chi: exportAddress(address),
                    loai_dia_chi: exportText(addressTypeMap[address.loai_dia_chi] || address.loai_dia_chi),
                    mac_dinh: address.mac_dinh ? 'Có' : 'Không',
                    ghi_chu: exportText(address.ghi_chu),
                    created_at: exportDate(address.created_at)
                };
            }));
        }

        if (section === 'orders') {
            var orders = await DonHang.find({ khach_hang_id: customer._id }).sort({ ngay_dat: -1, created_at: -1 }).lean();
            addExportSheet(workbook, 'Đơn hàng', [
                { header: 'Mã đơn hàng', key: 'ma_don_hang', width: 18 },
                { header: 'Ngày đặt', key: 'ngay_dat', width: 20 },
                { header: 'Tổng tiền hàng', key: 'tong_tien_hang', width: 16 },
                { header: 'Khách cần trả', key: 'tong_thanh_toan', width: 16 },
                { header: 'Khách đã trả', key: 'khach_thanh_toan', width: 16 },
                { header: 'Trạng thái đơn', key: 'trang_thai', width: 18 },
                { header: 'Giao hàng', key: 'trang_thai_giao_hang', width: 18 },
                { header: 'Ghi chú', key: 'ghi_chu', width: 28 }
            ], orders.map(function(order) {
                return {
                    ma_don_hang: exportText(order.ma_don_hang),
                    ngay_dat: exportDate(order.ngay_dat || order.created_at),
                    tong_tien_hang: exportMoney(order.tong_tien_hang || order.tong_tien),
                    tong_thanh_toan: exportMoney(order.tong_thanh_toan || order.tong_tien),
                    khach_thanh_toan: exportMoney(order.khach_thanh_toan || order.khach_da_tra),
                    trang_thai: exportText(order.trang_thai),
                    trang_thai_giao_hang: exportText(order.trang_thai_giao_hang),
                    ghi_chu: exportText(order.ghi_chu)
                };
            }));
        }

        if (section === 'invoices') {
            var invoices = await HoaDonBanHang.find({ khach_hang_id: customer._id })
                .populate('don_hang_id')
                .sort({ ngay_ban: -1, created_at: -1 })
                .lean();
            addExportSheet(workbook, 'Hóa đơn', [
                { header: 'Mã hóa đơn', key: 'ma_hoa_don', width: 18 },
                { header: 'Ngày bán', key: 'ngay_ban', width: 20 },
                { header: 'Tổng tiền', key: 'tong_tien', width: 16 },
                { header: 'Thanh toán', key: 'thanh_toan', width: 16 },
                { header: 'Trạng thái', key: 'trang_thai', width: 18 },
                { header: 'Đơn hàng', key: 'don_hang', width: 18 },
                { header: 'Ghi chú', key: 'ghi_chu', width: 28 }
            ], invoices.map(function(invoice) {
                return {
                    ma_hoa_don: exportText(invoice.ma_hoa_don),
                    ngay_ban: exportDate(invoice.ngay_ban || invoice.created_at),
                    tong_tien: exportMoney(invoice.tong_tien),
                    thanh_toan: exportMoney(invoice.thanh_toan || invoice.khach_da_tra),
                    trang_thai: exportText(invoice.trang_thai),
                    don_hang: exportRelatedCode(invoice.don_hang_id, ['ma_don_hang']),
                    ghi_chu: exportText(invoice.ghi_chu)
                };
            }));
        }

        if (section === 'returns') {
            var returns = await PhieuTraHang.find({ khach_hang_id: customer._id })
                .populate('hoa_don_id')
                .sort({ ngay_tra: -1, created_at: -1 })
                .lean();
            addExportSheet(workbook, 'Trả hàng', [
                { header: 'Mã phiếu trả', key: 'ma_phieu_tra', width: 18 },
                { header: 'Ngày trả', key: 'ngay_tra', width: 20 },
                { header: 'Hóa đơn gốc', key: 'hoa_don', width: 18 },
                { header: 'Tổng tiền trả', key: 'tong_tien_tra', width: 16 },
                { header: 'Trạng thái', key: 'trang_thai', width: 18 },
                { header: 'Ghi chú', key: 'ghi_chu', width: 30 }
            ], returns.map(function(item) {
                return {
                    ma_phieu_tra: exportText(item.ma_phieu_tra),
                    ngay_tra: exportDate(item.ngay_tra || item.created_at),
                    hoa_don: exportRelatedCode(item.hoa_don_id, ['ma_hoa_don']),
                    tong_tien_tra: exportMoney(item.can_tra_khach || item.tong_tien_tra),
                    trang_thai: exportText(item.trang_thai),
                    ghi_chu: exportText(item.ghi_chu)
                };
            }));
        }

        if (section === 'debts') {
            var debts = await CongNoKhachHang.find({ khach_hang_id: customer._id })
                .populate('hoa_don_id')
                .populate('don_hang_id')
                .populate('phieu_thu_chi_id')
                .sort({ ngay: -1, created_at: -1 })
                .lean();
            addExportSheet(workbook, 'Công nợ', [
                { header: 'Ngày', key: 'ngay', width: 20 },
                { header: 'Loại', key: 'loai', width: 16 },
                { header: 'Số tiền', key: 'so_tien', width: 16 },
                { header: 'Hóa đơn', key: 'hoa_don', width: 18 },
                { header: 'Đơn hàng', key: 'don_hang', width: 18 },
                { header: 'Phiếu thu chi', key: 'phieu_thu_chi', width: 18 },
                { header: 'Ghi chú', key: 'ghi_chu', width: 30 }
            ], debts.map(function(debt) {
                return {
                    ngay: exportDate(debt.ngay || debt.created_at),
                    loai: exportText(debt.loai),
                    so_tien: exportMoney(debt.so_tien),
                    hoa_don: exportRelatedCode(debt.hoa_don_id, ['ma_hoa_don']),
                    don_hang: exportRelatedCode(debt.don_hang_id, ['ma_don_hang']),
                    phieu_thu_chi: exportRelatedCode(debt.phieu_thu_chi_id, ['ma_phieu', 'ma_phieu_thu_chi']),
                    ghi_chu: exportText(debt.ghi_chu)
                };
            }));
        }

        workbook.worksheets.forEach(function(worksheet) {
            worksheet.eachRow(function(row, rowNumber) {
                if (rowNumber === 1) return;
                row.eachCell(function(cell) {
                    if (typeof cell.value === 'number') {
                        cell.numFmt = '#,##0';
                    }
                });
            });
        });

        var filename = 'khach-hang-' + safeExportFilenamePart(customer.ma_khach_hang || customer._id) + '-' + sectionMap[section].label + '.xlsx';
        return { workbook: workbook, filename: filename };
    } catch (error) {
        throw error;
    }
}

module.exports = {
    buildCustomerSectionWorkbook
};
