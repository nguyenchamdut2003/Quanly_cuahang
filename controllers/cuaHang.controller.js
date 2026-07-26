var { CuaHang, Kho } = require('../models/kiot.model');
var ExcelJS = require('exceljs');
var { buildFullAddress, normalizeAddress } = require('../utils/address');

var STORE_IMPORT_COLUMNS = [
    { header: 'Mã cửa hàng', key: 'ma_cua_hang', width: 16 },
    { header: 'Tên cửa hàng', key: 'ten_cua_hang', width: 28 },
    { header: 'Mã số thuế', key: 'ma_so_thue', width: 18 },
    { header: 'Địa chỉ chi tiết', key: 'dia_chi_chi_tiet', width: 32 },
    { header: 'Phường/xã', key: 'phuong_xa', width: 20 },
    { header: 'Tỉnh/thành', key: 'tinh_thanh', width: 20 },
    { header: 'Điện thoại', key: 'sdt', width: 16 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Trạng thái', key: 'trang_thai', width: 18 }
];

var WAREHOUSE_IMPORT_COLUMNS = [
    { header: 'Mã cửa hàng', key: 'ma_cua_hang', width: 16 },
    { header: 'Mã kho', key: 'ma_kho', width: 16 },
    { header: 'Tên kho', key: 'ten_kho', width: 28 },
    { header: 'Địa chỉ chi tiết', key: 'dia_chi_chi_tiet', width: 32 },
    { header: 'Phường/xã', key: 'phuong_xa', width: 20 },
    { header: 'Tỉnh/thành', key: 'tinh_thanh', width: 20 },
    { header: 'Trạng thái', key: 'trang_thai', width: 18 }
];

var LEGACY_STORE_IMPORT_COLUMNS = STORE_IMPORT_COLUMNS.slice(1);
var STORE_IMPORT_SHEET_NAME = 'Mẫu nhập cửa hàng';
var STORE_IMPORT_SHEET_NAME_LEGACY = 'Mau nhap cua hang';
var STORE_IMPORT_NOTES_SHEET_NAME = 'Ghi chú cửa hàng';
var STORE_IMPORT_NOTES_SHEET_NAME_LEGACY = 'Ghi chu cua hang';
var WAREHOUSE_IMPORT_SHEET_NAME = 'Mẫu nhập kho';
var WAREHOUSE_IMPORT_SHEET_NAME_LEGACY = 'Mau nhap kho';
var WAREHOUSE_IMPORT_NOTES_SHEET_NAME = 'Ghi chú kho';

var STORE_IMPORT_NOTES = [
    {
        cot: 'Mã cửa hàng',
        bat_buoc: 'Có',
        cach_nhap: 'Nhập mã dạng CH0001.',
        dieu_kien: 'Mã phải duy nhất. Mã đầu tiên trong file mẫu được lấy bằng mã cửa hàng lớn nhất hiện tại cộng thêm 1; các dòng tiếp theo nên tăng tuần tự. Sheet kho dùng mã này để xác định kho thuộc cửa hàng nào.',
        vi_du: 'CH0005'
    },
    {
        cot: 'Tên cửa hàng',
        bat_buoc: 'Có',
        cach_nhap: 'Nhập tên cửa hàng cần tạo.',
        dieu_kien: 'Không được để trống. Mỗi dòng có tên cửa hàng sẽ được import thành một cửa hàng.',
        vi_du: 'Kiot HCM - Quận 1'
    },
    {
        cot: 'Mã số thuế',
        bat_buoc: 'Không',
        cach_nhap: 'Nhập mã số thuế dạng chữ hoặc số. Nên định dạng cột là Text nếu có số 0 ở đầu.',
        dieu_kien: 'Có thể để trống. Hệ thống lưu đúng giá trị trong file, không tự kiểm tra mã số thuế hợp lệ.',
        vi_du: '0100000001'
    },
    {
        cot: 'Địa chỉ chi tiết',
        bat_buoc: 'Không',
        cach_nhap: 'Nhập số nhà, tên đường, tọa độ hoặc mốc địa chỉ chi tiết.',
        dieu_kien: 'Có thể để trống. Khi import, địa chỉ đầy đủ được ghép từ địa chỉ chi tiết, phường/xã và tỉnh/thành.',
        vi_du: '123 Nguyễn Huệ'
    },
    {
        cot: 'Phường/xã',
        bat_buoc: 'Không',
        cach_nhap: 'Nhập tên phường, xã hoặc khu vực.',
        dieu_kien: 'Có thể để trống. Giá trị này chỉ được lưu theo text, không bắt buộc khớp danh mục hành chính.',
        vi_du: 'Bến Nghé'
    },
    {
        cot: 'Tỉnh/thành',
        bat_buoc: 'Không',
        cach_nhap: 'Nhập tên tỉnh hoặc thành phố.',
        dieu_kien: 'Có thể để trống. Giá trị này chỉ được lưu theo text.',
        vi_du: 'TP. Hồ Chí Minh'
    },
    {
        cot: 'Điện thoại',
        bat_buoc: 'Không',
        cach_nhap: 'Nhập số điện thoại của cửa hàng. Nên định dạng cột là Text nếu có số 0 ở đầu.',
        dieu_kien: 'Có thể để trống. Hệ thống lưu đúng giá trị trong file, không tự chuẩn hóa định dạng số điện thoại.',
        vi_du: '0901234567'
    },
    {
        cot: 'Email',
        bat_buoc: 'Không',
        cach_nhap: 'Nhập email liên hệ của cửa hàng.',
        dieu_kien: 'Có thể để trống. Hệ thống lưu theo text, không tự kiểm tra định dạng email.',
        vi_du: 'cua-hang@example.com'
    },
    {
        cot: 'Trạng thái',
        bat_buoc: 'Không',
        cach_nhap: 'Nhập "Đang hoạt động", "Ngừng hoạt động", "active" hoặc "inactive".',
        dieu_kien: 'Để trống sẽ mặc định là Đang hoạt động. Giá trị khác danh sách cho phép sẽ báo lỗi và không import.',
        vi_du: 'Đang hoạt động'
    }
];

var STORE_IMPORT_NOTE_COLUMNS = [
    { header: 'Cột', key: 'cot', width: 24 },
    { header: 'Bắt buộc', key: 'bat_buoc', width: 12 },
    { header: 'Cách nhập', key: 'cach_nhap', width: 42 },
    { header: 'Điều kiện', key: 'dieu_kien', width: 58 },
    { header: 'Ví dụ', key: 'vi_du', width: 24 }
];

var WAREHOUSE_IMPORT_NOTES = [
    {
        cot: 'Mã cửa hàng',
        bat_buoc: 'Có',
        cach_nhap: 'Nhập mã cửa hàng dạng CH0001.',
        dieu_kien: 'Phải tồn tại trong sheet Mẫu nhập cửa hàng hoặc đã tồn tại trong database. Đây là khóa liên kết kho với cửa hàng; không dùng tên cửa hàng để liên kết.',
        vi_du: 'CH0005'
    },
    {
        cot: 'Mã kho',
        bat_buoc: 'Không',
        cach_nhap: 'Có thể để trống để hệ thống tự sinh. Nếu nhập thì dùng dạng KHO0001.',
        dieu_kien: 'Nếu nhập thì phải đúng định dạng và duy nhất. Mã kho hiện unique toàn database.',
        vi_du: 'KHO0005'
    },
    {
        cot: 'Tên kho',
        bat_buoc: 'Có',
        cach_nhap: 'Nhập tên kho thuộc cửa hàng.',
        dieu_kien: 'Không được để trống.',
        vi_du: 'Kho chính'
    },
    {
        cot: 'Địa chỉ chi tiết',
        bat_buoc: 'Không',
        cach_nhap: 'Nhập số nhà, tên đường, tọa độ hoặc mốc địa chỉ chi tiết.',
        dieu_kien: 'Có thể để trống. Khi import, địa chỉ đầy đủ được ghép từ địa chỉ chi tiết, phường/xã và tỉnh/thành.',
        vi_du: '123 Nguyễn Huệ'
    },
    {
        cot: 'Phường/xã',
        bat_buoc: 'Không',
        cach_nhap: 'Nhập tên phường, xã hoặc khu vực.',
        dieu_kien: 'Có thể để trống.',
        vi_du: 'Bến Nghé'
    },
    {
        cot: 'Tỉnh/thành',
        bat_buoc: 'Không',
        cach_nhap: 'Nhập tên tỉnh hoặc thành phố.',
        dieu_kien: 'Có thể để trống.',
        vi_du: 'TP. Hồ Chí Minh'
    },
    {
        cot: 'Trạng thái',
        bat_buoc: 'Không',
        cach_nhap: 'Nhập "Đang hoạt động", "Ngừng hoạt động", "active" hoặc "inactive".',
        dieu_kien: 'Để trống mặc định là active. Không thêm cột kho mặc định vì schema Kho hiện chưa có field mac_dinh hoặc is_default.',
        vi_du: 'Đang hoạt động'
    }
];

function formatDate(value) {
    if (!value) return '---';
    return new Date(value).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function normalizeFilterQuery(query) {
    query = query || {};
    var status = query.status === 'active' || query.status === 'inactive' ? query.status : 'all';
    var city = String(query.city || 'all').trim() || 'all';
    var warehouse = ['all', 'none', 'has', 'gte1', 'gte2'].indexOf(query.warehouse) >= 0 ? query.warehouse : 'all';
    var created = ['all', 'today', '7days', '30days', 'custom'].indexOf(query.created) >= 0 ? query.created : 'all';
    var createdFrom = String(query.createdFrom || '').trim();
    var createdTo = String(query.createdTo || '').trim();
    var keyword = String(query.keyword || '').trim();

    return {
        status: status,
        city: city,
        warehouse: warehouse,
        created: created,
        createdFrom: createdFrom,
        createdTo: createdTo,
        keyword: keyword
    };
}

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

function isImportRowEmpty(row, columns) {
    columns = columns || STORE_IMPORT_COLUMNS;
    return columns.every(function(column) {
        return !String(row[column.key] || '').trim();
    });
}

function normalizeIdParam(value) {
    return String(value || '').trim();
}

function normalizeIdList(value) {
    var source = Array.isArray(value) ? value : [value];
    return source
        .map(function(item) { return String(item || '').trim(); })
        .filter(Boolean);
}

function getDateRange(filter) {
    var now = new Date();
    var start = null;
    var end = null;

    if (filter.created === 'today') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }

    if (filter.created === '7days') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }

    if (filter.created === '30days') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }

    if (filter.created === 'custom') {
        if (filter.createdFrom) {
            var parsedFrom = new Date(filter.createdFrom + 'T00:00:00');
            if (!isNaN(parsedFrom.getTime())) {
                start = parsedFrom;
            }
        }

        if (filter.createdTo) {
            var parsedTo = new Date(filter.createdTo + 'T23:59:59.999');
            if (!isNaN(parsedTo.getTime())) {
                end = parsedTo;
            }
        }
    }

    return { start: start, end: end };
}

