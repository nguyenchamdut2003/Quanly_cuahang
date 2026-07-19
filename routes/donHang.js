const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const { isAuthenticated } = require('../middlewares/auth.middleware');
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
} = require('../models/kiot.model');
const { congTonKho, truTonKho } = require('../services/kho.service');
const { tinhPhiGiaoHang, luuPhiVanChuyenKhachHang } = require('../services/phiGiaoHang.service');
const { taoPhieuThuChi, taoPhieuThuKhachHang } = require('../services/soQuy.service');
const {
    normalizeCustomerPaymentInput,
    computeNetPaidFromReceiptRows,
    receiptRowsForNetPaidFilter
} = require('../utils/customerPayment');
const { createCustomerDebtTransaction } = require('../services/customerDebt.service');
const {
    buildVariantKey,
    buildLotKey,
    getReservedQuantitiesForSale
} = require('../services/availability.service');
const { normalizeAddress } = require('../utils/address');
const { resolveStoreId } = require('../utils/storeScope');
const { resolveCashBookForPayment } = require('../services/paymentCashBook.service');
const { resolveSalePrice, normalizeUnitPrice } = require('../services/salePrice.service');
const { parseVatChuaImportInput, parseVatChuaSignedInput, assertVatChuaImportInput, assertVatChuaSignedInput, importVatChuaWithSalesReturn, cancelNhapVatChuaBySource } = require('../services/vatChuaImport.service');
const { exportVatChuaWithOrderDelivery, exportVatChuaWithInvoice, exportVatChuaWithSalesReturn, cancelXuatVatChuaBySource } = require('../services/vatChuaExport.service');
const { loadOrderLinkedVatChuaLines, loadInvoiceLinkedVatChuaLines, loadSalesReturnLinkedNhapVatChuaLines } = require('../services/vatChuaDetail.service');
const { previewOrderTrash, moveOrdersToTrash } = require('../services/orderTrash.service');
const { previewInvoiceTrash, moveInvoicesToTrash } = require('../services/invoiceTrash.service');

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
                error: 'Không được thay đổi đơn giá cho dòng hàng này (đã khóa sửa giá).'
            };
        }
        return { unitPrice: resolved.gia_ban, resolved };
    }

    return {
        unitPrice: hasManual ? normalizeUnitPrice(manualRaw) : resolved.gia_ban,
        resolved
    };
}

router.use(isAuthenticated);

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

// Chỉ cột thuộc don_hang, ct_don_hang, van_don (gắn đơn), khach_hang (ref đơn)
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
    { group: 'chi_tiet', key: 'lo_hang', header: 'Lô hàng' },
    { group: 'chi_tiet', key: 'so_luong_dat', header: 'SL đặt', style: { numFmt: '#,##0.##' }, default: true },
    { group: 'chi_tiet', key: 'so_luong_xac_nhan', header: 'SL xác nhận', style: { numFmt: '#,##0.##' } },
    { group: 'chi_tiet', key: 'so_luong_da_giao', header: 'SL đã giao', style: { numFmt: '#,##0.##' }, default: true },
    { group: 'chi_tiet', key: 'so_luong_con_thieu', header: 'SL còn thiếu', style: { numFmt: '#,##0.##' } },
    { group: 'chi_tiet', key: 'trang_thai_giao', header: 'Trạng thái giao dòng' },
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
    { header: 'Công nợ', key: 'cong_no', style: { numFmt: '#,##0' } },
    { header: 'Phương thức thanh toán', key: 'phuong_thuc_thanh_toan' },
    { header: 'COD', key: 'cod' },
    { header: 'Trạng thái hóa đơn', key: 'trang_thai_hoa_don' },
    { header: 'Ghi chú', key: 'ghi_chu' },
    { header: 'Mã hàng', key: 'ma_hang' },
    { header: 'Tên hàng', key: 'ten_hang' },
    { header: 'Thương hiệu', key: 'thuong_hieu' },
    { header: 'Nhóm hàng', key: 'nhom_hang' },
    { header: 'Đơn vị tính', key: 'don_vi_tinh' },
    { header: 'Lô hàng', key: 'lo_hang' },
    { header: 'Số lượng', key: 'so_luong', style: { numFmt: '#,##0.##' } },
    { header: 'Đơn giá', key: 'don_gia', style: { numFmt: '#,##0' } },
    { header: 'Chiết khấu', key: 'chiet_khau', style: { numFmt: '#,##0.##' } },
    { header: 'Thành tiền', key: 'thanh_tien', style: { numFmt: '#,##0' } },
    { header: 'Giá vốn', key: 'gia_von', style: { numFmt: '#,##0' } }
];

const RETURN_EXPORT_STATUS_MAP = {
    completed: 'Đã trả',
    cancelled: 'Đã hủy',
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
    { header: 'Loại dòng', key: 'loai_dong' },
    { header: 'Mã hàng', key: 'ma_hang' },
    { header: 'Tên hàng', key: 'ten_hang' },
    { header: 'Thương hiệu', key: 'thuong_hieu' },
    { header: 'Nhóm hàng', key: 'nhom_hang' },
    { header: 'Đơn vị tính', key: 'don_vi_tinh' },
    { header: 'Lô hàng', key: 'lo_hang' },
    { header: 'Số lượng', key: 'so_luong', style: { numFmt: '#,##0.##' } },
    { header: 'Đơn giá', key: 'don_gia', style: { numFmt: '#,##0' } },
    { header: 'Thành tiền', key: 'thanh_tien', style: { numFmt: '#,##0' } }
];

const DELIVERY_PARTNER_STATUS_MAP = {
    active: 'Đang hoạt động',
    inactive: 'Ngừng hoạt động'
};

const SHIPPING_PRICE_TYPE_MAP = {
    theo_km: 'Theo km',
    co_dinh: 'Cố định',
    theo_tuyen: 'Theo tuyến'
};

const DELIVERY_PARTNER_EXPORT_COLUMNS = [
    { header: 'Mã đối tác', key: 'ma_doi_tac' },
    { header: 'Tên đối tác', key: 'ten_doi_tac' },
    { header: 'Điện thoại', key: 'dien_thoai' },
    { header: 'Email', key: 'email' },
    { header: 'Địa chỉ', key: 'dia_chi' },
    { header: 'Ghi chú', key: 'ghi_chu' },
    { header: 'Trạng thái', key: 'trang_thai' },
    { header: 'Ngày tạo', key: 'ngay_tao' },
    { header: 'Ngày cập nhật', key: 'ngay_cap_nhat' },
    { header: 'Tên bảng giá', key: 'ten_bang_gia' },
    { header: 'Loại tính phí', key: 'loai_tinh_phi' },
    { header: 'Điểm đi', key: 'diem_di' },
    { header: 'Điểm đến', key: 'diem_den' },
    { header: 'Khoảng cách km', key: 'khoang_cach_km', style: { numFmt: '#,##0.##' } },
    { header: 'Đơn giá/km', key: 'don_gia_km', style: { numFmt: '#,##0' } },
    { header: 'Phí cố định', key: 'phi_co_dinh', style: { numFmt: '#,##0' } },
    { header: 'Phí tối thiểu', key: 'phi_toi_thieu', style: { numFmt: '#,##0' } },
    { header: 'Trạng thái bảng giá', key: 'trang_thai_bang_gia' }
];

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
    const deletedGuard = { $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] };
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
    return customer ? (customer.ten_khach_hang || customer.ten_ca_nhan || customer.ten_cong_ty || customer.ma_khach_hang || '') : 'Khách lẻ';
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
    if (product?.quan_ly_theo_lo) return 'Chưa chốt lô';
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
    if (!storeId) throw new Error('Thiếu cửa hàng để ghi phiếu chi hoàn tiền trả hàng.');

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
        doi_tuong: customerId ? undefined : 'Khách lẻ',
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
            ? 'Một số dòng hóa đơn xuất từ nhiều lô — trả hàng theo từng lô riêng.'
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

function applyDeliveryPartnerWorksheetFormat(worksheet) {
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
        to: { row: 1, column: DELIVERY_PARTNER_EXPORT_COLUMNS.length }
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
    const worksheet = workbook.addWorksheet('Đặt hàng');
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

function buildDeliveryPartnerExportRow(partner, priceList) {
    return {
        ma_doi_tac: partner.ma_doi_tac || '',
        ten_doi_tac: partner.ten_doi_tac || '',
        dien_thoai: partner.sdt || '',
        email: partner.email || '',
        dia_chi: partner.dia_chi_day_du || '',
        ghi_chu: partner.ghi_chu || '',
        trang_thai: DELIVERY_PARTNER_STATUS_MAP[partner.trang_thai] || partner.trang_thai || '',
        ngay_tao: formatExportDate(partner.created_at),
        ngay_cap_nhat: formatExportDate(partner.updated_at),
        ten_bang_gia: priceList?.ten_bang_gia || '',
        loai_tinh_phi: priceList ? (SHIPPING_PRICE_TYPE_MAP[priceList.loai_tinh_phi] || priceList.loai_tinh_phi || '') : '',
        diem_di: priceList?.diem_di || '',
        diem_den: priceList?.diem_den || '',
        khoang_cach_km: priceList ? Number(priceList.khoang_cach_km || 0) : 0,
        don_gia_km: priceList ? Number(priceList.don_gia_km || 0) : 0,
        phi_co_dinh: priceList ? Number(priceList.phi_co_dinh || 0) : 0,
        phi_toi_thieu: priceList ? Number(priceList.phi_toi_thieu || 0) : 0,
        trang_thai_bang_gia: priceList ? (DELIVERY_PARTNER_STATUS_MAP[priceList.trang_thai] || priceList.trang_thai || '') : ''
    };
}

async function loadDeliveryPartnerExportData(filter = {}) {
    const partners = await DoiTacGiaoHang.find(filter).sort({ created_at: -1 }).lean();
    const partnerIds = partners.map(partner => partner._id);
    const priceLists = partnerIds.length
        ? await BangGiaVanChuyen.find({ doi_tac_giao_hang_id: { $in: partnerIds } })
            .sort({ created_at: -1 })
            .lean()
        : [];
    const priceMap = priceLists.reduce((map, priceList) => {
        const key = String(priceList.doi_tac_giao_hang_id || '');
        if (!map[key]) map[key] = [];
        map[key].push(priceList);
        return map;
    }, {});
    return { partners, priceMap };
}

async function sendDeliveryPartnerWorkbook(res, filename, partners, priceMap) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Đối tác giao hàng');
    worksheet.columns = DELIVERY_PARTNER_EXPORT_COLUMNS;

    partners.forEach(partner => {
        const priceLists = priceMap[String(partner._id)] || [];
        if (!priceLists.length) {
            worksheet.addRow(buildDeliveryPartnerExportRow(partner, null));
            return;
        }
        priceLists.forEach(priceList => worksheet.addRow(buildDeliveryPartnerExportRow(partner, priceList)));
    });

    applyDeliveryPartnerWorksheetFormat(worksheet);
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
            warnings.push(`Dòng hàng quy cách ${label} thiếu gia_tri_thuoc_tinh_id và ten_quy_cach, chỉ có thể đối chiếu tồn theo dữ liệu còn lại.`);
        }
        if (soLuongDat > tonThucTe) {
            const message = `Số lượng đặt vượt tồn thực tế. Khi giao có thể thiếu hàng. Dòng [${label}] tồn ${tonThucTe}, khách đặt ${soLuongDat}.`;
            if (!CHO_PHEP_DAT_AM_KHO) return { valid: false, message };
            warnings.push(message);
            continue;
        }
        if (soLuongDat > khaDung) {
            const message = `Số lượng đặt của [${label}] vượt khả dụng. Khả dụng còn ${khaDung}, khách đặt ${soLuongDat}.`;
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
    if (/chuyển|chuyen|bank/i.test(method)) return 'chuyen_khoan';
    if (/ví|vi/i.test(method)) return 'vi_dien_tu';
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
            ? 'Vui lòng chọn sổ tiền mặt để trả tiền thừa cho khách.'
            : 'Vui lòng chọn sổ tiền mặt.');
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

