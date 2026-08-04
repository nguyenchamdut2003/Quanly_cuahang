const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
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
    XuatVatChua
} = require('../../../models/kiot.model');
const { congTonKho, truTonKho } = require('../../../services/kho.service');
const { tinhPhiGiaoHang, luuPhiVanChuyenKhachHang } = require('../../../services/phiGiaoHang.service');
const { taoPhieuThuChi, taoPhieuThuKhachHang } = require('../../../services/soQuy.service');
const {
    DELIVERY_PARTNER_EXPORT_COLUMNS,
    DELIVERY_PARTNER_STATUS_MAP,
    applyDeliveryPartnerWorksheetFormat,
    buildDeliveryPartnerExportRow,
    loadDeliveryPartnerExportData,
    sendDeliveryPartnerWorkbook
} = require('../../dotacgiaohangcontroller/export.helper');
const {
    normalizeCustomerPaymentInput,
    computeNetPaidFromReceiptRows,
    receiptRowsForNetPaidFilter
} = require('../../../utils/customerPayment');
const { createCustomerDebtTransaction } = require('../../../services/customerDebt.service');
const {
    buildVariantKey,
    buildLotKey,
    getReservedQuantitiesForSale
} = require('../../../services/availability.service');
const { normalizeAddress } = require('../../../utils/address');
const { resolveStoreId } = require('../../../utils/storeScope');
const { resolveCashBookForPayment } = require('../../../services/paymentCashBook.service');
const { resolveSalePrice, normalizeUnitPrice } = require('../../../services/salePrice.service');
const { parseVatChuaImportInput, parseVatChuaSignedInput, assertVatChuaImportInput, assertVatChuaSignedInput, importVatChuaWithSalesReturn, cancelNhapVatChuaBySource } = require('../../../services/vatChuaImport.service');
const { exportVatChuaWithOrderDelivery, exportVatChuaWithInvoice, exportVatChuaWithSalesReturn, cancelXuatVatChuaBySource } = require('../../../services/vatChuaExport.service');
const { loadOrderLinkedVatChuaLines, loadInvoiceLinkedVatChuaLines, loadSalesReturnLinkedNhapVatChuaLines } = require('../../../services/vatChuaDetail.service');

function disabledTrashOperation() {
    const error = new Error('Chuc nang xoa/dua vao thung rac da duoc tat.');
    error.statusCode = 410;
    throw error;
}

const previewOrderTrash = disabledTrashOperation;
const moveOrdersToTrash = disabledTrashOperation;
const previewInvoiceTrash = disabledTrashOperation;
const moveInvoicesToTrash = disabledTrashOperation;
const previewReturnTrash = disabledTrashOperation;
const moveReturnsToTrash = disabledTrashOperation;
const cancelReturnSlip = disabledTrashOperation;

async function resolveOrderLineUnitPrice(item, product, bangGiaId, storeId) {
    const resolved = await resolveSalePrice({
        hang_hoa_id: product._id,
        bang_gia_id: bangGiaId,
        product,
        cua_hang_id: storeId,
        lo_hang_id: item.lo_hang_id,
        gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id,
        ten_quy_cach: item.ten_quy_cach || item.ten_thuoc_tinh,
        loai_gia_ban: item.loai_gia_ban
    });

    const manualRaw = Number(item.don_gia_ban ?? item.don_gia);
    const hasManual = Number.isFinite(manualRaw) && manualRaw >= 0
        && item.don_gia_ban !== ''
        && item.don_gia_ban != null;

    if (resolved.cho_phep_sua_gia === false) {
        if (hasManual && normalizeUnitPrice(manualRaw) !== normalizeUnitPrice(resolved.gia_ban)) {
            return {
                error: 'Không được thay đổi đơn giá cho dòng hàng này (dòng khóa sửa giá).'
            };
        }
        return { unitPrice: resolved.gia_ban, resolved };
    }

    return {
        unitPrice: hasManual ? normalizeUnitPrice(manualRaw) : resolved.gia_ban,
        resolved
    };
}



const CHO_PHEP_DAT_AM_KHO = true;

const ORDER_EXPORT_STATUS_MAP = {
    draft: 'Phiếu tạm',
    shipping: 'Đang giao hàng',
    completed: 'Hoàn thành',
    cancelled: 'Đã hủy',
    merged: 'Đã gộp'
};

const ORDER_EXPORT_DELIVERY_STATUS_MAP = {
    chua_giao: 'Chưa giao',
    giao_mot_phan: 'Giao một phần',
    giao_thieu: 'Giao thiếu',
    giao_du: 'Giao đủ'
};

const ORDER_EXPORT_LINE_DELIVERY_STATUS_MAP = {
    chua_giao: 'Chưa giao',
    giao_thieu: 'Giao thiếu',
    giao_du: 'Giao đủ'
};

const ORDER_EXPORT_COLUMN_DEFS = [
    { group: 'don_hang', key: 'ma_don_hang', header: 'Mã đơn hàng', default: true },
    { group: 'don_hang', key: 'ngay_dat', header: 'Ngày đặt', default: true },
    { group: 'don_hang', key: 'ngay_giao_thuc_te', header: 'Ngày giao thực tế' },
    { group: 'don_hang', key: 'cua_hang', header: 'Cửa hàng', default: true },
    { group: 'don_hang', key: 'kho', header: 'Kho', default: true },
    { group: 'don_hang', key: 'bang_gia', header: 'Bảng giá', default: true },
    { group: 'don_hang', key: 'nguoi_tao', header: 'Người tạo', default: true },
    { group: 'don_hang', key: 'trang_thai', header: 'Trạng thái đơn', default: true },
    { group: 'don_hang', key: 'trang_thai_giao_hang', header: 'Trạng thái giao hàng', default: true },
    { group: 'don_hang', key: 'ghi_chu', header: 'Ghi chú' },
    { group: 'khach_nhan', key: 'ma_khach_hang', header: 'Mã khách hàng', default: true },
    { group: 'khach_nhan', key: 'ten_khach_hang', header: 'Tên khách hàng', default: true },
    { group: 'khach_nhan', key: 'ten_nguoi_nhan', header: 'Người nhận' },
    { group: 'khach_nhan', key: 'sdt_nguoi_nhan', header: 'SĐT người nhận', default: true },
    { group: 'khach_nhan', key: 'dia_chi_nhan', header: 'Địa chỉ nhận hàng', default: true },
    { group: 'khach_nhan', key: 'doi_tac_giao_hang', header: 'Đối tác giao hàng' },
    { group: 'khach_nhan', key: 'nguoi_tra_phi_giao_hang', header: 'Người trả phí giao hàng' },
    { group: 'thanh_toan', key: 'tong_so_luong_dat', header: 'Tổng SL đặt', style: { numFmt: '#,##0.##' } },
    { group: 'thanh_toan', key: 'tong_tien_hang', header: 'Tổng tiền hàng', style: { numFmt: '#,##0' }, default: true },
    { group: 'thanh_toan', key: 'giam_gia', header: 'Giảm giá', style: { numFmt: '#,##0.##' }, default: true },
    { group: 'thanh_toan', key: 'kieu_giam_gia', header: 'Kiểu giảm giá' },
    { group: 'thanh_toan', key: 'phi_giao_hang', header: 'Phí giao hàng', style: { numFmt: '#,##0' } },
    { group: 'thanh_toan', key: 'khach_can_tra', header: 'Khách cần trả', style: { numFmt: '#,##0' }, default: true },
    { group: 'thanh_toan', key: 'khach_thanh_toan', header: 'Khách đã trả', style: { numFmt: '#,##0' }, default: true },
    { group: 'thanh_toan', key: 'tien_thua_tra_khach', header: 'Tiền thừa trả khách', style: { numFmt: '#,##0' } },
    { group: 'thanh_toan', key: 'cod_enabled', header: 'COD' },
    { group: 'thanh_toan', key: 'cod_amount', header: 'Số tiền COD', style: { numFmt: '#,##0' } },
    { group: 'chi_tiet', key: 'ma_hang', header: 'Mã hàng', default: true },
    { group: 'chi_tiet', key: 'ten_hang', header: 'Tên hàng', default: true },
    { group: 'chi_tiet', key: 'lo_hang', header: 'Loại hàng' },
    { group: 'chi_tiet', key: 'so_luong_dat', header: 'SL đặt', style: { numFmt: '#,##0.##' }, default: true },
    { group: 'chi_tiet', key: 'so_luong_xac_nhan', header: 'SL xác nhận', style: { numFmt: '#,##0.##' } },
    { group: 'chi_tiet', key: 'so_luong_da_giao', header: 'SL đã giao', style: { numFmt: '#,##0.##' }, default: true },
    { group: 'chi_tiet', key: 'so_luong_con_thieu', header: 'SL còn thiếu', style: { numFmt: '#,##0.##' } },
    { group: 'chi_tiet', key: 'trang_thai_giao', header: 'Trạng thái giao hàng', style: { numFmt: '#,##0' } },
    { group: 'chi_tiet', key: 'don_gia_ban', header: 'Đơn giá bán', style: { numFmt: '#,##0' }, default: true },
    { group: 'chi_tiet', key: 'chiet_khau', header: 'Chiết khấu', style: { numFmt: '#,##0.##' } },
    { group: 'chi_tiet', key: 'kieu_chiet_khau', header: 'Kiểu chiết khấu' },
    { group: 'chi_tiet', key: 'thanh_tien', header: 'Thành tiền', style: { numFmt: '#,##0' }, default: true }
];

const ORDER_EXPORT_COLUMN_MAP = ORDER_EXPORT_COLUMN_DEFS.reduce((map, item) => {
    map[item.key] = item;
    return map;
}, {});

const ORDER_EXPORT_COLUMN_GROUPS = [
    { id: 'don_hang', title: 'Thông tin đơn hàng' },
    { id: 'khach_nhan', title: 'Khách hàng & nhận hàng' },
    { id: 'thanh_toan', title: 'Thanh toán' },
    { id: 'chi_tiet', title: 'Chi tiết đặt hàng' }
].map(group => ({
    ...group,
    columns: ORDER_EXPORT_COLUMN_DEFS.filter(item => item.group === group.id)
}));

const ORDER_EXPORT_COLUMNS = ORDER_EXPORT_COLUMN_DEFS.map(item => ({
    header: item.header,
    key: item.key,
    ...(item.style ? { style: item.style } : {})
}));

function getOrderExportColumnGroupsForView() {
    return ORDER_EXPORT_COLUMN_GROUPS.map(group => ({
        id: group.id,
        title: group.title,
        columns: group.columns.map(col => ({
            key: col.key,
            header: col.header,
            default: !!col.default
        }))
    }));
}

function resolveOrderExportColumns(rawKeys) {
    if (!rawKeys) return ORDER_EXPORT_COLUMNS;
    const keys = Array.isArray(rawKeys) ? rawKeys : [rawKeys];
    const selected = keys
        .map(key => String(key || '').trim())
        .filter(key => ORDER_EXPORT_COLUMN_MAP[key]);
    if (!selected.length) return [];
    return selected.map(key => {
        const def = ORDER_EXPORT_COLUMN_MAP[key];
        return {
            header: def.header,
            key: def.key,
            ...(def.style ? { style: def.style } : {})
        };
    });
}

function pickOrderExportRowValues(row, columns) {
    const picked = {};
    columns.forEach(column => {
        picked[column.key] = row[column.key];
    });
    return picked;
}

const INVOICE_EXPORT_STATUS_MAP = {
    processing: 'Đang xử lý',
    completed: 'Hoàn thành',
    failed: 'Không giao được',
    cancelled: 'Đã hủy',
    paid: 'Đã thanh toán',
    partial: 'Thanh toán một phần',
    unpaid: 'Chưa thanh toán',
    draft: 'Đang xử lý',
    shipping: 'Đang xử lý',
    done: 'Hoàn thành'
};

const INVOICE_EXPORT_COLUMNS = [
    { header: 'Mã hóa đơn', key: 'ma_hoa_don' },
    { header: 'Thời gian bán', key: 'thoi_gian_ban' },
    { header: 'Mã đơn hàng', key: 'ma_don_hang' },
    { header: 'Khách hàng', key: 'khach_hang' },
    { header: 'Điện thoại', key: 'dien_thoai' },
    { header: 'Địa chỉ', key: 'dia_chi' },
    { header: 'Kho', key: 'kho' },
    { header: 'Bảng giá', key: 'bang_gia' },
    { header: 'Nhân viên bán hàng', key: 'nhan_vien_ban_hang' },
    { header: 'Tổng tiền hàng', key: 'tong_tien_hang', style: { numFmt: '#,##0' } },
    { header: 'Giảm giá', key: 'giam_gia', style: { numFmt: '#,##0.##' } },
    { header: 'Phí giao hàng', key: 'phi_giao_hang', style: { numFmt: '#,##0' } },
    { header: 'Khách cần trả', key: 'khach_can_tra', style: { numFmt: '#,##0' } },
    { header: 'Khách đã trả', key: 'khach_da_tra', style: { numFmt: '#,##0' } },
    { header: 'Tiền thừa trả khách', key: 'tien_thua_tra_khach', style: { numFmt: '#,##0' } },
    { header: 'Cộng nợ', key: 'cong_no', style: { numFmt: '#,##0' } },
    { header: 'Phương thức thanh toán', key: 'phuong_thuc_thanh_toan' },
    { header: 'COD', key: 'cod' },
    { header: 'Trạng thái hóa đơn', key: 'trang_thai_hoa_don' },
    { header: 'Ghi chú', key: 'ghi_chu' },
    { header: 'Mã hàng', key: 'ma_hang' },
    { header: 'Tên hàng', key: 'ten_hang' },
    { header: 'Thương hiệu', key: 'thuong_hieu' },
    { header: 'Nhóm hàng', key: 'nhom_hang' },
    { header: 'Đơn vị tính', key: 'don_vi_tinh' },
    { header: 'Loại hàng', key: 'lo_hang' },
    { header: 'Số lượng', key: 'so_luong', style: { numFmt: '#,##0.##' } },
    { header: 'Đơn giá', key: 'don_gia', style: { numFmt: '#,##0' } },
    { header: 'Chiết khấu', key: 'chiet_khau', style: { numFmt: '#,##0.##' } },
    { header: 'Thành tiền', key: 'thanh_tien', style: { numFmt: '#,##0' } },
    { header: 'Giá vốn', key: 'gia_von', style: { numFmt: '#,##0' } }
];

const RETURN_EXPORT_STATUS_MAP = {
    completed: ' hoàn thành',
    cancelled: ' đã hủy',
    draft: 'Phiếu tạm',
    pending: 'Đang xử lý'
};

const RETURN_EXPORT_LINE_TYPE_MAP = {
    hang_tra: 'Hàng trả',
    hang_doi: 'Hàng đổi'
};

const RETURN_EXPORT_COLUMNS = [
    { header: 'Mã phiếu trả', key: 'ma_phieu_tra' },
    { header: 'Thời gian trả', key: 'thoi_gian_tra' },
    { header: 'Mã hóa đơn', key: 'ma_hoa_don' },
    { header: 'Mã đơn hàng', key: 'ma_don_hang' },
    { header: 'Khách hàng', key: 'khach_hang' },
    { header: 'Điện thoại', key: 'dien_thoai' },
    { header: 'Địa chỉ', key: 'dia_chi' },
    { header: 'Kho', key: 'kho' },
    { header: 'Người tạo', key: 'nguoi_tao' },
    { header: 'Tổng tiền hàng trả', key: 'tong_tien_hang_tra', style: { numFmt: '#,##0' } },
    { header: 'Tổng tiền hàng đổi', key: 'tong_tien_hang_doi', style: { numFmt: '#,##0' } },
    { header: 'Chênh lệch', key: 'chenh_lech', style: { numFmt: '#,##0' } },
    { header: 'Giảm giá', key: 'giam_gia', style: { numFmt: '#,##0' } },
    { header: 'Phí trả hàng', key: 'phi_tra_hang', style: { numFmt: '#,##0' } },
    { header: 'Cần trả khách', key: 'can_tra_khach', style: { numFmt: '#,##0' } },
    { header: 'Khách cần trả thêm', key: 'khach_can_tra_them', style: { numFmt: '#,##0' } },
    { header: 'Lý do', key: 'ly_do' },
    { header: 'Ghi chú', key: 'ghi_chu' },
    { header: 'Trạng thái', key: 'trang_thai' },
    { header: 'Loại dạng', key: 'loai_dong' },
    { header: 'Mã hàng', key: 'ma_hang' },
    { header: 'Tên hàng', key: 'ten_hang' },
    { header: 'Thương hiệu', key: 'thuong_hieu' },
    { header: 'Nhóm hàng', key: 'nhom_hang' },
    { header: 'Đơn vị tính', key: 'don_vi_tinh' },
    { header: 'Loại hàng', key: 'lo_hang' },
    { header: 'Số lượng', key: 'so_luong', style: { numFmt: '#,##0.##' } },
    { header: 'Đơn giá', key: 'don_gia', style: { numFmt: '#,##0' } },
    { header: 'Thành tiền', key: 'thanh_tien', style: { numFmt: '#,##0' } }
];

const SHIPPING_PRICE_TYPE_MAP = {
    theo_km: 'Theo km',
    co_dinh: 'Cố định',
    theo_tuyen: 'Theo tuyến'
};

const SHIPMENT_COD_STATUS_MAP = {
    khong_cod: 'Không COD',
    chua_thu: 'Chưa thu',
    da_thu: 'Đã thu',
    da_doi_soat: 'Đã đối soát'
};

const SHIPPING_FEE_PAYER_MAP = {
    khach: 'Khách hàng',
    cua_hang: 'Cửa hàng'
};

const SHIPMENT_EXPORT_COLUMNS = [
    { header: 'Mã vận đơn', key: 'ma_van_don' },
    { header: 'Mã đơn hàng', key: 'ma_don_hang' },
    { header: 'Mã hóa đơn', key: 'ma_hoa_don' },
    { header: 'Khách hàng', key: 'khach_hang' },
    { header: 'Người nhận', key: 'nguoi_nhan' },
    { header: 'Điện thoại người nhận', key: 'dien_thoai_nguoi_nhan' },
    { header: 'Địa chỉ nhận', key: 'dia_chi_nhan' },
    { header: 'Đối tác giao hàng', key: 'doi_tac_giao_hang' },
    { header: 'Phí giao hàng', key: 'phi_giao_hang', style: { numFmt: '#,##0' } },
    { header: 'Đơn giá vận chuyển áp dụng', key: 'don_gia_van_chuyen_ap_dung', style: { numFmt: '#,##0' } },
    { header: 'Số lượng tính phí', key: 'so_luong_tinh_phi', style: { numFmt: '#,##0.##' } },
    { header: 'Thành tiền vận chuyển', key: 'thanh_tien_van_chuyen', style: { numFmt: '#,##0' } },
    { header: 'Người trả phí giao hàng', key: 'nguoi_tra_phi_giao_hang' },
    { header: 'COD', key: 'cod' },
    { header: 'Số tiền COD', key: 'so_tien_cod', style: { numFmt: '#,##0' } },
    { header: 'Trạng thái COD', key: 'trang_thai_cod' },
    { header: 'Trạng thái vận đơn', key: 'trang_thai_van_don' },
    { header: 'Ghi chú', key: 'ghi_chu' },
    { header: 'Ngày tạo', key: 'ngay_tao' },
    { header: 'Ngày cập nhật', key: 'ngay_cap_nhat' }
];

