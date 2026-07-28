const { formatLotName } = require('../../../utils/kiemKhoDisplay');
const { parseItems } = require('./common.helper');

const SESSION_TON_PREVIEW = 'kiemKhoTonPreview';
const SESSION_GIA_TRI_PREVIEW = 'kiemKhoGiaTriPreview';
const TON_PREVIEW_MAX_MS = 60 * 60 * 1000;
const TON_PREVIEW_MAX_ROWS = 2500;

function sanitizeTonPreviewRows(rawItems) {
    const list = parseItems(rawItems);
    const out = [];
    for (const row of list.slice(0, TON_PREVIEW_MAX_ROWS)) {
        out.push({
            ma_hang: String(row.ma_hang || '').slice(0, 120),
            ten_hang: String(row.ten_hang || '').slice(0, 400),
            don_vi_tinh: String(row.don_vi_tinh || '').slice(0, 60),
            ma_lo: String(row.ma_lo || '').slice(0, 200),
            ten_lo: String(row.ten_lo || '').slice(0, 200),
            lo_hang_label: String(row.lo_hang_label || formatLotName(row) || '').slice(0, 240),
            han_su_dung: row.han_su_dung || null,
            ten_quy_cach: String(row.ten_quy_cach || '').slice(0, 200),
            ton_kho_he_thong: Number(row.ton_kho_he_thong || 0),
            don_gia_von: Number(row.don_gia_von || 0),
            ten_ncc: String(row.ten_ncc || '---').slice(0, 200),
            gia_tri_kho: Number(row.gia_tri_kho || 0)
        });
    }
    return out;
}

function sanitizeGiaTriPreviewRows(rawItems) {
    const list = parseItems(rawItems);
    const out = [];
    for (const row of list.slice(0, TON_PREVIEW_MAX_ROWS)) {
        const qty = Number(row.ton_kho_he_thong || row.so_luong_ton || 0);
        const cost = Number(row.don_gia_von || 0);
        out.push({
            ma_hang: String(row.ma_hang || '').slice(0, 120),
            ten_hang: String(row.ten_hang || '').slice(0, 400),
            don_vi_tinh: String(row.don_vi_tinh || '').slice(0, 60),
            ma_lo: String(row.ma_lo || '').slice(0, 200),
            ten_lo: String(row.ten_lo || '').slice(0, 200),
            lo_hang_label: String(row.lo_hang_label || formatLotName(row) || '').slice(0, 240),
            han_su_dung: row.han_su_dung || null,
            ten_quy_cach: String(row.ten_quy_cach || '').slice(0, 200),
            ton_kho_he_thong: qty,
            don_gia_von: cost,
            ten_ncc: String(row.ten_ncc || '---').slice(0, 200),
            gia_tri_kho: Number(row.gia_tri_kho != null ? row.gia_tri_kho : qty * cost)
        });
    }
    return out;
}

module.exports = {
    SESSION_TON_PREVIEW,
    SESSION_GIA_TRI_PREVIEW,
    TON_PREVIEW_MAX_MS,
    TON_PREVIEW_MAX_ROWS,
    sanitizeTonPreviewRows,
    sanitizeGiaTriPreviewRows
};
