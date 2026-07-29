const {
    DonHang,
    CTDonHang,
    HoaDonBanHang,
    CTHoaDonBanHang,
    PhieuTraHang,
    CTPhieuTraHang,
    HangHoa,
    KhachHang,
    DiaChiKhachHang,
    CuaHang,
    NguoiDung,
    DoiTacGiaoHang,
    BangGiaVanChuyen,
    VanDon,
    GopDonHang,
    GopHoaDon,
    PhieuThuChi,
    CongNoKhachHang,
    SoQuy,
    Kho,
    BangGia,
    CTBangGia,
    TonKho,
    TonKhoLo,
    TonKhoLoQuyCach,
    LoHang,
    Counter,
    VatChua,
    XuatVatChua,
    applyDeliveryPartnerWorksheetFormat,
    applyExportWorksheetFormat,
    applyIdIntersection,
    applyInvoiceDebtWarning,
    applyInvoiceDebtWarningList,
    applyInvoiceTotals,
    applyInvoiceWorksheetFormat,
    applyLotAllocationsToInvoiceLine,
    applyOrderIdFilter,
    applyOrderPaymentBalance,
    applyOrderTotals,
    applyReturnWorksheetFormat,
    applyShipmentWorksheetFormat,
    assertVatChuaImportInput,
    assertVatChuaSignedInput,
    buildCustomerPaymentReceiptPayload,
    buildDeliveryPartnerExportRow,
    buildFullOrderFilter,
    buildInvoiceExportRow,
    buildInvoiceFilter,
    buildLotKey,
    buildOrderExportRow,
    buildOrderFilter,
    buildReturnExportRow,
    buildReturnFilter,
    buildReturnStockLine,
    buildShipmentExportRow,
    buildShipmentFilter,
    buildShipmentOrderFilter,
    buildVariantKey,
    calcInvoiceDetailLineTotal,
    calcLineTotal,
    cancelNhapVatChuaBySource,
    cancelReturnSlip,
    cancelXuatVatChuaBySource,
    CHO_PHEP_DAT_AM_KHO,
    cleanArray,
    cloneMergedInvoiceLine,
    cloneMergedLine,
    computeDeliveryPaymentDue,
    computeNetPaidFromReceiptRows,
    computeOrderPaymentBalance,
    congTonKho,
    copyLineMetadata,
    createCustomerDebtTransaction,
    dateRange,
    decorateInvoices,
    deductStockForInvoiceLines,
    deductStockLine,
    DELIVERY_PARTNER_EXPORT_COLUMNS,
    DELIVERY_PARTNER_STATUS_MAP,
    deliveryStockKey,
    enrichInvoiceDebtInfo,
    ensureHoaDonDonHangIndex,
    escapedRegex,
    evaluateInvoiceDebtWarning,
    ExcelJS,
    expandReturnableInvoiceItems,
    exportAddress,
    exportCustomerName,
    exportCustomerPhone,
    exportInvoiceLotName,
    exportLotName,
    exportUserName,
    exportVatChuaWithInvoice,
    exportVatChuaWithOrderDelivery,
    exportVatChuaWithSalesReturn,
    filterInvoicesByDebtWarning,
    findReturnLotId,
    formatExportDate,
    formatInvoiceFilterMoneyDisplay,
    formatInvoiceLotText,
    formatLotAllocationLabel,
    formatLotDisplay,
    formatOrderLotText,
    formatStockQty,
    generateInvoiceCode,
    generateMergeInvoiceCode,
    generateMergeOrderCode,
    generateOrderCode,
    generateShipmentCode,
    getExpiredLotQuantity,
    getExpiredQuyCachQuantity,
    getInvoicePaidAmount,
    getOrderCreateData,
    getOrderExportColumnGroupsForView,
    getOrderInvoiceDebtSummary,
    getOrderLineActualStock,
    getOrderPaidAmount,
    getReservedQuantitiesForSale,
    getReturnableInvoiceIds,
    getSellableLotQuantity,
    getSellableLotStockRows,
    getSellableQuyCachQuantity,
    getSellableStock,
    hasInvoiceFilterValue,
    importVatChuaWithSalesReturn,
    intersectIdFilters,
    INVOICE_DEBT_WARN_DEFAULT_DAYS,
    INVOICE_EXPORT_COLUMNS,
    INVOICE_EXPORT_STATUS_MAP,
    INVOICE_STATUS_FILTER_VALUES,
    INVOICE_TIME_PERIOD_MONTHS,
    invoiceCustomerPhone,
    invoiceMergeLineKey,
    invoiceRemainDue,
    invoiceShipmentBlocksMerge,
    isEnabled,
    isExpiredStockLot,
    isPaymentBookObjectId,
    isSellableStockLot,
    legacyReturnLineKey,
    loadDeliveryPartnerExportData,
    loadInvoiceExportData,
    loadInvoiceLinkedVatChuaLines,
    loadInvoiceNetPaidMap,
    loadInvoiceVatChuaEditState,
    loadOrderExportData,
    loadOrderLinkedVatChuaLines,
    loadReturnExportData,
    loadReturnInvoiceContext,
    loadSalesReturnCopyDraft,
    loadSalesReturnLinkedNhapVatChuaLines,
    loadShipmentExportData,
    luuPhiVanChuyenKhachHang,
    mergeInvoiceLotAllocations,
    mergeInvoicesInSession,
    mergeLineKey,
    mergeOrdersInSession,
    mongoose,
    moveInvoicesToTrash,
    moveOrdersToTrash,
    moveReturnsToTrash,
    normalizeAddress,
    normalizeCustomerPaymentInput,
    normalizeDiscount,
    normalizeInvoiceDebtWarnSettings,
    normalizeInvoiceFilterMoneyField,
    normalizeInvoicePageFilters,
    normalizeInvoiceStatus,
    normalizeInvoiceStatusFilter,
    normalizeInvoiceTimePeriod,
    normalizePaymentMethodValue,
    normalizePhone,
    normalizeUnitPrice,
    optionalLineObjectId,
    ORDER_EXPORT_COLUMN_DEFS,
    ORDER_EXPORT_COLUMN_GROUPS,
    ORDER_EXPORT_COLUMN_MAP,
    ORDER_EXPORT_COLUMNS,
    ORDER_EXPORT_DELIVERY_STATUS_MAP,
    ORDER_EXPORT_LINE_DELIVERY_STATUS_MAP,
    ORDER_EXPORT_STATUS_MAP,
    orderCustomerPhone,
    parseCustomerPaymentFromRequest,
    parseInvoiceFilterMoney,
    parseInvoiceMoneyInput,
    parseItems,
    parseOrderDateInput,
    parseVatChuaImportInput,
    parseVatChuaSignedInput,
    pickOrderExportRowValues,
    previewInvoiceTrash,
    previewOrderTrash,
    previewReturnTrash,
    recalcInvoiceLineTotal,
    receiptRowsForNetPaidFilter,
    recordCustomerPaymentReceipts,
    recordSalesReturnRefundReceipt,
    resolveCashBookForPayment,
    resolveCashBookIdFromBody,
    resolveInvoiceStatus,
    resolveInvoiceTimePeriodRange,
    resolveOrderExportColumns,
    resolveOrderLineUnitPrice,
    resolvePaymentBooksFromBody,
    resolveReturnTotals,
    resolveSalePrice,
    resolveStoreId,
    restoreStockLine,
    RETURN_EXPORT_COLUMNS,
    RETURN_EXPORT_LINE_TYPE_MAP,
    RETURN_EXPORT_STATUS_MAP,
    returnStockLineKey,
    rollbackDeliveryInvoice,
    sameObjectIdValue,
    seedVanDonIfEmpty,
    sendDeliveryPartnerWorkbook,
    sendInvoiceWorkbook,
    sendOrderWorkbook,
    sendReturnWorkbook,
    sendShipmentWorkbook,
    SHIPMENT_COD_STATUS_MAP,
    SHIPMENT_EXPORT_COLUMNS,
    shipmentCustomerName,
    SHIPPING_FEE_PAYER_MAP,
    SHIPPING_PRICE_TYPE_MAP,
    sortStockLotsFefo,
    stockShortageMessage,
    taoPhieuThuChi,
    taoPhieuThuKhachHang,
    tinhPhiGiaoHang,
    toArray,
    truTonKho,
    uniqueObjectIds,
    userIdFilter,
    validateDeliveryStockPreflight,
    validateOrderAvailability,
    validatePaymentBooksForCustomer
} = require('./helpers/common.helper');