function parseItems(rawItems) {
    if (Array.isArray(rawItems)) return rawItems;
    if (typeof rawItems === 'string' && rawItems.trim() !== '') {
        try {
            const parsed = JSON.parse(rawItems);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    }
    return [];
}

function optionalLineObjectId(value) {
    const id = String(value?._id || value || '').trim();
    return /^[0-9a-fA-F]{24}$/.test(id) ? id : null;
}

function copyLineMetadata(row = {}) {
    return {
        gia_tri_thuoc_tinh_id: optionalLineObjectId(row.gia_tri_thuoc_tinh_id),
        ten_quy_cach: String(row.ten_quy_cach || row.ten_thuoc_tinh || '').trim(),
        ten_thuoc_tinh: String(row.ten_thuoc_tinh || row.ten_quy_cach || '').trim(),
        don_vi_tinh_id: optionalLineObjectId(row.don_vi_tinh_id),
        ma_hang_snapshot: String(row.ma_hang_snapshot || ''),
        ten_hang_snapshot: String(row.ten_hang_snapshot || ''),
        don_vi_tinh_snapshot: String(row.don_vi_tinh_snapshot || ''),
        ghi_chu: String(row.ghi_chu || '')
    };
}

function legacyReturnLineKey(row = {}) {
    const productId = String(row.hang_hoa_id?._id || row.hang_hoa_id || '');
    const lotId = String(row.lo_hang_id?._id || row.lo_hang_id || '');
    return `${productId}::${lotId}`;
}

function buildOrderFilter(query = {}) {
    const filter = {};
    if (query.q && query.q.trim() !== '') {
        filter.ma_don_hang = { $regex: query.q.trim(), $options: 'i' };
    }
    const statuses = Array.isArray(query.trang_thai) ? query.trang_thai : (query.trang_thai ? [query.trang_thai] : []);
    const cleanStatuses = statuses.filter(item => item && item !== 'all');
    if (cleanStatuses.length) {
        filter.trang_thai = { $in: cleanStatuses };
    } else {
        filter.trang_thai = { $ne: 'merged' };
    }
    const dateFrom = query.date_from ? new Date(query.date_from + 'T00:00:00') : null;
    const dateTo = query.date_to ? new Date(query.date_to + 'T23:59:59') : null;
    if (query.time_type === 'this_month') {
        const now = new Date();
        filter.ngay_dat = { $gte: new Date(now.getFullYear(), now.getMonth(), 1), $lte: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59) };
    } else if (dateFrom || dateTo) {
        filter.ngay_dat = {};
        if (dateFrom && !Number.isNaN(dateFrom.getTime())) filter.ngay_dat.$gte = dateFrom;
        if (dateTo && !Number.isNaN(dateTo.getTime())) filter.ngay_dat.$lte = dateTo;
    }
    if (query.nguoi_tao && /^[0-9a-fA-F]{24}$/.test(query.nguoi_tao)) {
        filter.nguoi_tao_id = query.nguoi_tao;
    }
    const deletedGuard = {};
    if (!Object.keys(filter).length) return deletedGuard;
    return { $and: [filter, deletedGuard] };
}

function formatExportDate(value) {
    if (!value) return '';
    return new Date(value).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

function parseOrderDateInput(value) {
    if (!value) return new Date();
    const date = new Date(String(value).trim());
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

function exportUserName(user) {
    return user ? (user.ho_ten || user.username || user.email || '') : '';
}

function exportCustomerName(customer) {
    return customer ? (customer.ten_khach_hang || customer.ten_ca_nhan || customer.ten_cong_ty || customer.ma_khach_hang || '') : 'Khách hàng';
}

function exportCustomerPhone(customer, shipment) {
    return shipment?.sdt_nguoi_nhan || customer?.sdt || customer?.sdt2 || '';
}

function exportAddress(customer, shipment) {
    return shipment?.dia_chi_nhan || customer?.dia_chi_day_du || customer?.khu_vuc_giao_hang || '';
}

function exportLotName(lot) {
    return lot ? (lot.ten_lo || lot.ma_lo || '') : '';
}

function exportInvoiceLotName(detail) {
    const allocs = Array.isArray(detail?.lot_allocations)
        ? detail.lot_allocations.filter(row => Number(row.so_luong) > 0)
        : [];
    if (allocs.length) {
        return allocs.map(row => formatLotAllocationLabel(row)).join(', ');
    }
    return exportLotName(detail?.lo_hang_id);
}

function formatLotDisplay(lot) {
    if (!lot) return '';
    const label = lot.ten_lo || lot.ma_lo || '';
    const expiry = lot.han_su_dung
        ? 'HSD ' + new Date(lot.han_su_dung).toLocaleDateString('vi-VN')
        : '';
    return [label, expiry].filter(Boolean).join(' - ');
}

function formatLotAllocationLabel(alloc) {
    if (!alloc) return '';
    const name = alloc.ten_lo || alloc.ma_lo || '';
    const expiry = alloc.han_su_dung
        ? ' HSD ' + new Date(alloc.han_su_dung).toLocaleDateString('vi-VN')
        : '';
    return `${name}${expiry} - SL ${Number(alloc.so_luong || 0)}`;
}

function formatInvoiceLotText(item, product) {
    const allocs = Array.isArray(item.lot_allocations)
        ? item.lot_allocations.filter(row => Number(row.so_luong) > 0)
        : [];
    if (allocs.length) {
        return allocs.map(formatLotAllocationLabel).filter(Boolean).join(', ');
    }
    const lot = item.lo_hang_id;
    if (lot && typeof lot === 'object' && (lot.ten_lo || lot.ma_lo)) {
        return formatLotDisplay(lot);
    }
    if (product?.quan_ly_theo_lo === false) return 'Không có';
    return 'Không có';
}

function formatOrderLotText(item, product) {
    const lot = item.lo_hang_id;
    if (lot && typeof lot === 'object' && (lot.ten_lo || lot.ma_lo)) {
        return lot.ten_lo || lot.ma_lo || '';
    }
    if (product?.quan_ly_theo_lo) return 'Chưa chọn lô';
    return 'Không có';
}

function applyLotAllocationsToInvoiceLine(allocations) {
    const rows = Array.isArray(allocations)
        ? allocations.filter(row => Number(row.so_luong) > 0 && row.lo_hang_id)
        : [];
    return {
        lot_allocations: rows,
        lo_hang_id: rows.length === 1 ? rows[0].lo_hang_id : null
    };
}

async function deductStockForInvoiceLines({
    kho_id,
    ma_hoa_don,
    lineRefs = [],
    nguoi_tao_id,
    ghi_chu_prefix = 'Xuat kho HD'
} = {}) {
    const stockAppliedLines = [];
    for (const { invoiceLineId, item } of lineRefs) {
        const stockResult = await truTonKho({
            kho_id,
            hang_hoa_id: item.hang_hoa_id,
            lo_hang_id: item.lo_hang_id || undefined,
            ten_quy_cach: item.ten_quy_cach || item.ten_thuoc_tinh || '',
            gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id || undefined,
            sync_quy_cach: Boolean(item.gia_tri_thuoc_tinh_id || item.ten_quy_cach || item.ten_thuoc_tinh),
            so_luong: Number(item.so_luong || 0),
            nguoi_tao_id,
            loai_phieu: 'ban_hang',
            ma_phieu: ma_hoa_don,
            ghi_chu: `${ghi_chu_prefix} ${ma_hoa_don}`
        });
        const lotPatch = applyLotAllocationsToInvoiceLine(stockResult.allocations);
        if (invoiceLineId) {
            await CTHoaDonBanHang.updateOne({ _id: invoiceLineId }, { $set: lotPatch });
        }
        stockAppliedLines.push({
            hang_hoa_id: item.hang_hoa_id,
            lo_hang_id: lotPatch.lo_hang_id,
            lot_allocations: lotPatch.lot_allocations,
            gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id,
            ten_quy_cach: item.ten_quy_cach,
            ten_thuoc_tinh: item.ten_thuoc_tinh,
            so_luong: Number(item.so_luong || 0)
        });
    }
    return stockAppliedLines;
}

async function restoreStockLine(khoId, line, options = {}) {
    const qty = Number(line.so_luong || 0);
    if (!qty || !khoId || !line.hang_hoa_id) return;

    const base = {
        kho_id: khoId,
        hang_hoa_id: line.hang_hoa_id,
        ten_quy_cach: line.ten_quy_cach || line.ten_thuoc_tinh || '',
        gia_tri_thuoc_tinh_id: line.gia_tri_thuoc_tinh_id || undefined,
        sync_quy_cach: Boolean(line.gia_tri_thuoc_tinh_id || line.ten_quy_cach || line.ten_thuoc_tinh),
        nguoi_tao_id: options.nguoi_tao_id,
        loai_phieu: options.loai_phieu,
        ma_phieu: options.ma_phieu,
        ghi_chu: options.ghi_chu
    };

    const allocs = Array.isArray(line.lot_allocations)
        ? line.lot_allocations.filter(row => Number(row.so_luong) > 0 && row.lo_hang_id)
        : [];

    if (allocs.length) {
        for (const alloc of allocs) {
            await congTonKho({
                ...base,
                lo_hang_id: alloc.lo_hang_id,
                so_luong: Number(alloc.so_luong || 0)
            });
        }
        return;
    }

    await congTonKho({
        ...base,
        lo_hang_id: line.lo_hang_id || undefined,
        so_luong: qty
    });
}

async function deductStockLine(khoId, line, options = {}) {
    const qty = Number(line.so_luong || 0);
    if (!qty || !khoId || !line.hang_hoa_id) return;

    const base = {
        kho_id: khoId,
        hang_hoa_id: line.hang_hoa_id,
        ten_quy_cach: line.ten_quy_cach || line.ten_thuoc_tinh || '',
        gia_tri_thuoc_tinh_id: line.gia_tri_thuoc_tinh_id || undefined,
        sync_quy_cach: Boolean(line.gia_tri_thuoc_tinh_id || line.ten_quy_cach || line.ten_thuoc_tinh),
        nguoi_tao_id: options.nguoi_tao_id,
        loai_phieu: options.loai_phieu,
        ma_phieu: options.ma_phieu,
        ghi_chu: options.ghi_chu
    };

    const allocs = Array.isArray(line.lot_allocations)
        ? line.lot_allocations.filter(row => Number(row.so_luong) > 0 && row.lo_hang_id)
        : [];

    if (allocs.length) {
        for (const alloc of allocs) {
            await truTonKho({
                ...base,
                lo_hang_id: alloc.lo_hang_id,
                so_luong: Number(alloc.so_luong || 0)
            });
        }
        return;
    }

    await truTonKho({
        ...base,
        lo_hang_id: line.lo_hang_id || undefined,
        so_luong: qty
    });
}

function buildReturnStockLine(item, invoiceLineMeta = {}) {
    const invoiceLine = item.invoiceLine || {};
    return {
        hang_hoa_id: item.hang_hoa_id,
        lo_hang_id: item.lo_hang_id || invoiceLine.lo_hang_id || undefined,
        so_luong: item.so_luong,
        gia_tri_thuoc_tinh_id: invoiceLineMeta.gia_tri_thuoc_tinh_id || invoiceLine.gia_tri_thuoc_tinh_id,
        ten_quy_cach: invoiceLineMeta.ten_quy_cach || invoiceLineMeta.ten_thuoc_tinh || invoiceLine.ten_quy_cach || invoiceLine.ten_thuoc_tinh || '',
        ten_thuoc_tinh: invoiceLineMeta.ten_thuoc_tinh || invoiceLineMeta.ten_quy_cach || invoiceLine.ten_thuoc_tinh || invoiceLine.ten_quy_cach || '',
        lot_allocations: invoiceLine.lot_allocations
    };
}

async function recordSalesReturnRefundReceipt({
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
    userId
}) {
    if (!refund || refund <= 0) return null;
    if (!storeId) throw new Error('Thi?u c?a h�ng d? ghi phi?u chi ho�n ti?n tr? h�ng.');

    const refundBase = {
        loai_phieu: 'chi',
        loai_thu_chi: 'Hoan tien tra hang',
        ngay_lap: returnSlip.ngay_tra || new Date(),
        cua_hang_id: storeId,
        nguoi_tao_id: userId,
        khach_hang_id: customerId || undefined,
        hoa_don_id: hoa_don_id || undefined,
        phieu_tra_hang_id: returnSlip._id,
        ma_chung_tu_goc: ma_phieu_tra,
        doi_tuong: customerId ? undefined : 'Kh�ch l?',
        nhom_doi_tuong: 'khach_hang',
        hach_toan: false,
        ghi_chu: `Hoan tien tra hang ${ma_phieu_tra}`
    };

    const cashBookId = paymentBooks.so_quy_tien_mat_id || '';
    const bankBookId = paymentBooks.so_quy_chuyen_khoan_id || '';
    let tienMat = Math.min(Math.max(0, Number(returnPayment.tien_mat || 0)), refund);
    let chuyenKhoan = Math.min(Math.max(0, Number(returnPayment.chuyen_khoan || 0)), Math.max(0, refund - tienMat));
    if (tienMat + chuyenKhoan <= 0) {
        tienMat = refund;
        chuyenKhoan = 0;
    }

    const useSplitBooks = Boolean(cashBookId && bankBookId && tienMat > 0 && chuyenKhoan > 0);
    if (useSplitBooks || (cashBookId && tienMat > 0) || (bankBookId && chuyenKhoan > 0)) {
        return taoPhieuThuChi(Object.assign({}, refundBase, {
            gia_tri: tienMat + chuyenKhoan,
            payment_v2: true,
            so_quy_tien_mat_id: cashBookId || undefined,
            so_quy_chuyen_khoan_id: bankBookId || undefined,
            tien_mat: tienMat,
            chuyen_khoan: chuyenKhoan,
            chi_tiet_thanh_toan: {
                tien_mat: tienMat,
                chuyen_khoan: chuyenKhoan,
                tien_tra_khach: 0,
                so_quy_tien_mat_id: cashBookId || undefined,
                so_quy_chuyen_khoan_id: bankBookId || undefined
            },
            phuong_thuc_thanh_toan: tienMat > 0 && chuyenKhoan > 0
                ? 'tien_mat_chuyen_khoan'
                : (chuyenKhoan > 0 ? 'chuyen_khoan' : 'tien_mat')
        }));
    }

    const bookId = refundCashBookId || cashBookId || bankBookId;
    if (!bookId) throw new Error('Vui lòng chọn sổ quỹ để hoàn tiền trả hàng.');
    return taoPhieuThuChi(Object.assign({}, refundBase, {
        gia_tri: refund,
        so_quy_id: bookId,
        phuong_thuc_thanh_toan: returnPaymentMethod
    }));
}

function returnStockLineKey(row) {
    const invoiceLineId = optionalLineObjectId(row.ct_hoa_don_id) || optionalLineObjectId(row._id);
    const lotId = row.lo_hang_id?._id || row.lo_hang_id || '';
    if (invoiceLineId && lotId) return `${invoiceLineId}::${lotId}`;
    if (invoiceLineId) return String(invoiceLineId);
    return legacyReturnLineKey(row);
}

function expandReturnableInvoiceItems(items) {
    const expanded = [];
    for (const item of items) {
        const object = item && typeof item.toObject === 'function' ? item.toObject() : { ...item };
        const allocs = Array.isArray(object.lot_allocations)
            ? object.lot_allocations.filter(row => Number(row.so_luong) > 0 && row.lo_hang_id)
            : [];

        if (allocs.length > 1) {
            for (const alloc of allocs) {
                expanded.push({
                    ...object,
                    lo_hang_id: alloc.lo_hang_id,
                    lo_hang_display: formatLotAllocationLabel(alloc),
                    lot_allocations: [alloc],
                    so_luong: Number(alloc.so_luong || 0),
                    _return_from_multi_lot: true
                });
            }
            continue;
        }

        if (allocs.length === 1) {
            object.lo_hang_id = allocs[0].lo_hang_id;
            object.lo_hang_display = formatLotAllocationLabel(allocs[0]);
            object.lot_allocations = allocs;
            object.so_luong = Number(allocs[0].so_luong || object.so_luong || 0);
        }
        expanded.push(object);
    }
    return expanded;
}

async function loadReturnInvoiceContext(invoiceId) {
    const id = String(invoiceId || '').trim();
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
        const err = new Error('ID hóa đơn không hợp lệ');
        err.status = 400;
        throw err;
    }

    const invoice = await HoaDonBanHang.findById(id)
        .populate('khach_hang_id')
        .populate('kho_id')
        .populate('cua_hang_id')
        .populate('don_hang_id')
        .populate('nguoi_ban_id')
        .lean();
    if (!invoice) {
        const err = new Error('Không tìm thấy hóa đơn');
        err.status = 404;
        throw err;
    }
    if (normalizeInvoiceStatus(invoice.trang_thai) === 'cancelled') {
        const err = new Error('Hóa đơn đã hủy, không thể trả hàng');
        err.status = 400;
        throw err;
    }

    const items = await CTHoaDonBanHang.find({ hoa_don_id: invoice._id })
        .populate('hang_hoa_id')
        .populate('lo_hang_id')
        .lean();
    if (!items.length) {
        const err = new Error('Hóa đơn chưa có chi tiết hàng hóa');
        err.status = 400;
        throw err;
    }

    const returns = await PhieuTraHang.find({
        hoa_don_id: invoice._id,
        trang_thai: { $ne: 'cancelled' }
    }).select('_id').lean();
    const returnedItems = returns.length
        ? await CTPhieuTraHang.find({ phieu_tra_hang_id: { $in: returns.map(row => row._id) }, loai_dong: { $ne: 'hang_doi' } })
            .select('ct_hoa_don_id hang_hoa_id lo_hang_id so_luong')
            .lean()
        : [];
    const returnedByLineKey = {};
    const returnedByLegacyLine = {};
    returnedItems.forEach(row => {
        const invoiceLineId = optionalLineObjectId(row.ct_hoa_don_id);
        if (invoiceLineId) {
            const key = returnStockLineKey(row);
            returnedByLineKey[key] = (returnedByLineKey[key] || 0) + Number(row.so_luong || 0);
            return;
        }
        const legacyKey = legacyReturnLineKey(row);
        returnedByLegacyLine[legacyKey] = (returnedByLegacyLine[legacyKey] || 0) + Number(row.so_luong || 0);
    });

    const expandedItems = expandReturnableInvoiceItems(items);
    const returnableItems = expandedItems
        .map(item => {
            const key = returnStockLineKey(item);
            const legacyKey = legacyReturnLineKey(item);
            const returnedQty = Number(returnedByLineKey[key] || 0) + Number(returnedByLegacyLine[legacyKey] || 0);
            const originalQty = Number(item.so_luong || 0);
            const remainingQty = Math.max(originalQty - returnedQty, 0);
            return Object.assign({}, item, {
                so_luong_da_tra: returnedQty,
                so_luong_con_lai: remainingQty,
                so_luong: remainingQty
            });
        })
        .filter(item => Number(item.so_luong_con_lai || 0) > 0);
    if (!returnableItems.length) {
        const err = new Error('Hóa đơn đã được trả hết hàng');
        err.status = 400;
        throw err;
    }

    const hasMultiLotLines = returnableItems.some(item => item._return_from_multi_lot);
    return {
        invoice,
        items: returnableItems,
        return_multi_lot_note: hasMultiLotLines
            ? 'Một số dòng hóa đơn xuất từ nhiều lô để trả hàng theo từng lô riêng.'
            : ''
    };
}

function buildOrderExportRow(order, detail, shipment) {
    const product = detail?.hang_hoa_id || {};
    const customer = order.khach_hang_id || {};
    const shippingFee = Number(shipment?.phi_giao_hang || 0);
    const codOn = order.cod_enabled === true || shipment?.cod_enabled === true;
    const codAmount = Number(order.cod_amount || shipment?.cod_amount || 0);
    return {
        ma_don_hang: order.ma_don_hang || '',
        ngay_dat: formatExportDate(order.ngay_dat || order.ngay_tao),
        ngay_giao_thuc_te: formatExportDate(order.ngay_giao_thuc_te),
        cua_hang: order.cua_hang_id ? (order.cua_hang_id.ten_cua_hang || order.cua_hang_id.ma_cua_hang || '') : '',
        kho: order.kho_id ? (order.kho_id.ten_kho || order.kho_id.ma_kho || '') : '',
        bang_gia: order.bang_gia_id ? (order.bang_gia_id.ten_bang_gia || order.bang_gia_id.ma_bang_gia || '') : '',
        nguoi_tao: exportUserName(order.nguoi_tao_id),
        trang_thai: ORDER_EXPORT_STATUS_MAP[order.trang_thai] || order.trang_thai || '',
        trang_thai_giao_hang: ORDER_EXPORT_DELIVERY_STATUS_MAP[order.trang_thai_giao_hang] || order.trang_thai_giao_hang || '',
        ghi_chu: order.ghi_chu || '',
        ma_khach_hang: customer.ma_khach_hang || '',
        ten_khach_hang: exportCustomerName(customer),
        ten_nguoi_nhan: shipment?.ten_nguoi_nhan || '',
        sdt_nguoi_nhan: shipment?.sdt_nguoi_nhan || customer.sdt || customer.sdt2 || '',
        dia_chi_nhan: shipment?.dia_chi_nhan || '',
        doi_tac_giao_hang: shipment?.doi_tac_giao_hang_id ? (shipment.doi_tac_giao_hang_id.ten_doi_tac || '') : '',
        nguoi_tra_phi_giao_hang: SHIPPING_FEE_PAYER_MAP[shipment?.nguoi_tra_phi_giao_hang] || '',
        tong_so_luong_dat: Number(order.tong_so_luong_dat || 0),
        tong_tien_hang: Number(order.tong_tien_hang || order.tong_tien || 0),
        giam_gia: Number(order.giam_gia || 0),
        kieu_giam_gia: order.kieu_giam_gia === 'phan_tram' ? '%' : 'VND',
        phi_giao_hang: shippingFee,
        khach_can_tra: Number(order.khach_can_tra || order.tong_thanh_toan || order.tong_tien || 0),
        khach_thanh_toan: Number(order.khach_thanh_toan || 0),
        tien_thua_tra_khach: Number(order.tien_thua_tra_khach || 0),
        cod_enabled: codOn ? 'Có' : 'Không',
        cod_amount: codAmount,
        ma_hang: product.ma_hang || '',
        ten_hang: product.ten_hang || '',
        lo_hang: exportLotName(detail?.lo_hang_id),
        so_luong_dat: detail ? Number(detail.so_luong_dat || detail.so_luong || 0) : '',
        so_luong_xac_nhan: detail ? Number(detail.so_luong_xac_nhan || 0) : '',
        so_luong_da_giao: detail ? Number(detail.so_luong_da_giao || 0) : '',
        so_luong_con_thieu: detail ? Number(detail.so_luong_con_thieu || 0) : '',
        trang_thai_giao: detail
            ? (ORDER_EXPORT_LINE_DELIVERY_STATUS_MAP[detail.trang_thai_giao] || detail.trang_thai_giao || '')
            : '',
        don_gia_ban: detail ? Number(detail.don_gia_ban || 0) : '',
        chiet_khau: detail ? Number(detail.chiet_khau || 0) : '',
        kieu_chiet_khau: detail ? (detail.kieu_chiet_khau === 'phan_tram' ? '%' : 'VND') : '',
        thanh_tien: detail ? Number(detail.thanh_tien || 0) : ''
    };
}

function applyExportWorksheetFormat(worksheet, columnCount) {
    const totalColumns = columnCount || worksheet.columnCount || ORDER_EXPORT_COLUMNS.length;
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FF111827' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            bottom: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            left: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            right: { style: 'thin', color: { argb: 'FFD8E8FB' } }
        };
    });
    worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: totalColumns }
    };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        row.eachCell(cell => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
            };
            cell.alignment = { vertical: 'middle' };
        });
    });
    worksheet.columns.forEach(column => {
        let maxLength = String(column.header || '').length;
        column.eachCell({ includeEmpty: true }, cell => {
            const value = cell.value == null ? '' : String(cell.value);
            maxLength = Math.max(maxLength, value.length);
        });
        column.width = Math.min(Math.max(maxLength + 2, 12), 36);
    });
}