/** Tổng phải thu / đã thu / còn nợ đơn: theo HĐ active nếu đã có HĐ, không thì theo tổng đơn gốc. */
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

/** Danh sách HĐ còn nợ (theo thứ tự tạo) và tổng còn nợ. */
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
            ghi_chu: options.ghi_chu || `Hoan ton HĐ ${maPhieu}`
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
        const error = new Error('Không thể gộp các hóa đơn khác cửa hàng.');
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
                ghi_chu: `Vận đơn bị ngưng do hóa đơn đã gộp vào ${receivingInvoice.ma_hoa_don}`
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

    const deletedGuard = { $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] };
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
    return filter;
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

router.get('/gop-don/candidates', async (req, res, next) => {
    try {
        const days = Math.max(1, Math.min(90, Number(req.query.days || 7)));
        const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const filter = {
            ngay_dat: { $gte: fromDate },
            trang_thai: { $nin: ['cancelled', 'completed', 'merged'] },
            trang_thai_giao_hang: 'chua_giao'
        };
        if (req.query.khach_hang_id && mongoose.Types.ObjectId.isValid(String(req.query.khach_hang_id))) {
            filter.khach_hang_id = req.query.khach_hang_id;
        }

        let orders = await DonHang.find(filter)
            .populate('khach_hang_id')
            .sort({ ngay_dat: -1 })
            .lean();

        const normalizedPhone = normalizePhone(req.query.sdt);
        if (normalizedPhone) {
            orders = orders.filter(order => orderCustomerPhone(order) === normalizedPhone);
        }

        const orderIds = orders.map(order => order._id);
        const [invoices, deliveredRows] = await Promise.all([
            HoaDonBanHang.find({
                don_hang_id: { $in: orderIds },
                trang_thai: { $ne: 'cancelled' }
            }).select('don_hang_id').lean(),
            CTDonHang.find({
                don_hang_id: { $in: orderIds },
                so_luong_da_giao: { $gt: 0 }
            }).select('don_hang_id').lean()
        ]);
        const blockedOrderIds = new Set([
            ...invoices.map(item => String(item.don_hang_id || '')),
            ...deliveredRows.map(item => String(item.don_hang_id || ''))
        ]);

        const data = orders
            .filter(order => !blockedOrderIds.has(String(order._id)))
            .map(order => ({
                _id: order._id,
                ma_don_hang: order.ma_don_hang,
                ngay_dat: order.ngay_dat,
                khach_can_tra: Number(order.khach_can_tra || order.tong_thanh_toan || order.tong_tien || 0),
                khach_thanh_toan: Number(order.khach_thanh_toan || 0),
                ma_khach_hang: order.khach_hang_id?.ma_khach_hang || '',
                ten_khach_hang: order.khach_hang_id?.ten_khach_hang || '',
                sdt: order.khach_hang_id?.sdt || order.khach_hang_id?.sdt2 || '',
                trang_thai: order.trang_thai,
                trang_thai_giao_hang: order.trang_thai_giao_hang
            }));
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

async function mergeOrdersInSession(req, session) {
    const body = req.body || {};
    const orderIds = uniqueObjectIds(Array.isArray(body.don_hang_ids) ? body.don_hang_ids : [])
        .map(id => String(id));
    if (orderIds.length < 2) {
        const error = new Error('Vui lòng chền ít nhất 2 đơn để gộp.');
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
        const error = new Error('Không thể gộp các đơn khác cửa hàng.');
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
                ghi_chu: `Vận đơn bị ngưng do đơn hàng đã gộp vào ${receivingOrder.ma_don_hang}`
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

router.post('/gop-don', async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await mergeOrdersInSession(req, session);
        });
        res.json({
            success: true,
            message: 'Gộp đơn thành công',
            data: result
        });
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        next(error);
    } finally {
        await session.endSession();
    }
});

router.get('/gop-hoa-don/candidates', async (req, res, next) => {
    try {
        const days = Math.max(1, Math.min(90, Number(req.query.days || 7)));
        const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const filter = {
            ngay_ban: { $gte: fromDate },
            trang_thai: { $nin: ['cancelled', 'merged'] }
        };
        if (req.query.khach_hang_id && mongoose.Types.ObjectId.isValid(String(req.query.khach_hang_id))) {
            filter.khach_hang_id = req.query.khach_hang_id;
        }

        let invoices = await HoaDonBanHang.find(filter)
            .populate('khach_hang_id')
            .sort({ ngay_ban: -1 })
            .lean();

        const normalizedPhone = normalizePhone(req.query.sdt);
        if (normalizedPhone) {
            const invoiceIds = invoices.map(item => item._id);
            const shipments = invoiceIds.length
                ? await VanDon.find({
                    $or: [
                        { hoa_don_id: { $in: invoiceIds } },
                        { don_hang_id: { $in: invoices.map(item => item.don_hang_id).filter(Boolean) } }
                    ]
                }).select('hoa_don_id don_hang_id sdt_nguoi_nhan').lean()
                : [];
            const shipmentByInvoice = {};
            shipments.forEach(row => {
                if (row.hoa_don_id) shipmentByInvoice[String(row.hoa_don_id)] = row;
            });
            invoices.forEach(invoice => {
                const orderId = String(invoice.don_hang_id || '');
                if (!orderId) return;
                const shipment = shipments.find(row => String(row.don_hang_id || '') === orderId);
                if (shipment && !shipmentByInvoice[String(invoice._id)]) {
                    shipmentByInvoice[String(invoice._id)] = shipment;
                }
            });
            invoices = invoices.filter(invoice => {
                const shipment = shipmentByInvoice[String(invoice._id)];
                return invoiceCustomerPhone(invoice, shipment) === normalizedPhone;
            });
        }

        const invoiceIds = invoices.map(item => item._id);
        const paidMap = await loadInvoiceNetPaidMap(invoiceIds);
        const returnRows = invoiceIds.length
            ? await PhieuTraHang.find({
                hoa_don_id: { $in: invoiceIds },
                trang_thai: { $ne: 'cancelled' }
            }).select('hoa_don_id').lean()
            : [];
        const returnInvoiceIds = new Set(returnRows.map(row => String(row.hoa_don_id || '')));
        invoices = invoices.filter(invoice => !returnInvoiceIds.has(String(invoice._id)));

        const data = invoices.map(invoice => ({
                _id: invoice._id,
                ma_hoa_don: invoice.ma_hoa_don,
                ngay_ban: invoice.ngay_ban,
                khach_can_tra: Number(invoice.thanh_toan || 0),
                khach_da_tra: Number(paidMap[String(invoice._id)] || 0),
                ma_khach_hang: invoice.khach_hang_id?.ma_khach_hang || '',
                ten_khach_hang: invoice.khach_hang_id?.ten_khach_hang || '',
                sdt: invoice.khach_hang_id?.sdt || invoice.khach_hang_id?.sdt2 || '',
                trang_thai: normalizeInvoiceStatus(invoice.trang_thai)
            }));
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.post('/gop-hoa-don', async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await mergeInvoicesInSession(req, session);
        });
        res.json({
            success: true,
            message: 'Gộp hóa đơn thành công',
            data: result
        });
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        next(error);
    } finally {
        await session.endSession();
    }
});

router.post('/trash/preview', async (req, res, next) => {
    try {
        const storeId = await resolveStoreId(req);
        const ids = req.body && req.body.don_hang_ids;
        const preview = await previewOrderTrash(ids, storeId);
        return res.json({ success: true, data: preview });
    } catch (error) {
        const status = Number(error && error.statusCode) || 400;
        return res.status(status).json({ success: false, message: error.message || 'Không xem trước được thùng rác' });
    }
});

router.post('/trash/move', async (req, res, next) => {
    try {
        const storeId = await resolveStoreId(req);
        const ids = req.body && req.body.don_hang_ids;
        const userId = req.user && req.user._id;
        const result = await moveOrdersToTrash(ids, storeId, userId);
        return res.json({
            success: true,
            message: 'Đã đưa ' + result.moved_count + ' đơn đặt hàng vào thùng rác.',
            data: result
        });
    } catch (error) {
        const status = Number(error && error.statusCode) || 400;
        return res.status(status).json({ success: false, message: error.message || 'Không đưa vào thùng rác được' });
    }
});

router.get('/', async (req, res, next) => {
    try {
        const filter = buildOrderFilter(req.query);
        const shipmentOrderIds = await buildShipmentOrderFilter(req.query);
        if (shipmentOrderIds) filter._id = { $in: shipmentOrderIds };

        if (req.query?.phuong_thuc_tt && req.query.phuong_thuc_tt.trim() !== '') {
            const invoices = await HoaDonBanHang.find({ phuong_thuc_tt: req.query.phuong_thuc_tt.trim(), don_hang_id: { $ne: null } }).select('don_hang_id');
            applyOrderIdFilter(filter, invoices.map(item => item.don_hang_id).filter(Boolean));
        }

        if (req.query?.nguoi_tao && req.query.nguoi_tao.trim() !== '' && !filter.nguoi_tao_id) {
            const usersByName = await NguoiDung.find({
                $or: [
                    { ho_ten: { $regex: req.query.nguoi_tao.trim(), $options: 'i' } },
                    { username: { $regex: req.query.nguoi_tao.trim(), $options: 'i' } }
                ]
            }).select('_id');
            filter.nguoi_tao_id = { $in: usersByName.map(user => user._id) };
        }

        const orders = await DonHang.find(filter)
            .populate('khach_hang_id')
            .populate('cua_hang_id')
            .populate('nguoi_tao_id')
            .sort({ created_at: -1 });

        const storeId = await resolveStoreId(req);
        const cashBookQuery = storeId
            ? { trang_thai: 'active', $or: [{ cua_hang_id: storeId }, { cua_hang_id: { $exists: false } }, { cua_hang_id: null }] }
            : { trang_thai: 'active' };
        const vatChuaQuery = storeId
            ? { cua_hang_id: storeId, trang_thai: 'active' }
            : { trang_thai: 'active' };
        const [partners, users, cashBooks, vatChuaList] = await Promise.all([
            DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ ten_doi_tac: 1 }),
            NguoiDung.find().sort({ ho_ten: 1, username: 1 }),
            SoQuy.find(cashBookQuery).sort({ ten_so_quy: 1 }).lean(),
            VatChua.find(vatChuaQuery).sort({ ten_vat_chua: 1 }).select('ten_vat_chua ma_vat_chua').lean()
        ]);
        res.render('don-hang/index', {
            title: 'Đặt hàng',
            orders,
            partners,
            users,
            cashBooks,
            vatChuaList,
            filters: req.query || {},
            exportColumnGroups: getOrderExportColumnGroupsForView()
        });
    } catch (error) {
        next(error);
    }
});

