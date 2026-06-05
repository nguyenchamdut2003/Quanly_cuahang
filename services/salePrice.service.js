const mongoose = require('mongoose');
const {
    HangHoa,
    CTBangGia,
    BangGia,
    GiaBanHangHoa,
    LoHang,
    TonKhoLoQuyCach
} = require('../models/kiot.model');

function isValidObjectId(value) {
    return /^[0-9a-fA-F]{24}$/.test(String(value || '').trim());
}

function normalizeUnitPrice(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
}

function normalizeSpecLabel(value) {
    return String(value || '').trim();
}

function normalizeLoaiGiaBan(value) {
    const v = String(value || '').trim();
    return v === 'co_dinh' || v === 'thi_truong' ? v : '';
}

function emptyResolved(extra) {
    return Object.assign({
        gia_ban: 0,
        nguon_gia: 'none',
        gia_co_dinh: 0,
        gia_thi_truong: 0,
        loai_ap_dung: null,
        gia_mac_dinh: null,
        cho_phep_sua_gia: true,
        gia_ban_resolved_from: null
    }, extra || {});
}

function pickPriceFromGiaBanRow(row, loaiGiaBan) {
    if (!row) return { gia_ban: 0, gia_ban_resolved_from: null };
    const coDinh = normalizeUnitPrice(row.gia_co_dinh);
    const thiTruong = normalizeUnitPrice(row.gia_thi_truong);
    const loaiApDung = row.loai_ap_dung || 'co_dinh';
    const macDinh = row.gia_mac_dinh === 'thi_truong' ? 'thi_truong' : 'co_dinh';
    const requested = normalizeLoaiGiaBan(loaiGiaBan);

    if (loaiApDung === 'co_dinh') {
        return { gia_ban: coDinh, gia_ban_resolved_from: 'co_dinh' };
    }
    if (loaiApDung === 'thi_truong') {
        return { gia_ban: thiTruong, gia_ban_resolved_from: 'thi_truong' };
    }

    const pick = requested || macDinh;
    if (pick === 'thi_truong') {
        return { gia_ban: thiTruong, gia_ban_resolved_from: 'thi_truong' };
    }
    return { gia_ban: coDinh, gia_ban_resolved_from: 'co_dinh' };
}

function buildGiaBanMatchQuery(base) {
    const q = {
        hang_hoa_id: base.hang_hoa_id,
        trang_thai: 'active',
        bang_gia_id: base.bang_gia_id || null,
        lo_hang_id: base.lo_hang_id || null
    };

    const tenQc = normalizeSpecLabel(base.ten_quy_cach);
    if (base.gia_tri_thuoc_tinh_id && isValidObjectId(base.gia_tri_thuoc_tinh_id)) {
        q.gia_tri_thuoc_tinh_id = base.gia_tri_thuoc_tinh_id;
        q.ten_quy_cach = tenQc;
    } else if (tenQc) {
        q.gia_tri_thuoc_tinh_id = null;
        q.ten_quy_cach = tenQc;
    } else {
        q.gia_tri_thuoc_tinh_id = null;
        q.ten_quy_cach = '';
    }

    return q;
}

async function findGiaBanRow(criteria) {
    const q = buildGiaBanMatchQuery(criteria);
    return GiaBanHangHoa.findOne(q).sort({ updated_at: -1 }).lean();
}

function resolvedFromGiaBanRow(row, loaiGiaBan, level) {
    const picked = pickPriceFromGiaBanRow(row, loaiGiaBan);
    return emptyResolved({
        gia_ban: picked.gia_ban,
        nguon_gia: 'gia_ban_hang_hoa',
        gia_co_dinh: normalizeUnitPrice(row.gia_co_dinh),
        gia_thi_truong: normalizeUnitPrice(row.gia_thi_truong),
        loai_ap_dung: row.loai_ap_dung || 'co_dinh',
        gia_mac_dinh: row.gia_mac_dinh || 'co_dinh',
        cho_phep_sua_gia: row.cho_phep_sua_gia !== false,
        gia_ban_resolved_from: picked.gia_ban_resolved_from,
        gia_ban_hang_hoa_id: String(row._id),
        gia_ban_match_level: level
    });
}

