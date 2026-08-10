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

async function loadProductBasicDetailById(productId, req) {
    productId = normalizeIdParam(productId);
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) return null;
    var storeId = await resolveStoreId(req);
    var hasStoreScope = storeId && mongoose.Types.ObjectId.isValid(storeId);
    var productQuery = { _id: productId };
    if (hasStoreScope) {
        productQuery.$or = [
            { cua_hang_id: storeId },
            { cua_hang_id: null },
            { cua_hang_id: { $exists: false } }
        ];
    }
    var item = await HangHoa.findOne(productQuery).lean();
    if (!item) return null;

    item.mo_ta = decodeLegacyEntities(item.mo_ta || '');
    item.ghi_chu_dat_hang = decodeLegacyEntities(item.ghi_chu_dat_hang || '');
    var groupDoc = item.nhom_hang_id && mongoose.Types.ObjectId.isValid(String(item.nhom_hang_id))
        ? await NhomHang.findById(item.nhom_hang_id).select('ten_nhom_hang ma_nhom_hang').lean()
        : null;
    var supplierDoc = item.nha_cung_cap_id && mongoose.Types.ObjectId.isValid(String(item.nha_cung_cap_id))
        ? await NhaCungCap.findById(item.nha_cung_cap_id).select('ten_ncc ten_nha_cung_cap ten_cong_ty ma_ncc').lean()
        : null;
    var unitDoc = item.don_vi_tinh_id && mongoose.Types.ObjectId.isValid(String(item.don_vi_tinh_id))
        ? await DonViTinh.findById(item.don_vi_tinh_id).select('ten_don_vi ma_don_vi').lean()
        : null;
    item.nhom_hang_ten = groupDoc ? (groupDoc.ten_nhom_hang || groupDoc.ma_nhom_hang || '---') : '---';
    item.nha_cung_cap_ten = supplierDoc
        ? (supplierDoc.ten_ncc || supplierDoc.ten_nha_cung_cap || supplierDoc.ten_cong_ty || supplierDoc.ma_ncc || '---')
        : '---';
    item.don_vi_tinh_ten = unitDoc ? (unitDoc.ten_don_vi || unitDoc.ma_don_vi || '---') : '---';
    item.gia_ban_hien_thi = Number(item.gia_co_dinh || 0);

    var inventoryMap = await loadActiveInventoryTotalsByProductId(
        [item._id],
        item.quan_ly_theo_lo ? [item._id] : [],
        hasStoreScope ? storeId : null
    );
    item.ton_kho = Number(inventoryMap[String(item._id)] || 0);
    var priceMaps = await buildProductListPriceMaps([item._id]);
    applyProductListPriceFields(item, priceMaps);

    item.ton_co_the_giao = item.ton_kho;
    item.ton_het_han = 0;
    if (item.quan_ly_theo_lo) {
        var lotStockQuery = { hang_hoa_id: item._id };
        if (hasStoreScope) lotStockQuery.cua_hang_id = storeId;
        var lotRows = await TonKhoLo.find(lotStockQuery)
            .select('lo_hang_id so_luong')
            .lean();
        var lotIds = uniqueValues(lotRows, 'lo_hang_id').filter(function(id) {
            return mongoose.Types.ObjectId.isValid(id);
        });
        var lotDocs = lotIds.length
            ? await LoHang.find({ _id: { $in: lotIds } }).select('han_su_dung trang_thai so_luong_con_lai').lean()
            : [];
        var lotMap = mapBy(lotDocs, '_id');
        item.ton_co_the_giao = lotRows.reduce(function(sum, row) {
            var lot = lotMap[String(row.lo_hang_id)] || {};
            var qty = normalizeStockNumber(row.so_luong !== undefined && row.so_luong !== null ? row.so_luong : lot.so_luong_con_lai);
            return sum + (isSellableLot(lot) ? qty : 0);
        }, 0);
        item.ton_het_han = lotRows.reduce(function(sum, row) {
            var lot = lotMap[String(row.lo_hang_id)] || {};
            var qty = normalizeStockNumber(row.so_luong !== undefined && row.so_luong !== null ? row.so_luong : lot.so_luong_con_lai);
            return sum + (isExpiredLot(lot) ? qty : 0);
        }, 0);
    }
    var tonKhoThucTe = normalizeStockNumber(item.ton_kho);
    var tonCoTheGiao = normalizeStockNumber(item.ton_co_the_giao);
    var tonHetHan = normalizeStockNumber(item.ton_het_han);
    item.co_ton_nhung_khong_the_giao = tonKhoThucTe > 0 && tonCoTheGiao <= 0 && tonHetHan < tonKhoThucTe;
    item.ly_do_khong_the_giao = item.co_ton_nhung_khong_the_giao
        ? 'Tồn thực tế còn nhưng không đủ điều kiện giao (ngoài lô hết hạn).'
        : '';

    return { item: item, formatDate: formatDate };
}

