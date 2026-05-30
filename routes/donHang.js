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
    Counter
} = require('../models/kiot.model');
const { congTonKho, truTonKho } = require('../services/kho.service');
const { tinhPhiGiaoHang, luuPhiVanChuyenKhachHang } = require('../services/phiGiaoHang.service');
const { taoPhieuThuChi, ensureDefaultSoQuy } = require('../services/soQuy.service');
const { createCustomerDebtTransaction } = require('../services/customerDebt.service');
const {
    buildVariantKey,
    getReservedQuantitiesByOrder
} = require('../services/availability.service');
const { normalizeAddress } = require('../utils/address');
const { resolveStoreId } = require('../utils/storeScope');

router.use(isAuthenticated);

const CHO_PHEP_DAT_AM_KHO = true;

const ORDER_EXPORT_STATUS_MAP = {
    draft: 'PhiÃ¡ÂºÂ¿u tÃ¡ÂºÂ¡m',
    shipping: 'Ã„Âang giao hÃƒÂ ng',
    completed: 'HoÃƒÂ n thÃƒÂ nh',
    cancelled: 'Ã„ÂÃƒÂ£ hÃ¡Â»Â§y',
    merged: 'Ã„ÂÃƒÂ£ gÃ¡Â»â„¢p'
};

const ORDER_EXPORT_DELIVERY_STATUS_MAP = {
    chua_giao: 'ChÃ†Â°a giao',
    giao_mot_phan: 'Giao mÃ¡Â»â„¢t phÃ¡ÂºÂ§n',
    giao_thieu: 'Giao thiÃ¡ÂºÂ¿u',
    giao_du: 'Giao Ã„â€˜Ã¡Â»Â§'
};

const ORDER_EXPORT_LINE_DELIVERY_STATUS_MAP = {
    chua_giao: 'ChÃ†Â°a giao',
    giao_thieu: 'Giao thiÃ¡ÂºÂ¿u',
    giao_du: 'Giao Ã„â€˜Ã¡Â»Â§'
};

// ChÃ¡Â»â€° cÃ¡Â»â„¢t thuÃ¡Â»â„¢c don_hang, ct_don_hang, van_don (gÃ¡ÂºÂ¯n Ã„â€˜Ã†Â¡n), khach_hang (ref Ã„â€˜Ã†Â¡n)
const ORDER_EXPORT_COLUMN_DEFS = [
    { group: 'don_hang', key: 'ma_don_hang', header: 'MÃƒÂ£ Ã„â€˜Ã†Â¡n hÃƒÂ ng', default: true },
    { group: 'don_hang', key: 'ngay_dat', header: 'NgÃƒÂ y Ã„â€˜Ã¡ÂºÂ·t', default: true },
    { group: 'don_hang', key: 'ngay_giao_thuc_te', header: 'NgÃƒÂ y giao thÃ¡Â»Â±c tÃ¡ÂºÂ¿' },
    { group: 'don_hang', key: 'cua_hang', header: 'CÃ¡Â»Â­a hÃƒÂ ng', default: true },
    { group: 'don_hang', key: 'kho', header: 'Kho', default: true },
    { group: 'don_hang', key: 'bang_gia', header: 'BÃ¡ÂºÂ£ng giÃƒÂ¡', default: true },
    { group: 'don_hang', key: 'nguoi_tao', header: 'NgÃ†Â°Ã¡Â»Âi tÃ¡ÂºÂ¡o', default: true },
    { group: 'don_hang', key: 'trang_thai', header: 'TrÃ¡ÂºÂ¡ng thÃƒÂ¡i Ã„â€˜Ã†Â¡n', default: true },
    { group: 'don_hang', key: 'trang_thai_giao_hang', header: 'TrÃ¡ÂºÂ¡ng thÃƒÂ¡i giao hÃƒÂ ng', default: true },
    { group: 'don_hang', key: 'ghi_chu', header: 'Ghi chÃƒÂº' },
    { group: 'khach_nhan', key: 'ma_khach_hang', header: 'MÃƒÂ£ khÃƒÂ¡ch hÃƒÂ ng', default: true },
    { group: 'khach_nhan', key: 'ten_khach_hang', header: 'TÃƒÂªn khÃƒÂ¡ch hÃƒÂ ng', default: true },
    { group: 'khach_nhan', key: 'ten_nguoi_nhan', header: 'NgÃ†Â°Ã¡Â»Âi nhÃ¡ÂºÂ­n' },
    { group: 'khach_nhan', key: 'sdt_nguoi_nhan', header: 'SÃ„ÂT ngÃ†Â°Ã¡Â»Âi nhÃ¡ÂºÂ­n', default: true },
    { group: 'khach_nhan', key: 'dia_chi_nhan', header: 'Ã„ÂÃ¡Â»â€¹a chÃ¡Â»â€° nhÃ¡ÂºÂ­n hÃƒÂ ng', default: true },
    { group: 'khach_nhan', key: 'doi_tac_giao_hang', header: 'Ã„ÂÃ¡Â»â€˜i tÃƒÂ¡c giao hÃƒÂ ng' },
    { group: 'khach_nhan', key: 'nguoi_tra_phi_giao_hang', header: 'NgÃ†Â°Ã¡Â»Âi trÃ¡ÂºÂ£ phÃƒÂ­ giao hÃƒÂ ng' },
    { group: 'thanh_toan', key: 'tong_so_luong_dat', header: 'TÃ¡Â»â€¢ng SL Ã„â€˜Ã¡ÂºÂ·t', style: { numFmt: '#,##0.##' } },
    { group: 'thanh_toan', key: 'tong_tien_hang', header: 'TÃ¡Â»â€¢ng tiÃ¡Â»Ân hÃƒÂ ng', style: { numFmt: '#,##0' }, default: true },
    { group: 'thanh_toan', key: 'giam_gia', header: 'GiÃ¡ÂºÂ£m giÃƒÂ¡', style: { numFmt: '#,##0.##' }, default: true },
    { group: 'thanh_toan', key: 'kieu_giam_gia', header: 'KiÃ¡Â»Æ’u giÃ¡ÂºÂ£m giÃƒÂ¡' },
    { group: 'thanh_toan', key: 'phi_giao_hang', header: 'PhÃƒÂ­ giao hÃƒÂ ng', style: { numFmt: '#,##0' } },
    { group: 'thanh_toan', key: 'khach_can_tra', header: 'KhÃƒÂ¡ch cÃ¡ÂºÂ§n trÃ¡ÂºÂ£', style: { numFmt: '#,##0' }, default: true },
    { group: 'thanh_toan', key: 'khach_thanh_toan', header: 'KhÃƒÂ¡ch Ã„â€˜ÃƒÂ£ trÃ¡ÂºÂ£', style: { numFmt: '#,##0' }, default: true },
    { group: 'thanh_toan', key: 'tien_thua_tra_khach', header: 'TiÃ¡Â»Ân thÃ¡Â»Â«a trÃ¡ÂºÂ£ khÃƒÂ¡ch', style: { numFmt: '#,##0' } },
    { group: 'thanh_toan', key: 'cod_enabled', header: 'COD' },
    { group: 'thanh_toan', key: 'cod_amount', header: 'SÃ¡Â»â€˜ tiÃ¡Â»Ân COD', style: { numFmt: '#,##0' } },
    { group: 'chi_tiet', key: 'ma_hang', header: 'MÃƒÂ£ hÃƒÂ ng', default: true },
    { group: 'chi_tiet', key: 'ten_hang', header: 'TÃƒÂªn hÃƒÂ ng', default: true },
    { group: 'chi_tiet', key: 'lo_hang', header: 'LÃƒÂ´ hÃƒÂ ng' },
    { group: 'chi_tiet', key: 'so_luong_dat', header: 'SL Ã„â€˜Ã¡ÂºÂ·t', style: { numFmt: '#,##0.##' }, default: true },
    { group: 'chi_tiet', key: 'so_luong_xac_nhan', header: 'SL xÃƒÂ¡c nhÃ¡ÂºÂ­n', style: { numFmt: '#,##0.##' } },
    { group: 'chi_tiet', key: 'so_luong_da_giao', header: 'SL Ã„â€˜ÃƒÂ£ giao', style: { numFmt: '#,##0.##' }, default: true },
    { group: 'chi_tiet', key: 'so_luong_con_thieu', header: 'SL cÃƒÂ²n thiÃ¡ÂºÂ¿u', style: { numFmt: '#,##0.##' } },
    { group: 'chi_tiet', key: 'trang_thai_giao', header: 'TrÃ¡ÂºÂ¡ng thÃƒÂ¡i giao dÃƒÂ²ng' },
    { group: 'chi_tiet', key: 'don_gia_ban', header: 'Ã„ÂÃ†Â¡n giÃƒÂ¡ bÃƒÂ¡n', style: { numFmt: '#,##0' }, default: true },
    { group: 'chi_tiet', key: 'chiet_khau', header: 'ChiÃ¡ÂºÂ¿t khÃ¡ÂºÂ¥u', style: { numFmt: '#,##0.##' } },
    { group: 'chi_tiet', key: 'kieu_chiet_khau', header: 'KiÃ¡Â»Æ’u chiÃ¡ÂºÂ¿t khÃ¡ÂºÂ¥u' },
    { group: 'chi_tiet', key: 'thanh_tien', header: 'ThÃƒÂ nh tiÃ¡Â»Ân', style: { numFmt: '#,##0' }, default: true }
];

const ORDER_EXPORT_COLUMN_MAP = ORDER_EXPORT_COLUMN_DEFS.reduce((map, item) => {
    map[item.key] = item;
    return map;
}, {});

const ORDER_EXPORT_COLUMN_GROUPS = [
    { id: 'don_hang', title: 'ThÃƒÂ´ng tin Ã„â€˜Ã†Â¡n hÃƒÂ ng' },
    { id: 'khach_nhan', title: 'KhÃƒÂ¡ch hÃƒÂ ng & nhÃ¡ÂºÂ­n hÃƒÂ ng' },
    { id: 'thanh_toan', title: 'Thanh toÃƒÂ¡n' },
    { id: 'chi_tiet', title: 'Chi tiÃ¡ÂºÂ¿t Ã„â€˜Ã¡ÂºÂ·t hÃƒÂ ng' }
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
    processing: 'Ã„Âang xÃ¡Â»Â­ lÃƒÂ½',
    completed: 'HoÃƒÂ n thÃƒÂ nh',
    failed: 'KhÃƒÂ´ng giao Ã„â€˜Ã†Â°Ã¡Â»Â£c',
    cancelled: 'Ã„ÂÃƒÂ£ hÃ¡Â»Â§y',
    paid: 'Ã„ÂÃƒÂ£ thanh toÃƒÂ¡n',
    partial: 'Thanh toÃƒÂ¡n mÃ¡Â»â„¢t phÃ¡ÂºÂ§n',
    unpaid: 'ChÃ†Â°a thanh toÃƒÂ¡n',
    draft: 'Ã„Âang xÃ¡Â»Â­ lÃƒÂ½',
    shipping: 'Ã„Âang xÃ¡Â»Â­ lÃƒÂ½',
    done: 'HoÃƒÂ n thÃƒÂ nh'
};

const INVOICE_EXPORT_COLUMNS = [
    { header: 'MÃƒÂ£ hÃƒÂ³a Ã„â€˜Ã†Â¡n', key: 'ma_hoa_don' },
    { header: 'ThÃ¡Â»Âi gian bÃƒÂ¡n', key: 'thoi_gian_ban' },
    { header: 'MÃƒÂ£ Ã„â€˜Ã†Â¡n hÃƒÂ ng', key: 'ma_don_hang' },
    { header: 'KhÃƒÂ¡ch hÃƒÂ ng', key: 'khach_hang' },
    { header: 'Ã„ÂiÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i', key: 'dien_thoai' },
    { header: 'Ã„ÂÃ¡Â»â€¹a chÃ¡Â»â€°', key: 'dia_chi' },
    { header: 'Kho', key: 'kho' },
    { header: 'BÃ¡ÂºÂ£ng giÃƒÂ¡', key: 'bang_gia' },
    { header: 'NhÃƒÂ¢n viÃƒÂªn bÃƒÂ¡n hÃƒÂ ng', key: 'nhan_vien_ban_hang' },
    { header: 'TÃ¡Â»â€¢ng tiÃ¡Â»Ân hÃƒÂ ng', key: 'tong_tien_hang', style: { numFmt: '#,##0' } },
    { header: 'GiÃ¡ÂºÂ£m giÃƒÂ¡', key: 'giam_gia', style: { numFmt: '#,##0.##' } },
    { header: 'PhÃƒÂ­ giao hÃƒÂ ng', key: 'phi_giao_hang', style: { numFmt: '#,##0' } },
    { header: 'KhÃƒÂ¡ch cÃ¡ÂºÂ§n trÃ¡ÂºÂ£', key: 'khach_can_tra', style: { numFmt: '#,##0' } },
    { header: 'KhÃƒÂ¡ch Ã„â€˜ÃƒÂ£ trÃ¡ÂºÂ£', key: 'khach_da_tra', style: { numFmt: '#,##0' } },
    { header: 'TiÃ¡Â»Ân thÃ¡Â»Â«a trÃ¡ÂºÂ£ khÃƒÂ¡ch', key: 'tien_thua_tra_khach', style: { numFmt: '#,##0' } },
    { header: 'CÃƒÂ´ng nÃ¡Â»Â£', key: 'cong_no', style: { numFmt: '#,##0' } },
    { header: 'PhÃ†Â°Ã†Â¡ng thÃ¡Â»Â©c thanh toÃƒÂ¡n', key: 'phuong_thuc_thanh_toan' },
    { header: 'COD', key: 'cod' },
    { header: 'TrÃ¡ÂºÂ¡ng thÃƒÂ¡i hÃƒÂ³a Ã„â€˜Ã†Â¡n', key: 'trang_thai_hoa_don' },
    { header: 'Ghi chÃƒÂº', key: 'ghi_chu' },
    { header: 'MÃƒÂ£ hÃƒÂ ng', key: 'ma_hang' },
    { header: 'TÃƒÂªn hÃƒÂ ng', key: 'ten_hang' },
    { header: 'ThÃ†Â°Ã†Â¡ng hiÃ¡Â»â€¡u', key: 'thuong_hieu' },
    { header: 'NhÃƒÂ³m hÃƒÂ ng', key: 'nhom_hang' },
    { header: 'Ã„ÂÃ†Â¡n vÃ¡Â»â€¹ tÃƒÂ­nh', key: 'don_vi_tinh' },
    { header: 'LÃƒÂ´ hÃƒÂ ng', key: 'lo_hang' },
    { header: 'SÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng', key: 'so_luong', style: { numFmt: '#,##0.##' } },
    { header: 'Ã„ÂÃ†Â¡n giÃƒÂ¡', key: 'don_gia', style: { numFmt: '#,##0' } },
    { header: 'ChiÃ¡ÂºÂ¿t khÃ¡ÂºÂ¥u', key: 'chiet_khau', style: { numFmt: '#,##0.##' } },
    { header: 'ThÃƒÂ nh tiÃ¡Â»Ân', key: 'thanh_tien', style: { numFmt: '#,##0' } },
    { header: 'GiÃƒÂ¡ vÃ¡Â»â€˜n', key: 'gia_von', style: { numFmt: '#,##0' } }
];

