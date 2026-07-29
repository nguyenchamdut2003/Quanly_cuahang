const {
    mongoose,
    getReservedQuantitiesByOrder,
    getReservedQuantitiesForSale,
    buildVariantKey,
    buildLotKey,
    querystring,
    path,
    HangHoa,
    NhomHang,
    DonViTinh,
    NhaCungCap,
    TonKho,
    Kho,
    BangGia,
    CTBangGia,
    CuaHang,
    LoHang,
    TonKhoLo,
    TonKhoLoQuyCach,
    LichSuKho,
    ThuocTinhHang,
    GiaTriThuocTinh,
    HangHoaThuocTinh,
    PhieuNhap,
    CTPhieuNhap,
    PhieuTraHangNhap,
    CTPhieuTraHangNhap,
    DonHang,
    CTDonHang,
    HoaDonBanHang,
    CTHoaDonBanHang,
    PhieuTraHang,
    CTPhieuTraHang,
    PhieuKiemKho,
    CTPhieuKiemKho,
    PhieuXuatHuy,
    CTXuatHuy,
    PhieuXuatNoiBo,
    CTXuatNoiBo,
    KhachHang,
    DiaChiKhachHang,
    VatChua,
    pdfService,
    buildLotProfitReport,
    submitStockAllocation,
    previewProductTrash,
    moveProductsToTrash,
    measureAsync,
    isPerformanceEnabled,
    resolveSalePrice,
    buildPriceSetupLines,
    upsertGiaBanHangHoa,
    formatDate,
    normalizeStockNumber,
    isExpiredLot,
    isSellableLot,
    normalizeFilterQuery,
    applyProductListStatusFilter,
    normalizeBangGiaIdsFromQuery,
    normalizePriceSetupQuery,
    buildPriceSetupQueryString,
    loadAvgLotCostByProductId,
    loadAvgSalePriceByProductId,
    loadActiveInventoryTotalsByProductId,
    buildProductListPriceMaps,
    applyProductListPriceFields,
    buildFilterQueryString,
    decodeLegacyEntities,
    normalizeProductNotePayload,
    normalizeProductPayload,
    normalizeAttributePayload,
    normalizeAttributeValuePayload,
    nextAttributeCode,
    nextAttributeValueCode,
    ensureDefaultAttributes,
    normalizeSelectedAttributeValues,
    saveProductAttributeValues,
    makeProductCode,
    makeLotCode,
    getDefaultWarehouseForProduct,
    createDefaultLotFromInventory,
    uniqueValues,
    mapBy,
    labelStockTransactionType,
    labelChungTuDocumentType,
    partnerName,
    unitPriceFromValue,
    enrichStockCardRows,
    filterTrashedKiemKhoStockRows,
    makeRangeFilter,
    normalizeIdParam,
    toDatetimeLocalValue,
    makeBangGiaCode,
    shouldRespondJson,
    escapeRegExp,
    loadProductGroups,
    findDuplicateGroupName,
    makeProductGroupCode,
    loadUnitOptions,
    makeUnitCode,
    resolveStoreId,
    respondUnitError,
    respondProductGroupError,
    getDateRange,
    buildProductQueryFromFilter,
    loadProductContractData,
    loadProductDetailById
} = require('../helpers/common.helper');

const PRODUCT_PAGE_SIZE = 10;