async function resolveFromGiaBanHangHoa(opts) {
    const hangHoaId = opts.hang_hoa_id || opts.product?._id;
    if (!hangHoaId || !isValidObjectId(hangHoaId)) return null;

    const loaiGiaBan = normalizeLoaiGiaBan(opts.loai_gia_ban);
    const loHangId = isValidObjectId(opts.lo_hang_id) ? String(opts.lo_hang_id).trim() : null;
    const attrId = isValidObjectId(opts.gia_tri_thuoc_tinh_id)
        ? String(opts.gia_tri_thuoc_tinh_id).trim()
        : null;
    const tenQc = normalizeSpecLabel(opts.ten_quy_cach);
    const bangGiaId = isValidObjectId(opts.bang_gia_id) ? String(opts.bang_gia_id).trim() : null;
    const cuaHangId = isValidObjectId(opts.cua_hang_id) ? String(opts.cua_hang_id).trim() : null;

    const base = {
        hang_hoa_id: hangHoaId,
        cua_hang_id: cuaHangId,
        lo_hang_id: loHangId,
        gia_tri_thuoc_tinh_id: attrId,
        ten_quy_cach: tenQc
    };

    const attempts = [];

    if (bangGiaId) {
        if (loHangId && (attrId || tenQc)) {
            attempts.push({ level: 'bang_gia+lo+qc', bang_gia_id: bangGiaId, lo_hang_id: loHangId, gia_tri_thuoc_tinh_id: attrId, ten_quy_cach: tenQc });
        }
        if (loHangId) {
            attempts.push({ level: 'bang_gia+lo', bang_gia_id: bangGiaId, lo_hang_id: loHangId, gia_tri_thuoc_tinh_id: null, ten_quy_cach: '' });
        }
        if (attrId || tenQc) {
            attempts.push({ level: 'bang_gia+qc', bang_gia_id: bangGiaId, lo_hang_id: null, gia_tri_thuoc_tinh_id: attrId, ten_quy_cach: tenQc });
        }
        attempts.push({ level: 'bang_gia+hang', bang_gia_id: bangGiaId, lo_hang_id: null, gia_tri_thuoc_tinh_id: null, ten_quy_cach: '' });
    }

    if (loHangId && (attrId || tenQc)) {
        attempts.push({ level: 'lo+qc', bang_gia_id: null, lo_hang_id: loHangId, gia_tri_thuoc_tinh_id: attrId, ten_quy_cach: tenQc });
    }
    if (loHangId) {
        attempts.push({ level: 'lo', bang_gia_id: null, lo_hang_id: loHangId, gia_tri_thuoc_tinh_id: null, ten_quy_cach: '' });
    }
    if (attrId || tenQc) {
        attempts.push({ level: 'qc', bang_gia_id: null, lo_hang_id: null, gia_tri_thuoc_tinh_id: attrId, ten_quy_cach: tenQc });
    }

    for (const attempt of attempts) {
        const row = await findGiaBanRow(Object.assign({}, base, attempt));
        if (row) {
            return resolvedFromGiaBanRow(row, loaiGiaBan, attempt.level);
        }
    }

    return null;
}

/**
 * @param {object} opts
 * @returns {Promise<object>}
 */
async function resolveSalePrice(opts = {}) {
    const productId = opts.hang_hoa_id || opts.product?._id;
    if (!productId || !isValidObjectId(productId)) {
        return emptyResolved();
    }

    const loaiGiaBan = normalizeLoaiGiaBan(opts.loai_gia_ban);

    const fromGiaBan = await resolveFromGiaBanHangHoa(opts);
    if (fromGiaBan && fromGiaBan.gia_ban_hang_hoa_id) {
        return fromGiaBan;
    }

    let giaCoDinhProduct = 0;
    if (opts.product && opts.product.gia_co_dinh != null) {
        giaCoDinhProduct = normalizeUnitPrice(opts.product.gia_co_dinh);
    } else {
        const doc = await HangHoa.findById(productId).select('gia_co_dinh').lean();
        giaCoDinhProduct = normalizeUnitPrice(doc && doc.gia_co_dinh);
    }

    const bangGiaIds = [];
    if (isValidObjectId(opts.bang_gia_id)) {
        bangGiaIds.push(String(opts.bang_gia_id).trim());
    } else if (opts.tryActivePriceList) {
        const active = await BangGia.findOne({ trang_thai: 'active' })
            .sort({ created_at: -1 })
            .select('_id')
            .lean();
        if (active && active._id) bangGiaIds.push(String(active._id));
    }

    for (const bangGiaId of bangGiaIds) {
        const row = await CTBangGia.findOne({
            bang_gia_id: bangGiaId,
            hang_hoa_id: productId
        })
            .select('gia_ban')
            .lean();
        const giaBan = normalizeUnitPrice(row && row.gia_ban);
        if (giaBan > 0) {
            return emptyResolved({
                gia_ban: giaBan,
                nguon_gia: 'bang_gia',
                gia_co_dinh: giaCoDinhProduct,
                cho_phep_sua_gia: true,
                gia_ban_resolved_from: 'ct_bang_gia',
                bang_gia_id: bangGiaId
            });
        }
    }

    if (giaCoDinhProduct > 0) {
        return emptyResolved({
            gia_ban: giaCoDinhProduct,
            nguon_gia: 'gia_co_dinh',
            gia_co_dinh: giaCoDinhProduct,
            cho_phep_sua_gia: true,
            gia_ban_resolved_from: 'hang_hoa'
        });
    }

    if (fromGiaBan) return fromGiaBan;

    return emptyResolved({ gia_co_dinh: giaCoDinhProduct });
}