router.get('/export.csv', async (req, res, next) => {
    try {
        const orders = await DonHang.find(buildOrderFilter(req.query)).populate('khach_hang_id').sort({ created_at: -1 });
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['ma_don_hang', 'thoi_gian', 'ma_khach_hang', 'khach_hang', 'khach_can_tra', 'trang_thai'],
            ...orders.map(order => [
                order.ma_don_hang,
                order.ngay_dat ? order.ngay_dat.toISOString() : '',
                order.khach_hang_id?.ma_khach_hang || '',
                order.khach_hang_id?.ten_khach_hang || '',
                order.tong_thanh_toan || order.tong_tien || 0,
                order.trang_thai || ''
            ])
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="dat-hang.csv"');
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
});

router.get('/export.xlsx', async (req, res, next) => {
    try {
        const filter = await buildFullOrderFilter(req.query || {});
        const { orders, detailMap, shipmentMap } = await loadOrderExportData(filter);
        await sendOrderWorkbook(res, 'don-hang.xlsx', orders, detailMap, shipmentMap);
    } catch (error) {
        next(error);
    }
});

router.post('/export-excel', async (req, res, next) => {
    try {
        const columns = resolveOrderExportColumns(req.body.columns);
        if (!columns.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng chền ít nhất 1 cột để xuất.' });
        }
        const filter = await buildFullOrderFilter(req.body || {});
        const { orders, detailMap, shipmentMap } = await loadOrderExportData(filter);
        await sendOrderWorkbook(res, 'don-hang.xlsx', orders, detailMap, shipmentMap, columns);
    } catch (error) {
        next(error);
    }
});

router.get('/:id/export.xlsx', async (req, res, next) => {
    try {
        if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id || ''))) {
            return next();
        }
        const { orders, detailMap, shipmentMap } = await loadOrderExportData({ _id: req.params.id });
        if (!orders.length) return res.status(404).send('Không tìm thấy đơn hàng');
        await sendOrderWorkbook(
            res,
            'don-hang-' + (orders[0].ma_don_hang || 'unknown') + '.xlsx',
            orders,
            detailMap,
            shipmentMap
        );
    } catch (error) {
        next(error);
    }
});

router.get('/create', async (req, res, next) => {
    try {
        const storeId = await resolveStoreId(req);
        const cashBookQuery = storeId
            ? { trang_thai: 'active', $or: [{ cua_hang_id: storeId }, { cua_hang_id: { $exists: false } }, { cua_hang_id: null }] }
            : { trang_thai: 'active' };
        const [data, warehouses, cashBooks] = await Promise.all([
            getOrderCreateData(),
            storeId
                ? Kho.find({ trang_thai: 'active', cua_hang_id: storeId }).sort({ ten_kho: 1 }).lean()
                : [],
            SoQuy.find(cashBookQuery).sort({ ten_so_quy: 1 }).lean()
        ]);
        let sourceOrder = null;
        let sourceOrderItems = [];
        let sourceShipment = null;
        let copyFromError = '';
        const copyFromId = String(req.query?.copy_from || '').trim();
        if (/^[0-9a-fA-F]{24}$/.test(copyFromId)) {
            sourceOrder = await DonHang.findById(copyFromId)
                .populate('khach_hang_id')
                .populate('cua_hang_id')
                .populate('kho_id')
                .lean();
            if (!sourceOrder) {
                copyFromError = 'Không tìm thấy đơn hàng để sao chép.';
            } else if (sourceOrder.trang_thai === 'merged') {
                copyFromError = `Đơn hàng ${sourceOrder.ma_don_hang} đã được gộp vào ${sourceOrder.merged_to_ma_don_hang || 'đơn khác'}, không thể sao chép riêng.`;
                sourceOrder = null;
                sourceOrderItems = [];
                sourceShipment = null;
            } else {
                sourceOrderItems = await CTDonHang.find({ don_hang_id: sourceOrder._id }).populate('hang_hoa_id').lean();
                if (!sourceOrderItems.length) {
                    copyFromError = 'Đơn hàng chưa có sản phẩm để sao chép.';
                }
                sourceShipment = await VanDon.findOne({ don_hang_id: sourceOrder._id }).lean();
            }
        }
        res.render('don-hang/create', {
            title: 'Đặt hàng',
            ...data,
            currentStoreId: storeId || '',
            warehouses,
            cashBooks,
            sourceOrder,
            sourceOrderItems,
            sourceShipment,
            copyFromError
        });
    } catch (error) {
        next(error);
    }
});

router.post('/add', async (req, res, next) => {
    try {
        const {
            khach_hang_id,
            cua_hang_id,
            bang_gia_id,
            items,
            chiet_khau,
            kieu_giam_gia,
            phi_van_chuyen,
            ghi_chu,
            kho_id,
            trang_thai,
            doi_tac_giao_hang_id,
            dia_chi_khach_hang_id,
            ten_nguoi_nhan,
            sdt_nguoi_nhan,
            dia_chi_nhan,
            diem_di,
            diem_den,
            khoang_cach_km,
            ghi_chu_giao_hang,
            thu_ho_cod,
            cod_enabled,
            nguoi_tra_phi_giao_hang,
            ngay_dat,
            so_quy_id
        } = req.body || {};

        const orderItems = parseItems(items);
        if (!Array.isArray(orderItems) || !orderItems.length) {
            return res.status(400).json({ success: false, message: 'Đơn hàng chưa có sản phẩm' });
        }
        if (!kho_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chền kho.' });
        }
        const sessionStoreId = await resolveStoreId(req);
        if (!sessionStoreId) {
            return res.status(400).json({ success: false, message: 'Chưa chền cửa hàng làm việc. Vui lòng chền cửa hàng ở menu trên.' });
        }
        if (!khach_hang_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chền khách hàng.' });
        }
        if (!dia_chi_khach_hang_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chền địa chỉ nhận hàng.' });
        }
        if (!doi_tac_giao_hang_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chền đối tác giao hàng.' });
        }
        const kho = await Kho.findById(kho_id).lean();
        if (!kho) {
            return res.status(400).json({ success: false, message: 'Kho không hợp lệ.' });
        }
        if (String(kho.cua_hang_id || '') !== sessionStoreId) {
            return res.status(400).json({ success: false, message: 'Kho không thuộc cửa hàng đang làm việc.' });
        }
        const validBangGiaId = /^[0-9a-fA-F]{24}$/.test(String(bang_gia_id || '')) ? bang_gia_id : null;

        let tong_tien_hang = 0;
        const normalizedItems = [];
        for (const sourceItem of orderItems) {
            const sourceQuyCachItems = Array.isArray(sourceItem.quy_cach_items) ? sourceItem.quy_cach_items : [];
            const expandedItems = sourceQuyCachItems.length
                ? sourceQuyCachItems
                    .filter(qc => Number(qc.so_luong_dat ?? qc.so_luong) > 0)
                    .map(qc => Object.assign({}, sourceItem, {
                        so_luong: Number(qc.so_luong_dat ?? qc.so_luong),
                        so_luong_dat: Number(qc.so_luong_dat ?? qc.so_luong),
                        lo_hang_id: qc.lo_hang_id || sourceItem.lo_hang_id || null,
                        gia_tri_thuoc_tinh_id: qc.gia_tri_thuoc_tinh_id || sourceItem.gia_tri_thuoc_tinh_id || null,
                        ten_quy_cach: qc.ten_quy_cach || qc.ten_thuoc_tinh || '',
                        ten_thuoc_tinh: qc.ten_thuoc_tinh || qc.ten_quy_cach || '',
                        don_gia_ban: qc.don_gia_ban ?? sourceItem.don_gia_ban,
                        don_gia: qc.don_gia_ban ?? sourceItem.don_gia_ban ?? sourceItem.don_gia,
                        loai_gia_ban: qc.loai_gia_ban ?? sourceItem.loai_gia_ban,
                        chiet_khau: qc.chiet_khau ?? 0,
                        kieu_chiet_khau: qc.kieu_chiet_khau || 'vnd'
                    }))
                : [sourceItem];
            for (const item of expandedItems) {
            const productId = String(item.hang_hoa_id || '').trim();
            const quantity = Number(item.so_luong_dat ?? item.so_luong) || 0;
            if (!productId || quantity <= 0) {
                return res.status(400).json({ success: false, message: 'Dòng hàng không hợp lệ.' });
            }
            const product = await HangHoa.findById(productId).lean();
            if (!product) {
                return res.status(400).json({ success: false, message: 'Không tìm thấy hàng hóa.' });
            }
            const manualUnitPrice = Number(item.don_gia_ban ?? item.don_gia);
            if (Number.isFinite(manualUnitPrice) && manualUnitPrice < 0) {
                return res.status(400).json({ success: false, message: 'Đơn giá không được âm.' });
            }
            const priceResult = await resolveOrderLineUnitPrice(item, product, validBangGiaId, sessionStoreId);
            if (priceResult.error) {
                return res.status(400).json({ success: false, message: priceResult.error });
            }
            const unitPrice = priceResult.unitPrice;
            const lineBase = quantity * unitPrice;
            const lineDiscountAmount = normalizeDiscount(item.chiet_khau, item.kieu_chiet_khau, lineBase);
            const lineDiscountValue = item.kieu_chiet_khau === 'phan_tram'
                ? Math.min(Math.max(Number(item.chiet_khau || 0), 0), 100)
                : lineDiscountAmount;
            const lineTotal = Math.max(lineBase - lineDiscountAmount, 0);
            tong_tien_hang += lineTotal;
            normalizedItems.push({
                product,
                hang_hoa_id: productId,
                lo_hang_id: item.lo_hang_id || null,
                gia_tri_thuoc_tinh_id: optionalLineObjectId(item.gia_tri_thuoc_tinh_id),
                ten_quy_cach: String(item.ten_quy_cach || '').trim(),
                ten_thuoc_tinh: String(item.ten_thuoc_tinh || item.ten_quy_cach || '').trim(),
                don_vi_tinh_id: optionalLineObjectId(item.don_vi_tinh_id || product.don_vi_tinh_id),
                ma_hang_snapshot: String(item.ma_hang_snapshot || product.ma_hang || ''),
                ten_hang_snapshot: String(item.ten_hang_snapshot || product.ten_hang || ''),
                don_vi_tinh_snapshot: String(item.don_vi_tinh_snapshot || ''),
                gia_goc: Number(item.gia_goc || product.gia_co_dinh || 0),
                ghi_chu: String(item.ghi_chu || ''),
                so_luong: quantity,
                don_gia_ban: unitPrice,
                chiet_khau: lineDiscountValue,
                kieu_chiet_khau: item.kieu_chiet_khau === 'phan_tram' ? 'phan_tram' : 'vnd',
                thanh_tien: lineTotal
            });
            }
        }
        if (!normalizedItems.length) {
            return res.status(400).json({ success: false, message: 'Đơn hàng chưa có dòng hàng hợp lệ.' });
        }
        const availabilityValidation = await validateOrderAvailability({
            khoId: kho_id,
            normalizedItems
        });
        if (!availabilityValidation.valid) {
            return res.status(400).json({ success: false, message: availabilityValidation.message });
        }

        const orderDiscount = normalizeDiscount(chiet_khau, kieu_giam_gia, tong_tien_hang);
        const orderDiscountValue = kieu_giam_gia === 'phan_tram'
            ? Math.min(Math.max(Number(chiet_khau || 0), 0), 100)
            : orderDiscount;
        const calculatedShippingFee = await tinhPhiGiaoHang({
            cua_hang_id: sessionStoreId,
            khach_hang_id,
            dia_chi_khach_hang_id,
            doi_tac_giao_hang_id,
            diem_di,
            diem_den: diem_den || dia_chi_nhan,
            khoang_cach_km
        });
        const manualShippingFee = Number(phi_van_chuyen);
        if (Number.isFinite(manualShippingFee) && manualShippingFee < 0) {
            return res.status(400).json({ success: false, message: 'Phí giao hàng không được âm.' });
        }
        const shippingFee = Number.isFinite(manualShippingFee) && manualShippingFee >= 0
            ? manualShippingFee
            : Number(calculatedShippingFee.phi_giao_hang || 0);
        if (shippingFee < 0) {
            return res.status(400).json({ success: false, message: 'Phí giao hàng không được âm.' });
        }
        const shippingFeePayer = nguoi_tra_phi_giao_hang === 'cua_hang' ? 'cua_hang' : 'khach';
        const effectiveShippingFee = shippingFeePayer === 'khach' ? 0 : shippingFee;
        await luuPhiVanChuyenKhachHang({
            cua_hang_id: sessionStoreId,
            khach_hang_id,
            dia_chi_khach_hang_id,
            doi_tac_giao_hang_id,
            phi_van_chuyen: effectiveShippingFee,
            ghi_chu: ghi_chu_giao_hang
        });
        const shippingFeeForCustomer = 0;
        const tong_thanh_toan = Math.max(tong_tien_hang - orderDiscount + shippingFeeForCustomer, 0);
        const codEnabled = false;
        const orderPayment = parseCustomerPaymentFromRequest(req.body, tong_thanh_toan, false);
        if (orderPayment.tong_khach_dua > 0 && !orderPayment.valid) {
            return res.status(400).json({ success: false, message: orderPayment.errors.join('. ') });
        }
        const paymentBooks = resolvePaymentBooksFromBody(req.body || {});
        if (orderPayment.tong_khach_dua > 0) {
            const bookErrors = validatePaymentBooksForCustomer(orderPayment, paymentBooks);
            if (bookErrors.length) {
                return res.status(400).json({ success: false, message: bookErrors.join('. ') });
            }
        }
        const khachThanhToan = Math.max(0, orderPayment.thuc_thu);
        const khachCanTra = Math.max(tong_thanh_toan - khachThanhToan, 0);
        const codAmount = 0;
        const tienThuaTraKhach = orderPayment.tien_thua;
        const ma_don_hang = await generateOrderCode();
        const orderDate = parseOrderDateInput(ngay_dat);

        const order = await DonHang.create({
            ma_don_hang,
            bang_gia_id: validBangGiaId,
            khach_hang_id: khach_hang_id || null,
            cua_hang_id: sessionStoreId,
            kho_id: kho_id || null,
            nguoi_tao_id: req.user?._id,
            ngay_dat: orderDate,
            ngay_tao: orderDate,
            tong_tien: tong_thanh_toan,
            tong_tien_hang,
            giam_gia: orderDiscountValue,
            kieu_giam_gia: kieu_giam_gia === 'phan_tram' ? 'phan_tram' : 'vnd',
            tong_thanh_toan,
            khach_can_tra: khachCanTra,
            khach_thanh_toan: khachThanhToan,
            tien_thua_tra_khach: tienThuaTraKhach,
            cod_enabled: codEnabled,
            cod_amount: codAmount,
            trang_thai: trang_thai || 'draft',
            trang_thai_giao_hang: 'chua_giao',
            ghi_chu
        });

        for (const item of normalizedItems) {
            await CTDonHang.create({
                don_hang_id: order._id,
                hang_hoa_id: item.hang_hoa_id,
                gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id,
                ten_quy_cach: item.ten_quy_cach,
                ten_thuoc_tinh: item.ten_thuoc_tinh,
                don_vi_tinh_id: item.don_vi_tinh_id,
                so_luong: item.so_luong,
                so_luong_dat: item.so_luong,
                so_luong_xac_nhan: 0,
                so_luong_da_giao: 0,
                so_luong_con_thieu: item.so_luong,
                trang_thai_giao: 'chua_giao',
                lo_hang_id: item.lo_hang_id || null,
                don_gia_ban: item.don_gia_ban,
                ma_hang_snapshot: item.ma_hang_snapshot,
                ten_hang_snapshot: item.ten_hang_snapshot,
                don_vi_tinh_snapshot: item.don_vi_tinh_snapshot,
                gia_goc: item.gia_goc,
                chiet_khau: item.chiet_khau,
                kieu_chiet_khau: item.kieu_chiet_khau,
                thanh_tien: item.thanh_tien,
                ghi_chu: item.ghi_chu
            });
        }

        const shipment = await VanDon.create({
            ma_van_don: await generateShipmentCode(),
            don_hang_id: order._id,
            doi_tac_giao_hang_id: doi_tac_giao_hang_id || null,
            cua_hang_id: cua_hang_id || kho.cua_hang_id || null,
            khach_hang_id: khach_hang_id || null,
            dia_chi_khach_hang_id: dia_chi_khach_hang_id || null,
            ten_nguoi_nhan,
            sdt_nguoi_nhan,
            dia_chi_nhan,
            phi_giao_hang: effectiveShippingFee,
            nguoi_tra_phi_giao_hang: shippingFeePayer,
            cod_enabled: codEnabled,
            cod_amount: codAmount,
            trang_thai_cod: codEnabled ? 'chua_thu' : 'khong_cod',
            ghi_chu: ghi_chu_giao_hang,
            trang_thai: 'draft'
        });

        if (orderPayment.tong_khach_dua > 0) {
            const customerName = khach_hang_id
                ? (await KhachHang.findById(khach_hang_id).select('ten_khach_hang').lean())?.ten_khach_hang
                : ten_nguoi_nhan;
            await recordCustomerPaymentReceipts(buildCustomerPaymentReceiptPayload(req.body, orderPayment, {
                loai_thu_chi: 'Thu tien don hang',
                ngay_lap: order.ngay_dat || new Date(),
                cua_hang_id: order.cua_hang_id,
                nguoi_tao_id: req.user?._id,
                khach_hang_id,
                don_hang_id: order._id,
                van_don_id: shipment._id,
                ma_chung_tu_goc: ma_don_hang,
                doi_tuong: customerName || ten_nguoi_nhan || 'Khách lẻ',
                nhom_doi_tuong: 'khach_hang'
            }), orderPayment);
        }

        res.json({ success: true, message: 'Đã tạo đơn đặt hàng', ma_don_hang });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Không tạo được đơn hàng' });
    }
});

