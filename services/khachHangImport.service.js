var ExcelJS = require('exceljs');

var CUSTOMER_IMPORT_COLUMNS = [
    { header: 'Loại khách hàng', key: 'loai_khach_hang', width: 18 },
    { header: 'Tên khách hàng', key: 'ten_khach_hang', width: 28 },
    { header: 'Số điện thoại', key: 'sdt', width: 16 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Facebook', key: 'facebook', width: 24 },
    { header: 'Ngày sinh', key: 'ngay_sinh', width: 14 },
    { header: 'Giới tính', key: 'gioi_tinh', width: 12 },
    { header: 'MST', key: 'mst', width: 16 },
    { header: 'Tên công ty', key: 'ten_cong_ty', width: 24 },
    { header: 'Mã số thuế', key: 'ma_so_thue', width: 18 },
    { header: 'Ghi chú', key: 'ghi_chu', width: 28 },
    { header: 'Trạng thái', key: 'trang_thai', width: 18 },
    { header: 'Tên người nhận', key: 'ten_nguoi_nhan', width: 22 },
    { header: 'SĐT người nhận', key: 'sdt_nguoi_nhan', width: 16 },
    { header: 'Địa chỉ chi tiết', key: 'dia_chi_chi_tiet', width: 32 },
    { header: 'Phường/xã', key: 'phuong_xa', width: 20 },
    { header: 'Tỉnh/thành', key: 'tinh_thanh', width: 20 }
];

var CUSTOMER_IMPORT_SAMPLE_ROW = {
    loai_khach_hang: 'Cá nhân',
    ten_khach_hang: 'Nguyễn Văn A',
    sdt: '0901234567',
    email: 'khachhang@example.com',
    facebook: 'facebook.com/username',
    ngay_sinh: '01/01/1990',
    gioi_tinh: 'Nam',
    mst: '0123456789',
    ten_cong_ty: '',
    ma_so_thue: '',
    ghi_chu: '',
    trang_thai: 'Đang hoạt động',
    ten_nguoi_nhan: 'Nguyễn Văn A',
    sdt_nguoi_nhan: '0901234567',
    dia_chi_chi_tiet: '123 Nguyễn Huệ',
    phuong_xa: 'Bến Nghé',
    tinh_thanh: 'TP. Hồ Chí Minh'
};

function normalizeHeader(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function cellText(value) {
    if (value === null || typeof value === 'undefined') return '';
    if (typeof value === 'object') {
        if (value instanceof Date) {
            return value.toISOString().slice(0, 10);
        }
        if (value.text) return String(value.text).trim();
        if (Array.isArray(value.richText)) {
            return value.richText.map(function(part) { return part.text || ''; }).join('').trim();
        }
        if (value.result !== undefined && value.result !== null) return String(value.result).trim();
        if (value.hyperlink) return String(value.text || value.hyperlink || '').trim();
    }
    return String(value).trim();
}

function normalizeImportStatus(value) {
    var raw = String(value || '').trim().toLowerCase();
    if (!raw || raw === 'đang hoạt động' || raw === 'active') return 'active';
    if (raw === 'ngừng hoạt động' || raw === 'inactive') return 'inactive';
    return '';
}

function normalizeCustomerType(value) {
    var raw = String(value || '').trim().toLowerCase();
    if (raw === 'cong_ty' || raw === 'công ty' || raw === 'cong ty') return 'cong_ty';
    return 'ca_nhan';
}

function normalizeGender(value) {
    var raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'nam' || raw === 'male') return 'nam';
    if (raw === 'nu' || raw === 'nữ' || raw === 'female') return 'nu';
    if (raw === 'khac' || raw === 'khác' || raw === 'other') return 'khac';
    return '';
}

function parseImportDate(value) {
    if (!value) return '';
    if (value instanceof Date && !isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    var text = cellText(value);
    if (!text) return '';

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

    var slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
        var day = String(slashMatch[1]).padStart(2, '0');
        var month = String(slashMatch[2]).padStart(2, '0');
        return slashMatch[3] + '-' + month + '-' + day;
    }

    var parsed = new Date(text);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return text;
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

async function buildImportTemplateWorkbook() {
    var workbook = new ExcelJS.Workbook();
    workbook.creator = 'Quan ly cua hang';
    workbook.created = new Date();
    var worksheet = workbook.addWorksheet('Mau nhap khach hang');
    worksheet.columns = CUSTOMER_IMPORT_COLUMNS;
    worksheet.addRow(CUSTOMER_IMPORT_SAMPLE_ROW);
    applyExportWorksheetFormat(worksheet);
    return workbook;
}

function validateWorksheetHeaders(worksheet) {
    var expected = CUSTOMER_IMPORT_COLUMNS.map(function(column) {
        return normalizeHeader(column.header);
    });
    var headerRow = worksheet.getRow(1);
    var actual = CUSTOMER_IMPORT_COLUMNS.map(function(column, index) {
        return normalizeHeader(cellText(headerRow.getCell(index + 1).value));
    });
    var mismatches = [];

    expected.forEach(function(header, index) {
        if (actual[index] !== header) {
            mismatches.push({
                column: CUSTOMER_IMPORT_COLUMNS[index].header,
                actual: actual[index] || '(trống)'
            });
        }
    });

    if (mismatches.length > 0) {
        var message = mismatches.slice(0, 3).map(function(item) {
            return item.column + ' (nhận: "' + item.actual + '")';
        }).join('; ');
        var error = new Error('Sai tiêu đề cột: ' + message);
        error.code = 'import_invalid_headers';
        throw error;
    }
}

function parseImportWorksheet(worksheet) {
    validateWorksheetHeaders(worksheet);

    var rows = [];
    var rowCount = worksheet.rowCount || 0;

    for (var rowIndex = 2; rowIndex <= rowCount; rowIndex += 1) {
        var row = worksheet.getRow(rowIndex);
        var parsed = {};
        var hasValue = false;

        CUSTOMER_IMPORT_COLUMNS.forEach(function(column, columnIndex) {
            var rawValue = row.getCell(columnIndex + 1).value;
            var value = column.key === 'ngay_sinh' ? parseImportDate(rawValue) : cellText(rawValue);
            parsed[column.key] = value;
            if (value) hasValue = true;
        });

        if (!hasValue) continue;
        rows.push({
            rowNumber: rowIndex,
            data: parsed
        });
    }

    return rows;
}

async function parseCustomerImportBuffer(buffer) {
    if (!buffer || !buffer.length) {
        var emptyError = new Error('File Excel trống.');
        emptyError.code = 'import_empty_file';
        throw emptyError;
    }

    var workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    var worksheet = workbook.worksheets[0];

    if (!worksheet) {
        var sheetError = new Error('Không tìm thấy sheet dữ liệu trong file Excel.');
        sheetError.code = 'import_empty_file';
        throw sheetError;
    }

    return parseImportWorksheet(worksheet);
}

function buildCustomerBodyFromImportRow(row) {
    var loaiKhachHang = normalizeCustomerType(row.loai_khach_hang);
    var trangThai = normalizeImportStatus(row.trang_thai);

    return {
        loai_khach_hang: loaiKhachHang,
        ten_khach_hang: String(row.ten_khach_hang || '').trim(),
        sdt: String(row.sdt || '').trim(),
        email: String(row.email || '').trim(),
        facebook: String(row.facebook || '').trim(),
        ngay_sinh: String(row.ngay_sinh || '').trim(),
        gioi_tinh: normalizeGender(row.gioi_tinh),
        mst: String(row.mst || '').trim(),
        ten_cong_ty: String(row.ten_cong_ty || '').trim(),
        ma_so_thue: String(row.ma_so_thue || '').trim(),
        ghi_chu: String(row.ghi_chu || '').trim(),
        trang_thai: trangThai || 'active',
        ten_nguoi_nhan: String(row.ten_nguoi_nhan || '').trim(),
        sdt_nguoi_nhan: String(row.sdt_nguoi_nhan || '').trim(),
        dia_chi_chi_tiet: String(row.dia_chi_chi_tiet || '').trim(),
        phuong_xa: String(row.phuong_xa || '').trim(),
        tinh_thanh: String(row.tinh_thanh || '').trim(),
        loai_dia_chi: 'khac',
        mac_dinh: true
    };
}

function validateImportRows(rows, validateCustomerPayload, normalizeCustomerPayload) {
    var errors = [];

    rows.forEach(function(item) {
        var body = buildCustomerBodyFromImportRow(item.data);
        if (item.data.trang_thai && !normalizeImportStatus(item.data.trang_thai)) {
            errors.push('Dòng ' + item.rowNumber + ': trạng thái không hợp lệ.');
            return;
        }

        var payload = normalizeCustomerPayload(body);
        var validationError = validateCustomerPayload(payload);
        if (validationError === 'missing_name') {
            errors.push('Dòng ' + item.rowNumber + ': thiếu tên khách hàng.');
        } else if (validationError === 'missing_phone') {
            errors.push('Dòng ' + item.rowNumber + ': thiếu số điện thoại.');
        } else if (validationError === 'invalid_phone') {
            errors.push('Dòng ' + item.rowNumber + ': số điện thoại không hợp lệ.');
        } else if (validationError === 'missing_mst') {
            errors.push('Dòng ' + item.rowNumber + ': thiếu MST (khách cá nhân).');
        } else if (validationError === 'invalid_mst') {
            errors.push('Dòng ' + item.rowNumber + ': MST phải từ 10 đến 13 số.');
        }
    });

    if (errors.length > 0) {
        var validationError = new Error(errors.slice(0, 5).join(' '));
        validationError.code = 'import_invalid_rows';
        validationError.details = errors;
        throw validationError;
    }
}

module.exports = {
    CUSTOMER_IMPORT_COLUMNS: CUSTOMER_IMPORT_COLUMNS,
    buildImportTemplateWorkbook: buildImportTemplateWorkbook,
    parseCustomerImportBuffer: parseCustomerImportBuffer,
    validateImportRows: validateImportRows,
    buildCustomerBodyFromImportRow: buildCustomerBodyFromImportRow
};
