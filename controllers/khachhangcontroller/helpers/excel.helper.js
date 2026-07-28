var ExcelJS = require('exceljs');

function exportText(value) {
    if (value === null || typeof value === 'undefined' || value === '') return '---';
    return value;
}

function exportMoney(value) {
    return Number(value || 0);
}

function exportDate(value) {
    return value ? formatDate(value) : '---';
}

function exportCustomerType(value) {
    return value === 'cong_ty' ? 'Công ty' : 'Cá nhân';
}

function exportGender(value) {
    if (value === 'nam') return 'Nam';
    if (value === 'nu') return 'Nữ';
    if (value === 'khac') return 'Khác';
    return '---';
}

function exportStatus(value) {
    return value === 'inactive' ? 'Ngừng hoạt động' : 'Hoạt động';
}

function exportAddress(address) {
    return address.dia_chi_day_du || buildFullAddress(address) || '---';
}

function exportRelatedCode(item, fields) {
    if (!item) return '---';
    for (var i = 0; i < fields.length; i += 1) {
        if (item[fields[i]]) return item[fields[i]];
    }
    return '---';
}

function safeExportFilenamePart(value) {
    return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function applyExportWorksheetFormat(worksheet) {
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    worksheet.getRow(1).alignment = { vertical: 'middle' };
    worksheet.eachRow(function(row) {
        row.eachCell(function(cell) {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
            };
            cell.alignment = { vertical: 'top', wrapText: true };
        });
    });
}

function addExportSheet(workbook, name, columns, rows) {
    var worksheet = workbook.addWorksheet(name);
    worksheet.columns = columns;
    rows.forEach(function(row) {
        worksheet.addRow(row);
    });
    applyExportWorksheetFormat(worksheet);
    return worksheet;
}

function addInfoSheet(workbook, customer) {
    var worksheet = workbook.addWorksheet('Thông tin');
    worksheet.columns = [
        { header: 'Trường thông tin', key: 'label', width: 28 },
        { header: 'Giá trị', key: 'value', width: 42 }
    ];
    [
        ['Mã khách hàng', customer.ma_khach_hang],
        ['Tên khách hàng', customer.ten_khach_hang],
        ['Nhóm khách hàng', customer.nhom_khach_hang_ten],
        ['Loại khách hàng', exportCustomerType(customer.loai_khach_hang)],
        ['Số điện thoại', customer.sdt],
        ['Email', customer.email],
        ['Facebook', customer.facebook],
        ['Giới tính', exportGender(customer.gioi_tinh)],
        ['MST', customer.mst],
        ['Ngày sinh', exportDate(customer.ngay_sinh)],
        ['Tên công ty', customer.ten_cong_ty],
        ['Mã số thuế', customer.ma_so_thue],
        ['Người đại diện', customer.nguoi_dai_dien],
        ['Chức vụ người đại diện', customer.chuc_vu_nguoi_dai_dien],
        ['Tổng bán', exportMoney(customer.tong_ban)],
        ['Nợ hiện tại', exportMoney(customer.tong_no)],
        ['Khu vực giao hàng', customer.khu_vuc_giao_hang],
        ['Trạng thái', exportStatus(customer.trang_thai)],
        ['Ghi chú', customer.ghi_chu],
        ['Ngày tạo', exportDate(customer.created_at)],
        ['Cập nhật lúc', exportDate(customer.updated_at)]
    ].forEach(function(item) {
        worksheet.addRow({ label: item[0], value: exportText(item[1]) });
    });
    applyExportWorksheetFormat(worksheet);
    worksheet.getColumn('value').numFmt = '#,##0';
    return worksheet;
}


module.exports = {
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
    applyExportWorksheetFormat,
    addExportSheet,
    addInfoSheet
};