router.get('/hoa-don', async (req, res, next) => {
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
            decorateInvoices(rawInvoices),
            DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ ten_doi_tac: 1 }),
            NguoiDung.find().sort({ ho_ten: 1, username: 1 }),
            BangGia.find({ trang_thai: 'active' }).sort({ ten_bang_gia: 1 }),
            SoQuy.find(cashBookQuery).sort({ ten_so_quy: 1 }).lean()
        ]);
        let invoices = applyInvoiceDebtWarningList(decoratedInvoices, debtWarnSettings);
        invoices = filterInvoicesByDebtWarning(invoices, debtWarnSettings);
        res.render('don-hang/hoa-don', {
            title: 'Hóa đơn',
            invoices,
            partners,
            users,
            priceBooks,
            cashBooks,
            vatChuaList,
            customers,
            filters: normalizedFilters,
            debtWarnDefaultDays: INVOICE_DEBT_WARN_DEFAULT_DAYS,
            formatFilterMoney: formatInvoiceFilterMoneyDisplay
        });
    } catch (error) {
        next(error);
    }
});

router.get('/hoa-don/export.csv', async (req, res, next) => {
    try {
        const rawInvoices = await HoaDonBanHang.find(await buildInvoiceFilter(req.query))
            .populate('khach_hang_id')
            .populate('don_hang_id')
            .sort({ created_at: -1 });
        const invoices = await decorateInvoices(rawInvoices);
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['ma_hoa_don', 'thoi_gian', 'ma_khach_hang', 'khach_hang', 'tong_tien_hang', 'giam_gia', 'khach_da_tra', 'trang_thai'],
            ...invoices.map(i => [
                i.ma_hoa_don,
                i.ngay_ban ? i.ngay_ban.toISOString() : '',
                i.khach_hang_id?.ma_khach_hang || '',
                i.khach_hang_id?.ten_khach_hang || '',
                i.tong_tien || 0,
                i.giam_gia || 0,
                i.khach_da_tra || 0,
                i.trang_thai_chuan || i.trang_thai || ''
            ])
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="hoa-don-ban-hang.csv"');
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
});

router.get('/hoa-don/export.xlsx', async (req, res, next) => {
    try {
        const filter = await buildInvoiceFilter(req.query || {});
        const { invoices, detailMap, shipmentMap, paidMap, debtMap } = await loadInvoiceExportData(filter);
        await sendInvoiceWorkbook(res, 'hoa-don-ban-hang.xlsx', invoices, detailMap, shipmentMap, paidMap, debtMap);
    } catch (error) {
        next(error);
    }
});

router.get('/hoa-don/create', async (req, res, next) => {
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
            title: 'Hóa đơn',
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
});

router.post('/hoa-don/trash/preview', async (req, res, next) => {
    try {
        const storeId = await resolveStoreId(req);
        const ids = req.body && req.body.hoa_don_ids;
        const preview = await previewInvoiceTrash(ids, storeId);
        return res.json({ success: true, data: preview });
    } catch (error) {
        const status = Number(error && error.statusCode) || 400;
        return res.status(status).json({ success: false, message: error.message || 'Không xem trước được thùng rác' });
    }
});

router.post('/hoa-don/trash/move', async (req, res, next) => {
    try {
        const storeId = await resolveStoreId(req);
        const ids = req.body && req.body.hoa_don_ids;
        const userId = req.user && req.user._id;
        const result = await moveInvoicesToTrash(ids, storeId, userId);
        return res.json({
            success: true,
            message: 'Đã đưa ' + result.moved_count + ' hóa đơn vào thùng rác.',
            data: result
        });
    } catch (error) {
        const status = Number(error && error.statusCode) || 400;
        return res.status(status).json({ success: false, message: error.message || 'Không đưa vào thùng rác được' });
    }
});

router.get('/hoa-don/:id/export.xlsx', async (req, res, next) => {
    try {
        if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id || ''))) {
            return res.status(404).send('Không tìm thấy hóa đơn');
        }
        const { invoices, detailMap, shipmentMap, paidMap, debtMap } = await loadInvoiceExportData({ _id: req.params.id });
        if (!invoices.length) return res.status(404).send('Không tìm thấy hóa đơn');
        await sendInvoiceWorkbook(
            res,
            'hoa-don-' + (invoices[0].ma_hoa_don || 'unknown') + '.xlsx',
            invoices,
            detailMap,
            shipmentMap,
            paidMap,
            debtMap
        );
    } catch (error) {
        next(error);
    }
});

router.get('/hoa-don/:id/detail', async (req, res, next) => {
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
});

router.post('/hoa-don/:id/save', async (req, res, next) => {
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
                        message: stockError.message || 'Tồn kho không đủ để điều chỉnh số lượng dòng hàng'
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
            return res.status(400).json({ success: false, message: vcErr.message || 'Dữ liệu vật chứa không hợp lệ' });
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
                    message: vatChuaError.message || 'Không ghi nhận xuất vật chứa được'
                });
            }
        }

        return res.json({ success: true, message: 'Đã lưu thông tin hóa đơn' });
    } catch (error) {
        next(error);
    }
});

router.post('/hoa-don/:id/phieu-thu', async (req, res, next) => {
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
});

router.get('/hoa-don/:id', async (req, res, next) => {
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
});

router.post('/hoa-don/:id/duplicate', async (req, res, next) => {
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
});

router.post('/hoa-don/:id/cancel', async (req, res, next) => {
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
                ghi_chu: `Đảo công nợ hủy hóa đơn ${invoice.ma_hoa_don}`,
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
});

