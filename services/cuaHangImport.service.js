var ExcelJS = require('exceljs');
var { buildFullAddress } = require('../utils/address');

var STORE_IMPORT_COLUMNS = [
    { header: 'Tên cửa hàng', key: 'ten_cua_hang', width: 28 },
    { header: 'Mã số thuế', key: 'ma_so_thue', width: 18 },
    { header: 'Địa chỉ chi tiết', key: 'dia_chi_chi_tiet', width: 32 },
    { header: 'Phường/xã', key: 'phuong_xa', width: 20 },
    { header: 'Tỉnh/thành', key: 'tinh_thanh', width: 20 },
    { header: 'Điện thoại', key: 'sdt', width: 16 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Trạng thái', key: 'trang_thai', width: 18 }
];

var STORE_IMPORT_SAMPLE_ROW = {
    ten_cua_hang: 'Kiot HCM - Quận 1',
    ma_so_thue: '0100000001',
    dia_chi_chi_tiet: '123 Nguyễn Huệ',
    phuong_xa: 'Bến Nghé',
    tinh_thanh: 'TP. Hồ Chí Minh',
    sdt: '0901234567',
    email: 'cua-hang@example.com',
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

function buildStorePayloadFromImportRow(row) {
    var diaChiChiTiet = String(row.dia_chi_chi_tiet || '').trim();
    var phuongXa = String(row.phuong_xa || '').trim();
    var tinhThanh = String(row.tinh_thanh || '').trim();
    var diaChiDayDu = buildFullAddress({
        dia_chi_chi_tiet: diaChiChiTiet,
        phuong_xa: phuongXa,
        tinh_thanh: tinhThanh
    });

    return {
        ten_cua_hang: String(row.ten_cua_hang || '').trim(),
        ma_so_thue: String(row.ma_so_thue || '').trim(),
        dia_chi_chi_tiet: diaChiChiTiet,
        phuong_xa: phuongXa,
        tinh_thanh: tinhThanh,
        dia_chi_day_du: diaChiDayDu,
        dia_chi: diaChiDayDu,
        sdt: String(row.sdt || '').trim(),
        email: String(row.email || '').trim(),
        trang_thai: normalizeImportStatus(row.trang_thai) || 'active'
    };
}

function isImportRowEmpty(row) {
    return STORE_IMPORT_COLUMNS.every(function(column) {
        return !String(row[column.key] || '').trim();
    });
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
    var worksheet = workbook.addWorksheet('Mau nhap cua hang');
    worksheet.columns = STORE_IMPORT_COLUMNS;
    worksheet.addRow(STORE_IMPORT_SAMPLE_ROW);
    applyExportWorksheetFormat(worksheet);
    return workbook;
}

function readWorksheetHeaders(worksheet) {
    var headerRow = worksheet.getRow(1);
    return STORE_IMPORT_COLUMNS.map(function(column, index) {
        return normalizeHeader(cellText(headerRow.getCell(index + 1).value));
    });
}

function validateWorksheetHeaders(worksheet) {
    var expected = STORE_IMPORT_COLUMNS.map(function(column) {
        return normalizeHeader(column.header);
    });
    var actual = readWorksheetHeaders(worksheet);
    var mismatches = [];

    expected.forEach(function(header, index) {
        if (actual[index] !== header) {
            mismatches.push({
                column: STORE_IMPORT_COLUMNS[index].header,
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

        STORE_IMPORT_COLUMNS.forEach(function(column, columnIndex) {
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

async function parseStoreImportBuffer(buffer) {
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

function validateImportRows(rows) {
    var errors = [];

    rows.forEach(function(item) {
        var rowNumber = item.rowNumber;
        var data = item.data;
        var tenCuaHang = String(data.ten_cua_hang || '').trim();
        var trangThai = normalizeImportStatus(data.trang_thai);

        if (!tenCuaHang) {
            errors.push('Dòng ' + rowNumber + ': thiếu tên cửa hàng.');
            return;
        }

        if (data.trang_thai && !trangThai) {
            errors.push('Dòng ' + rowNumber + ': trạng thái không hợp lệ.');
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
    STORE_IMPORT_COLUMNS: STORE_IMPORT_COLUMNS,
    buildImportTemplateWorkbook: buildImportTemplateWorkbook,
    parseStoreImportBuffer: parseStoreImportBuffer,
    validateImportRows: validateImportRows,
    buildStorePayloadFromImportRow: buildStorePayloadFromImportRow,
    isImportRowEmpty: isImportRowEmpty
};