const RETURN_EXPORT_STATUS_MAP = {
    completed: 'Ã„ÂÃƒÂ£ trÃ¡ÂºÂ£',
    cancelled: 'Ã„ÂÃƒÂ£ hÃ¡Â»Â§y',
    draft: 'PhiÃ¡ÂºÂ¿u tÃ¡ÂºÂ¡m',
    pending: 'Ã„Âang xÃ¡Â»Â­ lÃƒÂ½'
};

const RETURN_EXPORT_LINE_TYPE_MAP = {
    hang_tra: 'HÃƒÂ ng trÃ¡ÂºÂ£',
    hang_doi: 'HÃƒÂ ng Ã„â€˜Ã¡Â»â€¢i'
};

const RETURN_EXPORT_COLUMNS = [
    { header: 'MÃƒÂ£ phiÃ¡ÂºÂ¿u trÃ¡ÂºÂ£', key: 'ma_phieu_tra' },
    { header: 'ThÃ¡Â»Âi gian trÃ¡ÂºÂ£', key: 'thoi_gian_tra' },
    { header: 'MÃƒÂ£ hÃƒÂ³a Ã„â€˜Ã†Â¡n', key: 'ma_hoa_don' },
    { header: 'MÃƒÂ£ Ã„â€˜Ã†Â¡n hÃƒÂ ng', key: 'ma_don_hang' },
    { header: 'KhÃƒÂ¡ch hÃƒÂ ng', key: 'khach_hang' },
    { header: 'Ã„ÂiÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i', key: 'dien_thoai' },
    { header: 'Ã„ÂÃ¡Â»â€¹a chÃ¡Â»â€°', key: 'dia_chi' },
    { header: 'Kho', key: 'kho' },
    { header: 'NgÃ†Â°Ã¡Â»Âi tÃ¡ÂºÂ¡o', key: 'nguoi_tao' },
    { header: 'TÃ¡Â»â€¢ng tiÃ¡Â»Ân hÃƒÂ ng trÃ¡ÂºÂ£', key: 'tong_tien_hang_tra', style: { numFmt: '#,##0' } },
    { header: 'TÃ¡Â»â€¢ng tiÃ¡Â»Ân hÃƒÂ ng Ã„â€˜Ã¡Â»â€¢i', key: 'tong_tien_hang_doi', style: { numFmt: '#,##0' } },
    { header: 'ChÃƒÂªnh lÃ¡Â»â€¡ch', key: 'chenh_lech', style: { numFmt: '#,##0' } },
    { header: 'GiÃ¡ÂºÂ£m giÃƒÂ¡', key: 'giam_gia', style: { numFmt: '#,##0' } },
    { header: 'PhÃƒÂ­ trÃ¡ÂºÂ£ hÃƒÂ ng', key: 'phi_tra_hang', style: { numFmt: '#,##0' } },
    { header: 'CÃ¡ÂºÂ§n trÃ¡ÂºÂ£ khÃƒÂ¡ch', key: 'can_tra_khach', style: { numFmt: '#,##0' } },
    { header: 'KhÃƒÂ¡ch cÃ¡ÂºÂ§n trÃ¡ÂºÂ£ thÃƒÂªm', key: 'khach_can_tra_them', style: { numFmt: '#,##0' } },
    { header: 'LÃƒÂ½ do', key: 'ly_do' },
    { header: 'Ghi chÃƒÂº', key: 'ghi_chu' },
    { header: 'TrÃ¡ÂºÂ¡ng thÃƒÂ¡i', key: 'trang_thai' },
    { header: 'LoÃ¡ÂºÂ¡i dÃƒÂ²ng', key: 'loai_dong' },
    { header: 'MÃƒÂ£ hÃƒÂ ng', key: 'ma_hang' },
    { header: 'TÃƒÂªn hÃƒÂ ng', key: 'ten_hang' },
    { header: 'ThÃ†Â°Ã†Â¡ng hiÃ¡Â»â€¡u', key: 'thuong_hieu' },
    { header: 'NhÃƒÂ³m hÃƒÂ ng', key: 'nhom_hang' },
    { header: 'Ã„ÂÃ†Â¡n vÃ¡Â»â€¹ tÃƒÂ­nh', key: 'don_vi_tinh' },
    { header: 'LÃƒÂ´ hÃƒÂ ng', key: 'lo_hang' },
    { header: 'SÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng', key: 'so_luong', style: { numFmt: '#,##0.##' } },
    { header: 'Ã„ÂÃ†Â¡n giÃƒÂ¡', key: 'don_gia', style: { numFmt: '#,##0' } },
    { header: 'ThÃƒÂ nh tiÃ¡Â»Ân', key: 'thanh_tien', style: { numFmt: '#,##0' } }
];

const DELIVERY_PARTNER_STATUS_MAP = {
    active: 'Ã„Âang hoÃ¡ÂºÂ¡t Ã„â€˜Ã¡Â»â„¢ng',
    inactive: 'NgÃ¡Â»Â«ng hoÃ¡ÂºÂ¡t Ã„â€˜Ã¡Â»â„¢ng'
};

const SHIPPING_PRICE_TYPE_MAP = {
    theo_km: 'Theo km',
    co_dinh: 'CÃ¡Â»â€˜ Ã„â€˜Ã¡Â»â€¹nh',
    theo_tuyen: 'Theo tuyÃ¡ÂºÂ¿n'
};

const DELIVERY_PARTNER_EXPORT_COLUMNS = [
    { header: 'MÃƒÂ£ Ã„â€˜Ã¡Â»â€˜i tÃƒÂ¡c', key: 'ma_doi_tac' },
    { header: 'TÃƒÂªn Ã„â€˜Ã¡Â»â€˜i tÃƒÂ¡c', key: 'ten_doi_tac' },
    { header: 'Ã„ÂiÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i', key: 'dien_thoai' },
    { header: 'Email', key: 'email' },
    { header: 'Ã„ÂÃ¡Â»â€¹a chÃ¡Â»â€°', key: 'dia_chi' },
    { header: 'Ghi chÃƒÂº', key: 'ghi_chu' },
    { header: 'TrÃ¡ÂºÂ¡ng thÃƒÂ¡i', key: 'trang_thai' },
    { header: 'NgÃƒÂ y tÃ¡ÂºÂ¡o', key: 'ngay_tao' },
    { header: 'NgÃƒÂ y cÃ¡ÂºÂ­p nhÃ¡ÂºÂ­t', key: 'ngay_cap_nhat' },
    { header: 'TÃƒÂªn bÃ¡ÂºÂ£ng giÃƒÂ¡', key: 'ten_bang_gia' },
    { header: 'LoÃ¡ÂºÂ¡i tÃƒÂ­nh phÃƒÂ­', key: 'loai_tinh_phi' },
    { header: 'Ã„ÂiÃ¡Â»Æ’m Ã„â€˜i', key: 'diem_di' },
    { header: 'Ã„ÂiÃ¡Â»Æ’m Ã„â€˜Ã¡ÂºÂ¿n', key: 'diem_den' },
    { header: 'KhoÃ¡ÂºÂ£ng cÃƒÂ¡ch km', key: 'khoang_cach_km', style: { numFmt: '#,##0.##' } },
    { header: 'Ã„ÂÃ†Â¡n giÃƒÂ¡/km', key: 'don_gia_km', style: { numFmt: '#,##0' } },
    { header: 'PhÃƒÂ­ cÃ¡Â»â€˜ Ã„â€˜Ã¡Â»â€¹nh', key: 'phi_co_dinh', style: { numFmt: '#,##0' } },
    { header: 'PhÃƒÂ­ tÃ¡Â»â€˜i thiÃ¡Â»Æ’u', key: 'phi_toi_thieu', style: { numFmt: '#,##0' } },
    { header: 'TrÃ¡ÂºÂ¡ng thÃƒÂ¡i bÃ¡ÂºÂ£ng giÃƒÂ¡', key: 'trang_thai_bang_gia' }
];

const SHIPMENT_COD_STATUS_MAP = {
    khong_cod: 'KhÃƒÂ´ng COD',
    chua_thu: 'ChÃ†Â°a thu',
    da_thu: 'Ã„ÂÃƒÂ£ thu',
    da_doi_soat: 'Ã„ÂÃƒÂ£ Ã„â€˜Ã¡Â»â€˜i soÃƒÂ¡t'
};

const SHIPPING_FEE_PAYER_MAP = {
    khach: 'KhÃƒÂ¡ch hÃƒÂ ng',
    cua_hang: 'CÃ¡Â»Â­a hÃƒÂ ng'
};

