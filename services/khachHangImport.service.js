var ExcelJS = require('exceljs');

var CUSTOMER_IMPORT_SHEET_NAME = 'Mẫu nhập khách hàng';
var CUSTOMER_IMPORT_SHEET_NAME_LEGACY = 'Mau nhap khach hang';
var CUSTOMER_IMPORT_NOTES_SHEET_NAME = 'Ghi chú khách hàng';
var CUSTOMER_ADDRESS_IMPORT_SHEET_NAME = 'Mẫu nhập địa chỉ';
var CUSTOMER_ADDRESS_IMPORT_SHEET_NAME_LEGACY = 'Mau nhap dia chi';
var CUSTOMER_ADDRESS_NOTES_SHEET_NAME = 'Ghi chú địa chỉ';

var CUSTOMER_IMPORT_COLUMNS = [
    { header: 'Mã khách hàng', key: 'ma_khach_hang', width: 16 },
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
    { header: 'Trạng thái', key: 'trang_thai', width: 18 }
];

var LEGACY_CUSTOMER_IMPORT_COLUMNS = CUSTOMER_IMPORT_COLUMNS.slice(1).concat([
    { header: 'Tên người nhận', key: 'ten_nguoi_nhan', width: 22 },
    { header: 'SĐT người nhận', key: 'sdt_nguoi_nhan', width: 16 },
    { header: 'Địa chỉ chi tiết', key: 'dia_chi_chi_tiet', width: 32 },
    { header: 'Phường/xã', key: 'phuong_xa', width: 20 },
    { header: 'Tỉnh/thành', key: 'tinh_thanh', width: 20 }
]);

var CUSTOMER_ADDRESS_IMPORT_COLUMNS = [
    { header: 'Mã khách hàng', key: 'ma_khach_hang', width: 16 },
    { header: 'Mã địa chỉ', key: 'ma_dia_chi', width: 16 },
    { header: 'Tên người nhận', key: 'ten_nguoi_nhan', width: 24 },
    { header: 'SĐT người nhận', key: 'sdt_nguoi_nhan', width: 16 },
    { header: 'Địa chỉ chi tiết', key: 'dia_chi_chi_tiet', width: 32 },
    { header: 'Phường/xã', key: 'phuong_xa', width: 20 },
    { header: 'Tỉnh/thành', key: 'tinh_thanh', width: 20 },
    { header: 'Loại địa chỉ', key: 'loai_dia_chi', width: 20 },
    { header: 'Mặc định', key: 'mac_dinh', width: 12 },
    { header: 'Ghi chú', key: 'ghi_chu_dia_chi', width: 28 }
];

var NOTE_COLUMNS = [
    { header: 'Cột', key: 'cot', width: 24 },
    { header: 'Bắt buộc', key: 'bat_buoc', width: 12 },
    { header: 'Cách nhập', key: 'cach_nhap', width: 44 },
    { header: 'Điều kiện', key: 'dieu_kien', width: 62 },
    { header: 'Ví dụ', key: 'vi_du', width: 24 }
];

function buildCustomerSampleRow(maKhachHang) {
    return {
        ma_khach_hang: maKhachHang || 'KH0001',
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
        trang_thai: 'Đang hoạt động'
    };
}

function buildAddressSampleRow(maKhachHang) {
    return {
        ma_khach_hang: maKhachHang || 'KH0001',
        ma_dia_chi: '',
        ten_nguoi_nhan: 'Nguyễn Văn A',
        sdt_nguoi_nhan: '0901234567',
        dia_chi_chi_tiet: '123 Nguyễn Huệ',
        phuong_xa: 'Bến Nghé',
        tinh_thanh: 'TP. Hồ Chí Minh',
        loai_dia_chi: 'Khác',
        mac_dinh: 'Có',
        ghi_chu_dia_chi: ''
    };
}

