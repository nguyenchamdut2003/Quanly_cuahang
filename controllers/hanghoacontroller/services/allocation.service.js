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
function resolveQuyCachImportPrice(qc) {
    if (!qc) return 0;
    if (qc.don_gia_nhap != null && qc.don_gia_nhap !== '') {
        return Number(qc.don_gia_nhap) || 0;
    }
    if (qc.gia_von != null && qc.gia_von !== '') {
        return Number(qc.gia_von) || 0;
    }
    return 0;
}

function buildAllocationLineKey(parts) {
    return [
        String(parts.product_id || ''),
        String(parts.lo_hang_id || ''),
        String(parts.kho_id || ''),
        String(parts.gia_tri_thuoc_tinh_id || ''),
        String(parts.ten_quy_cach || '').trim()
    ].join('|');
}

function resolveLineReservedQty(reserved, line) {
    var productId = String(line && line.product_id ? line.product_id : '');
    if (!productId || !reserved) return 0;
    var tenQuyCach = String(line.ten_quy_cach || '').trim();
    if (tenQuyCach === '---') tenQuyCach = '';
    var variantKey = buildVariantKey({
        hang_hoa_id: productId,
        gia_tri_thuoc_tinh_id: line.gia_tri_thuoc_tinh_id || '',
        ten_quy_cach: tenQuyCach
    });
    var lotKey = line.lo_hang_id ? buildLotKey(productId, line.lo_hang_id) : '';
    var fromVariant = reserved.byVariant && reserved.byVariant[variantKey]
        ? Number(reserved.byVariant[variantKey].so_luong_khach_dat || 0)
        : 0;
    var fromLot = lotKey && reserved.byLot && reserved.byLot[lotKey]
        ? Number(reserved.byLot[lotKey].so_luong_khach_dat || 0)
        : 0;
    return Math.max(fromVariant, fromLot, 0);
}

function buildAllocationLineExtras(product, row, lot, qc) {
    var lotId = lot && lot._id ? lot._id : (row && row.lo_hang_id ? row.lo_hang_id : null);
    var khoId = row && row.kho_id ? row.kho_id : null;
    var giaTriId = qc && qc.gia_tri_thuoc_tinh_id ? qc.gia_tri_thuoc_tinh_id : null;
    var tenQuyCach = qc
        ? (qc.ten_quy_cach || qc.ten_thuoc_tinh || '---')
        : '---';
    return {
        line_key: buildAllocationLineKey({
            product_id: product._id,
            lo_hang_id: lotId,
            kho_id: khoId,
            gia_tri_thuoc_tinh_id: giaTriId,
            ten_quy_cach: tenQuyCach === '---' ? '' : tenQuyCach
        }),
        lo_hang_id: lotId,
        kho_id: khoId,
        gia_tri_thuoc_tinh_id: giaTriId,
        ton_kho_lo_quy_cach_id: qc && qc._id ? qc._id : null,
        don_vi_tinh_id: product.don_vi_tinh_id || null,
        gia_ban_mac_dinh: Number(product.gia_co_dinh || 0)
    };
}

