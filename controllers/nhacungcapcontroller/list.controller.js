const {
  NhaCungCap,
  SUPPLIER_TABLE_METRICS_LIMIT,
  buildSupplierStoreAccessQuery,
  formatDate,
  loadAddressTypes,
  loadSupplierGroups,
  measureAsync,
  mongoose,
  querystring,
  resolveStoreId
} = require('./helpers/common.helper');
const {
  normalizeFilterQuery,
  formatFilterMoneyDisplay,
  hasFilterQueryValue,
  buildFilterQueryString,
  buildSupplierQueryFromFilter
} = require('./helpers/filter.helper');
const {
  SUPPLIER_DEBT_WARN_DEFAULT_DAYS,
  aggregateSupplierPurchaseTotals,
  aggregateSupplierDebtDayInfo,
  applySupplierTotalsFromMap,
  applySupplierDebtDayInfo,
  normalizeDebtWarnSettings,
  applySupplierDebtWarning,
  normalizeSupplierMetricIds,
  countSupplierMetricIdCandidates
} = require('./helpers/metrics.helper');
const {
  resolveSupplierDaThanhToan
} = require('./helpers/debt.helper');
const {
  mapNhapHangStatus,
  mapTraHangStatus,
  mapCongNoLoai,
  mapCongNoDirection,
  mapSupplierPurchaseHistoryType
} = require('./helpers/detail.helper');

var SUPPLIER_PAGE_SIZE = 10;

function parseSupplierPage(query) {
    var page = parseInt(query && query.page, 10);
    return Number.isFinite(page) && page > 0 ? page : 1;
}

function buildSupplierPageQueryString(filter, page) {
    var base = buildFilterQueryString(filter);
    var parts = base ? [base] : [];
    if (page > 1) parts.push('page=' + encodeURIComponent(page));
    return parts.join('&');
}