function buildFilterQueryString(filter) {
    var params = [];

    if (filter.status !== 'all') params.push('status=' + encodeURIComponent(filter.status));
    if (filter.city !== 'all') params.push('city=' + encodeURIComponent(filter.city));
    if (filter.warehouse !== 'all') params.push('warehouse=' + encodeURIComponent(filter.warehouse));
    if (filter.created !== 'all') params.push('created=' + encodeURIComponent(filter.created));
    if (filter.created === 'custom' && filter.createdFrom) params.push('createdFrom=' + encodeURIComponent(filter.createdFrom));
    if (filter.created === 'custom' && filter.createdTo) params.push('createdTo=' + encodeURIComponent(filter.createdTo));
    if (filter.keyword) params.push('keyword=' + encodeURIComponent(filter.keyword));

    return params.join('&');
}

async function buildStoreQueryFromFilter(filter) {
    var dateRange = getDateRange(filter);
    var storeQuery = {};

    if (filter.keyword) {
        storeQuery.$or = [
            { ma_cua_hang: { $regex: filter.keyword, $options: 'i' } },
            { ten_cua_hang: { $regex: filter.keyword, $options: 'i' } }
        ];
    }

    if (filter.status !== 'all') {
        storeQuery.trang_thai = filter.status;
    }

    if (filter.city !== 'all') {
        storeQuery.tinh_thanh = filter.city;
    }

    if (dateRange.start || dateRange.end) {
        storeQuery.created_at = {};
        if (dateRange.start) storeQuery.created_at.$gte = dateRange.start;
        if (dateRange.end) storeQuery.created_at.$lte = dateRange.end;
    }

    if (filter.warehouse === 'none') {
        var storeIdsHaveWarehouse = await Kho.distinct('cua_hang_id');
        storeQuery._id = { $nin: storeIdsHaveWarehouse };
    }

    if (filter.warehouse === 'has' || filter.warehouse === 'gte1') {
        var storeIdsWithAtLeastOneWarehouse = await Kho.distinct('cua_hang_id');
        storeQuery._id = { $in: storeIdsWithAtLeastOneWarehouse };
    }

    if (filter.warehouse === 'gte2') {
        var groupedWarehouses = await Kho.aggregate([
            { $group: { _id: '$cua_hang_id', total: { $sum: 1 } } },
            { $match: { total: { $gte: 2 } } }
        ]);

        storeQuery._id = {
            $in: groupedWarehouses.map(function(item) {
                return item._id;
            })
        };
    }

    return storeQuery;
}