const SHIPMENT_EXPORT_COLUMNS = [
    { header: 'MÃƒÂ£ vÃ¡ÂºÂ­n Ã„â€˜Ã†Â¡n', key: 'ma_van_don' },
    { header: 'MÃƒÂ£ Ã„â€˜Ã†Â¡n hÃƒÂ ng', key: 'ma_don_hang' },
    { header: 'MÃƒÂ£ hÃƒÂ³a Ã„â€˜Ã†Â¡n', key: 'ma_hoa_don' },
    { header: 'KhÃƒÂ¡ch hÃƒÂ ng', key: 'khach_hang' },
    { header: 'NgÃ†Â°Ã¡Â»Âi nhÃ¡ÂºÂ­n', key: 'nguoi_nhan' },
    { header: 'Ã„ÂiÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i ngÃ†Â°Ã¡Â»Âi nhÃ¡ÂºÂ­n', key: 'dien_thoai_nguoi_nhan' },
    { header: 'Ã„ÂÃ¡Â»â€¹a chÃ¡Â»â€° nhÃ¡ÂºÂ­n', key: 'dia_chi_nhan' },
    { header: 'Ã„ÂÃ¡Â»â€˜i tÃƒÂ¡c giao hÃƒÂ ng', key: 'doi_tac_giao_hang' },
    { header: 'PhÃƒÂ­ giao hÃƒÂ ng', key: 'phi_giao_hang', style: { numFmt: '#,##0' } },
    { header: 'Ã„ÂÃ†Â¡n giÃƒÂ¡ vÃ¡ÂºÂ­n chuyÃ¡Â»Æ’n ÃƒÂ¡p dÃ¡Â»Â¥ng', key: 'don_gia_van_chuyen_ap_dung', style: { numFmt: '#,##0' } },
    { header: 'SÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng tÃƒÂ­nh phÃƒÂ­', key: 'so_luong_tinh_phi', style: { numFmt: '#,##0.##' } },
    { header: 'ThÃƒÂ nh tiÃ¡Â»Ân vÃ¡ÂºÂ­n chuyÃ¡Â»Æ’n', key: 'thanh_tien_van_chuyen', style: { numFmt: '#,##0' } },
    { header: 'NgÃ†Â°Ã¡Â»Âi trÃ¡ÂºÂ£ phÃƒÂ­ giao hÃƒÂ ng', key: 'nguoi_tra_phi_giao_hang' },
    { header: 'COD', key: 'cod' },
    { header: 'SÃ¡Â»â€˜ tiÃ¡Â»Ân COD', key: 'so_tien_cod', style: { numFmt: '#,##0' } },
    { header: 'TrÃ¡ÂºÂ¡ng thÃƒÂ¡i COD', key: 'trang_thai_cod' },
    { header: 'TrÃ¡ÂºÂ¡ng thÃƒÂ¡i vÃ¡ÂºÂ­n Ã„â€˜Ã†Â¡n', key: 'trang_thai_van_don' },
    { header: 'Ghi chÃƒÂº', key: 'ghi_chu' },
    { header: 'NgÃƒÂ y tÃ¡ÂºÂ¡o', key: 'ngay_tao' },
    { header: 'NgÃƒÂ y cÃ¡ÂºÂ­p nhÃ¡ÂºÂ­t', key: 'ngay_cap_nhat' }
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
        ten_quy_cach: String(row.ten_quy_cach || '').trim(),
        ten_thuoc_tinh: String(row.ten_thuoc_tinh || '').trim(),
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
    return filter;
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

function exportUserName(user) {
    return user ? (user.ho_ten || user.username || user.email || '') : '';
}

function exportCustomerName(customer) {
    return customer ? (customer.ten_khach_hang || customer.ten_ca_nhan || customer.ten_cong_ty || customer.ma_khach_hang || '') : 'KhÃƒÂ¡ch lÃ¡ÂºÂ»';
}

function exportCustomerPhone(customer, shipment) {
    return shipment?.sdt_nguoi_nhan || customer?.sdt || customer?.sdt2 || '';
}

function exportAddress(customer, shipment) {
    return shipment?.dia_chi_nhan || customer?.dia_chi_day_du || customer?.khu_vuc_giao_hang || '';
}

function exportLotName(lot) {
    return lot ? (lot.ma_lo || lot.ten_lo || '') : '';
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
        cod_enabled: codOn ? 'CÃƒÂ³' : 'KhÃƒÂ´ng',
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
    const worksheet = workbook.addWorksheet('Ã„ÂÃ¡ÂºÂ·t hÃƒÂ ng');
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
        cod: invoice.phuong_thuc_tt === 'COD' || order.cod_enabled || shipment?.cod_enabled ? 'CÃƒÂ³' : 'KhÃƒÂ´ng',
        trang_thai_hoa_don: INVOICE_EXPORT_STATUS_MAP[normalizeInvoiceStatus(invoice.trang_thai)] || INVOICE_EXPORT_STATUS_MAP[invoice.trang_thai] || invoice.trang_thai || '',
        ghi_chu: invoice.ghi_chu || '',
        ma_hang: product.ma_hang || '',
        ten_hang: product.ten_hang || '',
        thuong_hieu: product.thuong_hieu_id ? product.thuong_hieu_id.ten_thuong_hieu || '' : '',
        nhom_hang: product.nhom_hang_id ? product.nhom_hang_id.ten_nhom_hang || '' : '',
        don_vi_tinh: product.don_vi_tinh_id ? product.don_vi_tinh_id.ten_don_vi || product.don_vi_tinh_id.ma_don_vi || '' : '',
        lo_hang: exportLotName(detail?.lo_hang_id),
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
            ? PhieuThuChi.find({
                loai_phieu: 'thu',
                trang_thai: { $ne: 'cancelled' },
                $or: [
                    { hoa_don_id: { $in: invoiceIds } },
                    { don_hang_id: { $in: orderIds } }
                ]
            }).lean()
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
    const paidMap = receipts.reduce((map, row) => {
        const key = row.hoa_don_id
            ? String(row.hoa_don_id)
            : orderToInvoiceId[String(row.don_hang_id || '')];
        if (!key) return map;
        map[key] = (map[key] || 0) + Number(row.gia_tri || 0);
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
    const worksheet = workbook.addWorksheet('HÃƒÂ³a Ã„â€˜Ã†Â¡n bÃƒÂ¡n hÃƒÂ ng');
    worksheet.columns = INVOICE_EXPORT_COLUMNS;

    invoices.forEach(invoice => {
        const details = detailMap[String(invoice._id)] || [];
        const shipment = shipmentMap[String(invoice._id)] || null;
        const paid = paidMap[String(invoice._id)] || 0;
        const payable = Number(invoice.thanh_toan || invoice.tong_tien || 0);
        const debt = debtMap[String(invoice._id)] != null ? debtMap[String(invoice._id)] : Math.max(0, payable - paid);
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
    const worksheet = workbook.addWorksheet('TrÃ¡ÂºÂ£ hÃƒÂ ng bÃƒÂ¡n');
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
    const worksheet = workbook.addWorksheet('Ã„ÂÃ¡Â»â€˜i tÃƒÂ¡c giao hÃƒÂ ng');
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
        doi_tac_giao_hang: shipment.doi_tac_giao_hang_id ? (shipment.doi_tac_giao_hang_id.ten_doi_tac || '') : 'TÃ¡Â»Â± giao hÃƒÂ ng',
        phi_giao_hang: Number(shipment.phi_giao_hang || 0),
        don_gia_van_chuyen_ap_dung: Number(shipment.don_gia_van_chuyen_ap_dung || 0),
        so_luong_tinh_phi: Number(shipment.so_luong_tinh_phi || 0),
        thanh_tien_van_chuyen: Number(shipment.thanh_tien_van_chuyen || shipment.phi_giao_hang || 0),
        nguoi_tra_phi_giao_hang: SHIPPING_FEE_PAYER_MAP[shipment.nguoi_tra_phi_giao_hang] || shipment.nguoi_tra_phi_giao_hang || '',
        cod: shipment.cod_enabled ? 'CÃƒÂ³' : 'KhÃƒÂ´ng',
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
    const worksheet = workbook.addWorksheet('VÃ¡ÂºÂ­n Ã„â€˜Ã†Â¡n');
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

async function resolveSalePrice(product, priceBookId) {
    if (priceBookId && /^[0-9a-fA-F]{24}$/.test(String(priceBookId))) {
        const row = await CTBangGia.findOne({ bang_gia_id: priceBookId, hang_hoa_id: product._id }).lean();
        if (row && Number(row.gia_ban || 0) > 0) return Number(row.gia_ban || 0);
    }
    return Number(product.gia_co_dinh || 0) || 0;
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

async function validateOrderAvailability({ khoId, normalizedItems }) {
    const reserved = await getReservedQuantitiesByOrder({
        kho_id: khoId,
        hang_hoa_ids: normalizedItems.map(item => item.hang_hoa_id)
    });
    const warnings = [];

    for (const item of normalizedItems) {
        const tenQuyCach = String(item.ten_quy_cach || item.ten_thuoc_tinh || '').trim();
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
        const soLuongKhachDat = reservedKey
            ? Number((reserved.byVariant[reservedKey] || reserved.byVariant[fallbackReservedKey])?.so_luong_khach_dat || 0)
            : Number(reserved.byProduct[String(item.hang_hoa_id)]?.so_luong_khach_dat || 0);
        const tonThucTe = await getOrderLineActualStock(khoId, item);
        const khaDung = tonThucTe - soLuongKhachDat;
        const soLuongDat = Number(item.so_luong || 0);
        const label = [
            item.ma_hang_snapshot || item.product?.ma_hang,
            item.ten_hang_snapshot || item.product?.ten_hang,
            tenQuyCach
        ].filter(Boolean).join(' - ');

        if (tenQuyCach && !item.gia_tri_thuoc_tinh_id && !item.ten_quy_cach) {
            warnings.push(`DÃƒÂ²ng hÃƒÂ ng quy cÃƒÂ¡ch ${label} thiÃ¡ÂºÂ¿u gia_tri_thuoc_tinh_id vÃƒÂ  ten_quy_cach, chÃ¡Â»â€° cÃƒÂ³ thÃ¡Â»Æ’ Ã„â€˜Ã¡Â»â€˜i chiÃ¡ÂºÂ¿u tÃ¡Â»â€œn theo dÃ¡Â»Â¯ liÃ¡Â»â€¡u cÃƒÂ²n lÃ¡ÂºÂ¡i.`);
        }
        if (soLuongDat > tonThucTe) {
            const message = `SÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng Ã„â€˜Ã¡ÂºÂ·t vÃ†Â°Ã¡Â»Â£t tÃ¡Â»â€œn thÃ¡Â»Â±c tÃ¡ÂºÂ¿. Khi giao cÃƒÂ³ thÃ¡Â»Æ’ thiÃ¡ÂºÂ¿u hÃƒÂ ng. DÃƒÂ²ng [${label}] tÃ¡Â»â€œn ${tonThucTe}, khÃƒÂ¡ch Ã„â€˜Ã¡ÂºÂ·t ${soLuongDat}.`;
            if (!CHO_PHEP_DAT_AM_KHO) return { valid: false, message };
            warnings.push(message);
            continue;
        }
        if (soLuongDat > khaDung) {
            const message = `SÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng Ã„â€˜Ã¡ÂºÂ·t cÃ¡Â»Â§a [${label}] vÃ†Â°Ã¡Â»Â£t khÃ¡ÂºÂ£ dÃ¡Â»Â¥ng. KhÃ¡ÂºÂ£ dÃ¡Â»Â¥ng cÃƒÂ²n ${khaDung}, khÃƒÂ¡ch Ã„â€˜Ã¡ÂºÂ·t ${soLuongDat}.`;
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

function normalizeInvoiceStatus(value) {
    const status = String(value || '').trim();
    if (['paid', 'partial', 'unpaid'].includes(status)) return status;
    if (['processing', 'completed', 'failed', 'cancelled'].includes(status)) return status;
    if (status === 'draft' || status === 'shipping') return 'processing';
    if (status === 'done' || status === 'paid') return 'completed';
    return 'processing';
}

function normalizePaymentMethodValue(value) {
    const method = String(value || '').trim();
    if (['tien_mat', 'chuyen_khoan', 'vi_dien_tu', 'khac'].includes(method)) return method;
    if (/chuyÃ¡Â»Æ’n|chuyen|bank/i.test(method)) return 'chuyen_khoan';
    if (/vÃƒÂ­|vi/i.test(method)) return 'vi_dien_tu';
    if (/cod/i.test(method)) return 'khac';
    return 'tien_mat';
}

function isEnabled(value) {
    return value === true || value === 'true' || value === 'on' || value === '1';
}

async function getOrderPaidAmount(orderId, extraFilter = {}) {
    if (!orderId) return 0;
    const receipts = await PhieuThuChi.find({
        don_hang_id: orderId,
        loai_phieu: 'thu',
        trang_thai: { $ne: 'cancelled' },
        ...extraFilter
    }).select('gia_tri').lean();
    return receipts.reduce((sum, row) => sum + Number(row.gia_tri || 0), 0);
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
        const orderIndex = indexes.find(index => index.name === 'don_hang_id_1');

        if (orderIndex && orderIndex.unique && !orderIndex.sparse) {
            await collection.dropIndex('don_hang_id_1');
            await collection.updateMany(
                { don_hang_id: null },
                { $unset: { don_hang_id: '' } }
            );
        }

        await collection.createIndex(
            { don_hang_id: 1 },
            { unique: true, sparse: true, name: 'don_hang_id_1' }
        );
    } catch (error) {
        console.error('[InvoiceIndex] Cannot ensure sparse don_hang_id index:', error.message);
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

async function buildInvoiceFilter(query = {}) {
    const filter = {};
    if (query.q && query.q.trim() !== '') {
        filter.ma_hoa_don = { $regex: query.q.trim(), $options: 'i' };
    }
    const statuses = cleanArray(query.trang_thai);
    if (statuses.length) filter.trang_thai = { $in: statuses };

    const saleRange = dateRange(query, 'date_from', 'date_to', query.time_type === 'this_month');
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

    return filter;
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
            loai_phieu: 'thu',
            trang_thai: { $ne: 'cancelled' },
            $or: [
                { hoa_don_id: { $in: invoiceIds } },
                { don_hang_id: { $in: orderIds } }
            ]
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
    const paidByInvoice = receipts.reduce((map, row) => {
        const key = row.hoa_don_id
            ? String(row.hoa_don_id)
            : orderToInvoiceId[String(row.don_hang_id || '')];
        if (!key) return map;
        map[key] = (map[key] || 0) + Number(row.gia_tri || 0);
        return map;
    }, {});
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
        const error = new Error('Vui lÃƒÂ²ng chÃ¡Â»Ân ÃƒÂ­t nhÃ¡ÂºÂ¥t 2 Ã„â€˜Ã†Â¡n Ã„â€˜Ã¡Â»Æ’ gÃ¡Â»â„¢p.');
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
        const error = new Error('MÃ¡Â»â„¢t hoÃ¡ÂºÂ·c nhiÃ¡Â»Âu Ã„â€˜Ã†Â¡n hÃƒÂ ng khÃƒÂ´ng tÃ¡Â»â€œn tÃ¡ÂºÂ¡i.');
        error.status = 400;
        throw error;
    }
    const orderById = new Map(orders.map(order => [String(order._id), order]));
    const receivingOrder = orderById.get(receivingOrderId);
    const sourceOrders = sourceOrderIds.map(id => orderById.get(id));

    const storeIds = new Set(orders.map(order => String(order.cua_hang_id || '')).filter(Boolean));
    if (storeIds.size !== 1) {
        const error = new Error('KhÃƒÂ´ng thÃ¡Â»Æ’ gÃ¡Â»â„¢p cÃƒÂ¡c Ã„â€˜Ã†Â¡n khÃƒÂ¡c cÃ¡Â»Â­a hÃƒÂ ng.');
        error.status = 400;
        throw error;
    }

    const warehouseIds = new Set(orders.map(order => String(order.kho_id || '')).filter(Boolean));
    if (warehouseIds.size > 1) {
        const error = new Error('KhÃƒÂ´ng thÃ¡Â»Æ’ gÃ¡Â»â„¢p cÃƒÂ¡c Ã„â€˜Ã†Â¡n khÃƒÂ¡c kho trong phase nÃƒÂ y.');
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
        const error = new Error('KhÃƒÂ´ng thÃ¡Â»Æ’ gÃ¡Â»â„¢p cÃƒÂ¡c Ã„â€˜Ã†Â¡n khÃƒÂ¡c khÃƒÂ¡ch hÃƒÂ ng hoÃ¡ÂºÂ·c khÃƒÂ¡c sÃ¡Â»â€˜ Ã„â€˜iÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i.');
        error.status = 400;
        throw error;
    }

    const invoices = await HoaDonBanHang.find({
        don_hang_id: { $in: orderIds },
        trang_thai: { $ne: 'cancelled' }
    }).session(session);
    if (invoices.length) {
        const invoiceOrder = orderById.get(String(invoices[0].don_hang_id));
        const error = new Error(`KhÃƒÂ´ng thÃ¡Â»Æ’ gÃ¡Â»â„¢p Ã„â€˜Ã†Â¡n ${invoiceOrder?.ma_don_hang || ''} vÃƒÂ¬ Ã„â€˜ÃƒÂ£ tÃ¡ÂºÂ¡o hÃƒÂ³a Ã„â€˜Ã†Â¡n.`);
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
                ? `Ã„ÂÃ†Â¡n ${order.ma_don_hang} Ã„â€˜ÃƒÂ£ Ã„â€˜Ã†Â°Ã¡Â»Â£c gÃ¡Â»â„¢p vÃƒÂ o ${order.merged_to_ma_don_hang || 'Ã„â€˜Ã†Â¡n khÃƒÂ¡c'}.`
                : `KhÃƒÂ´ng thÃ¡Â»Æ’ gÃ¡Â»â„¢p Ã„â€˜Ã†Â¡n ${order.ma_don_hang} Ã¡Â»Å¸ trÃ¡ÂºÂ¡ng thÃƒÂ¡i hiÃ¡Â»â€¡n tÃ¡ÂºÂ¡i.`;
            const error = new Error(message);
            error.status = 400;
            throw error;
        }
        if (order.trang_thai_giao_hang !== 'chua_giao') {
            const error = new Error(`ChÃ¡Â»â€° cÃƒÂ³ thÃ¡Â»Æ’ gÃ¡Â»â„¢p cÃƒÂ¡c Ã„â€˜Ã†Â¡n chÃ†Â°a giao. Ã„ÂÃ†Â¡n ${order.ma_don_hang} Ã„â€˜ÃƒÂ£ phÃƒÂ¡t sinh giao hÃƒÂ ng.`);
            error.status = 400;
            throw error;
        }
        const deliveredDetail = (detailMap[String(order._id)] || []).find(detail => Number(detail.so_luong_da_giao || 0) > 0);
        if (deliveredDetail) {
            const error = new Error(`ChÃ¡Â»â€° cÃƒÂ³ thÃ¡Â»Æ’ gÃ¡Â»â„¢p cÃƒÂ¡c Ã„â€˜Ã†Â¡n chÃ†Â°a giao. Ã„ÂÃ†Â¡n ${order.ma_don_hang} Ã„â€˜ÃƒÂ£ phÃƒÂ¡t sinh giao hÃƒÂ ng.`);
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
                ghi_chu: `VÃ¡ÂºÂ­n Ã„â€˜Ã†Â¡n bÃ¡Â»â€¹ ngÃ†Â°ng do Ã„â€˜Ã†Â¡n hÃƒÂ ng Ã„â€˜ÃƒÂ£ gÃ¡Â»â„¢p vÃƒÂ o ${receivingOrder.ma_don_hang}`
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
            message: 'GÃ¡Â»â„¢p Ã„â€˜Ã†Â¡n thÃƒÂ nh cÃƒÂ´ng',
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

        const [partners, users] = await Promise.all([
            DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ ten_doi_tac: 1 }),
            NguoiDung.find().sort({ ho_ten: 1, username: 1 })
        ]);
        res.render('don-hang/index', {
            title: 'Đặt hàng',
            orders,
            partners,
            users,
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
            return res.status(400).json({ success: false, message: 'Vui lÃƒÂ²ng chÃ¡Â»Ân ÃƒÂ­t nhÃ¡ÂºÂ¥t 1 cÃ¡Â»â„¢t Ã„â€˜Ã¡Â»Æ’ xuÃ¡ÂºÂ¥t.' });
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
        if (!orders.length) return res.status(404).send('KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y Ã„â€˜Ã†Â¡n hÃƒÂ ng');
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
            SoQuy.find(cashBookQuery).sort({ ten_so_quy: 1, loai: 1 }).lean()
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
                copyFromError = 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y Ã„â€˜Ã†Â¡n hÃƒÂ ng Ã„â€˜Ã¡Â»Æ’ sao chÃƒÂ©p.';
            } else if (sourceOrder.trang_thai === 'merged') {
                copyFromError = `Đơn hàng ${sourceOrder.ma_don_hang} đã được gộp vào ${sourceOrder.merged_to_ma_don_hang || 'đơn khác'}, không thể sao chép riêng.`;
                sourceOrder = null;
                sourceOrderItems = [];
                sourceShipment = null;
            } else {
                sourceOrderItems = await CTDonHang.find({ don_hang_id: sourceOrder._id }).populate('hang_hoa_id').lean();
                if (!sourceOrderItems.length) {
                    copyFromError = 'Ã„ÂÃ†Â¡n hÃƒÂ ng chÃ†Â°a cÃƒÂ³ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m Ã„â€˜Ã¡Â»Æ’ sao chÃƒÂ©p.';
                }
                sourceShipment = await VanDon.findOne({ don_hang_id: sourceOrder._id }).lean();
            }
        }
        res.render('don-hang/create', {
            title: 'Ã„ÂÃ¡ÂºÂ·t hÃƒÂ ng',
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
            khach_thanh_toan,
            phuong_thuc_thanh_toan,
            so_quy_id
        } = req.body || {};

        const orderItems = parseItems(items);
        if (!Array.isArray(orderItems) || !orderItems.length) {
            return res.status(400).json({ success: false, message: 'Ã„ÂÃ†Â¡n hÃƒÂ ng chÃ†Â°a cÃƒÂ³ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m' });
        }
        if (!kho_id) {
            return res.status(400).json({ success: false, message: 'Vui lÃƒÂ²ng chÃ¡Â»Ân kho.' });
        }
        const sessionStoreId = await resolveStoreId(req);
        if (!sessionStoreId) {
            return res.status(400).json({ success: false, message: 'ChÃ†Â°a chÃ¡Â»Ân cÃ¡Â»Â­a hÃƒÂ ng lÃƒÂ m viÃ¡Â»â€¡c. Vui lÃƒÂ²ng chÃ¡Â»Ân cÃ¡Â»Â­a hÃƒÂ ng Ã¡Â»Å¸ menu trÃƒÂªn.' });
        }
        if (!khach_hang_id) {
            return res.status(400).json({ success: false, message: 'Vui lÃƒÂ²ng chÃ¡Â»Ân khÃƒÂ¡ch hÃƒÂ ng.' });
        }
        if (!dia_chi_khach_hang_id) {
            return res.status(400).json({ success: false, message: 'Vui lÃƒÂ²ng chÃ¡Â»Ân Ã„â€˜Ã¡Â»â€¹a chÃ¡Â»â€° nhÃ¡ÂºÂ­n hÃƒÂ ng.' });
        }
        if (!doi_tac_giao_hang_id) {
            return res.status(400).json({ success: false, message: 'Vui lÃƒÂ²ng chÃ¡Â»Ân Ã„â€˜Ã¡Â»â€˜i tÃƒÂ¡c giao hÃƒÂ ng.' });
        }
        const kho = await Kho.findById(kho_id).lean();
        if (!kho) {
            return res.status(400).json({ success: false, message: 'Kho khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡.' });
        }
        if (String(kho.cua_hang_id || '') !== sessionStoreId) {
            return res.status(400).json({ success: false, message: 'Kho khÃƒÂ´ng thuÃ¡Â»â„¢c cÃ¡Â»Â­a hÃƒÂ ng Ã„â€˜ang lÃƒÂ m viÃ¡Â»â€¡c.' });
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
                        gia_tri_thuoc_tinh_id: qc.gia_tri_thuoc_tinh_id || sourceItem.gia_tri_thuoc_tinh_id || null,
                        ten_quy_cach: qc.ten_quy_cach || qc.ten_thuoc_tinh || '',
                        ten_thuoc_tinh: qc.ten_thuoc_tinh || qc.ten_quy_cach || '',
                        don_gia_ban: qc.don_gia_ban ?? sourceItem.don_gia_ban,
                        don_gia: qc.don_gia_ban ?? sourceItem.don_gia_ban ?? sourceItem.don_gia,
                        chiet_khau: qc.chiet_khau ?? 0,
                        kieu_chiet_khau: qc.kieu_chiet_khau || 'vnd'
                    }))
                : [sourceItem];
            for (const item of expandedItems) {
            const productId = String(item.hang_hoa_id || '').trim();
            const quantity = Number(item.so_luong_dat ?? item.so_luong) || 0;
            if (!productId || quantity <= 0) {
                return res.status(400).json({ success: false, message: 'DÃƒÂ²ng hÃƒÂ ng khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡.' });
            }
            const product = await HangHoa.findById(productId).lean();
            if (!product) {
                return res.status(400).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y hÃƒÂ ng hÃƒÂ³a.' });
            }
            const manualUnitPrice = Number(item.don_gia_ban ?? item.don_gia);
            if (Number.isFinite(manualUnitPrice) && manualUnitPrice < 0) {
                return res.status(400).json({ success: false, message: 'Ã„ÂÃ†Â¡n giÃƒÂ¡ khÃƒÂ´ng Ã„â€˜Ã†Â°Ã¡Â»Â£c ÃƒÂ¢m.' });
            }
            const unitPrice = Number.isFinite(manualUnitPrice) && manualUnitPrice >= 0
                ? manualUnitPrice
                : await resolveSalePrice(product, validBangGiaId);
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
            return res.status(400).json({ success: false, message: 'Ã„ÂÃ†Â¡n hÃƒÂ ng chÃ†Â°a cÃƒÂ³ dÃƒÂ²ng hÃƒÂ ng hÃ¡Â»Â£p lÃ¡Â»â€¡.' });
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
            return res.status(400).json({ success: false, message: 'PhÃƒÂ­ giao hÃƒÂ ng khÃƒÂ´ng Ã„â€˜Ã†Â°Ã¡Â»Â£c ÃƒÂ¢m.' });
        }
        const shippingFee = Number.isFinite(manualShippingFee) && manualShippingFee >= 0
            ? manualShippingFee
            : Number(calculatedShippingFee.phi_giao_hang || 0);
        if (shippingFee < 0) {
            return res.status(400).json({ success: false, message: 'PhÃƒÂ­ giao hÃƒÂ ng khÃƒÂ´ng Ã„â€˜Ã†Â°Ã¡Â»Â£c ÃƒÂ¢m.' });
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
        const khachCanTra = tong_thanh_toan;
        const requestedPrepaid = Number(khach_thanh_toan ?? req.body?.khach_da_tra ?? 0);
        const khachThanhToan = Math.min(Math.max(Number.isFinite(requestedPrepaid) ? requestedPrepaid : 0, 0), khachCanTra);
        const codAmount = 0;
        const tienThuaTraKhach = 0;
        const ma_don_hang = await generateOrderCode();
        let receiptCashBook = null;
        if (khachThanhToan > 0) {
            const requestedCashBookId = /^[0-9a-fA-F]{24}$/.test(String(so_quy_id || '')) ? so_quy_id : null;
            receiptCashBook = requestedCashBookId ? await SoQuy.findById(requestedCashBookId).lean() : await ensureDefaultSoQuy(sessionStoreId);
            if (!receiptCashBook) {
                return res.status(400).json({ success: false, message: 'SÃ¡Â»â€¢ quÃ¡Â»Â¹ khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡.' });
            }
            if (receiptCashBook.cua_hang_id && String(receiptCashBook.cua_hang_id) !== sessionStoreId) {
                return res.status(400).json({ success: false, message: 'SÃ¡Â»â€¢ quÃ¡Â»Â¹ khÃƒÂ´ng thuÃ¡Â»â„¢c cÃ¡Â»Â­a hÃƒÂ ng Ã„â€˜ang lÃƒÂ m viÃ¡Â»â€¡c.' });
            }
        }

        const order = await DonHang.create({
            ma_don_hang,
            bang_gia_id: validBangGiaId,
            khach_hang_id: khach_hang_id || null,
            cua_hang_id: sessionStoreId,
            kho_id: kho_id || null,
            nguoi_tao_id: req.user?._id,
            ngay_dat: new Date(),
            ngay_tao: new Date(),
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

        if (khachThanhToan > 0) {
            await taoPhieuThuChi({
                loai_phieu: 'thu',
                loai_thu_chi: 'Thu tien don hang',
                gia_tri: khachThanhToan,
                so_quy_id: receiptCashBook._id,
                cua_hang_id: order.cua_hang_id,
                nguoi_tao_id: req.user?._id,
                khach_hang_id,
                don_hang_id: order._id,
                van_don_id: shipment._id,
                ma_chung_tu_goc: ma_don_hang,
                doi_tuong: order.khach_hang_id ? undefined : ten_nguoi_nhan,
                nhom_doi_tuong: 'khach_hang',
                phuong_thuc_thanh_toan: phuong_thuc_thanh_toan || 'tien_mat',
                hach_toan: false
            });
        }

        res.json({ success: true, message: 'Ã„ÂÃƒÂ£ tÃ¡ÂºÂ¡o Ã„â€˜Ã†Â¡n Ã„â€˜Ã¡ÂºÂ·t hÃƒÂ ng', ma_don_hang });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'KhÃƒÂ´ng tÃ¡ÂºÂ¡o Ã„â€˜Ã†Â°Ã¡Â»Â£c Ã„â€˜Ã†Â¡n hÃƒÂ ng' });
    }
});

router.get('/hoa-don', async (req, res, next) => {
    try {
        const filter = await buildInvoiceFilter(req.query);
        const rawInvoices = await HoaDonBanHang.find(filter)
            .populate('khach_hang_id')
            .populate('don_hang_id')
            .populate('kho_id')
            .populate('nguoi_ban_id')
            .sort({ created_at: -1 });
        const [invoices, partners, users, priceBooks] = await Promise.all([
            decorateInvoices(rawInvoices),
            DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ ten_doi_tac: 1 }),
            NguoiDung.find().sort({ ho_ten: 1, username: 1 }),
            BangGia.find({ trang_thai: 'active' }).sort({ ten_bang_gia: 1 })
        ]);
        res.render('don-hang/hoa-don', { title: 'HÃƒÂ³a Ã„â€˜Ã†Â¡n', invoices, partners, users, priceBooks, filters: req.query || {} });
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
        const [data, warehouses] = await Promise.all([
            getOrderCreateData(),
            storeId
                ? Kho.find({ trang_thai: 'active', cua_hang_id: storeId }).sort({ ten_kho: 1 }).lean()
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
                copyFromError = 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y hÃƒÂ³a Ã„â€˜Ã†Â¡n Ã„â€˜Ã¡Â»Æ’ sao chÃƒÂ©p.';
            } else {
                sourceInvoiceItems = await CTHoaDonBanHang.find({ hoa_don_id: sourceInvoice._id })
                    .populate('hang_hoa_id')
                    .lean();
                if (!sourceInvoiceItems.length) {
                    copyFromError = 'HÃƒÂ³a Ã„â€˜Ã†Â¡n chÃ†Â°a cÃƒÂ³ hÃƒÂ ng hÃƒÂ³a Ã„â€˜Ã¡Â»Æ’ sao chÃƒÂ©p.';
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
            title: 'HÃƒÂ³a Ã„â€˜Ã†Â¡n',
            ...data,
            currentStoreId: storeId || '',
            warehouses,
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

router.get('/hoa-don/:id/export.xlsx', async (req, res, next) => {
    try {
        if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id || ''))) {
            return res.status(404).send('KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y hÃƒÂ³a Ã„â€˜Ã†Â¡n');
        }
        const { invoices, detailMap, shipmentMap, paidMap, debtMap } = await loadInvoiceExportData({ _id: req.params.id });
        if (!invoices.length) return res.status(404).send('KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y hÃƒÂ³a Ã„â€˜Ã†Â¡n');
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
        if (!invoice) return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y hÃƒÂ³a Ã„â€˜Ã†Â¡n' });

        const [items, shipment, debtHistory, receipts] = await Promise.all([
            CTHoaDonBanHang.find({ hoa_don_id: invoice._id }).populate('hang_hoa_id'),
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

        const paid = receipts
            .filter(row => row.loai_phieu === 'thu')
            .reduce((sum, row) => sum + Number(row.gia_tri || 0), 0);
        const payable = Number(invoice.thanh_toan || 0);

        res.json({ success: true, data: { invoice, items, shipment, debtHistory, receipts, paid, debt: Math.max(0, payable - paid) } });
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
            PhieuThuChi.find({
                loai_phieu: 'thu',
                trang_thai: { $ne: 'cancelled' },
                $or: [
                    { hoa_don_id: invoice._id },
                    ...(invoice.don_hang_id ? [{ don_hang_id: invoice.don_hang_id }] : [])
                ]
            }).lean(),
            VanDon.findOne({
                $or: [
                    { hoa_don_id: invoice._id },
                    ...(invoice.don_hang_id ? [{ don_hang_id: invoice.don_hang_id }] : [])
                ]
            }).lean()
        ]);
        const payable = Number(invoice.thanh_toan || 0);
        const paidBefore = receipts.reduce((sum, row) => sum + Number(row.gia_tri || 0), 0);
        const remaining = Math.max(payable - paidBefore, 0);
        const amount = Math.max(0, Number(req.body?.gia_tri || req.body?.khach_thanh_toan || 0));
        if (amount <= 0) return res.status(400).json({ success: false, message: 'Số tiền thu không hợp lệ' });
        if (amount > remaining) {
            return res.status(400).json({
                success: false,
                message: `Khách chỉ còn nợ ${remaining.toLocaleString('vi-VN')} VNĐ`
            });
        }

        const cashBook = await ensureDefaultSoQuy(invoice.cua_hang_id);
        const receipt = await taoPhieuThuChi({
            loai_phieu: 'thu',
            loai_thu_chi: 'Thu tien hoa don',
            gia_tri: amount,
            so_quy_id: cashBook._id,
            cua_hang_id: invoice.cua_hang_id,
            nguoi_tao_id: req.user?._id,
            khach_hang_id: invoice.khach_hang_id,
            don_hang_id: invoice.don_hang_id || undefined,
            hoa_don_id: invoice._id,
            van_don_id: shipment?._id,
            ma_chung_tu_goc: invoice.ma_hoa_don,
            nhom_doi_tuong: 'khach_hang',
            phuong_thuc_thanh_toan: normalizePaymentMethodValue(req.body?.phuong_thuc_thanh_toan),
            hach_toan: false
        });

        const paidAfter = paidBefore + amount;
        invoice.trang_thai = resolveInvoiceStatus(payable, paidAfter);
        await invoice.save();
        if (invoice.don_hang_id) {
            await DonHang.updateOne(
                { _id: invoice.don_hang_id },
                { $set: { khach_thanh_toan: paidAfter } }
            );
        }
        if (invoice.khach_hang_id) {
            await CongNoKhachHang.create({
                khach_hang_id: invoice.khach_hang_id,
                don_hang_id: invoice.don_hang_id || undefined,
                hoa_don_id: invoice._id,
                phieu_thu_chi_id: receipt._id,
                so_tien: amount,
                loai: 'giam_no',
                ghi_chu: `Thu tiền hóa đơn ${invoice.ma_hoa_don}`,
                ngay: new Date()
            });
            const customer = await KhachHang.findById(invoice.khach_hang_id).select('tong_no').lean();
            if (customer && typeof customer.tong_no === 'number') {
                await KhachHang.updateOne({ _id: invoice.khach_hang_id }, { $inc: { tong_no: -amount } });
            }
        }

        res.json({
            success: true,
            message: 'Đã tạo phiếu thu',
            data: { receipt, paid: paidAfter, remaining: Math.max(payable - paidAfter, 0) }
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
        if (!invoice) return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y hÃƒÂ³a Ã„â€˜Ã†Â¡n' });
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
            return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y hÃƒÂ³a Ã„â€˜Ã†Â¡n' });
        }

        const sourceItems = await CTHoaDonBanHang.find({ hoa_don_id: sourceInvoice._id }).lean();
        if (!sourceItems.length) {
            return res.status(400).json({ success: false, message: 'HÃƒÂ³a Ã„â€˜Ã†Â¡n chÃ†Â°a cÃƒÂ³ hÃƒÂ ng hÃƒÂ³a Ã„â€˜Ã¡Â»Æ’ sao chÃƒÂ©p' });
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
            so_luong: Number(item.so_luong || 0),
            don_gia: Number(item.don_gia || 0),
            chiet_khau: Number(item.chiet_khau || 0),
            thanh_tien: Number(item.thanh_tien || 0)
        })));

        res.json({
            success: true,
            message: 'Ã„ÂÃƒÂ£ sao chÃƒÂ©p hÃƒÂ³a Ã„â€˜Ã†Â¡n',
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
        if (!invoice) return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y hÃƒÂ³a Ã„â€˜Ã†Â¡n' });
        if (normalizeInvoiceStatus(invoice.trang_thai) === 'cancelled') {
            return res.json({ success: true, message: 'HÃƒÂ³a Ã„â€˜Ã†Â¡n Ã„â€˜ÃƒÂ£ hÃ¡Â»Â§y' });
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
            const amount = Number(receipt.gia_tri || 0);
            if (receipt.so_quy_id && amount > 0) {
                await SoQuy.findByIdAndUpdate(receipt.so_quy_id, {
                    $inc: { so_du: receipt.loai_phieu === 'thu' ? -amount : amount }
                });
            }
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
                ghi_chu: `Ã„ÂÃ¡ÂºÂ£o cÃƒÂ´ng nÃ¡Â»Â£ hÃ¡Â»Â§y hÃƒÂ³a Ã„â€˜Ã†Â¡n ${invoice.ma_hoa_don}`,
                ngay: new Date()
            });
        }

        if (shipment) {
            shipment.trang_thai = 'cancelled';
            if (shipment.trang_thai_cod !== 'da_thu') shipment.trang_thai_cod = 'khong_cod';
            await shipment.save();
        }

        invoice.trang_thai = 'cancelled';
        await invoice.save();
        res.json({ success: true, message: 'Ã„ÂÃƒÂ£ hÃ¡Â»Â§y hÃƒÂ³a Ã„â€˜Ã†Â¡n' });
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
            sourceOrder = await DonHang.findById(don_hang_id).lean();
            if (!sourceOrder) return res.status(400).json({ success: false, message: 'Ã„ÂÃ†Â¡n hÃƒÂ ng gÃ¡Â»â€˜c khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡' });
            if (sourceOrder.trang_thai === 'merged') {
                return res.status(400).json({
                    success: false,
                    message: `Đơn hàng ${sourceOrder.ma_don_hang} đã được gộp vào ${sourceOrder.merged_to_ma_don_hang || 'đơn khác'}, không thể tạo hóa đơn riêng.`
                });
            }
            const existingInvoice = await HoaDonBanHang.findOne({ don_hang_id: sourceOrder._id }).lean();
            if (existingInvoice) {
                return res.status(409).json({
                    success: false,
                    message: `Ã„ÂÃ†Â¡n hÃƒÂ ng nÃƒÂ y Ã„â€˜ÃƒÂ£ cÃƒÂ³ hÃƒÂ³a Ã„â€˜Ã†Â¡n ${existingInvoice.ma_hoa_don}`,
                    data: { invoice: existingInvoice, id: existingInvoice._id, ma_hoa_don: existingInvoice.ma_hoa_don }
                });
            }
            const parsedFromBody = parseItems(items);
            const orderDetails = await CTDonHang.find({ don_hang_id }).lean();
            const hasDeliveredQuantity = orderDetails.some(row => Number(row.so_luong_da_giao || 0) > 0);
            const orderDetailById = orderDetails.reduce((map, row) => {
                map[String(row._id)] = row;
                return map;
            }, {});
            const orderDetailsByLegacyKey = orderDetails.reduce((map, row) => {
                const key = legacyReturnLineKey(row);
                if (!map[key]) map[key] = [];
                map[key].push(row);
                return map;
            }, {});
            if (Array.isArray(parsedFromBody) && parsedFromBody.length) {
                invoiceItems = parsedFromBody.map(item => {
                    const detailId = optionalLineObjectId(item.ct_don_hang_id);
                    const sourceDetail = detailId
                        ? orderDetailById[detailId]
                        : ((orderDetailsByLegacyKey[legacyReturnLineKey(item)] || []).length === 1
                            ? orderDetailsByLegacyKey[legacyReturnLineKey(item)][0]
                            : null);
                    return sourceDetail
                        ? Object.assign({}, item, {
                            ct_don_hang_id: sourceDetail._id,
                            so_luong: hasDeliveredQuantity
                                ? Number(sourceDetail.so_luong_da_giao || 0)
                                : Number(item.so_luong_dat ?? item.so_luong ?? sourceDetail.so_luong_dat ?? sourceDetail.so_luong ?? 0),
                            so_luong_dat: hasDeliveredQuantity
                                ? Number(sourceDetail.so_luong_da_giao || 0)
                                : Number(item.so_luong_dat ?? item.so_luong ?? sourceDetail.so_luong_dat ?? sourceDetail.so_luong ?? 0),
                            ...copyLineMetadata(sourceDetail)
                        })
                        : item;
                });
            } else {
                invoiceItems = orderDetails.map(row => ({
                    ct_don_hang_id: row._id,
                    hang_hoa_id: row.hang_hoa_id,
                    lo_hang_id: row.lo_hang_id,
                    so_luong: hasDeliveredQuantity
                        ? Number(row.so_luong_da_giao || 0)
                        : Number(row.so_luong_dat || row.so_luong || 0),
                    don_gia_ban: row.don_gia_ban || 0,
                    chiet_khau: row.chiet_khau || 0,
                    kieu_chiet_khau: row.kieu_chiet_khau || 'vnd',
                    ...copyLineMetadata(row)
                }));
            }
        }

        if (!Array.isArray(invoiceItems) || !invoiceItems.length) {
            return res.status(400).json({ success: false, message: 'HÃƒÂ³a Ã„â€˜Ã†Â¡n chÃ†Â°a cÃƒÂ³ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m' });
        }

        const sessionStoreId = await resolveStoreId(req);
        if (!sessionStoreId) {
            return res.status(400).json({ success: false, message: 'ChÃ†Â°a chÃ¡Â»Ân cÃ¡Â»Â­a hÃƒÂ ng lÃƒÂ m viÃ¡Â»â€¡c. Vui lÃƒÂ²ng chÃ¡Â»Ân cÃ¡Â»Â­a hÃƒÂ ng Ã¡Â»Å¸ menu trÃƒÂªn.' });
        }

        const finalKhoId = kho_id || sourceOrder?.kho_id;
        if (!finalKhoId) {
            return res.status(400).json({ success: false, message: 'Vui lÃƒÂ²ng chÃ¡Â»Ân kho.' });
        }
        const kho = await Kho.findById(finalKhoId).lean();
        if (!kho) return res.status(400).json({ success: false, message: 'Kho khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡.' });
        if (String(kho.cua_hang_id || '') !== sessionStoreId) {
            return res.status(400).json({ success: false, message: 'Kho khÃƒÂ´ng thuÃ¡Â»â„¢c cÃ¡Â»Â­a hÃƒÂ ng Ã„â€˜ang lÃƒÂ m viÃ¡Â»â€¡c.' });
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
            if (sourceOrder && quantity <= 0) continue;
            if (!productId || quantity <= 0) return res.status(400).json({ success: false, message: 'DÃƒÂ²ng hÃƒÂ ng khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡' });
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
            return res.status(400).json({ success: false, message: 'HÃƒÂ³a Ã„â€˜Ã†Â¡n chÃ†Â°a cÃƒÂ³ dÃƒÂ²ng hÃƒÂ ng giao thÃ¡Â»Â±c tÃ¡ÂºÂ¿' });
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
        const rawPaid = sourceOrder
            ? orderPaidBeforeInvoice
            : (codEnabled ? 0 : (khach_thanh_toan ?? req.body?.khach_da_tra ?? 0));
        const paid = Math.min(Math.max(Number(rawPaid) || 0, 0), payable);
        const debt = Math.max(payable - paid, 0);
        const ma_hoa_don = String(req.body?.ma_hoa_don || '').trim() || await generateInvoiceCode();
        const invoiceStatus = resolveInvoiceStatus(payable, paid);

        const invoice = await HoaDonBanHang.create({
            ma_hoa_don,
            ngay_ban: new Date(),
            tong_tien: tong_tien_hang,
            giam_gia: discount,
            thanh_toan: payable,
            phuong_thuc_tt: codEnabled ? 'COD' : (phuong_thuc_thanh_toan || 'TiÃ¡Â»Ân mÃ¡ÂºÂ·t'),
            trang_thai: invoiceStatus,
            ghi_chu,
            cua_hang_id: finalStoreId,
            kho_id: finalKhoId,
            ...(sourceOrder ? { don_hang_id: sourceOrder._id } : {}),
            khach_hang_id: finalCustomerId,
            nguoi_ban_id: req.user?._id
        });

        for (const item of normalizedItems) {
            await CTHoaDonBanHang.create({
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
                ghi_chu: `CÃƒÂ´ng nÃ¡Â»Â£ hÃƒÂ³a Ã„â€˜Ã†Â¡n ${ma_hoa_don}`,
                ngay: invoice.ngay_ban
            });
            const customer = await KhachHang.findById(finalCustomerId).select('tong_no').lean();
            if (customer && typeof customer.tong_no === 'number') {
                await KhachHang.updateOne({ _id: finalCustomerId }, { $inc: { tong_no: debt } });
            }
        }

        if (!sourceOrder && !codEnabled && paid > 0) {
            const cashBook = await ensureDefaultSoQuy(invoice.cua_hang_id);
            await taoPhieuThuChi({
                loai_phieu: 'thu',
                loai_thu_chi: 'Thu tien hoa don',
                gia_tri: paid,
                so_quy_id: cashBook._id,
                cua_hang_id: invoice.cua_hang_id,
                nguoi_tao_id: req.user?._id,
                khach_hang_id: finalCustomerId,
                don_hang_id: sourceOrder?._id || undefined,
                hoa_don_id: invoice._id,
                van_don_id: shipment?._id,
                ma_chung_tu_goc: ma_hoa_don,
                nhom_doi_tuong: 'khach_hang',
                phuong_thuc_thanh_toan: normalizePaymentMethodValue(phuong_thuc_thanh_toan),
                hach_toan: false
            });
        }

        res.json({ success: true, message: 'Ã„ÂÃƒÂ£ tÃ¡ÂºÂ¡o hÃƒÂ³a Ã„â€˜Ã†Â¡n', ma_hoa_don, id: invoice._id, data: { invoice, shipment } });
    } catch (error) {
        if (error?.code === 11000 && error?.keyPattern?.don_hang_id && req.body?.don_hang_id) {
            const existingInvoice = await HoaDonBanHang.findOne({ don_hang_id: req.body.don_hang_id }).lean();
            if (existingInvoice) {
                return res.status(409).json({
                    success: false,
                    message: `Ã„ÂÃ†Â¡n hÃƒÂ ng nÃƒÂ y Ã„â€˜ÃƒÂ£ cÃƒÂ³ hÃƒÂ³a Ã„â€˜Ã†Â¡n ${existingInvoice.ma_hoa_don}`,
                    data: { invoice: existingInvoice, id: existingInvoice._id, ma_hoa_don: existingInvoice.ma_hoa_don }
                });
            }
        }
        if (error?.code === 11000 && error?.keyPattern?.don_hang_id) {
            return res.status(409).json({
                success: false,
                message: 'DÃ¡Â»Â¯ liÃ¡Â»â€¡u cÃ…Â© Ã„â€˜ang cÃƒÂ³ hÃƒÂ³a Ã„â€˜Ã†Â¡n bÃƒÂ¡n trÃ¡Â»Â±c tiÃ¡ÂºÂ¿p vÃ¡Â»â€ºi don_hang_id = null. HÃ¡Â»â€¡ thÃ¡Â»â€˜ng Ã„â€˜ÃƒÂ£ bÃ¡Â»Â ghi null cho hÃƒÂ³a Ã„â€˜Ã†Â¡n mÃ¡Â»â€ºi; vui lÃƒÂ²ng xÃƒÂ³a field don_hang_id:null Ã¡Â»Å¸ cÃƒÂ¡c hÃƒÂ³a Ã„â€˜Ã†Â¡n cÃ…Â© hoÃ¡ÂºÂ·c rebuild index nÃ¡ÂºÂ¿u cÃ¡ÂºÂ§n.'
            });
        }
        if (error?.code === 11000 && error?.keyPattern?.ma_hoa_don) {
            return res.status(409).json({
                success: false,
                message: 'MÃƒÂ£ hÃƒÂ³a Ã„â€˜Ã†Â¡n bÃ¡Â»â€¹ trÃƒÂ¹ng. Vui lÃƒÂ²ng bÃ¡ÂºÂ¥m thanh toÃƒÂ¡n lÃ¡ÂºÂ¡i Ã„â€˜Ã¡Â»Æ’ hÃ¡Â»â€¡ thÃ¡Â»â€˜ng sinh mÃƒÂ£ mÃ¡Â»â€ºi.'
            });
        }
        res.status(500).json({ success: false, message: error.message || 'KhÃƒÂ´ng tÃ¡ÂºÂ¡o Ã„â€˜Ã†Â°Ã¡Â»Â£c hÃƒÂ³a Ã„â€˜Ã†Â¡n' });
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
        res.render('don-hang/tra-hang', { title: 'TrÃ¡ÂºÂ£ hÃƒÂ ng', returns, users, filters: req.query || {} });
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
        const [products, partners] = await Promise.all([
            HangHoa.find({ trang_thai: 'active' }).sort({ ten_hang: 1 }),
            DoiTacGiaoHang.find({}).sort({ ten_doi_tac: 1, ten: 1, created_at: -1 })
        ]);
        const invoices = [];
        let copyDraft = null;
        let copyFromError = '';
        const copyFromId = String(req.query?.copy_from || '').trim();
        if (copyFromId) {
            copyDraft = await loadSalesReturnCopyDraft(copyFromId);
            if (!copyDraft) copyFromError = 'KhÃƒÂ´ng tÃ¡ÂºÂ£i Ã„â€˜Ã†Â°Ã¡Â»Â£c phiÃ¡ÂºÂ¿u trÃ¡ÂºÂ£ hÃƒÂ ng Ã„â€˜Ã¡Â»Æ’ sao chÃƒÂ©p.';
        }
        const copyDraftJson = copyDraft ? JSON.stringify(copyDraft).replace(/</g, '\\u003c') : '';
        res.render('don-hang/tra-hang-create', {
            title: 'TrÃ¡ÂºÂ£ hÃƒÂ ng',
            invoices,
            products,
            partners,
            copyDraftJson,
            copyFromError
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
                khach_hang: i.khach_hang_id?.ten_khach_hang || 'KhÃƒÂ¡ch lÃ¡ÂºÂ»',
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
            return res.status(404).send('KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y phiÃ¡ÂºÂ¿u trÃ¡ÂºÂ£ hÃƒÂ ng');
        }
        const { returns, detailMap } = await loadReturnExportData({ _id: req.params.id });
        if (!returns.length) return res.status(404).send('KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y phiÃ¡ÂºÂ¿u trÃ¡ÂºÂ£ hÃƒÂ ng');
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
        if (!slip) return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y phiÃ¡ÂºÂ¿u trÃ¡ÂºÂ£ hÃƒÂ ng' });
        if (slip.trang_thai === 'cancelled') {
            return res.json({ success: true, message: 'PhiÃ¡ÂºÂ¿u Ã„â€˜ÃƒÂ£ hÃ¡Â»Â§y' });
        }

        const items = await CTPhieuTraHang.find({ phieu_tra_hang_id: slip._id }).lean();
        const khoId = slip.kho_id;
        const maPhieu = slip.ma_phieu_tra || String(slip._id);

        for (const item of items) {
            const qty = Number(item.so_luong || 0);
            if (!qty || !item.hang_hoa_id) continue;
            if (item.loai_dong === 'hang_doi') {
                await congTonKho({
                    kho_id: khoId,
                    hang_hoa_id: item.hang_hoa_id,
                    lo_hang_id: item.lo_hang_id || undefined,
                    so_luong: qty,
                    nguoi_tao_id: req.user?._id,
                    loai_phieu: 'tra_hang',
                    ma_phieu: maPhieu,
                    ghi_chu: `Huy doi hang ${maPhieu}`
                });
            } else {
                await truTonKho({
                    kho_id: khoId,
                    hang_hoa_id: item.hang_hoa_id,
                    lo_hang_id: item.lo_hang_id || undefined,
                    so_luong: qty,
                    nguoi_tao_id: req.user?._id,
                    loai_phieu: 'tra_hang',
                    ma_phieu: maPhieu,
                    ghi_chu: `Huy tra hang ${maPhieu}`
                });
            }
        }

        const receipts = await PhieuThuChi.find({ ma_chung_tu_goc: maPhieu, trang_thai: { $ne: 'cancelled' } });
        for (const receipt of receipts) {
            const amount = Number(receipt.gia_tri || 0);
            if (receipt.so_quy_id && amount > 0) {
                await SoQuy.findByIdAndUpdate(receipt.so_quy_id, {
                    $inc: { so_du: receipt.loai_phieu === 'thu' ? -amount : amount }
                });
            }
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
        res.json({ success: true, message: 'Ã„ÂÃƒÂ£ hÃ¡Â»Â§y phiÃ¡ÂºÂ¿u trÃ¡ÂºÂ£ hÃƒÂ ng' });
    } catch (error) {
        next(error);
    }
});

router.patch('/tra-hang/:id', async (req, res, next) => {
    try {
        const slip = await PhieuTraHang.findById(req.params.id);
        if (!slip) return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y phiÃ¡ÂºÂ¿u trÃ¡ÂºÂ£ hÃƒÂ ng' });
        if (slip.trang_thai === 'cancelled') {
            return res.status(400).json({ success: false, message: 'PhiÃ¡ÂºÂ¿u Ã„â€˜ÃƒÂ£ hÃ¡Â»Â§y, khÃƒÂ´ng thÃ¡Â»Æ’ sÃ¡Â»Â­a' });
        }
        if (req.body?.ghi_chu !== undefined) slip.ghi_chu = String(req.body.ghi_chu || '').trim();
        await slip.save();
        res.json({ success: true, message: 'Ã„ÂÃƒÂ£ lÃ†Â°u phiÃ¡ÂºÂ¿u trÃ¡ÂºÂ£ hÃƒÂ ng' });
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
        if (!returnSlip) return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y phiÃ¡ÂºÂ¿u trÃ¡ÂºÂ£ hÃƒÂ ng' });

        const items = await CTPhieuTraHang.find({ phieu_tra_hang_id: returnSlip._id }).populate('hang_hoa_id');
        const invoice = returnSlip.hoa_don_id?._id
            ? await HoaDonBanHang.findById(returnSlip.hoa_don_id._id).populate('cua_hang_id').populate('nguoi_ban_id')
            : null;

        res.json({ success: true, data: { returnSlip, items, invoice } });
    } catch (error) {
        next(error);
    }
});

router.get('/tra-hang/invoice/:id', async (req, res, next) => {
    try {
        const invoice = await HoaDonBanHang.findById(req.params.id)
            .populate('khach_hang_id')
            .populate('kho_id')
            .populate('cua_hang_id')
            .populate('don_hang_id')
            .populate('nguoi_ban_id');
        if (!invoice) {
            return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y hÃƒÂ³a Ã„â€˜Ã†Â¡n' });
        }
        if (normalizeInvoiceStatus(invoice.trang_thai) === 'cancelled') {
            return res.status(400).json({ success: false, message: 'HÃƒÂ³a Ã„â€˜Ã†Â¡n Ã„â€˜ÃƒÂ£ hÃ¡Â»Â§y, khÃƒÂ´ng thÃ¡Â»Æ’ trÃ¡ÂºÂ£ hÃƒÂ ng' });
        }
        const items = await CTHoaDonBanHang.find({ hoa_don_id: invoice._id })
            .populate('hang_hoa_id')
            .populate('lo_hang_id');
        if (!items.length) {
            return res.status(400).json({ success: false, message: 'HÃƒÂ³a Ã„â€˜Ã†Â¡n chÃ†Â°a cÃƒÂ³ chi tiÃ¡ÂºÂ¿t hÃƒÂ ng hÃƒÂ³a' });
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
        const returnedByInvoiceLine = {};
        const returnedByLegacyLine = {};
        returnedItems.forEach(row => {
            const invoiceLineId = optionalLineObjectId(row.ct_hoa_don_id);
            const map = invoiceLineId ? returnedByInvoiceLine : returnedByLegacyLine;
            const key = invoiceLineId || legacyReturnLineKey(row);
            map[key] = (map[key] || 0) + Number(row.so_luong || 0);
        });
        const returnableItems = items
            .map(item => {
                const object = item.toObject();
                const invoiceLineId = String(object._id);
                const legacyKey = legacyReturnLineKey(object);
                const returnedQty = Number(returnedByInvoiceLine[invoiceLineId] || 0) + Number(returnedByLegacyLine[legacyKey] || 0);
                const remainingQty = Math.max(Number(object.so_luong || 0) - returnedQty, 0);
                object.so_luong_da_tra = returnedQty;
                object.so_luong_con_lai = remainingQty;
                object.so_luong = remainingQty;
                return object;
            })
            .filter(item => Number(item.so_luong_con_lai || 0) > 0);
        if (!returnableItems.length) {
            return res.status(400).json({ success: false, message: 'HÃƒÂ³a Ã„â€˜Ã†Â¡n Ã„â€˜ÃƒÂ£ Ã„â€˜Ã†Â°Ã¡Â»Â£c trÃ¡ÂºÂ£ hÃ¡ÂºÂ¿t hÃƒÂ ng' });
        }
        res.json({ success: true, data: { invoice, items: returnableItems } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'KhÃƒÂ´ng tÃ¡ÂºÂ£i Ã„â€˜Ã†Â°Ã¡Â»Â£c hÃƒÂ³a Ã„â€˜Ã†Â¡n trÃ¡ÂºÂ£ hÃƒÂ ng' });
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
            return res.status(400).json({ success: false, message: 'Vui lÃƒÂ²ng nhÃ¡ÂºÂ­p Ã„â€˜Ã¡Â»â€¹a chÃ¡Â»â€° lÃ¡ÂºÂ¥y hÃƒÂ ng trÃ¡ÂºÂ£' });
        }
        if (!Array.isArray(items) || !items.length) {
            return res.status(400).json({ success: false, message: 'PhiÃ¡ÂºÂ¿u trÃ¡ÂºÂ£ hÃƒÂ ng chÃ†Â°a cÃƒÂ³ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m' });
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
                so_luong: Number(item.so_luong || 0),
                don_gia: Number(item.don_gia || 0)
            }))
            .filter(item => item.hang_hoa_id && item.so_luong > 0);

        if (!cleanItems.length) {
            return res.status(400).json({ success: false, message: 'Vui lÃƒÂ²ng nhÃ¡ÂºÂ­p sÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng hÃƒÂ ng trÃ¡ÂºÂ£' });
        }

        let invoice = null;
        if (hoa_don_id) {
            invoice = await HoaDonBanHang.findById(hoa_don_id).lean();
            if (!invoice) return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y hÃƒÂ³a Ã„â€˜Ã†Â¡n' });
            if (normalizeInvoiceStatus(invoice.trang_thai) === 'cancelled') {
                return res.status(400).json({ success: false, message: 'HÃƒÂ³a Ã„â€˜Ã†Â¡n Ã„â€˜ÃƒÂ£ hÃ¡Â»Â§y, khÃƒÂ´ng thÃ¡Â»Æ’ trÃ¡ÂºÂ£ hÃƒÂ ng' });
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
                    return res.status(400).json({ success: false, message: 'SÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng trÃ¡ÂºÂ£ vÃ†Â°Ã¡Â»Â£t quÃƒÂ¡ sÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng cÃƒÂ²n cÃƒÂ³ thÃ¡Â»Æ’ trÃ¡ÂºÂ£' });
                }
            }
        }

        const warehouseId = kho_id || invoice?.kho_id;
        if (!warehouseId) {
            return res.status(400).json({ success: false, message: 'Vui lÃƒÂ²ng chÃ¡Â»Ân kho xÃ¡Â»Â­ lÃƒÂ½ trÃ¡ÂºÂ£/Ã„â€˜Ã¡Â»â€¢i hÃƒÂ ng' });
        }
        const warehouse = await Kho.findById(warehouseId).lean();
        if (!warehouse) {
            return res.status(400).json({ success: false, message: 'Kho xÃ¡Â»Â­ lÃƒÂ½ trÃ¡ÂºÂ£/Ã„â€˜Ã¡Â»â€¢i hÃƒÂ ng khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡' });
        }

        for (const item of cleanItems) {
            const product = await HangHoa.findById(item.hang_hoa_id).select('_id ten_hang quan_ly_theo_lo').lean();
            if (!product) return res.status(400).json({ success: false, message: 'HÃƒÂ ng trÃ¡ÂºÂ£ khÃƒÂ´ng tÃ¡Â»â€œn tÃ¡ÂºÂ¡i' });
            if (product.quan_ly_theo_lo && !item.lo_hang_id) {
                const fallbackLotId = await findReturnLotId(warehouseId, item.hang_hoa_id);
                if (!fallbackLotId) {
                    return res.status(400).json({
                        success: false,
                        message: `HÃƒÂ ng trÃ¡ÂºÂ£ ${product.ten_hang || item.hang_hoa_id} quÃ¡ÂºÂ£n lÃƒÂ½ theo lÃƒÂ´ nhÃ†Â°ng hÃƒÂ³a Ã„â€˜Ã†Â¡n khÃƒÂ´ng lÃ†Â°u lÃƒÂ´. Vui lÃƒÂ²ng nhÃ¡ÂºÂ­p/tÃ¡ÂºÂ¡o lÃƒÂ´ hÃƒÂ ng trÃ†Â°Ã¡Â»â€ºc khi trÃ¡ÂºÂ£.`
                    });
                }
                item.lo_hang_id = fallbackLotId;
            }
        }

        for (const item of cleanExchangeItems) {
            const product = await HangHoa.findById(item.hang_hoa_id).select('_id ten_hang quan_ly_theo_lo').lean();
            if (!product) return res.status(400).json({ success: false, message: 'HÃƒÂ ng Ã„â€˜Ã¡Â»â€¢i khÃƒÂ´ng tÃ¡Â»â€œn tÃ¡ÂºÂ¡i' });
            const stock = await getSellableStock(warehouseId, product);
            if (stock < item.so_luong) {
                return res.status(400).json({ success: false, message: `TÃ¡Â»â€œn kho hÃƒÂ ng Ã„â€˜Ã¡Â»â€¢i khÃƒÂ´ng Ã„â€˜Ã¡Â»Â§: ${product.ten_hang || item.hang_hoa_id}` });
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
        const count = await PhieuTraHang.countDocuments();
        const ma_phieu_tra = 'TH' + String(count + 1).padStart(6, '0');
        if (receiveMethod === 'lay_tai_nha' && !cleanSenderName) {
            const customer = await KhachHang.findById(khach_hang_id || invoice?.khach_hang_id).select('ten_khach_hang').lean();
            cleanSenderName = customer?.ten_khach_hang || '';
            if (!cleanSenderName) {
                return res.status(400).json({ success: false, message: 'Vui lÃƒÂ²ng nhÃ¡ÂºÂ­p tÃƒÂªn ngÃ†Â°Ã¡Â»Âi gÃ¡Â»Â­i trÃ¡ÂºÂ£' });
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
            ly_do: String(ly_do || '').trim() || (cleanExchangeItems.length ? 'KhÃƒÂ¡ch Ã„â€˜Ã¡Â»â€¢i hÃƒÂ ng' : 'KhÃƒÂ¡ch trÃ¡ÂºÂ£ hÃƒÂ ng'),
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
            await congTonKho({
                kho_id: warehouseId,
                hang_hoa_id: item.hang_hoa_id,
                lo_hang_id: item.lo_hang_id || undefined,
                so_luong: item.so_luong,
                nguoi_tao_id: req.user?._id,
                loai_phieu: 'tra_hang',
                ma_phieu: ma_phieu_tra,
                ghi_chu: `Khach tra hang ${ma_phieu_tra}`
            });
        }

        for (const item of cleanExchangeItems) {
            await truTonKho({
                kho_id: warehouseId,
                hang_hoa_id: item.hang_hoa_id,
                lo_hang_id: item.lo_hang_id || undefined,
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
                loai_dong: 'hang_doi',
                so_luong: item.so_luong,
                don_gia: item.don_gia,
                thanh_tien: item.so_luong * item.don_gia
            });
        }

        const customerId = khach_hang_id || invoice?.khach_hang_id || null;
        const storeId = invoice?.cua_hang_id || warehouse.cua_hang_id || null;
        if (chenhLech > 0) {
            const paid = Math.min(Math.max(Number(khach_thanh_toan_them || 0), 0), chenhLech);
            const debt = Math.max(chenhLech - paid, 0);
            if (paid > 0) {
                const cashBook = await ensureDefaultSoQuy(storeId);
                await taoPhieuThuChi({
                    loai_phieu: 'thu',
                    loai_thu_chi: 'Thu tien doi hang',
                    gia_tri: paid,
                    so_quy_id: cashBook._id,
                    cua_hang_id: storeId,
                    nguoi_tao_id: req.user?._id,
                    khach_hang_id: customerId || undefined,
                    hoa_don_id: hoa_don_id || undefined,
                    ma_chung_tu_goc: ma_phieu_tra,
                    doi_tuong: customerId ? undefined : 'KhÃƒÂ¡ch lÃ¡ÂºÂ»',
                    nhom_doi_tuong: 'khach_hang',
                    hach_toan: false
                });
            }
            if (debt > 0 && customerId) {
                await CongNoKhachHang.create({
                    khach_hang_id: customerId,
                    hoa_don_id: hoa_don_id || undefined,
                    so_tien: debt,
                    loai: 'tang_no',
                    ghi_chu: `CÃƒÂ´ng nÃ¡Â»Â£ Ã„â€˜Ã¡Â»â€¢i hÃƒÂ ng ${ma_phieu_tra}`,
                    ngay: new Date()
                });
                const customer = await KhachHang.findById(customerId).select('tong_no').lean();
                if (customer && typeof customer.tong_no === 'number') {
                    await KhachHang.updateOne({ _id: customerId }, { $inc: { tong_no: debt } });
                }
            }
        } else if (chenhLech < 0) {
            let refund = Math.abs(chenhLech);
            let debtReduction = 0;
            if (customerId) {
                const customer = await KhachHang.findById(customerId).select('tong_no').lean();
                const currentDebt = Number(customer?.tong_no || 0);
                debtReduction = Math.min(currentDebt, refund);
            }
            if (debtReduction > 0 && customerId) {
                await KhachHang.updateOne({ _id: customerId }, { $inc: { tong_no: -debtReduction } });
                await CongNoKhachHang.create({
                    khach_hang_id: customerId,
                    hoa_don_id: hoa_don_id || undefined,
                    so_tien: debtReduction,
                    loai: 'giam_no',
                    ghi_chu: `GiÃ¡ÂºÂ£m cÃƒÂ´ng nÃ¡Â»Â£ trÃ¡ÂºÂ£/Ã„â€˜Ã¡Â»â€¢i hÃƒÂ ng ${ma_phieu_tra}`,
                    ngay: new Date()
                });
                refund -= debtReduction;
            }
            if (refund > 0) {
                const cashBook = await ensureDefaultSoQuy(storeId);
                await taoPhieuThuChi({
                    loai_phieu: 'chi',
                    loai_thu_chi: 'Hoan tien tra hang',
                    gia_tri: refund,
                    so_quy_id: cashBook._id,
                    cua_hang_id: storeId,
                    nguoi_tao_id: req.user?._id,
                    khach_hang_id: customerId || undefined,
                    hoa_don_id: hoa_don_id || undefined,
                    ma_chung_tu_goc: ma_phieu_tra,
                    doi_tuong: customerId ? undefined : 'KhÃƒÂ¡ch lÃ¡ÂºÂ»',
                    nhom_doi_tuong: 'khach_hang',
                    hach_toan: false
                });
            }
        }

        res.json({ success: true, message: 'Ã„ÂÃƒÂ£ tÃ¡ÂºÂ¡o phiÃ¡ÂºÂ¿u trÃ¡ÂºÂ£ hÃƒÂ ng', ma_phieu_tra, id: returnSlip._id, print_url: '/chung-tu-kho/tra-hang-ban/' + returnSlip._id });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'KhÃƒÂ´ng tÃ¡ÂºÂ¡o Ã„â€˜Ã†Â°Ã¡Â»Â£c phiÃ¡ÂºÂ¿u trÃ¡ÂºÂ£ hÃƒÂ ng' });
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
        res.render('don-hang/doi-tac-giao-hang', { title: 'Ã„ÂÃ¡Â»â€˜i tÃƒÂ¡c giao hÃƒÂ ng', partners, shipmentMap });
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
            return res.status(404).send('KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y Ã„â€˜Ã¡Â»â€˜i tÃƒÂ¡c giao hÃƒÂ ng');
        }
        const { partners, priceMap } = await loadDeliveryPartnerExportData({ _id: req.params.id });
        if (!partners.length) return res.status(404).send('KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y Ã„â€˜Ã¡Â»â€˜i tÃƒÂ¡c giao hÃƒÂ ng');
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
            return res.status(400).json({ success: false, message: 'TÃƒÂªn Ã„â€˜Ã¡Â»â€˜i tÃƒÂ¡c lÃƒÂ  bÃ¡ÂºÂ¯t buÃ¡Â»â„¢c' });
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
        res.json({ success: true, message: 'Ã„ÂÃƒÂ£ thÃƒÂªm Ã„â€˜Ã¡Â»â€˜i tÃƒÂ¡c giao hÃƒÂ ng' });
    } catch (error) {
        next(error);
    }
});

router.post('/doi-tac-giao-hang/:id/update', async (req, res, next) => {
    try {
        const { ma_doi_tac, ten_doi_tac, sdt, email, ghi_chu, trang_thai } = req.body || {};
        if (!ten_doi_tac || ten_doi_tac.trim() === '') {
            return res.status(400).json({ success: false, message: 'TÃƒÂªn Ã„â€˜Ã¡Â»â€˜i tÃƒÂ¡c lÃƒÂ  bÃ¡ÂºÂ¯t buÃ¡Â»â„¢c' });
        }
        const partner = await DoiTacGiaoHang.findById(req.params.id);
        if (!partner) return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y Ã„â€˜Ã¡Â»â€˜i tÃƒÂ¡c giao hÃƒÂ ng' });

        if (ma_doi_tac && ma_doi_tac.trim() !== '' && ma_doi_tac.trim() !== partner.ma_doi_tac) {
            const exists = await DoiTacGiaoHang.findOne({ ma_doi_tac: ma_doi_tac.trim(), _id: { $ne: partner._id } });
            if (exists) return res.status(400).json({ success: false, message: 'MÃƒÂ£ Ã„â€˜Ã¡Â»â€˜i tÃƒÂ¡c Ã„â€˜ÃƒÂ£ tÃ¡Â»â€œn tÃ¡ÂºÂ¡i' });
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
        res.json({ success: true, message: 'Ã„ÂÃƒÂ£ cÃ¡ÂºÂ­p nhÃ¡ÂºÂ­t Ã„â€˜Ã¡Â»â€˜i tÃƒÂ¡c giao hÃƒÂ ng', data: partner });
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
                item.doi_tac_giao_hang_id?.ten_doi_tac || 'TÃ¡Â»Â± giao hÃƒÂ ng',
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
            return res.status(404).send('KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y vÃ¡ÂºÂ­n Ã„â€˜Ã†Â¡n');
        }
        const shipments = await loadShipmentExportData({ _id: req.params.id });
        if (!shipments.length) return res.status(404).send('KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y vÃ¡ÂºÂ­n Ã„â€˜Ã†Â¡n');
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
            return res.status(400).json({ success: false, message: 'TrÃ¡ÂºÂ¡ng thÃƒÂ¡i vÃ¡ÂºÂ­n Ã„â€˜Ã†Â¡n khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡' });
        }
        const shipment = await VanDon.findByIdAndUpdate(req.params.id, { trang_thai }, { new: true });
        if (!shipment) {
            return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y vÃ¡ÂºÂ­n Ã„â€˜Ã†Â¡n' });
        }
        res.json({ success: true, message: 'Ã„ÂÃƒÂ£ cÃ¡ÂºÂ­p nhÃ¡ÂºÂ­t trÃ¡ÂºÂ¡ng thÃƒÂ¡i vÃ¡ÂºÂ­n Ã„â€˜Ã†Â¡n', data: shipment });
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

            const cashBookId = req.body?.so_quy_id;
            if (!cashBookId || !/^[0-9a-fA-F]{24}$/.test(String(cashBookId))) {
                const error = new Error('Vui long chon so quy de thu COD.');
                error.statusCode = 400;
                throw error;
            }
            const cashBook = await SoQuy.findById(cashBookId).session(session).lean();
            if (!cashBook) {
                const error = new Error('So quy thu COD khong hop le.');
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
                so_quy_id: cashBook._id,
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
                phuong_thuc_thanh_toan: req.body?.phuong_thuc_thanh_toan || 'tien_mat',
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

router.post('/van-don/:id/thu-cod-legacy', async (req, res, next) => {
    try {
        return res.status(410).json({ success: false, message: 'Legacy COD collection endpoint is disabled.' });
        const shipment = await VanDon.findById(req.params.id)
            .populate('khach_hang_id')
            .populate('hoa_don_id')
            .populate('don_hang_id');
        if (!shipment) return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y vÃ¡ÂºÂ­n Ã„â€˜Ã†Â¡n' });
        const amount = Number(req.body?.gia_tri || shipment.cod_amount || shipment.hoa_don_id?.thanh_toan || shipment.don_hang_id?.tong_thanh_toan || 0);
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: 'SÃ¡Â»â€˜ tiÃ¡Â»Ân COD khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡' });
        const exists = await PhieuThuChi.findOne({ van_don_id: shipment._id, loai_phieu: 'thu', loai_thu_chi: 'Thu COD' });
        if (exists) return res.json({ success: true, message: 'VÃ¡ÂºÂ­n Ã„â€˜Ã†Â¡n Ã„â€˜ÃƒÂ£ cÃƒÂ³ phiÃ¡ÂºÂ¿u thu COD', data: exists });
        const cashBook = await ensureDefaultSoQuy(shipment.cua_hang_id);
        const receipt = await taoPhieuThuChi({
            loai_phieu: 'thu',
            loai_thu_chi: 'Thu COD',
            gia_tri: amount,
            so_quy_id: cashBook._id,
            cua_hang_id: shipment.cua_hang_id,
            nguoi_tao_id: req.user?._id,
            khach_hang_id: shipment.khach_hang_id?._id || shipment.khach_hang_id,
            don_hang_id: shipment.don_hang_id?._id || shipment.don_hang_id,
            hoa_don_id: shipment.hoa_don_id?._id || shipment.hoa_don_id,
            van_don_id: shipment._id,
            ma_chung_tu_goc: shipment.ma_van_don,
            doi_tuong: shipment.khach_hang_id?.ten_khach_hang || shipment.ten_nguoi_nhan || 'COD',
            nhom_doi_tuong: 'khach_hang',
            phuong_thuc_thanh_toan: req.body?.phuong_thuc_thanh_toan || 'tien_mat',
            hach_toan: req.body?.hach_toan === true || req.body?.hach_toan === 'true'
        });
        shipment.trang_thai_cod = 'da_thu';
        await shipment.save();
        res.json({ success: true, message: 'Ã„ÂÃƒÂ£ tÃ¡ÂºÂ¡o phiÃ¡ÂºÂ¿u thu COD', data: receipt });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'KhÃƒÂ´ng thu Ã„â€˜Ã†Â°Ã¡Â»Â£c COD' });
    }
});

router.post('/van-don/:id/chi-phi-van-chuyen', async (req, res, next) => {
    try {
        const shipment = await VanDon.findById(req.params.id).populate('doi_tac_giao_hang_id');
        if (!shipment) return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y vÃ¡ÂºÂ­n Ã„â€˜Ã†Â¡n' });
        const amount = Number(req.body?.gia_tri || shipment.phi_giao_hang || 0);
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: 'PhÃƒÂ­ vÃ¡ÂºÂ­n chuyÃ¡Â»Æ’n khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡' });
        const cashBook = await ensureDefaultSoQuy(shipment.cua_hang_id);
        const receipt = await taoPhieuThuChi({
            loai_phieu: 'chi',
            loai_thu_chi: 'Chi phi van chuyen',
            gia_tri: amount,
            so_quy_id: cashBook._id,
            cua_hang_id: shipment.cua_hang_id,
            nguoi_tao_id: req.user?._id,
            don_hang_id: shipment.don_hang_id,
            hoa_don_id: shipment.hoa_don_id,
            van_don_id: shipment._id,
            ma_chung_tu_goc: shipment.ma_van_don,
            doi_tuong: shipment.doi_tac_giao_hang_id?.ten_doi_tac || 'Ã„ÂÃ¡Â»â€˜i tÃƒÂ¡c giao hÃƒÂ ng',
            nhom_doi_tuong: 'doi_tac_giao_hang',
            phuong_thuc_thanh_toan: req.body?.phuong_thuc_thanh_toan || 'tien_mat',
            hach_toan: false
        });
        res.json({ success: true, message: 'Ã„ÂÃƒÂ£ tÃ¡ÂºÂ¡o phiÃ¡ÂºÂ¿u chi phÃƒÂ­ vÃ¡ÂºÂ­n chuyÃ¡Â»Æ’n', data: receipt });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'KhÃƒÂ´ng tÃ¡ÂºÂ¡o Ã„â€˜Ã†Â°Ã¡Â»Â£c phiÃ¡ÂºÂ¿u chi vÃ¡ÂºÂ­n chuyÃ¡Â»Æ’n' });
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
            SoQuy.find(cashBookQuery).sort({ ten_so_quy: 1, loai: 1 }).lean()
        ]);
        res.locals.cashBooks = cashBooks;
        res.render('don-hang/van-don', { title: 'VÃ¡ÂºÂ­n Ã„â€˜Ã†Â¡n', shipments, partners, filters: req.query || {} });
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
            return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y Ã„â€˜Ã†Â¡n Ã„â€˜Ã¡ÂºÂ·t hÃƒÂ ng' });
        }

        if (sourceOrder.trang_thai === 'merged') {
            return res.status(400).json({
                success: false,
                message: `Đơn hàng này đã được gộp vào ${sourceOrder.merged_to_ma_don_hang || 'đơn khác'}, không thể thao tác riêng.`
            });
        }

        const sourceItems = await CTDonHang.find({ don_hang_id: sourceOrder._id }).lean();
        if (!sourceItems.length) {
            return res.status(400).json({ success: false, message: 'Ã„ÂÃ†Â¡n Ã„â€˜Ã¡ÂºÂ·t hÃƒÂ ng chÃ†Â°a cÃƒÂ³ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m Ã„â€˜Ã¡Â»Æ’ sao chÃƒÂ©p' });
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
            message: 'Ã„ÂÃƒÂ£ sao chÃƒÂ©p Ã„â€˜Ã†Â¡n Ã„â€˜Ã¡ÂºÂ·t hÃƒÂ ng',
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
        if (!order) return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y Ã„â€˜Ã†Â¡n hÃƒÂ ng' });
        const items = await CTDonHang.find({ don_hang_id: order._id }).populate('hang_hoa_id');
        const shipment = await VanDon.findOne({ don_hang_id: order._id }).populate('doi_tac_giao_hang_id').populate('cua_hang_id');
        const invoice = await HoaDonBanHang.findOne({ don_hang_id: order._id }).select('_id ma_hoa_don trang_thai');
        order.khach_thanh_toan = await getOrderPaidAmount(order._id);
        res.json({ success: true, data: { order, items, shipment, invoice } });
    } catch (error) {
        next(error);
    }
});