async function createInvoice(req, res, next) {
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
                message: 'Hóa đơn từ đơn hàng được tạo tự động khi xác nhận giao hàng. Vui lòng dùng nút Xác nhận giao.'
            });
        }

        if (!Array.isArray(invoiceItems) || !invoiceItems.length) {
            return res.status(400).json({ success: false, message: 'Hóa đơn chưa có sản phẩm' });
        }

        const sessionStoreId = await resolveStoreId(req);
        if (!sessionStoreId) {
            return res.status(400).json({ success: false, message: 'Chưa chền cửa hàng làm việc. Vui lòng chền cửa hàng ở menu trên.' });
        }

        const finalKhoId = kho_id || sourceOrder?.kho_id;
        if (!finalKhoId) {
            return res.status(400).json({ success: false, message: 'Vui lòng chền kho.' });
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
                return res.status(400).json({ success: false, message: 'Vật chứa không hợp lệ hoặc đã ngừng sử dụng' });
            }
            const tonVatChua = Math.max(0, Number(vatChuaRow.so_luong_ton || 0));
            if (tonVatChua < parsedVatChua.qty) {
                return res.status(400).json({
                    success: false,
                    message: 'Tồn vật chứa không đủ để xuất (còn ' + tonVatChua + ', cần ' + parsedVatChua.qty + ')'
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

        const invoice = await HoaDonBanHang.create({
            ma_hoa_don,
            ngay_ban: new Date(),
            tong_tien: tong_tien_hang,
            giam_gia: discount,
            thanh_toan: payable,
            phuong_thuc_tt: codEnabled ? 'COD' : (phuong_thuc_thanh_toan || 'Tiền mặt'),
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
            if (/tồn kho|ton kho|Ton kho/i.test(stockError.message || '')) {
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
                    message: vatChuaError.message || 'Không ghi nhận xuất vật chứa được'
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
                ghi_chu: `Công nợ hóa đơn ${ma_hoa_don}`,
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
                : 'Khách lẻ';
            await recordCustomerPaymentReceipts(buildCustomerPaymentReceiptPayload(req.body, paymentAtCreate, {
                loai_thu_chi: 'Thu tien hoa don',
                ngay_lap: invoice.ngay_ban || new Date(),
                cua_hang_id: invoice.cua_hang_id,
                nguoi_tao_id: req.user?._id,
                khach_hang_id: finalCustomerId,
                doi_tuong: customerName || 'Khách lẻ',
                hoa_don_id: invoice._id,
                van_don_id: shipment?._id,
                ma_chung_tu_goc: ma_hoa_don,
                nhom_doi_tuong: 'khach_hang',
                hach_toan: false
            }), paymentAtCreate);
        }

        res.json({ success: true, message: 'Đã tạo hóa đơn', ma_hoa_don, id: invoice._id, data: { invoice, shipment } });
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
                message: 'Dữ liệu cũ đang có hóa đơn bán trực tiếp với don_hang_id = null. Hệ thống đã bỏ ghi null cho hóa đơn mới; vui lòng xóa field don_hang_id:null ở các hóa đơn cũ hoặc rebuild index nếu cần.'
            });
        }
        if (error?.code === 11000 && error?.keyPattern?.ma_hoa_don) {
            return res.status(409).json({
                success: false,
                message: 'Mã hóa đơn bị trùng. Vui lòng bấm thanh toán lại để hệ thống sinh mã mới.'
            });
        }
        res.status(500).json({ success: false, message: error.message || 'Không tạo được hóa đơn' });
    }
}

router.post('/hoa-don', createInvoice);
router.post('/hoa-don/add', createInvoice);
router.post('/hoa-don/create', createInvoice);

router.get('/tra-hang', async (req, res, next) => {
    try {
        const filter = await buildReturnFilter(req.query);
        const returns = await PhieuTraHang.find(filter)
            .populate('hoa_don_id')
            .populate('khach_hang_id')
            .populate('nguoi_tao_id')
            .sort({ created_at: -1 });
        const users = await NguoiDung.find().sort({ ho_ten: 1, username: 1 });
        res.render('don-hang/tra-hang', { title: 'Trả hàng', returns, users, filters: req.query || {} });
    } catch (error) {
        next(error);
    }
});

router.get('/tra-hang/export.csv', async (req, res, next) => {
    try {
        const returns = await PhieuTraHang.find(await buildReturnFilter(req.query)).populate('khach_hang_id').populate('nguoi_tao_id').sort({ created_at: -1 });
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['ma_phieu_tra', 'thoi_gian', 'nguoi_ban', 'ma_khach_hang', 'khach_hang', 'can_tra_khach', 'trang_thai'],
            ...returns.map(item => [
                item.ma_phieu_tra,
                item.ngay_tra ? item.ngay_tra.toISOString() : '',
                item.nguoi_tao_id?.ho_ten || item.nguoi_tao_id?.username || '',
                item.khach_hang_id?.ma_khach_hang || '',
                item.khach_hang_id?.ten_khach_hang || '',
                item.tong_tien_tra || 0,
                item.trang_thai || ''
            ])
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="tra-hang.csv"');
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
});

router.get('/tra-hang/export.xlsx', async (req, res, next) => {
    try {
        const filter = await buildReturnFilter(req.query || {});
        const { returns, detailMap } = await loadReturnExportData(filter);
        await sendReturnWorkbook(res, 'tra-hang-ban.xlsx', returns, detailMap);
    } catch (error) {
        next(error);
    }
});

async function loadSalesReturnCopyDraft(copyFromId) {
    if (!/^[0-9a-fA-F]{24}$/.test(String(copyFromId || ''))) return null;
    const slip = await PhieuTraHang.findById(copyFromId).lean();
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

router.get('/tra-hang/create', async (req, res, next) => {
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
});

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

router.get('/tra-hang/invoices/search', async (req, res, next) => {
    try {
        const page = Math.max(Number(req.query.page || 1), 1);
        const limit = Math.min(Math.max(Number(req.query.limit || 7), 1), 50);
        const filter = { trang_thai: { $ne: 'cancelled' } };
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
                customerIds.length ? HoaDonBanHang.find({ khach_hang_id: { $in: customerIds } }).select('_id') : [],
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
            ? await HoaDonBanHang.find({ _id: { $in: pagedIds } })
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
                khach_hang: i.khach_hang_id?.ten_khach_hang || 'Khách lẻ',
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
});

router.get('/tra-hang/:id/export.xlsx', async (req, res, next) => {
    try {
        if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id || ''))) {
            return res.status(404).send('Không tìm thấy phiếu trả hàng');
        }
        const { returns, detailMap } = await loadReturnExportData({ _id: req.params.id });
        if (!returns.length) return res.status(404).send('Không tìm thấy phiếu trả hàng');
        await sendReturnWorkbook(
            res,
            'tra-hang-' + (returns[0].ma_phieu_tra || 'unknown') + '.xlsx',
            returns,
            detailMap
        );
    } catch (error) {
        next(error);
    }
});

router.post('/tra-hang/:id/cancel', async (req, res, next) => {
    try {
        const slip = await PhieuTraHang.findById(req.params.id);
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
});

router.patch('/tra-hang/:id', async (req, res, next) => {
    try {
        const slip = await PhieuTraHang.findById(req.params.id);
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
});

router.get('/tra-hang/:id/detail', async (req, res, next) => {
    try {
        const returnSlip = await PhieuTraHang.findById(req.params.id)
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
});

router.get('/tra-hang/invoice/:id', async (req, res, next) => {
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
});

router.post('/tra-hang/add', async (req, res, next) => {
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
            invoice = await HoaDonBanHang.findById(hoa_don_id).lean();
            if (!invoice) return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn' });
            if (normalizeInvoiceStatus(invoice.trang_thai) === 'cancelled') {
                return res.status(400).json({ success: false, message: 'Hóa đơn đã hủy, không thể trả hàng' });
            }
            const invoiceItems = await CTHoaDonBanHang.find({ hoa_don_id }).lean();
            const returns = await PhieuTraHang.find({ hoa_don_id, trang_thai: { $ne: 'cancelled' } }).select('_id').lean();
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
                        return res.status(400).json({ success: false, message: 'So luong tra vuot qua so luong con co the tra' });
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
            return res.status(400).json({ success: false, message: 'Vui lòng chền kho xử lý trả/đổi hàng' });
        }
        const warehouse = await Kho.findById(warehouseId).lean();
        if (!warehouse) {
            return res.status(400).json({ success: false, message: 'Kho xử lý trả/đổi hàng không hợp lệ' });
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
                return res.status(400).json({ success: false, message: 'Vật chứa không hợp lệ hoặc đã ngừng sử dụng' });
            }
            if (parsedVatChua.qty < 0) {
                const tonVatChua = Math.max(0, Number(vatChuaRow.so_luong_ton || 0));
                const exportQty = Math.abs(parsedVatChua.qty);
                if (tonVatChua < exportQty) {
                    return res.status(400).json({
                        success: false,
                        message: 'Tồn vật chứa không đủ để xuất (còn ' + tonVatChua + ', cần ' + exportQty + ')'
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
                return res.status(400).json({ success: false, message: 'Vui lòng nhập tên người gửi trả' });
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
                ghi_chu: `Khach tra hang ${ma_phieu_tra}`
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
                ghi_chu: `Doi hang ${ma_phieu_tra}`
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
                    hoa_don_id: hoa_don_id || undefined,
                    so_tien: debt,
                    loai: 'tang_no',
                    ghi_chu: `Công nợ đổi hàng ${ma_phieu_tra}`,
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
                    message: vatChuaError.message || 'Không ghi nhận vật chứa được'
                });
            }
        }

        res.json({ success: true, message: 'Đã tạo phiếu trả hàng', ma_phieu_tra, id: returnSlip._id, print_url: '/chung-tu-kho/tra-hang-ban/' + returnSlip._id });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Không tạo được phiếu trả hàng' });
    }
});

router.get('/doi-tac-giao-hang', async (req, res, next) => {
    try {
        const partners = await DoiTacGiaoHang.find().sort({ created_at: -1 });
        const partnerIds = partners.map(partner => partner._id);
        const shipments = partnerIds.length ? await VanDon.find({ doi_tac_giao_hang_id: { $in: partnerIds } })
            .populate('don_hang_id')
            .populate('hoa_don_id')
            .populate('khach_hang_id')
            .sort({ created_at: -1 }) : [];
        const shipmentMap = {};
        partnerIds.forEach(id => { shipmentMap[String(id)] = []; });
        shipments.forEach(item => {
            const key = String(item.doi_tac_giao_hang_id || '');
            if (shipmentMap[key]) shipmentMap[key].push(item);
        });
        res.render('don-hang/doi-tac-giao-hang', { title: 'Đối tác giao hàng', partners, shipmentMap });
    } catch (error) {
        next(error);
    }
});

router.get('/doi-tac-giao-hang/export.xlsx', async (req, res, next) => {
    try {
        const { partners, priceMap } = await loadDeliveryPartnerExportData();
        await sendDeliveryPartnerWorkbook(res, 'doi-tac-giao-hang.xlsx', partners, priceMap);
    } catch (error) {
        next(error);
    }
});

router.get('/doi-tac-giao-hang/:id/export.xlsx', async (req, res, next) => {
    try {
        if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id || ''))) {
            return res.status(404).send('Không tìm thấy đối tác giao hàng');
        }
        const { partners, priceMap } = await loadDeliveryPartnerExportData({ _id: req.params.id });
        if (!partners.length) return res.status(404).send('Không tìm thấy đối tác giao hàng');
        await sendDeliveryPartnerWorkbook(
            res,
            'doi-tac-giao-hang-' + (partners[0].ma_doi_tac || 'unknown') + '.xlsx',
            partners,
            priceMap
        );
    } catch (error) {
        next(error);
    }
});

router.post('/doi-tac-giao-hang/add', async (req, res, next) => {
    try {
        const { ma_doi_tac, ten_doi_tac, sdt, email, ghi_chu } = req.body || {};
        if (!ten_doi_tac || ten_doi_tac.trim() === '') {
            return res.status(400).json({ success: false, message: 'Tên đối tác là bắt buộc' });
        }
        const count = await DoiTacGiaoHang.countDocuments();
        const code = ma_doi_tac && ma_doi_tac.trim() !== '' ? ma_doi_tac.trim() : 'DTGH' + String(count + 1).padStart(4, '0');
        const address = normalizeAddress(req.body);
        await DoiTacGiaoHang.create({
            ma_doi_tac: code,
            ten_doi_tac: ten_doi_tac.trim(),
            sdt: sdt?.trim(),
            email: email?.trim(),
            dia_chi_chi_tiet: address.dia_chi_chi_tiet,
            phuong_xa: address.phuong_xa,
            tinh_thanh: address.tinh_thanh,
            dia_chi_day_du: address.dia_chi_day_du,
            ghi_chu: ghi_chu?.trim(),
            trang_thai: 'active'
        });
        res.json({ success: true, message: 'Đã thêm đối tác giao hàng' });
    } catch (error) {
        next(error);
    }
});