async function apiProductDetail(req, res, next) {
    try {
        var ctx = await loadProductBasicDetailById(req.params.id, req);
        if (!ctx) {
            return res.status(404).type('html').send('<div class="kv-detail-panel product-detail kv-detail-error"><p>KhÃ´ng tÃ¬m tháº¥y hÃ ng hÃ³a.</p></div>');
        }
        res.render('hang-hoa/_detail-panel', ctx);
    } catch (err) {
        next(err);
    }
};

async function apiUpdateProductNotes(req, res, next) {
    try {
        var productId = normalizeIdParam(req && req.params && req.params.id);
        if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).json({ success: false, message: 'HÃ ng hÃ³a khÃ´ng há»£p lá»‡.' });
        }

        var storeId = await resolveStoreId(req);
        var productQuery = { _id: productId };
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
            productQuery.$or = [
                { cua_hang_id: storeId },
                { cua_hang_id: null },
                { cua_hang_id: { $exists: false } }
            ];
        }

        var existing = await HangHoa.findOne(productQuery).select('_id').lean();
        if (!existing) {
            return res.status(404).json({ success: false, message: 'KhÃ´ng tÃ¬m tháº¥y hÃ ng hÃ³a.' });
        }

        var payload = normalizeProductNotePayload(req && req.body);
        var updated = await HangHoa.findByIdAndUpdate(
            productId,
            { $set: payload },
            { runValidators: true, new: true }
        ).select('mo_ta ghi_chu_dat_hang').lean();

        res.json({
            success: true,
            message: 'ÄÃ£ lÆ°u mÃ´ táº£ vÃ  ghi chÃº Ä‘áº·t hÃ ng.',
            data: {
                mo_ta: decodeLegacyEntities(updated.mo_ta || ''),
                ghi_chu_dat_hang: decodeLegacyEntities(updated.ghi_chu_dat_hang || '')
            }
        });
    } catch (err) {
        res.status(err.status || err.statusCode || 500).json({
            success: false,
            message: err.message || 'KhÃ´ng cáº­p nháº­t Ä‘Æ°á»£c mÃ´ táº£/ghi chÃº.'
        });
    }
};

function normalizeTabPagination(query) {
    var limit = 10;
    var page = parseInt(query && query.page, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    return { page: page, limit: limit, skip: (page - 1) * limit };
}

function makePagination(page, limit, total) {
    total = Number(total || 0);
    var totalPages = Math.max(1, Math.ceil(total / limit));
    if (page > totalPages) page = totalPages;
    var from = total ? ((page - 1) * limit) + 1 : 0;
    var to = Math.min(page * limit, total);
    return {
        page: page,
        limit: limit,
        total: total,
        totalPages: totalPages,
        from: from,
        to: to,
        hasPrev: page > 1,
        hasNext: page < totalPages
    };
}

function makeSlicePagination(page, limit, skip, rowCount, hasNext) {
    var currentCount = Number(rowCount || 0);
    var total = hasNext ? skip + limit + 1 : skip + currentCount;
    var totalPages = hasNext ? page + 1 : Math.max(1, page);
    return {
        page: page,
        limit: limit,
        total: total,
        totalPages: totalPages,
        from: currentCount ? skip + 1 : 0,
        to: skip + currentCount,
        hasPrev: page > 1,
        hasNext: !!hasNext
    };
}

function stockCardGroupKey(row) {
    if (!row) return '';
    var docId = row.chung_tu_doc && row.chung_tu_doc._id ? String(row.chung_tu_doc._id) : '';
    return [
        row.chung_tu_type || row.loai_phieu || '',
        docId || row.ma_phieu || ''
    ].join('|');
}

function paginateStockCardRowsByDocument(rows, paging) {
    var groups = [];
    var groupMap = {};
    (rows || []).forEach(function(row) {
        var key = stockCardGroupKey(row);
        if (!groupMap[key]) {
            groupMap[key] = [];
            groups.push(groupMap[key]);
        }
        groupMap[key].push(row);
    });
    var pageGroups = groups.slice(paging.skip, paging.skip + paging.limit);
    return {
        rows: pageGroups.reduce(function(list, group) {
            return list.concat(group);
        }, []),
        total: groups.length
    };
}

async function resolveProductForTab(productId, req) {
    productId = normalizeIdParam(productId);
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) return null;
    var storeId = await resolveStoreId(req);
    var hasStoreScope = storeId && mongoose.Types.ObjectId.isValid(storeId);
    var productQuery = { _id: productId };
    if (hasStoreScope) {
        productQuery.$or = [
            { cua_hang_id: storeId },
            { cua_hang_id: null },
            { cua_hang_id: { $exists: false } }
        ];
    }
    var item = await HangHoa.findOne(productQuery).select('_id quan_ly_theo_lo han_su_dung han_su_dung_mac_dinh_so_ngay created_at ngay_tao').lean();
    if (!item) return null;
    return {
        item: item,
        productObjectId: new mongoose.Types.ObjectId(productId),
        storeId: storeId,
        hasStoreScope: hasStoreScope
    };
}