var CUSTOMER_IMPORT_NOTES = [
    { cot: 'Mã khách hàng', bat_buoc: 'Có', cach_nhap: 'Nhập mã dạng KH0001.', dieu_kien: 'Mã phải duy nhất trong file và chưa tồn tại nếu đang tạo khách hàng mới. Sheet địa chỉ dùng mã này để xác định địa chỉ thuộc khách hàng nào.', vi_du: 'KH0005' },
    { cot: 'Loại khách hàng', bat_buoc: 'Không', cach_nhap: 'Nhập "Cá nhân", "Công ty", "ca_nhan" hoặc "cong_ty".', dieu_kien: 'Để trống mặc định là Cá nhân.', vi_du: 'Cá nhân' },
    { cot: 'Tên khách hàng', bat_buoc: 'Có', cach_nhap: 'Nhập tên khách hàng cần tạo.', dieu_kien: 'Không được để trống.', vi_du: 'Nguyễn Văn A' },
    { cot: 'Số điện thoại', bat_buoc: 'Có', cach_nhap: 'Nhập số điện thoại dạng text, nên giữ số 0 đầu.', dieu_kien: 'Bắt buộc đúng 10 số và bắt đầu bằng 0.', vi_du: '0901234567' },
    { cot: 'Email', bat_buoc: 'Không', cach_nhap: 'Nhập email liên hệ.', dieu_kien: 'Có thể để trống.', vi_du: 'khachhang@example.com' },
    { cot: 'Facebook', bat_buoc: 'Không', cach_nhap: 'Nhập link hoặc tên tài khoản Facebook.', dieu_kien: 'Có thể để trống.', vi_du: 'facebook.com/username' },
    { cot: 'Ngày sinh', bat_buoc: 'Không', cach_nhap: 'Nhập dạng DD/MM/YYYY hoặc YYYY-MM-DD.', dieu_kien: 'Chỉ dùng cho khách cá nhân; có thể để trống.', vi_du: '01/01/1990' },
    { cot: 'Giới tính', bat_buoc: 'Không', cach_nhap: 'Nhập "Nam", "Nữ", "Khác", "male", "female" hoặc "other".', dieu_kien: 'Giá trị khác danh sách cho phép sẽ để trống.', vi_du: 'Nam' },
    { cot: 'MST', bat_buoc: 'Có với cá nhân', cach_nhap: 'Nhập mã số thuế cá nhân dạng số.', dieu_kien: 'Khách cá nhân bắt buộc có MST từ 10 đến 13 số.', vi_du: '0123456789' },
    { cot: 'Tên công ty', bat_buoc: 'Có với công ty', cach_nhap: 'Nhập tên công ty nếu loại khách hàng là Công ty.', dieu_kien: 'Khách công ty dùng tên này làm tên khách hàng nếu cột Tên khách hàng trống.', vi_du: 'Công ty ABC' },
    { cot: 'Mã số thuế', bat_buoc: 'Không', cach_nhap: 'Nhập mã số thuế công ty.', dieu_kien: 'Dùng cho khách công ty; có thể để trống.', vi_du: '0312345678' },
    { cot: 'Ghi chú', bat_buoc: 'Không', cach_nhap: 'Nhập ghi chú nội bộ.', dieu_kien: 'Có thể để trống.', vi_du: 'Khách thân thiết' },
    { cot: 'Trạng thái', bat_buoc: 'Không', cach_nhap: 'Nhập "Đang hoạt động", "Ngừng hoạt động", "active" hoặc "inactive".', dieu_kien: 'Để trống mặc định là active. Giá trị khác danh sách cho phép sẽ báo lỗi.', vi_du: 'Đang hoạt động' }
];