router.post('/doi-tac-giao-hang/:id/update', async (req, res, next) => {
    try {
        const { ma_doi_tac, ten_doi_tac, sdt, email, ghi_chu, trang_thai } = req.body || {};
        if (!ten_doi_tac || ten_doi_tac.trim() === '') {
            return res.status(400).json({ success: false, message: 'Tên đối tác là bắt buộc' });
        }
        const partner = await DoiTacGiaoHang.findById(req.params.id);
        if (!partner) return res.status(404).json({ success: false, message: 'Không tìm thấy đối tác giao hàng' });

        if (ma_doi_tac && ma_doi_tac.trim() !== '' && ma_doi_tac.trim() !== partner.ma_doi_tac) {
            const exists = await DoiTacGiaoHang.findOne({ ma_doi_tac: ma_doi_tac.trim(), _id: { $ne: partner._id } });
            if (exists) return res.status(400).json({ success: false, message: 'Mã đối tác đã tồn tại' });
            partner.ma_doi_tac = ma_doi_tac.trim();
        }
        partner.ten_doi_tac = ten_doi_tac.trim();
        partner.sdt = sdt?.trim();
        partner.email = email?.trim();
        const address = normalizeAddress(req.body);
        partner.dia_chi_chi_tiet = address.dia_chi_chi_tiet;
        partner.phuong_xa = address.phuong_xa;
        partner.tinh_thanh = address.tinh_thanh;
        partner.dia_chi_day_du = address.dia_chi_day_du;
        partner.ghi_chu = ghi_chu?.trim();
        if (trang_thai === 'active' || trang_thai === 'inactive') partner.trang_thai = trang_thai;
        await partner.save();
        res.json({ success: true, message: 'Đã cập nhật đối tác giao hàng', data: partner });
    } catch (error) {
        next(error);
    }
});

router.get('/van-don/export.csv', async (req, res, next) => {
    try {
        const shipments = await VanDon.find()
            .populate('don_hang_id')
            .populate('hoa_don_id')
            .populate('doi_tac_giao_hang_id')
            .populate('khach_hang_id')
            .sort({ created_at: -1 });
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['ma_van_don', 'thoi_gian_tao', 'ma_hoa_don', 'ma_khach_hang', 'khach_hang', 'doi_tac_giao_hang', 'trang_thai', 'phi_giao_hang'],
            ...shipments.map(item => [
                item.ma_van_don,
                item.created_at ? item.created_at.toISOString() : '',
                item.hoa_don_id?.ma_hoa_don || item.don_hang_id?.ma_don_hang || '',
                item.khach_hang_id?.ma_khach_hang || '',
                item.khach_hang_id?.ten_khach_hang || item.ten_nguoi_nhan || '',
                item.doi_tac_giao_hang_id?.ten_doi_tac || 'Tự giao hàng',
                item.trang_thai || '',
                item.phi_giao_hang || 0
            ])
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="van-don.csv"');
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
});

router.get('/van-don/export.xlsx', async (req, res, next) => {
    try {
        const filter = await buildShipmentFilter(req.query || {});
        const shipments = await loadShipmentExportData(filter);
        await sendShipmentWorkbook(res, 'van-don.xlsx', shipments);
    } catch (error) {
        next(error);
    }
});

router.get('/van-don/:id/export.xlsx', async (req, res, next) => {
    try {
        if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id || ''))) {
            return res.status(404).send('Không tìm thấy vận đơn');
        }
        const shipments = await loadShipmentExportData({ _id: req.params.id });
        if (!shipments.length) return res.status(404).send('Không tìm thấy vận đơn');
        await sendShipmentWorkbook(
            res,
            'van-don-' + (shipments[0].ma_van_don || 'unknown') + '.xlsx',
            shipments
        );
    } catch (error) {
        next(error);
    }
});

router.post('/van-don/:id/status', async (req, res, next) => {
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
});

router.post('/van-don/:id/thu-cod', async (req, res, next) => {
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
                    throw new Error('So tien COD lon hon cong no hien tai cua khach hang. Vui long kiem tra lai cong no truoc khi thu COD.');
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
        res.json({ success: true, message: 'Da thu COD va giam cong no khach hang', data: responseData });
    } catch (error) {
        return res.status(error.statusCode || 400).json({ success: false, message: error.message || 'Khong thu duoc COD' });
    } finally {
        session.endSession();
    }
});

router.post('/van-don/:id/thu-cod-legacy', async (req, res) => {
    return res.status(410).json({
        success: false,
        message: 'Endpoint thu COD cũ đã ngừng sử dụng. Vui lòng dùng endpoint thu COD mới.'
    });
});

router.post('/van-don/:id/chi-phi-van-chuyen', async (req, res, next) => {
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
});

router.get('/van-don', async (req, res, next) => {
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
                ? { thanh_toan: { $gt: 0 } }
                : { $or: [{ thanh_toan: { $exists: false } }, { thanh_toan: 0 }, { thanh_toan: null }] }
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
        res.render('don-hang/van-don', { title: 'Vận đơn', shipments, partners, filters: req.query || {} });
    } catch (error) {
        next(error);
    }
});

router.get('/van-don/:id', function(req, res) {
    res.redirect('/don-hang/van-don?shipment=' + encodeURIComponent(req.params.id));
});

router.post('/:id/duplicate', async (req, res, next) => {
    try {
        const sourceOrder = await DonHang.findById(req.params.id).lean();
        if (!sourceOrder) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy đơn đặt hàng' });
        }

        if (sourceOrder.trang_thai === 'merged') {
            return res.status(400).json({
                success: false,
                message: `Đơn hàng này đã được gộp vào ${sourceOrder.merged_to_ma_don_hang || 'đơn khác'}, không thể thao tác riêng.`
            });
        }

        const sourceItems = await CTDonHang.find({ don_hang_id: sourceOrder._id }).lean();
        if (!sourceItems.length) {
            return res.status(400).json({ success: false, message: 'Đơn đặt hàng chưa có sản phẩm để sao chép' });
        }

        const sourceShipment = await VanDon.findOne({ don_hang_id: sourceOrder._id }).lean();
        const now = new Date();
        const maDonHang = await generateOrderCode();
        const payable = Number(sourceOrder.tong_thanh_toan || sourceOrder.tong_tien || sourceOrder.khach_can_tra || 0);
        const codEnabled = sourceShipment ? Boolean(sourceShipment.cod_enabled) : Boolean(sourceOrder.cod_enabled);

        const newOrder = await DonHang.create({
            ma_don_hang: maDonHang,
            bang_gia_id: sourceOrder.bang_gia_id || null,
            khach_hang_id: sourceOrder.khach_hang_id || null,
            cua_hang_id: sourceOrder.cua_hang_id || null,
            kho_id: sourceOrder.kho_id || null,
            nguoi_tao_id: req.user?._id || sourceOrder.nguoi_tao_id || null,
            ngay_dat: now,
            ngay_tao: now,
            tong_tien: Number(sourceOrder.tong_tien || payable || 0),
            tong_tien_hang: Number(sourceOrder.tong_tien_hang || 0),
            giam_gia: Number(sourceOrder.giam_gia || 0),
            kieu_giam_gia: sourceOrder.kieu_giam_gia === 'phan_tram' ? 'phan_tram' : 'vnd',
            tong_thanh_toan: payable,
            khach_can_tra: Number(sourceOrder.khach_can_tra || payable || 0),
            khach_thanh_toan: 0,
            tien_thua_tra_khach: 0,
            cod_enabled: codEnabled,
            cod_amount: codEnabled ? Number(sourceOrder.khach_can_tra || payable || 0) : 0,
            trang_thai: 'draft',
            trang_thai_giao_hang: 'chua_giao',
            ghi_chu: sourceOrder.ghi_chu || ''
        });

        await CTDonHang.insertMany(sourceItems.map(item => {
            const quantity = Number(item.so_luong_dat || item.so_luong || 0);
            return {
                don_hang_id: newOrder._id,
                hang_hoa_id: item.hang_hoa_id,
                so_luong: quantity,
                so_luong_dat: quantity,
                so_luong_xac_nhan: 0,
                so_luong_da_giao: 0,
                so_luong_con_thieu: quantity,
                trang_thai_giao: 'chua_giao',
                lo_hang_id: item.lo_hang_id || null,
                don_gia_ban: Number(item.don_gia_ban || 0),
                chiet_khau: Number(item.chiet_khau || 0),
                kieu_chiet_khau: item.kieu_chiet_khau === 'phan_tram' ? 'phan_tram' : 'vnd',
                thanh_tien: Number(item.thanh_tien || 0)
            };
        }));

        if (sourceShipment) {
            await VanDon.create({
                ma_van_don: await generateShipmentCode(),
                don_hang_id: newOrder._id,
                doi_tac_giao_hang_id: sourceShipment.doi_tac_giao_hang_id || null,
                cua_hang_id: sourceShipment.cua_hang_id || sourceOrder.cua_hang_id || null,
                khach_hang_id: sourceShipment.khach_hang_id || sourceOrder.khach_hang_id || null,
                dia_chi_khach_hang_id: sourceShipment.dia_chi_khach_hang_id || null,
                ten_nguoi_nhan: sourceShipment.ten_nguoi_nhan || '',
                sdt_nguoi_nhan: sourceShipment.sdt_nguoi_nhan || '',
                dia_chi_nhan: sourceShipment.dia_chi_nhan || '',
                phi_giao_hang: Number(sourceShipment.phi_giao_hang || 0),
                don_gia_van_chuyen_ap_dung: Number(sourceShipment.don_gia_van_chuyen_ap_dung || 0),
                so_luong_tinh_phi: Number(sourceShipment.so_luong_tinh_phi || 1),
                thanh_tien_van_chuyen: Number(sourceShipment.thanh_tien_van_chuyen || 0),
                nguoi_tra_phi_giao_hang: sourceShipment.nguoi_tra_phi_giao_hang === 'cua_hang' ? 'cua_hang' : 'khach',
                cod_enabled: codEnabled,
                cod_amount: codEnabled ? Number(sourceOrder.khach_can_tra || payable || 0) : 0,
                trang_thai_cod: codEnabled ? 'chua_thu' : 'khong_cod',
                trang_thai: 'draft',
                ghi_chu: sourceShipment.ghi_chu || ''
            });
        }

        res.json({
            success: true,
            message: 'Đã sao chép đơn đặt hàng',
            order_id: String(newOrder._id),
            ma_don_hang: newOrder.ma_don_hang
        });
    } catch (error) {
        next(error);
    }
});

router.get('/:id', function(req, res) {
    res.redirect('/don-hang?order=' + encodeURIComponent(req.params.id));
});

router.get('/:id/detail', async (req, res, next) => {
    try {
        const order = await DonHang.findById(req.params.id)
            .populate('khach_hang_id')
            .populate('cua_hang_id')
            .populate('nguoi_tao_id');
        if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
        const [items, shipment, invoices] = await Promise.all([
            CTDonHang.find({ don_hang_id: order._id }).populate('hang_hoa_id').populate('lo_hang_id'),
            VanDon.findOne({ don_hang_id: order._id }).populate('doi_tac_giao_hang_id').populate('cua_hang_id'),
            HoaDonBanHang.find({ don_hang_id: order._id })
                .select('_id ma_hoa_don trang_thai thanh_toan ngay_ban created_at')
                .sort({ created_at: -1 })
                .lean()
        ]);
        const invoiceIds = invoices.map(row => row._id).filter(Boolean);
        const maDonHang = String(order.ma_don_hang || '').trim();
        const receiptLinkOr = [{ don_hang_id: order._id }];
        if (maDonHang) receiptLinkOr.push({ ma_chung_tu_goc: maDonHang });
        if (invoiceIds.length) {
            receiptLinkOr.push({ hoa_don_id: { $in: invoiceIds } });
        }
        const receipts = await PhieuThuChi.find(receiptRowsForNetPaidFilter({ $or: receiptLinkOr }))
            .populate('nguoi_tao_id')
            .sort({ ngay_lap: -1, created_at: -1 })
            .lean();
        const paymentBalance = await applyOrderPaymentBalance(order, order._id);
        const storeId = await resolveStoreId(req);
        const vatChuaLines = await loadOrderLinkedVatChuaLines(
            order._id,
            invoiceIds,
            storeId || order.cua_hang_id
        );
        res.json({
            success: true,
            data: {
                order,
                items,
                shipment,
                invoices,
                receipts,
                invoice: invoices[0] || null,
                payment_balance: paymentBalance,
                vat_chua_lines: vatChuaLines
            }
        });
    } catch (error) {
        next(error);
    }
});

