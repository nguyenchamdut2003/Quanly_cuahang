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

exports.getVanDon = async (req, res, next) => {
    try {
        const filter = {};
        if (req.query?.q && req.query.q.trim() !== '') {
            filter.ma_van_don = { $regex: req.query.q.trim(), $options: 'i' };
        }
        if (req.query?.trang_thai && req.query.trang_thai !== 'all') {
            filter.trang_thai = req.query.trang_thai;
        }
        if (req.query?.doi_tac_giao_hang_id && req.query.doi_tac_giao_hang_id !== 'all') {
            filter.doi_tac_giao_hang_id = req.query.doi_tac_giao_hang_id;
        }
        const createdRange = dateRange(req.query, 'created_from', 'created_to', false);
        if (createdRange) filter.created_at = createdRange;
        if (req.query?.khu_vuc && req.query.khu_vuc.trim() !== '') {
            filter.dia_chi_nhan = { $regex: req.query.khu_vuc.trim(), $options: 'i' };
        }
        if (req.query?.cod === 'yes' || req.query?.cod === 'no') {
            const invoices = await HoaDonBanHang.find(req.query.cod === 'yes'
                ? { trang_thai_du_lieu: 'active', thanh_toan: { $gt: 0 } }
                : { trang_thai_du_lieu: 'active', $or: [{ thanh_toan: { $exists: false } }, { thanh_toan: 0 }, { thanh_toan: null }] }
            ).select('_id');
            filter.hoa_don_id = { $in: invoices.map(item => item._id) };
        }
        const sessionStoreId = await resolveStoreId(req);
        const cashBookQuery = sessionStoreId
            ? { trang_thai: 'active', cua_hang_id: sessionStoreId }
            : { trang_thai: 'active' };
        const [shipments, partners, cashBooks] = await Promise.all([
            VanDon.find(filter)
                .populate('don_hang_id')
                .populate('hoa_don_id')
                .populate('doi_tac_giao_hang_id')
                .populate('cua_hang_id')
                .populate('khach_hang_id')
                .sort({ created_at: -1 }),
            DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ ten_doi_tac: 1 }),
            SoQuy.find(cashBookQuery).sort({ ten_so_quy: 1 }).lean()
        ]);
        res.locals.cashBooks = cashBooks;
        res.render('don-hang/van-don', { shipments, partners, filters: req.query || {} });
    } catch (error) {
        next(error);
    }
};


exports.getVanDonId = async function(req, res) {
    res.redirect('/don-hang/van-don?shipment=' + encodeURIComponent(req.params.id));
};


exports.postVanDonIdStatus = async (req, res, next) => {
    try {
        const allowed = ['draft', 'shipping', 'completed', 'cancelled'];
        const { trang_thai } = req.body || {};
        if (!allowed.includes(trang_thai)) {
            return res.status(400).json({ success: false, message: 'Trạng thái vận đơn không hợp lệ' });
        }
        const shipment = await VanDon.findByIdAndUpdate(req.params.id, { trang_thai }, { new: true });
        if (!shipment) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy vận đơn' });
        }
        res.json({ success: true, message: 'Đã cập nhật trạng thái vận đơn', data: shipment });
    } catch (error) {
        next(error);
    }
};


exports.postVanDonIdChiPhiVanChuyen = async (req, res, next) => {
    try {
        const shipment = await VanDon.findById(req.params.id).populate('doi_tac_giao_hang_id');
        if (!shipment) return res.status(404).json({ success: false, message: 'Không tìm thấy vận đơn' });
        const amount = Number(req.body?.gia_tri || shipment.phi_giao_hang || 0);
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: 'Phí vận chuyển không hợp lệ' });
        const cashBookId = resolveCashBookIdFromBody(req.body || {});
        if (!cashBookId) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ để chi phí vận chuyển.' });
        }

        const receipt = await taoPhieuThuChi({
            loai_phieu: 'chi',
            loai_thu_chi: 'Chi phi van chuyen',
            gia_tri: amount,
            ngay_lap: new Date(),
            so_quy_id: cashBookId,
            cua_hang_id: shipment.cua_hang_id,
            nguoi_tao_id: req.user?._id,
            don_hang_id: shipment.don_hang_id,
            hoa_don_id: shipment.hoa_don_id,
            van_don_id: shipment._id,
            ma_chung_tu_goc: shipment.ma_van_don,
            doi_tuong: shipment.doi_tac_giao_hang_id?.ten_doi_tac || 'Đối tác giao hàng',
            nhom_doi_tuong: 'doi_tac_giao_hang',
            phuong_thuc_thanh_toan: normalizePaymentMethodValue(req.body?.phuong_thuc_thanh_toan),
            hach_toan: false
        });
        res.json({ success: true, message: 'Đã tạo phiếu chi phí vận chuyển', data: receipt });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Không tạo được phiếu chi vận chuyển' });
    }
};