function applyInvoiceWorksheetFormat(worksheet) {
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FF111827' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            bottom: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            left: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            right: { style: 'thin', color: { argb: 'FFD8E8FB' } }
        };
    });
    worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: INVOICE_EXPORT_COLUMNS.length }
    };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        row.eachCell(cell => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
            };
            cell.alignment = { vertical: 'middle' };
        });
    });
    worksheet.columns.forEach(column => {
        let maxLength = String(column.header || '').length;
        column.eachCell({ includeEmpty: true }, cell => {
            const value = cell.value == null ? '' : String(cell.value);
            maxLength = Math.max(maxLength, value.length);
        });
        column.width = Math.min(Math.max(maxLength + 2, 12), 36);
    });
}

function applyReturnWorksheetFormat(worksheet) {
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FF111827' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            bottom: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            left: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            right: { style: 'thin', color: { argb: 'FFD8E8FB' } }
        };
    });
    worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: RETURN_EXPORT_COLUMNS.length }
    };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        row.eachCell(cell => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
            };
            cell.alignment = { vertical: 'middle' };
        });
    });
    worksheet.columns.forEach(column => {
        let maxLength = String(column.header || '').length;
        column.eachCell({ includeEmpty: true }, cell => {
            const value = cell.value == null ? '' : String(cell.value);
            maxLength = Math.max(maxLength, value.length);
        });
        column.width = Math.min(Math.max(maxLength + 2, 12), 36);
    });
}

function applyShipmentWorksheetFormat(worksheet) {
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FF111827' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            bottom: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            left: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            right: { style: 'thin', color: { argb: 'FFD8E8FB' } }
        };
    });
    worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: SHIPMENT_EXPORT_COLUMNS.length }
    };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        row.eachCell(cell => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
            };
            cell.alignment = { vertical: 'middle' };
        });
    });
    worksheet.columns.forEach(column => {
        let maxLength = String(column.header || '').length;
        column.eachCell({ includeEmpty: true }, cell => {
            const value = cell.value == null ? '' : String(cell.value);
            maxLength = Math.max(maxLength, value.length);
        });
        column.width = Math.min(Math.max(maxLength + 2, 12), 38);
    });
}

async function buildShipmentOrderFilter(query = {}) {
    const shipmentFilter = {};
    if (query.doi_tac && query.doi_tac !== 'all') shipmentFilter.doi_tac_giao_hang_id = query.doi_tac;
    if (query.khu_vuc && query.khu_vuc.trim() !== '') shipmentFilter.dia_chi_nhan = { $regex: query.khu_vuc.trim(), $options: 'i' };
    if (query.nguoi_nhan && query.nguoi_nhan.trim() !== '') shipmentFilter.ten_nguoi_nhan = { $regex: query.nguoi_nhan.trim(), $options: 'i' };

    const deliveryFrom = query.delivery_from ? new Date(query.delivery_from + 'T00:00:00') : null;
    const deliveryTo = query.delivery_to ? new Date(query.delivery_to + 'T23:59:59') : null;
    if (deliveryFrom || deliveryTo) {
        shipmentFilter.created_at = {};
        if (deliveryFrom && !Number.isNaN(deliveryFrom.getTime())) shipmentFilter.created_at.$gte = deliveryFrom;
        if (deliveryTo && !Number.isNaN(deliveryTo.getTime())) shipmentFilter.created_at.$lte = deliveryTo;
    }

    if (!Object.keys(shipmentFilter).length) return null;
    const shipments = await VanDon.find(shipmentFilter).select('don_hang_id');
    return shipments.map(item => item.don_hang_id).filter(Boolean);
}

async function buildFullOrderFilter(query = {}) {
    const filter = buildOrderFilter(query);
    const shipmentOrderIds = await buildShipmentOrderFilter(query);
    if (shipmentOrderIds) filter._id = { $in: shipmentOrderIds };

    if (query?.phuong_thuc_tt && query.phuong_thuc_tt.trim() !== '') {
        const invoices = await HoaDonBanHang.find({
            phuong_thuc_tt: query.phuong_thuc_tt.trim(),
            don_hang_id: { $ne: null }
        }).select('don_hang_id');
        applyOrderIdFilter(filter, invoices.map(item => item.don_hang_id).filter(Boolean));
    }

    if (query?.nguoi_tao && query.nguoi_tao.trim() !== '' && !filter.nguoi_tao_id) {
        const usersByName = await NguoiDung.find({
            $or: [
                { ho_ten: { $regex: query.nguoi_tao.trim(), $options: 'i' } },
                { username: { $regex: query.nguoi_tao.trim(), $options: 'i' } }
            ]
        }).select('_id');
        filter.nguoi_tao_id = { $in: usersByName.map(user => user._id) };
    }

    return filter;
}

async function loadOrderExportData(filter) {
    const orders = await DonHang.find(filter)
        .populate('khach_hang_id')
        .populate('cua_hang_id')
        .populate('kho_id')
        .populate('bang_gia_id')
        .populate('nguoi_tao_id')
        .sort({ created_at: -1 })
        .lean();
    const orderIds = orders.map(order => order._id);
    const [details, shipments] = await Promise.all([
        orderIds.length
            ? CTDonHang.find({ don_hang_id: { $in: orderIds } })
                .populate('hang_hoa_id', 'ma_hang ten_hang')
                .populate('lo_hang_id')
                .sort({ created_at: 1 })
            : [],
        orderIds.length
            ? VanDon.find({ don_hang_id: { $in: orderIds } })
                .populate('doi_tac_giao_hang_id')
                .sort({ created_at: -1 })
                .lean()
            : []
    ]);
    const detailMap = details.reduce((map, detail) => {
        const key = String(detail.don_hang_id);
        if (!map[key]) map[key] = [];
        map[key].push(detail);
        return map;
    }, {});
    const shipmentMap = shipments.reduce((map, shipment) => {
        const key = String(shipment.don_hang_id || '');
        if (!map[key]) map[key] = shipment;
        return map;
    }, {});

    orders.forEach(order => {
        const orderDetails = detailMap[String(order._id)] || [];
        order.tong_so_luong_dat = orderDetails.reduce((sum, detail) => {
            return sum + Number(detail.so_luong_dat || detail.so_luong || 0);
        }, 0);
    });

    return { orders, detailMap, shipmentMap };
}

async function sendOrderWorkbook(res, filename, orders, detailMap, shipmentMap, selectedColumns) {
    const columns = selectedColumns && selectedColumns.length ? selectedColumns : ORDER_EXPORT_COLUMNS;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Đơn hàng');
    worksheet.columns = columns;

    orders.forEach(order => {
        const details = detailMap[String(order._id)] || [];
        const shipment = shipmentMap[String(order._id)] || null;
        if (!details.length) {
            worksheet.addRow(pickOrderExportRowValues(buildOrderExportRow(order, null, shipment), columns));
            return;
        }
        details.forEach(detail => {
            worksheet.addRow(pickOrderExportRowValues(buildOrderExportRow(order, detail, shipment), columns));
        });
    });

    applyExportWorksheetFormat(worksheet, columns.length);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    await workbook.xlsx.write(res);
    res.end();
}

function buildInvoiceExportRow(invoice, detail, shipment, paidAmount, debtAmount) {
    const product = detail?.hang_hoa_id || {};
    const customer = invoice.khach_hang_id || {};
    const order = invoice.don_hang_id || {};
    const payable = Number(invoice.thanh_toan || invoice.tong_tien || 0);
    const shippingFee = Number(shipment?.phi_giao_hang || 0);
    const quantity = detail ? Number(detail.so_luong || 0) : 0;
    return {
        ma_hoa_don: invoice.ma_hoa_don || '',
        thoi_gian_ban: formatExportDate(invoice.ngay_ban || invoice.created_at),
        ma_don_hang: order.ma_don_hang || '',
        khach_hang: exportCustomerName(customer),
        dien_thoai: exportCustomerPhone(customer, shipment),
        dia_chi: exportAddress(customer, shipment),
        kho: invoice.kho_id ? (invoice.kho_id.ten_kho || invoice.kho_id.ma_kho || '') : '',
        bang_gia: order.bang_gia_id ? (order.bang_gia_id.ten_bang_gia || order.bang_gia_id.ma_bang_gia || '') : '',
        nhan_vien_ban_hang: exportUserName(invoice.nguoi_ban_id),
        tong_tien_hang: Number(invoice.tong_tien || 0),
        giam_gia: Number(invoice.giam_gia || 0),
        phi_giao_hang: shippingFee,
        khach_can_tra: payable,
        khach_da_tra: Number(paidAmount || 0),
        tien_thua_tra_khach: Math.max(0, Number(paidAmount || 0) - payable),
        cong_no: Number(debtAmount || 0),
        phuong_thuc_thanh_toan: invoice.phuong_thuc_tt || '',
        cod: invoice.phuong_thuc_tt === 'COD' || order.cod_enabled || shipment?.cod_enabled ? 'Có' : 'Không',
        trang_thai_hoa_don: INVOICE_EXPORT_STATUS_MAP[normalizeInvoiceStatus(invoice.trang_thai)] || INVOICE_EXPORT_STATUS_MAP[invoice.trang_thai] || invoice.trang_thai || '',
        ghi_chu: invoice.ghi_chu || '',
        ma_hang: product.ma_hang || '',
        ten_hang: product.ten_hang || '',
        thuong_hieu: product.thuong_hieu_id ? product.thuong_hieu_id.ten_thuong_hieu || '' : '',
        nhom_hang: product.nhom_hang_id ? product.nhom_hang_id.ten_nhom_hang || '' : '',
        don_vi_tinh: product.don_vi_tinh_id ? product.don_vi_tinh_id.ten_don_vi || product.don_vi_tinh_id.ma_don_vi || '' : '',
        lo_hang: exportInvoiceLotName(detail),
        so_luong: quantity,
        don_gia: detail ? Number(detail.don_gia || 0) : 0,
        chiet_khau: detail ? Number(detail.chiet_khau || 0) : 0,
        thanh_tien: detail ? Number(detail.thanh_tien || 0) : 0,
        gia_von: Number(product.gia_von || 0)
    };
}

async function loadInvoiceExportData(filter) {
    const invoices = await HoaDonBanHang.find(filter)
        .populate('khach_hang_id')
        .populate('kho_id')
        .populate({
            path: 'don_hang_id',
            populate: { path: 'bang_gia_id' }
        })
        .populate('nguoi_ban_id')
        .sort({ ngay_ban: -1, created_at: -1 });
    const invoiceIds = invoices.map(invoice => invoice._id);
    const orderIds = invoices.map(invoice => invoice.don_hang_id?._id || invoice.don_hang_id).filter(Boolean);
    const [details, shipments, receipts, debts] = await Promise.all([
        invoiceIds.length
            ? CTHoaDonBanHang.find({ hoa_don_id: { $in: invoiceIds } })
                .populate({
                    path: 'hang_hoa_id',
                    populate: [
                        { path: 'thuong_hieu_id' },
                        { path: 'nhom_hang_id' },
                        { path: 'don_vi_tinh_id' }
                    ]
                })
                .populate('lo_hang_id')
                .sort({ created_at: 1 })
            : [],
        (invoiceIds.length || orderIds.length)
            ? VanDon.find({
                $or: [
                    { hoa_don_id: { $in: invoiceIds } },
                    { don_hang_id: { $in: orderIds } }
                ]
            }).populate('doi_tac_giao_hang_id').lean()
            : [],
        (invoiceIds.length || orderIds.length)
            ? PhieuThuChi.find(receiptRowsForNetPaidFilter({
                $or: [
                    { hoa_don_id: { $in: invoiceIds } },
                    { don_hang_id: { $in: orderIds } }
                ]
            })).lean()
            : [],
        invoiceIds.length
            ? CongNoKhachHang.find({ hoa_don_id: { $in: invoiceIds } }).lean()
            : []
    ]);

    const detailMap = details.reduce((map, detail) => {
        const key = String(detail.hoa_don_id);
        if (!map[key]) map[key] = [];
        map[key].push(detail);
        return map;
    }, {});
    const shipmentMap = {};
    shipments.forEach(shipment => {
        if (shipment.hoa_don_id) shipmentMap[String(shipment.hoa_don_id)] = shipment;
    });
    shipments.forEach(shipment => {
        if (!shipment.don_hang_id) return;
        const invoice = invoices.find(row => String(row.don_hang_id?._id || row.don_hang_id || '') === String(shipment.don_hang_id));
        if (invoice && !shipmentMap[String(invoice._id)]) shipmentMap[String(invoice._id)] = shipment;
    });
    const orderToInvoiceId = invoices.reduce((map, invoice) => {
        const orderId = String(invoice.don_hang_id?._id || invoice.don_hang_id || '');
        if (orderId) map[orderId] = String(invoice._id);
        return map;
    }, {});
    const paidRowsByInvoice = receipts.reduce((map, row) => {
        const key = row.hoa_don_id
            ? String(row.hoa_don_id)
            : orderToInvoiceId[String(row.don_hang_id || '')];
        if (!key) return map;
        if (!map[key]) map[key] = [];
        map[key].push(row);
        return map;
    }, {});
    const paidMap = Object.entries(paidRowsByInvoice).reduce((map, [key, rows]) => {
        map[key] = computeNetPaidFromReceiptRows(rows);
        return map;
    }, {});
    const debtMap = debts.reduce((map, row) => {
        const key = String(row.hoa_don_id || '');
        map[key] = (map[key] || 0) + Number(row.so_tien || 0);
        return map;
    }, {});

    return { invoices, detailMap, shipmentMap, paidMap, debtMap };
}

async function sendInvoiceWorkbook(res, filename, invoices, detailMap, shipmentMap, paidMap, debtMap) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Hóa đơn bán hàng');
    worksheet.columns = INVOICE_EXPORT_COLUMNS;

    invoices.forEach(invoice => {
        const details = detailMap[String(invoice._id)] || [];
        const shipment = shipmentMap[String(invoice._id)] || null;
        const paid = paidMap[String(invoice._id)] || 0;
        const payable = Number(invoice.thanh_toan || invoice.tong_tien || 0);
        const debt = Math.max(0, payable - paid);
        if (!details.length) {
            worksheet.addRow(buildInvoiceExportRow(invoice, null, shipment, paid, debt));
            return;
        }
        details.forEach(detail => worksheet.addRow(buildInvoiceExportRow(invoice, detail, shipment, paid, debt)));
    });

    applyInvoiceWorksheetFormat(worksheet);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    await workbook.xlsx.write(res);
    res.end();
}

function resolveReturnTotals(returnSlip, detailRows = []) {
    const returnItems = detailRows.filter(item => (item.loai_dong || 'hang_tra') !== 'hang_doi');
    const exchangeItems = detailRows.filter(item => item.loai_dong === 'hang_doi');
    const returnGoodsTotal = Number(returnSlip.tong_tien_hang_tra ?? returnItems.reduce((sum, item) => sum + Number(item.thanh_tien || 0), 0));
    const exchangeGoodsTotal = Number(returnSlip.tong_tien_hang_doi ?? exchangeItems.reduce((sum, item) => sum + Number(item.thanh_tien || 0), 0));
    const difference = Number(returnSlip.chenh_lech ?? (exchangeGoodsTotal - returnGoodsTotal));
    const needRefund = Math.max(Number(returnSlip.can_tra_khach || 0), -difference, 0);
    const needCollect = Math.max(Number(returnSlip.khach_can_tra_them || 0), difference, 0);
    const fee = Number(returnSlip.phi_tra_hang || 0);
    const discount = Number(returnSlip.giam_gia || 0);
    return { returnGoodsTotal, exchangeGoodsTotal, difference, needRefund, needCollect, fee, discount };
}

function buildReturnExportRow(returnSlip, detail, totals) {
    const product = detail?.hang_hoa_id || {};
    const invoice = returnSlip.hoa_don_id || {};
    const order = invoice.don_hang_id || {};
    const customer = returnSlip.khach_hang_id || invoice.khach_hang_id || {};
    const lineType = detail?.loai_dong || 'hang_tra';
    return {
        ma_phieu_tra: returnSlip.ma_phieu_tra || '',
        thoi_gian_tra: formatExportDate(returnSlip.ngay_tra || returnSlip.created_at),
        ma_hoa_don: invoice.ma_hoa_don || '',
        ma_don_hang: order.ma_don_hang || '',
        khach_hang: exportCustomerName(customer),
        dien_thoai: customer.sdt || customer.sdt2 || '',
        dia_chi: customer.dia_chi_day_du || customer.khu_vuc_giao_hang || '',
        kho: returnSlip.kho_id
            ? (returnSlip.kho_id.ten_kho || returnSlip.kho_id.ma_kho || '')
            : (invoice.kho_id ? (invoice.kho_id.ten_kho || invoice.kho_id.ma_kho || '') : ''),
        nguoi_tao: exportUserName(returnSlip.nguoi_tao_id),
        tong_tien_hang_tra: totals.returnGoodsTotal,
        tong_tien_hang_doi: totals.exchangeGoodsTotal,
        chenh_lech: totals.difference,
        giam_gia: totals.discount,
        phi_tra_hang: totals.fee,
        can_tra_khach: totals.needRefund,
        khach_can_tra_them: totals.needCollect,
        ly_do: returnSlip.ly_do || '',
        ghi_chu: returnSlip.ghi_chu || '',
        trang_thai: RETURN_EXPORT_STATUS_MAP[returnSlip.trang_thai] || returnSlip.trang_thai || '',
        loai_dong: detail ? (RETURN_EXPORT_LINE_TYPE_MAP[lineType] || lineType) : '',
        ma_hang: product.ma_hang || '',
        ten_hang: product.ten_hang || '',
        thuong_hieu: product.thuong_hieu_id ? product.thuong_hieu_id.ten_thuong_hieu || '' : '',
        nhom_hang: product.nhom_hang_id ? product.nhom_hang_id.ten_nhom_hang || '' : '',
        don_vi_tinh: product.don_vi_tinh_id ? product.don_vi_tinh_id.ten_don_vi || product.don_vi_tinh_id.ma_don_vi || '' : '',
        lo_hang: exportLotName(detail?.lo_hang_id),
        so_luong: detail ? Number(detail.so_luong || 0) : 0,
        don_gia: detail ? Number(detail.don_gia || 0) : 0,
        thanh_tien: detail ? Number(detail.thanh_tien || 0) : 0
    };
}

