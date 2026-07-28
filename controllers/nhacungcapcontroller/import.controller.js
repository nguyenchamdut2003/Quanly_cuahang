const {
  DiaChiNhaCungCap,
  NhaCungCap,
  makeSupplierCode,
  nhaCungCapImportService,
  normalizeSupplierAddressPayload,
  normalizeSupplierPayload
} = require('./helpers/common.helper');
const {
  isValidSupplierImportCode,
  isValidSupplierAddressImportCode,
  makeSupplierAddressCode,
  buildSupplierImportAddressTypeState,
  resolveSupplierImportAddressType
} = require('./helpers/excel.helper');

exports.downloadImportTemplate = async function(req, res, next) {
      try {
          var workbook = await nhaCungCapImportService.buildImportTemplateWorkbook({
              suggestedSupplierCode: await makeSupplierCode()
          });
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', 'attachment; filename="mau-nhap-nha-cung-cap.xlsx"');
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
              return res.redirect('/nha-cung-cap?error=import_missing_file');
          }
  
          var fileName = String(file.originalname || '').toLowerCase();
          if (!/\.xlsx$/i.test(fileName)) {
              return res.redirect('/nha-cung-cap?error=import_invalid_file_type');
          }
  
          var parsedImport = await nhaCungCapImportService.parseSupplierImportBuffer(file.buffer);
          var supplierRows = parsedImport.supplierRows || [];
          var addressRows = parsedImport.addressRows || [];
          var legacySupplierSheet = !!parsedImport.legacySupplierSheet;
  
          if (!supplierRows.length && !addressRows.length) {
              return res.redirect('/nha-cung-cap?error=import_empty_file');
          }
  
          nhaCungCapImportService.validateImportRows(parsedImport);
  
          var errors = [];
          var supplierCodesInFile = {};
          var addressCodesInFile = {};
          var supplierCodesToCreate = [];
          var addressSupplierCodes = [];
          var addressCodes = [];
  
          supplierRows.forEach(function(item) {
              var body = nhaCungCapImportService.buildSupplierBodyFromImportRow(item.data);
              var code = String(body.ma_ncc || '').trim();
  
              if (!legacySupplierSheet && !code) {
                  errors.push('Dòng ' + item.rowNumber + ' sheet Nhà cung cấp: thiếu mã nhà cung cấp.');
              } else if (code && !isValidSupplierImportCode(code)) {
                  errors.push('Dòng ' + item.rowNumber + ' sheet Nhà cung cấp: mã nhà cung cấp không đúng định dạng NCC + số.');
              }
  
              if (code) {
                  if (supplierCodesInFile[code]) {
                      errors.push('Dòng ' + item.rowNumber + ' sheet Nhà cung cấp: trùng mã nhà cung cấp ' + code + ' với dòng ' + supplierCodesInFile[code] + '.');
                  }
                  supplierCodesInFile[code] = item.rowNumber;
                  supplierCodesToCreate.push(code);
              }
          });
  
          addressRows.forEach(function(item) {
              var body = nhaCungCapImportService.buildAddressBodyFromImportRow(item.data);
              var supplierCode = body.ma_ncc;
              var addressCode = body.ma_dia_chi;
              var hasAddressData = body.ten_nguoi_nhan || body.sdt_nguoi_nhan || body.dia_chi_chi_tiet || body.tinh_thanh || body.phuong_xa;
  
              if (!supplierCode) {
                  errors.push('Dòng ' + item.rowNumber + ' sheet Địa chỉ: thiếu mã nhà cung cấp.');
              } else if (!isValidSupplierImportCode(supplierCode)) {
                  errors.push('Dòng ' + item.rowNumber + ' sheet Địa chỉ: mã nhà cung cấp không đúng định dạng NCC + số.');
              } else {
                  addressSupplierCodes.push(supplierCode);
              }
  
              if (!hasAddressData) {
                  errors.push('Dòng ' + item.rowNumber + ' sheet Địa chỉ: thiếu thông tin địa chỉ hoặc người nhận.');
              }
  
              if (addressCode) {
                  if (!isValidSupplierAddressImportCode(addressCode)) {
                      errors.push('Dòng ' + item.rowNumber + ' sheet Địa chỉ: mã địa chỉ không đúng định dạng DCNCC + số.');
                  }
                  if (addressCodesInFile[addressCode]) {
                      errors.push('Dòng ' + item.rowNumber + ' sheet Địa chỉ: trùng mã địa chỉ ' + addressCode + ' với dòng ' + addressCodesInFile[addressCode] + '.');
                  }
                  addressCodesInFile[addressCode] = item.rowNumber;
                  addressCodes.push(addressCode);
              }
          });
  
          var allSupplierRefs = Array.from(new Set(supplierCodesToCreate.concat(addressSupplierCodes)));
          var existingSuppliers = allSupplierRefs.length
              ? await NhaCungCap.find({ ma_ncc: { $in: allSupplierRefs } }).select('_id ma_ncc').lean()
              : [];
          var existingSupplierMap = {};
          existingSuppliers.forEach(function(supplier) {
              existingSupplierMap[supplier.ma_ncc] = supplier;
          });
  
          supplierRows.forEach(function(item) {
              var code = nhaCungCapImportService.buildSupplierBodyFromImportRow(item.data).ma_ncc;
              if (code && existingSupplierMap[code]) {
                  errors.push('Dòng ' + item.rowNumber + ' sheet Nhà cung cấp: mã nhà cung cấp ' + code + ' đã tồn tại trong database.');
              }
          });
  
          var supplierCodesToCreateMap = {};
          supplierCodesToCreate.forEach(function(code) {
              supplierCodesToCreateMap[code] = true;
          });
  
          addressRows.forEach(function(item) {
              var code = nhaCungCapImportService.buildAddressBodyFromImportRow(item.data).ma_ncc;
              if (code && !supplierCodesToCreateMap[code] && !existingSupplierMap[code]) {
                  errors.push('Dòng ' + item.rowNumber + ' sheet Địa chỉ: không tìm thấy nhà cung cấp có mã ' + code + '.');
              }
          });
  
          if (addressCodes.length > 0) {
              var existingAddresses = await DiaChiNhaCungCap.find({ ma_dia_chi: { $in: Array.from(new Set(addressCodes)) } }).select('ma_dia_chi').lean();
              var existingAddressCodeMap = {};
              existingAddresses.forEach(function(address) {
                  existingAddressCodeMap[address.ma_dia_chi] = true;
              });
              addressRows.forEach(function(item) {
                  var code = nhaCungCapImportService.buildAddressBodyFromImportRow(item.data).ma_dia_chi;
                  if (code && existingAddressCodeMap[code]) {
                      errors.push('Dòng ' + item.rowNumber + ' sheet Địa chỉ: mã địa chỉ ' + code + ' đã tồn tại trong database.');
                  }
              });
          }
  
          if (errors.length > 0) {
              return res.redirect('/nha-cung-cap?error=' + encodeURIComponent(errors.slice(0, 8).join(' ')));
          }
  
          var inserted = 0;
          var insertedAddresses = 0;
          var skipped = 0;
          var rowErrors = [];
          var supplierIdByCode = {};
  
          Object.keys(existingSupplierMap).forEach(function(code) {
              supplierIdByCode[code] = existingSupplierMap[code]._id;
          });
  
          for (var i = 0; i < supplierRows.length; i += 1) {
              var item = supplierRows[i];
              var body = nhaCungCapImportService.buildSupplierBodyFromImportRow(item.data);
  
              try {
                  var payload = normalizeSupplierPayload(body);
                  if (!payload.ten_ncc) {
                      skipped += 1;
                      rowErrors.push('Dòng ' + item.rowNumber + ': thiếu tên nhà cung cấp.');
                      continue;
                  }
  
                  payload.ma_ncc = payload.ma_ncc || await makeSupplierCode();
                  var created = await NhaCungCap.create(payload);
                  supplierIdByCode[payload.ma_ncc] = created._id;
                  inserted += 1;
              } catch (error) {
                  skipped += 1;
                  rowErrors.push('Dòng ' + item.rowNumber + ': ' + (error && error.message ? error.message : 'không thể thêm.'));
              }
          }
  
          var addressTypeState = await buildSupplierImportAddressTypeState();
          for (var addressIndex = 0; addressIndex < addressRows.length; addressIndex += 1) {
              var addressItem = addressRows[addressIndex];
              var addressBody = nhaCungCapImportService.buildAddressBodyFromImportRow(addressItem.data);
  
              try {
                  var addressPayload = normalizeSupplierAddressPayload(addressBody);
                  addressPayload.ma_dia_chi = addressPayload.ma_dia_chi || await makeSupplierAddressCode();
                  addressPayload.loai_dia_chi = await resolveSupplierImportAddressType(addressBody.loai_dia_chi_text, addressTypeState);
                  addressPayload.nha_cung_cap_id = supplierIdByCode[addressBody.ma_ncc];
  
                  if (addressPayload.mac_dinh) {
                      await DiaChiNhaCungCap.updateMany({ nha_cung_cap_id: addressPayload.nha_cung_cap_id }, { $set: { mac_dinh: false } });
                  }
  
                  await DiaChiNhaCungCap.create(addressPayload);
                  insertedAddresses += 1;
              } catch (error) {
                  skipped += 1;
                  rowErrors.push('Dòng ' + addressItem.rowNumber + ' sheet Địa chỉ: ' + (error && error.message ? error.message : 'không thể thêm.'));
              }
          }
  
          if (inserted === 0 && insertedAddresses === 0) {
              var failMessage = rowErrors.slice(0, 3).join(' ');
              return res.redirect('/nha-cung-cap?error=' + encodeURIComponent(failMessage || 'import_failed'));
          }
  
          var successQuery = 'imported=' + inserted
              + '&import_label=' + encodeURIComponent('nhà cung cấp')
              + '&imported_dia_chi=' + insertedAddresses;
          if (skipped > 0) successQuery += '&import_skipped=' + skipped;
          if (rowErrors.length > 0) {
              successQuery += '&import_warning=' + encodeURIComponent(rowErrors.slice(0, 2).join(' '));
          }
  
          res.redirect('/nha-cung-cap?success=imported&' + successQuery);
      } catch (error) {
          if (error && error.code === 'import_invalid_headers') {
              return res.redirect('/nha-cung-cap?error=import_invalid_headers');
          }
          if (error && error.code === 'import_invalid_rows') {
              return res.redirect('/nha-cung-cap?error=' + encodeURIComponent(error.message || 'import_invalid_rows'));
          }
          if (error && error.code === 'import_empty_file') {
              return res.redirect('/nha-cung-cap?error=import_empty_file');
          }
  
          next(error);
      }
  };