async function loadAllocationPageData(req) {
    var storeId = await resolveStoreId(req);
    var hasStoreScope = storeId && mongoose.Types.ObjectId.isValid(storeId);
    var filter = normalizeFilterQuery(req?.query || {});
    var productQuery = {};
    applyProductListStatusFilter(productQuery, filter);
    if (filter.keyword) {
        productQuery.$or = [
            { ma_hang: { $regex: filter.keyword, $options: 'i' } },
            { ten_hang: { $regex: filter.keyword, $options: 'i' } }
        ];
    }

    var products = await HangHoa.find(productQuery).sort({ ma_hang: 1, created_at: -1 }).lean();
    var productIds = products.map(function(item) { return item._id; });
    if (!productIds.length) {
        return { lines: [], filter: filter, filterQueryString: buildFilterQueryString(filter) };
    }

    var tonMatch = { hang_hoa_id: { $in: productIds } };
    if (hasStoreScope) tonMatch.cua_hang_id = new mongoose.Types.ObjectId(storeId);
    var inventoryRows = await TonKho.aggregate([
        { $match: tonMatch },
        { $group: { _id: '$hang_hoa_id', total: { $sum: { $ifNull: ['$so_luong', 0] } } } }
    ]);
    var inventoryMap = inventoryRows.reduce(function(map, row) {
        map[String(row._id)] = Number(row.total || 0);
        return map;
    }, {});

    var scopedQuery = hasStoreScope ? { cua_hang_id: storeId } : {};
    var warehouses = await Kho.find(scopedQuery).sort({ ten_kho: 1, ma_kho: 1 }).lean();
    var warehouseMap = warehouses.reduce(function(map, warehouse) {
        map[String(warehouse._id)] = warehouse.ten_kho || warehouse.ma_kho || '---';
        return map;
    }, {});
    var units = await loadUnitOptions();
    var unitMap = units.reduce(function(map, unit) {
        map[String(unit._id)] = unit.ten_don_vi || '---';
        return map;
    }, {});

    var lotStockQuery = { hang_hoa_id: { $in: productIds }, so_luong: { $gt: 0 } };
    if (hasStoreScope) lotStockQuery.cua_hang_id = storeId;
    var lotStockRows = await TonKhoLo.find(lotStockQuery)
        .populate({
            path: 'lo_hang_id',
            select: 'ma_lo ten_lo ngay_nhap han_su_dung so_luong_ban_dau so_luong_con_lai don_gia_nhap gia_von trang_thai phieu_nhap_id',
            populate: { path: 'phieu_nhap_id', select: 'ma_phieu_nhap ngay_nhap' }
        })
        .sort({ updated_at: -1, created_at: -1 })
        .lean();

    var qcQuery = { hang_hoa_id: { $in: productIds }, so_luong: { $gt: 0 } };
    if (hasStoreScope) qcQuery.cua_hang_id = storeId;
    var qcRows = await TonKhoLoQuyCach.find(qcQuery).sort({ ten_quy_cach: 1, updated_at: -1 }).lean();
    var qcByLot = qcRows.reduce(function(map, row) {
        var lotId = String(row.lo_hang_id || '');
        if (!lotId) return map;
        if (!map[lotId]) map[lotId] = [];
        map[lotId].push(row);
        return map;
    }, {});
    var lotsByProduct = lotStockRows.reduce(function(map, row) {
        var productId = String(row.hang_hoa_id || '');
        if (!map[productId]) map[productId] = [];
        map[productId].push(row);
        return map;
    }, {});
    var tonKhoRows = await TonKho.find(Object.assign({}, tonMatch, { so_luong: { $gt: 0 } })).sort({ updated_at: -1 }).lean();
    var tonKhoByProduct = tonKhoRows.reduce(function(map, row) {
        var productId = String(row.hang_hoa_id || '');
        if (!map[productId]) map[productId] = [];
        map[productId].push(row);
        return map;
    }, {});

    var lines = [];
    products.forEach(function(product) {
        var productId = String(product._id);
        var donVi = unitMap[String(product.don_vi_tinh_id || '')] || '---';
        var tonKho = Number(inventoryMap[productId] || 0);
        if (product.quan_ly_theo_lo) {
            var productLots = lotsByProduct[productId] || [];
            if (!productLots.length) {
                if (tonKho > 0) {
                    lines.push(Object.assign({
                        product_id: product._id,
                        ma_hang: product.ma_hang || '---',
                        ten_hang: product.ten_hang || '---',
                        don_vi_tinh_ten: donVi,
                        ma_lo: '---',
                        ten_lo: '---',
                        ten_quy_cach: '---',
                        kho_ten: '---',
                        ngay_nhap: null,
                        han_su_dung: null,
                        so_luong_ban_dau: 0,
                        ton_thuc_te: tonKho,
                        ton_co_the_giao: 0,
                        ton_het_han: 0,
                        gia_von: Number(product.gia_von || 0),
                        ma_phieu_nhap: '---',
                        trang_thai_lo: '---'
                    }, buildAllocationLineExtras(product, null, null, null)));
                }
                return;
            }
            productLots.forEach(function(row) {
                var lot = row.lo_hang_id || {};
                var lotId = String(lot._id || row.lo_hang_id || '');
                var rawQty = normalizeStockNumber(row.so_luong !== undefined && row.so_luong !== null ? row.so_luong : lot.so_luong_con_lai);
                var qcItems = qcByLot[lotId] || [];
                var base = {
                    product_id: product._id,
                    ma_hang: product.ma_hang || '---',
                    ten_hang: product.ten_hang || '---',
                    don_vi_tinh_ten: donVi,
                    ma_lo: lot.ma_lo || '---',
                    ten_lo: lot.ten_lo || '---',
                    kho_ten: warehouseMap[String(row.kho_id || '')] || '---',
                    ngay_nhap: lot.ngay_nhap || null,
                    han_su_dung: lot.han_su_dung || null,
                    so_luong_ban_dau: Number(lot.so_luong_ban_dau || 0),
                    gia_von: Number(row.gia_von != null ? row.gia_von : (lot.gia_von || lot.don_gia_nhap || 0)),
                    ma_phieu_nhap: lot.phieu_nhap_id && lot.phieu_nhap_id.ma_phieu_nhap ? lot.phieu_nhap_id.ma_phieu_nhap : '---',
                    trang_thai_lo: lot.trang_thai || '---'
                };
                if (qcItems.length) {
                    qcItems.forEach(function(qc) {
                        var qty = normalizeStockNumber(qc.so_luong);
                        var lotExpired = isExpiredLot(lot);
                        lines.push(Object.assign({}, base, buildAllocationLineExtras(product, row, lot, qc), {
                            ten_quy_cach: qc.ten_quy_cach || qc.ten_thuoc_tinh || '---',
                            ton_thuc_te: qty,
                            ton_co_the_giao: isSellableLot(lot) ? qty : 0,
                            ton_het_han: lotExpired ? qty : 0,
                            gia_von: resolveQuyCachImportPrice(qc)
                        }));
                    });
                } else {
                    lines.push(Object.assign({}, base, buildAllocationLineExtras(product, row, lot, null), {
                        ten_quy_cach: '---',
                        ton_thuc_te: rawQty,
                        ton_co_the_giao: isSellableLot(lot) ? rawQty : 0,
                        ton_het_han: isExpiredLot(lot) ? rawQty : 0
                    }));
                }
            });
            return;
        }
        var warehouseRows = tonKhoByProduct[productId] || [];
        if (!warehouseRows.length && tonKho <= 0) return;
        if (!warehouseRows.length) {
            lines.push(Object.assign({
                product_id: product._id,
                ma_hang: product.ma_hang || '---',
                ten_hang: product.ten_hang || '---',
                don_vi_tinh_ten: donVi,
                ma_lo: '---',
                ten_lo: 'KhÃ´ng theo lÃ´',
                ten_quy_cach: '---',
                kho_ten: '---',
                ngay_nhap: null,
                han_su_dung: null,
                so_luong_ban_dau: 0,
                ton_thuc_te: tonKho,
                ton_co_the_giao: tonKho,
                ton_het_han: 0,
                gia_von: Number(product.gia_von || 0),
                ma_phieu_nhap: '---',
                trang_thai_lo: '---'
            }, buildAllocationLineExtras(product, null, null, null)));
            return;
        }
        warehouseRows.forEach(function(row) {
            var qty = normalizeStockNumber(row.so_luong);
            lines.push(Object.assign({
                product_id: product._id,
                ma_hang: product.ma_hang || '---',
                ten_hang: product.ten_hang || '---',
                don_vi_tinh_ten: donVi,
                ma_lo: '---',
                ten_lo: 'KhÃ´ng theo lÃ´',
                ten_quy_cach: '---',
                kho_ten: warehouseMap[String(row.kho_id || '')] || '---',
                ngay_nhap: null,
                han_su_dung: null,
                so_luong_ban_dau: 0,
                ton_thuc_te: qty,
                ton_co_the_giao: qty,
                ton_het_han: 0,
                gia_von: Number(product.gia_von || 0),
                ma_phieu_nhap: '---',
                trang_thai_lo: '---'
            }, buildAllocationLineExtras(product, row, null, null)));
        });
    });

    lines = lines.filter(function(line) {
        return Number(line.ton_thuc_te || 0) > 0;
    });

    var khoProductMap = {};
    lines.forEach(function(line) {
        var khoId = String(line.kho_id || '');
        var productId = String(line.product_id || '');
        if (!khoId || !productId) return;
        if (!khoProductMap[khoId]) khoProductMap[khoId] = {};
        khoProductMap[khoId][productId] = productId;
    });
    var reservedByKho = {};
    var khoIds = Object.keys(khoProductMap);
    await Promise.all(khoIds.map(async function(khoId) {
        var productIds = Object.keys(khoProductMap[khoId]);
        reservedByKho[khoId] = await getReservedQuantitiesForSale({
            kho_id: khoId,
            hang_hoa_ids: productIds
        });
    }));
    lines = lines.map(function(line) {
        var khoId = String(line.kho_id || '');
        var reserved = khoId ? reservedByKho[khoId] : null;
        return Object.assign({}, line, {
            so_luong_khach_dat: resolveLineReservedQty(reserved, line)
        });
    });

    return { lines: lines, filter: filter, filterQueryString: buildFilterQueryString(filter) };
}

