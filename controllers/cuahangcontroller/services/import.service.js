const ExcelJS = require('exceljs');
const { CuaHang, Kho } = require('../../../models/kiot.model');
const { buildFullAddress } = require('../../../utils/address');
const {
    STORE_IMPORT_COLUMNS,
    WAREHOUSE_IMPORT_COLUMNS,
    LEGACY_STORE_IMPORT_COLUMNS,
    STORE_IMPORT_SHEET_NAME,
    STORE_IMPORT_SHEET_NAME_LEGACY,
    WAREHOUSE_IMPORT_SHEET_NAME,
    WAREHOUSE_IMPORT_SHEET_NAME_LEGACY
} = require('../helpers/excel.helper');
const {
    getNextStoreCodeNumber,
    getNextWarehouseCodeNumber,
    formatSequentialCode,
    isValidStoreCode,
    isValidWarehouseCode
} = require('../helpers/code.helper');

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

module.exports = {
    normalizeHeader,
    cellText,
    normalizeImportStatus,
    buildStorePayloadFromImportRow,
    buildWarehousePayloadFromImportRow,
    isImportRowEmpty,
    readWorksheetHeaders,
    validateWorksheetHeaders,
    matchesWorksheetHeaders,
    parseImportWorksheet,
    parseStoreImportBuffer,
    addDuplicateError,
    validateImportRows,
    isTransactionUnsupportedError,
    persistImportPlan,
    persistImportWithBestEffortTransaction
};