exports.postVanDonIdThuCod = async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        let responseData = null;
        await session.withTransaction(async () => {
            const shipment = await VanDon.findById(req.params.id)
                .populate('khach_hang_id')
                .populate('hoa_don_id')
                .populate('don_hang_id')
                .session(session);
            if (!shipment) {
                const error = new Error('Khong tim thay van don');
                error.statusCode = 404;
                throw error;
            }
            if (shipment.trang_thai_cod === 'da_thu') {
                const error = new Error('Van don nay da thu COD, khong the thu lai lan nua.');
                error.statusCode = 400;
                throw error;
            }
            if (shipment.cod_enabled !== true) {
                const error = new Error('Van don khong bat COD, khong the thu COD.');
                error.statusCode = 400;
                throw error;
            }

            const codAmount = Number(shipment.cod_amount || 0);
            if (!Number.isFinite(codAmount) || codAmount <= 0) {
                const error = new Error('So tien COD khong hop le');
                error.statusCode = 400;
                throw error;
            }

            const customerId = shipment.khach_hang_id?._id || shipment.khach_hang_id;
            const invoiceId = shipment.hoa_don_id?._id || shipment.hoa_don_id;
            const orderId = shipment.don_hang_id?._id || shipment.don_hang_id;
            if (!customerId) {
                const error = new Error('Van don COD chua gan khach hang.');
                error.statusCode = 400;
                throw error;
            }
            if (!invoiceId) {
                const error = new Error('Van don COD chua gan hoa don.');
                error.statusCode = 400;
                throw error;
            }

            const cashBookId = resolveCashBookIdFromBody(req.body || {});
            if (!cashBookId) {
                const error = new Error('Vui lòng chọn sổ quỹ để thu COD.');
                error.statusCode = 400;
                throw error;
            }

            const exists = await PhieuThuChi.findOne({
                van_don_id: shipment._id,
                loai_phieu: 'thu',
                loai_thu_chi: { $in: ['thu_cod', 'Thu COD'] },
                trang_thai: { $ne: 'cancelled' }
            }).session(session);
            if (exists) {
                const error = new Error('Van don nay da thu COD, khong the thu lai lan nua.');
                error.statusCode = 400;
                throw error;
            }

            const note = `Thu COD van don ${shipment.ma_van_don || ''}`.trim();
            const receipt = await taoPhieuThuChi({
                loai_phieu: 'thu',
                loai_thu_chi: 'thu_cod',
                gia_tri: codAmount,
                ngay_lap: new Date(),
                so_quy_id: cashBookId,
                cua_hang_id: shipment.cua_hang_id,
                nguoi_tao_id: req.user?._id,
                khach_hang_id: customerId,
                don_hang_id: orderId,
                hoa_don_id: invoiceId,
                van_don_id: shipment._id,
                ma_chung_tu_goc: shipment.ma_van_don,
                doi_tuong: shipment.khach_hang_id?.ten_khach_hang || shipment.ten_nguoi_nhan || 'COD',
                ghi_chu: note,
                nhom_doi_tuong: 'khach_hang',
                phuong_thuc_thanh_toan: normalizePaymentMethodValue(req.body?.phuong_thuc_thanh_toan),
                hach_toan: false,
                session
            });

            let debtTransaction = null;
            try {
                debtTransaction = await createCustomerDebtTransaction({
                    cua_hang_id: shipment.cua_hang_id,
                    khach_hang_id: customerId,
                    loai_giao_dich: 'thu_cod',
                    huong_cong_no: 'giam_no',
                    gia_tri: codAmount,
                    anh_huong_so_quy: true,
                    hoa_don_id: invoiceId,
                    don_hang_id: orderId,
                    van_don_id: shipment._id,
                    phieu_thu_chi_id: receipt._id,
                    ma_chung_tu_goc: shipment.ma_van_don,
                    ghi_chu: note,
                    nguoi_tao_id: req.user?._id,
                    session
                });
            } catch (error) {
                if (/lon hon no hien tai/i.test(error.message || '')) {
                    throw new Error('Số tiền COD lớn hơn công nợ hiện tại của khách hàng. Vui lòng kiểm tra lại công nợ trước khi thu COD.');
                }
                throw error;
            }

            await CongNoKhachHang.create([{
                khach_hang_id: customerId,
                don_hang_id: orderId || undefined,
                hoa_don_id: invoiceId,
                phieu_thu_chi_id: receipt._id,
                so_tien: codAmount,
                loai: 'thanh_toan',
                ghi_chu: note,
                ngay: new Date()
            }], { session });

            shipment.trang_thai_cod = 'da_thu';
            await shipment.save({ session });
            responseData = { receipt, debtTransaction, shipment };
        });
        res.json({ success: true, message: 'Đã thu COD va giảm công nợ khách hàng', data: responseData });
    } catch (error) {
        return res.status(error.statusCode || 400).json({ success: false, message: error.message || 'Khong thu duoc COD' });
    } finally {
        session.endSession();
    }
};