const INVOICE_PAGE_SIZE = 10;

function parseInvoicePage(query) {
    const page = parseInt(query && query.page, 10);
    return Number.isFinite(page) && page > 0 ? page : 1;
}

function buildInvoiceListQueryString(query, overrides) {
    const params = new URLSearchParams();
    Object.entries(query || {}).forEach(([key, value]) => {
        if (key === 'page' || key === 'page_size') return;
        if (Array.isArray(value)) {
            value.forEach(item => params.append(key, item));
        } else if (value !== undefined && value !== null && String(value) !== '') {
            params.append(key, value);
        }
    });
    const page = Number(overrides && overrides.page);
    if (Number.isFinite(page) && page > 1) params.set('page', String(Math.floor(page)));
    return params.toString();
}

exports.getHoaDon = async (req, res, next) => {
    try {
        const normalizedFilters = normalizeInvoicePageFilters(req.query);
        const debtWarnSettings = normalizeInvoiceDebtWarnSettings(normalizedFilters);
        const filter = await buildInvoiceFilter(normalizedFilters);
        const rawInvoices = await HoaDonBanHang.find(filter)
            .populate('khach_hang_id')
            .populate('don_hang_id')
            .populate('kho_id')
            .populate('nguoi_ban_id')
            .sort({ created_at: -1 });
        const visibleInvoices = rawInvoices.filter(function(invoice) {
            return true;
        });
        const storeId = await resolveStoreId(req);
        const cashBookQuery = storeId
            ? { trang_thai: 'active', $or: [{ cua_hang_id: storeId }, { cua_hang_id: { $exists: false } }, { cua_hang_id: null }] }
            : { trang_thai: 'active' };
        let vatChuaList = [];
        let customers = [];
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
            vatChuaList = await VatChua.find({ cua_hang_id: storeId, trang_thai: 'active' })
                .sort({ ten_vat_chua: 1, ma_vat_chua: 1 })
                .select('ma_vat_chua ten_vat_chua so_luong_ton')
                .lean();
            customers = await KhachHang.find({ cua_hang_id: storeId, trang_thai: { $ne: 'inactive' } })
                .sort({ ten_khach_hang: 1 })
                .select('ma_khach_hang ten_khach_hang sdt sdt2')
                .lean();
        }
        if (!customers.length) {
            customers = await KhachHang.find({ trang_thai: { $ne: 'inactive' } })
                .sort({ ten_khach_hang: 1 })
                .select('ma_khach_hang ten_khach_hang sdt sdt2')
                .lean();
        }
        const [decoratedInvoices, partners, users, priceBooks, cashBooks] = await Promise.all([
            decorateInvoices(visibleInvoices),
            DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ ten_doi_tac: 1 }),
            NguoiDung.find().sort({ ho_ten: 1, username: 1 }),
            BangGia.find({ trang_thai: 'active' }).sort({ ten_bang_gia: 1 }),
            SoQuy.find(cashBookQuery).sort({ ten_so_quy: 1 }).lean()
        ]);
        let invoices = applyInvoiceDebtWarningList(decoratedInvoices, debtWarnSettings);
        invoices = filterInvoicesByDebtWarning(invoices, debtWarnSettings);
        let page = parseInvoicePage(req.query);
        const pageSize = INVOICE_PAGE_SIZE;
        const total = invoices.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        if (page > totalPages) page = totalPages;
        const skip = (page - 1) * pageSize;
        invoices = invoices.slice(skip, skip + pageSize);
        res.render('don-hang/hoa-don', {
            title: 'H�a don',
            invoices,
            partners,
            users,
            priceBooks,
            cashBooks,
            vatChuaList,
            customers,
            filters: normalizedFilters,
            debtWarnDefaultDays: INVOICE_DEBT_WARN_DEFAULT_DAYS,
            formatFilterMoney: formatInvoiceFilterMoneyDisplay,
            pagination: {
                total,
                page,
                limit: pageSize,
                totalPages,
                from: total === 0 ? 0 : skip + 1,
                to: Math.min(skip + pageSize, total)
            },
            qs: function(overrides) {
                return buildInvoiceListQueryString(req.query || {}, overrides || {});
            }
        });
    } catch (error) {
        next(error);
    }
};


exports.getHoaDonCreate = async (req, res, next) => {
    try {
        const storeId = await resolveStoreId(req);
        const cashBookQuery = storeId
            ? { trang_thai: 'active', $or: [{ cua_hang_id: storeId }, { cua_hang_id: { $exists: false } }, { cua_hang_id: null }] }
            : { trang_thai: 'active' };
        const [data, warehouses, cashBooks, vatChuaList] = await Promise.all([
            getOrderCreateData(),
            storeId
                ? Kho.find({ trang_thai: 'active', cua_hang_id: storeId }).sort({ ten_kho: 1 }).lean()
                : [],
            SoQuy.find(cashBookQuery).sort({ ten_so_quy: 1 }).lean(),
            storeId
                ? VatChua.find({ cua_hang_id: storeId, trang_thai: 'active' }).sort({ ten_vat_chua: 1 }).select('ten_vat_chua ma_vat_chua').lean()
                : []
        ]);
        let sourceOrder = null;
        let sourceOrderItems = [];
        let sourceShipment = null;
        let existingInvoice = null;
        let sourceInvoice = null;
        let sourceInvoiceItems = [];
        let sourceInvoiceShipment = null;
        let copyFromError = '';

        const orderId = String(req.query?.don_hang_id || '').trim();
        if (/^[0-9a-fA-F]{24}$/.test(orderId)) {
            sourceOrder = await DonHang.findById(orderId)
                .populate('khach_hang_id')
                .populate('cua_hang_id')
                .populate('kho_id')
                .lean();
            if (sourceOrder) {
                if (sourceOrder.trang_thai === 'merged') {
                    copyFromError = `Đơn hàng ${sourceOrder.ma_don_hang} đã được gộp vào ${sourceOrder.merged_to_ma_don_hang || 'đơn khác'}, không thể tạo hóa đơn riêng.`;
                    sourceOrder = null;
                    sourceOrderItems = [];
                    sourceShipment = null;
                    existingInvoice = null;
                } else {
                    [sourceOrderItems, sourceShipment, existingInvoice] = await Promise.all([
                        CTDonHang.find({ don_hang_id: sourceOrder._id }).populate('hang_hoa_id').lean(),
                        VanDon.findOne({ don_hang_id: sourceOrder._id }).lean(),
                        HoaDonBanHang.findOne({ don_hang_id: sourceOrder._id }).lean()
                    ]);
                }
            }
        }

        const copyFromId = String(req.query?.copy_from || '').trim();
        if (!sourceOrder && /^[0-9a-fA-F]{24}$/.test(copyFromId)) {
            sourceInvoice = await HoaDonBanHang.findById(copyFromId)
                .populate('khach_hang_id')
                .populate('cua_hang_id')
                .populate('kho_id')
                .lean();
            if (!sourceInvoice) {
                copyFromError = 'Không tìm thấy hóa đơn để sao chép.';
            } else {
                sourceInvoiceItems = await CTHoaDonBanHang.find({ hoa_don_id: sourceInvoice._id })
                    .populate('hang_hoa_id')
                    .lean();
                if (!sourceInvoiceItems.length) {
                    copyFromError = 'Hóa đơn chưa có hàng hóa để sao chép.';
                }
                sourceInvoiceShipment = await VanDon.findOne({
                    $or: [
                        { hoa_don_id: sourceInvoice._id },
                        ...(sourceInvoice.don_hang_id ? [{ don_hang_id: sourceInvoice.don_hang_id }] : [])
                    ]
                }).lean();
            }
        }

        res.render('don-hang/hoa-don-create', {
            title: 'H�a don',
            ...data,
            currentStoreId: storeId || '',
            warehouses,
            cashBooks,
            vatChuaList: vatChuaList || [],
            sourceOrder,
            sourceOrderItems,
            sourceShipment,
            existingInvoice,
            sourceInvoice,
            sourceInvoiceItems,
            sourceInvoiceShipment,
            copyFromError
        });
    } catch (error) {
        next(error);
    }
};