router.put('/:id/detail', async (req, res, next) => {
    try {
        const order = await DonHang.findById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y Ã„â€˜Ã†Â¡n hÃƒÂ ng' });
        if (order.trang_thai === 'cancelled' || order.trang_thai === 'merged') {
            return res.status(400).json({ success: false, message: 'Ã„ÂÃ†Â¡n Ã„â€˜ÃƒÂ£ hÃ¡Â»Â§y, khÃƒÂ´ng thÃ¡Â»Æ’ sÃ¡Â»Â­a' });
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

        res.json({ success: true, message: 'Ã„ÂÃƒÂ£ lÃ†Â°u thÃƒÂ´ng tin Ã„â€˜Ã†Â¡n hÃƒÂ ng' });
    } catch (error) {
        next(error);
    }
});

async function confirmOrderDelivery(req, res, next) {
    try {
        const { kho_id, items, khach_thanh_toan, phuong_thuc_thanh_toan } = req.body || {};
        const deliveryItems = parseItems(items);

        if (!kho_id) {
            return res.status(400).json({ success: false, message: 'Vui lÃƒÂ²ng chÃ¡Â»Ân kho.' });
        }

        const warehouse = await Kho.findById(kho_id);
        if (!warehouse) {
            return res.status(400).json({ success: false, message: 'Kho giao hÃƒÂ ng khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡' });
        }

        if (!deliveryItems.length) {
            return res.status(400).json({ success: false, message: 'Vui lÃƒÂ²ng chÃ¡Â»Ân hÃƒÂ ng cÃ¡ÂºÂ§n giao' });
        }

        const order = await DonHang.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y Ã„â€˜Ã†Â¡n hÃƒÂ ng' });
        }

        let hasDelivered = false;
        if (order.trang_thai === 'merged') {
            return res.status(400).json({ success: false, message: `Ãon nÃ y dÃ£ du?c g?p vÃ o ${order.merged_to_ma_don_hang || 'don khÃ¡c'}, khÃ´ng th? xÃ¡c nh?n giao.` });
        }
        for (const item of deliveryItems) {
            const quantity = Number(item.so_luong_giao);
            if (!Number.isFinite(quantity) || quantity <= 0) {
                return res.status(400).json({ success: false, message: 'So luong giao phai lon hon 0' });
            }

            const detail = item.ct_don_hang_id
                ? await CTDonHang.findOne({ _id: item.ct_don_hang_id, don_hang_id: order._id })
                : await CTDonHang.findOne({ don_hang_id: order._id, hang_hoa_id: item.hang_hoa_id });

            if (!detail) {
                return res.status(400).json({ success: false, message: 'DÃƒÂ²ng hÃƒÂ ng giao khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡' });
            }

            const orderedQuantity = Number(detail.so_luong_dat || detail.so_luong || 0);
            const deliveredBefore = Number(detail.so_luong_da_giao || 0);
            const remainingBefore = Math.max(orderedQuantity - deliveredBefore, 0);
            if (quantity > remainingBefore) {
                return res.status(400).json({ success: false, message: 'So luong giao vuot qua so luong con thieu' });
            }

            try {
                await truTonKho({
                    kho_id,
                    hang_hoa_id: item.hang_hoa_id || detail.hang_hoa_id,
                    lo_hang_id: item.lo_hang_id || detail.lo_hang_id,
                    so_luong: quantity,
                    nguoi_tao_id: req.user?._id,
                    loai_phieu: 'ban_hang',
                    ma_phieu: order.ma_don_hang,
                    ghi_chu: `Giao hang don ${order.ma_don_hang}`
                });
            } catch (error) {
                if (/tÃ¡Â»â€œn kho|ton kho|TÃ¡Â»â€œn kho|lo/i.test(error.message || '')) {
                    return res.status(400).json({ success: false, message: 'KhÃƒÂ´ng Ã„â€˜Ã¡Â»Â§ tÃ¡Â»â€œn kho Ã„â€˜Ã¡Â»Æ’ giao hÃƒÂ ng' });
                }
                throw error;
            }

            const deliveredAfter = deliveredBefore + quantity;
            const missingAfter = Math.max(orderedQuantity - deliveredAfter, 0);
            detail.so_luong_dat = orderedQuantity;
            detail.so_luong_xac_nhan = Number(detail.so_luong_xac_nhan || 0) + quantity;
            detail.so_luong_da_giao = deliveredAfter;
            detail.so_luong_con_thieu = missingAfter;
            detail.trang_thai_giao = deliveredAfter <= 0
                ? 'chua_giao'
                : (missingAfter <= 0 ? 'giao_du' : 'giao_thieu');
            if (item.lo_hang_id) detail.lo_hang_id = item.lo_hang_id;
            await detail.save();
            hasDelivered = true;
        }

        const allDetails = await CTDonHang.find({ don_hang_id: order._id });
        const allDelivered = allDetails.length > 0 && allDetails.every(item => Number(item.so_luong_con_thieu || 0) <= 0);
        const anyDelivered = allDetails.some(item => Number(item.so_luong_da_giao || 0) > 0);
        const anyMissing = allDetails.some(item => Number(item.so_luong_con_thieu || item.so_luong_dat || item.so_luong || 0) > 0);

        order.kho_id = kho_id;
        order.trang_thai_giao_hang = allDelivered
            ? 'giao_du'
            : (anyDelivered && anyMissing ? 'giao_mot_phan' : 'chua_giao');
        if (hasDelivered) {
            order.ngay_giao_thuc_te = new Date();
            if (!order.trang_thai || order.trang_thai === 'draft' || order.trang_thai === 'da_xac_nhan') {
                order.trang_thai = allDelivered ? 'completed' : 'shipping';
            } else if (order.trang_thai === 'shipping' && allDelivered) {
                order.trang_thai = 'completed';
            }
        }
        const paidBeforeDelivery = await getOrderPaidAmount(order._id);
        const remainingPayment = Math.max(Number(order.tong_thanh_toan || order.tong_tien || 0) - paidBeforeDelivery, 0);
        const extraPaid = Math.max(0, Number(khach_thanh_toan || 0));
        if (extraPaid > remainingPayment) {
            return res.status(400).json({
                success: false,
                message: `KhÃƒÂ¡ch chÃ¡Â»â€° cÃƒÂ²n cÃ¡ÂºÂ§n thanh toÃƒÂ¡n ${remainingPayment.toLocaleString('vi-VN')} VNÃ„Â`
            });
        }
        let receipt = null;
        if (extraPaid > 0) {
            const cashBook = await ensureDefaultSoQuy(order.cua_hang_id);
            const shipment = await VanDon.findOne({ don_hang_id: order._id }).lean();
            const invoice = await HoaDonBanHang.findOne({ don_hang_id: order._id }).lean();
            receipt = await taoPhieuThuChi({
                loai_phieu: 'thu',
                loai_thu_chi: 'Thu tien khi giao hang',
                gia_tri: extraPaid,
                so_quy_id: cashBook._id,
                cua_hang_id: order.cua_hang_id,
                nguoi_tao_id: req.user?._id,
                khach_hang_id: order.khach_hang_id,
                don_hang_id: order._id,
                hoa_don_id: invoice?._id,
                van_don_id: shipment?._id,
                ma_chung_tu_goc: order.ma_don_hang,
                nhom_doi_tuong: 'khach_hang',
                phuong_thuc_thanh_toan: normalizePaymentMethodValue(phuong_thuc_thanh_toan),
                hach_toan: false
            });
            order.khach_thanh_toan = paidBeforeDelivery + extraPaid;
        } else {
            order.khach_thanh_toan = paidBeforeDelivery;
        }
        await order.save();

        return res.json({
            success: true,
            message: 'Da xac nhan giao hang',
            data: {
                don_hang_id: order._id,
                trang_thai_giao_hang: order.trang_thai_giao_hang,
                ngay_giao_thuc_te: order.ngay_giao_thuc_te,
                khach_thanh_toan: order.khach_thanh_toan,
                phieu_thu_id: receipt?._id
            },
            print_url: '/chung-tu-kho/ban-hang/' + order._id
        });
    } catch (error) {
        next(error);
    }
}