async function loadProductCardTab(productId, req) {
    var tab = await resolveProductForTab(productId, req);
    if (!tab) return null;
    var paging = normalizeTabPagination(req.query || {});
    var historyQuery = { hang_hoa_id: tab.item._id };
    if (tab.hasStoreScope) historyQuery.cua_hang_id = tab.storeId;

    var rows = await LichSuKho.find(historyQuery)
        .select('lo_hang_id loai_phieu ma_phieu ngay created_at ten_quy_cach gia_tri_thay_doi so_luong_thay_doi ton_kho_sau kho_id')
        .sort({ ngay: -1, created_at: -1 })
        .lean();
    rows = await enrichStockCardRows(rows, tab.item._id);
    rows = await filterTrashedKiemKhoStockRows(rows);
    var paged = paginateStockCardRowsByDocument(rows, paging);
    rows = paged.rows;
    var lotIds = uniqueValues(rows, 'lo_hang_id').filter(function(id) {
        return mongoose.Types.ObjectId.isValid(id);
    });
    var lotDocs = lotIds.length
        ? await LoHang.find({ _id: { $in: lotIds } }).select('ten_lo ma_lo han_su_dung ngay_nhap').lean()
        : [];
    var lotMap = mapBy(lotDocs, '_id');
    rows = rows.map(function(row) {
        var lotId = String(row.lo_hang_id || '');
        if (lotMap[lotId]) row.lo_hang_id = lotMap[lotId];
        return row;
    });
    return {
        selectedProductHistories: rows,
        pagination: makePagination(paging.page, paging.limit, paged.total),
        baseUrl: '/hang-hoa/api/' + encodeURIComponent(String(tab.item._id)) + '/card',
        formatDate: formatDate
    };
}

