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
async function apiProductDetail(req, res, next) {
    try {
        var ctx = await loadProductDetailById(req.params.id, req);
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

async function redirectDetail(req, res) {
    var id = String(req.params.id || '');
    if (!/^[a-f0-9]{24}$/i.test(id)) {
        return res.redirect('/hang-hoa');
    }
    return res.redirect(302, '/hang-hoa#p-' + id);
};

module.exports = { apiProductDetail, apiUpdateProductNotes, redirectDetail };


