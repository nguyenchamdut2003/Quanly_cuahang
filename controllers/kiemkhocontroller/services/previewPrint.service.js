const { Kho, CuaHang } = require('../../../models/kiot.model');
const { isObjectId } = require('../helpers/common.helper');
const {
    SESSION_TON_PREVIEW,
    SESSION_GIA_TRI_PREVIEW,
    TON_PREVIEW_MAX_MS,
    sanitizeTonPreviewRows,
    sanitizeGiaTriPreviewRows
} = require('../helpers/preview.helper');

async function saveTonPreview({ body, session }) {
    const kho_id = String(body.kho_id || '').trim();
    if (!isObjectId(kho_id)) return { status: 400, body: { success: false, message: 'Vui lòng chọn kho hợp lệ.' } };
    const kho = await Kho.findById(kho_id).lean();
    if (!kho) return { status: 400, body: { success: false, message: 'Không tìm thấy kho.' } };
    const items = sanitizeTonPreviewRows(body.items);
    if (!items.length) return { status: 400, body: { success: false, message: 'Không có hàng để in.' } };
    session[SESSION_TON_PREVIEW] = { cua_hang_id: body.cua_hang_id ? String(body.cua_hang_id).trim() : '', kho_id, ghi_chu: String(body.ghi_chu || ''), items, savedAt: Date.now() };
    return { status: 200, body: { success: true, url: '/kiem-kho/in-ton-he-thong-preview' } };
}

async function saveGiaTriPreview({ body, session }) {
    const kho_id = String(body.kho_id || '').trim();
    if (!isObjectId(kho_id)) return { status: 400, body: { success: false, message: 'Vui lòng chọn kho hợp lệ.' } };
    const kho = await Kho.findById(kho_id).lean();
    if (!kho) return { status: 400, body: { success: false, message: 'Không tìm thấy kho.' } };
    const items = sanitizeGiaTriPreviewRows(body.items);
    if (!items.length) return { status: 400, body: { success: false, message: 'Không có hàng để in.' } };
    session[SESSION_GIA_TRI_PREVIEW] = { cua_hang_id: body.cua_hang_id ? String(body.cua_hang_id).trim() : '', kho_id, ghi_chu: String(body.ghi_chu || ''), items, savedAt: Date.now() };
    return { status: 200, body: { success: true, url: '/kiem-kho/in-gia-tri-kho-preview' } };
}

async function loadPreviewFromSession({ raw, user, includeValue }) {
    if (!raw || typeof raw.savedAt !== 'number' || Date.now() - raw.savedAt > TON_PREVIEW_MAX_MS) return null;
    const kho = raw.kho_id && isObjectId(raw.kho_id) ? await Kho.findById(raw.kho_id).lean() : null;
    if (!kho) return null;
    let store = null;
    if (raw.cua_hang_id && isObjectId(raw.cua_hang_id)) store = await CuaHang.findById(raw.cua_hang_id).lean();
    if (!store && kho.cua_hang_id) store = await CuaHang.findById(kho.cua_hang_id).lean();
    const items = Array.isArray(raw.items) ? raw.items : [];
    const data = { store: store || {}, warehouse: kho, creator: user || {}, ghi_chu: String(raw.ghi_chu || ''), items, totalTon: items.reduce((s, r) => s + Number(r.ton_kho_he_thong || 0), 0), printedAt: raw.savedAt };
    if (includeValue) data.totalGiaTri = items.reduce((s, r) => s + Number(r.gia_tri_kho || 0), 0);
    return data;
}

function loadTonPreview({ session, user }) {
    return loadPreviewFromSession({ raw: session && session[SESSION_TON_PREVIEW], user, includeValue: false });
}

function loadGiaTriPreview({ session, user }) {
    return loadPreviewFromSession({ raw: session && session[SESSION_GIA_TRI_PREVIEW], user, includeValue: true });
}

module.exports = { saveTonPreview, saveGiaTriPreview, loadTonPreview, loadGiaTriPreview };