async function loadProductStockTab(productId, req) {
    var tab = await resolveProductForTab(productId, req);
    if (!tab) return null;
    var stockQuery = { hang_hoa_id: tab.item._id };
    if (tab.hasStoreScope) stockQuery.cua_hang_id = tab.storeId;

    var rows = await TonKho.find(stockQuery).sort({ updated_at: -1 }).lean();
    var warehouseIds = uniqueValues(rows, 'kho_id').filter(function(id) {
        return mongoose.Types.ObjectId.isValid(id);
    });
    var warehouses = warehouseIds.length
        ? await Kho.find({ _id: { $in: warehouseIds } }).select('ten_kho ma_kho trang_thai').lean()
        : [];
    var warehouseMap = warehouses.reduce(function(map, warehouse) {
        map[String(warehouse._id)] = warehouse.ten_kho || warehouse.ma_kho || '---';
        return map;
    }, {});
    var warehouseStatusMap = warehouses.reduce(function(map, warehouse) {
        map[String(warehouse._id)] = warehouse.trang_thai || '---';
        return map;
    }, {});

    var reservedRows = await Promise.all(rows.map(function(row) {
        return getReservedQuantitiesByOrder({
            kho_id: row.kho_id,
            hang_hoa_ids: [tab.item._id]
        }).then(function(reserved) {
            return {
                khoId: String(row.kho_id || ''),
                qty: Number((reserved.byProduct[String(tab.item._id)] || {}).so_luong_khach_dat || 0)
            };
        });
    }));
    var reservedByWarehouse = reservedRows.reduce(function(map, row) {
        map[row.khoId] = row.qty;
        return map;
    }, {});

    var expiryMap = {};
    var stockSummaryByWarehouse = {};
    if (tab.item.quan_ly_theo_lo) {
        var lotMatch = { hang_hoa_id: tab.item._id };
        if (tab.hasStoreScope) lotMatch.cua_hang_id = new mongoose.Types.ObjectId(String(tab.storeId));
        var lotRows = await TonKhoLo.find(lotMatch).select('kho_id lo_hang_id so_luong').lean();
        var lotIds = uniqueValues(lotRows, 'lo_hang_id').filter(function(id) {
            return mongoose.Types.ObjectId.isValid(id);
        });
        var lotDocs = lotIds.length
            ? await LoHang.find({ _id: { $in: lotIds } }).select('han_su_dung trang_thai so_luong_con_lai kho_id').lean()
            : [];
        var lotMap = mapBy(lotDocs, '_id');
        lotRows.forEach(function(row) {
            var warehouseId = String(row.kho_id || '');
            var lot = lotMap[String(row.lo_hang_id)] || {};
            if (!stockSummaryByWarehouse[warehouseId]) stockSummaryByWarehouse[warehouseId] = { sellable: 0, expired: 0 };
            var qty = normalizeStockNumber(row.so_luong !== undefined && row.so_luong !== null ? row.so_luong : lot.so_luong_con_lai);
            if (isSellableLot(lot)) stockSummaryByWarehouse[warehouseId].sellable += qty;
            if (isExpiredLot(lot)) stockSummaryByWarehouse[warehouseId].expired += qty;
            if (lot.han_su_dung) {
                var current = expiryMap[warehouseId];
                if (!current || new Date(lot.han_su_dung).getTime() > new Date(current).getTime()) {
                    expiryMap[warehouseId] = lot.han_su_dung;
                }
            }
        });
    }

    var productDefaultExpiry = null;
    if (tab.item.han_su_dung) {
        productDefaultExpiry = tab.item.han_su_dung;
    } else if (tab.item.han_su_dung_mac_dinh_so_ngay) {
        var baseDate = tab.item.created_at || tab.item.ngay_tao || new Date();
        productDefaultExpiry = new Date(new Date(baseDate).getTime() + Number(tab.item.han_su_dung_mac_dinh_so_ngay || 0) * 86400000);
    }

    rows = rows.map(function(row) {
        var warehouseId = String(row.kho_id || '');
        var rawQty = normalizeStockNumber(row.so_luong);
        var summary = stockSummaryByWarehouse[warehouseId] || null;
        var reservedQty = reservedByWarehouse[warehouseId] || 0;
        row.kho_ten = warehouseMap[warehouseId] || '---';
        row.trang_thai_kho = warehouseStatusMap[warehouseId] || '---';
        row.khach_dat = reservedQty;
        row.du_kien_het_hang = expiryMap[warehouseId] || productDefaultExpiry || null;
        row.ton_thuc_te = rawQty;
        row.ton_co_the_giao = Math.max((tab.item.quan_ly_theo_lo && summary ? summary.sellable : rawQty) - reservedQty, 0);
        row.ton_het_han = tab.item.quan_ly_theo_lo && summary ? summary.expired : 0;
        return row;
    });

    return { selectedProductInventory: rows, formatDate: formatDate };
}

