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
async function attributesPage(req, res, next) {
    try {
        var storeId = await resolveStoreId(req);
        await ensureDefaultAttributes(storeId);
        var attrQuery = {};
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) attrQuery.cua_hang_id = storeId;
        var attributes = await ThuocTinhHang.find(attrQuery).sort({ created_at: 1, ten_thuoc_tinh: 1 }).lean();
        if (attributes.length === 0 && attrQuery.cua_hang_id) {
            attributes = await ThuocTinhHang.find({}).sort({ created_at: 1, ten_thuoc_tinh: 1 }).lean();
        }
        var selectedId = String(req.query.thuoc_tinh_id || (attributes[0] && attributes[0]._id) || '');
        if (selectedId && !attributes.some(function(a) { return String(a._id) === selectedId; })) {
            selectedId = attributes[0] ? String(attributes[0]._id) : '';
        }
        var valueQuery = selectedId && mongoose.Types.ObjectId.isValid(selectedId) ? { thuoc_tinh_id: selectedId } : { _id: null };
        var values = await GiaTriThuocTinh.find(valueQuery).sort({ thu_tu: 1, ten_gia_tri: 1 }).lean();
        var countsAgg = await GiaTriThuocTinh.aggregate([
            { $match: { thuoc_tinh_id: { $in: attributes.map(function(a) { return a._id; }) } } },
            { $group: { _id: '$thuoc_tinh_id', count: { $sum: 1 } } }
        ]);
        var valueCounts = {};
        countsAgg.forEach(function(row) { valueCounts[String(row._id)] = row.count; });

        res.render('hang-hoa/thuoc-tinh', {
            title: 'Thuá»™c tÃ­nh hÃ ng hÃ³a',
            pageTitle: 'Thuá»™c tÃ­nh hÃ ng hÃ³a',
            activeMenu: 'hang-hoa',
            user: req.user,
            flash: req.query || {},
            attributes: attributes,
            values: values,
            valueCounts: valueCounts,
            selectedId: selectedId
        });
    } catch (error) {
        next(error);
    }
};

async function addAttribute(req, res, next) {
    try {
        var storeId = await resolveStoreId(req);
        var payload = normalizeAttributePayload(req.body);
        if (!payload.ten_thuoc_tinh) return res.redirect('/hang-hoa/thuoc-tinh?error=missing_name');
        if (!payload.ma_thuoc_tinh) payload.ma_thuoc_tinh = await nextAttributeCode(storeId);
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) payload.cua_hang_id = storeId;
        var created = await ThuocTinhHang.create(payload);
        res.redirect('/hang-hoa/thuoc-tinh?thuoc_tinh_id=' + created._id + '&success=created');
    } catch (error) {
        next(error);
    }
};

async function updateAttribute(req, res, next) {
    try {
        var id = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(id)) return res.redirect('/hang-hoa/thuoc-tinh?error=invalid_id');
        var payload = normalizeAttributePayload(req.body);
        if (!payload.ten_thuoc_tinh) return res.redirect('/hang-hoa/thuoc-tinh?error=missing_name');
        await ThuocTinhHang.updateOne({ _id: id }, { $set: payload }, { runValidators: true });
        res.redirect('/hang-hoa/thuoc-tinh?thuoc_tinh_id=' + id + '&success=updated');
    } catch (error) {
        next(error);
    }
};

async function deleteAttribute(req, res, next) {
    try {
        var id = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(id)) return res.redirect('/hang-hoa/thuoc-tinh?error=invalid_id');
        var usedByProduct = await HangHoaThuocTinh.exists({ thuoc_tinh_id: id });
        var hasValues = await GiaTriThuocTinh.exists({ thuoc_tinh_id: id });
        if (usedByProduct || hasValues) {
            await ThuocTinhHang.updateOne({ _id: id }, { $set: { trang_thai: 'inactive' } });
        } else {
            await ThuocTinhHang.deleteOne({ _id: id });
        }
        res.redirect('/hang-hoa/thuoc-tinh?success=deleted');
    } catch (error) {
        next(error);
    }
};