function exportText(value) {
    if (value === null || typeof value === 'undefined' || value === '') return '---';
    return value;
}

function exportStatus(value) {
    return value === 'inactive' ? 'Ngừng hoạt động' : 'Đang hoạt động';
}

function exportDate(value) {
    return value ? formatDate(value) : '---';
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

function applyNotesWorksheetFormat(worksheet) {
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
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

function addImportTemplateNotesSheet(workbook, sheetName, notes) {
    var worksheet = workbook.addWorksheet(sheetName);
    worksheet.columns = STORE_IMPORT_NOTE_COLUMNS;
    notes.forEach(function(note) {
        worksheet.addRow(note);
    });
    applyNotesWorksheetFormat(worksheet);
}

function parseCodeNumber(value, prefix) {
    var match = String(value || '').trim().match(new RegExp('^' + prefix + '(\\d+)$'));
    return match ? Number(match[1]) : 0;
}

function formatSequentialCode(prefix, number) {
    return prefix + String(number).padStart(4, '0');
}

async function getMaxSequentialCodeNumber(Model, field, prefix) {
    var rows = await Model.find({ [field]: new RegExp('^' + prefix + '\\d+$') }).select(field).lean();
    return rows.reduce(function(max, row) {
        return Math.max(max, parseCodeNumber(row[field], prefix));
    }, 0);
}

async function getNextStoreCodeNumber() {
    return (await getMaxSequentialCodeNumber(CuaHang, 'ma_cua_hang', 'CH')) + 1;
}

async function getNextWarehouseCodeNumber() {
    return (await getMaxSequentialCodeNumber(Kho, 'ma_kho', 'KHO')) + 1;
}

function buildStoreTemplateRow(maCuaHang) {
    return {
        ma_cua_hang: maCuaHang,
        ten_cua_hang: 'Kiot HCM - Quận 1',
        ma_so_thue: '0100000001',
        dia_chi_chi_tiet: '123 Nguyễn Huệ',
        phuong_xa: 'Bến Nghé',
        tinh_thanh: 'TP. Hồ Chí Minh',
        sdt: '0901234567',
        email: 'cua-hang@example.com',
        trang_thai: 'Đang hoạt động'
    };
}

function buildWarehouseTemplateRow(maCuaHang) {
    return {
        ma_cua_hang: maCuaHang,
        ma_kho: '',
        ten_kho: 'Kho chính',
        dia_chi_chi_tiet: '123 Nguyễn Huệ',
        phuong_xa: 'Bến Nghé',
        tinh_thanh: 'TP. Hồ Chí Minh',
        trang_thai: 'Đang hoạt động'
    };
}

async function buildImportTemplateWorkbook() {
    var workbook = new ExcelJS.Workbook();
    workbook.creator = 'Quan ly cua hang';
    workbook.created = new Date();
    var suggestedStoreCode = formatSequentialCode('CH', await getNextStoreCodeNumber());

    var storeWorksheet = workbook.addWorksheet(STORE_IMPORT_SHEET_NAME);
    storeWorksheet.columns = STORE_IMPORT_COLUMNS;
    storeWorksheet.addRow(buildStoreTemplateRow(suggestedStoreCode));
    applyExportWorksheetFormat(storeWorksheet);

    addImportTemplateNotesSheet(workbook, STORE_IMPORT_NOTES_SHEET_NAME, STORE_IMPORT_NOTES);

    var warehouseWorksheet = workbook.addWorksheet(WAREHOUSE_IMPORT_SHEET_NAME);
    warehouseWorksheet.columns = WAREHOUSE_IMPORT_COLUMNS;
    warehouseWorksheet.addRow(buildWarehouseTemplateRow(suggestedStoreCode));
    applyExportWorksheetFormat(warehouseWorksheet);

    addImportTemplateNotesSheet(workbook, WAREHOUSE_IMPORT_NOTES_SHEET_NAME, WAREHOUSE_IMPORT_NOTES);

    return workbook;
}

function readWorksheetHeaders(worksheet, columns) {
    var headerRow = worksheet.getRow(1);
    return columns.map(function(column, index) {
        return normalizeHeader(cellText(headerRow.getCell(index + 1).value));
    });
}

function validateWorksheetHeaders(worksheet, columns, sheetLabel) {
    var expected = columns.map(function(column) {
        return normalizeHeader(column.header);
    });
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

function matchesWorksheetHeaders(worksheet, columns) {
    var expected = columns.map(function(column) {
        return normalizeHeader(column.header);
    });
    var actual = readWorksheetHeaders(worksheet, columns);
    return expected.every(function(header, index) {
        return actual[index] === header;
    });
}

function parseImportWorksheet(worksheet, columns, sheetLabel) {
    validateWorksheetHeaders(worksheet, columns, sheetLabel);

    var rows = [];
    var rowCount = worksheet.rowCount || 0;

    for (var rowIndex = 2; rowIndex <= rowCount; rowIndex += 1) {
        var row = worksheet.getRow(rowIndex);
        var parsed = {};
        var hasValue = false;

        columns.forEach(function(column, columnIndex) {
            var value = cellText(row.getCell(columnIndex + 1).value);
            parsed[column.key] = value;
            if (value) hasValue = true;
        });

        if (!hasValue || isImportRowEmpty(parsed, columns)) continue;
        rows.push({
            rowNumber: rowIndex,
            sheetName: sheetLabel,
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
    var storeWorksheet = workbook.getWorksheet(STORE_IMPORT_SHEET_NAME)
        || workbook.getWorksheet(STORE_IMPORT_SHEET_NAME_LEGACY)
        || workbook.worksheets[0];

    if (!storeWorksheet) {
        var sheetError = new Error('Không tìm thấy sheet dữ liệu trong file Excel.');
        sheetError.code = 'import_empty_file';
        throw sheetError;
    }

    var legacyStoreSheet = !matchesWorksheetHeaders(storeWorksheet, STORE_IMPORT_COLUMNS)
        && matchesWorksheetHeaders(storeWorksheet, LEGACY_STORE_IMPORT_COLUMNS);
    var storeRows = parseImportWorksheet(
        storeWorksheet,
        legacyStoreSheet ? LEGACY_STORE_IMPORT_COLUMNS : STORE_IMPORT_COLUMNS,
        storeWorksheet.name || STORE_IMPORT_SHEET_NAME
    );
    var warehouseWorksheet = workbook.getWorksheet(WAREHOUSE_IMPORT_SHEET_NAME)
        || workbook.getWorksheet(WAREHOUSE_IMPORT_SHEET_NAME_LEGACY);
    var warehouseRows = warehouseWorksheet
        ? parseImportWorksheet(warehouseWorksheet, WAREHOUSE_IMPORT_COLUMNS, warehouseWorksheet.name || WAREHOUSE_IMPORT_SHEET_NAME)
        : [];

    return {
        storeRows: storeRows,
        warehouseRows: warehouseRows,
        legacyStoreSheet: legacyStoreSheet
    };
}

function isValidStoreCode(value) {
    return /^CH\d+$/.test(String(value || '').trim());
}

function isValidWarehouseCode(value) {
    return /^KHO\d+$/.test(String(value || '').trim());
}

function addDuplicateError(errors, map, value, rowNumber, message) {
    if (!value) return;
    if (map[value]) {
        errors.push(message(map[value], value));
        return;
    }
    map[value] = rowNumber;
}

function buildWarehousePayloadFromImportRow(row) {
    var diaChiChiTiet = String(row.dia_chi_chi_tiet || '').trim();
    var phuongXa = String(row.phuong_xa || '').trim();
    var tinhThanh = String(row.tinh_thanh || '').trim();
    var diaChiDayDu = buildFullAddress({
        dia_chi_chi_tiet: diaChiChiTiet,
        phuong_xa: phuongXa,
        tinh_thanh: tinhThanh
    });

    return {
        ma_kho: String(row.ma_kho || '').trim(),
        ten_kho: String(row.ten_kho || '').trim(),
        dia_chi_chi_tiet: diaChiChiTiet,
        phuong_xa: phuongXa,
        tinh_thanh: tinhThanh,
        dia_chi_day_du: diaChiDayDu,
        dia_chi: diaChiDayDu,
        trang_thai: normalizeImportStatus(row.trang_thai) || 'active'
    };
}

async function validateImportRows(parsed) {
    var storeRows = parsed.storeRows || [];
    var warehouseRows = parsed.warehouseRows || [];
    var legacyStoreSheet = !!parsed.legacyStoreSheet;
    var errors = [];
    var storeCodesInFile = {};
    var warehouseCodesInFile = {};
    var storeCodesToCreate = [];
    var warehouseStoreCodes = [];
    var warehouseCodes = [];

    storeRows.forEach(function(item) {
        var rowNumber = item.rowNumber;
        var data = item.data;
        var maCuaHang = String(data.ma_cua_hang || '').trim();
        var tenCuaHang = String(data.ten_cua_hang || '').trim();
        var trangThai = normalizeImportStatus(data.trang_thai);

        if (!legacyStoreSheet && !maCuaHang) {
            errors.push('Dòng ' + rowNumber + ' sheet Cửa hàng: thiếu mã cửa hàng.');
        } else if (maCuaHang && !isValidStoreCode(maCuaHang)) {
            errors.push('Dòng ' + rowNumber + ' sheet Cửa hàng: mã cửa hàng không đúng định dạng CH + số.');
        }

        if (maCuaHang) {
            addDuplicateError(errors, storeCodesInFile, maCuaHang, rowNumber, function(firstRow, code) {
                return 'Dòng ' + rowNumber + ' sheet Cửa hàng: trùng mã cửa hàng ' + code + ' trong file với dòng ' + firstRow + '.';
            });
            storeCodesToCreate.push(maCuaHang);
        }

        if (!tenCuaHang) {
            errors.push('Dòng ' + rowNumber + ' sheet Cửa hàng: thiếu tên cửa hàng.');
        }

        if (data.trang_thai && !trangThai) {
            errors.push('Dòng ' + rowNumber + ' sheet Cửa hàng: trạng thái không hợp lệ.');
        }
    });

    warehouseRows.forEach(function(item) {
        var rowNumber = item.rowNumber;
        var data = item.data;
        var maCuaHang = String(data.ma_cua_hang || '').trim();
        var maKho = String(data.ma_kho || '').trim();
        var tenKho = String(data.ten_kho || '').trim();
        var trangThai = normalizeImportStatus(data.trang_thai);

        if (!maCuaHang) {
            errors.push('Dòng ' + rowNumber + ' sheet Kho: thiếu mã cửa hàng.');
        } else {
            if (!isValidStoreCode(maCuaHang)) {
                errors.push('Dòng ' + rowNumber + ' sheet Kho: mã cửa hàng không đúng định dạng CH + số.');
            }
            warehouseStoreCodes.push(maCuaHang);
        }

        if (maKho) {
            if (!isValidWarehouseCode(maKho)) {
                errors.push('Dòng ' + rowNumber + ' sheet Kho: mã kho không đúng định dạng KHO + số.');
            }
            addDuplicateError(errors, warehouseCodesInFile, maKho, rowNumber, function(firstRow, code) {
                return 'Dòng ' + rowNumber + ' sheet Kho: trùng mã kho ' + code + ' trong file với dòng ' + firstRow + '.';
            });
            warehouseCodes.push(maKho);
        }

        if (!tenKho) {
            errors.push('Dòng ' + rowNumber + ' sheet Kho: thiếu tên kho.');
        }

        if (data.trang_thai && !trangThai) {
            errors.push('Dòng ' + rowNumber + ' sheet Kho: trạng thái không hợp lệ.');
        }
    });

    var existingStores = [];
    var existingWarehouses = [];
    var allStoreRefs = Array.from(new Set(storeCodesToCreate.concat(warehouseStoreCodes)));

    if (allStoreRefs.length > 0) {
        existingStores = await CuaHang.find({ ma_cua_hang: { $in: allStoreRefs } }).select('_id ma_cua_hang').lean();
    }

    if (warehouseCodes.length > 0) {
        existingWarehouses = await Kho.find({ ma_kho: { $in: Array.from(new Set(warehouseCodes)) } }).select('_id ma_kho').lean();
    }

    var existingStoreMap = {};
    existingStores.forEach(function(store) {
        existingStoreMap[store.ma_cua_hang] = store;
    });

    var newStoreCodeMap = {};
    storeRows.forEach(function(item) {
        var code = String(item.data.ma_cua_hang || '').trim();
        if (!code) return;
        newStoreCodeMap[code] = true;
        if (existingStoreMap[code]) {
            errors.push('Dòng ' + item.rowNumber + ' sheet Cửa hàng: mã cửa hàng ' + code + ' đã tồn tại trong database.');
        }
    });

    warehouseRows.forEach(function(item) {
        var code = String(item.data.ma_cua_hang || '').trim();
        if (code && !newStoreCodeMap[code] && !existingStoreMap[code]) {
            errors.push('Dòng ' + item.rowNumber + ' sheet Kho: không tìm thấy cửa hàng có mã ' + code + '.');
        }
    });

    var existingWarehouseCodeMap = {};
    existingWarehouses.forEach(function(warehouse) {
        existingWarehouseCodeMap[warehouse.ma_kho] = true;
    });

    warehouseRows.forEach(function(item) {
        var code = String(item.data.ma_kho || '').trim();
        if (code && existingWarehouseCodeMap[code]) {
            errors.push('Dòng ' + item.rowNumber + ' sheet Kho: mã kho ' + code + ' đã tồn tại trong database.');
        }
    });

    if (errors.length > 0) {
        var validationError = new Error(errors.slice(0, 8).join(' '));
        validationError.code = 'import_invalid_rows';
        validationError.details = errors;
        throw validationError;
    }

    return {
        storeRows: storeRows,
        warehouseRows: warehouseRows,
        legacyStoreSheet: legacyStoreSheet,
        existingStoreMap: existingStoreMap
    };
}

function isTransactionUnsupportedError(error) {
    var message = String(error && error.message || '').toLowerCase();
    return message.indexOf('transaction numbers are only allowed') >= 0
        || message.indexOf('replica set member or mongos') >= 0
        || message.indexOf('transactions are not supported') >= 0
        || message.indexOf('transaction') >= 0 && message.indexOf('not supported') >= 0;
}

async function persistImportPlan(plan, session) {
    var storeIdByCode = {};
    var insertedStores = 0;
    var insertedWarehouses = 0;
    var nextLegacyStoreNumber = plan.legacyStoreSheet ? await getNextStoreCodeNumber() : 0;
    var nextWarehouseNumber = await getNextWarehouseCodeNumber();
    var reservedWarehouseCodes = {};

    Object.keys(plan.existingStoreMap || {}).forEach(function(code) {
        storeIdByCode[code] = plan.existingStoreMap[code]._id;
    });

    plan.warehouseRows.forEach(function(item) {
        var code = String(item.data.ma_kho || '').trim();
        if (code) reservedWarehouseCodes[code] = true;
    });

    for (var i = 0; i < plan.storeRows.length; i += 1) {
        var storeData = plan.storeRows[i].data;
        var storePayload = buildStorePayloadFromImportRow(storeData);
        var storeCode = String(storeData.ma_cua_hang || '').trim();

        if (!storeCode) {
            storeCode = formatSequentialCode('CH', nextLegacyStoreNumber);
            nextLegacyStoreNumber += 1;
        }

        storePayload.ma_cua_hang = storeCode;
        var createdStores = session
            ? await CuaHang.create([storePayload], { session: session })
            : await CuaHang.create([storePayload]);
        storeIdByCode[storeCode] = createdStores[0]._id;
        insertedStores += 1;
    }

    for (var j = 0; j < plan.warehouseRows.length; j += 1) {
        var warehouseData = plan.warehouseRows[j].data;
        var warehousePayload = buildWarehousePayloadFromImportRow(warehouseData);
        var warehouseCode = String(warehouseData.ma_kho || '').trim();

        if (!warehouseCode) {
            do {
                warehouseCode = formatSequentialCode('KHO', nextWarehouseNumber);
                nextWarehouseNumber += 1;
            } while (reservedWarehouseCodes[warehouseCode]);
            reservedWarehouseCodes[warehouseCode] = true;
        }

        warehousePayload.ma_kho = warehouseCode;
        warehousePayload.cua_hang_id = storeIdByCode[String(warehouseData.ma_cua_hang || '').trim()];
        if (session) {
            await Kho.create([warehousePayload], { session: session });
        } else {
            await Kho.create([warehousePayload]);
        }
        insertedWarehouses += 1;
    }

    return {
        insertedStores: insertedStores,
        insertedWarehouses: insertedWarehouses
    };
}

async function persistImportWithBestEffortTransaction(plan) {
    var session = await CuaHang.db.startSession();
    var result;

    try {
        await session.withTransaction(async function() {
            result = await persistImportPlan(plan, session);
        });
        return {
            result: result,
            usedTransaction: true
        };
    } catch (error) {
        if (!isTransactionUnsupportedError(error)) {
            throw error;
        }

        result = await persistImportPlan(plan, null);
        return {
            result: result,
            usedTransaction: false
        };
    } finally {
        session.endSession();
    }
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

function buildStoreAddress(store) {
    return store.dia_chi_day_du || buildFullAddress(store) || store.dia_chi || '';
}

async function seedStoresIfEmpty() {
    var count = await CuaHang.countDocuments();
    if (count > 0) return;

    var stores = await CuaHang.insertMany([
        {
            ma_cua_hang: 'CH0001',
            ten_cua_hang: 'Cua hang trung tam',
            ma_so_thue: '0100000001',
            dia_chi_chi_tiet: '12 Nguyen Trai',
            tinh_thanh: 'Ha Noi',
            phuong_xa: 'Thuong Dinh',
            dia_chi_day_du: buildFullAddress({ dia_chi_chi_tiet: '12 Nguyen Trai', phuong_xa: 'Thuong Dinh', tinh_thanh: 'Ha Noi' }),
            sdt: '0901000001',
            email: 'trungtam@example.com',
            trang_thai: 'active'
        },
        {
            ma_cua_hang: 'CH0002',
            ten_cua_hang: 'Cua hang Quan 1',
            ma_so_thue: '0300000002',
            dia_chi_chi_tiet: '25 Le Loi',
            tinh_thanh: 'TP Ho Chi Minh',
            phuong_xa: 'Ben Nghe',
            dia_chi_day_du: buildFullAddress({ dia_chi_chi_tiet: '25 Le Loi', phuong_xa: 'Ben Nghe', tinh_thanh: 'TP Ho Chi Minh' }),
            sdt: '0901000002',
            email: 'quan1@example.com',
            trang_thai: 'active'
        },
        {
            ma_cua_hang: 'CH0003',
            ten_cua_hang: 'Cua hang Da Nang',
            ma_so_thue: '0400000003',
            dia_chi_chi_tiet: '40 Bach Dang',
            tinh_thanh: 'Da Nang',
            phuong_xa: 'Thach Thang',
            dia_chi_day_du: buildFullAddress({ dia_chi_chi_tiet: '40 Bach Dang', phuong_xa: 'Thach Thang', tinh_thanh: 'Da Nang' }),
            sdt: '0901000003',
            email: 'danang@example.com',
            trang_thai: 'active'
        }
    ]);

    await Kho.insertMany([
        {
            cua_hang_id: stores[0]._id,
            ma_kho: 'KHO0001',
            ten_kho: 'Kho ban hang trung tam',
            dia_chi_chi_tiet: '12 Nguyen Trai',
            phuong_xa: 'Thuong Dinh',
            tinh_thanh: 'Ha Noi',
            dia_chi_day_du: buildFullAddress({ dia_chi_chi_tiet: '12 Nguyen Trai', phuong_xa: 'Thuong Dinh', tinh_thanh: 'Ha Noi' }),
            trang_thai: 'active'
        },
        {
            cua_hang_id: stores[0]._id,
            ma_kho: 'KHO0002',
            ten_kho: 'Kho du tru trung tam',
            dia_chi_chi_tiet: '18 Nguyen Trai',
            phuong_xa: 'Thuong Dinh',
            tinh_thanh: 'Ha Noi',
            dia_chi_day_du: buildFullAddress({ dia_chi_chi_tiet: '18 Nguyen Trai', phuong_xa: 'Thuong Dinh', tinh_thanh: 'Ha Noi' }),
            trang_thai: 'active'
        },
        {
            cua_hang_id: stores[1]._id,
            ma_kho: 'KHO0003',
            ten_kho: 'Kho Quan 1',
            dia_chi_chi_tiet: '25 Le Loi',
            phuong_xa: 'Ben Nghe',
            tinh_thanh: 'TP Ho Chi Minh',
            dia_chi_day_du: buildFullAddress({ dia_chi_chi_tiet: '25 Le Loi', phuong_xa: 'Ben Nghe', tinh_thanh: 'TP Ho Chi Minh' }),
            trang_thai: 'active'
        },
        {
            cua_hang_id: stores[2]._id,
            ma_kho: 'KHO0004',
            ten_kho: 'Kho Da Nang',
            dia_chi_chi_tiet: '40 Bach Dang',
            phuong_xa: 'Thach Thang',
            tinh_thanh: 'Da Nang',
            dia_chi_day_du: buildFullAddress({ dia_chi_chi_tiet: '40 Bach Dang', phuong_xa: 'Thach Thang', tinh_thanh: 'Da Nang' }),
            trang_thai: 'active'
        }
    ]);
}

function normalizeStorePayload(body) {
    body = body || {};
    var address = normalizeAddress(body);
    return {
        ma_cua_hang: String(body.ma_cua_hang || '').trim(),
        ten_cua_hang: String(body.ten_cua_hang || '').trim(),
        ma_so_thue: String(body.ma_so_thue || '').trim(),
        dia_chi_chi_tiet: address.dia_chi_chi_tiet,
        tinh_thanh: address.tinh_thanh,
        tinh_thanh_id: address.tinh_thanh_id,
        phuong_xa: address.phuong_xa,
        phuong_xa_code: address.phuong_xa_code,
        dia_chi_day_du: address.dia_chi_day_du,
        dia_chi: address.dia_chi_day_du,
        sdt: String(body.sdt || '').trim(),
        email: String(body.email || '').trim(),
        trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
    };
}

async function makeStoreCode() {
    return formatSequentialCode('CH', await getNextStoreCodeNumber());
}

function normalizeWarehousePayload(body) {
    body = body || {};
    var address = normalizeAddress(body);
    var diaChiDayDu = address.dia_chi_day_du || address.dia_chi_chi_tiet;
    return {
        ma_kho: String(body.ma_kho || '').trim(),
        ten_kho: String(body.ten_kho || '').trim(),
        dia_chi_chi_tiet: address.dia_chi_chi_tiet,
        tinh_thanh: address.tinh_thanh,
        phuong_xa: address.phuong_xa,
        dia_chi_day_du: diaChiDayDu,
        dia_chi: diaChiDayDu,
        trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
    };
}

function enrichWarehouseRow(warehouse) {
    if (!warehouse) return warehouse;
    var row = Object.assign({}, warehouse);
    var legacyAddress = String(row.dia_chi || '').trim();
    if (!String(row.dia_chi_chi_tiet || '').trim() && legacyAddress) {
        row.dia_chi_chi_tiet = legacyAddress;
    }
    if (!String(row.dia_chi_day_du || '').trim()) {
        row.dia_chi_day_du = buildFullAddress(row) || legacyAddress;
    }
    if (!String(row.dia_chi || '').trim() && row.dia_chi_day_du) {
        row.dia_chi = row.dia_chi_day_du;
    }
    return row;
}

async function makeWarehouseCode() {
    return formatSequentialCode('KHO', await getNextWarehouseCodeNumber());
}

exports.index = async function(req, res, next) {
    try {
        var requestQuery = req?.query || {};
        var filter = normalizeFilterQuery(requestQuery);
        var storeQuery = await buildStoreQueryFromFilter(filter);

        var stores = await CuaHang.find(storeQuery).sort({ created_at: 1, ma_cua_hang: 1 }).lean();
        var storeIds = stores.map(function(store) { return store._id; });
        var warehouseRows = storeIds.length > 0
            ? await Kho.find({ cua_hang_id: { $in: storeIds } }).select('cua_hang_id').lean()
            : [];

        var warehouseCountMap = warehouseRows.reduce(function(map, warehouse) {
            var key = String(warehouse.cua_hang_id || '');
            map[key] = (map[key] || 0) + 1;
            return map;
        }, {});

        var provinceRows = await CuaHang.find().select('tinh_thanh').lean();
        var provinceOptions = provinceRows
            .map(function(store) { return String(store.tinh_thanh || '').trim(); })
            .filter(Boolean)
            .filter(function(city, index, cities) { return cities.indexOf(city) === index; })
            .sort(function(a, b) { return a.localeCompare(b, 'vi'); });

        var hasStoreQuery = Object.prototype.hasOwnProperty.call(requestQuery, 'store');
        var selectedStoreId = hasStoreQuery ? String(requestQuery.store || '') : '';
        var selectedStore = selectedStoreId
            ? stores.find(function(store) {
                return String(store._id) === selectedStoreId;
            }) || null
            : null;

        var warehouses = selectedStore
            ? (await Kho.find({ cua_hang_id: selectedStore._id }).sort({ created_at: 1, ma_kho: 1 }).lean())
                .map(enrichWarehouseRow)
            : [];

        var editingStore = requestQuery.edit
            ? stores.find(function(store) {
                return String(store._id) === String(requestQuery.edit);
            })
            : null;

        res.render('cua-hang/index', {
            title: 'Cửa hàng',
            pageTitle: 'Cửa hàng',
            activeMenu: 'cua-hang',
            user: req.user,
            flash: requestQuery,
            stores: stores,
            selectedStore: selectedStore,
            editingStore: editingStore,
            formMode: editingStore ? 'edit' : (requestQuery.mode === 'create' ? 'create' : ''),
            warehouses: warehouses,
            warehouseCountMap: warehouseCountMap,
            formatDate: formatDate,
            filter: filter,
            filterQueryString: buildFilterQueryString(filter),
            provinceOptions: provinceOptions
        });
    } catch (error) {
        next(error);
    }
};

exports.exportExcel = async function(req, res, next) {
    try {
        var filter = normalizeFilterQuery(req?.query || {});
        var storeQuery = await buildStoreQueryFromFilter(filter);
        var stores = await CuaHang.find(storeQuery).sort({ created_at: 1, ma_cua_hang: 1 }).lean();
        var storeIds = stores.map(function(store) { return store._id; });
        var warehouseRows = storeIds.length
            ? await Kho.find({ cua_hang_id: { $in: storeIds } }).select('cua_hang_id').lean()
            : [];
        var warehouseCountMap = warehouseRows.reduce(function(map, warehouse) {
            var key = String(warehouse.cua_hang_id || '');
            map[key] = (map[key] || 0) + 1;
            return map;
        }, {});

        var workbook = new ExcelJS.Workbook();
        workbook.creator = 'Quan ly cua hang';
        workbook.created = new Date();
        addExportSheet(workbook, 'Cửa hàng', [
            { header: 'Mã cửa hàng', key: 'ma_cua_hang', width: 16 },
            { header: 'Tên cửa hàng', key: 'ten_cua_hang', width: 28 },
            { header: 'Mã số thuế', key: 'ma_so_thue', width: 18 },
            { header: 'Địa chỉ', key: 'dia_chi', width: 42 },
            { header: 'Điện thoại', key: 'sdt', width: 16 },
            { header: 'Email', key: 'email', width: 28 },
            { header: 'Số lượng kho', key: 'so_luong_kho', width: 14 },
            { header: 'Trạng thái', key: 'trang_thai', width: 18 },
            { header: 'Thời gian tạo', key: 'created_at', width: 20 }
        ], stores.map(function(store) {
            return {
                ma_cua_hang: exportText(store.ma_cua_hang),
                ten_cua_hang: exportText(store.ten_cua_hang),
                ma_so_thue: exportText(store.ma_so_thue),
                dia_chi: exportText(buildStoreAddress(store)),
                sdt: exportText(store.sdt),
                email: exportText(store.email),
                so_luong_kho: warehouseCountMap[String(store._id)] || 0,
                trang_thai: exportStatus(store.trang_thai),
                created_at: exportDate(store.created_at)
            };
        }));

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="danh-sach-cua-hang.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};

exports.exportSectionExcel = async function(req, res, next) {
    try {
        var storeId = normalizeIdParam(req?.params?.id);
        var section = normalizeIdParam(req?.params?.section);
        var sectionMap = {
            info: { label: 'thong-tin', sheet: 'Thông tin' },
            warehouses: { label: 'danh-sach-kho', sheet: 'Danh sách kho' },
            notes: { label: 'ghi-chu', sheet: 'Ghi chú' }
        };
        if (!storeId || !sectionMap[section]) return res.redirect('/cua-hang?error=invalid_store');

        var store = await CuaHang.findById(storeId).lean();
        if (!store) return res.redirect('/cua-hang?error=invalid_store');

        var workbook = new ExcelJS.Workbook();
        workbook.creator = 'Quan ly cua hang';
        workbook.created = new Date();

        if (section === 'info') {
            addExportSheet(workbook, 'Thông tin', [
                { header: 'Trường thông tin', key: 'label', width: 28 },
                { header: 'Giá trị', key: 'value', width: 44 }
            ], [
                { label: 'Mã cửa hàng', value: exportText(store.ma_cua_hang) },
                { label: 'Tên cửa hàng', value: exportText(store.ten_cua_hang) },
                { label: 'Mã số thuế', value: exportText(store.ma_so_thue) },
                { label: 'Địa chỉ', value: exportText(store.dia_chi_day_du) },
                { label: 'Phường/xã', value: exportText(store.phuong_xa) },
                { label: 'Tỉnh/thành', value: exportText(store.tinh_thanh) },
                { label: 'Điện thoại', value: exportText(store.sdt) },
                { label: 'Email', value: exportText(store.email) },
                { label: 'Trạng thái', value: exportStatus(store.trang_thai) },
                { label: 'Thời gian tạo', value: exportDate(store.created_at) },
                { label: 'Cập nhật lúc', value: exportDate(store.updated_at) }
            ]);
        }

        if (section === 'warehouses') {
            var warehouses = await Kho.find({ cua_hang_id: store._id }).sort({ created_at: 1, ma_kho: 1 }).lean();
            addExportSheet(workbook, 'Danh sách kho', [
                { header: 'Mã kho', key: 'ma_kho', width: 16 },
                { header: 'Tên kho', key: 'ten_kho', width: 28 },
                { header: 'Địa chỉ', key: 'dia_chi', width: 42 },
                { header: 'Trạng thái', key: 'trang_thai', width: 18 },
                { header: 'Thời gian tạo', key: 'created_at', width: 20 }
            ], warehouses.map(function(warehouse) {
                return {
                    ma_kho: exportText(warehouse.ma_kho),
                    ten_kho: exportText(warehouse.ten_kho),
                    dia_chi: exportText(warehouse.dia_chi_day_du),
                    trang_thai: exportStatus(warehouse.trang_thai),
                    created_at: exportDate(warehouse.created_at)
                };
            }));
        }

        if (section === 'notes') {
            addExportSheet(workbook, 'Ghi chú', [
                { header: 'Nội dung ghi chú', key: 'ghi_chu', width: 60 }
            ], [
                { ghi_chu: exportText(store.ghi_chu) }
            ]);
        }

        var filename = 'cua-hang-' + safeExportFilenamePart(store.ma_cua_hang || store._id) + '-' + sectionMap[section].label + '.xlsx';
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};

exports.add = async function(req, res, next) {
    try {
        var payload = normalizeStorePayload(req?.body);

        if (!payload.ten_cua_hang) {
            return res.redirect('/cua-hang?mode=create&error=missing_name');
        }

        if (!payload.ma_cua_hang) {
            payload.ma_cua_hang = await makeStoreCode();
        }

        var store = await CuaHang.create(payload);
        res.redirect('/cua-hang?store=' + store._id + '&success=created');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/cua-hang?mode=create&error=duplicate_code');
        }

        next(error);
    }
};

exports.update = async function(req, res, next) {
    try {
        var storeId = normalizeIdParam(req?.params?.id);
        if (!storeId) return res.redirect('/cua-hang?error=invalid_store');

        var payload = normalizeStorePayload(req?.body);

        if (!payload.ten_cua_hang) {
            return res.redirect('/cua-hang?edit=' + storeId + '&error=missing_name');
        }

        if (!payload.ma_cua_hang) {
            delete payload.ma_cua_hang;
        }

        await CuaHang.findByIdAndUpdate(storeId, payload, { runValidators: true });
        res.redirect('/cua-hang?store=' + storeId + '&success=updated');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/cua-hang?error=duplicate_code');
        }

        next(error);
    }
};

exports.remove = async function(req, res, next) {
    try {
        var storeId = normalizeIdParam(req?.params?.id);
        if (!storeId) return res.redirect('/cua-hang?error=invalid_store');
        await Kho.deleteMany({ cua_hang_id: storeId });
        await CuaHang.findByIdAndDelete(storeId);
        res.redirect('/cua-hang?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.removeSelected = async function(req, res, next) {
    try {
        var ids = normalizeIdList(req?.body?.ids);

        if (ids.length === 0) {
            return res.redirect('/cua-hang?error=no_selection');
        }

        await Kho.deleteMany({ cua_hang_id: { $in: ids } });
        await CuaHang.deleteMany({ _id: { $in: ids } });

        res.redirect('/cua-hang?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.addWarehouse = async function(req, res, next) {
    try {
        var storeId = normalizeIdParam(req?.params?.id);
        if (!storeId) {
            return res.redirect('/cua-hang?error=invalid_store');
        }

        var payload = normalizeWarehousePayload(req?.body);
        if (!payload.ten_kho) {
            return res.redirect('/cua-hang?store=' + storeId + '&error=missing_warehouse_name');
        }

        if (!payload.ma_kho) {
            payload.ma_kho = await makeWarehouseCode();
        }

        payload.cua_hang_id = storeId;
        await Kho.create(payload);
        res.redirect('/cua-hang?store=' + storeId + '&success=created');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/cua-hang?store=' + req.params.id + '&error=duplicate_code');
        }
        next(error);
    }
};

exports.updateWarehouse = async function(req, res, next) {
    try {
        var payload = normalizeWarehousePayload(req?.body);
        var warehouseId = normalizeIdParam(req?.params?.warehouseId);
        var storeId = normalizeIdParam(req?.params?.id);

        if (!warehouseId || !storeId) {
            return res.redirect('/cua-hang?error=invalid_warehouse');
        }

        if (!payload.ten_kho) {
            return res.redirect('/cua-hang?store=' + storeId + '&error=missing_warehouse_name');
        }

        if (!payload.ma_kho) {
            delete payload.ma_kho;
        }

        await Kho.findOneAndUpdate(
            { _id: warehouseId, cua_hang_id: storeId },
            payload,
            { runValidators: true }
        );

        res.redirect('/cua-hang?store=' + storeId + '&success=updated');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/cua-hang?store=' + req.params.id + '&error=duplicate_code');
        }
        next(error);
    }
};

exports.removeWarehouse = async function(req, res, next) {
    try {
        var warehouseId = normalizeIdParam(req?.params?.warehouseId);
        var storeId = normalizeIdParam(req?.params?.id);

        if (!warehouseId || !storeId) {
            return res.redirect('/cua-hang?error=invalid_warehouse');
        }

        await Kho.findOneAndDelete({ _id: warehouseId, cua_hang_id: storeId });
        res.redirect('/cua-hang?store=' + storeId + '&success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.downloadImportTemplate = async function(req, res, next) {
    try {
        var workbook = await buildImportTemplateWorkbook();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="mau-nhap-cua-hang.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};

exports.importExcel = async function(req, res, next) {
    try {
        var file = req?.file;
        if (!file || !file.buffer || !file.buffer.length) {
            return res.redirect('/cua-hang?error=import_missing_file');
        }

        var fileName = String(file.originalname || '').toLowerCase();
        if (!/\.xlsx$/i.test(fileName)) {
            return res.redirect('/cua-hang?error=import_invalid_file_type');
        }

        var parsedImport = await parseStoreImportBuffer(file.buffer);
        if (!parsedImport.storeRows.length && !parsedImport.warehouseRows.length) {
            return res.redirect('/cua-hang?error=import_empty_file');
        }

        var importPlan = await validateImportRows(parsedImport);
        var persisted = await persistImportWithBestEffortTransaction(importPlan);
        var insertedStores = persisted.result.insertedStores;
        var insertedWarehouses = persisted.result.insertedWarehouses;

        if (insertedStores === 0 && insertedWarehouses === 0) {
            return res.redirect('/cua-hang?error=import_empty_file');
        }

        var successQuery = 'imported=' + insertedStores
            + '&import_label=' + encodeURIComponent('cửa hàng')
            + '&imported_kho=' + insertedWarehouses;
        if (!persisted.usedTransaction) {
            successQuery += '&import_warning=' + encodeURIComponent('MongoDB hiện không hỗ trợ transaction; file đã được validate toàn bộ trước khi ghi.');
        }

        res.redirect('/cua-hang?success=imported&' + successQuery);
    } catch (error) {
        if (error && error.code === 'import_invalid_headers') {
            return res.redirect('/cua-hang?error=import_invalid_headers');
        }
        if (error && error.code === 'import_invalid_rows') {
            return res.redirect('/cua-hang?error=' + encodeURIComponent(error.message || 'import_invalid_rows'));
        }
        if (error && error.code === 'import_empty_file') {
            return res.redirect('/cua-hang?error=import_empty_file');
        }

        next(error);
    }
};