exports.createInvoice = async function(req, res, next) {
    try {
        const {
            don_hang_id,
            khach_hang_id,
            cua_hang_id,
            items,
            chiet_khau,
            kieu_giam_gia,
            phi_van_chuyen,
            khach_thanh_toan,
            phuong_thuc_thanh_toan,
            giao_hang,
            ghi_chu,
            kho_id,
            doi_tac_giao_hang_id,
            dia_chi_khach_hang_id,
            ten_nguoi_nhan,
            sdt_nguoi_nhan,
            dia_chi_nhan,
            ghi_chu_giao_hang,
            thu_ho_cod,
            cod_enabled,
            nguoi_tra_phi_giao_hang,
            diem_di,
            diem_den,
            khoang_cach_km
        } = req.body || {};

        let sourceOrder = null;
        let invoiceItems = parseItems(items);
        if (don_hang_id && /^[0-9a-fA-F]{24}$/.test(String(don_hang_id))) {
            return res.status(400).json({
                success: false,
                message: 'Hóa đơn từ đơn hàng không thể được tạo khi xác nhận giao hàng. Vui lòng dùng nút Xác nhận giao.'
            });
        }

        if (!Array.isArray(invoiceItems) || !invoiceItems.length) {
            return res.status(400).json({ success: false, message: 'Hóa đơn chưa có sản phẩm' });
        }

        const sessionStoreId = await resolveStoreId(req);
        if (!sessionStoreId) {
            return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng làm việc. Vui lòng chọn cửa hàng ở menu trên.' });
        }

        const finalKhoId = kho_id || sourceOrder?.kho_id;
        if (!finalKhoId) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho.' });
        }
        const kho = await Kho.findById(finalKhoId).lean();
        if (!kho) return res.status(400).json({ success: false, message: 'Kho không hợp lệ.' });
        if (String(kho.cua_hang_id || '') !== sessionStoreId) {
            return res.status(400).json({ success: false, message: 'Kho không thuộc cửa hàng đang làm việc.' });
        }

        let tong_tien_hang = 0;
        const normalizedItems = [];
        const expandedInvoiceItems = [];
        for (const sourceItem of invoiceItems) {
            const sourceQuyCachItems = Array.isArray(sourceItem.quy_cach_items) ? sourceItem.quy_cach_items : [];
            if (sourceQuyCachItems.length) {
                sourceQuyCachItems
                    .filter(qc => Number(qc.so_luong_dat ?? qc.so_luong) > 0)
                    .forEach(qc => {
                        expandedInvoiceItems.push(Object.assign({}, sourceItem, {
                            so_luong: Number(qc.so_luong_dat ?? qc.so_luong),
                            so_luong_dat: Number(qc.so_luong_dat ?? qc.so_luong),
                            lo_hang_id: qc.lo_hang_id || sourceItem.lo_hang_id || null,
                            gia_tri_thuoc_tinh_id: qc.gia_tri_thuoc_tinh_id || sourceItem.gia_tri_thuoc_tinh_id || null,
                            ten_quy_cach: qc.ten_quy_cach || qc.ten_thuoc_tinh || '',
                            ten_thuoc_tinh: qc.ten_thuoc_tinh || qc.ten_quy_cach || '',
                            don_gia_ban: qc.don_gia_ban ?? sourceItem.don_gia_ban,
                            don_gia: qc.don_gia_ban ?? sourceItem.don_gia_ban ?? sourceItem.don_gia,
                            chiet_khau: qc.chiet_khau ?? 0,
                            kieu_chiet_khau: qc.kieu_chiet_khau || 'vnd'
                        }));
                    });
            } else {
                expandedInvoiceItems.push(sourceItem);
            }
        }
        for (const item of expandedInvoiceItems) {
            const productId = String(item.hang_hoa_id || '').trim();
            const quantity = Number(item.so_luong_dat ?? item.so_luong ?? 0);
            if (!productId || quantity <= 0) return res.status(400).json({ success: false, message: 'Dong hang khong hop le' });
            const unitPrice = Number(item.don_gia_ban ?? item.don_gia ?? 0);
            const lineBase = quantity * unitPrice;
            const lineDiscount = normalizeDiscount(item.chiet_khau, item.kieu_chiet_khau, lineBase);
            const lineTotal = Math.max(lineBase - lineDiscount, 0);
            tong_tien_hang += lineTotal;
            normalizedItems.push({
                ct_don_hang_id: optionalLineObjectId(item.ct_don_hang_id),
                hang_hoa_id: productId,
                lo_hang_id: item.lo_hang_id || null,
                so_luong: quantity,
                don_gia: unitPrice,
                chiet_khau: lineDiscount,
                thanh_tien: lineTotal,
                ...copyLineMetadata(item)
            });
        }
        if (!normalizedItems.length) {
            return res.status(400).json({ success: false, message: 'Hóa đơn chưa có dòng hàng giao thực tế' });
        }

        const stockPreflight = await validateDeliveryStockPreflight(finalKhoId, kho, normalizedItems.map(item => ({
            hang_hoa_id: item.hang_hoa_id,
            lo_hang_id: item.lo_hang_id,
            quantity: Number(item.so_luong || 0),
            detail: item
        })));
        if (!stockPreflight.valid) {
            return res.status(400).json({
                success: false,
                message: stockPreflight.message,
                shortages: stockPreflight.shortages
            });
        }

        const parsedVatChua = parseVatChuaImportInput(req.body || {});
        try {
            assertVatChuaImportInput(parsedVatChua);
        } catch (vatChuaInputError) {
            return res.status(400).json({ success: false, message: vatChuaInputError.message });
        }
        if (parsedVatChua.vatChuaId && parsedVatChua.qty > 0) {
            const vatChuaRow = await VatChua.findOne({
                _id: parsedVatChua.vatChuaId,
                cua_hang_id: sessionStoreId,
                trang_thai: 'active'
            }).select('so_luong_ton ten_vat_chua').lean();
            if (!vatChuaRow) {
                return res.status(400).json({ success: false, message: 'Vật chất không hợp lệ hoặc đã ngưng sử dụng' });
            }
            const tonVatChua = Math.max(0, Number(vatChuaRow.so_luong_ton || 0));
            if (tonVatChua < parsedVatChua.qty) {
                return res.status(400).json({
                    success: false,
                    message: 'Tồn vật chất không đủ để xuất (cần ' + tonVatChua + ', cần ' + parsedVatChua.qty + ')'
                });
            }
        }

        const discount = normalizeDiscount(chiet_khau ?? sourceOrder?.giam_gia, kieu_giam_gia || sourceOrder?.kieu_giam_gia, tong_tien_hang);
        const finalCustomerId = khach_hang_id || sourceOrder?.khach_hang_id || null;
        const finalStoreId = sessionStoreId;
        const shouldShip = isEnabled(giao_hang) || Boolean(doi_tac_giao_hang_id) || isEnabled(thu_ho_cod) || isEnabled(cod_enabled) || Boolean(sourceOrder?.cod_enabled);
        let shippingFee = Number(phi_van_chuyen);
        if (shouldShip && (!Number.isFinite(shippingFee) || shippingFee < 0)) {
            const calculatedShippingFee = await tinhPhiGiaoHang({
                cua_hang_id: finalStoreId,
                khach_hang_id: finalCustomerId,
                dia_chi_khach_hang_id,
                doi_tac_giao_hang_id,
                diem_di,
                diem_den: diem_den || dia_chi_nhan,
                khoang_cach_km
            });
            shippingFee = Number(calculatedShippingFee.phi_giao_hang || 0);
        }
        if (!Number.isFinite(shippingFee) || shippingFee < 0) shippingFee = 0;
        const shippingFeePayer = nguoi_tra_phi_giao_hang === 'cua_hang' ? 'cua_hang' : 'khach';
        const codEnabled = isEnabled(thu_ho_cod) || isEnabled(cod_enabled) || sourceOrder?.cod_enabled === true;
        if (shouldShip && doi_tac_giao_hang_id) {
            await luuPhiVanChuyenKhachHang({
                cua_hang_id: finalStoreId,
                khach_hang_id: finalCustomerId,
                dia_chi_khach_hang_id,
                doi_tac_giao_hang_id,
                phi_van_chuyen: shippingFee,
                ghi_chu: ghi_chu_giao_hang
            });
        }
        const shippingFeeForCustomer = shouldShip && shippingFeePayer === 'khach' ? shippingFee : 0;
        const payable = Math.max(tong_tien_hang - discount + shippingFeeForCustomer, 0);
        const orderPaidBeforeInvoice = sourceOrder ? await getOrderPaidAmount(sourceOrder._id) : 0;
        let paymentAtCreate = { tong_khach_dua: 0, thuc_thu: 0, tien_mat: 0, chuyen_khoan: 0, tien_thua: 0, valid: true, errors: [] };
        if (!sourceOrder && !codEnabled) {
            paymentAtCreate = parseCustomerPaymentFromRequest(req.body, payable, false);
            if (paymentAtCreate.tong_khach_dua > 0 && !paymentAtCreate.valid) {
                return res.status(400).json({ success: false, message: paymentAtCreate.errors.join('. ') });
            }
            if (paymentAtCreate.tong_khach_dua > 0) {
                const paymentBooks = resolvePaymentBooksFromBody(req.body || {});
                const bookErrors = validatePaymentBooksForCustomer(paymentAtCreate, paymentBooks);
                if (bookErrors.length) {
                    return res.status(400).json({ success: false, message: bookErrors.join('. ') });
                }
            }
        }
        const paid = sourceOrder
            ? orderPaidBeforeInvoice
            : Math.max(paymentAtCreate.thuc_thu, 0);
        const debt = Math.max(payable - paid, 0);
        const ma_hoa_don = String(req.body?.ma_hoa_don || '').trim() || await generateInvoiceCode();
        const invoiceStatus = resolveInvoiceStatus(payable, paid);
        const invoiceDateInput = String(req.body?.ngay_ban || '').trim();
        let invoiceDate = new Date();
        if (invoiceDateInput) {
            const parsedInvoiceDate = new Date(invoiceDateInput);
            if (Number.isNaN(parsedInvoiceDate.getTime())) {
                return res.status(400).json({ success: false, message: 'Ngày hóa đơn không hợp lệ' });
            }
            invoiceDate = parsedInvoiceDate;
        }

        const invoice = await HoaDonBanHang.create({
            ma_hoa_don,
            ngay_ban: invoiceDate,
            tong_tien: tong_tien_hang,
            giam_gia: discount,
            thanh_toan: payable,
            phuong_thuc_tt: codEnabled ? 'COD' : (phuong_thuc_thanh_toan || 'Ti?n m?t'),
            trang_thai: invoiceStatus,
            ghi_chu,
            cua_hang_id: finalStoreId,
            kho_id: finalKhoId,
            ...(sourceOrder ? { don_hang_id: sourceOrder._id } : {}),
            khach_hang_id: finalCustomerId,
            nguoi_ban_id: req.user?._id
        });

        const invoiceLineRefs = [];
        for (const item of normalizedItems) {
            const invoiceLine = await CTHoaDonBanHang.create({
                hoa_don_id: invoice._id,
                ct_don_hang_id: item.ct_don_hang_id,
                hang_hoa_id: item.hang_hoa_id,
                lo_hang_id: item.lo_hang_id || undefined,
                gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id,
                ten_quy_cach: item.ten_quy_cach,
                ten_thuoc_tinh: item.ten_thuoc_tinh,
                don_vi_tinh_id: item.don_vi_tinh_id,
                ma_hang_snapshot: item.ma_hang_snapshot,
                ten_hang_snapshot: item.ten_hang_snapshot,
                don_vi_tinh_snapshot: item.don_vi_tinh_snapshot,
                so_luong: Number(item.so_luong),
                don_gia: Number(item.don_gia),
                chiet_khau: Number(item.chiet_khau || 0),
                thanh_tien: Number(item.thanh_tien || 0),
                ghi_chu: item.ghi_chu
            });
            invoiceLineRefs.push({ invoiceLineId: invoiceLine._id, item });
        }

        let stockAppliedLines = [];
        try {
            stockAppliedLines = await deductStockForInvoiceLines({
                kho_id: finalKhoId,
                ma_hoa_don,
                lineRefs: invoiceLineRefs,
                nguoi_tao_id: req.user?._id
            });
            invoice.da_tru_ton_kho = true;
            await invoice.save();
        } catch (stockError) {
            await rollbackDeliveryInvoice(invoice._id, {
                kho_id: finalKhoId,
                nguoi_tao_id: req.user?._id,
                stockLines: stockAppliedLines,
                restoreStock: stockAppliedLines.length > 0
            });
            if (/t?n kho|ton kho|Ton kho/i.test(stockError.message || '')) {
                return res.status(400).json({ success: false, message: stockError.message });
            }
            throw stockError;
        }

        if (parsedVatChua.vatChuaId && parsedVatChua.qty > 0) {
            const customerForVatChua = finalCustomerId
                ? (await KhachHang.findById(finalCustomerId).select('ten_khach_hang').lean())?.ten_khach_hang
                : '';
            try {
                await exportVatChuaWithInvoice(invoice, {
                    vat_chua_id: parsedVatChua.vatChuaId,
                    vat_chua_so_luong: parsedVatChua.qty,
                    khach_hang_ten: customerForVatChua || ''
                });
            } catch (vatChuaError) {
                await rollbackDeliveryInvoice(invoice._id, {
                    kho_id: finalKhoId,
                    nguoi_tao_id: req.user?._id,
                    stockLines: stockAppliedLines,
                    restoreStock: stockAppliedLines.length > 0
                });
                return res.status(400).json({
                    success: false,
                    message: vatChuaError.message || 'Không ghi nhận xuất vật chất được'
                });
            }
        }

        let shipment = null;
        if (shouldShip) {
            shipment = sourceOrder
                ? await VanDon.findOneAndUpdate(
                    { don_hang_id: sourceOrder._id },
                    {
                        $set: {
                            hoa_don_id: invoice._id,
                            doi_tac_giao_hang_id: doi_tac_giao_hang_id || undefined,
                            cua_hang_id: finalStoreId,
                            khach_hang_id: finalCustomerId,
                            ten_nguoi_nhan,
                            sdt_nguoi_nhan,
                            dia_chi_nhan,
                            phi_giao_hang: shippingFee,
                            nguoi_tra_phi_giao_hang: shippingFeePayer,
                            cod_enabled: codEnabled,
                            cod_amount: codEnabled ? payable : 0,
                            trang_thai_cod: codEnabled ? 'chua_thu' : 'khong_cod',
                            ghi_chu: ghi_chu_giao_hang,
                            trang_thai: 'shipping'
                        }
                    },
                    { new: true }
                )
                : null;
            if (!shipment) {
                const shipmentCount = await VanDon.countDocuments();
                shipment = await VanDon.create({
                    ma_van_don: 'VD' + String(shipmentCount + 1).padStart(6, '0'),
                    ...(sourceOrder ? { don_hang_id: sourceOrder._id } : {}),
                    hoa_don_id: invoice._id,
                    doi_tac_giao_hang_id: doi_tac_giao_hang_id || null,
                    cua_hang_id: finalStoreId,
                    khach_hang_id: finalCustomerId,
                    ten_nguoi_nhan,
                    sdt_nguoi_nhan,
                    dia_chi_nhan,
                    phi_giao_hang: shippingFee,
                    nguoi_tra_phi_giao_hang: shippingFeePayer,
                    cod_enabled: codEnabled,
                    cod_amount: codEnabled ? payable : 0,
                    trang_thai_cod: codEnabled ? 'chua_thu' : 'khong_cod',
                    ghi_chu: ghi_chu_giao_hang,
                    trang_thai: 'shipping'
                });
            }
        }

        if (sourceOrder) {
            await DonHang.updateOne(
                { _id: sourceOrder._id },
                {
                    $set: {
                        khach_thanh_toan: orderPaidBeforeInvoice,
                        khach_can_tra: Math.max(payable - orderPaidBeforeInvoice, 0),
                        trang_thai: invoiceStatus === 'paid' ? 'completed' : sourceOrder.trang_thai
                    }
                }
            );
        }

        if (debt > 0 && finalCustomerId) {
            await CongNoKhachHang.create({
                khach_hang_id: finalCustomerId,
                don_hang_id: sourceOrder?._id || undefined,
                hoa_don_id: invoice._id,
                so_tien: debt,
                loai: 'tang_no',
                ghi_chu: `Cộng nợ hóa đơn ${ma_hoa_don}`,
                ngay: invoice.ngay_ban
            });
            const customer = await KhachHang.findById(finalCustomerId).select('tong_no').lean();
            if (customer && typeof customer.tong_no === 'number') {
                await KhachHang.updateOne({ _id: finalCustomerId }, { $inc: { tong_no: debt } });
            }
        }

        if (!sourceOrder && !codEnabled && paymentAtCreate.tong_khach_dua > 0) {
            const customerName = finalCustomerId
                ? (await KhachHang.findById(finalCustomerId).select('ten_khach_hang').lean())?.ten_khach_hang
                : 'Kh�ch l?';
            await recordCustomerPaymentReceipts(buildCustomerPaymentReceiptPayload(req.body, paymentAtCreate, {
                loai_thu_chi: 'Thu tien hoa don',
                ngay_lap: invoice.ngay_ban || new Date(),
                cua_hang_id: invoice.cua_hang_id,
                nguoi_tao_id: req.user?._id,
                khach_hang_id: finalCustomerId,
                doi_tuong: customerName || 'Kh�ch l?',
                hoa_don_id: invoice._id,
                van_don_id: shipment?._id,
                ma_chung_tu_goc: ma_hoa_don,
                nhom_doi_tuong: 'khach_hang',
                hach_toan: false
            }), paymentAtCreate);
        }

        res.json({ success: true, message: 'mã tạo hóa đơn', ma_hoa_don, id: invoice._id, data: { invoice, shipment } });
    } catch (error) {
        if (error?.code === 11000 && error?.keyPattern?.don_hang_id && req.body?.don_hang_id) {
            const existingInvoice = await HoaDonBanHang.findOne({ don_hang_id: req.body.don_hang_id }).lean();
            if (existingInvoice) {
                return res.status(409).json({
                    success: false,
                    message: `Đơn hàng này đã có hóa đơn ${existingInvoice.ma_hoa_don}`,
                    data: { invoice: existingInvoice, id: existingInvoice._id, ma_hoa_don: existingInvoice.ma_hoa_don }
                });
            }
        }
        if (error?.code === 11000 && error?.keyPattern?.don_hang_id) {
            return res.status(409).json({
                success: false,
                message: 'Dữ liệu cũ đang có hóa đơn bán trực tiếp với don_hang_id = null. Hệ thống sẽ bỏ ghi null cho hóa đơn mới; vui lòng xóa field don_hang_id:null ? các hóa đơn cũ hoặc rebuild index nếu cần.'
            });
        }
        if (error?.code === 11000 && error?.keyPattern?.ma_hoa_don) {
            return res.status(409).json({
                success: false,
                message: 'Mã hóa đơn bị trùng. Vui lòng nhấn thanh toán lại để hệ thống sinh mã mới.'
            });
        }
        res.status(500).json({ success: false, message: error.message || 'Không tạo được hóa đơn' });
    }
};