async function addAttributeValue(req, res, next) {
    try {
        var attrId = String(req.params.attributeId || '').trim();
        if (!mongoose.Types.ObjectId.isValid(attrId)) return res.redirect('/hang-hoa/thuoc-tinh?error=invalid_attribute');
        var attr = await ThuocTinhHang.findById(attrId).lean();
        if (!attr) return res.redirect('/hang-hoa/thuoc-tinh?error=attribute_not_found');
        var payload = normalizeAttributeValuePayload(req.body);
        if (!payload.ten_gia_tri) return res.redirect('/hang-hoa/thuoc-tinh?thuoc_tinh_id=' + attrId + '&error=missing_value');
        if (!payload.ma_gia_tri) payload.ma_gia_tri = await nextAttributeValueCode(attrId);
        payload.thuoc_tinh_id = attrId;
        payload.cua_hang_id = attr.cua_hang_id || undefined;
        await GiaTriThuocTinh.create(payload);
        res.redirect('/hang-hoa/thuoc-tinh?thuoc_tinh_id=' + attrId + '&success=value_created');
    } catch (error) {
        next(error);
    }
};

async function updateAttributeValue(req, res, next) {
    try {
        var id = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(id)) return res.redirect('/hang-hoa/thuoc-tinh?error=invalid_value');
        var value = await GiaTriThuocTinh.findById(id).lean();
        if (!value) return res.redirect('/hang-hoa/thuoc-tinh?error=value_not_found');
        var payload = normalizeAttributeValuePayload(req.body);
        if (!payload.ten_gia_tri) return res.redirect('/hang-hoa/thuoc-tinh?thuoc_tinh_id=' + value.thuoc_tinh_id + '&error=missing_value');
        await GiaTriThuocTinh.updateOne({ _id: id }, { $set: payload }, { runValidators: true });
        res.redirect('/hang-hoa/thuoc-tinh?thuoc_tinh_id=' + value.thuoc_tinh_id + '&success=value_updated');
    } catch (error) {
        next(error);
    }
};

async function deleteAttributeValue(req, res, next) {
    try {
        var id = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(id)) return res.redirect('/hang-hoa/thuoc-tinh?error=invalid_value');
        var value = await GiaTriThuocTinh.findById(id).lean();
        if (!value) return res.redirect('/hang-hoa/thuoc-tinh?error=value_not_found');
        var used = await HangHoaThuocTinh.exists({ gia_tri_id: id });
        if (used) await GiaTriThuocTinh.updateOne({ _id: id }, { $set: { trang_thai: 'inactive' } });
        else await GiaTriThuocTinh.deleteOne({ _id: id });
        res.redirect('/hang-hoa/thuoc-tinh?thuoc_tinh_id=' + value.thuoc_tinh_id + '&success=value_deleted');
    } catch (error) {
        next(error);
    }
};

async function apiAttributes(req, res, next) {
    try {
        var storeId = await resolveStoreId(req);
        await ensureDefaultAttributes(storeId);
        var query = {};
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
        var items = await ThuocTinhHang.find(query).sort({ ten_thuoc_tinh: 1 }).lean();
        return res.json({ success: true, data: items });
    } catch (error) {
        next(error);
    }
};

async function apiCreateAttribute(req, res, next) {
    try {
        var storeId = await resolveStoreId(req);
        var payload = normalizeAttributePayload(req.body);
        if (!payload.ten_thuoc_tinh) return res.status(400).json({ success: false, message: 'TÃªn thuá»™c tÃ­nh lÃ  báº¯t buá»™c' });
        if (!payload.ma_thuoc_tinh) payload.ma_thuoc_tinh = await nextAttributeCode(storeId);
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) payload.cua_hang_id = storeId;
        var created = await ThuocTinhHang.create(payload);
        return res.json({ success: true, data: created });
    } catch (error) {
        next(error);
    }
};

async function apiUpdateAttribute(req, res, next) {
    try {
        var id = String(req.params.id || '');
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'ID khÃ´ng há»£p lá»‡' });
        var payload = normalizeAttributePayload(req.body);
        await ThuocTinhHang.updateOne({ _id: id }, { $set: payload }, { runValidators: true });
        return res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

async function apiDeleteAttribute(req, res, next) {
    try {
        var id = String(req.params.id || '');
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'ID khÃ´ng há»£p lá»‡' });
        var used = await HangHoaThuocTinh.exists({ thuoc_tinh_id: id });
        var hasValues = await GiaTriThuocTinh.exists({ thuoc_tinh_id: id });
        if (used || hasValues) await ThuocTinhHang.updateOne({ _id: id }, { $set: { trang_thai: 'inactive' } });
        else await ThuocTinhHang.deleteOne({ _id: id });
        return res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

