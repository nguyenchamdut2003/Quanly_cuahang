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
async function addGroup(req, res, next) {
    try {
        var tenNhom = String(req?.body?.ten_nhom_hang || '').trim();
        var moTa = String(req?.body?.mo_ta || '').trim();
        var maNhom = String(req?.body?.ma_nhom_hang || '').trim().toUpperCase();
        if (!tenNhom) return respondProductGroupError(req, res, 400, 'Vui lòng nhập tên nhóm hàng.');
        if (!maNhom) maNhom = await makeProductGroupCode();

        var storeId = await resolveStoreId(req);
        var duplicate = await findDuplicateGroupName(storeId, tenNhom);
        if (duplicate) {
            return respondProductGroupError(req, res, 409, 'Tên nhóm hàng đã tồn tại trong cửa hàng này.');
        }

        var doc = {
            ma_nhom_hang: maNhom,
            ten_nhom_hang: tenNhom,
            mo_ta: moTa,
            trang_thai: 'active'
        };
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) doc.cua_hang_id = storeId;

        var created = await NhomHang.create(doc);

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã thêm nhóm hàng.',
                data: created,
                selectedId: String(created._id),
                groups: await loadProductGroups(storeId)
            });
        }

        res.redirect('/hang-hoa?success=created');
    } catch (error) {
        if (error && error.code === 11000) {
            return respondProductGroupError(req, res, 409, 'Mã nhóm hàng đã tồn tại.');
        }
        if (error && error.name === 'ValidationError') {
            return respondProductGroupError(req, res, 400, error.message || 'Dữ liệu nhóm hàng không hợp lệ.');
        }
        next(error);
    }
};

async function updateGroup(req, res, next) {
    try {
        var groupId = normalizeIdParam(req?.params?.groupId);
        if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
            return respondProductGroupError(req, res, 400, 'Nhóm hàng không hợp lệ.');
        }

        var tenNhom = String(req?.body?.ten_nhom_hang || '').trim();
        var moTa = String(req?.body?.mo_ta || '').trim();
        if (!tenNhom) return respondProductGroupError(req, res, 400, 'Vui lòng nhập tên nhóm hàng.');

        var existing = await NhomHang.findById(groupId).lean();
        if (!existing) return respondProductGroupError(req, res, 404, 'Không tìm thấy nhóm hàng.');

        var storeId = existing.cua_hang_id ? String(existing.cua_hang_id) : await resolveStoreId(req);
        var duplicate = await findDuplicateGroupName(storeId, tenNhom, groupId);
        if (duplicate) {
            return respondProductGroupError(req, res, 409, 'Tên nhóm hàng đã tồn tại trong cửa hàng này.');
        }

        var updated = await NhomHang.findByIdAndUpdate(
            groupId,
            { ten_nhom_hang: tenNhom, mo_ta: moTa },
            { runValidators: true, new: true }
        );
        if (!updated) return respondProductGroupError(req, res, 404, 'Không tìm thấy nhóm hàng.');

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã cập nhật nhóm hàng.',
                data: updated,
                selectedId: groupId,
                groups: await loadProductGroups(storeId)
            });
        }

        res.redirect('/hang-hoa?success=updated');
    } catch (error) {
        if (error && error.name === 'ValidationError') {
            return respondProductGroupError(req, res, 400, error.message || 'Dữ liệu nhóm hàng không hợp lệ.');
        }
        next(error);
    }
};

async function removeGroup(req, res, next) {
    try {
        var groupId = normalizeIdParam(req?.params?.groupId);
        if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
            return respondProductGroupError(req, res, 400, 'Nhóm hàng không hợp lệ.');
        }

        var usedCount = await HangHoa.countDocuments({ nhom_hang_id: groupId });
        var deleted = null;
        var message = 'Đã xóa nhóm hàng.';
        if (usedCount > 0) {
            deleted = await NhomHang.findByIdAndUpdate(groupId, { trang_thai: 'inactive' }, { new: true });
            message = 'Nhóm hàng đang được sử dụng nên đã chuyển sang ngừng hoạt động.';
        } else {
            deleted = await NhomHang.findByIdAndDelete(groupId);
        }
        if (!deleted) return respondProductGroupError(req, res, 404, 'Không tìm thấy nhóm hàng.');
        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: message,
                groups: await loadProductGroups()
            });
        }

        res.redirect('/hang-hoa?success=deleted');
    } catch (error) {
        next(error);
    }
};


module.exports = { addGroup, updateGroup, removeGroup };