exports.getHoaDonId = async (req, res, next) => {
    try {
        const invoice = await HoaDonBanHang.findById(req.params.id)
            .populate('khach_hang_id')
            .populate('don_hang_id')
            .populate('kho_id')
            .populate('nguoi_ban_id');
        if (!invoice) return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn' });
        const [decorated] = await decorateInvoices([invoice]);
        const items = await CTHoaDonBanHang.find({ hoa_don_id: invoice._id }).populate('hang_hoa_id');
        res.json({ success: true, data: { invoice: decorated, items } });
    } catch (error) {
        next(error);
    }
};


exports.getHoaDonIdDetail = async (req, res, next) => {
    try {
        const invoice = await HoaDonBanHang.findById(req.params.id)
            .populate('khach_hang_id')
            .populate('cua_hang_id')
            .populate('kho_id')
            .populate('don_hang_id')
            .populate('nguoi_ban_id');
        if (!invoice) return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn' });

        let [items, shipment, debtHistory, receipts] = await Promise.all([
            CTHoaDonBanHang.find({ hoa_don_id: invoice._id }).populate('hang_hoa_id').populate('lo_hang_id'),
            VanDon.findOne({
                $or: [
                    { hoa_don_id: invoice._id },
                    ...(invoice.don_hang_id ? [{ don_hang_id: invoice.don_hang_id._id || invoice.don_hang_id }] : [])
                ]
            }).populate('doi_tac_giao_hang_id').populate('cua_hang_id'),
            CongNoKhachHang.find({ hoa_don_id: invoice._id })
                .populate('phieu_thu_chi_id')
                .sort({ ngay: -1, created_at: -1 }),
            PhieuThuChi.find({
                trang_thai: { $ne: 'cancelled' },
                $or: [
                    { hoa_don_id: invoice._id },
                    ...(invoice.don_hang_id ? [{ don_hang_id: invoice.don_hang_id._id || invoice.don_hang_id }] : [])
                ]
            })
                .populate('nguoi_tao_id')
                .sort({ ngay_lap: -1, created_at: -1 })
                .limit(20)
        ]);
        const paid = computeNetPaidFromReceiptRows(receipts);
        const payable = Number(invoice.thanh_toan || 0);
        const storeId = String(invoice.cua_hang_id?._id || invoice.cua_hang_id || '').trim();
        const orderId = invoice.don_hang_id?._id || invoice.don_hang_id || null;
        const vatChuaLines = storeId
            ? await loadInvoiceLinkedVatChuaLines(invoice._id, orderId, storeId)
            : [];
        const vatChuaEdit = storeId
            ? await loadInvoiceVatChuaEditState(invoice._id, orderId, storeId)
            : { vat_chua_id: '', so_luong: 0 };

        res.json({
            success: true,
            data: {
                invoice,
                items,
                shipment,
                debtHistory,
                receipts,
                paid,
                debt: Math.max(0, payable - paid),
                vat_chua_lines: vatChuaLines,
                vat_chua_edit: vatChuaEdit
            }
        });
    } catch (error) {
        next(error);
    }
};


