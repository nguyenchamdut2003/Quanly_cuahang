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
async function add(req, res, next) {
    try {
        var payload = normalizeProductPayload(req?.body);
        if (!payload.ten_hang) {
            return res.redirect('/hang-hoa?mode=create&error=missing_name');
        }
        if (!payload.ma_hang) {
            payload.ma_hang = await makeProductCode();
        }
        if (!payload.nhom_hang_id) delete payload.nhom_hang_id;
        if (!payload.don_vi_tinh_id) delete payload.don_vi_tinh_id;
        if (!payload.nha_cung_cap_id) delete payload.nha_cung_cap_id;

        var initialQty = Number(payload.ton_ban_dau || 0);
        var created = await HangHoa.create(payload);
        if (initialQty > 0) {
            var warehouse = await getDefaultWarehouseForProduct(created, req);
            if (warehouse) {
                var inventory = await TonKho.findOneAndUpdate(
                    { kho_id: warehouse._id, hang_hoa_id: created._id },
                    {
                        $setOnInsert: {
                            cua_hang_id: warehouse.cua_hang_id,
                            chi_nhanh_id: warehouse.chi_nhanh_id,
                            kho_id: warehouse._id,
                            hang_hoa_id: created._id
                        },
                        $inc: { so_luong: initialQty }
                    },
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                ).lean();

                var lotOptions = {
                    ma_lo: String(req?.body?.initial_lot_ma || '').trim() || undefined,
                    ten_lo: String(req?.body?.initial_lot_ten || '').trim() || undefined,
                    han_su_dung: req?.body?.initial_lot_han_su_dung ? new Date(req.body.initial_lot_han_su_dung) : undefined,
                    ghi_chu: 'Tạo từ tồn ban đầu'
                };
                var createdLots = [];
                if (created.quan_ly_theo_lo) {
                    createdLots = await createDefaultLotFromInventory(created, [inventory], req, lotOptions);
                }

                if (LichSuKho) {
                    await LichSuKho.create({
                        cua_hang_id: warehouse.cua_hang_id,
                        chi_nhanh_id: warehouse.chi_nhanh_id,
                        kho_id: warehouse._id,
                        hang_hoa_id: created._id,
                        lo_hang_id: createdLots[0]?._id || undefined,
                        nguoi_tao_id: req.user && req.user._id ? req.user._id : undefined,
                        loai_phieu: 'dieu_chinh',
                        ma_phieu: 'TON_DAU_' + (created.ma_hang || created._id),
                        so_luong_thay_doi: initialQty,
                        ton_kho_sau: Number(inventory.so_luong || 0),
                        gia_tri_thay_doi: initialQty * Number(created.gia_von || 0),
                        ghi_chu: 'Tồn ban đầu'
                    });
                }
            }
        }
        res.redirect('/hang-hoa?success=created');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/hang-hoa?mode=create&error=duplicate_code');
        }
        next(error);
    }
};

async function update(req, res, next) {
    try {
        var productId = normalizeIdParam(req?.params?.id);
        if (!productId) return res.redirect('/hang-hoa?error=invalid_product');

        var payload = normalizeProductPayload(req?.body);
        if (!payload.ten_hang) {
            return res.redirect('/hang-hoa?mode=create&error=missing_name');
        }

        if (!payload.ma_hang) delete payload.ma_hang;
        if (!payload.nhom_hang_id) delete payload.nhom_hang_id;
        if (!payload.don_vi_tinh_id) delete payload.don_vi_tinh_id;
        if (!payload.nha_cung_cap_id) delete payload.nha_cung_cap_id;

        var oldProduct = await HangHoa.findById(productId).lean();
        var updatedProduct = await HangHoa.findByIdAndUpdate(productId, payload, { runValidators: true, new: true });
        if (oldProduct && !oldProduct.quan_ly_theo_lo && updatedProduct && updatedProduct.quan_ly_theo_lo) {
            var inventoryRows = await TonKho.find({ hang_hoa_id: updatedProduct._id, so_luong: { $gt: 0 } }).lean();
            await createDefaultLotFromInventory(updatedProduct, inventoryRows, req, {
                ma_lo: String(req?.body?.initial_lot_ma || '').trim() || undefined,
                ten_lo: String(req?.body?.initial_lot_ten || '').trim() || undefined,
                han_su_dung: req?.body?.initial_lot_han_su_dung ? new Date(req.body.initial_lot_han_su_dung) : undefined
            });
        }
        res.redirect('/hang-hoa?success=updated');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/hang-hoa?mode=create&error=duplicate_code');
        }
        next(error);
    }
};

async function remove(req, res, next) {
    try {
        var productId = normalizeIdParam(req?.params?.id);
        if (!productId) return res.redirect('/hang-hoa?error=invalid_product');

        var storeId = await resolveStoreId(req);
        await moveProductsToTrash([productId], storeId, req.user?._id);
        res.redirect('/hang-hoa?success=deleted');
    } catch (error) {
        next(error);
    }
};

async function removeSelected(req, res, next) {
    try {
        var ids = req?.body?.ids || [];
        if (!Array.isArray(ids)) ids = [ids];
        ids = ids.map(function(item) { return String(item || '').trim(); }).filter(Boolean);
        if (ids.length === 0) return res.redirect('/hang-hoa?error=no_selection');

        var storeId = await resolveStoreId(req);
        await moveProductsToTrash(ids, storeId, req.user?._id);
        res.redirect('/hang-hoa?success=deleted');
    } catch (error) {
        next(error);
    }
};


module.exports = { add, update, remove, removeSelected };