exports.index = async function(req, res, next) {
      try {
          var requestQuery = req?.query || {};
          if (
              Object.prototype.hasOwnProperty.call(
                  requestQuery,
                  'supplier'
              )
          ) {
              var redirectQuery = Object.assign(
                  {},
                  requestQuery
              );
  
              delete redirectQuery.supplier;
  
              var qsStr = querystring.stringify(
                  redirectQuery
              );
  
              return res.redirect(
                  302,
                  '/nha-cung-cap' +
                  (qsStr ? '?' + qsStr : '')
              );
          }
          var filter = normalizeFilterQuery(requestQuery);
          var supplierQuery =
              buildSupplierQueryFromFilter(filter);
          var formMode =
              requestQuery.mode === 'create'
                  ? 'create'
                  : '';
          var pageSize = SUPPLIER_PAGE_SIZE;
          var page = parseSupplierPage(requestQuery);
          var initialData = await Promise.all([
              loadSupplierGroups(),
              NhaCungCap.countDocuments(supplierQuery),
              loadAddressTypes()
          ]);
          var supplierGroups = initialData[0];
          var totalSuppliers = initialData[1];
          var addressTypes = initialData[2];
          var totalPages = Math.max(1, Math.ceil(totalSuppliers / pageSize));
          if (page > totalPages) page = totalPages;
          var skip = (page - 1) * pageSize;
          var suppliers = await NhaCungCap.find(supplierQuery)
              .select(
                  '_id ma_ncc ten_ncc sdt email ' +
                  'tong_mua tong_no trang_thai ' +
                  'created_at cua_hang_id'
              )
              .sort({
                  created_at: 1,
                  ma_ncc: 1
              })
              .skip(skip)
              .limit(pageSize)
              .lean();

          suppliers.forEach(function(supplier) {
              supplier.da_thanh_toan =
                  resolveSupplierDaThanhToan(supplier);
              supplier.tong_no_theo_so = null;
              supplier.debt_warning = false;
              supplier.metrics_pending = true;
          });
          var locals = {
              title: 'Nhà cung cấp',
              pageTitle: 'Nhà cung cấp',
              activeMenu: 'nha-cung-cap',
  
              user: req.user,
              flash: requestQuery,
  
              suppliers: suppliers,
              supplierGroups: supplierGroups,
              addressTypes: addressTypes,
  
              formMode: formMode,
              metricsLazyLoad: true,
  
              formatDate: formatDate,
              filter: filter,
  
              filterQueryString:
                  buildFilterQueryString(filter),
              pagination: {
                  total: totalSuppliers,
                  page: page,
                  limit: pageSize,
                  totalPages: totalPages,
                  from: totalSuppliers === 0 ? 0 : skip + 1,
                  to: Math.min(skip + pageSize, totalSuppliers)
              },
              buildSupplierPageUrl: function(pageNumber) {
                  var pageQuery = buildSupplierPageQueryString(filter, pageNumber);
                  return '/nha-cung-cap' + (pageQuery ? '?' + pageQuery : '');
              },

              debtWarnDefaultDays:
                  SUPPLIER_DEBT_WARN_DEFAULT_DAYS,
  
              formatFilterMoney:
                  formatFilterMoneyDisplay,
  
              filterDebtRangeLabel: (function() {
                  var hasFrom = hasFilterQueryValue(
                      filter.currentDebtFrom
                  );
  
                  var hasTo = hasFilterQueryValue(
                      filter.currentDebtTo
                  );
  
                  if (!hasFrom && !hasTo) {
                      return '';
                  }
  
                  var fromText = hasFrom
                      ? formatFilterMoneyDisplay(
                          filter.currentDebtFrom
                      )
                      : '0';
  
                  var toText = hasTo
                      ? formatFilterMoneyDisplay(
                          filter.currentDebtTo
                      )
                      : 'không giới hạn';
  
                  return fromText + ' – ' + toText;
              })(),
  
              mapNhapHangStatus:
                  mapNhapHangStatus,
  
              mapTraHangStatus:
                  mapTraHangStatus,
  
              mapSupplierPurchaseHistoryType:
                  mapSupplierPurchaseHistoryType,
  
              mapCongNoLoai:
                  mapCongNoLoai,
  
              mapCongNoDirection:
                  mapCongNoDirection
          };
          return res.render(
              'nha-cung-cap/index',
              locals
          );
      } catch (error) {
          next(error);
      }
  };

  exports.apiTableMetrics = async function(req, res, next) {
      try {
          return await measureAsync('nhaCungCap.apiTableMetrics.total', async function() {
              var rawIds = req?.query?.ids || '';
              if (countSupplierMetricIdCandidates(rawIds) > SUPPLIER_TABLE_METRICS_LIMIT) {
                  return res.status(400).json({
                      success: false,
                      message: 'Chỉ được tải tối đa ' + SUPPLIER_TABLE_METRICS_LIMIT + ' nhà cung cấp mỗi lần.'
                  });
              }
              var ids = normalizeSupplierMetricIds(rawIds);
              if (!ids.length) {
                  return res.json({ success: true, rows: [] });
              }
  
              var storeId = await resolveStoreId(req);
              var supplierQuery = Object.assign(
                  { _id: { $in: ids.map(function(id) { return new mongoose.Types.ObjectId(id); }) } },
                  buildSupplierStoreAccessQuery(storeId)
              );
              var suppliers = await NhaCungCap.find(supplierQuery)
                  .select('_id tong_mua tong_no')
                  .lean();
              if (!suppliers.length) {
                  return res.json({ success: true, rows: [] });
              }
  
              var allowedIds = suppliers.map(function(supplier) { return String(supplier._id); });
              var supplierMap = suppliers.reduce(function(map, supplier) {
                  map[String(supplier._id)] = supplier;
                  return map;
              }, {});
              var aggregateResult = await Promise.all([
                  measureAsync('nhaCungCap.apiTableMetrics.aggregateTotals', function() {
                      return aggregateSupplierPurchaseTotals(storeId, allowedIds);
                  }),
                  measureAsync('nhaCungCap.apiTableMetrics.aggregateDebtDays', function() {
                      return aggregateSupplierDebtDayInfo(storeId, allowedIds);
                  })
              ]);
              var totalsMap = aggregateResult[0];
              var debtDayMap = aggregateResult[1];
              var debtWarnSettings = normalizeDebtWarnSettings(normalizeFilterQuery(req?.query || {}));
  
              var rows = ids.map(function(id) {
                  var supplier = supplierMap[id];
                  if (!supplier) return null;
                  applySupplierTotalsFromMap(supplier, totalsMap);
                  applySupplierDebtDayInfo(supplier, debtDayMap);
                  applySupplierDebtWarning(supplier, debtWarnSettings);
                  return {
                      id: id,
                      tong_mua: Number(supplier.tong_mua || 0),
                      da_thanh_toan: Number(supplier.da_thanh_toan || 0),
                      tong_no: Number(supplier.tong_no || 0),
                      tong_no_theo_so: Number(supplier.tong_no_theo_so || 0),
                      so_ngay_no_xa: supplier.so_ngay_no_xa != null ? Number(supplier.so_ngay_no_xa) : null,
                      so_ngay_no_gan: supplier.so_ngay_no_gan != null ? Number(supplier.so_ngay_no_gan) : null,
                      no_xa_nhat_ma_phieu: supplier.no_xa_nhat_ma_phieu || '',
                      no_xa_nhat_tien: Number(supplier.no_xa_nhat_tien || 0),
                      debt_warning: !!supplier.debt_warning
                  };
              }).filter(Boolean);
  
              return res.json({ success: true, rows: rows });
          });
      } catch (err) {
          next(err);
      }
  };
