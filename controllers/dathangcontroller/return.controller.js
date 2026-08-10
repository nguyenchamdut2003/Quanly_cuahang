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

const RETURN_PAGE_SIZE = 10;

function parseReturnPage(query) {
    const page = parseInt(query && query.page, 10);
    return Number.isFinite(page) && page > 0 ? page : 1;
}

function buildReturnListQueryString(query, overrides) {
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

function normalizeReturnIds(input) {
    const rawIds = Array.isArray(input)
        ? input
        : (input ? [input] : []);
    return rawIds
        .map(id => String(id || '').trim())
        .filter(id => mongoose.Types.ObjectId.isValid(id));
}

function activeReturnDataFilter(extra = {}) {
    return {
        ...extra,
        $or: [
            { trang_thai_du_lieu: 'active' },
            { trang_thai_du_lieu: { $exists: false } },
            { trang_thai_du_lieu: null },
            { trang_thai_du_lieu: '' }
        ]
    };
}

exports.getTraHang = async (req, res, next) => {
    try {
        const filter = await buildReturnFilter(req.query);
        let page = parseReturnPage(req.query);
        const pageSize = RETURN_PAGE_SIZE;
        const total = await PhieuTraHang.countDocuments(filter);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        if (page > totalPages) page = totalPages;
        const skip = (page - 1) * pageSize;
        const returns = await PhieuTraHang.find(filter)
            .populate('hoa_don_id')
            .populate('khach_hang_id')
            .populate('nguoi_tao_id')
            .sort({ created_at: -1 })
            .skip(skip)
            .limit(pageSize);
        const users = await NguoiDung.find().sort({ ho_ten: 1, username: 1 });
        res.render('don-hang/tra-hang', {
            title: 'Trả hàng',
            returns,
            users,
            filters: req.query || {},
            pagination: {
                total,
                page,
                limit: pageSize,
                totalPages,
                from: total === 0 ? 0 : skip + 1,
                to: Math.min(skip + pageSize, total)
            },
            qs: function(overrides) {
                return buildReturnListQueryString(req.query || {}, overrides || {});
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.postTraHangDeactivateSelected = async (req, res, next) => {
    try {
        const ids = normalizeReturnIds(req.body && req.body.phieu_tra_hang_ids);
        if (!ids.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất một phiếu trả hàng.' });
        }

        const result = await PhieuTraHang.updateMany(
            {
                _id: { $in: ids },
                $or: [
                    { trang_thai_du_lieu: 'active' },
                    { trang_thai_du_lieu: { $exists: false } },
                    { trang_thai_du_lieu: null },
                    { trang_thai_du_lieu: '' }
                ]
            },
            { $set: { trang_thai_du_lieu: 'inactive', updated_at: new Date() } },
            { runValidators: true }
        );

        return res.json({
            success: true,
            message: 'Đã xóa phiếu trả hàng',
            data: {
                requested: ids.length,
                modified: result.modifiedCount || 0
            }
        });
    } catch (error) {
        next(error);
    }
};


exports.getTraHangCreate = async (req, res, next) => {
    try {
        const storeId = await resolveStoreId(req);
        const vatChuaQuery = storeId
            ? { trang_thai: 'active', cua_hang_id: storeId }
            : { trang_thai: 'active' };
        const [products, partners, vatChuaList] = await Promise.all([
            HangHoa.find({ trang_thai: 'active' }).sort({ ten_hang: 1 }),
            DoiTacGiaoHang.find({}).sort({ ten_doi_tac: 1, ten: 1, created_at: -1 }),
            VatChua.find(vatChuaQuery).sort({ ten_vat_chua: 1 }).select('ten_vat_chua ma_vat_chua').lean()
        ]);
        const invoices = [];
        let copyDraft = null;
        let copyFromError = '';
        const copyFromId = String(req.query?.copy_from || '').trim();
        if (copyFromId) {
            copyDraft = await loadSalesReturnCopyDraft(copyFromId);
            if (!copyDraft) copyFromError = 'Không tải được phiếu trả hàng để sao chép.';
        }
        const copyDraftJson = copyDraft ? JSON.stringify(copyDraft).replace(/</g, '\\u003c') : '';
        let prefillInvoiceJson = '';
        let prefillInvoiceError = '';
        const prefillInvoiceId = String(req.query?.invoice_id || req.query?.hoa_don_id || '').trim();
        if (prefillInvoiceId && !copyDraft) {
            try {
                const payload = await loadReturnInvoiceContext(prefillInvoiceId);
                prefillInvoiceJson = JSON.stringify(payload).replace(/</g, '\\u003c');
            } catch (prefillError) {
                prefillInvoiceError = prefillError.message || 'Không tải được hóa đơn';
            }
        }
        res.render('don-hang/tra-hang-create', {
            title: 'Trả hàng',
            invoices,
            products,
            partners,
            vatChuaList: vatChuaList || [],
            copyDraftJson,
            copyFromError,
            prefillInvoiceJson,
            prefillInvoiceError
        });
    } catch (error) {
        next(error);
    }
};


exports.getTraHangInvoicesSearch = async (req, res, next) => {
    try {
        const page = Math.max(Number(req.query.page || 1), 1);
        const limit = Math.min(Math.max(Number(req.query.limit || 7), 1), 50);
        const filter = { trang_thai_du_lieu: 'active', trang_thai: { $ne: 'cancelled' } };
        if (req.user?.cua_hang_id) filter.cua_hang_id = req.user.cua_hang_id;

        if (req.query.invoice_code && req.query.invoice_code.trim() !== '') {
            filter.ma_hoa_don = { $regex: escapedRegex(req.query.invoice_code), $options: 'i' };
        }

        const from = req.query.from_date ? new Date(req.query.from_date + 'T00:00:00') : null;
        const to = req.query.to_date ? new Date(req.query.to_date + 'T23:59:59') : null;
        if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
            filter.ngay_ban = {};
            if (from && !Number.isNaN(from.getTime())) filter.ngay_ban.$gte = from;
            if (to && !Number.isNaN(to.getTime())) filter.ngay_ban.$lte = to;
        }

        if (req.query.shipment_code && req.query.shipment_code.trim() !== '') {
            const shipments = await VanDon.find({
                ma_van_don: { $regex: escapedRegex(req.query.shipment_code), $options: 'i' },
                hoa_don_id: { $ne: null }
            }).select('hoa_don_id');
            intersectIdFilters(filter, shipments.map(item => item.hoa_don_id));
        }

        if (req.query.customer && req.query.customer.trim() !== '') {
            const q = escapedRegex(req.query.customer);
            const customers = await KhachHang.find({
                $or: [
                    { ma_khach_hang: { $regex: q, $options: 'i' } },
                    { ten_khach_hang: { $regex: q, $options: 'i' } },
                    { sdt: { $regex: q, $options: 'i' } },
                    { sdt2: { $regex: q, $options: 'i' } }
                ]
            }).select('_id');
            const customerIds = customers.map(item => item._id);
            const [customerInvoices, recipientShipments] = await Promise.all([
                customerIds.length ? HoaDonBanHang.find({ khach_hang_id: { $in: customerIds }, trang_thai_du_lieu: 'active' }).select('_id') : [],
                VanDon.find({
                    hoa_don_id: { $ne: null },
                    $or: [
                        { ten_nguoi_nhan: { $regex: q, $options: 'i' } },
                        { sdt_nguoi_nhan: { $regex: q, $options: 'i' } }
                    ]
                }).select('hoa_don_id')
            ]);
            intersectIdFilters(filter, [
                ...customerInvoices.map(item => item._id),
                ...recipientShipments.map(item => item.hoa_don_id)
            ]);
        }

        if (req.query.item_code && req.query.item_code.trim() !== '') {
            const products = await HangHoa.find({ ma_hang: { $regex: escapedRegex(req.query.item_code), $options: 'i' } }).select('_id');
            const details = products.length
                ? await CTHoaDonBanHang.find({ hang_hoa_id: { $in: products.map(item => item._id) } }).select('hoa_don_id')
                : [];
            intersectIdFilters(filter, details.map(item => item.hoa_don_id));
        }

        if (req.query.item_name && req.query.item_name.trim() !== '') {
            const products = await HangHoa.find({ ten_hang: { $regex: escapedRegex(req.query.item_name), $options: 'i' } }).select('_id');
            const details = products.length
                ? await CTHoaDonBanHang.find({ hang_hoa_id: { $in: products.map(item => item._id) } }).select('hoa_don_id')
                : [];
            intersectIdFilters(filter, details.map(item => item.hoa_don_id));
        }

        const returnableInvoiceIds = await getReturnableInvoiceIds(filter);
        const pagedIds = returnableInvoiceIds.slice((page - 1) * limit, page * limit);
        const invoices = pagedIds.length
            ? await HoaDonBanHang.find({ _id: { $in: pagedIds }, trang_thai_du_lieu: 'active' })
            .populate('khach_hang_id')
            .populate('nguoi_ban_id')
            .sort({ ngay_ban: -1, created_at: -1 })
            : [];
        const invoiceOrder = new Map(pagedIds.map((id, index) => [String(id), index]));
        invoices.sort((a, b) => invoiceOrder.get(String(a._id)) - invoiceOrder.get(String(b._id)));

        res.json({
            success: true,
            data: invoices.map(i => ({
                _id: String(i._id),
                ma_hoa_don: i.ma_hoa_don || '',
                ngay_ban: i.ngay_ban || i.created_at,
                tong_tien: i.tong_tien || 0,
                thanh_toan: i.thanh_toan || 0,
                nguoi_ban: i.nguoi_ban_id?.ho_ten || i.nguoi_ban_id?.username || 'Admin',
                khach_hang: i.khach_hang_id?.ten_khach_hang || 'Kh�ch l?',
                khach_hang_id: i.khach_hang_id ? String(i.khach_hang_id._id) : ''
            })),
            pagination: {
                page,
                limit,
                total: returnableInvoiceIds.length,
                pages: Math.max(Math.ceil(returnableInvoiceIds.length / limit), 1)
            }
        });
    } catch (error) {
        next(error);
    }
};


exports.getTraHangInvoiceId = async (req, res, next) => {
    try {
        const data = await loadReturnInvoiceContext(req.params.id);
        res.json({ success: true, data });
    } catch (error) {
        const status = Number(error.status || 0) || (error.message === 'Không tìm thấy hóa đơn' ? 404 : 500);
        res.status(status >= 400 && status < 600 ? status : 500).json({
            success: false,
            message: error.message || 'Không tải được hóa đơn trả hàng'
        });
    }
};


exports.getTraHangIdDetail = async (req, res, next) => {
    try {
        const returnSlip = await PhieuTraHang.findOne(activeReturnDataFilter({ _id: req.params.id }))
            .populate('hoa_don_id')
            .populate('khach_hang_id')
            .populate('nguoi_tao_id')
            .populate('doi_tac_giao_hang_id');
        if (!returnSlip) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu trả hàng' });

        const items = await CTPhieuTraHang.find({ phieu_tra_hang_id: returnSlip._id }).populate('hang_hoa_id');
        const invoice = returnSlip.hoa_don_id?._id
            ? await HoaDonBanHang.findById(returnSlip.hoa_don_id._id).populate('cua_hang_id').populate('nguoi_ban_id')
            : null;
        const storeId = returnSlip.cua_hang_id?._id || returnSlip.cua_hang_id || invoice?.cua_hang_id?._id || invoice?.cua_hang_id || null;
        const vat_chua_lines = storeId
            ? await loadSalesReturnLinkedNhapVatChuaLines(returnSlip._id, storeId)
            : [];

        res.json({ success: true, data: { returnSlip, items, invoice, vat_chua_lines } });
    } catch (error) {
        next(error);
    }
};


exports.postTraHangAdd = async (req, res, next) => {
    try {
        const {
            hoa_don_id,
            khach_hang_id,
            kho_id,
            items,
            exchangeItems,
            khach_thanh_toan_them,
            ghi_chu,
            ly_do,
            giam_gia,
            kieu_giam_gia,
            phi_tra_hang,
            hinh_thuc_nhan_hang_tra,
            doi_tac_giao_hang_id,
            dia_chi_lay_hang,
            ten_nguoi_gui_tra,
            sdt_nguoi_gui_tra,
            phi_lay_hang_tra,
            nguoi_tra_phi_lay_hang,
            ma_van_don_tra_hang,
            ghi_chu_van_chuyen_tra
        } = req.body || {};
        const receiveMethods = ['tai_quay', 'lay_tai_nha', 'khach_gui_ve'];
        const receiveMethod = receiveMethods.includes(hinh_thuc_nhan_hang_tra) ? hinh_thuc_nhan_hang_tra : 'tai_quay';
        const cleanPickupAddress = receiveMethod === 'lay_tai_nha' ? String(dia_chi_lay_hang || '').trim() : '';
        let cleanSenderName = receiveMethod === 'tai_quay' ? '' : String(ten_nguoi_gui_tra || '').trim();
        const cleanSenderPhone = receiveMethod === 'tai_quay' ? '' : String(sdt_nguoi_gui_tra || '').trim();
        const cleanPickupFee = receiveMethod === 'tai_quay' ? 0 : Math.max(Number(phi_lay_hang_tra || 0), 0);
        const pickupFeePayer = nguoi_tra_phi_lay_hang === 'khach' ? 'khach' : 'cua_hang';
        const cleanReturnTrackingCode = receiveMethod === 'tai_quay' ? '' : String(ma_van_don_tra_hang || '').trim();
        const cleanReturnShippingNote = receiveMethod === 'tai_quay' ? '' : String(ghi_chu_van_chuyen_tra || '').trim();
        if (receiveMethod === 'lay_tai_nha' && !cleanPickupAddress) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập địa chỉ lấy hàng trả' });
        }
        if (!Array.isArray(items) || !items.length) {
            return res.status(400).json({ success: false, message: 'Phiếu trả hàng chưa có sản phẩm' });
        }

        const cleanItems = items
            .map(item => ({
                ct_hoa_don_id: optionalLineObjectId(item.ct_hoa_don_id),
                hang_hoa_id: item.hang_hoa_id,
                lo_hang_id: item.lo_hang_id || null,
                so_luong: Number(item.so_luong || 0),
                don_gia: Number(item.don_gia || 0)
            }))
            .filter(item => (item.ct_hoa_don_id || item.hang_hoa_id) && item.so_luong > 0);
        const cleanExchangeItems = (Array.isArray(exchangeItems) ? exchangeItems : [])
            .map(item => ({
                hang_hoa_id: item.hang_hoa_id,
                lo_hang_id: item.lo_hang_id || null,
                gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id || null,
                ten_quy_cach: String(item.ten_quy_cach || item.ten_thuoc_tinh || '').trim(),
                ten_thuoc_tinh: String(item.ten_thuoc_tinh || item.ten_quy_cach || '').trim(),
                so_luong: Number(item.so_luong || 0),
                don_gia: Number(item.don_gia || 0)
            }))
            .filter(item => item.hang_hoa_id && item.so_luong > 0);

        if (!cleanItems.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập số lượng hàng trả' });
        }

        let invoice = null;
        if (hoa_don_id) {
            invoice = await HoaDonBanHang.findOne({ _id: hoa_don_id, trang_thai_du_lieu: 'active' }).lean();
            if (!invoice) return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn' });
            if (normalizeInvoiceStatus(invoice.trang_thai) === 'cancelled') {
                return res.status(400).json({ success: false, message: 'Hóa đơn đã hủy, không thể trả hàng' });
            }
            const invoiceItems = await CTHoaDonBanHang.find({ hoa_don_id }).lean();
            const returns = await PhieuTraHang.find(activeReturnDataFilter({ hoa_don_id, trang_thai: { $ne: 'cancelled' } })).select('_id').lean();
            const returnedItems = returns.length
                ? await CTPhieuTraHang.find({ phieu_tra_hang_id: { $in: returns.map(row => row._id) }, loai_dong: { $ne: 'hang_doi' } }).select('ct_hoa_don_id hang_hoa_id lo_hang_id so_luong').lean()
                : [];
            const invoiceLineById = invoiceItems.reduce((map, row) => {
                map[String(row._id)] = row;
                return map;
            }, {});
            const invoiceLinesByLegacyKey = invoiceItems.reduce((map, row) => {
                const key = legacyReturnLineKey(row);
                if (!map[key]) map[key] = [];
                map[key].push(row);
                return map;
            }, {});
            const soldByLine = invoiceItems.reduce((map, row) => {
                const key = legacyReturnLineKey(row);
                map[key] = (map[key] || 0) + Number(row.so_luong || 0);
                return map;
            }, {});
            const soldByInvoiceLine = invoiceItems.reduce((map, row) => {
                map[String(row._id)] = Number(row.so_luong || 0);
                return map;
            }, {});
            const returnedByInvoiceLine = {};
            const returnedByLegacyLine = {};
            returnedItems.forEach(row => {
                const invoiceLineId = optionalLineObjectId(row.ct_hoa_don_id);
                const map = invoiceLineId ? returnedByInvoiceLine : returnedByLegacyLine;
                const key = invoiceLineId || legacyReturnLineKey(row);
                map[key] = (map[key] || 0) + Number(row.so_luong || 0);
            });
            for (const item of cleanItems) {
                if (item.ct_hoa_don_id) {
                    const invoiceLine = invoiceLineById[item.ct_hoa_don_id];
                    if (!invoiceLine) {
                        return res.status(400).json({ success: false, message: 'Dong hoa don tra khong hop le' });
                    }
                    item.invoiceLine = invoiceLine;
                    item.hang_hoa_id = item.hang_hoa_id || invoiceLine.hang_hoa_id;
                    item.lo_hang_id = item.lo_hang_id || invoiceLine.lo_hang_id || null;
                    const legacyKey = legacyReturnLineKey(invoiceLine);
                    const returnedQty = Number(returnedByInvoiceLine[item.ct_hoa_don_id] || 0) + Number(returnedByLegacyLine[legacyKey] || 0);
                    const remainingQty = Math.max(Number(soldByInvoiceLine[item.ct_hoa_don_id] || 0) - returnedQty, 0);
                    if (item.so_luong > remainingQty) {
                        return res.status(400).json({ success: false, message: 'Số lượng trả vượt quá số lượng còn có thể trả' });
                    }
                    continue;
                }
                const key = legacyReturnLineKey(item);
                const matchingInvoiceLines = invoiceLinesByLegacyKey[key] || [];
                if (matchingInvoiceLines.length === 1) {
                    item.invoiceLine = matchingInvoiceLines[0];
                }
                const returnedByMatchedInvoiceLines = matchingInvoiceLines.reduce((sum, row) => {
                    return sum + Number(returnedByInvoiceLine[String(row._id)] || 0);
                }, 0);
                const returnedQty = Number(returnedByLegacyLine[key] || 0) + returnedByMatchedInvoiceLines;
                const remainingQty = Math.max(Number(soldByLine[key] || 0) - returnedQty, 0);
                if (item.so_luong > remainingQty) {
                    return res.status(400).json({ success: false, message: 'Số lượng trả vượt quá số lượng còn có thể trả' });
                }
            }
        }

        const warehouseId = kho_id || invoice?.kho_id;
        if (!warehouseId) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho xét trả/hủy hàng' });
        }
        const warehouse = await Kho.findById(warehouseId).lean();
        if (!warehouse) {
            return res.status(400).json({ success: false, message: 'Kho xét trả/hủy hàng không hợp lệ' });
        }

        for (const item of cleanItems) {
            const product = await HangHoa.findById(item.hang_hoa_id).select('_id ten_hang quan_ly_theo_lo').lean();
            if (!product) return res.status(400).json({ success: false, message: 'Hàng trả không tồn tại' });
            if (product.quan_ly_theo_lo && !item.lo_hang_id) {
                const fallbackLotId = await findReturnLotId(warehouseId, item.hang_hoa_id);
                if (!fallbackLotId) {
                    return res.status(400).json({
                        success: false,
                        message: `Hàng trả ${product.ten_hang || item.hang_hoa_id} quản lý theo lô nhưng hóa đơn không lưu lô. Vui lòng nhập/tạo lô hàng trước khi trả.`
                    });
                }
                item.lo_hang_id = fallbackLotId;
            }
        }

        for (const item of cleanExchangeItems) {
            const product = await HangHoa.findById(item.hang_hoa_id).select('_id ten_hang quan_ly_theo_lo').lean();
            if (!product) return res.status(400).json({ success: false, message: 'Hàng đổi không tồn tại' });
            const tenQuyCach = String(item.ten_quy_cach || item.ten_thuoc_tinh || '').trim();
            let stock = 0;
            if (tenQuyCach) {
                stock = await getSellableQuyCachQuantity(warehouseId, item.hang_hoa_id, tenQuyCach, item.lo_hang_id);
            } else if (item.lo_hang_id) {
                const lotStock = await TonKhoLo.findOne({
                    kho_id: warehouseId,
                    hang_hoa_id: item.hang_hoa_id,
                    lo_hang_id: item.lo_hang_id
                }).lean();
                stock = Number(lotStock?.so_luong || 0);
            } else {
                stock = await getSellableStock(warehouseId, product);
            }
            if (stock < item.so_luong) {
                return res.status(400).json({ success: false, message: `Tồn kho hàng đổi không đủ: ${product.ten_hang || item.hang_hoa_id}` });
            }
        }

        const tongTienHangTra = cleanItems.reduce((sum, item) => sum + item.so_luong * item.don_gia, 0);
        const tongTienHangDoi = cleanExchangeItems.reduce((sum, item) => sum + item.so_luong * item.don_gia, 0);
        const discountType = kieu_giam_gia === 'vnd' ? 'vnd' : 'vnd';
        const discountValue = Math.max(Number(giam_gia || 0), 0);
        const returnFeeValue = Math.max(Number(phi_tra_hang || 0), 0);
        const pickupFeeCustomerPays = pickupFeePayer === 'khach' ? cleanPickupFee : 0;
        const chenhLech = tongTienHangDoi + discountValue + returnFeeValue + pickupFeeCustomerPays - tongTienHangTra;
        const khachCanTraThem = Math.max(chenhLech, 0);
        const canTraKhach = Math.max(-chenhLech, 0);
        const customerId = khach_hang_id || invoice?.khach_hang_id || null;
        const storeId = invoice?.cua_hang_id || warehouse.cua_hang_id || null;
        let parsedVatChua = { vatChuaId: '', qty: 0, hasQtyInput: false };
        try {
            parsedVatChua = parseVatChuaSignedInput(req.body || {});
            assertVatChuaSignedInput(parsedVatChua);
        } catch (vatChuaInputError) {
            return res.status(400).json({ success: false, message: vatChuaInputError.message });
        }
        if (parsedVatChua.vatChuaId && parsedVatChua.qty !== 0) {
            if (!storeId) {
                return res.status(400).json({ success: false, message: 'Thiếu cửa hàng để ghi nhận vật chứa' });
            }
            const vatChuaRow = await VatChua.findOne({
                _id: parsedVatChua.vatChuaId,
                cua_hang_id: storeId,
                trang_thai: 'active'
            }).lean();
            if (!vatChuaRow) {
                return res.status(400).json({ success: false, message: 'Vật chứa không hợp lệ hoặc đã ngưng sử dụng' });
            }
            if (parsedVatChua.qty < 0) {
                const tonVatChua = Math.max(0, Number(vatChuaRow.so_luong_ton || 0));
                const exportQty = Math.abs(parsedVatChua.qty);
                if (tonVatChua < exportQty) {
                    return res.status(400).json({
                        success: false,
                        message: 'Tồn vật chứa không đủ để xuất (cần ' + tonVatChua + ', cần ' + exportQty + ')'
                    });
                }
            }
        }
        const returnPayment = normalizeCustomerPaymentInput(Object.assign({}, req.body || {}, {
            khach_thanh_toan: req.body?.khach_thanh_toan_them
        }), { requirePayment: false });
        if (!returnPayment.valid) {
            return res.status(400).json({ success: false, message: returnPayment.errors.join('. ') });
        }
        const paymentBooks = resolvePaymentBooksFromBody(req.body || {});
        const cashBookId = paymentBooks.so_quy_tien_mat_id || paymentBooks.so_quy_id || resolveCashBookIdFromBody(req.body || {});
        const bankBookId = paymentBooks.so_quy_chuyen_khoan_id;
        const refundCashBookId = paymentBooks.so_quy_tien_mat_id
            || (isPaymentBookObjectId(req.body?.refund_so_quy_id) ? String(req.body.refund_so_quy_id).trim() : '')
            || paymentBooks.so_quy_chuyen_khoan_id
            || resolveCashBookIdFromBody({
                so_quy_id: req.body?.refund_so_quy_id || req.body?.refundCashBookId || req.body?.refund_cash_book_id || cashBookId
            });
        const returnPaymentMethod = normalizePaymentMethodValue(
            req.body?.phuong_thuc_thanh_toan || req.body?.payment_method || req.body?.paymentMethod
        );
        let paid = 0;
        let debt = 0;
        let refund = 0;
        if (chenhLech > 0) {
            const legacyPaid = Math.max(Number(khach_thanh_toan_them || 0), 0);
            paid = Math.min(returnPayment.thuc_thu > 0 ? returnPayment.thuc_thu : legacyPaid, chenhLech);
            debt = Math.max(chenhLech - paid, 0);
            if (paid > 0) {
                const bookErrors = validatePaymentBooksForCustomer(returnPayment, paymentBooks);
                if (bookErrors.length) {
                    return res.status(400).json({ success: false, message: bookErrors[0] });
                }
            }
        } else if (chenhLech < 0) {
            refund = Math.abs(chenhLech);
            if (refund > 0) {
                const hasSplitPayout = returnPayment.thuc_thu > 0
                    || returnPayment.tien_mat > 0
                    || returnPayment.chuyen_khoan > 0;
                if (hasSplitPayout) {
                    const bookErrors = validatePaymentBooksForCustomer(returnPayment, paymentBooks);
                    if (bookErrors.length) {
                        return res.status(400).json({ success: false, message: bookErrors[0] });
                    }
                } else if (!refundCashBookId) {
                    return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ để hoàn tiền trả hàng.' });
                }
            }
        }
        if ((paid > 0 || refund > 0) && !storeId) {
            return res.status(400).json({ success: false, message: 'Thiếu cửa hàng để ghi sổ quỹ thu/chi.' });
        }
        const count = await PhieuTraHang.countDocuments();
        const ma_phieu_tra = 'TH' + String(count + 1).padStart(6, '0');
        if (receiveMethod === 'lay_tai_nha' && !cleanSenderName) {
            const customer = await KhachHang.findById(khach_hang_id || invoice?.khach_hang_id).select('ten_khach_hang').lean();
            cleanSenderName = customer?.ten_khach_hang || '';
            if (!cleanSenderName) {
                return res.status(400).json({ success: false, message: 'Vui lòng nhập tên người gửi trả hàng.' });
            }
        }

        const returnSlip = await PhieuTraHang.create({
            ma_phieu_tra,
            ngay_tra: new Date(),
            tong_tien_tra: canTraKhach,
            tong_tien_hang_tra: tongTienHangTra,
            tong_tien_hang_doi: tongTienHangDoi,
            chenh_lech: chenhLech,
            giam_gia: discountValue,
            kieu_giam_gia: discountType,
            phi_tra_hang: returnFeeValue,
            khach_can_tra_them: khachCanTraThem,
            can_tra_khach: canTraKhach,
            ly_do: String(ly_do || '').trim() || (cleanExchangeItems.length ? 'Khách đổi hàng' : 'Khách trả hàng'),
            trang_thai: 'completed',
            ghi_chu,
            hinh_thuc_nhan_hang_tra: receiveMethod,
            van_don_id: null,
            doi_tac_giao_hang_id: receiveMethod === 'tai_quay' ? null : (doi_tac_giao_hang_id || null),
            dia_chi_lay_hang: cleanPickupAddress,
            ten_nguoi_gui_tra: cleanSenderName,
            sdt_nguoi_gui_tra: cleanSenderPhone,
            phi_lay_hang_tra: cleanPickupFee,
            nguoi_tra_phi_lay_hang: pickupFeePayer,
            ma_van_don_tra_hang: cleanReturnTrackingCode,
            ghi_chu_van_chuyen_tra: cleanReturnShippingNote,
            cua_hang_id: invoice?.cua_hang_id || warehouse.cua_hang_id || null,
            kho_id: warehouseId,
            hoa_don_id: hoa_don_id || null,
            khach_hang_id: khach_hang_id || null,
            nguoi_tao_id: req.user?._id
        });

        for (const item of cleanItems) {
            const invoiceLineMeta = item.invoiceLine ? copyLineMetadata(item.invoiceLine) : copyLineMetadata(item);
            await CTPhieuTraHang.create({
                phieu_tra_hang_id: returnSlip._id,
                ct_hoa_don_id: item.ct_hoa_don_id || optionalLineObjectId(item.invoiceLine?._id),
                hang_hoa_id: item.hang_hoa_id,
                lo_hang_id: item.lo_hang_id || undefined,
                gia_tri_thuoc_tinh_id: invoiceLineMeta.gia_tri_thuoc_tinh_id,
                ten_quy_cach: invoiceLineMeta.ten_quy_cach,
                ten_thuoc_tinh: invoiceLineMeta.ten_thuoc_tinh,
                don_vi_tinh_id: invoiceLineMeta.don_vi_tinh_id,
                ma_hang_snapshot: invoiceLineMeta.ma_hang_snapshot,
                ten_hang_snapshot: invoiceLineMeta.ten_hang_snapshot,
                don_vi_tinh_snapshot: invoiceLineMeta.don_vi_tinh_snapshot,
                loai_dong: 'hang_tra',
                so_luong: item.so_luong,
                don_gia: item.don_gia,
                thanh_tien: item.so_luong * item.don_gia,
                ghi_chu: invoiceLineMeta.ghi_chu
            });
            await restoreStockLine(warehouseId, buildReturnStockLine(item, invoiceLineMeta), {
                nguoi_tao_id: req.user?._id,
                loai_phieu: 'tra_hang',
                ma_phieu: ma_phieu_tra,
                ghi_chu: `Khách trả hàng ${ma_phieu_tra}`
            });
        }

        for (const item of cleanExchangeItems) {
            const tenQuyCach = String(item.ten_quy_cach || item.ten_thuoc_tinh || '').trim();
            await truTonKho({
                kho_id: warehouseId,
                hang_hoa_id: item.hang_hoa_id,
                lo_hang_id: item.lo_hang_id || undefined,
                gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id || undefined,
                ten_quy_cach: tenQuyCach || undefined,
                ten_thuoc_tinh: String(item.ten_thuoc_tinh || tenQuyCach || '').trim() || undefined,
                sync_quy_cach: Boolean(tenQuyCach || item.gia_tri_thuoc_tinh_id),
                so_luong: item.so_luong,
                nguoi_tao_id: req.user?._id,
                loai_phieu: 'ban_hang',
                ma_phieu: ma_phieu_tra,
                ghi_chu: `Đổi hàng ${ma_phieu_tra}`
            });
            await CTPhieuTraHang.create({
                phieu_tra_hang_id: returnSlip._id,
                hang_hoa_id: item.hang_hoa_id,
                lo_hang_id: item.lo_hang_id || undefined,
                gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id || undefined,
                ten_quy_cach: tenQuyCach,
                ten_thuoc_tinh: String(item.ten_thuoc_tinh || tenQuyCach || '').trim(),
                loai_dong: 'hang_doi',
                so_luong: item.so_luong,
                don_gia: item.don_gia,
                thanh_tien: item.so_luong * item.don_gia
            });
        }

        if (chenhLech > 0) {
            if (paid > 0) {
                const tienMatThu = Math.min(returnPayment.tien_mat, paid);
                const chuyenKhoanThu = Math.min(returnPayment.chuyen_khoan, Math.max(0, paid - tienMatThu));
                const useSplit = tienMatThu > 0 || chuyenKhoanThu > 0;
                await taoPhieuThuChi({
                    loai_phieu: 'thu',
                    loai_thu_chi: 'Thu tien doi hang',
                    gia_tri: paid,
                    ngay_lap: returnSlip.ngay_tra || new Date(),
                    so_quy_id: cashBookId || bankBookId,
                    so_quy_tien_mat_id: cashBookId,
                    so_quy_chuyen_khoan_id: bankBookId,
                    payment_v2: useSplit && Boolean(cashBookId || bankBookId),
                    chi_tiet_thanh_toan: useSplit ? {
                        tien_mat: tienMatThu,
                        chuyen_khoan: chuyenKhoanThu,
                        tien_tra_khach: 0,
                        so_quy_tien_mat_id: cashBookId,
                        so_quy_chuyen_khoan_id: bankBookId
                    } : undefined,
                    cua_hang_id: storeId,
                    nguoi_tao_id: req.user?._id,
                    khach_hang_id: customerId || undefined,
                    hoa_don_id: hoa_don_id || undefined,
                    phieu_tra_hang_id: returnSlip._id,
                    ma_chung_tu_goc: ma_phieu_tra,
                    doi_tuong: customerId ? undefined : 'Khách lẻ',
                    nhom_doi_tuong: 'khach_hang',
                    phuong_thuc_thanh_toan: useSplit
                        ? (tienMatThu > 0 && chuyenKhoanThu > 0 ? 'tien_mat_chuyen_khoan' : (chuyenKhoanThu > 0 ? 'chuyen_khoan' : 'tien_mat'))
                        : returnPaymentMethod,
                    hach_toan: false
                });
            }
            if (debt > 0 && customerId) {
                await CongNoKhachHang.create({
                    khach_hang_id: customerId,
                    cua_hang_id: storeId || undefined,
                    hoa_don_id: hoa_don_id || undefined,
                    phieu_tra_hang_id: returnSlip._id,
                    so_tien: debt,
                    loai: 'tang_no',
                    ghi_chu: `Cộng nợ đổi hàng ${ma_phieu_tra}`,
                    ngay: new Date()
                });
                const customer = await KhachHang.findById(customerId).select('tong_no').lean();
                if (customer && typeof customer.tong_no === 'number') {
                    await KhachHang.updateOne({ _id: customerId }, { $inc: { tong_no: debt } });
                }
            }
        } else if (chenhLech < 0) {
            await recordSalesReturnRefundReceipt({
                refund,
                returnPayment,
                paymentBooks,
                refundCashBookId,
                returnPaymentMethod,
                returnSlip,
                ma_phieu_tra,
                storeId,
                customerId,
                hoa_don_id,
                userId: req.user?._id
            });
        }

        if (parsedVatChua.vatChuaId && parsedVatChua.qty !== 0) {
            let customerName = '';
            if (customerId) {
                const customer = await KhachHang.findById(customerId).select('ten_khach_hang').lean();
                customerName = customer?.ten_khach_hang || '';
            }
            try {
                if (parsedVatChua.qty > 0) {
                    await importVatChuaWithSalesReturn(returnSlip, {
                        vat_chua_id: parsedVatChua.vatChuaId,
                        vat_chua_so_luong: parsedVatChua.qty,
                        khach_hang_ten: customerName
                    });
                } else {
                    await exportVatChuaWithSalesReturn(returnSlip, {
                        vat_chua_id: parsedVatChua.vatChuaId,
                        vat_chua_so_luong: Math.abs(parsedVatChua.qty),
                        khach_hang_ten: customerName
                    });
                }
            } catch (vatChuaError) {
                return res.status(400).json({
                    success: false,
                    message: vatChuaError.message || 'Không ghi nhận vật chưa được'
                });
            }
        }

        res.json({ success: true, message: ' tạo phiếu trả hàng', ma_phieu_tra, id: returnSlip._id, print_url: '/chung-tu-kho/tra-hang-ban/' + returnSlip._id });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Không tạo được phiếu trả hàng' });
    }
};


exports.patchTraHangId = async (req, res, next) => {
    try {
        const slip = await PhieuTraHang.findOne(activeReturnDataFilter({ _id: req.params.id }));
        if (!slip) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu trả hàng' });
        if (slip.trang_thai === 'cancelled') {
            return res.status(400).json({ success: false, message: 'Phiếu đã hủy, không thể sửa' });
        }
        if (req.body?.ghi_chu !== undefined) slip.ghi_chu = String(req.body.ghi_chu || '').trim();
        await slip.save();
        res.json({ success: true, message: 'Đã lưu phiếu trả hàng' });
    } catch (error) {
        next(error);
    }
};


exports.postTraHangIdCancel = async (req, res, next) => {
    try {
        const storeId = await resolveStoreId(req);
        const result = await cancelReturnSlip(req.params.id, storeId, req.user && req.user._id);
        return res.json({
            success: true,
            message: result && result.already_cancelled ? 'Phiếu đã hủy' : 'Đã hủy phiếu trả hàng',
            data: result
        });
        const slip = await PhieuTraHang.findOne(activeReturnDataFilter({ _id: req.params.id }));
        if (!slip) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu trả hàng' });
        if (slip.trang_thai === 'cancelled') {
            return res.json({ success: true, message: 'Phiếu đã hủy' });
        }

        const items = await CTPhieuTraHang.find({ phieu_tra_hang_id: slip._id }).lean();
        const khoId = slip.kho_id;
        const maPhieu = slip.ma_phieu_tra || String(slip._id);

        for (const item of items) {
            const qty = Number(item.so_luong || 0);
            if (!qty || !item.hang_hoa_id) continue;
            const stockLine = {
                hang_hoa_id: item.hang_hoa_id,
                lo_hang_id: item.lo_hang_id || undefined,
                so_luong: qty,
                gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id,
                ten_quy_cach: item.ten_quy_cach || item.ten_thuoc_tinh || '',
                ten_thuoc_tinh: item.ten_thuoc_tinh || item.ten_quy_cach || '',
                lot_allocations: item.lot_allocations
            };
            const stockOptions = {
                nguoi_tao_id: req.user?._id,
                loai_phieu: 'tra_hang',
                ma_phieu: maPhieu,
                ghi_chu: item.loai_dong === 'hang_doi' ? `Huy doi hang ${maPhieu}` : `Huy tra hang ${maPhieu}`
            };
            if (item.loai_dong === 'hang_doi') {
                await restoreStockLine(khoId, stockLine, stockOptions);
            } else {
                await deductStockLine(khoId, stockLine, stockOptions);
            }
        }

        const receipts = await PhieuThuChi.find({ ma_chung_tu_goc: maPhieu, trang_thai: { $ne: 'cancelled' } });
        for (const receipt of receipts) {
            receipt.trang_thai = 'cancelled';
            await receipt.save();
        }

        const debtRows = await CongNoKhachHang.find({
            $or: [
                { hoa_don_id: slip.hoa_don_id || undefined },
                { ghi_chu: { $regex: maPhieu.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } }
            ]
        }).lean();
        let debtDelta = 0;
        for (const row of debtRows) {
            const amount = Math.abs(Number(row.so_tien || 0));
            if (row.loai === 'tang_no') debtDelta -= amount;
            else if (row.loai === 'giam_no') debtDelta += amount;
        }
        if (slip.khach_hang_id && debtDelta !== 0) {
            await KhachHang.updateOne({ _id: slip.khach_hang_id }, { $inc: { tong_no: debtDelta } });
        }

        slip.trang_thai = 'cancelled';
        await slip.save();

        const cancelStoreId = slip.cua_hang_id || (khoId ? (await Kho.findById(khoId).select('cua_hang_id').lean())?.cua_hang_id : null);
        if (cancelStoreId) {
            await cancelNhapVatChuaBySource(cancelStoreId, 'tra_hang_ban', slip._id);
            await cancelXuatVatChuaBySource(cancelStoreId, 'tra_hang_ban', slip._id);
        }

        res.json({ success: true, message: 'Đã hủy phiếu trả hàng' });
    } catch (error) {
        next(error);
    }
};