router.put('/:id/xac-nhan-giao', confirmOrderDelivery);

router.post('/:id/phieu-thu', async (req, res, next) => {
    try {
        const order = await DonHang.findById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y Ã„â€˜Ã†Â¡n hÃƒÂ ng' });
        if (order.trang_thai === 'cancelled' || order.trang_thai === 'merged') {
            return res.status(400).json({ success: false, message: 'Ã„ÂÃ†Â¡n Ã„â€˜ÃƒÂ£ hÃ¡Â»Â§y, khÃƒÂ´ng thÃ¡Â»Æ’ thu tiÃ¡Â»Ân' });
        }

        const invoice = await HoaDonBanHang.findOne({ don_hang_id: order._id });
        const payable = Number(invoice?.thanh_toan || order.tong_thanh_toan || order.tong_tien || 0);
        const paidBefore = await getOrderPaidAmount(order._id);
        const remaining = Math.max(payable - paidBefore, 0);
        const amount = Math.max(0, Number(req.body?.gia_tri || req.body?.khach_thanh_toan || 0));
        if (amount <= 0) return res.status(400).json({ success: false, message: 'SÃ¡Â»â€˜ tiÃ¡Â»Ân thu khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡' });
        if (amount > remaining) {
            return res.status(400).json({
                success: false,
                message: `KhÃƒÂ¡ch chÃ¡Â»â€° cÃƒÂ²n nÃ¡Â»Â£ ${remaining.toLocaleString('vi-VN')} VNÃ„Â`
            });
        }

        const [cashBook, shipment] = await Promise.all([
            ensureDefaultSoQuy(order.cua_hang_id),
            VanDon.findOne({ don_hang_id: order._id }).lean()
        ]);
        const receipt = await taoPhieuThuChi({
            loai_phieu: 'thu',
            loai_thu_chi: 'Thu tien don hang',
            gia_tri: amount,
            so_quy_id: cashBook._id,
            cua_hang_id: order.cua_hang_id,
            nguoi_tao_id: req.user?._id,
            khach_hang_id: order.khach_hang_id,
            don_hang_id: order._id,
            hoa_don_id: invoice?._id,
            van_don_id: shipment?._id,
            ma_chung_tu_goc: order.ma_don_hang,
            nhom_doi_tuong: 'khach_hang',
            phuong_thuc_thanh_toan: normalizePaymentMethodValue(req.body?.phuong_thuc_thanh_toan),
            hach_toan: false
        });

        const paidAfter = paidBefore + amount;
        order.khach_thanh_toan = paidAfter;
        await order.save();

        if (invoice) {
            invoice.trang_thai = resolveInvoiceStatus(payable, paidAfter);
            await invoice.save();
            if (order.khach_hang_id) {
                await CongNoKhachHang.create({
                    khach_hang_id: order.khach_hang_id,
                    don_hang_id: order._id,
                    hoa_don_id: invoice._id,
                    phieu_thu_chi_id: receipt._id,
                    so_tien: amount,
                    loai: 'giam_no',
                    ghi_chu: `Thu tiÃ¡Â»Ân Ã„â€˜Ã†Â¡n hÃƒÂ ng ${order.ma_don_hang}`,
                    ngay: new Date()
                });
                const customer = await KhachHang.findById(order.khach_hang_id).select('tong_no').lean();
                if (customer && typeof customer.tong_no === 'number') {
                    await KhachHang.updateOne({ _id: order.khach_hang_id }, { $inc: { tong_no: -amount } });
                }
            }
        }

        res.json({ success: true, message: 'Ã„ÂÃƒÂ£ tÃ¡ÂºÂ¡o phiÃ¡ÂºÂ¿u thu', data: { receipt, paid: paidAfter, remaining: Math.max(payable - paidAfter, 0) } });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/status', async (req, res, next) => {
    try {
        const { trang_thai, force_complete_short } = req.body || {};
        const allowed = ['draft', 'shipping', 'completed', 'cancelled'];
        if (!allowed.includes(trang_thai)) {
            return res.status(400).json({ success: false, message: 'TrÃ¡ÂºÂ¡ng thÃƒÂ¡i Ã„â€˜Ã†Â¡n hÃƒÂ ng khÃƒÂ´ng hÃ¡Â»Â£p lÃ¡Â»â€¡' });
        }
        const order = await DonHang.findById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: 'KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y Ã„â€˜Ã†Â¡n hÃƒÂ ng' });
        if (order.trang_thai === 'merged') {
            return res.status(400).json({ success: false, message: `ÄÆ¡n nÃ y Ä‘Ã£ Ä‘Æ°á»£c gá»™p vÃ o ${order.merged_to_ma_don_hang || 'Ä‘Æ¡n khÃ¡c'}, khÃ´ng thá»ƒ cáº­p nháº­t tráº¡ng thÃ¡i.` });
        }
        if (trang_thai === 'completed' && order.trang_thai_giao_hang !== 'giao_du' && !force_complete_short) {
            return res.status(400).json({
                success: false,
                code: 'NEED_CONFIRM_SHORT',
                message: 'Ã„ÂÃ†Â¡n chÃ†Â°a giao Ã„â€˜Ã¡Â»Â§. CÃ¡ÂºÂ§n xÃƒÂ¡c nhÃ¡ÂºÂ­n kÃ¡ÂºÂ¿t thÃƒÂºc thiÃ¡ÂºÂ¿u.'
            });
        }
        order.trang_thai = trang_thai;
        await order.save();
        res.json({ success: true, message: 'Ã„ÂÃƒÂ£ cÃ¡ÂºÂ­p nhÃ¡ÂºÂ­t trÃ¡ÂºÂ¡ng thÃƒÂ¡i Ã„â€˜Ã†Â¡n hÃƒÂ ng' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;