async function apiAttributeValues(req, res, next) {
    try {
        var query = {};
        var attrId = String(req.query.thuoc_tinh_id || '').trim();
        if (mongoose.Types.ObjectId.isValid(attrId)) query.thuoc_tinh_id = attrId;
        var items = await GiaTriThuocTinh.find(query).sort({ thu_tu: 1, ten_gia_tri: 1 }).lean();
        return res.json({ success: true, data: items });
    } catch (error) {
        next(error);
    }
};

async function apiCreateAttributeValue(req, res, next) {
    try {
        var attrId = String(req.body.thuoc_tinh_id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(attrId)) return res.status(400).json({ success: false, message: 'Thuá»™c tÃ­nh khÃ´ng há»£p lá»‡' });
        var attr = await ThuocTinhHang.findById(attrId).lean();
        if (!attr) return res.status(404).json({ success: false, message: 'KhÃ´ng tÃ¬m tháº¥y thuá»™c tÃ­nh' });
        var payload = normalizeAttributeValuePayload(req.body);
        if (!payload.ten_gia_tri) return res.status(400).json({ success: false, message: 'TÃªn giÃ¡ trá»‹ lÃ  báº¯t buá»™c' });
        if (!payload.ma_gia_tri) payload.ma_gia_tri = await nextAttributeValueCode(attrId);
        payload.thuoc_tinh_id = attrId;
        payload.cua_hang_id = attr.cua_hang_id || undefined;
        var created = await GiaTriThuocTinh.create(payload);
        return res.json({ success: true, data: created });
    } catch (error) {
        next(error);
    }
};

async function apiUpdateAttributeValue(req, res, next) {
    try {
        var id = String(req.params.id || '');
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'ID khÃ´ng há»£p lá»‡' });
        var payload = normalizeAttributeValuePayload(req.body);
        await GiaTriThuocTinh.updateOne({ _id: id }, { $set: payload }, { runValidators: true });
        return res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

async function apiDeleteAttributeValue(req, res, next) {
    try {
        var id = String(req.params.id || '');
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'ID khÃ´ng há»£p lá»‡' });
        var used = await HangHoaThuocTinh.exists({ gia_tri_id: id });
        if (used) await GiaTriThuocTinh.updateOne({ _id: id }, { $set: { trang_thai: 'inactive' } });
        else await GiaTriThuocTinh.deleteOne({ _id: id });
        return res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

async function apiProductAttributes(req, res, next) {
    try {
        var productId = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(productId)) return res.status(400).json({ success: false, message: 'HÃ ng hÃ³a khÃ´ng há»£p lá»‡' });
        var rows = await HangHoaThuocTinh.find({ hang_hoa_id: productId })
            .populate({ path: 'thuoc_tinh_id', select: 'ten_thuoc_tinh trang_thai' })
            .populate({ path: 'gia_tri_id', select: 'ten_gia_tri thu_tu trang_thai' })
            .lean();
        var grouped = {};
        rows.forEach(function(row) {
            if (!row.thuoc_tinh_id || !row.gia_tri_id) return;
            if (row.thuoc_tinh_id.trang_thai === 'inactive' || row.gia_tri_id.trang_thai === 'inactive') return;
            var key = String(row.thuoc_tinh_id._id);
            if (!grouped[key]) grouped[key] = { thuoc_tinh_id: key, ten_thuoc_tinh: row.thuoc_tinh_id.ten_thuoc_tinh, values: [] };
            grouped[key].values.push({ gia_tri_id: String(row.gia_tri_id._id), ten_gia_tri: row.gia_tri_id.ten_gia_tri, thu_tu: row.gia_tri_id.thu_tu || 0 });
        });
        var data = Object.values(grouped).map(function(group) {
            group.values.sort(function(a, b) { return (a.thu_tu || 0) - (b.thu_tu || 0) || String(a.ten_gia_tri || '').localeCompare(String(b.ten_gia_tri || ''), 'vi'); });
            return group;
        });
        return res.json({ success: true, data: data });
    } catch (error) {
        next(error);
    }
};


module.exports = { attributesPage, addAttribute, updateAttribute, deleteAttribute, addAttributeValue, updateAttributeValue, deleteAttributeValue, apiAttributes, apiCreateAttribute, apiUpdateAttribute, apiDeleteAttribute, apiAttributeValues, apiCreateAttributeValue, apiUpdateAttributeValue, apiDeleteAttributeValue, apiProductAttributes };


