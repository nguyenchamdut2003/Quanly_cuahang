var ExcelJS = require('exceljs');

var SUPPLIER_IMPORT_COLUMNS = [
    { header: 'Tên nhà cung cấp', key: 'ten_ncc', width: 28 },
    { header: 'Điện thoại', key: 'sdt', width: 16 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Tên công ty', key: 'ten_cong_ty', width: 24 },
    { header: 'Mã số thuế', key: 'ma_so_thue', width: 18 },
    { header: 'Ghi chú', key: 'ghi_chu', width: 28 },
    { header: 'Trạng thái', key: 'trang_thai', width: 18 }
];

var SUPPLIER_IMPORT_SAMPLE_ROW = {
    ten_ncc: 'Công ty TNHH ABC',
    sdt: '0901234567',
    email: 'ncc@example.com',
    ten_cong_ty: 'Công ty TNHH ABC',
    ma_so_thue: '0100000001',
    ghi_chu: '',
    trang_thai: 'Đang hoạt động'
};

function normalizeHeader(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function cellText(value) {
    if (value === null || typeof value === 'undefined') return '';
    if (typeof value === 'object') {
        if (value.text) return String(value.text).trim();
        if (Array.isArray(value.richText)) {
            return value.richText.map(function(part) { return part.text || ''; }).join('').trim();
        }
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
    var worksheet = workbook.addWorksheet('Mau nhap nha cung cap');
    worksheet.columns = SUPPLIER_IMPORT_COLUMNS;
    worksheet.addRow(SUPPLIER_IMPORT_SAMPLE_ROW);
    applyExportWorksheetFormat(worksheet);
    return workbook;
}

function validateWorksheetHeaders(worksheet) {
    var expected = SUPPLIER_IMPORT_COLUMNS.map(function(column) {
        return normalizeHeader(column.header);
    });
    var headerRow = worksheet.getRow(1);
    var actual = SUPPLIER_IMPORT_COLUMNS.map(function(column, index) {
        return normalizeHeader(cellText(headerRow.getCell(index + 1).value));
    });
    var mismatches = [];

    expected.forEach(function(header, index) {
        if (actual[index] !== header) {
            mismatches.push({
                column: SUPPLIER_IMPORT_COLUMNS[index].header,
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

        SUPPLIER_IMPORT_COLUMNS.forEach(function(column, columnIndex) {
            var value = cellText(row.getCell(columnIndex + 1).value);
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

async function parseSupplierImportBuffer(buffer) {
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

function buildSupplierBodyFromImportRow(row) {
    var trangThai = normalizeImportStatus(row.trang_thai);
    return {
        ten_ncc: String(row.ten_ncc || '').trim(),
        sdt: String(row.sdt || '').trim(),
        email: String(row.email || '').trim(),
        ten_cong_ty: String(row.ten_cong_ty || '').trim(),
        ma_so_thue: String(row.ma_so_thue || '').trim(),
        ghi_chu: String(row.ghi_chu || '').trim(),
        trang_thai: trangThai || 'active'
    };
}

function validateImportRows(rows) {
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
    buildImportTemplateWorkbook: buildImportTemplateWorkbook,
    parseSupplierImportBuffer: parseSupplierImportBuffer,
    validateImportRows: validateImportRows,
    buildSupplierBodyFromImportRow: buildSupplierBodyFromImportRow
};
