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

        var stockRange = makeRangeFilter(filter.stockFrom, filter.stockTo);
        var page = parseInt(requestQuery.page, 10);
        if (!Number.isFinite(page) || page < 1) page = 1;
        var products = [];
        var inventoryMap = {};
        var totalProducts = 0;
        var totalPages = 1;
        var start = 0;

        if (stockRange) {
            products = await measureAsync('hangHoa.index.loadProductsForStockFilter', function() {
                return HangHoa.find(productQuery).sort({ created_at: -1, ma_hang: 1 }).lean();
            });
            var stockFilterProductIds = products.map(function(item) { return item._id; });
            var lotManagedProductIds = products
                .filter(function(item) { return !!item.quan_ly_theo_lo; })
                .map(function(item) { return item._id; });
            inventoryMap = await measureAsync('hangHoa.index.loadInventoryForStockFilter', function() {
                return loadActiveInventoryTotalsByProductId(stockFilterProductIds, lotManagedProductIds);
            });
            products = products.filter(function(item) {
                var qty = Number(inventoryMap[String(item._id)] || 0);
                if (Object.prototype.hasOwnProperty.call(stockRange, '$gte') && qty < stockRange.$gte) return false;
                if (Object.prototype.hasOwnProperty.call(stockRange, '$lte') && qty > stockRange.$lte) return false;
                return true;
            });
            totalProducts = products.length;
            totalPages = Math.max(1, Math.ceil(totalProducts / PRODUCT_PAGE_SIZE));
            if (page > totalPages) page = totalPages;
            start = (page - 1) * PRODUCT_PAGE_SIZE;
            products = products.slice(start, start + PRODUCT_PAGE_SIZE);
        } else {
            totalProducts = await measureAsync('hangHoa.index.countProducts', function() {
                return HangHoa.countDocuments(productQuery);
            });
            totalPages = Math.max(1, Math.ceil(totalProducts / PRODUCT_PAGE_SIZE));
            if (page > totalPages) page = totalPages;
            start = (page - 1) * PRODUCT_PAGE_SIZE;
            products = await measureAsync('hangHoa.index.loadPageProducts', function() {
                return HangHoa.find(productQuery)
                    .sort({ created_at: -1, ma_hang: 1 })
                    .skip(start)
                    .limit(PRODUCT_PAGE_SIZE)
                    .populate({ path: 'nhom_hang_id', select: 'ten_nhom_hang ma_nhom_hang' })
                    .populate({ path: 'nha_cung_cap_id', select: 'ten_ncc ten_nha_cung_cap ten_cong_ty ma_ncc' })
                    .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi ma_don_vi' })
                    .lean();
            });
        }

        var storeId = await measureAsync('hangHoa.index.resolveStoreId', function() {
            return resolveStoreId(req);
        });
        var groups = [];
        var suppliers = [];
        var units = [];
        if (stockRange) {
            groups = await measureAsync('hangHoa.index.loadGroupsForStockFilter', function() {
                return loadProductGroups(storeId);
            });
            suppliers = await measureAsync('hangHoa.index.loadSuppliersForStockFilter', function() {
                return NhaCungCap.find({}).sort({ ten_ncc: 1 }).lean();
            });
            units = await measureAsync('hangHoa.index.loadUnitsForStockFilter', function() {
                return loadUnitOptions();
            });
        }
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

        products = products.map(function(item) {
            item.ton_kho = Number(inventoryMap[String(item._id)] || 0);
            item.nhom_hang_ten = item.nhom_hang_id && item.nhom_hang_id.ten_nhom_hang
                ? item.nhom_hang_id.ten_nhom_hang
                : (groupMap[String(item.nhom_hang_id || '')] || '---');
            item.nha_cung_cap_ten = item.nha_cung_cap_id && (item.nha_cung_cap_id.ten_ncc || item.nha_cung_cap_id.ten_nha_cung_cap || item.nha_cung_cap_id.ten_cong_ty)
                ? (item.nha_cung_cap_id.ten_ncc || item.nha_cung_cap_id.ten_nha_cung_cap || item.nha_cung_cap_id.ten_cong_ty)
                : (supplierMap[String(item.nha_cung_cap_id || '')] || '---');
            item.don_vi_tinh_ten = item.don_vi_tinh_id && item.don_vi_tinh_id.ten_don_vi
                ? item.don_vi_tinh_id.ten_don_vi
                : (unitMap[String(item.don_vi_tinh_id || '')] || '---');
            item.gia_ban_hien_thi = Number(item.gia_co_dinh || 0);
            return item;
        });
        var filterQueryString = buildFilterQueryString(filter);

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
            products: products,
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

async function tableMetrics(req, res, next) {
    try {
        var rawIds = String(req.query.ids || '').split(',').map(function(id) { return id.trim(); }).filter(Boolean);
        var ids = rawIds
            .filter(function(id) { return mongoose.Types.ObjectId.isValid(id); })
            .slice(0, PRODUCT_PAGE_SIZE)
            .map(function(id) { return new mongoose.Types.ObjectId(id); });
        if (!ids.length) return res.json({ success: true, metrics: {} });

        var products = await HangHoa.find({ _id: { $in: ids } }).select('_id quan_ly_theo_lo gia_von').lean();
        var lotManagedProductIds = products
            .filter(function(item) { return !!item.quan_ly_theo_lo; })
            .map(function(item) { return item._id; });
        var storeId = await resolveStoreId(req);
        var inventoryMap = await loadActiveInventoryTotalsByProductId(products.map(function(item) { return item._id; }), lotManagedProductIds, storeId);
        var priceMaps = await buildProductListPriceMaps(products.map(function(item) { return item._id; }));
        var metrics = {};
        products.forEach(function(item) {
            applyProductListPriceFields(item, priceMaps);
            metrics[String(item._id)] = {
                ton_kho: Number(inventoryMap[String(item._id)] || 0),
                gia_von_trung_binh: Number(item.gia_von_trung_binh_hien_thi || 0),
                gia_ban_trung_binh: item.gia_ban_trung_binh_hien_thi == null ? null : Number(item.gia_ban_trung_binh_hien_thi || 0)
            };
        });
        res.json({ success: true, metrics: metrics });
    } catch (error) {
        next(error);
    }
}

async function filterOptions(req, res, next) {
    try {
        var storeId = await resolveStoreId(req);
        var groups = await loadProductGroups(storeId);
        var suppliers = await NhaCungCap.find({}).sort({ ten_ncc: 1 }).lean();
        var units = await loadUnitOptions();
        res.json({
            success: true,
            groups: groups,
            suppliers: suppliers,
            units: units
        });
    } catch (error) {
        next(error);
    }
}


module.exports = { index, tableMetrics, filterOptions };