function makeGiaBanLookupKey(row) {
    return [
        String(row.hang_hoa_id || ''),
        String(row.bang_gia_id || ''),
        String(row.lo_hang_id || ''),
        String(row.gia_tri_thuoc_tinh_id || ''),
        normalizeSpecLabel(row.ten_quy_cach)
    ].join('::');
}

async function loadGiaBanMapForLines(lines, options) {
    const map = new Map();
    if (!lines.length) return map;

    const productIds = [...new Set(lines.map(l => String(l.hang_hoa_id)))].filter(isValidObjectId);
    if (!productIds.length) return map;

    const query = {
        hang_hoa_id: { $in: productIds },
        trang_thai: 'active'
    };
    const bangGiaId = options && options.bang_gia_id;
    if (bangGiaId) {
        query.$or = [{ bang_gia_id: bangGiaId }, { bang_gia_id: null }];
    }
    const storeId = options && options.cua_hang_id;
    if (storeId) {
        query.$and = query.$and || [];
        query.$and.push({
            $or: [
                { cua_hang_id: storeId },
                { cua_hang_id: null },
                { cua_hang_id: { $exists: false } }
            ]
        });
    }

    const rows = await GiaBanHangHoa.find(query).lean();
    rows.forEach(row => {
        map.set(makeGiaBanLookupKey(row), row);
    });
    return map;
}

function attachGiaBanToLine(line, giaBanMap, bangGiaId) {
    const keys = [
        makeGiaBanLookupKey({
            hang_hoa_id: line.hang_hoa_id,
            bang_gia_id: bangGiaId,
            lo_hang_id: line.lo_hang_id,
            gia_tri_thuoc_tinh_id: line.gia_tri_thuoc_tinh_id,
            ten_quy_cach: line.ten_quy_cach
        }),
        makeGiaBanLookupKey({
            hang_hoa_id: line.hang_hoa_id,
            bang_gia_id: bangGiaId,
            lo_hang_id: line.lo_hang_id,
            gia_tri_thuoc_tinh_id: null,
            ten_quy_cach: ''
        }),
        makeGiaBanLookupKey({
            hang_hoa_id: line.hang_hoa_id,
            bang_gia_id: null,
            lo_hang_id: line.lo_hang_id,
            gia_tri_thuoc_tinh_id: line.gia_tri_thuoc_tinh_id,
            ten_quy_cach: line.ten_quy_cach
        }),
        makeGiaBanLookupKey({
            hang_hoa_id: line.hang_hoa_id,
            bang_gia_id: null,
            lo_hang_id: null,
            gia_tri_thuoc_tinh_id: null,
            ten_quy_cach: ''
        })
    ];

    for (const key of keys) {
        if (giaBanMap.has(key)) {
            line.giaBan = giaBanMap.get(key);
            return;
        }
    }
    line.giaBan = null;
}

/**
 * Mở rộng danh sách hàng thành dòng thiết lập giá (lô / quy cách).
 */