exports.postHoaDonIdSave = async (req, res, next) => {
    try {
        const invoice = await HoaDonBanHang.findById(req.params.id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn' });
        if (normalizeInvoiceStatus(invoice.trang_thai) === 'cancelled') {
            return res.status(400).json({ success: false, message: 'Hóa đơn đã hủy, không thể lưu' });
        }

        const body = req.body || {};
        const oldItems = await CTHoaDonBanHang.find({ hoa_don_id: invoice._id }).lean();
        const rowsById = new Map(oldItems.map(row => [String(row._id), row]));
        const incoming = Array.isArray(body.items) ? body.items : [];
        const normalizedRows = [];

        for (const raw of incoming) {
            const oldRow = rowsById.get(String(raw._id || ''));
            if (!oldRow) continue;
            const qty = Math.max(0, Math.floor(Number(raw.so_luong || 0)));
            const price = parseInvoiceMoneyInput(raw.don_gia);
            const discount = parseInvoiceMoneyInput(raw.chiet_khau);
            if (qty <= 0) {
                return res.status(400).json({ success: false, message: 'Số lượng phải lớn hơn 0' });
            }
            const next = {
                _id: oldRow._id,
                so_luong: qty,
                don_gia: price,
                chiet_khau: discount,
                thanh_tien: calcInvoiceDetailLineTotal({ so_luong: qty, don_gia: price, chiet_khau: discount })
            };
            normalizedRows.push({ oldRow, next });
        }

        if (!normalizedRows.length) {
            return res.status(400).json({ success: false, message: 'Hóa đơn cần có ít nhất một dòng hàng' });
        }

        const khoId = invoice.kho_id;
        const maPhieu = invoice.ma_hoa_don || String(invoice._id);
        const stockOpts = {
            nguoi_tao_id: req.user?._id,
            loai_phieu: 'dieu_chinh_ban_hang',
            ma_phieu: maPhieu,
            ghi_chu: `Dieu chinh HD ${maPhieu}`
        };

        if (invoice.da_tru_ton_kho && khoId) {
            for (const { oldRow, next } of normalizedRows) {
                const oldQty = Number(oldRow.so_luong || 0);
                const newQty = Number(next.so_luong || 0);
                if (oldQty === newQty) continue;
                try {
                    if (oldQty > 0) {
                        await restoreStockLine(khoId, oldRow, stockOpts);
                    }
                    let lotPatch = { lo_hang_id: null, lot_allocations: [] };
                    if (newQty > 0) {
                        const stockResult = await truTonKho({
                            kho_id: khoId,
                            hang_hoa_id: oldRow.hang_hoa_id,
                            lo_hang_id: oldRow.lo_hang_id || undefined,
                            ten_quy_cach: oldRow.ten_quy_cach || oldRow.ten_thuoc_tinh || '',
                            gia_tri_thuoc_tinh_id: oldRow.gia_tri_thuoc_tinh_id || undefined,
                            sync_quy_cach: Boolean(oldRow.gia_tri_thuoc_tinh_id || oldRow.ten_quy_cach || oldRow.ten_thuoc_tinh),
                            so_luong: newQty,
                            nguoi_tao_id: req.user?._id,
                            loai_phieu: 'ban_hang',
                            ma_phieu: maPhieu,
                            ghi_chu: `Dieu chinh HD ${maPhieu}`
                        });
                        lotPatch = applyLotAllocationsToInvoiceLine(stockResult.allocations);
                    }
                    next.lotPatch = lotPatch;
                } catch (stockError) {
                    return res.status(400).json({
                        success: false,
                        message: stockError.message || 'Tồn kho không đủ để điều chỉnh số lượng đơn hàng'
                    });
                }
            }
        }

        const tongTienHang = normalizedRows.reduce((sum, pair) => sum + Number(pair.next.thanh_tien || 0), 0);
        const invoiceDiscount = Number(invoice.giam_gia || 0);
        const thanhToan = Math.max(0, tongTienHang - invoiceDiscount);
        const receipts = await PhieuThuChi.find({
            trang_thai: { $ne: 'cancelled' },
            $or: [
                { hoa_don_id: invoice._id },
                ...(invoice.don_hang_id ? [{ don_hang_id: invoice.don_hang_id }] : [])
            ]
        }).lean();
        const paid = computeNetPaidFromReceiptRows(receipts);
        const status = resolveInvoiceStatus(thanhToan, paid);

        const oldCustomerId = invoice.khach_hang_id ? String(invoice.khach_hang_id) : '';
        let newCustomerId = body.khach_hang_id !== undefined
            ? String(body.khach_hang_id || '').trim()
            : oldCustomerId;
        if (newCustomerId && !mongoose.Types.ObjectId.isValid(newCustomerId)) {
            return res.status(400).json({ success: false, message: 'Khách hàng không hợp lệ' });
        }
        if (!newCustomerId) newCustomerId = '';

        let nextInvoiceDate = invoice.ngay_ban || invoice.created_at || new Date();
        if (body.ngay_ban !== undefined) {
            const parsedInvoiceDate = new Date(body.ngay_ban);
            if (Number.isNaN(parsedInvoiceDate.getTime())) {
                return res.status(400).json({ success: false, message: 'Ngày hóa đơn không hợp lệ' });
            }
            nextInvoiceDate = parsedInvoiceDate;
        }

        const oldPayable = Number(invoice.thanh_toan || 0);
        const oldDebt = Math.max(0, oldPayable - paid);
        const newDebt = Math.max(0, thanhToan - paid);

        if (newCustomerId !== oldCustomerId) {
            let newCustomer = null;
            if (newCustomerId) {
                newCustomer = await KhachHang.findById(newCustomerId).select('ten_khach_hang').lean();
                if (!newCustomer) {
                    return res.status(400).json({ success: false, message: 'Khách hàng không tồn tại' });
                }
            }
            if (oldCustomerId && oldDebt > 0) {
                await KhachHang.updateOne({ _id: oldCustomerId }, { $inc: { tong_no: -oldDebt } });
            }
            const customerName = newCustomer?.ten_khach_hang || 'Khách lẻ';
            const receiptFilter = {
                trang_thai: { $ne: 'cancelled' },
                $or: [
                    { hoa_don_id: invoice._id },
                    ...(invoice.don_hang_id ? [{ don_hang_id: invoice.don_hang_id }] : [])
                ]
            };
            await PhieuThuChi.updateMany(receiptFilter, {
                $set: {
                    khach_hang_id: newCustomerId || null,
                    doi_tuong: customerName
                }
            });
            await CongNoKhachHang.updateMany(
                { hoa_don_id: invoice._id },
                { $set: { khach_hang_id: newCustomerId || null } }
            );
            await VanDon.updateMany(
                {
                    trang_thai: { $ne: 'cancelled' },
                    $or: [
                        { hoa_don_id: invoice._id },
                        ...(invoice.don_hang_id ? [{ don_hang_id: invoice.don_hang_id }] : [])
                    ]
                },
                { $set: { khach_hang_id: newCustomerId || null } }
            );
            if (invoice.don_hang_id) {
                await DonHang.updateOne(
                    { _id: invoice.don_hang_id },
                    { $set: { khach_hang_id: newCustomerId || null } }
                );
            }
            if (newCustomerId && newDebt > 0) {
                await KhachHang.updateOne({ _id: newCustomerId }, { $inc: { tong_no: newDebt } });
            }
            invoice.khach_hang_id = newCustomerId || null;
        }

        await HoaDonBanHang.updateOne({ _id: invoice._id }, {
            $set: {
                tong_tien: tongTienHang,
                thanh_toan: thanhToan,
                trang_thai: status,
                ngay_ban: nextInvoiceDate,
                khach_hang_id: newCustomerId || null
            }
        });

        for (const { next } of normalizedRows) {
            const updateSet = {
                so_luong: next.so_luong,
                don_gia: next.don_gia,
                chiet_khau: next.chiet_khau,
                thanh_tien: next.thanh_tien
            };
            if (next.lotPatch) {
                updateSet.lo_hang_id = next.lotPatch.lo_hang_id;
                updateSet.lot_allocations = next.lotPatch.lot_allocations;
            }
            await CTHoaDonBanHang.updateOne({ _id: next._id }, { $set: updateSet });
        }

        const parsedVatChua = parseVatChuaImportInput(body);
        try {
            assertVatChuaImportInput(parsedVatChua);
        } catch (vcErr) {
            return res.status(400).json({ success: false, message: vcErr.message || 'Dữ liệu vât ch?a không hợp lệ' });
        }

        const storeId = invoice.cua_hang_id;
        const orderId = invoice.don_hang_id || null;
        await cancelXuatVatChuaBySource(storeId, 'hoa_don', invoice._id);
        if (orderId) await cancelXuatVatChuaBySource(storeId, 'don_hang', orderId);

        if (parsedVatChua.vatChuaId && parsedVatChua.qty > 0) {
            const updatedInvoice = await HoaDonBanHang.findById(invoice._id).lean();
            let customerName = '';
            if (updatedInvoice?.khach_hang_id) {
                const customer = await KhachHang.findById(updatedInvoice.khach_hang_id).select('ten_khach_hang').lean();
                customerName = customer?.ten_khach_hang || '';
            }
            try {
                await exportVatChuaWithInvoice(updatedInvoice, {
                    vat_chua_id: parsedVatChua.vatChuaId,
                    vat_chua_so_luong: parsedVatChua.qty,
                    khach_hang_ten: customerName
                });
            } catch (vatChuaError) {
                return res.status(400).json({
                    success: false,
                    message: vatChuaError.message || 'Không ghi nhận xuất vât ch?a được'
                });
            }
        }

        return res.json({ success: true, message: 'Đã lưu thông tin hóa đơn' });
    } catch (error) {
        next(error);
    }
};


exports.postHoaDonIdDuplicate = async (req, res, next) => {
    try {
        const sourceInvoice = await HoaDonBanHang.findById(req.params.id).lean();
        if (!sourceInvoice) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn' });
        }

        const sourceItems = await CTHoaDonBanHang.find({ hoa_don_id: sourceInvoice._id }).lean();
        if (!sourceItems.length) {
            return res.status(400).json({ success: false, message: 'Hóa đơn chưa có hàng hóa để sao chép' });
        }

        const newInvoice = await HoaDonBanHang.create({
            ma_hoa_don: await generateInvoiceCode(),
            ngay_ban: new Date(),
            tong_tien: Number(sourceInvoice.tong_tien || 0),
            giam_gia: Number(sourceInvoice.giam_gia || 0),
            thanh_toan: Number(sourceInvoice.thanh_toan || 0),
            phuong_thuc_tt: sourceInvoice.phuong_thuc_tt || '',
            trang_thai: 'draft',
            ghi_chu: sourceInvoice.ghi_chu || '',
            cua_hang_id: sourceInvoice.cua_hang_id || null,
            chi_nhanh_id: sourceInvoice.chi_nhanh_id || null,
            kho_id: sourceInvoice.kho_id || null,
            khach_hang_id: sourceInvoice.khach_hang_id || null,
            nguoi_ban_id: req.user?._id || sourceInvoice.nguoi_ban_id || null
        });

        await CTHoaDonBanHang.insertMany(sourceItems.map(item => ({
            hoa_don_id: newInvoice._id,
            hang_hoa_id: item.hang_hoa_id,
            lo_hang_id: item.lo_hang_id || null,
            lot_allocations: Array.isArray(item.lot_allocations) ? item.lot_allocations : [],
            gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id,
            ten_quy_cach: item.ten_quy_cach,
            ten_thuoc_tinh: item.ten_thuoc_tinh,
            so_luong: Number(item.so_luong || 0),
            don_gia: Number(item.don_gia || 0),
            chiet_khau: Number(item.chiet_khau || 0),
            thanh_tien: Number(item.thanh_tien || 0)
        })));

        res.json({
            success: true,
            message: 'Đã sao chép hóa đơn',
            invoice_id: String(newInvoice._id),
            ma_hoa_don: newInvoice.ma_hoa_don
        });
    } catch (error) {
        next(error);
    }
};