async function allocationPage(req, res, next) {
    try {
        var data = await loadAllocationPageData(req);
        var storeId = await resolveStoreId(req);
        var customerQuery = { trang_thai: { $ne: 'inactive' } };
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
            customerQuery.cua_hang_id = storeId;
        }
        var customersRaw = await KhachHang.find(customerQuery)
            .sort({ ten_khach_hang: 1 })
            .select('ma_khach_hang ten_khach_hang sdt sdt2 email dia_chi_day_du dia_chi_nhan tinh_thanh phuong_xa')
            .lean();
        if (!customersRaw.length) {
            customersRaw = await KhachHang.find({ trang_thai: { $ne: 'inactive' } })
                .sort({ ten_khach_hang: 1 })
                .select('ma_khach_hang ten_khach_hang sdt sdt2 email dia_chi_day_du dia_chi_nhan tinh_thanh phuong_xa')
                .lean();
        }
        var customerIds = customersRaw.map(function(item) { return item._id; });
        var addresses = customerIds.length
            ? await DiaChiKhachHang.find({ khach_hang_id: { $in: customerIds } }).lean()
            : [];
        var addressesByCustomer = addresses.reduce(function(map, address) {
            var key = String(address.khach_hang_id || '');
            if (!key) return map;
            if (!map[key]) map[key] = [];
            map[key].push(address);
            return map;
        }, {});
        var customers = customersRaw.map(function(customer) {
            return Object.assign({}, customer, {
                dia_chi_list: addressesByCustomer[String(customer._id)] || []
            });
        });
        var vatChuaQuery = { trang_thai: 'active' };
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
            vatChuaQuery.cua_hang_id = storeId;
        }
        var vatChuaList = await VatChua.find(vatChuaQuery)
            .sort({ ten_vat_chua: 1, ma_vat_chua: 1 })
            .select('ma_vat_chua ten_vat_chua so_luong_ton')
            .lean();
        res.render('hang-hoa/phan-bo', {
            title: 'PhÃ¢n bá»• hÃ ng tá»“n kho',
            pageTitle: 'PhÃ¢n bá»• hÃ ng tá»“n kho',
            activeMenu: 'hang-hoa',
            user: req.user,
            flash: req.query || {},
            lines: data.lines,
            filter: data.filter,
            filterQueryString: data.filterQueryString,
            customers: customers,
            vatChuaList: vatChuaList,
            formatDate: formatDate
        });
    } catch (error) {
        next(error);
    }
};

async function submitAllocation(req, res, next) {
    try {
        var result = await submitStockAllocation(req);
        res.json(result);
    } catch (error) {
        if (error && error.statusCode) {
            return res.status(error.statusCode).json({ success: false, message: error.message, details: error.details || null });
        }
        next(error);
    }
};


module.exports = { allocationPage, submitAllocation };