async function buildPriceSetupLines(products, options) {
    const lines = [];
    if (!products || !products.length) return lines;

    const productIds = products.map(p => p._id);
    const lots = await LoHang.find({
        hang_hoa_id: { $in: productIds },
        trang_thai: { $ne: 'huy' }
    })
        .select('hang_hoa_id ma_lo ten_lo gia_von don_gia_nhap han_su_dung')
        .sort({ ngay_nhap: -1 })
        .lean();

    const qcRows = await TonKhoLoQuyCach.find({ hang_hoa_id: { $in: productIds } })
        .select('hang_hoa_id lo_hang_id ten_quy_cach ten_thuoc_tinh gia_von don_gia_nhap gia_tri_thuoc_tinh_id')
        .lean();

    const giaBanMap = await loadGiaBanMapForLines(
        products.map(p => ({ hang_hoa_id: p._id })),
        options
    );

    const bangGiaId = options && options.bang_gia_id ? String(options.bang_gia_id) : '';

    products.forEach(product => {
        const pid = String(product._id);
        const productLots = lots.filter(l => String(l.hang_hoa_id) === pid);

        const pushLine = (payload) => {
            const line = Object.assign({
                hang_hoa_id: product._id,
                ma_hang: product.ma_hang || '',
                ten_hang: product.ten_hang || '',
                gia_von: Number(product.gia_von || 0),
                gia_nhap_cuoi: Number(product.gia_nhap_cuoi || 0),
                ton_kho: Number(product.ton_kho || 0),
                nhom_hang_ten: product.nhom_hang_ten || '---',
                lo_hang_id: null,
                lo_label: '—',
                ten_quy_cach: '',
                gia_tri_thuoc_tinh_id: null,
                giaBan: null
            }, payload);
            attachGiaBanToLine(line, giaBanMap, bangGiaId);
            const gb = line.giaBan || {};
            line.gia_co_dinh = normalizeUnitPrice(gb.gia_co_dinh);
            line.gia_thi_truong = normalizeUnitPrice(gb.gia_thi_truong);
            line.loai_ap_dung = gb.loai_ap_dung || 'co_dinh';
            line.gia_mac_dinh = gb.gia_mac_dinh || 'co_dinh';
            line.cho_phep_sua_gia = gb.cho_phep_sua_gia !== false;
            line.gia_ban_row_id = gb._id ? String(gb._id) : '';
            lines.push(line);
        };

        if (!product.quan_ly_theo_lo || !productLots.length) {
            pushLine({
                row_kind: 'product',
                gia_von: Number(product.gia_von || 0)
            });
            return;
        }

        productLots.forEach(lot => {
            const lotId = String(lot._id);
            const lotLabel = String(lot.ten_lo || lot.ma_lo || lotId).trim() || '—';
            const lotQcs = qcRows.filter(q => String(q.lo_hang_id) === lotId);
            const seenQc = new Set();

            if (lotQcs.length) {
                lotQcs.forEach(qc => {
                    const label = normalizeSpecLabel(qc.ten_quy_cach || qc.ten_thuoc_tinh);
                    const dedupe = label || String(qc.gia_tri_thuoc_tinh_id || '');
                    if (seenQc.has(dedupe)) return;
                    seenQc.add(dedupe);
                    pushLine({
                        row_kind: 'lot_qc',
                        lo_hang_id: lot._id,
                        lo_label: lotLabel,
                        ten_quy_cach: label,
                        gia_tri_thuoc_tinh_id: qc.gia_tri_thuoc_tinh_id || null,
                        gia_von: Number(qc.gia_von || lot.gia_von || product.gia_von || 0)
                    });
                });
            } else {
                pushLine({
                    row_kind: 'lot',
                    lo_hang_id: lot._id,
                    lo_label: lotLabel,
                    gia_von: Number(lot.gia_von || product.gia_von || 0)
                });
            }
        });
    });

    return lines;
}

async function upsertGiaBanHangHoa(payload) {
    const hangHoaId = payload.hang_hoa_id;
    if (!isValidObjectId(hangHoaId)) {
        throw new Error('Mã hàng không hợp lệ.');
    }

    const filter = {
        hang_hoa_id: hangHoaId,
        lo_hang_id: isValidObjectId(payload.lo_hang_id) ? payload.lo_hang_id : null,
        gia_tri_thuoc_tinh_id: isValidObjectId(payload.gia_tri_thuoc_tinh_id)
            ? payload.gia_tri_thuoc_tinh_id
            : null,
        ten_quy_cach: normalizeSpecLabel(payload.ten_quy_cach),
        bang_gia_id: isValidObjectId(payload.bang_gia_id) ? payload.bang_gia_id : null,
        cua_hang_id: isValidObjectId(payload.cua_hang_id) ? payload.cua_hang_id : null
    };

    const loaiApDung = ['co_dinh', 'thi_truong', 'ca_hai'].includes(payload.loai_ap_dung)
        ? payload.loai_ap_dung
        : 'co_dinh';
    const giaMacDinh = payload.gia_mac_dinh === 'thi_truong' ? 'thi_truong' : 'co_dinh';

    const update = {
        hang_hoa_id: hangHoaId,
        lo_hang_id: filter.lo_hang_id,
        gia_tri_thuoc_tinh_id: filter.gia_tri_thuoc_tinh_id,
        ten_quy_cach: filter.ten_quy_cach,
        bang_gia_id: filter.bang_gia_id,
        cua_hang_id: filter.cua_hang_id,
        gia_co_dinh: normalizeUnitPrice(payload.gia_co_dinh),
        gia_thi_truong: normalizeUnitPrice(payload.gia_thi_truong),
        loai_ap_dung: loaiApDung,
        gia_mac_dinh: giaMacDinh,
        cho_phep_sua_gia: payload.cho_phep_sua_gia !== false && payload.cho_phep_sua_gia !== 'false',
        trang_thai: 'active'
    };

    const doc = await GiaBanHangHoa.findOneAndUpdate(filter, { $set: update }, {
        upsert: true,
        new: true,
        runValidators: true
    });

    return doc;
}

module.exports = {
    resolveSalePrice,
    resolveFromGiaBanHangHoa,
    buildPriceSetupLines,
    upsertGiaBanHangHoa,
    loadGiaBanMapForLines,
    pickPriceFromGiaBanRow,
    isValidObjectId,
    normalizeUnitPrice,
    normalizeSpecLabel
};