async function loadReturnExportData(filter) {
    const returns = await PhieuTraHang.find(filter)
        .populate({
            path: 'hoa_don_id',
            populate: [
                { path: 'don_hang_id' },
                { path: 'khach_hang_id' },
                { path: 'kho_id' }
            ]
        })
        .populate('khach_hang_id')
        .populate('kho_id')
        .populate('nguoi_tao_id')
        .sort({ ngay_tra: -1, created_at: -1 });
    const returnIds = returns.map(item => item._id);
    const details = returnIds.length
        ? await CTPhieuTraHang.find({ phieu_tra_hang_id: { $in: returnIds } })
            .populate({
                path: 'hang_hoa_id',
                populate: [
                    { path: 'thuong_hieu_id' },
                    { path: 'nhom_hang_id' },
                    { path: 'don_vi_tinh_id' }
                ]
            })
            .populate('lo_hang_id')
            .sort({ created_at: 1 })
        : [];
    const detailMap = details.reduce((map, detail) => {
        const key = String(detail.phieu_tra_hang_id);
        if (!map[key]) map[key] = [];
        map[key].push(detail);
        return map;
    }, {});
    return { returns, detailMap };
}

async function sendReturnWorkbook(res, filename, returns, detailMap) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Trả hàng bán');
    worksheet.columns = RETURN_EXPORT_COLUMNS;

    returns.forEach(returnSlip => {
        const details = detailMap[String(returnSlip._id)] || [];
        const totals = resolveReturnTotals(returnSlip, details);
        if (!details.length) {
            worksheet.addRow(buildReturnExportRow(returnSlip, null, totals));
            return;
        }
        details.forEach(detail => worksheet.addRow(buildReturnExportRow(returnSlip, detail, totals)));
    });

    applyReturnWorksheetFormat(worksheet);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    await workbook.xlsx.write(res);
    res.end();
}

async function buildShipmentFilter(query = {}) {
    const filter = {};
    if (query?.q && query.q.trim() !== '') {
        filter.ma_van_don = { $regex: query.q.trim(), $options: 'i' };
    }
    if (query?.trang_thai && query.trang_thai !== 'all') {
        filter.trang_thai = query.trang_thai;
    }
    if (query?.doi_tac_giao_hang_id && query.doi_tac_giao_hang_id !== 'all') {
        filter.doi_tac_giao_hang_id = query.doi_tac_giao_hang_id;
    }
    const createdRange = dateRange(query, 'created_from', 'created_to', false);
    if (createdRange) filter.created_at = createdRange;
    if (query?.khu_vuc && query.khu_vuc.trim() !== '') {
        filter.dia_chi_nhan = { $regex: query.khu_vuc.trim(), $options: 'i' };
    }
    if (query?.cod === 'yes') {
        filter.cod_enabled = true;
    } else if (query?.cod === 'no') {
        filter.$or = [{ cod_enabled: { $exists: false } }, { cod_enabled: false }, { cod_enabled: null }];
    }
    return filter;
}

function shipmentCustomerName(shipment) {
    return exportCustomerName(shipment.khach_hang_id || shipment.hoa_don_id?.khach_hang_id || shipment.don_hang_id?.khach_hang_id) || shipment.ten_nguoi_nhan || '';
}

function buildShipmentExportRow(shipment) {
    const order = shipment.don_hang_id || {};
    const invoice = shipment.hoa_don_id || {};
    return {
        ma_van_don: shipment.ma_van_don || '',
        ma_don_hang: order.ma_don_hang || '',
        ma_hoa_don: invoice.ma_hoa_don || '',
        khach_hang: shipmentCustomerName(shipment),
        nguoi_nhan: shipment.ten_nguoi_nhan || '',
        dien_thoai_nguoi_nhan: shipment.sdt_nguoi_nhan || '',
        dia_chi_nhan: shipment.dia_chi_nhan || '',
        doi_tac_giao_hang: shipment.doi_tac_giao_hang_id ? (shipment.doi_tac_giao_hang_id.ten_doi_tac || '') : 'Tự giao hàng',
        phi_giao_hang: Number(shipment.phi_giao_hang || 0),
        don_gia_van_chuyen_ap_dung: Number(shipment.don_gia_van_chuyen_ap_dung || 0),
        so_luong_tinh_phi: Number(shipment.so_luong_tinh_phi || 0),
        thanh_tien_van_chuyen: Number(shipment.thanh_tien_van_chuyen || shipment.phi_giao_hang || 0),
        nguoi_tra_phi_giao_hang: SHIPPING_FEE_PAYER_MAP[shipment.nguoi_tra_phi_giao_hang] || shipment.nguoi_tra_phi_giao_hang || '',
        cod: shipment.cod_enabled ? 'Có' : 'Không',
        so_tien_cod: Number(shipment.cod_amount || 0),
        trang_thai_cod: SHIPMENT_COD_STATUS_MAP[shipment.trang_thai_cod] || shipment.trang_thai_cod || '',
        trang_thai_van_don: ORDER_EXPORT_STATUS_MAP[shipment.trang_thai] || shipment.trang_thai || '',
        ghi_chu: shipment.ghi_chu || '',
        ngay_tao: formatExportDate(shipment.created_at),
        ngay_cap_nhat: formatExportDate(shipment.updated_at)
    };
}

async function loadShipmentExportData(filter = {}) {
    const shipments = await VanDon.find(filter)
        .populate({
            path: 'don_hang_id',
            populate: { path: 'khach_hang_id' }
        })
        .populate({
            path: 'hoa_don_id',
            populate: { path: 'khach_hang_id' }
        })
        .populate('khach_hang_id')
        .populate('doi_tac_giao_hang_id')
        .sort({ created_at: -1 });
    return shipments;
}

async function sendShipmentWorkbook(res, filename, shipments) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Vận đơn');
    worksheet.columns = SHIPMENT_EXPORT_COLUMNS;

    shipments.forEach(shipment => worksheet.addRow(buildShipmentExportRow(shipment)));

    applyShipmentWorksheetFormat(worksheet);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    await workbook.xlsx.write(res);
    res.end();
}

function applyOrderIdFilter(filter, ids) {
    if (!filter._id) {
        filter._id = { $in: ids };
        return;
    }
    const currentIds = (filter._id.$in || []).map(id => String(id));
    const allowed = new Set(ids.map(id => String(id)));
    filter._id.$in = currentIds.filter(id => allowed.has(id));
}

function toArray(value) {
    if (value === undefined || value === null || value === '') return [];
    return Array.isArray(value) ? value : [value];
}

function cleanArray(value) {
    return toArray(value).filter(item => item && item !== 'all');
}

function normalizeDiscount(value, type, baseAmount) {
    const raw = Math.max(0, Number(value || 0));
    const base = Math.max(0, Number(baseAmount || 0));
    const mode = type === 'phan_tram' ? 'phan_tram' : 'vnd';
    const amount = mode === 'phan_tram' ? base * Math.min(raw, 100) / 100 : raw;
    return Math.min(amount, base);
}