async function index(req, res, next) {
    try {
        await measureAsync('hangHoa.index.total', async function() {
        var requestQuery = req?.query || {};
        if (Object.prototype.hasOwnProperty.call(requestQuery, 'product')) {
            var redirectQuery = Object.assign({}, requestQuery);
            delete redirectQuery.product;
            var qs = querystring.stringify(redirectQuery);
            return res.redirect(302, '/hang-hoa' + (qs ? '?' + qs : ''));
        }
        var filter = normalizeFilterQuery(requestQuery);
        var dateRange = getDateRange(filter);
        var productQuery = {};

        if (filter.groupId !== 'all') productQuery.nhom_hang_id = filter.groupId;
        if (filter.supplierId !== 'all') productQuery.nha_cung_cap_id = filter.supplierId;
        if (filter.salesLink === 'yes') productQuery.ban_truc_tiep = true;
        if (filter.salesLink === 'no') productQuery.ban_truc_tiep = false;
        applyProductListStatusFilter(productQuery, filter);
        if (filter.keyword) {
            productQuery.$or = [
                { ma_hang: { $regex: filter.keyword, $options: 'i' } },
                { ten_hang: { $regex: filter.keyword, $options: 'i' } }
            ];
        }
        if (dateRange.start || dateRange.end) {
            productQuery.created_at = {};
            if (dateRange.start) productQuery.created_at.$gte = dateRange.start;
            if (dateRange.end) productQuery.created_at.$lte = dateRange.end;
        }

        var products = await measureAsync('hangHoa.index.loadProducts', function() {
            return HangHoa.find(productQuery).sort({ created_at: -1, ma_hang: 1 }).lean();
        });
        var productIds = products.map(function(item) { return item._id; });
        var lotManagedProductIds = products
            .filter(function(item) { return !!item.quan_ly_theo_lo; })
            .map(function(item) { return item._id; });

        var inventoryRows = await measureAsync('hangHoa.index.loadInventory', function() {
            return loadActiveInventoryTotalsByProductId(productIds, lotManagedProductIds);
        });
        var inventoryMap = inventoryRows || {};

        var stockRange = makeRangeFilter(filter.stockFrom, filter.stockTo);
        if (stockRange) {
            products = products.filter(function(item) {
                var qty = Number(inventoryMap[String(item._id)] || 0);
                if (Object.prototype.hasOwnProperty.call(stockRange, '$gte') && qty < stockRange.$gte) return false;
                if (Object.prototype.hasOwnProperty.call(stockRange, '$lte') && qty > stockRange.$lte) return false;
                return true;
            });
        }

        var storeId = await measureAsync('hangHoa.index.resolveStoreId', function() {
            return resolveStoreId(req);
        });
        var groups = await measureAsync('hangHoa.index.loadGroups', function() {
            return loadProductGroups(storeId);
        });
        var suppliers = await measureAsync('hangHoa.index.loadSuppliers', function() {
            return NhaCungCap.find({}).sort({ ten_ncc: 1 }).lean();
        });
        var units = await measureAsync('hangHoa.index.loadUnits', function() {
            return loadUnitOptions();
        });
        var groupMap = groups.reduce(function(map, group) {
            map[String(group._id)] = group.ten_nhom_hang || '---';
            return map;
        }, {});
        var supplierMap = suppliers.reduce(function(map, supplier) {
            map[String(supplier._id)] = supplier.ten_ncc || '---';
            return map;
        }, {});
        var unitMap = units.reduce(function(map, unit) {
            map[String(unit._id)] = unit.ten_don_vi || '---';
            return map;
        }, {});

        var finalProductIds = products.map(function(item) { return item._id; });
        var priceMaps = await measureAsync('hangHoa.index.loadPriceMaps', function() {
            return buildProductListPriceMaps(finalProductIds);
        });

        products = products.map(function(item) {
            item.ton_kho = Number(inventoryMap[String(item._id)] || 0);
            item.nhom_hang_ten = groupMap[String(item.nhom_hang_id || '')] || '---';
            item.nha_cung_cap_ten = supplierMap[String(item.nha_cung_cap_id || '')] || '---';
            item.don_vi_tinh_ten = unitMap[String(item.don_vi_tinh_id || '')] || '---';
            item.gia_ban_hien_thi = Number(item.gia_co_dinh || 0);
            return applyProductListPriceFields(item, priceMaps);
        });
        var filterQueryString = buildFilterQueryString(filter);
        var totalProducts = products.length;
        var totalPages = Math.max(1, Math.ceil(totalProducts / PRODUCT_PAGE_SIZE));
        var page = parseInt(requestQuery.page, 10);
        if (!Number.isFinite(page) || page < 1) page = 1;
        if (page > totalPages) page = totalPages;
        var start = (page - 1) * PRODUCT_PAGE_SIZE;
        var pageProducts = products.slice(start, start + PRODUCT_PAGE_SIZE);

        var bangGiaList = await measureAsync('hangHoa.index.loadBangGia', function() {
            return BangGia.find({ trang_thai: 'active' }).sort({ ten_bang_gia: 1 }).lean();
        });

        var locals = {
            title: 'HÃ ng hÃ³a',
            pageTitle: 'HÃ ng hÃ³a',
            activeMenu: 'hang-hoa',
            user: req.user,
            flash: requestQuery,
            bangGiaList: bangGiaList,
            products: pageProducts,
            groups: groups,
            units: units,
            suppliers: suppliers,
            filter: filter,
            formatDate: formatDate,
            filterQueryString: filterQueryString,
            formMode: requestQuery.mode === 'create' ? 'create' : '',
            pagination: {
                page: page,
                limit: PRODUCT_PAGE_SIZE,
                total: totalProducts,
                totalPages: totalPages,
                from: totalProducts ? start + 1 : 0,
                to: Math.min(start + PRODUCT_PAGE_SIZE, totalProducts)
            }
        };

        if (!isPerformanceEnabled()) {
            return res.render('hang-hoa/index', locals);
        }

        await new Promise(function(resolve, reject) {
            var renderStartedAt = process.hrtime.bigint();

            res.render('hang-hoa/index', locals, function(error, html) {
                var renderDurationMs = Number(process.hrtime.bigint() - renderStartedAt) / 1000000;
                console.log('[PERF] hangHoa.index.render: ' + renderDurationMs.toFixed(2) + ' ms');
                if (error) return reject(error);
                res.send(html);
                resolve();
            });
        });
        });
    } catch (error) {
        next(error);
    }
};


module.exports = { index };


