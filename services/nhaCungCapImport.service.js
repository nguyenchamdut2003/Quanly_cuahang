var ExcelJS = require('exceljs');

var SUPPLIER_IMPORT_SHEET_NAME = 'Mẫu nhập nhà cung cấp';
var SUPPLIER_IMPORT_SHEET_NAME_LEGACY = 'Mau nhap nha cung cap';
var SUPPLIER_IMPORT_NOTES_SHEET_NAME = 'Ghi chú nhà cung cấp';
var SUPPLIER_ADDRESS_IMPORT_SHEET_NAME = 'Mẫu nhập địa chỉ';
var SUPPLIER_ADDRESS_IMPORT_SHEET_NAME_LEGACY = 'Mau nhap dia chi';
var SUPPLIER_ADDRESS_NOTES_SHEET_NAME = 'Ghi chú địa chỉ';

var SUPPLIER_IMPORT_COLUMNS = [
    { header: 'Mã nhà cung cấp', key: 'ma_ncc', width: 18 },
    { header: 'Tên nhà cung cấp', key: 'ten_ncc', width: 28 },
    { header: 'Điện thoại', key: 'sdt', width: 16 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Tên công ty', key: 'ten_cong_ty', width: 24 },
    { header: 'Mã số thuế', key: 'ma_so_thue', width: 18 },
    { header: 'Ghi chú', key: 'ghi_chu', width: 28 },
    { header: 'Trạng thái', key: 'trang_thai', width: 18 }
];

var LEGACY_SUPPLIER_IMPORT_COLUMNS = SUPPLIER_IMPORT_COLUMNS.slice(1);

var SUPPLIER_ADDRESS_IMPORT_COLUMNS = [
    { header: 'Mã nhà cung cấp', key: 'ma_ncc', width: 18 },
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

function buildSupplierSampleRow(maNcc) {
    return {
        ma_ncc: maNcc || 'NCC0001',
        ten_ncc: 'Công ty TNHH ABC',
        sdt: '0901234567',
        email: 'ncc@example.com',
        ten_cong_ty: 'Công ty TNHH ABC',
        ma_so_thue: '0100000001',
        ghi_chu: '',
        trang_thai: 'Đang hoạt động'
    };
}

function buildAddressSampleRow(maNcc) {
    return {
        ma_ncc: maNcc || 'NCC0001',
        ma_dia_chi: '',
        ten_nguoi_nhan: 'Công ty TNHH ABC',
        sdt_nguoi_nhan: '0901234567',
        dia_chi_chi_tiet: '123 Nguyễn Huệ',
        phuong_xa: 'Bến Nghé',
        tinh_thanh: 'TP. Hồ Chí Minh',
        loai_dia_chi: 'Khác',
        mac_dinh: 'Có',
        ghi_chu_dia_chi: ''
    };
}

var SUPPLIER_IMPORT_NOTES = [
    { cot: 'Mã nhà cung cấp', bat_buoc: 'Có', cach_nhap: 'Nhập mã dạng NCC0001.', dieu_kien: 'Mã phải duy nhất trong file và chưa tồn tại nếu đang tạo nhà cung cấp mới. Sheet địa chỉ dùng mã này để xác định địa chỉ thuộc nhà cung cấp nào.', vi_du: 'NCC0005' },
    { cot: 'Tên nhà cung cấp', bat_buoc: 'Có', cach_nhap: 'Nhập tên nhà cung cấp cần tạo.', dieu_kien: 'Không được để trống.', vi_du: 'Công ty TNHH ABC' },
    { cot: 'Điện thoại', bat_buoc: 'Không', cach_nhap: 'Nhập số điện thoại dạng text.', dieu_kien: 'Có thể để trống.', vi_du: '0901234567' },
    { cot: 'Email', bat_buoc: 'Không', cach_nhap: 'Nhập email liên hệ.', dieu_kien: 'Có thể để trống.', vi_du: 'ncc@example.com' },
    { cot: 'Tên công ty', bat_buoc: 'Không', cach_nhap: 'Nhập tên công ty.', dieu_kien: 'Có thể để trống.', vi_du: 'Công ty TNHH ABC' },
    { cot: 'Mã số thuế', bat_buoc: 'Không', cach_nhap: 'Nhập mã số thuế.', dieu_kien: 'Có thể để trống.', vi_du: '0100000001' },
    { cot: 'Ghi chú', bat_buoc: 'Không', cach_nhap: 'Nhập ghi chú nội bộ.', dieu_kien: 'Có thể để trống.', vi_du: 'Nhà cung cấp chính' },
    { cot: 'Trạng thái', bat_buoc: 'Không', cach_nhap: 'Nhập "Đang hoạt động", "Ngừng hoạt động", "active" hoặc "inactive".', dieu_kien: 'Để trống mặc định là active. Giá trị khác danh sách cho phép sẽ báo lỗi.', vi_du: 'Đang hoạt động' }
];

var ADDRESS_IMPORT_NOTES = [
    { cot: 'Mã nhà cung cấp', bat_buoc: 'Có', cach_nhap: 'Nhập mã nhà cung cấp dạng NCC0001.', dieu_kien: 'Phải tồn tại trong sheet Mẫu nhập nhà cung cấp hoặc đã tồn tại trong database. Đây là khóa liên kết địa chỉ với nhà cung cấp.', vi_du: 'NCC0005' },
    { cot: 'Mã địa chỉ', bat_buoc: 'Không', cach_nhap: 'Có thể để trống để hệ thống tự sinh. Nếu nhập thì dùng dạng DCNCC0001.', dieu_kien: 'Nếu nhập thì phải duy nhất toàn database.', vi_du: 'DCNCC0005' },
    { cot: 'Tên người nhận', bat_buoc: 'Không', cach_nhap: 'Nhập tên người nhận.', dieu_kien: 'Một dòng địa chỉ cần có ít nhất một thông tin địa chỉ hoặc người nhận.', vi_du: 'Công ty TNHH ABC' },
    { cot: 'SĐT người nhận', bat_buoc: 'Không', cach_nhap: 'Nhập số điện thoại người nhận.', dieu_kien: 'Có thể để trống.', vi_du: '0901234567' },
    { cot: 'Địa chỉ chi tiết', bat_buoc: 'Không', cach_nhap: 'Nhập số nhà, tên đường hoặc địa chỉ chi tiết.', dieu_kien: 'Được ghép với Phường/xã và Tỉnh/thành để tạo địa chỉ đầy đủ.', vi_du: '123 Nguyễn Huệ' },
    { cot: 'Phường/xã', bat_buoc: 'Không', cach_nhap: 'Nhập tên phường, xã hoặc khu vực.', dieu_kien: 'Có thể để trống.', vi_du: 'Bến Nghé' },
    { cot: 'Tỉnh/thành', bat_buoc: 'Không', cach_nhap: 'Nhập tên tỉnh hoặc thành phố.', dieu_kien: 'Có thể để trống.', vi_du: 'TP. Hồ Chí Minh' },
    { cot: 'Loại địa chỉ', bat_buoc: 'Không', cach_nhap: 'Nhập text loại địa chỉ, ví dụ "Trụ sở", "Kho giao hàng", "Khác".', dieu_kien: 'Nếu text đã có trong danh sách loại địa chỉ thì dùng mã hiện có. Nếu chưa có thì hệ thống tạo loại địa chỉ mới. Để trống mặc định là Khác.', vi_du: 'Trụ sở' },
    { cot: 'Mặc định', bat_buoc: 'Không', cach_nhap: 'Nhập "Có", "Không", "true", "false", "1" hoặc "0".', dieu_kien: 'Để trống mặc định là Không. Nếu Có thì các địa chỉ khác của nhà cung cấp đó sẽ bỏ mặc định.', vi_du: 'Có' },
    { cot: 'Ghi chú', bat_buoc: 'Không', cach_nhap: 'Nhập ghi chú cho địa chỉ.', dieu_kien: 'Có thể để trống.', vi_du: 'Giao giờ hành chính' }
];

function normalizeHeader(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function cellText(value) {
    if (value === null || typeof value === 'undefined') return '';
    if (typeof value === 'object') {
        if (value.text) return String(value.text).trim();
        if (Array.isArray(value.richText)) return value.richText.map(function(part) { return part.text || ''; }).join('').trim();
        if (value.result !== undefined && value.result !== null) return String(value.result).trim();
        if (value.hyperlink) return String(value.text || value.hyperlink || '').trim();
        if (value instanceof Date) return value.toISOString();
    }
    return String(value).trim();
}

function normalizeImportStatus(value) {
    var raw = String(value || '').trim().toLowerCase();
    if (!raw || raw === 'đang hoạt động' || raw === 'active') return 'active';
    if (raw === 'ngừng hoạt động' || raw === 'inactive') return 'inactive';
    return '';
}

function normalizeImportBoolean(value) {
    var raw = String(value || '').trim().toLowerCase();
    if (raw === 'có' || raw === 'co' || raw === 'true' || raw === '1' || raw === 'yes') return true;
    return false;
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
    var suggestedSupplierCode = options.suggestedSupplierCode || 'NCC0001';
    var workbook = new ExcelJS.Workbook();
    workbook.creator = 'Quan ly nha cung cap';
    workbook.created = new Date();

    var supplierWorksheet = workbook.addWorksheet(SUPPLIER_IMPORT_SHEET_NAME);
    supplierWorksheet.columns = SUPPLIER_IMPORT_COLUMNS;
    supplierWorksheet.addRow(buildSupplierSampleRow(suggestedSupplierCode));
    applyWorksheetFormat(supplierWorksheet, 'FF2563EB');

    addNotesSheet(workbook, SUPPLIER_IMPORT_NOTES_SHEET_NAME, SUPPLIER_IMPORT_NOTES);

    var addressWorksheet = workbook.addWorksheet(SUPPLIER_ADDRESS_IMPORT_SHEET_NAME);
    addressWorksheet.columns = SUPPLIER_ADDRESS_IMPORT_COLUMNS;
    addressWorksheet.addRow(buildAddressSampleRow(suggestedSupplierCode));
    applyWorksheetFormat(addressWorksheet, 'FF2563EB');

    addNotesSheet(workbook, SUPPLIER_ADDRESS_NOTES_SHEET_NAME, ADDRESS_IMPORT_NOTES);

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
            parsed[column.key] = cellText(row.getCell(columnIndex + 1).value);
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

async function parseSupplierImportBuffer(buffer) {
    if (!buffer || !buffer.length) {
        var emptyError = new Error('File Excel trống.');
        emptyError.code = 'import_empty_file';
        throw emptyError;
    }

    var workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    var supplierWorksheet = workbook.getWorksheet(SUPPLIER_IMPORT_SHEET_NAME)
        || workbook.getWorksheet(SUPPLIER_IMPORT_SHEET_NAME_LEGACY)
        || workbook.worksheets[0];

    if (!supplierWorksheet) {
        var sheetError = new Error('Không tìm thấy sheet dữ liệu trong file Excel.');
        sheetError.code = 'import_empty_file';
        throw sheetError;
    }

    var legacySupplierSheet = !matchesWorksheetHeaders(supplierWorksheet, SUPPLIER_IMPORT_COLUMNS)
        && matchesWorksheetHeaders(supplierWorksheet, LEGACY_SUPPLIER_IMPORT_COLUMNS);
    var supplierRows = parseImportWorksheet(
        supplierWorksheet,
        legacySupplierSheet ? LEGACY_SUPPLIER_IMPORT_COLUMNS : SUPPLIER_IMPORT_COLUMNS,
        supplierWorksheet.name || SUPPLIER_IMPORT_SHEET_NAME
    );
    var addressWorksheet = workbook.getWorksheet(SUPPLIER_ADDRESS_IMPORT_SHEET_NAME)
        || workbook.getWorksheet(SUPPLIER_ADDRESS_IMPORT_SHEET_NAME_LEGACY);
    var addressRows = addressWorksheet
        ? parseImportWorksheet(addressWorksheet, SUPPLIER_ADDRESS_IMPORT_COLUMNS, addressWorksheet.name || SUPPLIER_ADDRESS_IMPORT_SHEET_NAME)
        : [];

    return {
        supplierRows: supplierRows,
        addressRows: addressRows,
        legacySupplierSheet: legacySupplierSheet
    };
}

function buildSupplierBodyFromImportRow(row) {
    var trangThai = normalizeImportStatus(row.trang_thai);
    return {
        ma_ncc: String(row.ma_ncc || '').trim(),
        ten_ncc: String(row.ten_ncc || '').trim(),
        sdt: String(row.sdt || '').trim(),
        email: String(row.email || '').trim(),
        ten_cong_ty: String(row.ten_cong_ty || '').trim(),
        ma_so_thue: String(row.ma_so_thue || '').trim(),
        ghi_chu: String(row.ghi_chu || '').trim(),
        trang_thai: trangThai || 'active'
    };
}

function buildAddressBodyFromImportRow(row) {
    return {
        ma_ncc: String(row.ma_ncc || '').trim(),
        ma_dia_chi: String(row.ma_dia_chi || '').trim(),
        ten_nguoi_nhan: String(row.ten_nguoi_nhan || '').trim(),
        sdt_nguoi_nhan: String(row.sdt_nguoi_nhan || '').trim(),
        dia_chi_chi_tiet: String(row.dia_chi_chi_tiet || '').trim(),
        phuong_xa: String(row.phuong_xa || '').trim(),
        tinh_thanh: String(row.tinh_thanh || '').trim(),
        loai_dia_chi_text: String(row.loai_dia_chi || '').trim(),
        ghi_chu: String(row.ghi_chu_dia_chi || row.ghi_chu || '').trim(),
        mac_dinh: normalizeImportBoolean(row.mac_dinh)
    };
}

function validateImportRows(parsed) {
    var rows = Array.isArray(parsed) ? parsed : (parsed.supplierRows || []);
    var errors = [];

    rows.forEach(function(item) {
        var data = item.data;
        if (data.trang_thai && !normalizeImportStatus(data.trang_thai)) {
            errors.push('Dòng ' + item.rowNumber + ': trạng thái không hợp lệ.');
            return;
        }
        if (!String(data.ten_ncc || '').trim()) {
            errors.push('Dòng ' + item.rowNumber + ': thiếu tên nhà cung cấp.');
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
    SUPPLIER_IMPORT_COLUMNS: SUPPLIER_IMPORT_COLUMNS,
    SUPPLIER_ADDRESS_IMPORT_COLUMNS: SUPPLIER_ADDRESS_IMPORT_COLUMNS,
    buildImportTemplateWorkbook: buildImportTemplateWorkbook,
    parseSupplierImportBuffer: parseSupplierImportBuffer,
    validateImportRows: validateImportRows,
    buildSupplierBodyFromImportRow: buildSupplierBodyFromImportRow,
    buildAddressBodyFromImportRow: buildAddressBodyFromImportRow
};