async function loadProductLotsTab(productId, req) {
    var tab = await resolveProductForTab(productId, req);
    if (!tab) return null;
    var paging = normalizeTabPagination(req.query || {});
    var lotStockQuery = { hang_hoa_id: tab.item._id };
    if (tab.hasStoreScope) lotStockQuery.cua_hang_id = tab.storeId;

    var total = tab.item.quan_ly_theo_lo ? await TonKhoLo.countDocuments(lotStockQuery) : 0;
    var rows = tab.item.quan_ly_theo_lo
        ? await TonKhoLo.find(lotStockQuery)
            .populate({
                path: 'lo_hang_id',
                select: 'ma_lo ten_lo ngay_nhap han_su_dung so_luong_ban_dau so_luong_con_lai don_gia_nhap gia_von trang_thai phieu_nhap_id nha_cung_cap_id',
                populate: [
                    { path: 'phieu_nhap_id', select: 'ma_phieu_nhap ngay_nhap' },
                    { path: 'nha_cung_cap_id', select: 'ten_ncc ten_nha_cung_cap ten_cong_ty ma_ncc' }
                ]
            })
            .sort({ updated_at: -1, created_at: -1 })
            .skip(paging.skip)
            .limit(paging.limit)
            .lean()
        : [];
    var warehouseIds = uniqueValues(rows, 'kho_id').filter(function(id) {
        return mongoose.Types.ObjectId.isValid(id);
    });
    var warehouses = warehouseIds.length
        ? await Kho.find({ _id: { $in: warehouseIds } }).select('ten_kho ma_kho').lean()
        : [];
    var warehouseMap = warehouses.reduce(function(map, warehouse) {
        map[String(warehouse._id)] = warehouse.ten_kho || warehouse.ma_kho || '---';
        return map;
    }, {});
    var lotIds = rows.map(function(row) {
        var lot = row.lo_hang_id || null;
        return lot && lot._id ? lot._id : lot;
    }).filter(function(id) {
        return mongoose.Types.ObjectId.isValid(id);
    });
    var qcByLotAndWarehouse = {};
    if (lotIds.length) {
        var qcQuery = {
            hang_hoa_id: tab.item._id,
            lo_hang_id: { $in: lotIds }
        };
        if (tab.hasStoreScope) qcQuery.cua_hang_id = tab.storeId;
        if (warehouseIds.length) qcQuery.kho_id = { $in: warehouseIds };
        var qcRows = await TonKhoLoQuyCach.find(qcQuery)
            .select('kho_id lo_hang_id ten_quy_cach ten_thuoc_tinh so_luong gia_von don_gia_nhap thanh_tien')
            .sort({ ten_quy_cach: 1, updated_at: -1 })
            .lean();
        qcRows.forEach(function(qc) {
            var key = String(qc.lo_hang_id || '') + '|' + String(qc.kho_id || '');
            if (!qcByLotAndWarehouse[key]) qcByLotAndWarehouse[key] = [];
            qcByLotAndWarehouse[key].push({
                ten_quy_cach: qc.ten_quy_cach || qc.ten_thuoc_tinh || '---',
                so_luong: normalizeStockNumber(qc.so_luong),
                don_gia_nhap: normalizeStockNumber(qc.don_gia_nhap),
                gia_von: normalizeStockNumber(qc.gia_von),
                thanh_tien: normalizeStockNumber(qc.thanh_tien)
            });
        });
    }
    rows = rows.map(function(row) {
        row.kho_ten = warehouseMap[String(row.kho_id || '')] || '---';
        var lot = row.lo_hang_id || {};
        var lotId = lot && lot._id ? lot._id : lot;
        var rawQty = normalizeStockNumber(row.so_luong !== undefined && row.so_luong !== null ? row.so_luong : lot.so_luong_con_lai);
        var remainQty = normalizeStockNumber(lot.so_luong_con_lai !== undefined && lot.so_luong_con_lai !== null ? lot.so_luong_con_lai : rawQty);
        row.ton_co_the_giao = isSellableLot(lot) ? Math.max(Math.min(rawQty, remainQty), 0) : 0;
        row.ton_het_han = isExpiredLot(lot) ? rawQty : 0;
        row.quy_cach_rows = qcByLotAndWarehouse[String(lotId || '') + '|' + String(row.kho_id || '')] || [];
        return row;
    });
    return {
        selectedProductLots: rows,
        pagination: makePagination(paging.page, paging.limit, total),
        baseUrl: '/hang-hoa/api/' + encodeURIComponent(String(tab.item._id)) + '/lots',
        formatDate: formatDate
    };
}

async function renderProductTab(req, res, next, loader, viewName) {
    try {
        var ctx = await loader(req.params.id, req);
        if (!ctx) {
            return res.status(404).type('html').send('<div class="empty-cell">Không tìm thấy hàng hóa.</div>');
        }
        res.render(viewName, ctx);
    } catch (err) {
        next(err);
    }
}

async function apiProductCard(req, res, next) {
    return renderProductTab(req, res, next, loadProductCardTab, 'hang-hoa/partials/_tab-card');
}

async function apiProductStock(req, res, next) {
    return renderProductTab(req, res, next, loadProductStockTab, 'hang-hoa/partials/_tab-stock');
}

async function apiProductLots(req, res, next) {
    return renderProductTab(req, res, next, loadProductLotsTab, 'hang-hoa/partials/_tab-lots');
}

async function redirectDetail(req, res) {
    var id = String(req.params.id || '');
    if (!/^[a-f0-9]{24}$/i.test(id)) {
        return res.redirect('/hang-hoa');
    }
    return res.redirect(302, '/hang-hoa#p-' + id);
};

module.exports = { apiProductDetail, apiUpdateProductNotes, apiProductCard, apiProductStock, apiProductLots, redirectDetail };