router.put('/:id/detail', async (req, res, next) => {
    try {
        const order = await DonHang.findById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
        if (order.trang_thai === 'cancelled' || order.trang_thai === 'merged') {
            return res.status(400).json({ success: false, message: 'Đơn đã hủy, không thể sửa' });
        }

        const body = req.body || {};
        if (body.ghi_chu !== undefined) order.ghi_chu = String(body.ghi_chu || '').trim();
        if (body.trang_thai && ['draft', 'shipping', 'completed', 'cancelled', 'merged'].includes(body.trang_thai)) {
            order.trang_thai = body.trang_thai;
        }
        await order.save();

        const shipmentPayload = body.shipment || {};
        let shipment = await VanDon.findOne({ don_hang_id: order._id });
        if (shipment) {
            if (shipmentPayload.ten_nguoi_nhan !== undefined) shipment.ten_nguoi_nhan = String(shipmentPayload.ten_nguoi_nhan || '').trim();
            if (shipmentPayload.sdt_nguoi_nhan !== undefined) shipment.sdt_nguoi_nhan = String(shipmentPayload.sdt_nguoi_nhan || '').trim();
            if (shipmentPayload.dia_chi_nhan !== undefined) shipment.dia_chi_nhan = String(shipmentPayload.dia_chi_nhan || '').trim();
            if (shipmentPayload.ghi_chu !== undefined) shipment.ghi_chu = String(shipmentPayload.ghi_chu || '').trim();
            if (shipmentPayload.phi_giao_hang !== undefined) shipment.phi_giao_hang = Math.max(0, Number(shipmentPayload.phi_giao_hang || 0));
            await shipment.save();
        }

        res.json({ success: true, message: 'Đã lưu thông tin đơn hàng' });
    } catch (error) {
        next(error);
    }
});

async function confirmOrderDelivery(req, res, next) {
    let createdInvoiceId = null;
    let stockAppliedLines = [];
    let orderLinesUpdated = false;
    try {
        const { kho_id, items, khach_thanh_toan, phuong_thuc_thanh_toan } = req.body || {};
        const deliveryItems = parseItems(items);

        if (!kho_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho.' });
        }

        const warehouse = await Kho.findById(kho_id);
        if (!warehouse) {
            return res.status(400).json({ success: false, message: 'Kho giao hàng không hợp lệ' });
        }

        if (!deliveryItems.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn hàng cần giao' });
        }

        const order = await DonHang.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
        }

        if (order.trang_thai === 'merged') {
            return res.status(400).json({
                success: false,
                message: `Đơn này đã được gộp vào ${order.merged_to_ma_don_hang || 'đơn khác'}, không thể xác nhận giao.`
            });
        }

        const sessionStoreId = await resolveStoreId(req);
        if (!sessionStoreId) {
            return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng' });
        }
        if (String(warehouse.cua_hang_id || '') !== String(sessionStoreId)) {
            return res.status(400).json({ success: false, message: 'Kho không thuộc cửa hàng đang làm việc.' });
        }


        const deliveryLines = [];
        for (const item of deliveryItems) {
            const quantity = Number(item.so_luong_giao);
            if (!Number.isFinite(quantity) || quantity <= 0) continue;

            const deliveryPrice = Number(item.don_gia_giao ?? item.don_gia_ban ?? 0);
            if (!Number.isFinite(deliveryPrice) || deliveryPrice < 0) {
                return res.status(400).json({ success: false, message: 'Đơn giá giao không hợp lệ' });
            }

            const detail = item.ct_don_hang_id
                ? await CTDonHang.findOne({ _id: item.ct_don_hang_id, don_hang_id: order._id })
                : await CTDonHang.findOne({ don_hang_id: order._id, hang_hoa_id: item.hang_hoa_id });

            if (!detail) {
                return res.status(400).json({ success: false, message: 'Dòng hàng giao không hợp lệ' });
            }

            const orderedQuantity = Number(detail.so_luong_dat || detail.so_luong || 0);
            const deliveredBefore = Number(detail.so_luong_da_giao || 0);
            const remainingBefore = Math.max(orderedQuantity - deliveredBefore, 0);
            if (quantity > remainingBefore) {
                return res.status(400).json({ success: false, message: 'Số lượng giao vượt quá số lượng còn thiếu' });
            }

            const lineBase = quantity * deliveryPrice;
            const lineDiscount = normalizeDiscount(detail.chiet_khau, detail.kieu_chiet_khau, lineBase);
            const lineTotal = Math.max(lineBase - lineDiscount, 0);

            deliveryLines.push({
                detail,
                quantity,
                deliveryPrice,
                lineDiscount,
                lineTotal,
                lo_hang_id: item.lo_hang_id || detail.lo_hang_id,
                hang_hoa_id: item.hang_hoa_id || detail.hang_hoa_id
            });
        }

        if (!deliveryLines.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập ít nhất một số lượng giao hợp lệ' });
        }

        const stockPreflight = await validateDeliveryStockPreflight(kho_id, warehouse, deliveryLines);
        if (!stockPreflight.valid) {
            return res.status(400).json({
                success: false,
                message: stockPreflight.message,
                shortages: stockPreflight.shortages
            });
        }

        let tong_tien_hang = deliveryLines.reduce((sum, row) => sum + row.lineTotal, 0);
        const orderGoodsTotal = Number(order.tong_tien_hang || 0);
        const orderDiscount = normalizeDiscount(order.giam_gia, order.kieu_giam_gia, orderGoodsTotal);
        const discountShare = orderGoodsTotal > 0
            ? Math.round(orderDiscount * (tong_tien_hang / orderGoodsTotal))
            : 0;
        const payable = Math.max(tong_tien_hang - discountShare, 0);
        const deliveryDue = await computeDeliveryPaymentDue(order._id, payable, order);

        const deliveryPayment = parseCustomerPaymentFromRequest(req.body, deliveryDue.amount_due, false);
        if (deliveryPayment.tong_khach_dua > 0 && !deliveryPayment.valid) {
            return res.status(400).json({ success: false, message: deliveryPayment.errors.join('. ') });
        }
        const paymentBooks = resolvePaymentBooksFromBody(req.body || {});
        if (deliveryPayment.tong_khach_dua > 0) {
            const bookErrors = validatePaymentBooksForCustomer(deliveryPayment, paymentBooks);
            if (bookErrors.length) {
                return res.status(400).json({ success: false, message: bookErrors.join('. ') });
            }
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
                return res.status(400).json({ success: false, message: 'Vật chứa không hợp lệ hoặc đã ngừng sử dụng' });
            }
            const tonVatChua = Math.max(0, Number(vatChuaRow.so_luong_ton || 0));
            if (tonVatChua < parsedVatChua.qty) {
                return res.status(400).json({
                    success: false,
                    message: 'Tồn vật chứa không đủ để xuất (còn ' + tonVatChua + ', cần ' + parsedVatChua.qty + ')'
                });
            }
        }

        const ma_hoa_don = await generateInvoiceCode();
        const invoicePaidTotal = Math.min(
            payable,
            deliveryDue.prepayment_credit + deliveryPayment.thuc_thu
        );
        const invoiceStatus = resolveInvoiceStatus(payable, invoicePaidTotal);
        const shipmentRow = await VanDon.findOne({ don_hang_id: order._id }).lean();

        const invoice = await HoaDonBanHang.create({
            ma_hoa_don,
            ngay_ban: new Date(),
            tong_tien: tong_tien_hang,
            giam_gia: discountShare,
            thanh_toan: payable,
            phuong_thuc_tt: shipmentRow?.cod_enabled ? 'COD' : normalizePaymentMethodValue(phuong_thuc_thanh_toan) || 'Tiền mặt',
            trang_thai: invoiceStatus,
            ghi_chu: `Giao hang don ${order.ma_don_hang}`,
            cua_hang_id: sessionStoreId,
            kho_id,
            don_hang_id: order._id,
            khach_hang_id: order.khach_hang_id,
            nguoi_ban_id: req.user?._id
        });
        createdInvoiceId = invoice._id;

        const invoiceLineRefs = [];
        for (const line of deliveryLines) {
            const detail = line.detail;
            const invoiceLine = await CTHoaDonBanHang.create({
                hoa_don_id: invoice._id,
                ct_don_hang_id: detail._id,
                hang_hoa_id: line.hang_hoa_id,
                lo_hang_id: null,
                lot_allocations: [],
                gia_tri_thuoc_tinh_id: detail.gia_tri_thuoc_tinh_id,
                ten_quy_cach: detail.ten_quy_cach,
                ten_thuoc_tinh: detail.ten_thuoc_tinh,
                don_vi_tinh_id: detail.don_vi_tinh_id,
                ma_hang_snapshot: detail.ma_hang_snapshot,
                ten_hang_snapshot: detail.ten_hang_snapshot,
                don_vi_tinh_snapshot: detail.don_vi_tinh_snapshot,
                so_luong: line.quantity,
                don_gia: line.deliveryPrice,
                chiet_khau: line.lineDiscount,
                thanh_tien: line.lineTotal,
                ghi_chu: detail.ghi_chu
            });
            invoiceLineRefs.push({ invoiceLine, line });
        }

        try {
            for (const { invoiceLine, line } of invoiceLineRefs) {
                const detail = line.detail;
                const preferredLotId = line.lo_hang_id || detail.lo_hang_id || undefined;
                const stockResult = await truTonKho({
                    kho_id,
                    hang_hoa_id: line.hang_hoa_id,
                    lo_hang_id: preferredLotId,
                    ten_quy_cach: detail.ten_quy_cach || detail.ten_thuoc_tinh || '',
                    gia_tri_thuoc_tinh_id: detail.gia_tri_thuoc_tinh_id || undefined,
                    sync_quy_cach: Boolean(detail.gia_tri_thuoc_tinh_id || detail.ten_quy_cach || detail.ten_thuoc_tinh),
                    so_luong: line.quantity,
                    nguoi_tao_id: req.user?._id,
                    loai_phieu: 'ban_hang',
                    ma_phieu: ma_hoa_don,
                    ghi_chu: `Xuat kho HĐ ${ma_hoa_don} - don ${order.ma_don_hang}`
                });
                const lotPatch = applyLotAllocationsToInvoiceLine(stockResult.allocations);
                await CTHoaDonBanHang.updateOne({ _id: invoiceLine._id }, { $set: lotPatch });
                stockAppliedLines.push({
                    hang_hoa_id: line.hang_hoa_id,
                    lo_hang_id: lotPatch.lo_hang_id,
                    lot_allocations: lotPatch.lot_allocations,
                    gia_tri_thuoc_tinh_id: detail.gia_tri_thuoc_tinh_id,
                    ten_quy_cach: detail.ten_quy_cach,
                    ten_thuoc_tinh: detail.ten_thuoc_tinh,
                    so_luong: line.quantity
                });
            }
            invoice.da_tru_ton_kho = true;
            await invoice.save();
        } catch (stockError) {
            await rollbackDeliveryInvoice(createdInvoiceId, {
                kho_id,
                nguoi_tao_id: req.user?._id,
                stockLines: stockAppliedLines,
                restoreStock: stockAppliedLines.length > 0
            });
            createdInvoiceId = null;
            stockAppliedLines = [];
            if (/tồn kho|ton kho|Ton kho/i.test(stockError.message || '')) {
                return res.status(400).json({ success: false, message: stockError.message });
            }
            throw stockError;
        }

        if (parsedVatChua.vatChuaId && parsedVatChua.qty > 0) {
            const customerForVatChua = order.khach_hang_id
                ? (await KhachHang.findById(order.khach_hang_id).select('ten_khach_hang').lean())?.ten_khach_hang
                : '';
            try {
                await exportVatChuaWithOrderDelivery(order, invoice, {
                    vat_chua_id: parsedVatChua.vatChuaId,
                    vat_chua_so_luong: parsedVatChua.qty,
                    khach_hang_ten: customerForVatChua || ''
                });
            } catch (vatChuaError) {
                await rollbackDeliveryInvoice(createdInvoiceId, {
                    kho_id,
                    nguoi_tao_id: req.user?._id,
                    stockLines: stockAppliedLines,
                    restoreStock: stockAppliedLines.length > 0
                });
                createdInvoiceId = null;
                stockAppliedLines = [];
                return res.status(400).json({ success: false, message: vatChuaError.message || 'Không ghi nhận xuất vật chứa được' });
            }
        }

        for (const line of deliveryLines) {
            const detail = line.detail;
            const orderedQuantity = Number(detail.so_luong_dat || detail.so_luong || 0);
            const deliveredBefore = Number(detail.so_luong_da_giao || 0);
            const deliveredAfter = deliveredBefore + line.quantity;
            const missingAfter = Math.max(orderedQuantity - deliveredAfter, 0);
            detail.so_luong_dat = orderedQuantity;
            detail.so_luong_xac_nhan = Number(detail.so_luong_xac_nhan || 0) + line.quantity;
            detail.so_luong_da_giao = deliveredAfter;
            detail.so_luong_con_thieu = missingAfter;
            detail.trang_thai_giao = deliveredAfter <= 0
                ? 'chua_giao'
                : (missingAfter <= 0 ? 'giao_du' : 'giao_thieu');
            await detail.save();
        }
        orderLinesUpdated = true;

        const allDetails = await CTDonHang.find({ don_hang_id: order._id });
        const allDelivered = allDetails.length > 0 && allDetails.every(item => Number(item.so_luong_con_thieu || 0) <= 0);
        const anyDelivered = allDetails.some(item => Number(item.so_luong_da_giao || 0) > 0);
        const anyMissing = allDetails.some(item => Number(item.so_luong_con_thieu || 0) > 0);

        order.kho_id = kho_id;
        order.trang_thai_giao_hang = allDelivered
            ? 'giao_du'
            : (anyDelivered && anyMissing ? 'giao_mot_phan' : 'chua_giao');
        order.ngay_giao_thuc_te = new Date();
        if (!order.trang_thai || order.trang_thai === 'draft' || order.trang_thai === 'da_xac_nhan') {
            order.trang_thai = allDelivered ? 'completed' : 'shipping';
        } else if (order.trang_thai === 'shipping' && allDelivered) {
            order.trang_thai = 'completed';
        }

        const debt = Math.max(deliveryDue.amount_due - deliveryPayment.thuc_thu, 0);
        if (debt > 0 && order.khach_hang_id) {
            await CongNoKhachHang.create({
                khach_hang_id: order.khach_hang_id,
                don_hang_id: order._id,
                hoa_don_id: invoice._id,
                so_tien: debt,
                loai: 'tang_no',
                ghi_chu: `Công nợ hóa đơn ${ma_hoa_don}`,
                ngay: invoice.ngay_ban
            });
            const customer = await KhachHang.findById(order.khach_hang_id).select('tong_no').lean();
            if (customer && typeof customer.tong_no === 'number') {
                await KhachHang.updateOne({ _id: order.khach_hang_id }, { $inc: { tong_no: debt } });
            }
        }

        let receipt = null;
        if (deliveryPayment.tong_khach_dua > 0) {
            const customerName = order.khach_hang_id
                ? (await KhachHang.findById(order.khach_hang_id).select('ten_khach_hang').lean())?.ten_khach_hang
                : 'Khách lẻ';
            const paymentResult = await recordCustomerPaymentReceipts(buildCustomerPaymentReceiptPayload(req.body, deliveryPayment, {
                loai_thu_chi: 'Thu tien khi giao hang',
                ngay_lap: new Date(),
                cua_hang_id: order.cua_hang_id,
                nguoi_tao_id: req.user?._id,
                khach_hang_id: order.khach_hang_id,
                doi_tuong: customerName || 'Khách lẻ',
                don_hang_id: order._id,
                hoa_don_id: invoice._id,
                van_don_id: shipmentRow?._id,
                ma_chung_tu_goc: ma_hoa_don,
                nhom_doi_tuong: 'khach_hang',
                hach_toan: false
            }), deliveryPayment);
            receipt = paymentResult.thu;
        }

        await applyOrderPaymentBalance(order, order._id);
        await order.save();

        if (shipmentRow) {
            await VanDon.updateOne(
                { _id: shipmentRow._id },
                { $set: { hoa_don_id: invoice._id } }
            );
        }

        return res.json({
            success: true,
            message: `Đã xác nhận giao và tạo hóa đơn ${ma_hoa_don}`,
            data: {
                don_hang_id: order._id,
                hoa_don_id: invoice._id,
                ma_hoa_don,
                trang_thai_giao_hang: order.trang_thai_giao_hang,
                ngay_giao_thuc_te: order.ngay_giao_thuc_te,
                khach_thanh_toan: order.khach_thanh_toan,
                khach_can_tra: order.khach_can_tra,
                thanh_toan_hoa_don: payable,
                prepayment_credit: deliveryDue.prepayment_credit,
                amount_due_at_delivery: deliveryDue.amount_due,
                phieu_thu_id: receipt?._id
            },
            print_url: '/chung-tu-kho/hoa-don-ban/' + invoice._id
        });
    } catch (error) {
        if (createdInvoiceId) {
            await rollbackDeliveryInvoice(createdInvoiceId, {
                kho_id: req.body?.kho_id,
                nguoi_tao_id: req.user?._id,
                stockLines: stockAppliedLines,
                restoreStock: stockAppliedLines.length > 0,
                revertOrderLines: orderLinesUpdated
            });
        }
        next(error);
    }
}