async function getSellableStock(khoId, product) {
    if (!product?.quan_ly_theo_lo) {
        const stock = await TonKho.findOne({ kho_id: khoId, hang_hoa_id: product._id }).lean();
        return Number(stock?.so_luong || 0);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lotRows = await TonKhoLo.find({ kho_id: khoId, hang_hoa_id: product._id, so_luong: { $gt: 0 } })
        .populate('lo_hang_id')
        .lean();

    return lotRows.reduce((total, row) => {
        const lot = row.lo_hang_id;
        if (!lot || lot.trang_thai === 'huy') return total;
        if (lot.han_su_dung) {
            const expiry = new Date(lot.han_su_dung);
            expiry.setHours(0, 0, 0, 0);
            if (expiry.getTime() < today.getTime()) return total;
        }
        return total + Number(row.so_luong || 0);
    }, 0);
}

async function getOrderLineActualStock(khoId, item) {
    const tenQuyCach = String(item.ten_quy_cach || item.ten_thuoc_tinh || '').trim();
    if (tenQuyCach) {
        const filter = {
            kho_id: khoId,
            hang_hoa_id: item.hang_hoa_id,
            $or: [{ ten_quy_cach: tenQuyCach }, { ten_thuoc_tinh: tenQuyCach }]
        };
        if (item.lo_hang_id) filter.lo_hang_id = item.lo_hang_id;
        const rows = await TonKhoLoQuyCach.find(filter).lean();
        return rows.reduce((sum, row) => sum + Number(row.so_luong || 0), 0);
    }

    if (item.lo_hang_id) {
        const lotStock = await TonKhoLo.findOne({
            kho_id: khoId,
            hang_hoa_id: item.hang_hoa_id,
            lo_hang_id: item.lo_hang_id
        }).lean();
        return Number(lotStock?.so_luong || 0);
    }

    return getSellableStock(khoId, item.product);
}

async function validateOrderAvailability({ khoId, normalizedItems, exclude_don_hang_id = null, exclude_hoa_don_id = null }) {
    const reserved = await getReservedQuantitiesForSale({
        kho_id: khoId,
        hang_hoa_ids: normalizedItems.map(item => item.hang_hoa_id),
        exclude_don_hang_id,
        exclude_hoa_don_id
    });
    const warnings = [];

    for (const item of normalizedItems) {
        const tenQuyCach = String(item.ten_quy_cach || item.ten_thuoc_tinh || '').trim();
        const lotKey = item.lo_hang_id
            ? buildLotKey(item.hang_hoa_id, item.lo_hang_id)
            : '';
        const reservedKey = tenQuyCach
            ? buildVariantKey({
                hang_hoa_id: item.hang_hoa_id,
                gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id || '',
                ten_quy_cach: tenQuyCach
            })
            : null;
        const fallbackReservedKey = tenQuyCach
            ? buildVariantKey({
                hang_hoa_id: item.hang_hoa_id,
                gia_tri_thuoc_tinh_id: '',
                ten_quy_cach: tenQuyCach
            })
            : null;
        const productReserved = Number(reserved.byProduct[String(item.hang_hoa_id)]?.so_luong_khach_dat || 0);
        const lotReserved = lotKey ? Number(reserved.byLot[lotKey]?.so_luong_khach_dat || 0) : 0;
        const variantReserved = reservedKey
            ? Number((reserved.byVariant[reservedKey] || reserved.byVariant[fallbackReservedKey])?.so_luong_khach_dat || 0)
            : 0;
        const soLuongKhachDat = lotKey
            ? lotReserved
            : (reservedKey ? variantReserved : productReserved);
        const tonThucTe = await getOrderLineActualStock(khoId, item);
        const khaDung = tonThucTe - soLuongKhachDat;
        const soLuongDat = Number(item.so_luong || 0);
        const label = [
            item.ma_hang_snapshot || item.product?.ma_hang,
            item.ten_hang_snapshot || item.product?.ten_hang,
            tenQuyCach
        ].filter(Boolean).join(' - ');

        if (tenQuyCach && !item.gia_tri_thuoc_tinh_id && !item.ten_quy_cach) {
            warnings.push(`Dòng hàng quy cách ${label} thiếu gia_tri_thuoc_tinh_id và ten_quy_cach, chỉ có thể đối chiếu theo dữ liệu còn lại.`);
        }
        if (soLuongDat > tonThucTe) {
            const message = `Số lượng đặt vượt tồn thực tế. Khi giao có thể thiếu hàng. Dòng [${label}] tồn ${tonThucTe}, khách đặt ${soLuongDat}.`;
            if (!CHO_PHEP_DAT_AM_KHO) return { valid: false, message };
            warnings.push(message);
            continue;
        }
        if (soLuongDat > khaDung) {
            const message = `Số lượng đặt vượt khả dụng. Khả dụng cần ${khaDung}, khách đặt ${soLuongDat}.`;
            if (!CHO_PHEP_DAT_AM_KHO) return { valid: false, message };
            warnings.push(message);
        }
    }

    warnings.forEach(message => console.warn('[dat-hang][availability]', message));
    return { valid: true, warnings };
}

async function findReturnLotId(khoId, productId) {
    const stockLot = await TonKhoLo.findOne({
        kho_id: khoId,
        hang_hoa_id: productId
    })
        .sort({ updated_at: -1, created_at: -1 })
        .lean();
    if (stockLot?.lo_hang_id) return stockLot.lo_hang_id;

    const lot = await LoHang.findOne({
        kho_id: khoId,
        hang_hoa_id: productId,
        trang_thai: { $ne: 'huy' }
    })
        .sort({ ngay_nhap: -1, created_at: -1 })
        .lean();
    return lot?._id || null;
}

function dateRange(query = {}, fromKey, toKey, fallbackThisMonth) {
    const range = {};
    if (fallbackThisMonth) {
        const now = new Date();
        range.$gte = new Date(now.getFullYear(), now.getMonth(), 1);
        range.$lte = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    }
    const from = query[fromKey] ? new Date(query[fromKey] + 'T00:00:00') : null;
    const to = query[toKey] ? new Date(query[toKey] + 'T23:59:59') : null;
    if (from && !Number.isNaN(from.getTime())) range.$gte = from;
    if (to && !Number.isNaN(to.getTime())) range.$lte = to;
    return Object.keys(range).length ? range : null;
}

const INVOICE_TIME_PERIOD_MONTHS = {
    '1m': 1,
    '2m': 2,
    '3m': 3,
    '6m': 6,
    '1y': 12
};

function normalizeInvoiceTimePeriod(value) {
    const period = String(value || '').trim();
    return Object.prototype.hasOwnProperty.call(INVOICE_TIME_PERIOD_MONTHS, period) ? period : '1m';
}

const INVOICE_STATUS_FILTER_VALUES = ['processing', 'completed', 'failed', 'cancelled', 'merged'];

function normalizeInvoiceStatusFilter(value) {
    const raw = Array.isArray(value) ? value.find(item => item && item !== 'all') : value;
    const status = String(raw || '').trim();
    if (!status || status === 'all') return 'all';
    return INVOICE_STATUS_FILTER_VALUES.includes(status) ? status : 'all';
}

function resolveInvoiceTimePeriodRange(query = {}) {
    const months = INVOICE_TIME_PERIOD_MONTHS[normalizeInvoiceTimePeriod(query.time_period)];
    if (!months) return null;
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const start = new Date(end);
    start.setMonth(start.getMonth() - months);
    start.setHours(0, 0, 0, 0);
    return { $gte: start, $lte: end };
}

function normalizeInvoiceStatus(value) {
    const status = String(value || '').trim();
    if (['paid', 'partial', 'unpaid'].includes(status)) return status;
    if (['processing', 'completed', 'failed', 'cancelled', 'merged'].includes(status)) return status;
    if (status === 'draft' || status === 'shipping') return 'processing';
    if (status === 'done' || status === 'paid') return 'completed';
    return 'processing';
}

function normalizePaymentMethodValue(value) {
    const method = String(value || '').trim();
    if (['tien_mat', 'chuyen_khoan', 'vi_dien_tu', 'khac'].includes(method)) return method;
    if (/chuy?n|chuyen|bank/i.test(method)) return 'chuyen_khoan';
    if (/v�|vi/i.test(method)) return 'vi_dien_tu';
    if (/cod/i.test(method)) return 'khac';
    return 'tien_mat';
}

function resolveCashBookIdFromBody(body = {}) {
    const id = String(body.so_quy_id || body.cashBookId || body.cash_book_id || '').trim();
    return /^[0-9a-fA-F]{24}$/.test(id) ? id : '';
}

function isPaymentBookObjectId(id) {
    return /^[0-9a-fA-F]{24}$/.test(String(id || '').trim());
}

function resolvePaymentBooksFromBody(body = {}) {
    const nested = body.chi_tiet_thanh_toan && typeof body.chi_tiet_thanh_toan === 'object'
        ? body.chi_tiet_thanh_toan
        : {};
    const cashId = String(
        body.so_quy_tien_mat_id
        || nested.so_quy_tien_mat_id
        || body.cashBookId
        || ''
    ).trim();
    const bankId = String(
        body.so_quy_chuyen_khoan_id
        || nested.so_quy_chuyen_khoan_id
        || body.bankBookId
        || ''
    ).trim();
    const legacyId = String(body.so_quy_id || body.cash_book_id || '').trim();
    return {
        so_quy_tien_mat_id: isPaymentBookObjectId(cashId) ? cashId : '',
        so_quy_chuyen_khoan_id: isPaymentBookObjectId(bankId) ? bankId : '',
        so_quy_id: isPaymentBookObjectId(legacyId) ? legacyId : ''
    };
}

function validatePaymentBooksForCustomer(payment, books = {}) {
    const errors = [];
    if (!payment || payment.tong_khach_dua <= 0) return errors;
    const tienMat = Number(payment.tien_mat || 0);
    const chuyenKhoan = Number(payment.chuyen_khoan || 0);
    const tienThua = Number(payment.tien_thua || 0);
    if ((tienMat > 0 || tienThua > 0) && !books.so_quy_tien_mat_id) {
        errors.push(tienThua > 0 && tienMat <= 0
            ? 'Vui lòng chọn số tiền mặt để trả tiền thừa cho khách.'
            : 'Vui lòng chọn số tiền mặt.');
    }
    if (chuyenKhoan > 0 && !books.so_quy_chuyen_khoan_id) {
        errors.push('Vui lòng chọn tài khoản chuyển khoản.');
    }
    return errors;
}

function buildCustomerPaymentReceiptPayload(body, payment, base = {}) {
    const books = resolvePaymentBooksFromBody(body || {});
    const useV2 = body?.payment_v2 === true
        || body?.payment_v2 === 'true'
        || body?.payment_v2 === '1'
        || body?.payment_v2 === 1
        || Boolean(books.so_quy_tien_mat_id || books.so_quy_chuyen_khoan_id)
        || (Number(payment?.tien_mat || 0) > 0 && Number(payment?.chuyen_khoan || 0) > 0);
    const so_quy_id = books.so_quy_tien_mat_id
        || books.so_quy_chuyen_khoan_id
        || books.so_quy_id
        || resolveCashBookIdFromBody(body || {});
    return Object.assign({}, base, {
        so_quy_id,
        payment_v2: useV2,
        so_quy_tien_mat_id: books.so_quy_tien_mat_id,
        so_quy_chuyen_khoan_id: books.so_quy_chuyen_khoan_id
    });
}

function isEnabled(value) {
    return value === true || value === 'true' || value === 'on' || value === '1';
}

async function getOrderPaidAmount(orderId, extraFilter = {}) {
    if (!orderId) return 0;
    const linkOr = [{ don_hang_id: orderId }];
    const orderCode = String(extraFilter.ma_chung_tu_goc || '').trim();
    if (orderCode) {
        linkOr.push({ ma_chung_tu_goc: orderCode });
    } else {
        const order = await DonHang.findById(orderId).select('ma_don_hang').lean();
        const maDonHang = String(order?.ma_don_hang || '').trim();
        if (maDonHang) linkOr.push({ ma_chung_tu_goc: maDonHang });
    }
    const { ma_chung_tu_goc: _maChungTuGoc, ...restFilter } = extraFilter;
    const receipts = await PhieuThuChi.find(
        receiptRowsForNetPaidFilter({ $or: linkOr, ...restFilter })
    ).select('loai_phieu loai_thu_chi gia_tri trang_thai').lean();
    return computeNetPaidFromReceiptRows(receipts);
}

async function getInvoicePaidAmount(invoiceId, extraFilter = {}) {
    if (!invoiceId) return 0;
    const linkOr = [{ hoa_don_id: invoiceId }];
    const invoiceCode = String(extraFilter.ma_chung_tu_goc || '').trim();
    if (invoiceCode) {
        linkOr.push({ ma_chung_tu_goc: invoiceCode });
    } else {
        const invoice = await HoaDonBanHang.findById(invoiceId).select('ma_hoa_don').lean();
        const maHoaDon = String(invoice?.ma_hoa_don || '').trim();
        if (maHoaDon) linkOr.push({ ma_chung_tu_goc: maHoaDon });
    }
    const { ma_chung_tu_goc: _maChungTuGoc, ...restFilter } = extraFilter;
    const receipts = await PhieuThuChi.find(
        receiptRowsForNetPaidFilter({ $or: linkOr, ...restFilter })
    ).select('loai_phieu loai_thu_chi gia_tri trang_thai').lean();
    return computeNetPaidFromReceiptRows(receipts);
}

function parseCustomerPaymentFromRequest(body, soTienConPhaiThu, requirePayment = false) {
    return normalizeCustomerPaymentInput(body || {}, {
        so_tien_con_phai_thu: soTienConPhaiThu,
        requirePayment
    });
}

async function recordCustomerPaymentReceipts(data, payment) {
    if (!payment || payment.tong_khach_dua <= 0) {
        return { thu: null, chi: null };
    }
    const payload = Object.assign({}, data || {});
    if (!payload.document_type) {
        if (payload.hoa_don_id && !payload.don_hang_id) {
            payload.document_type = 'hoa_don';
        } else if (payload.don_hang_id) {
            payload.document_type = 'don_hang';
        } else if (payload.hoa_don_id) {
            payload.document_type = 'hoa_don';
        } else if (payload.van_don_id) {
            payload.document_type = 'van_don';
        }
    }
    return taoPhieuThuKhachHang(Object.assign({}, payload, { payment }));
}

async function computeOrderPaymentBalance(orderId, orderFallback = {}) {
    const invoices = await HoaDonBanHang.find({
        don_hang_id: orderId,
        trang_thai: { $ne: 'cancelled' }
    }).select('thanh_toan').lean();
    const tong_da_thu_receipts = await getOrderPaidAmount(orderId);
    const storedPaid = Math.max(0, Number(orderFallback.khach_thanh_toan || 0));
    const tong_da_thu = tong_da_thu_receipts > 0 ? tong_da_thu_receipts : storedPaid;
    const tong_phai_thu = invoices.length
        ? invoices.reduce((sum, row) => sum + Number(row.thanh_toan || 0), 0)
        : Number(orderFallback.tong_thanh_toan || orderFallback.tong_tien || 0);
    return {
        tong_phai_thu,
        tong_da_thu,
        khach_thanh_toan: tong_da_thu,
        khach_can_tra: Math.max(tong_phai_thu - tong_da_thu, 0)
    };
}

async function applyOrderPaymentBalance(order, orderId = order?._id) {
    const balance = await computeOrderPaymentBalance(orderId, order);
    order.khach_thanh_toan = balance.khach_thanh_toan;
    order.khach_can_tra = balance.khach_can_tra;
    return balance;
}

async function computeDeliveryPaymentDue(orderId, batchPayable, orderFallback = {}) {
    const payable = Math.max(Number(batchPayable || 0), 0);
    if (!orderId || payable <= 0) {
        return {
            batch_payable: payable,
            prepayment_credit: 0,
            amount_due: payable,
            tong_da_thu: 0,
            invoiced_payable: 0
        };
    }

    const invoices = await HoaDonBanHang.find({
        don_hang_id: orderId,
        trang_thai: { $ne: 'cancelled' }
    }).select('thanh_toan').lean();
    const invoicedPayable = invoices.reduce((sum, row) => sum + Number(row.thanh_toan || 0), 0);
    const orderPaid = await getOrderPaidAmount(orderId);
    const storedPaid = Math.max(0, Number(orderFallback.khach_thanh_toan || 0));
    const tongDaThu = orderPaid > 0 ? orderPaid : storedPaid;
    const prepaymentCredit = Math.max(tongDaThu - invoicedPayable, 0);
    const amountDue = Math.max(payable - prepaymentCredit, 0);

    return {
        batch_payable: payable,
        prepayment_credit: prepaymentCredit,
        amount_due: amountDue,
        tong_da_thu: tongDaThu,
        invoiced_payable: invoicedPayable
    };
}

/** Danh s�ch H� c�n n? (theo th? t? t?o) v� t?ng c�n n?. */
async function getOrderInvoiceDebtSummary(orderId) {
    const invoices = await HoaDonBanHang.find({
        don_hang_id: orderId,
        trang_thai: { $ne: 'cancelled' }
    })
        .sort({ created_at: 1 })
        .lean();
    let totalRemaining = 0;
    const openInvoices = [];
    for (const inv of invoices) {
        const paidOnInvoice = await getInvoicePaidAmount(inv._id);
        const remaining = Math.max(Number(inv.thanh_toan || 0) - paidOnInvoice, 0);
        if (remaining > 0) {
            totalRemaining += remaining;
            openInvoices.push({ invoice: inv, remaining, paidOnInvoice });
        }
    }
    return { invoices, openInvoices, totalRemaining };
}

function formatStockQty(value) {
    const number = Number(value || 0);
    return Number.isInteger(number)
        ? number.toLocaleString('vi-VN')
        : number.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
}

function deliveryStockKey(row) {
    return [
        String(row.kho_id || ''),
        String(row.hang_hoa_id || ''),
        String(row.lo_hang_id || ''),
        String(row.gia_tri_thuoc_tinh_id || ''),
        String(row.ten_quy_cach || '').trim()
    ].join('|');
}

function sortStockLotsFefo(a, b) {
    const aLot = a.lo_hang_id;
    const bLot = b.lo_hang_id;
    const aDate = aLot && aLot.han_su_dung ? new Date(aLot.han_su_dung).getTime() : Number.MAX_SAFE_INTEGER;
    const bDate = bLot && bLot.han_su_dung ? new Date(bLot.han_su_dung).getTime() : Number.MAX_SAFE_INTEGER;
    if (aDate !== bDate) return aDate - bDate;
    return new Date(a.updated_at || a.created_at || 0).getTime() - new Date(b.updated_at || b.created_at || 0).getTime();
}

function isSellableStockLot(lot) {
    if (!lot || lot.trang_thai === 'huy') return false;
    if (!lot.han_su_dung) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(lot.han_su_dung);
    expiry.setHours(0, 0, 0, 0);
    return expiry.getTime() >= today.getTime();
}

function isExpiredStockLot(lot) {
    if (!lot || !lot.han_su_dung) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(lot.han_su_dung);
    expiry.setHours(0, 0, 0, 0);
    return expiry.getTime() < today.getTime();
}

function stockShortageMessage(row) {
    const parts = [
        row.ten_hang || row.ma_hang,
        row.ten_quy_cach
    ].filter(Boolean);
    const location = [
        row.kho_ten ? `kho ${row.kho_ten}` : '',
        row.lo_ten ? `lô ${row.lo_ten}` : ''
    ].filter(Boolean).join(', ');
    const label = `${parts.join(' - ')}${location ? ` (${location})` : ''}`;
    return `${label}: Cần giao ${formatStockQty(row.so_luong_can)}, tồn có thể giao ${formatStockQty(row.so_luong_ton)}.`;
}

async function getSellableLotStockRows(khoId, hangHoaId, loHangId) {
    const filter = {
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        so_luong: { $gt: 0 }
    };
    if (loHangId) filter.lo_hang_id = loHangId;
    const rows = await TonKhoLo.find(filter)
        .populate('lo_hang_id')
        .lean();
    return rows.filter(row => isSellableStockLot(row.lo_hang_id)).sort(sortStockLotsFefo);
}

async function getSellableLotQuantity(khoId, hangHoaId, loHangId) {
    const rows = await getSellableLotStockRows(khoId, hangHoaId, loHangId);
    return rows.reduce((sum, row) => {
        const lotQty = Number(row.so_luong || 0);
        const lotRemain = row.lo_hang_id ? Number(row.lo_hang_id.so_luong_con_lai ?? lotQty) : lotQty;
        return sum + Math.max(Math.min(lotQty, lotRemain), 0);
    }, 0);
}

async function getSellableQuyCachQuantity(khoId, hangHoaId, tenQuyCach, loHangId) {
    const filter = {
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        so_luong: { $gt: 0 },
        $or: [{ ten_quy_cach: tenQuyCach }, { ten_thuoc_tinh: tenQuyCach }]
    };
    if (loHangId) filter.lo_hang_id = loHangId;
    const qcRows = await TonKhoLoQuyCach.find(filter)
        .populate('lo_hang_id')
        .lean();
    const lotIds = qcRows.map(row => row.lo_hang_id?._id || row.lo_hang_id).filter(Boolean);
    const lotStocks = lotIds.length
        ? await TonKhoLo.find({ kho_id: khoId, hang_hoa_id: hangHoaId, lo_hang_id: { $in: lotIds } }).lean()
        : [];
    const lotStockMap = lotStocks.reduce((map, row) => {
        map[String(row.lo_hang_id)] = Number(row.so_luong || 0);
        return map;
    }, {});
    return qcRows
        .filter(row => isSellableStockLot(row.lo_hang_id))
        .sort(sortStockLotsFefo)
        .reduce((sum, row) => {
            const lotId = String(row.lo_hang_id?._id || row.lo_hang_id || '');
            const qcQty = Number(row.so_luong || 0);
            const lotQty = Number(lotStockMap[lotId] || 0);
            const lotRemain = row.lo_hang_id ? Number(row.lo_hang_id.so_luong_con_lai ?? lotQty) : lotQty;
            return sum + Math.max(Math.min(qcQty, lotQty, lotRemain), 0);
        }, 0);
}

async function getExpiredLotQuantity(khoId, hangHoaId, loHangId) {
    const filter = {
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        so_luong: { $gt: 0 }
    };
    if (loHangId) filter.lo_hang_id = loHangId;
    const rows = await TonKhoLo.find(filter)
        .populate('lo_hang_id')
        .lean();
    return rows.reduce((sum, row) => {
        if (!isExpiredStockLot(row.lo_hang_id) || row.lo_hang_id?.trang_thai === 'huy') return sum;
        return sum + Math.max(Number(row.so_luong || 0), 0);
    }, 0);
}

async function getExpiredQuyCachQuantity(khoId, hangHoaId, tenQuyCach, loHangId) {
    const filter = {
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        so_luong: { $gt: 0 },
        $or: [{ ten_quy_cach: tenQuyCach }, { ten_thuoc_tinh: tenQuyCach }]
    };
    if (loHangId) filter.lo_hang_id = loHangId;
    const rows = await TonKhoLoQuyCach.find(filter)
        .populate('lo_hang_id')
        .lean();
    return rows.reduce((sum, row) => {
        if (!isExpiredStockLot(row.lo_hang_id) || row.lo_hang_id?.trang_thai === 'huy') return sum;
        return sum + Math.max(Number(row.so_luong || 0), 0);
    }, 0);
}

async function validateDeliveryStockPreflight(khoId, warehouse, deliveryLines) {
    const groups = new Map();
    for (const line of deliveryLines) {
        const detail = line.detail;
        const row = {
            kho_id: khoId,
            hang_hoa_id: line.hang_hoa_id,
            lo_hang_id: line.lo_hang_id || '',
            gia_tri_thuoc_tinh_id: detail.gia_tri_thuoc_tinh_id || '',
            ten_quy_cach: String(detail.ten_quy_cach || detail.ten_thuoc_tinh || '').trim(),
            so_luong: Number(line.quantity || 0),
            ma_hang: detail.ma_hang_snapshot || '',
            ten_hang: detail.ten_hang_snapshot || '',
            kho_ten: warehouse.ten_kho || warehouse.ma_kho || ''
        };
        const key = deliveryStockKey(row);
        const current = groups.get(key) || Object.assign({}, row, { so_luong: 0, detail_ids: [] });
        current.so_luong += row.so_luong;
        current.detail_ids.push(String(detail._id));
        groups.set(key, current);
    }

    const productIds = [...new Set([...groups.values()].map(row => String(row.hang_hoa_id)))];
    const products = productIds.length
        ? await HangHoa.find({ _id: { $in: productIds } }).select('ma_hang ten_hang quan_ly_theo_lo').lean()
        : [];
    const productMap = products.reduce((map, product) => {
        map[String(product._id)] = product;
        return map;
    }, {});

    const shortages = [];
    const productTotals = {};
    const lotTotals = {};
    for (const group of groups.values()) {
        const product = productMap[String(group.hang_hoa_id)] || {};
        group.ma_hang = group.ma_hang || product.ma_hang || '';
        group.ten_hang = group.ten_hang || product.ten_hang || '';
        group.quan_ly_theo_lo = Boolean(product.quan_ly_theo_lo);
        const productKey = String(group.hang_hoa_id);
        productTotals[productKey] = (productTotals[productKey] || 0) + group.so_luong;
        if (group.quan_ly_theo_lo && group.lo_hang_id && !(group.ten_quy_cach || group.gia_tri_thuoc_tinh_id)) {
            const lotKey = [String(group.hang_hoa_id), String(group.lo_hang_id)].join('|');
            lotTotals[lotKey] = (lotTotals[lotKey] || 0) + group.so_luong;
        }
    }

    for (const [productId, requiredQty] of Object.entries(productTotals)) {
        const stock = await TonKho.findOne({ kho_id: khoId, hang_hoa_id: productId }).lean();
        const available = Number(stock?.so_luong || 0);
        if (available < requiredQty) {
            const product = productMap[productId] || {};
            shortages.push({
                cap_ton: 'TonKho',
                ma_hang: product.ma_hang || '',
                ten_hang: product.ten_hang || '',
                kho_ten: warehouse.ten_kho || warehouse.ma_kho || '',
                so_luong_can: requiredQty,
                so_luong_ton: available
            });
        }
    }

    for (const [key, requiredQty] of Object.entries(lotTotals)) {
        const [productId, lotId] = key.split('|');
        const lotStock = await TonKhoLo.findOne({ kho_id: khoId, hang_hoa_id: productId, lo_hang_id: lotId }).lean();
        const lot = await LoHang.findById(lotId).lean();
        const rawAvailable = Math.min(Number(lotStock?.so_luong || 0), Number(lot?.so_luong_con_lai ?? lotStock?.so_luong ?? 0));
        const available = isSellableStockLot(lot) ? rawAvailable : 0;
        const expiredQty = isExpiredStockLot(lot) && lot?.trang_thai !== 'huy' ? Math.max(Number(lotStock?.so_luong || 0), 0) : 0;
        if (available < requiredQty) {
            const product = productMap[productId] || {};
            shortages.push({
                cap_ton: 'TonKhoLo',
                ma_hang: product.ma_hang || '',
                ten_hang: product.ten_hang || '',
                kho_ten: warehouse.ten_kho || warehouse.ma_kho || '',
                lo_ten: lot?.ten_lo || lot?.ma_lo || '',
                so_luong_can: requiredQty,
                so_luong_ton: available,
                so_luong_het_han: expiredQty,
                nguyen_nhan: expiredQty > 0 && available <= 0 ? 'het_han' : 'thieu_ton'
            });
        }
    }

    for (const group of groups.values()) {
        if (!group.quan_ly_theo_lo) continue;
        if (group.ten_quy_cach || group.gia_tri_thuoc_tinh_id) {
            const available = group.ten_quy_cach
                ? await getSellableQuyCachQuantity(khoId, group.hang_hoa_id, group.ten_quy_cach, group.lo_hang_id)
                : 0;
            if (available < group.so_luong) {
                let lotName = '';
                if (group.lo_hang_id) {
                    const lot = await LoHang.findById(group.lo_hang_id).lean();
                    lotName = lot?.ten_lo || lot?.ma_lo || '';
                }
                const expiredQty = group.ten_quy_cach
                    ? await getExpiredQuyCachQuantity(khoId, group.hang_hoa_id, group.ten_quy_cach, group.lo_hang_id)
                    : 0;
                shortages.push(Object.assign({}, group, {
                    cap_ton: 'TonKhoLoQuyCach',
                    lo_ten: lotName,
                    so_luong_can: group.so_luong,
                    so_luong_ton: available,
                    so_luong_het_han: expiredQty,
                    nguyen_nhan: expiredQty > 0 && available <= 0 ? 'het_han' : 'thieu_ton'
                }));
            }
        } else {
            const available = await getSellableLotQuantity(khoId, group.hang_hoa_id, group.lo_hang_id);
            if (available < group.so_luong) {
                let lotName = '';
                if (group.lo_hang_id) {
                    const lot = await LoHang.findById(group.lo_hang_id).lean();
                    lotName = lot?.ten_lo || lot?.ma_lo || '';
                }
                const expiredQty = await getExpiredLotQuantity(khoId, group.hang_hoa_id, group.lo_hang_id);
                shortages.push(Object.assign({}, group, {
                    cap_ton: 'TonKhoLo',
                    lo_ten: lotName,
                    so_luong_can: group.so_luong,
                    so_luong_ton: available,
                    so_luong_het_han: expiredQty,
                    nguyen_nhan: expiredQty > 0 && available <= 0 ? 'het_han' : 'thieu_ton'
                }));
            }
        }
    }

    if (shortages.length) {
        return {
            valid: false,
            shortages,
            message: shortages.map(stockShortageMessage).join(' ')
        };
    }
    return { valid: true, shortages: [] };
}

async function rollbackDeliveryInvoice(invoiceId, options = {}) {
    if (!invoiceId) return;
    const invoice = await HoaDonBanHang.findById(invoiceId).lean();
    if (!invoice) return;

    const invoiceLines = await CTHoaDonBanHang.find({ hoa_don_id: invoiceId }).lean();
    const khoId = options.kho_id || invoice.kho_id;
    const maPhieu = invoice.ma_hoa_don || String(invoiceId);
    const stockLines = Array.isArray(options.stockLines) && options.stockLines.length
        ? options.stockLines
        : (options.restoreStock === false ? [] : invoiceLines);

    for (const line of stockLines) {
        await restoreStockLine(khoId, line, {
            nguoi_tao_id: options.nguoi_tao_id,
            loai_phieu: 'rollback_ban_hang',
            ma_phieu: maPhieu,
            ghi_chu: options.ghi_chu || `Hoàn trả Hàng ${maPhieu}`
        });
    }

    if (options.revertOrderLines) {
        for (const line of invoiceLines) {
            if (!line.ct_don_hang_id) continue;
            const detail = await CTDonHang.findById(line.ct_don_hang_id);
            if (!detail) continue;
            const qty = Number(line.so_luong || 0);
            const orderedQuantity = Number(detail.so_luong_dat || detail.so_luong || 0);
            const deliveredAfter = Math.max(Number(detail.so_luong_da_giao || 0) - qty, 0);
            const missingAfter = Math.max(orderedQuantity - deliveredAfter, 0);
            detail.so_luong_da_giao = deliveredAfter;
            detail.so_luong_con_thieu = missingAfter;
            detail.so_luong_xac_nhan = Math.max(Number(detail.so_luong_xac_nhan || 0) - qty, 0);
            detail.trang_thai_giao = deliveredAfter <= 0
                ? 'chua_giao'
                : (missingAfter <= 0 ? 'giao_du' : 'giao_thieu');
            await detail.save();
        }
    }

    const debtRows = await CongNoKhachHang.find({ hoa_don_id: invoiceId }).lean();
    let debtDelta = 0;
    for (const row of debtRows) {
        const amount = Math.abs(Number(row.so_tien || 0));
        if (row.loai === 'tang_no') debtDelta -= amount;
        else if (row.loai === 'giam_no') debtDelta += amount;
    }
    if (invoice.khach_hang_id && debtDelta !== 0) {
        await KhachHang.updateOne({ _id: invoice.khach_hang_id }, { $inc: { tong_no: debtDelta } });
    }
    await CongNoKhachHang.deleteMany({ hoa_don_id: invoiceId });

    const receipts = await PhieuThuChi.find({
        hoa_don_id: invoiceId,
        trang_thai: { $ne: 'cancelled' }
    });
    for (const receipt of receipts) {
        receipt.trang_thai = 'cancelled';
        await receipt.save();
    }

    await CTHoaDonBanHang.deleteMany({ hoa_don_id: invoiceId });
    await HoaDonBanHang.findByIdAndDelete(invoiceId);
}

async function generateInvoiceCode() {
    const lastInvoice = await HoaDonBanHang.findOne({ ma_hoa_don: /^HD\d+$/ })
        .sort({ ma_hoa_don: -1 })
        .select('ma_hoa_don')
        .lean();
    const currentMax = Number(String(lastInvoice?.ma_hoa_don || '').replace(/^HD/, '')) || 0;
    await Counter.updateOne(
        { _id: 'hoa_don_ban_hang' },
        { $max: { seq: currentMax } },
        { upsert: true }
    );
    const counter = await Counter.findOneAndUpdate(
        { _id: 'hoa_don_ban_hang' },
        { $inc: { seq: 1 } },
        { new: true }
    ).lean();
    return 'HD' + String(counter.seq).padStart(6, '0');
}

async function generateOrderCode() {
    const lastOrder = await DonHang.findOne({ ma_don_hang: /^DH\d+$/ })
        .sort({ ma_don_hang: -1 })
        .select('ma_don_hang')
        .lean();
    const currentMax = Number(String(lastOrder?.ma_don_hang || '').replace(/^DH/, '')) || 0;
    await Counter.updateOne(
        { _id: 'don_hang' },
        { $max: { seq: currentMax } },
        { upsert: true }
    );
    const counter = await Counter.findOneAndUpdate(
        { _id: 'don_hang' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    ).lean();
    return 'DH' + String(counter.seq).padStart(6, '0');
}

async function generateShipmentCode() {
    const lastShipment = await VanDon.findOne({ ma_van_don: /^VD\d+$/ })
        .sort({ ma_van_don: -1 })
        .select('ma_van_don')
        .lean();
    const currentMax = Number(String(lastShipment?.ma_van_don || '').replace(/^VD/, '')) || 0;
    await Counter.updateOne(
        { _id: 'van_don' },
        { $max: { seq: currentMax } },
        { upsert: true }
    );
    const counter = await Counter.findOneAndUpdate(
        { _id: 'van_don' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    ).lean();
    return 'VD' + String(counter.seq).padStart(6, '0');
}

async function generateMergeInvoiceCode(session = null) {
    const lastMerge = await GopHoaDon.findOne({ ma_gop_hoa_don: /^GHD\d+$/ })
        .sort({ ma_gop_hoa_don: -1 })
        .select('ma_gop_hoa_don')
        .session(session)
        .lean();
    const currentMax = Number(String(lastMerge?.ma_gop_hoa_don || '').replace(/^GHD/, '')) || 0;
    await Counter.updateOne(
        { _id: 'gop_hoa_don' },
        { $max: { seq: currentMax } },
        { upsert: true, session }
    );
    const counter = await Counter.findOneAndUpdate(
        { _id: 'gop_hoa_don' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, session }
    ).lean();
    return 'GHD' + String(counter.seq).padStart(6, '0');
}

function invoiceCustomerPhone(invoice, shipment) {
    return normalizePhone(
        invoice?.khach_hang_id?.sdt
        || invoice?.khach_hang_id?.sdt2
        || invoice?.khach_hang_id?.dien_thoai
        || shipment?.sdt_nguoi_nhan
    );
}

function invoiceMergeLineKey(row = {}) {
    const lotKey = Array.isArray(row.lot_allocations) && row.lot_allocations.length
        ? row.lot_allocations
            .map(item => `${String(item.lo_hang_id || '')}:${Number(item.so_luong || 0)}`)
            .sort()
            .join(',')
        : String(row.lo_hang_id || '');
    return [
        String(row.hang_hoa_id || ''),
        lotKey,
        String(row.gia_tri_thuoc_tinh_id || ''),
        String(row.ten_quy_cach || '').trim(),
        Number(row.don_gia || 0),
        Number(row.chiet_khau || 0)
    ].join('|');
}

function mergeInvoiceLotAllocations(target = [], source = []) {
    const map = new Map();
    (target || []).forEach(item => {
        const key = String(item.lo_hang_id || '');
        map.set(key, {
            lo_hang_id: item.lo_hang_id || null,
            ma_lo: item.ma_lo || '',
            ten_lo: item.ten_lo || '',
            han_su_dung: item.han_su_dung || null,
            so_luong: Number(item.so_luong || 0)
        });
    });
    (source || []).forEach(item => {
        const key = String(item.lo_hang_id || '');
        const qty = Number(item.so_luong || 0);
        if (!qty) return;
        if (map.has(key)) {
            map.get(key).so_luong += qty;
        } else {
            map.set(key, {
                lo_hang_id: item.lo_hang_id || null,
                ma_lo: item.ma_lo || '',
                ten_lo: item.ten_lo || '',
                han_su_dung: item.han_su_dung || null,
                so_luong: qty
            });
        }
    });
    return Array.from(map.values()).filter(item => Number(item.so_luong || 0) > 0);
}

function recalcInvoiceLineTotal(line) {
    const quantity = Math.max(0, Number(line.so_luong || 0));
    const unitPrice = Number(line.don_gia || 0);
    const discount = Math.max(0, Number(line.chiet_khau || 0));
    line.thanh_tien = Math.max(quantity * unitPrice - discount, 0);
    return line.thanh_tien;
}

function cloneMergedInvoiceLine(line, receivingInvoiceId) {
    const quantity = Number(line.so_luong || 0);
    const cloned = {
        hoa_don_id: receivingInvoiceId,
        ct_don_hang_id: line.ct_don_hang_id || null,
        hang_hoa_id: line.hang_hoa_id,
        lo_hang_id: line.lo_hang_id || null,
        lot_allocations: Array.isArray(line.lot_allocations) ? line.lot_allocations.map(item => ({
            lo_hang_id: item.lo_hang_id || null,
            ma_lo: item.ma_lo || '',
            ten_lo: item.ten_lo || '',
            han_su_dung: item.han_su_dung || null,
            so_luong: Number(item.so_luong || 0)
        })) : [],
        gia_tri_thuoc_tinh_id: line.gia_tri_thuoc_tinh_id || null,
        ten_quy_cach: String(line.ten_quy_cach || '').trim(),
        ten_thuoc_tinh: String(line.ten_thuoc_tinh || '').trim(),
        don_vi_tinh_id: line.don_vi_tinh_id || null,
        ma_hang_snapshot: String(line.ma_hang_snapshot || ''),
        ten_hang_snapshot: String(line.ten_hang_snapshot || ''),
        don_vi_tinh_snapshot: String(line.don_vi_tinh_snapshot || ''),
        so_luong: quantity,
        don_gia: Number(line.don_gia || 0),
        chiet_khau: Number(line.chiet_khau || 0),
        thanh_tien: 0,
        ghi_chu: String(line.ghi_chu || '')
    };
    recalcInvoiceLineTotal(cloned);
    return cloned;
}

function applyInvoiceTotals(invoice, lines, paidAmount) {
    const goodsTotal = (lines || []).reduce((sum, line) => sum + Number(line.thanh_tien || 0), 0);
    const discount = Math.max(0, Number(invoice.giam_gia || 0));
    const payable = Math.max(goodsTotal - discount, 0);
    const paid = Math.max(0, Number(paidAmount || 0));
    invoice.tong_tien = goodsTotal;
    invoice.thanh_toan = payable;
    invoice.trang_thai = resolveInvoiceStatus(payable, paid);
}

async function loadInvoiceNetPaidMap(invoiceIds, session) {
    const ids = (invoiceIds || []).filter(Boolean);
    const paidMap = {};
    if (!ids.length) return paidMap;
    const receipts = await PhieuThuChi.find({
        hoa_don_id: { $in: ids },
        trang_thai: { $ne: 'cancelled' }
    }).session(session).lean();
    const grouped = {};
    receipts.forEach(row => {
        const key = String(row.hoa_don_id || '');
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(row);
    });
    Object.keys(grouped).forEach(key => {
        paidMap[key] = computeNetPaidFromReceiptRows(grouped[key]);
    });
    return paidMap;
}

function invoiceShipmentBlocksMerge(shipment) {
    if (!shipment) return false;
    return ['shipping', 'completed'].includes(String(shipment.trang_thai || ''));
}

async function mergeInvoicesInSession(req, session) {
    const body = req.body || {};
    const invoiceIds = uniqueObjectIds(Array.isArray(body.hoa_don_ids) ? body.hoa_don_ids : [])
        .map(id => String(id));
    if (invoiceIds.length < 2) {
        const error = new Error('Vui lòng chọn ít nhất 2 hóa đơn để gộp.');
        error.status = 400;
        throw error;
    }
    const receivingInvoiceId = body.hoa_don_nhan_id && invoiceIds.includes(String(body.hoa_don_nhan_id))
        ? String(body.hoa_don_nhan_id)
        : invoiceIds[0];
    const sourceInvoiceIds = invoiceIds.filter(id => id !== receivingInvoiceId);
    const note = String(body.ghi_chu || '').trim();

    const invoices = await HoaDonBanHang.find({ _id: { $in: invoiceIds } })
        .populate('khach_hang_id')
        .session(session);
    if (invoices.length !== invoiceIds.length) {
        const error = new Error('Một hoặc nhiều hóa đơn không tồn tại.');
        error.status = 400;
        throw error;
    }
    const invoiceById = new Map(invoices.map(invoice => [String(invoice._id), invoice]));
    const receivingInvoice = invoiceById.get(receivingInvoiceId);
    const sourceInvoices = sourceInvoiceIds.map(id => invoiceById.get(id));

    const storeIds = new Set(invoices.map(invoice => String(invoice.cua_hang_id || '')).filter(Boolean));
    if (storeIds.size !== 1) {
        const error = new Error('Không thể gộp các hóa đơn khác của hàng.');
        error.status = 400;
        throw error;
    }

    const warehouseIds = new Set(invoices.map(invoice => String(invoice.kho_id || '')).filter(Boolean));
    if (warehouseIds.size > 1) {
        const error = new Error('Không thể gộp các hóa đơn khác kho trong phase này.');
        error.status = 400;
        throw error;
    }

    const [shipments] = await Promise.all([
        VanDon.find({
            $or: [
                { hoa_don_id: { $in: invoiceIds } },
                { don_hang_id: { $in: invoices.map(item => item.don_hang_id).filter(Boolean) } }
            ],
            trang_thai: { $ne: 'cancelled' }
        }).session(session)
    ]);
    const shipmentByInvoice = {};
    shipments.forEach(shipment => {
        if (shipment.hoa_don_id) shipmentByInvoice[String(shipment.hoa_don_id)] = shipment;
    });
    invoices.forEach(invoice => {
        const orderId = String(invoice.don_hang_id || '');
        if (!orderId) return;
        const shipment = shipments.find(row => String(row.don_hang_id || '') === orderId);
        if (shipment && !shipmentByInvoice[String(invoice._id)]) {
            shipmentByInvoice[String(invoice._id)] = shipment;
        }
    });
    const customerIds = new Set(invoices.map(invoice => String(invoice.khach_hang_id?._id || invoice.khach_hang_id || '')).filter(Boolean));
    const phones = new Set(invoices.map(invoice => {
        const shipment = shipmentByInvoice[String(invoice._id)];
        return invoiceCustomerPhone(invoice, shipment);
    }).filter(Boolean));
    if (customerIds.size !== 1 && phones.size !== 1) {
        const error = new Error('Không thể gộp các hóa đơn khác khách hàng hoặc khác số điện thoại.');
        error.status = 400;
        throw error;
    }

    const details = await CTHoaDonBanHang.find({ hoa_don_id: { $in: invoiceIds } }).session(session);
    const detailMap = details.reduce((map, detail) => {
        const key = String(detail.hoa_don_id || '');
        if (!map[key]) map[key] = [];
        map[key].push(detail);
        return map;
    }, {});

    const returnRows = await PhieuTraHang.find({
        hoa_don_id: { $in: invoiceIds },
        trang_thai: { $ne: 'cancelled' }
    }).select('hoa_don_id ma_phieu_tra').session(session).lean();
    const returnInvoiceIds = new Set(returnRows.map(row => String(row.hoa_don_id || '')));

    for (const invoice of invoices) {
        const status = normalizeInvoiceStatus(invoice.trang_thai);
        if (['cancelled', 'merged'].includes(status)) {
            const message = status === 'merged'
                ? `Hóa đơn ${invoice.ma_hoa_don} đã được gộp vào ${invoice.merged_to_ma_hoa_don || 'hóa đơn khác'}.`
                : `Không thể gộp hóa đơn ${invoice.ma_hoa_don} ở trạng thái hiện tại.`;
            const error = new Error(message);
            error.status = 400;
            throw error;
        }
        if (returnInvoiceIds.has(String(invoice._id))) {
            const error = new Error(`Không thể gộp hóa đơn ${invoice.ma_hoa_don} vì đã phát sinh trả hàng.`);
            error.status = 400;
            throw error;
        }
    }

    const paidMap = await loadInvoiceNetPaidMap(invoiceIds, session);
    const allPaidBefore = invoices.reduce((sum, invoice) => sum + Number(paidMap[String(invoice._id)] || 0), 0);
    const allGoodsBefore = invoices.reduce((sum, invoice) => sum + Number(invoice.tong_tien || 0), 0);
    const allDiscountBefore = invoices.reduce((sum, invoice) => sum + Number(invoice.giam_gia || 0), 0);

    const receivingLines = detailMap[receivingInvoiceId] || [];
    const receivingLineByKey = new Map(receivingLines.map(line => [invoiceMergeLineKey(line), line]));

    for (const sourceInvoice of sourceInvoices) {
        const sourceLines = detailMap[String(sourceInvoice._id)] || [];
        for (const sourceLine of sourceLines) {
            const key = invoiceMergeLineKey(sourceLine);
            const sourceQuantity = Number(sourceLine.so_luong || 0);
            const targetLine = receivingLineByKey.get(key);
            if (targetLine) {
                targetLine.so_luong = Number(targetLine.so_luong || 0) + sourceQuantity;
                targetLine.lot_allocations = mergeInvoiceLotAllocations(targetLine.lot_allocations, sourceLine.lot_allocations);
                recalcInvoiceLineTotal(targetLine);
                await targetLine.save({ session });
            } else {
                const clonedLine = await CTHoaDonBanHang.create([cloneMergedInvoiceLine(sourceLine, receivingInvoice._id)], { session });
                receivingLines.push(clonedLine[0]);
                receivingLineByKey.set(key, clonedLine[0]);
            }
        }
    }

    const updatedReceivingLines = await CTHoaDonBanHang.find({ hoa_don_id: receivingInvoice._id }).session(session);
    receivingInvoice.giam_gia = allDiscountBefore;
    applyInvoiceTotals(receivingInvoice, updatedReceivingLines, allPaidBefore);
    receivingInvoice.is_merged_invoice = true;
    receivingInvoice.merged_from_hoa_don_ids = uniqueObjectIds([
        ...(receivingInvoice.merged_from_hoa_don_ids || []),
        ...sourceInvoices.map(invoice => invoice._id)
    ]);
    receivingInvoice.merged_from_ma_hoa_dons = Array.from(new Set([
        ...(receivingInvoice.merged_from_ma_hoa_dons || []),
        ...sourceInvoices.map(invoice => invoice.ma_hoa_don).filter(Boolean)
    ]));
    receivingInvoice.merged_at = new Date();
    receivingInvoice.merged_by = req.user?._id;
    receivingInvoice.merge_note = note;
    await receivingInvoice.save({ session });

    await HoaDonBanHang.updateMany(
        { _id: { $in: sourceInvoices.map(invoice => invoice._id) } },
        {
            $set: {
                trang_thai: 'merged',
                merged_to_hoa_don_id: receivingInvoice._id,
                merged_to_ma_hoa_don: receivingInvoice.ma_hoa_don,
                merged_at: receivingInvoice.merged_at,
                merged_by: req.user?._id,
                merge_note: note
            }
        },
        { session }
    );

    await PhieuThuChi.updateMany(
        { hoa_don_id: { $in: sourceInvoices.map(invoice => invoice._id) }, trang_thai: { $ne: 'cancelled' } },
        { $set: { hoa_don_id: receivingInvoice._id } },
        { session }
    );
    await CongNoKhachHang.updateMany(
        { hoa_don_id: { $in: sourceInvoices.map(invoice => invoice._id) } },
        { $set: { hoa_don_id: receivingInvoice._id } },
        { session }
    );
    await VanDon.updateMany(
        {
            hoa_don_id: { $in: sourceInvoices.map(invoice => invoice._id) },
            trang_thai: { $ne: 'cancelled' }
        },
        {
            $set: {
                trang_thai: 'cancelled',
                ghi_chu: `Vận đơn bị hủy do hóa đơn đã gộp vào ${receivingInvoice.ma_hoa_don}`
            }
        },
        { session }
    );

    const maGopHoaDon = await generateMergeInvoiceCode(session);
    const mergeRecord = await GopHoaDon.create([{
        ma_gop_hoa_don: maGopHoaDon,
        cua_hang_id: receivingInvoice.cua_hang_id,
        hoa_don_nhan_id: receivingInvoice._id,
        ma_hoa_don_nhan: receivingInvoice.ma_hoa_don,
        khach_hang_id: receivingInvoice.khach_hang_id?._id || receivingInvoice.khach_hang_id || null,
        sdt_khach_hang: invoiceCustomerPhone(receivingInvoice, shipmentByInvoice[receivingInvoiceId]),
        hoa_don_nguon_ids: sourceInvoices.map(invoice => invoice._id),
        ma_hoa_don_nguon: sourceInvoices.map(invoice => invoice.ma_hoa_don),
        tong_tien_hang_truoc_gop: allGoodsBefore,
        tong_khach_da_tra_truoc_gop: allPaidBefore,
        tong_tien_hang_sau_gop: Number(receivingInvoice.tong_tien || 0),
        tong_khach_da_tra_sau_gop: allPaidBefore,
        so_luong_hoa_don_gop: invoices.length,
        ghi_chu: note,
        trang_thai: 'active',
        nguoi_tao_id: req.user?._id,
        ngay_gop: receivingInvoice.merged_at
    }], { session });

    return {
        gop_hoa_don_id: mergeRecord[0]._id,
        ma_gop_hoa_don: mergeRecord[0].ma_gop_hoa_don,
        hoa_don_nhan_id: receivingInvoice._id,
        ma_hoa_don_nhan: receivingInvoice.ma_hoa_don,
        hoa_don_nguon_ids: sourceInvoices.map(invoice => invoice._id),
        ma_hoa_don_nguon: sourceInvoices.map(invoice => invoice.ma_hoa_don),
        tong_tien_hang_sau_gop: Number(receivingInvoice.tong_tien || 0),
        tong_khach_da_tra_sau_gop: allPaidBefore
    };
}

async function generateMergeOrderCode(session = null) {
    const lastMerge = await GopDonHang.findOne({ ma_gop_don: /^GDH\d+$/ })
        .sort({ ma_gop_don: -1 })
        .select('ma_gop_don')
        .session(session)
        .lean();
    const currentMax = Number(String(lastMerge?.ma_gop_don || '').replace(/^GDH/, '')) || 0;
    await Counter.updateOne(
        { _id: 'gop_don_hang' },
        { $max: { seq: currentMax } },
        { upsert: true, session }
    );
    const counter = await Counter.findOneAndUpdate(
        { _id: 'gop_don_hang' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, session }
    ).lean();
    return 'GDH' + String(counter.seq).padStart(6, '0');
}

function normalizePhone(value) {
    return String(value || '').replace(/\D/g, '');
}

function sameObjectIdValue(a, b) {
    return String(a || '') === String(b || '');
}

function orderCustomerPhone(order) {
    return normalizePhone(order?.khach_hang_id?.sdt || order?.khach_hang_id?.dien_thoai || order?.khach_hang_id?.sdt2 || '');
}

function mergeLineKey(row = {}) {
    return [
        String(row.hang_hoa_id || ''),
        String(row.lo_hang_id || ''),
        String(row.gia_tri_thuoc_tinh_id || ''),
        String(row.ten_quy_cach || '').trim(),
        Number(row.don_gia_ban || 0),
        Number(row.chiet_khau || 0),
        String(row.kieu_chiet_khau || 'vnd')
    ].join('|');
}

function calcLineTotal(line) {
    const quantity = Number(line.so_luong_dat || line.so_luong || 0);
    const unitPrice = Number(line.don_gia_ban || 0);
    const base = quantity * unitPrice;
    const discount = line.kieu_chiet_khau === 'phan_tram'
        ? base * Math.max(0, Number(line.chiet_khau || 0)) / 100
        : Math.max(0, Number(line.chiet_khau || 0));
    return Math.max(base - discount, 0);
}

function cloneMergedLine(line, receivingOrderId) {
    const quantity = Number(line.so_luong_dat || line.so_luong || 0);
    return {
        don_hang_id: receivingOrderId,
        hang_hoa_id: line.hang_hoa_id,
        gia_tri_thuoc_tinh_id: line.gia_tri_thuoc_tinh_id || null,
        ten_quy_cach: String(line.ten_quy_cach || '').trim(),
        ten_thuoc_tinh: String(line.ten_thuoc_tinh || '').trim(),
        don_vi_tinh_id: line.don_vi_tinh_id || null,
        so_luong: quantity,
        so_luong_dat: quantity,
        so_luong_xac_nhan: 0,
        so_luong_da_giao: 0,
        so_luong_con_thieu: quantity,
        trang_thai_giao: 'chua_giao',
        lo_hang_id: line.lo_hang_id || null,
        don_gia_ban: Number(line.don_gia_ban || 0),
        ma_hang_snapshot: String(line.ma_hang_snapshot || ''),
        ten_hang_snapshot: String(line.ten_hang_snapshot || ''),
        don_vi_tinh_snapshot: String(line.don_vi_tinh_snapshot || ''),
        gia_goc: Number(line.gia_goc || 0),
        chiet_khau: Number(line.chiet_khau || 0),
        kieu_chiet_khau: line.kieu_chiet_khau === 'phan_tram' ? 'phan_tram' : 'vnd',
        thanh_tien: calcLineTotal(line),
        ghi_chu: String(line.ghi_chu || '')
    };
}

function applyOrderTotals(order, lines, paidAmount) {
    const goodsTotal = lines.reduce((sum, line) => sum + Number(line.thanh_tien || 0), 0);
    const orderDiscount = order.kieu_giam_gia === 'phan_tram'
        ? goodsTotal * Math.max(0, Number(order.giam_gia || 0)) / 100
        : Math.max(0, Number(order.giam_gia || 0));
    const payable = Math.max(goodsTotal - orderDiscount, 0);
    const paid = Math.max(0, Number(paidAmount || 0));
    order.tong_tien_hang = goodsTotal;
    order.tong_tien = payable;
    order.tong_thanh_toan = payable;
    order.khach_thanh_toan = paid;
    order.tien_thua_tra_khach = Math.max(paid - payable, 0);
    order.khach_can_tra = Math.max(payable - paid, 0);
}

function uniqueObjectIds(values) {
    const seen = new Set();
    return (values || []).filter(value => {
        const key = String(value || '');
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function resolveInvoiceStatus(payable, paid) {
    if (paid >= payable) return 'paid';
    if (paid > 0) return 'partial';
    return 'unpaid';
}

async function ensureHoaDonDonHangIndex() {
    try {
        if (HoaDonBanHang.db.readyState !== 1) {
            await HoaDonBanHang.db.asPromise();
        }
        const collection = HoaDonBanHang.collection;
        const indexes = await collection.indexes();
        for (const index of indexes) {
            if (index.key && index.key.don_hang_id === 1 && index.unique) {
                await collection.dropIndex(index.name);
                console.log('[InvoiceIndex] Dropped unique don_hang_id index:', index.name);
            }
        }
        const hasPlainIndex = (await collection.indexes()).some(
            index => index.key && index.key.don_hang_id === 1 && !index.unique
        );
        if (!hasPlainIndex) {
            await collection.createIndex({ don_hang_id: 1 }, { name: 'don_hang_id_1', background: true });
        }
    } catch (error) {
        console.error('[InvoiceIndex] Cannot ensure don_hang_id index:', error.message);
    }
}

ensureHoaDonDonHangIndex();

function applyIdIntersection(filter, field, ids) {
    const cleanIds = ids.filter(Boolean);
    if (!filter[field]) {
        filter[field] = { $in: cleanIds };
        return;
    }
    const currentIds = (filter[field].$in || []).map(id => String(id));
    const allowed = new Set(cleanIds.map(id => String(id)));
    filter[field].$in = currentIds.filter(id => allowed.has(id));
}

async function userIdFilter(value) {
    if (!value || value.trim() === '') return null;
    if (/^[0-9a-fA-F]{24}$/.test(value)) return [value];
    const users = await NguoiDung.find({
        $or: [
            { ho_ten: { $regex: value.trim(), $options: 'i' } },
            { username: { $regex: value.trim(), $options: 'i' } },
            { email: { $regex: value.trim(), $options: 'i' } }
        ]
    }).select('_id');
    return users.map(user => user._id);
}

async function seedVanDonIfEmpty(userId) {
    const shipmentCount = await VanDon.countDocuments();
    if (shipmentCount > 0) return;

    let store = await CuaHang.findOne().sort({ created_at: 1 });
    if (!store) {
        store = await CuaHang.create({
            ma_cua_hang: 'CH_DEMO_VD',
            ten_cua_hang: 'Cua hang demo',
            dia_chi_chi_tiet: '12 Nguyen Trai',
            dia_chi_day_du: '12 Nguyen Trai, Thuong Dinh, Ha Noi',
            tinh_thanh: 'Ha Noi',
            phuong_xa: 'Thuong Dinh',
            sdt: '0901000001',
            email: 'demo-store@example.com',
            trang_thai: 'active'
        });
    }

    let partners = await DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ ten_doi_tac: 1 });
    if (partners.length === 0) {
        partners = await DoiTacGiaoHang.insertMany([
            {
                cua_hang_id: store._id,
                ma_doi_tac: 'GHN_DEMO',
                ten_doi_tac: 'GHN Express',
                sdt: '1900636677',
                email: 'demo-ghn@example.com',
                dia_chi_chi_tiet: 'Ha Noi',
                dia_chi_day_du: 'Ha Noi',
                ghi_chu: 'Du lieu mau',
                trang_thai: 'active'
            },
            {
                cua_hang_id: store._id,
                ma_doi_tac: 'GHTK_DEMO',
                ten_doi_tac: 'Giao Hang Tiet Kiem',
                sdt: '19006092',
                email: 'demo-ghtk@example.com',
                dia_chi_chi_tiet: 'TP Ho Chi Minh',
                dia_chi_day_du: 'TP Ho Chi Minh',
                ghi_chu: 'Du lieu mau',
                trang_thai: 'active'
            }
        ]);
    }

    let customers = await KhachHang.find().sort({ created_at: 1 }).limit(3);
    if (customers.length === 0) {
        customers = await KhachHang.insertMany([
            {
                cua_hang_id: store._id,
                ma_khach_hang: 'KH_DEMO_001',
                ten_khach_hang: 'Nguyen Van Minh',
                ten_ca_nhan: 'Nguyen Van Minh',
                sdt: '0912345678',
                email: 'minh.demo@example.com',
                khu_vuc_giao_hang: 'Ha Noi',
                trang_thai: 'active'
            },
            {
                cua_hang_id: store._id,
                ma_khach_hang: 'KH_DEMO_002',
                ten_khach_hang: 'Tran Thi Lan',
                ten_ca_nhan: 'Tran Thi Lan',
                sdt: '0987654321',
                email: 'lan.demo@example.com',
                khu_vuc_giao_hang: 'TP Ho Chi Minh',
                trang_thai: 'active'
            },
            {
                cua_hang_id: store._id,
                ma_khach_hang: 'KH_DEMO_003',
                ten_khach_hang: 'Cong ty An Phat',
                ten_cong_ty: 'Cong ty An Phat',
                sdt: '0909888777',
                email: 'anphat.demo@example.com',
                khu_vuc_giao_hang: 'Da Nang',
                trang_thai: 'active'
            }
        ]);
    }

    const now = new Date();
    const rows = [
        {
            suffix: '001',
            customer: customers[0],
            partner: partners[0],
            status: 'shipping',
            total: 1250000,
            fee: 30000,
            address: '12 Nguyen Trai, Thanh Xuan, Ha Noi',
            receiver: customers[0]?.ten_khach_hang || 'Nguyen Van Minh',
            phone: customers[0]?.sdt || '0912345678'
        },
        {
            suffix: '002',
            customer: customers[1] || customers[0],
            partner: partners[1] || partners[0],
            status: 'completed',
            total: 890000,
            fee: 25000,
            address: '25 Le Loi, Quan 1, TP Ho Chi Minh',
            receiver: customers[1]?.ten_khach_hang || 'Tran Thi Lan',
            phone: customers[1]?.sdt || '0987654321'
        },
        {
            suffix: '003',
            customer: customers[2] || customers[0],
            partner: partners[0],
            status: 'draft',
            total: 2140000,
            fee: 45000,
            address: '40 Bach Dang, Hai Chau, Da Nang',
            receiver: customers[2]?.ten_khach_hang || 'Cong ty An Phat',
            phone: customers[2]?.sdt || '0909888777'
        }
    ];

    for (const row of rows) {
        const order = await DonHang.create({
            ma_don_hang: 'DH_DEMO_VD_' + row.suffix,
            khach_hang_id: row.customer?._id || null,
            cua_hang_id: store._id,
            nguoi_tao_id: userId || null,
            ngay_dat: now,
            ngay_tao: now,
            tong_tien: row.total + row.fee,
            tong_tien_hang: row.total,
            tong_thanh_toan: row.total + row.fee,
            trang_thai: row.status === 'completed' ? 'completed' : 'shipping',
            trang_thai_giao_hang: row.status === 'completed' ? 'giao_du' : 'chua_giao',
            ngay_giao_thuc_te: row.status === 'completed' ? now : null,
            ghi_chu: 'Du lieu mau van don'
        });

        const invoice = await HoaDonBanHang.create({
            ma_hoa_don: 'HD_DEMO_VD_' + row.suffix,
            ngay_ban: now,
            tong_tien: row.total,
            giam_gia: 0,
            thanh_toan: row.total + row.fee,
            phuong_thuc_tt: 'COD',
            trang_thai: row.status === 'completed' ? 'completed' : 'processing',
            ghi_chu: 'Du lieu mau van don',
            cua_hang_id: store._id,
            don_hang_id: order._id,
            khach_hang_id: row.customer?._id || null,
            nguoi_ban_id: userId || null
        });

        await VanDon.create({
            ma_van_don: 'VD_DEMO_' + row.suffix,
            don_hang_id: order._id,
            hoa_don_id: invoice._id,
            doi_tac_giao_hang_id: row.partner?._id || null,
            cua_hang_id: store._id,
            khach_hang_id: row.customer?._id || null,
            ten_nguoi_nhan: row.receiver,
            sdt_nguoi_nhan: row.phone,
            dia_chi_nhan: row.address,
            phi_giao_hang: row.fee,
            trang_thai: row.status,
            ghi_chu: 'Du lieu mau van don'
        });
    }
}

const INVOICE_DEBT_WARN_DEFAULT_DAYS = 10;

function hasInvoiceFilterValue(value) {
    return String(value ?? '').trim() !== '';
}

function parseInvoiceFilterMoney(value) {
    const amount = Number(String(value ?? '').replace(/\./g, '').replace(/,/g, '').trim());
    if (!Number.isFinite(amount) || amount < 0) return 0;
    return Math.floor(amount);
}

function normalizeInvoiceFilterMoneyField(value) {
    const raw = String(value || '').trim();
    if (raw === '') return '';
    const amount = parseInvoiceFilterMoney(raw);
    if (!Number.isFinite(amount) || amount < 0) return '';
    return String(amount);
}

function formatInvoiceFilterMoneyDisplay(value) {
    if (value === '' || value == null) return '';
    const amount = parseInvoiceFilterMoney(value);
    if (!Number.isFinite(amount)) return '';
    return amount.toLocaleString('vi-VN');
}

function invoiceRemainDue(invoice) {
    if (!invoice) return 0;
    if (invoice.con_no != null && invoice.con_no !== '') {
        return Math.max(0, Number(invoice.con_no) || 0);
    }
    const payable = Number(invoice.thanh_toan ?? invoice.tong_tien ?? 0) || 0;
    const paid = Number(invoice.khach_da_tra ?? 0) || 0;
    return Math.max(0, payable - paid);
}

function normalizeInvoiceDebtWarnSettings(filter = {}) {
    const warnMinDaysRaw = parseInt(String(
        filter.warnMinDays != null && filter.warnMinDays !== '' ? filter.warnMinDays : INVOICE_DEBT_WARN_DEFAULT_DAYS
    ), 10);
    return {
        warnOnly: String(filter.warnOnly || '') === '1',
        warnMinDays: Number.isFinite(warnMinDaysRaw) && warnMinDaysRaw >= 0 ? warnMinDaysRaw : INVOICE_DEBT_WARN_DEFAULT_DAYS,
        warnMinAmount: hasInvoiceFilterValue(filter.warnMinAmount) ? parseInvoiceFilterMoney(filter.warnMinAmount) : 0
    };
}

function normalizeInvoicePageFilters(query = {}) {
    const warnMinDaysRaw = parseInt(String(
        query.warnMinDays != null && query.warnMinDays !== '' ? query.warnMinDays : INVOICE_DEBT_WARN_DEFAULT_DAYS
    ), 10);
    const warnMinDays = Number.isFinite(warnMinDaysRaw) && warnMinDaysRaw >= 0 ? warnMinDaysRaw : INVOICE_DEBT_WARN_DEFAULT_DAYS;
    return Object.assign({}, query, {
        time_period: normalizeInvoiceTimePeriod(query.time_period),
        trang_thai: normalizeInvoiceStatusFilter(query.trang_thai),
        warnOnly: String(query.warnOnly || '') === '1' ? '1' : '',
        warnMinDays: String(warnMinDays),
        warnMinAmount: normalizeInvoiceFilterMoneyField(query.warnMinAmount)
    });
}

function enrichInvoiceDebtInfo(invoice) {
    if (!invoice) return;
    const debt = invoiceRemainDue(invoice);
    const ts = new Date(invoice.ngay_ban || invoice.created_at || 0).getTime();
    invoice.so_ngay_no = debt > 0 && ts > 0 ? Math.max(0, Math.floor((Date.now() - ts) / 86400000)) : null;
}

function evaluateInvoiceDebtWarning(invoice, settings) {
    const debt = invoiceRemainDue(invoice);
    if (debt <= 0) return false;
    const days = Number(invoice.so_ngay_no);
    const hasDays = Number.isFinite(days);
    const meetsDays = hasDays && days >= Number(settings.warnMinDays || INVOICE_DEBT_WARN_DEFAULT_DAYS);
    const minAmount = Number(settings.warnMinAmount || 0);
    const meetsAmount = minAmount > 0 && debt >= minAmount;
    if (minAmount > 0 && settings.warnMinDays >= 0) return meetsDays || meetsAmount;
    if (minAmount > 0) return meetsAmount;
    return meetsDays;
}

function applyInvoiceDebtWarning(invoice, settings) {
    if (!invoice) return;
    invoice.debt_warning = evaluateInvoiceDebtWarning(invoice, settings);
}

function filterInvoicesByDebtWarning(invoices, settings) {
    if (!settings || !settings.warnOnly) return invoices;
    return (invoices || []).filter(invoice => evaluateInvoiceDebtWarning(invoice, settings));
}

function parseInvoiceMoneyInput(raw) {
    return Number(String(raw ?? '').replace(/\./g, '').replace(/,/g, '').replace(/[^\d]/g, '')) || 0;
}

function calcInvoiceDetailLineTotal(line) {
    const qty = Math.max(0, Math.floor(Number(line.so_luong || 0)));
    const price = Number(line.don_gia || 0);
    const base = qty * price;
    const discount = Math.max(0, Number(line.chiet_khau || 0));
    return Math.max(0, Math.floor(base - discount));
}

async function loadInvoiceVatChuaEditState(invoiceId, orderId, storeId) {
    const store = storeId && mongoose.Types.ObjectId.isValid(String(storeId)) ? storeId : null;
    const invoiceOid = invoiceId && mongoose.Types.ObjectId.isValid(String(invoiceId)) ? invoiceId : null;
    if (!store || !invoiceOid) return { vat_chua_id: '', so_luong: 0 };

    const sourceOr = [{ source_type: 'hoa_don', source_id: invoiceOid }];
    const orderOid = orderId && mongoose.Types.ObjectId.isValid(String(orderId)) ? orderId : null;
    if (orderOid) sourceOr.push({ source_type: 'don_hang', source_id: orderOid });

    const xuatDoc = await XuatVatChua.findOne({
        cua_hang_id: store,
        trang_thai: 'active',
        $or: sourceOr
    }).sort({ created_at: -1 }).lean();

    if (!xuatDoc || !Array.isArray(xuatDoc.items) || !xuatDoc.items.length) {
        return { vat_chua_id: '', so_luong: 0 };
    }
    const item = xuatDoc.items[0];
    return {
        vat_chua_id: String(item.vat_chua_id || ''),
        so_luong: Number(item.so_luong || 0)
    };
}

function applyInvoiceDebtWarningList(invoices, settings) {
    return (invoices || []).map(invoice => {
        enrichInvoiceDebtInfo(invoice);
        applyInvoiceDebtWarning(invoice, settings);
        return invoice;
    });
}

async function buildInvoiceFilter(query = {}) {
    const filter = {};
    if (query.q && query.q.trim() !== '') {
        filter.ma_hoa_don = { $regex: query.q.trim(), $options: 'i' };
    }
    const statuses = cleanArray(query.trang_thai);
    if (statuses.length) filter.trang_thai = { $in: statuses };

    const saleRange = resolveInvoiceTimePeriodRange(query);
    if (saleRange) filter.ngay_ban = saleRange;
    if (query.phuong_thuc_tt && query.phuong_thuc_tt.trim() !== '') filter.phuong_thuc_tt = { $regex: query.phuong_thuc_tt.trim(), $options: 'i' };

    const sellerIds = await userIdFilter(query.nguoi_ban || '');
    if (sellerIds) filter.nguoi_ban_id = { $in: sellerIds };
    const creatorIds = await userIdFilter(query.nguoi_tao || '');
    if (creatorIds && !filter.nguoi_ban_id) filter.nguoi_ban_id = { $in: creatorIds };

    const shipmentFilter = {};
    if (query.doi_tac && query.doi_tac !== 'all') shipmentFilter.doi_tac_giao_hang_id = query.doi_tac;
    if (query.trang_thai_giao_hang && query.trang_thai_giao_hang !== 'all') shipmentFilter.trang_thai = query.trang_thai_giao_hang;
    if (query.khu_vuc && query.khu_vuc.trim() !== '') shipmentFilter.dia_chi_nhan = { $regex: query.khu_vuc.trim(), $options: 'i' };
    const deliveryRange = dateRange(query, 'delivery_from', 'delivery_to', query.delivery_time_type === 'this_month');
    if (deliveryRange) shipmentFilter.created_at = deliveryRange;

    const invoiceTypes = cleanArray(query.loai_hoa_don);
    const needsShipmentLookup = Object.keys(shipmentFilter).length || invoiceTypes.length;
    if (needsShipmentLookup) {
        const shipments = await VanDon.find(shipmentFilter).select('hoa_don_id don_hang_id');
        const shipmentInvoiceIds = shipments.map(item => item.hoa_don_id).filter(Boolean);
        const shipmentOrderIds = shipments.map(item => item.don_hang_id).filter(Boolean);
        if (shipmentOrderIds.length) {
            const invoicesByOrder = await HoaDonBanHang.find({ don_hang_id: { $in: shipmentOrderIds } }).select('_id');
            shipmentInvoiceIds.push(...invoicesByOrder.map(item => item._id));
        }
        if (invoiceTypes.includes('giao_hang') && !invoiceTypes.includes('khong_giao_hang')) {
            applyIdIntersection(filter, '_id', shipmentInvoiceIds);
        } else if (invoiceTypes.includes('khong_giao_hang') && !invoiceTypes.includes('giao_hang')) {
            filter._id = filter._id || {};
            filter._id.$nin = shipmentInvoiceIds;
        } else if (Object.keys(shipmentFilter).length) {
            applyIdIntersection(filter, '_id', shipmentInvoiceIds);
        }
    }

    const deletedGuard = {};
    if (!Object.keys(filter).length) return deletedGuard;
    return { $and: [filter, deletedGuard] };
}

async function decorateInvoices(invoices) {
    const invoiceIds = invoices.map(item => item._id);
    const orderIds = invoices.map(item => item.don_hang_id?._id || item.don_hang_id).filter(Boolean);
    const [shipments, receipts, returns, debts] = await Promise.all([
        VanDon.find({
            $or: [
                { hoa_don_id: { $in: invoiceIds } },
                { don_hang_id: { $in: orderIds } }
            ]
        }).populate('doi_tac_giao_hang_id').lean(),
        PhieuThuChi.find({
            $and: [
                {
                    $or: [
                        { hoa_don_id: { $in: invoiceIds } },
                        { don_hang_id: { $in: orderIds } }
                    ]
                },
                {
                    $or: [
                        { loai_phieu: 'thu' },
                        { loai_phieu: 'chi', loai_thu_chi: 'tra_tien_thua_khach' }
                    ]
                }
            ],
            trang_thai: { $ne: 'cancelled' }
        }).lean(),
        PhieuTraHang.find({ hoa_don_id: { $in: invoiceIds }, trang_thai: { $ne: 'cancelled' } }).lean(),
        CongNoKhachHang.find({ hoa_don_id: { $in: invoiceIds } }).lean()
    ]);

    const shipmentByInvoice = {};
    shipments.forEach(row => {
        if (row.hoa_don_id) shipmentByInvoice[String(row.hoa_don_id)] = row;
    });
    shipments.forEach(row => {
        if (!row.don_hang_id) return;
        const invoice = invoices.find(item => String(item.don_hang_id?._id || item.don_hang_id || '') === String(row.don_hang_id));
        if (invoice && !shipmentByInvoice[String(invoice._id)]) shipmentByInvoice[String(invoice._id)] = row;
    });

    const orderToInvoiceId = invoices.reduce((map, invoice) => {
        const orderId = String(invoice.don_hang_id?._id || invoice.don_hang_id || '');
        if (orderId) map[orderId] = String(invoice._id);
        return map;
    }, {});
    const paidByInvoice = {};
    receipts.forEach(row => {
        const key = row.hoa_don_id
            ? String(row.hoa_don_id)
            : orderToInvoiceId[String(row.don_hang_id || '')];
        if (!key) return;
        if (!paidByInvoice[key]) paidByInvoice[key] = [];
        paidByInvoice[key].push(row);
    });
    Object.keys(paidByInvoice).forEach(key => {
        paidByInvoice[key] = computeNetPaidFromReceiptRows(paidByInvoice[key]);
    });
    const returnByInvoice = returns.reduce((map, row) => {
        const key = String(row.hoa_don_id || '');
        if (!map[key]) map[key] = row;
        return map;
    }, {});
    const debtByInvoice = debts.reduce((map, row) => {
        const key = String(row.hoa_don_id || '');
        map[key] = (map[key] || 0) + Number(row.so_tien || 0);
        return map;
    }, {});

    return invoices.map(invoice => {
        const object = invoice.toObject ? invoice.toObject() : invoice;
        const id = String(object._id);
        object.van_don = shipmentByInvoice[id] || null;
        object.phieu_tra_hang = returnByInvoice[id] || null;
        object.khach_da_tra = paidByInvoice[id] || 0;
        object.con_no = Math.max(0, Number(object.thanh_toan || 0) - object.khach_da_tra);
        object.cong_no_phat_sinh = debtByInvoice[id] || 0;
        object.trang_thai_chuan = normalizeInvoiceStatus(object.trang_thai);
        return object;
    });
}

async function buildReturnFilter(query = {}) {
    const filter = {};
    if (query.q && query.q.trim() !== '') filter.ma_phieu_tra = { $regex: query.q.trim(), $options: 'i' };
    const statuses = cleanArray(query.trang_thai);
    if (statuses.length) filter.trang_thai = { $in: statuses };
    const returnRange = dateRange(query, 'date_from', 'date_to', query.time_type === 'this_month');
    if (returnRange) filter.ngay_tra = returnRange;
    const creatorIds = await userIdFilter(query.nguoi_tao || '');
    if (creatorIds) filter.nguoi_tao_id = { $in: creatorIds };
    const types = cleanArray(query.loai_tra_hang);
    if (types.includes('theo_hoa_don') && !types.includes('tra_nhanh')) filter.hoa_don_id = { $ne: null };
    if (types.includes('tra_nhanh') && !types.includes('theo_hoa_don')) filter.hoa_don_id = null;
    if (query.nguoi_nhan_tra && query.nguoi_nhan_tra.trim() !== '') {
        const customers = await KhachHang.find({
            $or: [
                { ma_khach_hang: { $regex: query.nguoi_nhan_tra.trim(), $options: 'i' } },
                { ten_khach_hang: { $regex: query.nguoi_nhan_tra.trim(), $options: 'i' } },
                { sdt: { $regex: query.nguoi_nhan_tra.trim(), $options: 'i' } }
            ]
        }).select('_id');
        filter.khach_hang_id = { $in: customers.map(item => item._id) };
    }
    const deletedGuard = {};
    if (!Object.keys(filter).length) return deletedGuard;
    return { $and: [filter, deletedGuard] };
}

async function getOrderCreateData() {
    const [customersRaw, products, stores, partners, addresses, priceBooks, priceRows] = await Promise.all([
        KhachHang.find().sort({ ten_khach_hang: 1 }),
        HangHoa.find({ trang_thai: 'active' })
            .populate('nha_cung_cap_id', 'ma_ncc ten_ncc ten_cong_ty')
            .sort({ ten_hang: 1 }),
        CuaHang.find().sort({ ten_cua_hang: 1 }),
        DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ ten_doi_tac: 1 }),
        DiaChiKhachHang.find(),
        BangGia.find({ trang_thai: 'active' }).sort({ ten_bang_gia: 1 }),
        CTBangGia.find().select('bang_gia_id hang_hoa_id gia_ban').lean()
    ]);

    const addressesByCustomer = addresses.reduce((acc, address) => {
        const key = String(address.khach_hang_id);
        if (!acc[key]) acc[key] = [];
        acc[key].push(address);
        return acc;
    }, {});

    const customers = customersRaw.map(customer => {
        const data = customer.toObject();
        data.dia_chi_list = addressesByCustomer[String(customer._id)] || [];
        return data;
    });

    return { customers, products, stores, partners, priceBooks, priceRows };
}

async function mergeOrdersInSession(req, session) {
    const body = req.body || {};
    const orderIds = uniqueObjectIds(Array.isArray(body.don_hang_ids) ? body.don_hang_ids : [])
        .map(id => String(id));
    if (orderIds.length < 2) {
        const error = new Error('Vui lòng chọn ít nhất 2 đơn hàng để gộp.');
        error.status = 400;
        throw error;
    }
    const receivingOrderId = body.don_nhan_id && orderIds.includes(String(body.don_nhan_id))
        ? String(body.don_nhan_id)
        : orderIds[0];
    const sourceOrderIds = orderIds.filter(id => id !== receivingOrderId);
    const note = String(body.ghi_chu || '').trim();

    const orders = await DonHang.find({ _id: { $in: orderIds } })
        .populate('khach_hang_id')
        .session(session);
    if (orders.length !== orderIds.length) {
        const error = new Error('Một hoặc nhiều đơn hàng không tồn tại.');
        error.status = 400;
        throw error;
    }
    const orderById = new Map(orders.map(order => [String(order._id), order]));
    const receivingOrder = orderById.get(receivingOrderId);
    const sourceOrders = sourceOrderIds.map(id => orderById.get(id));

    const storeIds = new Set(orders.map(order => String(order.cua_hang_id || '')).filter(Boolean));
    if (storeIds.size !== 1) {
        const error = new Error('Không thể gộp các đơn khác của hàng.');
        error.status = 400;
        throw error;
    }

    const warehouseIds = new Set(orders.map(order => String(order.kho_id || '')).filter(Boolean));
    if (warehouseIds.size > 1) {
        const error = new Error('Không thể gộp các đơn khác kho trong phase này.');
        error.status = 400;
        throw error;
    }

    const shipments = await VanDon.find({ don_hang_id: { $in: orderIds } }).session(session);
    const shipmentByOrder = shipments.reduce((map, shipment) => {
        map[String(shipment.don_hang_id || '')] = shipment;
        return map;
    }, {});

    const customerIds = new Set(orders.map(order => String(order.khach_hang_id?._id || order.khach_hang_id || '')).filter(Boolean));
    const phones = new Set(orders.map(order => {
        const shipment = shipmentByOrder[String(order._id)];
        return orderCustomerPhone(order) || normalizePhone(shipment?.sdt_nguoi_nhan);
    }).filter(Boolean));
    if (customerIds.size !== 1 && phones.size !== 1) {
        const error = new Error('Không thể gộp các đơn khác khách hàng hoặc khác số điện thoại.');
        error.status = 400;
        throw error;
    }

    const invoices = await HoaDonBanHang.find({
        don_hang_id: { $in: orderIds },
        trang_thai: { $ne: 'cancelled' }
    }).session(session);
    if (invoices.length) {
        const invoiceOrder = orderById.get(String(invoices[0].don_hang_id));
        const error = new Error(`Không thể gộp đơn ${invoiceOrder?.ma_don_hang || ''} vì đã tạo hóa đơn.`);
        error.status = 400;
        throw error;
    }

    const details = await CTDonHang.find({ don_hang_id: { $in: orderIds } }).session(session);
    const detailMap = details.reduce((map, detail) => {
        const key = String(detail.don_hang_id || '');
        if (!map[key]) map[key] = [];
        map[key].push(detail);
        return map;
    }, {});

    for (const order of orders) {
        if (['cancelled', 'completed', 'merged'].includes(order.trang_thai)) {
            const message = order.trang_thai === 'merged'
                ? `Đơn ${order.ma_don_hang} đã được gộp vào ${order.merged_to_ma_don_hang || 'đơn khác'}.`
                : `Không thể gộp đơn ${order.ma_don_hang} ở trạng thái hiện tại.`;
            const error = new Error(message);
            error.status = 400;
            throw error;
        }
        if (order.trang_thai_giao_hang !== 'chua_giao') {
            const error = new Error(`Chỉ có thể gộp các đơn chưa giao. Đơn ${order.ma_don_hang} đã phát sinh giao hàng.`);
            error.status = 400;
            throw error;
        }
        const deliveredDetail = (detailMap[String(order._id)] || []).find(detail => Number(detail.so_luong_da_giao || 0) > 0);
        if (deliveredDetail) {
            const error = new Error(`Chỉ có thể gộp các đơn chưa giao. Đơn ${order.ma_don_hang} đã phát sinh giao hàng.`);
            error.status = 400;
            throw error;
        }
    }

    const allPaidBefore = orders.reduce((sum, order) => sum + Number(order.khach_thanh_toan || 0), 0);
    const allGoodsBefore = orders.reduce((sum, order) => sum + Number(order.tong_tien_hang || order.tong_thanh_toan || order.tong_tien || 0), 0);
    const receivingLines = detailMap[receivingOrderId] || [];
    const receivingLineByKey = new Map(receivingLines.map(line => [mergeLineKey(line), line]));

    for (const sourceOrder of sourceOrders) {
        const sourceLines = detailMap[String(sourceOrder._id)] || [];
        for (const sourceLine of sourceLines) {
            const key = mergeLineKey(sourceLine);
            const sourceQuantity = Number(sourceLine.so_luong_dat || sourceLine.so_luong || 0);
            const targetLine = receivingLineByKey.get(key);
            if (targetLine) {
                const targetQuantity = Number(targetLine.so_luong_dat || targetLine.so_luong || 0) + sourceQuantity;
                targetLine.so_luong = targetQuantity;
                targetLine.so_luong_dat = targetQuantity;
                targetLine.so_luong_xac_nhan = 0;
                targetLine.so_luong_da_giao = 0;
                targetLine.so_luong_con_thieu = targetQuantity;
                targetLine.trang_thai_giao = 'chua_giao';
                targetLine.thanh_tien = calcLineTotal(targetLine);
                await targetLine.save({ session });
            } else {
                const clonedLine = await CTDonHang.create([cloneMergedLine(sourceLine, receivingOrder._id)], { session });
                receivingLines.push(clonedLine[0]);
                receivingLineByKey.set(key, clonedLine[0]);
            }
        }
    }

    const updatedReceivingLines = await CTDonHang.find({ don_hang_id: receivingOrder._id }).session(session);
    applyOrderTotals(receivingOrder, updatedReceivingLines, allPaidBefore);
    receivingOrder.is_merged_order = true;
    receivingOrder.merged_from_don_hang_ids = uniqueObjectIds([
        ...(receivingOrder.merged_from_don_hang_ids || []),
        ...sourceOrders.map(order => order._id)
    ]);
    receivingOrder.merged_from_ma_don_hangs = Array.from(new Set([
        ...(receivingOrder.merged_from_ma_don_hangs || []),
        ...sourceOrders.map(order => order.ma_don_hang).filter(Boolean)
    ]));
    receivingOrder.merged_at = new Date();
    receivingOrder.merged_by = req.user?._id;
    receivingOrder.merge_note = note;
    await receivingOrder.save({ session });

    await DonHang.updateMany(
        { _id: { $in: sourceOrders.map(order => order._id) } },
        {
            $set: {
                trang_thai: 'merged',
                merged_to_don_hang_id: receivingOrder._id,
                merged_to_ma_don_hang: receivingOrder.ma_don_hang,
                merged_at: receivingOrder.merged_at,
                merged_by: req.user?._id,
                merge_note: note
            }
        },
        { session }
    );

    await VanDon.updateMany(
        { don_hang_id: { $in: sourceOrders.map(order => order._id) }, trang_thai: { $ne: 'cancelled' } },
        {
            $set: {
                trang_thai: 'cancelled',
                ghi_chu: `Vận đơn bị hủy do đơn hàng đã gộp vào ${receivingOrder.ma_don_hang}`
            }
        },
        { session }
    );

    const maGopDon = await generateMergeOrderCode(session);
    const mergeRecord = await GopDonHang.create([{
        ma_gop_don: maGopDon,
        cua_hang_id: receivingOrder.cua_hang_id,
        don_nhan_id: receivingOrder._id,
        ma_don_nhan: receivingOrder.ma_don_hang,
        khach_hang_id: receivingOrder.khach_hang_id?._id || receivingOrder.khach_hang_id || null,
        sdt_khach_hang: orderCustomerPhone(receivingOrder) || normalizePhone(shipmentByOrder[receivingOrderId]?.sdt_nguoi_nhan),
        don_nguon_ids: sourceOrders.map(order => order._id),
        ma_don_nguon: sourceOrders.map(order => order.ma_don_hang),
        tong_tien_hang_truoc_gop: allGoodsBefore,
        tong_khach_da_tra_truoc_gop: allPaidBefore,
        tong_tien_hang_sau_gop: Number(receivingOrder.tong_tien_hang || 0),
        tong_khach_da_tra_sau_gop: Number(receivingOrder.khach_thanh_toan || 0),
        so_luong_don_gop: orders.length,
        ghi_chu: note,
        trang_thai: 'active',
        nguoi_tao_id: req.user?._id,
        ngay_gop: receivingOrder.merged_at
    }], { session });

    return {
        gop_don_hang_id: mergeRecord[0]._id,
        ma_gop_don: mergeRecord[0].ma_gop_don,
        don_nhan_id: receivingOrder._id,
        ma_don_nhan: receivingOrder.ma_don_hang,
        don_nguon_ids: sourceOrders.map(order => order._id),
        ma_don_nguon: sourceOrders.map(order => order.ma_don_hang),
        tong_tien_hang_sau_gop: Number(receivingOrder.tong_tien_hang || 0),
        tong_khach_da_tra_sau_gop: Number(receivingOrder.khach_thanh_toan || 0)
    };
}

async function loadSalesReturnCopyDraft(copyFromId) {
    if (!/^[0-9a-fA-F]{24}$/.test(String(copyFromId || ''))) return null;
    const slip = await PhieuTraHang.findOne({ _id: copyFromId }).lean();
    if (!slip || slip.trang_thai === 'cancelled') return null;
    const lines = await CTPhieuTraHang.find({ phieu_tra_hang_id: slip._id })
        .populate('hang_hoa_id')
        .populate('lo_hang_id')
        .lean();
    if (!lines.length) return null;
    return {
        hoa_don_id: slip.hoa_don_id ? String(slip.hoa_don_id) : '',
        khach_hang_id: slip.khach_hang_id ? String(slip.khach_hang_id) : '',
        kho_id: slip.kho_id ? String(slip.kho_id) : '',
        ly_do: slip.ly_do || '',
        ghi_chu: slip.ghi_chu || '',
        giam_gia: Number(slip.giam_gia || 0),
        kieu_giam_gia: slip.kieu_giam_gia || 'vnd',
        phi_tra_hang: Number(slip.phi_tra_hang || 0),
        hinh_thuc_nhan_hang_tra: slip.hinh_thuc_nhan_hang_tra || 'tai_quay',
        doi_tac_giao_hang_id: slip.doi_tac_giao_hang_id ? String(slip.doi_tac_giao_hang_id) : '',
        dia_chi_lay_hang: slip.dia_chi_lay_hang || '',
        ten_nguoi_gui_tra: slip.ten_nguoi_gui_tra || '',
        sdt_nguoi_gui_tra: slip.sdt_nguoi_gui_tra || '',
        phi_lay_hang_tra: Number(slip.phi_lay_hang_tra || 0),
        nguoi_tra_phi_lay_hang: slip.nguoi_tra_phi_lay_hang || 'cua_hang',
        ma_van_don_tra_hang: slip.ma_van_don_tra_hang || '',
        ghi_chu_van_chuyen_tra: slip.ghi_chu_van_chuyen_tra || '',
        return_items: lines
            .filter(row => row.loai_dong !== 'hang_doi')
            .map(row => ({
                hang_hoa_id: String(row.hang_hoa_id?._id || row.hang_hoa_id || ''),
                lo_hang_id: row.lo_hang_id ? String(row.lo_hang_id._id || row.lo_hang_id) : '',
                so_luong: Number(row.so_luong || 0),
                don_gia: Number(row.don_gia || 0),
                chiet_khau: 0
            }))
            .filter(row => row.hang_hoa_id && row.so_luong > 0),
        exchange_items: lines
            .filter(row => row.loai_dong === 'hang_doi')
            .map(row => ({
                hang_hoa_id: String(row.hang_hoa_id?._id || row.hang_hoa_id || ''),
                lo_hang_id: row.lo_hang_id ? String(row.lo_hang_id._id || row.lo_hang_id) : '',
                so_luong: Number(row.so_luong || 0),
                don_gia: Number(row.don_gia || 0)
            }))
            .filter(row => row.hang_hoa_id && row.so_luong > 0)
    };
}

function escapedRegex(value = '') {
    return String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function intersectIdFilters(filter, ids) {
    const cleanIds = ids.filter(Boolean).map(id => String(id));
    if (!filter._id) {
        filter._id = { $in: cleanIds };
        return;
    }
    const currentIds = (filter._id.$in || []).map(id => String(id));
    const allowed = new Set(cleanIds);
    filter._id.$in = currentIds.filter(id => allowed.has(id));
}

async function getReturnableInvoiceIds(filter) {
    const invoices = await HoaDonBanHang.find(filter)
        .select('_id')
        .sort({ ngay_ban: -1, created_at: -1 })
        .lean();
    const invoiceIds = invoices.map(item => item._id);
    if (!invoiceIds.length) return [];

    const details = await CTHoaDonBanHang.find({ hoa_don_id: { $in: invoiceIds } })
        .select('hoa_don_id hang_hoa_id so_luong')
        .lean();
    if (!details.length) return [];

    const returns = await PhieuTraHang.find({
        hoa_don_id: { $in: invoiceIds },
        trang_thai: { $ne: 'cancelled' }
    }).select('_id hoa_don_id').lean();
    const returnById = returns.reduce((map, row) => {
        map[String(row._id)] = String(row.hoa_don_id);
        return map;
    }, {});
    const returnItems = returns.length
        ? await CTPhieuTraHang.find({ phieu_tra_hang_id: { $in: returns.map(row => row._id) }, loai_dong: { $ne: 'hang_doi' } })
            .select('phieu_tra_hang_id hang_hoa_id so_luong')
            .lean()
        : [];

    const ordered = {};
    details.forEach(row => {
        const invoiceId = String(row.hoa_don_id);
        const productId = String(row.hang_hoa_id);
        if (!ordered[invoiceId]) ordered[invoiceId] = {};
        ordered[invoiceId][productId] = (ordered[invoiceId][productId] || 0) + Number(row.so_luong || 0);
    });

    const returned = {};
    returnItems.forEach(row => {
        const invoiceId = returnById[String(row.phieu_tra_hang_id)];
        if (!invoiceId) return;
        const productId = String(row.hang_hoa_id);
        if (!returned[invoiceId]) returned[invoiceId] = {};
        returned[invoiceId][productId] = (returned[invoiceId][productId] || 0) + Number(row.so_luong || 0);
    });

    return invoiceIds.filter(invoiceId => {
        const invoiceKey = String(invoiceId);
        const invoiceDetails = ordered[invoiceKey] || {};
        return Object.keys(invoiceDetails).some(productId => {
            const soldQty = Number(invoiceDetails[productId] || 0);
            const returnedQty = Number(returned[invoiceKey]?.[productId] || 0);
            return soldQty > returnedQty;
        });
    });
}

module.exports = {
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
};