var ADDRESS_IMPORT_NOTES = [
    { cot: 'Mã khách hàng', bat_buoc: 'Có', cach_nhap: 'Nhập mã khách hàng dạng KH0001.', dieu_kien: 'Phải tồn tại trong sheet Mẫu nhập khách hàng hoặc đã tồn tại trong database. Đây là khóa liên kết địa chỉ với khách hàng.', vi_du: 'KH0005' },
    { cot: 'Mã địa chỉ', bat_buoc: 'Không', cach_nhap: 'Có thể để trống để hệ thống tự sinh. Nếu nhập thì dùng dạng DCKH0001.', dieu_kien: 'Nếu nhập thì phải duy nhất toàn database.', vi_du: 'DCKH0005' },
    { cot: 'Tên người nhận', bat_buoc: 'Không', cach_nhap: 'Nhập tên người nhận hàng.', dieu_kien: 'Một dòng địa chỉ cần có ít nhất một thông tin địa chỉ hoặc người nhận.', vi_du: 'Nguyễn Văn A' },
    { cot: 'SĐT người nhận', bat_buoc: 'Không', cach_nhap: 'Nhập số điện thoại người nhận.', dieu_kien: 'Có thể để trống.', vi_du: '0901234567' },
    { cot: 'Địa chỉ chi tiết', bat_buoc: 'Không', cach_nhap: 'Nhập số nhà, tên đường hoặc địa chỉ chi tiết.', dieu_kien: 'Được ghép với Phường/xã và Tỉnh/thành để tạo địa chỉ đầy đủ.', vi_du: '123 Nguyễn Huệ' },
    { cot: 'Phường/xã', bat_buoc: 'Không', cach_nhap: 'Nhập tên phường, xã hoặc khu vực.', dieu_kien: 'Có thể để trống.', vi_du: 'Bến Nghé' },
    { cot: 'Tỉnh/thành', bat_buoc: 'Không', cach_nhap: 'Nhập tên tỉnh hoặc thành phố.', dieu_kien: 'Có thể để trống.', vi_du: 'TP. Hồ Chí Minh' },
    { cot: 'Loại địa chỉ', bat_buoc: 'Không', cach_nhap: 'Nhập text loại địa chỉ, ví dụ "Nhà riêng", "Công ty", "Nơi nhận hàng".', dieu_kien: 'Nếu text đã có trong danh sách loại địa chỉ thì dùng mã hiện có. Nếu chưa có thì hệ thống tạo loại địa chỉ mới. Để trống mặc định là Khác.', vi_du: 'Nhà riêng' },
    { cot: 'Mặc định', bat_buoc: 'Không', cach_nhap: 'Nhập "Có", "Không", "true", "false", "1" hoặc "0".', dieu_kien: 'Để trống mặc định là Không. Nếu Có thì các địa chỉ khác của khách đó sẽ bỏ mặc định.', vi_du: 'Có' },
    { cot: 'Ghi chú', bat_buoc: 'Không', cach_nhap: 'Nhập ghi chú cho địa chỉ.', dieu_kien: 'Có thể để trống.', vi_du: 'Giao giờ hành chính' }
];

