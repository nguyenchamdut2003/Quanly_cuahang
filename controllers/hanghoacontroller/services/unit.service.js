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
async function addUnit(req, res, next) {
    try {
        var tenDonVi = String(req?.body?.ten_don_vi || '').trim();
        var maDonVi = String(req?.body?.ma_don_vi || '').trim().toUpperCase();
        if (!tenDonVi) return respondUnitError(req, res, 400, 'Vui lòng nhập tên đơn vị tính.');
        if (!maDonVi) maDonVi = await makeUnitCode();

        var doc = {
            ma_don_vi: maDonVi,
            ten_don_vi: tenDonVi,
            trang_thai: 'active'
        };
        var storeId = await resolveStoreId(req);
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) doc.cua_hang_id = storeId;

        var created = await DonViTinh.create(doc);

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã thêm đơn vị tính.',
                data: created,
                selectedId: String(created._id),
                units: await loadUnitOptions()
            });
        }
        res.redirect('/hang-hoa?success=created');
    } catch (error) {
        if (error && error.code === 11000) {
            return respondUnitError(req, res, 409, 'Mã đơn vị tính đã tồn tại.');
        }
        if (error && error.name === 'ValidationError') {
            return respondUnitError(req, res, 400, error.message || 'Dữ liệu đơn vị tính không hợp lệ.');
        }
        next(error);
    }
};

async function updateUnit(req, res, next) {
    try {
        var unitId = normalizeIdParam(req?.params?.unitId);
        if (!unitId || !mongoose.Types.ObjectId.isValid(unitId)) {
            return respondUnitError(req, res, 400, 'Đơn vị tính không hợp lệ.');
        }

        var tenDonVi = String(req?.body?.ten_don_vi || '').trim();
        if (!tenDonVi) return respondUnitError(req, res, 400, 'Vui lòng nhập tên đơn vị tính.');

        var updated = await DonViTinh.findByIdAndUpdate(
            unitId,
            { ten_don_vi: tenDonVi },
            { runValidators: true, new: true }
        );
        if (!updated) return respondUnitError(req, res, 404, 'Không tìm thấy đơn vị tính.');

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã cập nhật đơn vị tính.',
                data: updated,
                selectedId: unitId,
                units: await loadUnitOptions()
            });
        }
        res.redirect('/hang-hoa?success=updated');
    } catch (error) {
        if (error && error.name === 'ValidationError') {
            return respondUnitError(req, res, 400, error.message || 'Dữ liệu đơn vị tính không hợp lệ.');
        }
        next(error);
    }
};

async function removeUnit(req, res, next) {
    try {
        var unitId = normalizeIdParam(req?.params?.unitId);
        if (!unitId || !mongoose.Types.ObjectId.isValid(unitId)) {
            return respondUnitError(req, res, 400, 'Đơn vị tính không hợp lệ.');
        }

        await HangHoa.updateMany(
            { don_vi_tinh_id: unitId },
            { $unset: { don_vi_tinh_id: 1 } }
        );
        var deleted = await DonViTinh.findByIdAndDelete(unitId);
        if (!deleted) return respondUnitError(req, res, 404, 'Không tìm thấy đơn vị tính.');

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã xóa đơn vị tính.',
                units: await loadUnitOptions()
            });
        }
        res.redirect('/hang-hoa?success=deleted');
    } catch (error) {
        next(error);
    }
};


module.exports = { addUnit, updateUnit, removeUnit };


