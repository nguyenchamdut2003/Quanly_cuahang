const {
  DiaChiNhaCungCap,
  ExcelJS,
  NhaCungCap,
  handleSupplierDebtExport,
  mongoose,
  normalizeIdParam,
  resolveStoreId
} = require('./helpers/common.helper');
const {
  normalizeFilterQuery,
  buildSupplierQueryFromFilter,
  filterSuppliersByComputedTotals
} = require('./helpers/filter.helper');
const {
  aggregateSupplierPurchaseTotals,
  aggregateSupplierDebtDayInfo,
  applySupplierTotalsFromMap,
  applySupplierDebtDayInfo,
  normalizeDebtWarnSettings,
  applySupplierDebtWarning,
  filterSuppliersByDebtWarning,
  sortSuppliersByDebtDaySort
} = require('./helpers/metrics.helper');
const {
  SUPPLIER_EXPORT_COLUMNS,
  buildSupplierExportRow,
  applySupplierWorksheetFormat,
  exportSupplierDetailWorkbook
} = require('./helpers/excel.helper');

exports.exportExcel = async function(req, res, next) {
      try {
          var storeId = await resolveStoreId(req);
          var filter = normalizeFilterQuery(req?.query || {});
          var supplierQuery = buildSupplierQueryFromFilter(filter);
          var debtWarnSettings = normalizeDebtWarnSettings(filter);
          var suppliers = await NhaCungCap.find(supplierQuery)
              .populate({ path: 'nhom_nha_cung_cap_id', select: 'ten_nhom_ncc ma_nhom_ncc' })
              .populate({ path: 'nguoi_tao_id', select: 'ho_ten username email' })
              .sort({ created_at: 1, ma_ncc: 1 })
              .lean();
          var totalsMap = await aggregateSupplierPurchaseTotals(storeId);
          var debtDayMap = await aggregateSupplierDebtDayInfo(storeId);
          suppliers.forEach(function(s) {
              applySupplierTotalsFromMap(s, totalsMap);
              applySupplierDebtDayInfo(s, debtDayMap);
              applySupplierDebtWarning(s, debtWarnSettings);
          });
          suppliers = filterSuppliersByComputedTotals(suppliers, filter);
          suppliers = filterSuppliersByDebtWarning(suppliers, debtWarnSettings);
          suppliers = sortSuppliersByDebtDaySort(suppliers, filter.debtDaySort);
          var supplierIds = suppliers.map(function(supplier) { return supplier._id; });
          var addresses = supplierIds.length
              ? await DiaChiNhaCungCap.find({
                  nha_cung_cap_id: { $in: supplierIds },
                  trang_thai: 'active'
              })
                  .sort({ mac_dinh: -1, created_at: -1 })
                  .lean()
              : [];
          var addressMap = addresses.reduce(function(map, address) {
              var key = String(address.nha_cung_cap_id);
              if (!map[key]) map[key] = address;
              return map;
          }, {});
  
          var workbook = new ExcelJS.Workbook();
          var worksheet = workbook.addWorksheet('Nhà cung cấp');
          worksheet.columns = SUPPLIER_EXPORT_COLUMNS;
          suppliers.forEach(function(supplier) {
              worksheet.addRow(buildSupplierExportRow(supplier, addressMap[String(supplier._id)]));
          });
          applySupplierWorksheetFormat(worksheet);
  
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', 'attachment; filename="danh-sach-nha-cung-cap.xlsx"');
          await workbook.xlsx.write(res);
          res.end();
      } catch (error) {
          next(error);
      }
  };

  exports.exportSupplierDetail = async function(req, res, next) {
      try {
          var supplierId = normalizeIdParam(req?.params?.id);
          var section = String(req?.params?.section || '').trim().toLowerCase();
          if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
              return res.redirect('/nha-cung-cap?error=invalid_supplier');
          }
          if (['info', 'address', 'history', 'debt', 'xnb', 'hang-hoa', 'hang_hoa', 'hoa-don-gop', 'hoa_don_gop', 'chi-tiet-nhap'].indexOf(section) < 0) {
              return res.redirect('/nha-cung-cap?error=invalid_export');
          }
          var supplier = await NhaCungCap.findById(supplierId).lean();
          if (!supplier) return res.redirect('/nha-cung-cap?error=invalid_supplier');
          var storeId = await resolveStoreId(req);
          if (section === 'debt') {
              try {
                  await handleSupplierDebtExport(res, supplier, storeId, req.query || {});
                  return;
              } catch (debtExportError) {
                  if (debtExportError && debtExportError.code === 'INVALID_DEBT_PERIOD') {
                      return res.redirect('/nha-cung-cap?error=invalid_debt_period#s-' + encodeURIComponent(String(supplierId)));
                  }
                  throw debtExportError;
              }
          }
  
          var pack = await exportSupplierDetailWorkbook(section, supplier, storeId);
          if (!pack) return res.redirect('/nha-cung-cap?error=invalid_export');
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', 'attachment; filename="' + pack.filename + '"');
          await pack.workbook.xlsx.write(res);
          res.end();
      } catch (error) {
          next(error);
      }
  };