function normalizeHeader(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function cellText(value) {
    if (value === null || typeof value === 'undefined') return '';
    if (typeof value === 'object') {
        if (value instanceof Date) return value.toISOString().slice(0, 10);
        if (value.text) return String(value.text).trim();
        if (Array.isArray(value.richText)) return value.richText.map(function(part) { return part.text || ''; }).join('').trim();
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

function normalizeImportBoolean(value) {
    var raw = String(value || '').trim().toLowerCase();
    if (raw === 'có' || raw === 'co' || raw === 'true' || raw === '1' || raw === 'yes') return true;
    return false;
}

function parseImportDate(value) {
    if (!value) return '';
    if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
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

function applyWorksheetFormat(worksheet, color) {
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color || 'FF2563EB' } };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
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

function addNotesSheet(workbook, sheetName, notes) {
    var worksheet = workbook.addWorksheet(sheetName);
    worksheet.columns = NOTE_COLUMNS;
    notes.forEach(function(note) {
        worksheet.addRow(note);
    });
    applyWorksheetFormat(worksheet, 'FF0F766E');
}

async function buildImportTemplateWorkbook(options) {
    options = options || {};
    var suggestedCustomerCode = options.suggestedCustomerCode || 'KH0001';
    var workbook = new ExcelJS.Workbook();
    workbook.creator = 'Quan ly khach hang';
    workbook.created = new Date();

    var customerWorksheet = workbook.addWorksheet(CUSTOMER_IMPORT_SHEET_NAME);
    customerWorksheet.columns = CUSTOMER_IMPORT_COLUMNS;
    customerWorksheet.addRow(buildCustomerSampleRow(suggestedCustomerCode));
    applyWorksheetFormat(customerWorksheet, 'FF2563EB');

    addNotesSheet(workbook, CUSTOMER_IMPORT_NOTES_SHEET_NAME, CUSTOMER_IMPORT_NOTES);

    var addressWorksheet = workbook.addWorksheet(CUSTOMER_ADDRESS_IMPORT_SHEET_NAME);
    addressWorksheet.columns = CUSTOMER_ADDRESS_IMPORT_COLUMNS;
    addressWorksheet.addRow(buildAddressSampleRow(suggestedCustomerCode));
    applyWorksheetFormat(addressWorksheet, 'FF2563EB');

    addNotesSheet(workbook, CUSTOMER_ADDRESS_NOTES_SHEET_NAME, ADDRESS_IMPORT_NOTES);

    return workbook;
}

function readWorksheetHeaders(worksheet, columns) {
    var headerRow = worksheet.getRow(1);
    return columns.map(function(column, index) {
        return normalizeHeader(cellText(headerRow.getCell(index + 1).value));
    });
}

function matchesWorksheetHeaders(worksheet, columns) {
    var expected = columns.map(function(column) { return normalizeHeader(column.header); });
    var actual = readWorksheetHeaders(worksheet, columns);
    return expected.every(function(header, index) {
        return actual[index] === header;
    });
}

function validateWorksheetHeaders(worksheet, columns, sheetLabel) {
    var expected = columns.map(function(column) { return normalizeHeader(column.header); });
    var actual = readWorksheetHeaders(worksheet, columns);
    var mismatches = [];

    expected.forEach(function(header, index) {
        if (actual[index] !== header) {
            mismatches.push({
                column: columns[index].header,
                actual: actual[index] || '(trống)'
            });
        }
    });

    if (mismatches.length > 0) {
        var message = mismatches.slice(0, 3).map(function(item) {
            return item.column + ' (nhận: "' + item.actual + '")';
        }).join('; ');
        var error = new Error('Sai tiêu đề cột sheet ' + sheetLabel + ': ' + message);
        error.code = 'import_invalid_headers';
        throw error;
    }
}

function isImportRowEmpty(row, columns) {
    return columns.every(function(column) {
        return !String(row[column.key] || '').trim();
    });
}

function parseImportWorksheet(worksheet, columns, sheetLabel) {
    validateWorksheetHeaders(worksheet, columns, sheetLabel);
    var rows = [];
    var rowCount = worksheet.rowCount || 0;

    for (var rowIndex = 2; rowIndex <= rowCount; rowIndex += 1) {
        var row = worksheet.getRow(rowIndex);
        var parsed = {};

        columns.forEach(function(column, columnIndex) {
            var rawValue = row.getCell(columnIndex + 1).value;
            parsed[column.key] = column.key === 'ngay_sinh' ? parseImportDate(rawValue) : cellText(rawValue);
        });

        if (isImportRowEmpty(parsed, columns)) continue;
        rows.push({
            rowNumber: rowIndex,
            sheetName: sheetLabel,
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
    var customerWorksheet = workbook.getWorksheet(CUSTOMER_IMPORT_SHEET_NAME)
        || workbook.getWorksheet(CUSTOMER_IMPORT_SHEET_NAME_LEGACY)
        || workbook.worksheets[0];

    if (!customerWorksheet) {
        var sheetError = new Error('Không tìm thấy sheet dữ liệu trong file Excel.');
        sheetError.code = 'import_empty_file';
        throw sheetError;
    }

    var legacyCustomerSheet = !matchesWorksheetHeaders(customerWorksheet, CUSTOMER_IMPORT_COLUMNS)
        && matchesWorksheetHeaders(customerWorksheet, LEGACY_CUSTOMER_IMPORT_COLUMNS);
    var customerRows = parseImportWorksheet(
        customerWorksheet,
        legacyCustomerSheet ? LEGACY_CUSTOMER_IMPORT_COLUMNS : CUSTOMER_IMPORT_COLUMNS,
        customerWorksheet.name || CUSTOMER_IMPORT_SHEET_NAME
    );
    var addressWorksheet = workbook.getWorksheet(CUSTOMER_ADDRESS_IMPORT_SHEET_NAME)
        || workbook.getWorksheet(CUSTOMER_ADDRESS_IMPORT_SHEET_NAME_LEGACY);
    var addressRows = addressWorksheet
        ? parseImportWorksheet(addressWorksheet, CUSTOMER_ADDRESS_IMPORT_COLUMNS, addressWorksheet.name || CUSTOMER_ADDRESS_IMPORT_SHEET_NAME)
        : [];

    return {
        customerRows: customerRows,
        addressRows: addressRows,
        legacyCustomerSheet: legacyCustomerSheet
    };
}

function buildCustomerBodyFromImportRow(row) {
    var loaiKhachHang = normalizeCustomerType(row.loai_khach_hang);
    var trangThai = normalizeImportStatus(row.trang_thai);

    return {
        ma_khach_hang: String(row.ma_khach_hang || '').trim(),
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
        trang_thai: trangThai || 'active'
    };
}

function buildAddressBodyFromImportRow(row) {
    return {
        ma_khach_hang: String(row.ma_khach_hang || '').trim(),
        ma_dia_chi: String(row.ma_dia_chi || '').trim(),
        ten_nguoi_nhan: String(row.ten_nguoi_nhan || '').trim(),
        sdt_nguoi_nhan: String(row.sdt_nguoi_nhan || '').trim(),
        dia_chi_chi_tiet: String(row.dia_chi_chi_tiet || '').trim(),
        phuong_xa: String(row.phuong_xa || '').trim(),
        tinh_thanh: String(row.tinh_thanh || '').trim(),
        loai_dia_chi_text: String(row.loai_dia_chi || '').trim(),
        ghi_chu_dia_chi: String(row.ghi_chu_dia_chi || '').trim(),
        mac_dinh: normalizeImportBoolean(row.mac_dinh)
    };
}

function validateImportRows(parsed, validateCustomerPayload, normalizeCustomerPayload) {
    var rows = Array.isArray(parsed) ? parsed : (parsed.customerRows || []);
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
    CUSTOMER_ADDRESS_IMPORT_COLUMNS: CUSTOMER_ADDRESS_IMPORT_COLUMNS,
    CUSTOMER_IMPORT_SHEET_NAME: CUSTOMER_IMPORT_SHEET_NAME,
    CUSTOMER_IMPORT_NOTES_SHEET_NAME: CUSTOMER_IMPORT_NOTES_SHEET_NAME,
    CUSTOMER_ADDRESS_IMPORT_SHEET_NAME: CUSTOMER_ADDRESS_IMPORT_SHEET_NAME,
    CUSTOMER_ADDRESS_NOTES_SHEET_NAME: CUSTOMER_ADDRESS_NOTES_SHEET_NAME,
    buildImportTemplateWorkbook: buildImportTemplateWorkbook,
    parseCustomerImportBuffer: parseCustomerImportBuffer,
    validateImportRows: validateImportRows,
    buildCustomerBodyFromImportRow: buildCustomerBodyFromImportRow,
    buildAddressBodyFromImportRow: buildAddressBodyFromImportRow,
    normalizeImportStatus: normalizeImportStatus
};
