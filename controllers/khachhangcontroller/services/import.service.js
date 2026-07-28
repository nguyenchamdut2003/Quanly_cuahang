var { KhachHang, DiaChiKhachHang } = require('../../../models/kiot.model');
var khachHangImportService = require('../../../services/khachHangImport.service');
var {
    normalizeCustomerPayload,
    finalizeCustomerPayload,
    validateCustomerPayload
} = require('../helpers/customer.helper');
var {
    makeCustomerCode,
    getNextCustomerCodeSuggestion,
    isValidCustomerImportCode,
    isValidAddressImportCode,
    makeAddressCode
} = require('../helpers/code.helper');
var {
    normalizeAddressPayload,
    resolveImportAddressType,
    buildImportAddressTypeState
} = require('../helpers/address.helper');

async function buildImportTemplateWorkbook() {
    return await khachHangImportService.buildImportTemplateWorkbook({
        suggestedCustomerCode: await getNextCustomerCodeSuggestion()
    });
}
async function importExcelFile(options) {
    var req = options || {};
    try {
        var file = req?.file;
        if (!file || !file.buffer || !file.buffer.length) {
            return '/khach-hang?error=import_missing_file';
        }

        var fileName = String(file.originalname || '').toLowerCase();
        if (!/\.xlsx$/i.test(fileName)) {
            return '/khach-hang?error=import_invalid_file_type';
        }

        var parsedImport = await khachHangImportService.parseCustomerImportBuffer(file.buffer);
        var customerRows = parsedImport.customerRows || [];
        var addressRows = parsedImport.addressRows || [];
        var legacyCustomerSheet = !!parsedImport.legacyCustomerSheet;

        if (!customerRows.length && !addressRows.length) {
            return '/khach-hang?error=import_empty_file';
        }

        khachHangImportService.validateImportRows(parsedImport, validateCustomerPayload, normalizeCustomerPayload);

        var errors = [];
        var customerCodesInFile = {};
        var addressCodesInFile = {};
        var customerCodesToCreate = [];
        var addressCustomerCodes = [];
        var addressCodes = [];

        customerRows.forEach(function(item) {
            var body = khachHangImportService.buildCustomerBodyFromImportRow(item.data);
            var code = String(body.ma_khach_hang || '').trim();

            if (!legacyCustomerSheet && !code) {
                errors.push('Dòng ' + item.rowNumber + ' sheet Khách hàng: thiếu mã khách hàng.');
            } else if (code && !isValidCustomerImportCode(code)) {
                errors.push(`Dòng ${item.rowNumber} sheet Khách hàng: mã khách hàng không đúng định dạng KH + số.`);
            }

            if (code) {
                if (customerCodesInFile[code]) {
                    errors.push(`Dòng ${item.rowNumber} sheet Khách hàng: trùng mã khách hàng ${code} với dòng ${customerCodesInFile[code]}.`);
                }
                customerCodesInFile[code] = item.rowNumber;
                customerCodesToCreate.push(code);
            }
        });

        addressRows.forEach(function(item) {
            var body = khachHangImportService.buildAddressBodyFromImportRow(item.data);
            var customerCode = body.ma_khach_hang;
            var addressCode = body.ma_dia_chi;
            var hasAddressData = body.ten_nguoi_nhan || body.sdt_nguoi_nhan || body.dia_chi_chi_tiet || body.tinh_thanh || body.phuong_xa;

            if (!customerCode) {
                errors.push('Dòng ' + item.rowNumber + ' sheet Địa chỉ: thiếu mã khách hàng.');
            } else if (!isValidCustomerImportCode(customerCode)) {
                errors.push('Dòng ' + item.rowNumber + ' sheet Địa chỉ: mã khách hàng không đúng định dạng KH + số.');
            } else {
                addressCustomerCodes.push(customerCode);
            }

            if (!hasAddressData) {
                errors.push('Dòng ' + item.rowNumber + ' sheet Địa chỉ: thiếu thông tin địa chỉ hoặc người nhận.');
            }

            if (addressCode) {
                if (!isValidAddressImportCode(addressCode)) {
                    errors.push('Dòng ' + item.rowNumber + ' sheet Địa chỉ: mã địa chỉ không đúng định dạng DCKH + số.');
                }
                if (addressCodesInFile[addressCode]) {
                    errors.push('Dòng ' + item.rowNumber + ' sheet Địa chỉ: trùng mã địa chỉ ' + addressCode + ' với dòng ' + addressCodesInFile[addressCode] + '.');
                }
                addressCodesInFile[addressCode] = item.rowNumber;
                addressCodes.push(addressCode);
            }
        });

        var allCustomerRefs = Array.from(new Set(customerCodesToCreate.concat(addressCustomerCodes)));
        var existingCustomers = allCustomerRefs.length
            ? await KhachHang.find({ ma_khach_hang: { $in: allCustomerRefs } }).select('_id ma_khach_hang').lean()
            : [];
        var existingCustomerMap = {};
        existingCustomers.forEach(function(customer) {
            existingCustomerMap[customer.ma_khach_hang] = customer;
        });

        customerRows.forEach(function(item) {
            var body = khachHangImportService.buildCustomerBodyFromImportRow(item.data);
            var code = body.ma_khach_hang;
            if (code && existingCustomerMap[code]) {
                errors.push('Dòng ' + item.rowNumber + ' sheet Khách hàng: mã khách hàng ' + code + ' đã tồn tại trong database.');
            }
        });

        var customerCodesToCreateMap = {};
        customerCodesToCreate.forEach(function(code) {
            customerCodesToCreateMap[code] = true;
        });

        addressRows.forEach(function(item) {
            var body = khachHangImportService.buildAddressBodyFromImportRow(item.data);
            var code = body.ma_khach_hang;
            if (code && !customerCodesToCreateMap[code] && !existingCustomerMap[code]) {
                errors.push('Dòng ' + item.rowNumber + ' sheet Địa chỉ: không tìm thấy khách hàng có mã ' + code + '.');
            }
        });

        if (addressCodes.length > 0) {
            var existingAddresses = await DiaChiKhachHang.find({ ma_dia_chi: { $in: Array.from(new Set(addressCodes)) } }).select('ma_dia_chi').lean();
            var existingAddressCodeMap = {};
            existingAddresses.forEach(function(address) {
                existingAddressCodeMap[address.ma_dia_chi] = true;
            });
            addressRows.forEach(function(item) {
                var code = khachHangImportService.buildAddressBodyFromImportRow(item.data).ma_dia_chi;
                if (code && existingAddressCodeMap[code]) {
                    errors.push('Dòng ' + item.rowNumber + ' sheet Địa chỉ: mã địa chỉ ' + code + ' đã tồn tại trong database.');
                }
            });
        }

        if (errors.length > 0) {
            return '/khach-hang?error=' + encodeURIComponent(errors.slice(0, 8).join(' '));
        }

        var inserted = 0;
        var insertedAddresses = 0;
        var skipped = 0;
        var rowErrors = [];
        var customerIdByCode = {};

        Object.keys(existingCustomerMap).forEach(function(code) {
            customerIdByCode[code] = existingCustomerMap[code]._id;
        });

        for (var i = 0; i < customerRows.length; i += 1) {
            var item = customerRows[i];
            var body = khachHangImportService.buildCustomerBodyFromImportRow(item.data);

            try {
                var payload = normalizeCustomerPayload(body);
                if (payload.loai_khach_hang === 'ca_nhan') {
                    payload.ten_cong_ty = '';
                    payload.ma_so_thue = '';
                    payload.nguoi_dai_dien = '';
                    payload.chuc_vu_nguoi_dai_dien = '';
                } else {
                    payload.ten_ca_nhan = '';
                    payload.mst = '';
                    payload.ngay_sinh = null;
                }

                payload.ma_khach_hang = payload.ma_khach_hang || await makeCustomerCode();
                if (req.user && req.user._id) {
                    payload.nguoi_tao_id = req.user._id;
                }
                finalizeCustomerPayload(payload);

                var customer = await KhachHang.create(payload);
                customerIdByCode[payload.ma_khach_hang] = customer._id;

                inserted += 1;
            } catch (error) {
                skipped += 1;
                rowErrors.push('Dòng ' + item.rowNumber + ': ' + (error && error.message ? error.message : 'không thể thêm.'));
            }
        }

        var addressTypeState = await buildImportAddressTypeState();
        for (var addressIndex = 0; addressIndex < addressRows.length; addressIndex += 1) {
            var addressItem = addressRows[addressIndex];
            var addressBody = khachHangImportService.buildAddressBodyFromImportRow(addressItem.data);

            try {
                var addressPayload = normalizeAddressPayload(addressBody);
                addressPayload.ma_dia_chi = addressPayload.ma_dia_chi || await makeAddressCode();
                addressPayload.loai_dia_chi = await resolveImportAddressType(addressBody.loai_dia_chi_text, addressTypeState);
                addressPayload.khach_hang_id = customerIdByCode[addressBody.ma_khach_hang];

                if (addressPayload.mac_dinh) {
                    await DiaChiKhachHang.updateMany({ khach_hang_id: addressPayload.khach_hang_id }, { $set: { mac_dinh: false } });
                }

                await DiaChiKhachHang.create(addressPayload);
                insertedAddresses += 1;
            } catch (error) {
                skipped += 1;
                rowErrors.push('Dòng ' + addressItem.rowNumber + ' sheet Địa chỉ: ' + (error && error.message ? error.message : 'không thể thêm.'));
            }
        }

        if (inserted === 0 && insertedAddresses === 0) {
            var failMessage = rowErrors.slice(0, 3).join(' ');
            return '/khach-hang?error=' + encodeURIComponent(failMessage || 'import_failed');
        }

        var successQuery = 'imported=' + inserted
            + '&import_label=' + encodeURIComponent('khách hàng')
            + '&imported_dia_chi=' + insertedAddresses;
        if (skipped > 0) successQuery += '&import_skipped=' + skipped;
        if (rowErrors.length > 0) {
            successQuery += '&import_warning=' + encodeURIComponent(rowErrors.slice(0, 2).join(' '));
        }

        return '/khach-hang?success=imported&' + successQuery;
    } catch (error) {
        if (error && error.code === 'import_invalid_headers') {
            return '/khach-hang?error=import_invalid_headers';
        }
        if (error && error.code === 'import_invalid_rows') {
            return '/khach-hang?error=' + encodeURIComponent(error.message || 'import_invalid_rows');
        }
        if (error && error.code === 'import_empty_file') {
            return '/khach-hang?error=import_empty_file';
        }

        throw error;
    }
};

module.exports = {
    buildImportTemplateWorkbook,
    importExcelFile
};

