function normalizeTenQuyCach(value) {
    return String(value || '').trim();
}

function formatLotName(source) {
    if (!source) return '';
    if (typeof source === 'string') return source;
    const lot = source.lo_hang_id && typeof source.lo_hang_id === 'object'
        ? source.lo_hang_id
        : source;
    const ten = String(lot.ten_lo || source.ten_lo || '').trim();
    const ma = String(lot.ma_lo || source.ma_lo || '').trim();
    if (ten) return ten;
    if (ma) return ma;
    if (source.lo_hang_id || source.ten_lo || source.ma_lo) return 'Lô không tên';
    return '';
}

function nccLabel(ncc) {
    if (!ncc || typeof ncc !== 'object') return '';
    return String(ncc.ten_ncc || ncc.ma_ncc || '').trim();
}

function pickUnitCost({ qcCost, tonLoCost, loCost, productCost }) {
    const qc = Number(qcCost);
    if (Number.isFinite(qc) && qc > 0) return qc;
    const tonLo = Number(tonLoCost);
    if (Number.isFinite(tonLo) && tonLo > 0) return tonLo;
    const lo = Number(loCost);
    if (Number.isFinite(lo) && lo > 0) return lo;
    return Number(productCost) || 0;
}

function buildStockMaps({ products, tonLoList, qcList, loList }) {
    const productMap = (products || []).reduce((acc, row) => {
        acc[String(row._id)] = row;
        return acc;
    }, {});

    const tonLoByLot = (tonLoList || []).reduce((acc, row) => {
        const key = String(row.lo_hang_id);
        if (!acc[key] || Number(row.gia_von) > Number(acc[key].gia_von || 0)) {
            acc[key] = row;
        }
        return acc;
    }, {});

    const qcByKey = (qcList || []).reduce((acc, row) => {
        const tenQc = normalizeTenQuyCach(row.ten_quy_cach || row.ten_thuoc_tinh);
        if (!tenQc) return acc;
        acc[`${String(row.lo_hang_id)}::${tenQc}`] = row;
        return acc;
    }, {});

    const loById = (loList || []).reduce((acc, row) => {
        acc[String(row._id)] = row;
        return acc;
    }, {});

    return { productMap, tonLoByLot, qcByKey, loById };
}

function resolveDonGiaVon(row, maps) {
    const product = maps.productMap[String(row.hang_hoa_id)] || {};
    const lotId = row.lo_hang_id ? String(row.lo_hang_id._id || row.lo_hang_id) : '';
    const tenQc = normalizeTenQuyCach(row.ten_quy_cach);

    let qcCost;
    let tonLoCost;
    let loCost;
    if (lotId && tenQc) {
        const qc = maps.qcByKey[`${lotId}::${tenQc}`];
        qcCost = qc?.gia_von;
    }
    if (lotId) {
        tonLoCost = maps.tonLoByLot[lotId]?.gia_von;
        loCost = maps.loById[lotId]?.gia_von;
    }

    return pickUnitCost({
        qcCost,
        tonLoCost,
        loCost,
        productCost: product.gia_von
    });
}

function resolveNccName(row, maps) {
    const lotId = row.lo_hang_id ? String(row.lo_hang_id._id || row.lo_hang_id) : '';
    if (lotId) {
        const fromLo = nccLabel(maps.loById[lotId]?.nha_cung_cap_id);
        if (fromLo) return fromLo;
    }
    const product = maps.productMap[String(row.hang_hoa_id)] || {};
    return nccLabel(product.nha_cung_cap_id) || '---';
}

function enrichKiemKhoLine(row, maps) {
    const qty = Number(row.ton_kho_he_thong != null ? row.ton_kho_he_thong : row.so_luong_ton || 0);
    const donGiaVon = resolveDonGiaVon(row, maps);
    const tenNcc = resolveNccName(row, maps);
    return Object.assign({}, row, {
        ten_lo: row.ten_lo || (row.lo_hang_id && row.lo_hang_id.ten_lo) || '',
        ma_lo: row.ma_lo || (row.lo_hang_id && row.lo_hang_id.ma_lo) || '',
        lo_hang_label: formatLotName(row),
        don_gia_von: donGiaVon,
        ten_ncc: tenNcc,
        gia_tri_kho: qty * donGiaVon
    });
}

async function loadMapsForKiemKho(khoId, rows, models) {
    const { HangHoa, TonKhoLo, TonKhoLoQuyCach, LoHang } = models;
    const hangIds = [...new Set(rows.map(row => String(row.hang_hoa_id?._id || row.hang_hoa_id || '')).filter(Boolean))];
    const lotIds = [...new Set(rows.map(row => String(row.lo_hang_id?._id || row.lo_hang_id || '')).filter(Boolean))];

    const [products, tonLoList, qcList, loList] = await Promise.all([
        hangIds.length
            ? HangHoa.find({ _id: { $in: hangIds } })
                .select('gia_von nha_cung_cap_id ma_hang ten_hang')
                .populate('nha_cung_cap_id', 'ten_ncc ma_ncc')
                .lean()
            : [],
        lotIds.length && khoId
            ? TonKhoLo.find({ kho_id: khoId, lo_hang_id: { $in: lotIds } }).lean()
            : [],
        lotIds.length && khoId
            ? TonKhoLoQuyCach.find({ kho_id: khoId, lo_hang_id: { $in: lotIds } }).lean()
            : [],
        lotIds.length
            ? LoHang.find({ _id: { $in: lotIds } })
                .select('gia_von nha_cung_cap_id ten_lo ma_lo han_su_dung')
                .populate('nha_cung_cap_id', 'ten_ncc ma_ncc')
                .lean()
            : []
    ]);

    return buildStockMaps({ products, tonLoList, qcList, loList });
}

async function enrichInventoryCheckPrintLines(khoId, lines, models) {
    const maps = await loadMapsForKiemKho(khoId, lines, models);
    return lines.map(row => {
        const product = row.hang_hoa_id || {};
        const flat = {
            hang_hoa_id: product._id || row.hang_hoa_id,
            lo_hang_id: row.lo_hang_id,
            ten_quy_cach: row.ten_quy_cach,
            ten_lo: row.lo_hang_id?.ten_lo,
            ma_lo: row.lo_hang_id?.ma_lo,
            ton_kho_he_thong: row.ton_kho_he_thong
        };
        const enriched = enrichKiemKhoLine(flat, maps);
        return {
            ma_hang: product.ma_hang || '',
            ten_hang: product.ten_hang || '',
            thuoc_tinh: row.ten_quy_cach || '',
            lo: formatLotName(row.lo_hang_id || flat),
            han_su_dung: row.lo_hang_id?.han_su_dung || null,
            so_luong_ton: Number(row.ton_kho_he_thong || 0),
            don_gia_von: enriched.don_gia_von,
            ten_ncc: enriched.ten_ncc,
            gia_tri_kho: enriched.gia_tri_kho
        };
    });
}

module.exports = {
    normalizeTenQuyCach,
    formatLotName,
    nccLabel,
    buildStockMaps,
    resolveDonGiaVon,
    resolveNccName,
    enrichKiemKhoLine,
    loadMapsForKiemKho,
    enrichInventoryCheckPrintLines
};