exports.postHoaDonIdCancel = async (req, res, next) => {
    try {
        const invoice = await HoaDonBanHang.findById(req.params.id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn' });
        if (normalizeInvoiceStatus(invoice.trang_thai) === 'cancelled') {
            return res.json({ success: true, message: 'Hóa đơn đã hủy' });
        }
        if (normalizeInvoiceStatus(invoice.trang_thai) === 'merged') {
            return res.status(400).json({
                success: false,
                message: `Hóa đơn này đã được gộp vào ${invoice.merged_to_ma_hoa_don || 'hóa đơn khác'}, không thể hủy riêng.`
            });
        }

        const [receipts, debts, shipment] = await Promise.all([
            PhieuThuChi.find({ hoa_don_id: invoice._id, trang_thai: { $ne: 'cancelled' } }),
            CongNoKhachHang.find({ hoa_don_id: invoice._id }).lean(),
            VanDon.findOne({
                $or: [
                    { hoa_don_id: invoice._id },
                    ...(invoice.don_hang_id ? [{ don_hang_id: invoice.don_hang_id }] : [])
                ]
            })
        ]);

        for (const receipt of receipts) {
            receipt.trang_thai = 'cancelled';
            await receipt.save();
        }

        const debtIncrease = debts
            .filter(row => row.loai === 'tang_no')
            .reduce((sum, row) => sum + Math.abs(Number(row.so_tien || 0)), 0);
        if (invoice.khach_hang_id && debtIncrease > 0) {
            const customer = await KhachHang.findById(invoice.khach_hang_id).select('tong_no').lean();
            if (customer && typeof customer.tong_no === 'number') {
                await KhachHang.updateOne({ _id: invoice.khach_hang_id }, { $inc: { tong_no: -debtIncrease } });
            }
            await CongNoKhachHang.create({
                khach_hang_id: invoice.khach_hang_id,
                don_hang_id: invoice.don_hang_id || undefined,
                hoa_don_id: invoice._id,
                so_tien: debtIncrease,
                loai: 'giam_no',
                ghi_chu: `Hoàn tiền hủy hóa đơn ${invoice.ma_hoa_don}`,
                ngay: new Date()
            });
        }

        if (shipment) {
            shipment.trang_thai = 'cancelled';
            if (shipment.trang_thai_cod !== 'da_thu') shipment.trang_thai_cod = 'khong_cod';
            await shipment.save();
        }

        if (invoice.da_tru_ton_kho) {
            const invoiceLines = await CTHoaDonBanHang.find({ hoa_don_id: invoice._id }).lean();
            for (const line of invoiceLines) {
                await restoreStockLine(invoice.kho_id, line, {
                    nguoi_tao_id: req.user?._id,
                    loai_phieu: 'huy_hoa_don',
                    ma_phieu: invoice.ma_hoa_don || String(invoice._id),
                    ghi_chu: `Hoan ton huy HD ${invoice.ma_hoa_don || invoice._id}`
                });
            }
            invoice.da_tru_ton_kho = false;
        }

        invoice.trang_thai = 'cancelled';
        await invoice.save();
        res.json({ success: true, message: 'Đã hủy hóa đơn' });
    } catch (error) {
        next(error);
    }
};


exports.postHoaDonIdPhieuThu = async (req, res, next) => {
    try {
        const invoice = await HoaDonBanHang.findById(req.params.id);
        if (!invoice) return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn' });
        if (invoice.trang_thai === 'cancelled') {
            return res.status(400).json({ success: false, message: 'Hóa đơn đã hủy, không thể thu tiền' });
        }

        const [receipts, shipment] = await Promise.all([
            PhieuThuChi.find(
                receiptRowsForNetPaidFilter({
                    $or: [
                        { hoa_don_id: invoice._id },
                        ...(invoice.don_hang_id ? [{ don_hang_id: invoice.don_hang_id }] : [])
                    ]
                })
            ).lean(),
            VanDon.findOne({
                $or: [
                    { hoa_don_id: invoice._id },
                    ...(invoice.don_hang_id ? [{ don_hang_id: invoice.don_hang_id }] : [])
                ]
            }).lean()
        ]);
        const payable = Number(invoice.thanh_toan || 0);
        const paidBefore = computeNetPaidFromReceiptRows(receipts);
        const remaining = Math.max(payable - paidBefore, 0);
        const payment = parseCustomerPaymentFromRequest(req.body, remaining, true);
        if (!payment.valid) {
            return res.status(400).json({ success: false, message: payment.errors.join('. ') });
        }

        const cashBookId = resolveCashBookIdFromBody(req.body || {});
        const paymentBooks = resolvePaymentBooksFromBody(req.body || {});
        if ((payment.tien_mat > 0 || payment.tien_thua > 0) && !paymentBooks.so_quy_tien_mat_id) {
            try {
                const cashBook = await resolveCashBookForPayment({
                    loaiSoQuy: 'tien_mat',
                    requestedId: paymentBooks.so_quy_id || cashBookId || ''
                });
                paymentBooks.so_quy_tien_mat_id = String(cashBook._id || '');
            } catch (bookErr) {
                return res.status(400).json({ success: false, message: bookErr.message || 'Chưa có sổ tiền mặt active' });
            }
        }
        const bookErrors = validatePaymentBooksForCustomer(payment, paymentBooks);
        if (bookErrors.length) {
            return res.status(400).json({ success: false, message: bookErrors.join('. ') });
        }
        if (!paymentBooks.so_quy_tien_mat_id && !paymentBooks.so_quy_chuyen_khoan_id && !cashBookId) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ để thu tiền hóa đơn.' });
        }

        const customer = invoice.khach_hang_id
            ? await KhachHang.findById(invoice.khach_hang_id).select('ten_khach_hang').lean()
            : null;

        const { thu: receipt } = await recordCustomerPaymentReceipts(buildCustomerPaymentReceiptPayload(req.body, payment, {
            loai_thu_chi: 'Thu tien hoa don',
            ngay_lap: new Date(),
            cua_hang_id: invoice.cua_hang_id,
            nguoi_tao_id: req.user?._id,
            khach_hang_id: invoice.khach_hang_id,
            doi_tuong: customer?.ten_khach_hang || 'Khách lẻ',
            don_hang_id: invoice.don_hang_id || undefined,
            hoa_don_id: invoice._id,
            van_don_id: shipment?._id,
            ma_chung_tu_goc: invoice.ma_hoa_don,
            nhom_doi_tuong: 'khach_hang',
            hach_toan: false
        }), payment);

        const paidAfter = paidBefore + payment.thuc_thu;
        invoice.trang_thai = resolveInvoiceStatus(payable, paidAfter);
        await invoice.save();
        if (invoice.khach_hang_id) {
            await CongNoKhachHang.create({
                khach_hang_id: invoice.khach_hang_id,
                don_hang_id: invoice.don_hang_id || undefined,
                hoa_don_id: invoice._id,
                phieu_thu_chi_id: receipt._id,
                so_tien: payment.thuc_thu,
                loai: 'giam_no',
                ghi_chu: `Thu tiền hóa đơn ${invoice.ma_hoa_don}`,
                ngay: new Date()
            });
            const customerDebt = await KhachHang.findById(invoice.khach_hang_id).select('tong_no').lean();
            if (customerDebt && typeof customerDebt.tong_no === 'number') {
                await KhachHang.updateOne({ _id: invoice.khach_hang_id }, { $inc: { tong_no: -payment.thuc_thu } });
            }
        }

        if (invoice.don_hang_id) {
            const orderDoc = await DonHang.findById(invoice.don_hang_id);
            if (orderDoc) await applyOrderPaymentBalance(orderDoc, orderDoc._id);
        }

        res.json({
            success: true,
            message: 'Đã tạo phiếu thu',
            data: { receipt, paid: paidAfter, remaining: Math.max(payable - paidAfter, 0), payment }
        });
    } catch (error) {
        next(error);
    }
};


