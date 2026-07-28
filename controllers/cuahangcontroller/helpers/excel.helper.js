const ExcelJS = require('exceljs');
const { formatSequentialCode, getNextStoreCodeNumber } = require('./code.helper');

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
        bat_buoc: 'x',
        cach_nhap: 'Nhập mã dạng CH0001.',
        dieu_kien: 'Mã phải duy nhất. Mã đầu tiên trong file mẫu được lấy bằng mã cửa hàng lớn nhất hiện tại cộng thêm 1; các dòng tiếp theo nên tăng tuần tự. Sheet kho dùng mã này để xác định kho thuộc cửa hàng nào.',
        vi_du: 'CH0005'
    },
    {
        cot: 'Tên cửa hàng',
        bat_buoc: 'x',
        cach_nhap: 'Nhập tên cửa hàng cần tạo.',
        dieu_kien: 'Không được để trống. Mỗi dòng có tên cửa hàng sẽ được import thành một cửa hàng.',
        vi_du: 'Kiot HCM - Quận 1'
    },
    {
        cot: 'Mã số thuế',
        bat_buoc: '',
        cach_nhap: 'Nhập mã số thuế dạng chữ hoặc số. Nên định dạng cột là Text nếu có số 0 ở đầu.',
        dieu_kien: 'Có thể để trống. Hệ thống lưu đúng giá trị trong file, không tự kiểm tra mã số thuế hợp lệ.',
        vi_du: '0100000001'
    },
    {
        cot: 'Địa chỉ chi tiết',
        bat_buoc: '',
        cach_nhap: 'Nhập số nhà, tên đường, tọa độ hoặc mốc địa chỉ chi tiết.',
        dieu_kien: 'Có thể để trống. Khi import, địa chỉ đầy đủ được ghép từ địa chỉ chi tiết, phường/xã và tỉnh/thành.',
        vi_du: '123 Nguyễn Huệ'
    },
    {
        cot: 'Phường/xã',
        bat_buoc: '',
        cach_nhap: 'Nhập tên phường, xã hoặc khu vực.',
        dieu_kien: 'Có thể để trống. Giá trị này chỉ được lưu theo text, không bắt buộc khớp danh mục hành chính.',
        vi_du: 'Bến Nghé'
    },
    {
        cot: 'Tỉnh/thành',
        bat_buoc: '',
        cach_nhap: 'Nhập tên tỉnh hoặc thành phố.',
        dieu_kien: 'Có thể để trống. Giá trị này chỉ được lưu theo text.',
        vi_du: 'TP. Hồ Chí Minh'
    },
    {
        cot: 'Điện thoại',
        bat_buoc: '',
        cach_nhap: 'Nhập số điện thoại của cửa hàng. Nên định dạng cột là Text nếu có số 0 ở đầu.',
        dieu_kien: 'Có thể để trống. Hệ thống lưu đúng giá trị trong file, không tự chuẩn hóa định dạng số điện thoại.',
        vi_du: '0901234567'
    },
    {
        cot: 'Email',
        bat_buoc: '',
        cach_nhap: 'Nhập email liên hệ của cửa hàng.',
        dieu_kien: 'Có thể để trống. Hệ thống lưu theo text, không tự kiểm tra định dạng email.',
        vi_du: 'cua-hang@example.com'
    },
    {
        cot: 'Trạng thái',
        bat_buoc: '',
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

function addExportSheet(workbook, name, columns, rows) {
    var worksheet = workbook.addWorksheet(name);
    worksheet.columns = columns;
    rows.forEach(function(row) {
        worksheet.addRow(row);
    });
    applyExportWorksheetFormat(worksheet);
    return worksheet;
}

module.exports = {
    STORE_IMPORT_COLUMNS,
    WAREHOUSE_IMPORT_COLUMNS,
    LEGACY_STORE_IMPORT_COLUMNS,
    STORE_IMPORT_SHEET_NAME,
    STORE_IMPORT_SHEET_NAME_LEGACY,
    STORE_IMPORT_NOTES_SHEET_NAME,
    STORE_IMPORT_NOTES_SHEET_NAME_LEGACY,
    WAREHOUSE_IMPORT_SHEET_NAME,
    WAREHOUSE_IMPORT_SHEET_NAME_LEGACY,
    WAREHOUSE_IMPORT_NOTES_SHEET_NAME,
    STORE_IMPORT_NOTES,
    STORE_IMPORT_NOTE_COLUMNS,
    WAREHOUSE_IMPORT_NOTES,
    exportText,
    exportStatus,
    exportDate,
    safeExportFilenamePart,
    applyExportWorksheetFormat,
    applyNotesWorksheetFormat,
    addImportTemplateNotesSheet,
    addExportSheet,
    buildStoreTemplateRow,
    buildWarehouseTemplateRow,
    buildImportTemplateWorkbook
};