router.put('/:id/xac-nhan-giao', confirmOrderDelivery);

router.post('/:id/phieu-thu', async (req, res, next) => {
    try {
        const order = await DonHang.findById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
        if (order.trang_thai === 'cancelled' || order.trang_thai === 'merged') {
            return res.status(400).json({ success: false, message: 'Đơn đã hủy, không thể thu tiền' });
        }

        const debtSummary = await getOrderInvoiceDebtSummary(order._id);
        const balance = await computeOrderPaymentBalance(order._id, order);
        const remaining = debtSummary.invoices.length
            ? debtSummary.totalRemaining
            : balance.khach_can_tra;
        const payment = parseCustomerPaymentFromRequest(req.body, remaining, true);
        if (!payment.valid) {
            return res.status(400).json({ success: false, message: payment.errors.join('. ') });
        }
        const paymentBooks = resolvePaymentBooksFromBody(req.body || {});
        const bookErrors = validatePaymentBooksForCustomer(payment, paymentBooks);
        if (bookErrors.length) {
            return res.status(400).json({ success: false, message: bookErrors.join('. ') });
        }
        const cashBookId = resolveCashBookIdFromBody(req.body || {});
        if (!paymentBooks.so_quy_tien_mat_id && !paymentBooks.so_quy_chuyen_khoan_id && !cashBookId) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ để thu tiền đơn hàng.' });
        }

        const shipment = await VanDon.findOne({ don_hang_id: order._id }).lean();
        const receipts = [];
        const customerName = order.khach_hang_id
            ? (await KhachHang.findById(order.khach_hang_id).select('ten_khach_hang').lean())?.ten_khach_hang
            : 'Khách lẻ';
        const primaryInvoice = debtSummary.openInvoices[0]?.invoice || null;

        if (payment.tong_khach_dua > 0) {
            const paymentResult = await recordCustomerPaymentReceipts(buildCustomerPaymentReceiptPayload(req.body, payment, {
                loai_thu_chi: 'Thu tien don hang',
                ngay_lap: new Date(),
                cua_hang_id: order.cua_hang_id,
                nguoi_tao_id: req.user?._id,
                khach_hang_id: order.khach_hang_id,
                doi_tuong: customerName || 'Khách lẻ',
                don_hang_id: order._id,
                hoa_don_id: primaryInvoice?._id,
                van_don_id: shipment?._id,
                ma_chung_tu_goc: primaryInvoice?.ma_hoa_don || order.ma_don_hang,
                nhom_doi_tuong: 'khach_hang',
                hach_toan: false
            }), payment);
            if (paymentResult.thu) receipts.push(paymentResult.thu);
        }

        let amountLeft = payment.thuc_thu;
        if (debtSummary.openInvoices.length) {
            for (const row of debtSummary.openInvoices) {
                if (amountLeft <= 0) break;
                const slice = Math.min(amountLeft, row.remaining);
                const inv = row.invoice;
                amountLeft -= slice;

                const invoiceDoc = await HoaDonBanHang.findById(inv._id);
                if (invoiceDoc) {
                    const paidOnInvoice = await getInvoicePaidAmount(inv._id);
                    invoiceDoc.trang_thai = resolveInvoiceStatus(Number(inv.thanh_toan || 0), paidOnInvoice);
                    await invoiceDoc.save();
                }
                if (order.khach_hang_id && slice > 0) {
                    await CongNoKhachHang.create({
                        khach_hang_id: order.khach_hang_id,
                        don_hang_id: order._id,
                        hoa_don_id: inv._id,
                        phieu_thu_chi_id: receipts[0]?._id,
                        so_tien: slice,
                        loai: 'giam_no',
                        ghi_chu: `Thu tiền hóa đơn ${inv.ma_hoa_don || order.ma_don_hang}`,
                        ngay: new Date()
                    });
                    const customerDebt = await KhachHang.findById(order.khach_hang_id).select('tong_no').lean();
                    if (customerDebt && typeof customerDebt.tong_no === 'number') {
                        await KhachHang.updateOne({ _id: order.khach_hang_id }, { $inc: { tong_no: -slice } });
                    }
                }
            }
        }

        await applyOrderPaymentBalance(order, order._id);
        await order.save();

        const paidAfter = order.khach_thanh_toan;
        const remainingAfter = order.khach_can_tra;
        res.json({
            success: true,
            message: 'Đã tạo phiếu thu',
            data: {
                receipt: receipts[0] || null,
                receipts,
                paid: paidAfter,
                remaining: remainingAfter
            }
        });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/status', async (req, res, next) => {
    try {
        const { trang_thai, force_complete_short } = req.body || {};
        const allowed = ['draft', 'shipping', 'completed', 'cancelled'];
        if (!allowed.includes(trang_thai)) {
            return res.status(400).json({ success: false, message: 'Trạng thái đơn hàng không hợp lệ' });
        }
        const order = await DonHang.findById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
        if (order.trang_thai === 'merged') {
            return res.status(400).json({ success: false, message: `Đơn này đã được gộp vào ${order.merged_to_ma_don_hang || 'đơn khác'}, không thể cập nhật trạng thái.` });
        }
        if (trang_thai === 'completed' && order.trang_thai_giao_hang !== 'giao_du' && !force_complete_short) {
            return res.status(400).json({
                success: false,
                code: 'NEED_CONFIRM_SHORT',
                message: 'Đơn chưa giao đủ. Cần xác nhận kết thúc thiếu.'
            });
        }
        order.trang_thai = trang_thai;
        await order.save();
        res.json({ success: true, message: 'Đã cập nhật trạng thái đơn hàng' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
