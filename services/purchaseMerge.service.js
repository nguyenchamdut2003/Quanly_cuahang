const mongoose = require('mongoose');
const {
    PhieuNhap,
    CTPhieuNhap,
    PhieuTraHangNhap,
    PhieuThuChi,
    CongNoNhaCungCap,
    Counter,
    GopPhieuNhap
} = require('../models/kiot.model');

function uniqueObjectIds(values) {
    const seen = new Set();
    return (values || []).filter(value => {
        const key = String(value || '');
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function purchaseMergeLineKey(row = {}) {
    return [
        String(row.hang_hoa_id || ''),
        String(row.lo_hang_id || ''),
        String(row.gia_tri_thuoc_tinh_id || ''),
        Number(row.don_gia_nhap || 0),
        Number(row.giam_gia_dong || 0),
        String(row.kieu_giam_gia_dong || 'vnd')
    ].join('|');
}

function recalcPurchaseLineTotal(line) {
    const quantity = Math.max(0, Number(line.so_luong || 0));
    const unitPrice = Number(line.don_gia_nhap || 0);
    const discountType = line.kieu_giam_gia_dong === 'percent' ? 'percent' : 'vnd';
    const rawDiscount = Math.max(0, Number(line.giam_gia_dong || 0));
    const base = quantity * unitPrice;
    const discount = discountType === 'percent'
        ? base * Math.min(rawDiscount, 100) / 100
        : Math.min(rawDiscount, base);
    line.thanh_tien = Math.max(base - discount, 0);
    return line.thanh_tien;
}

function cloneMergedPurchaseLine(line, receivingPurchaseId) {
    const cloned = {
        phieu_nhap_id: receivingPurchaseId,
        hang_hoa_id: line.hang_hoa_id,
        lo_hang_id: line.lo_hang_id || null,
        gia_tri_thuoc_tinh_id: line.gia_tri_thuoc_tinh_id || null,
        don_vi_tinh_id: line.don_vi_tinh_id || null,
        so_luong: Number(line.so_luong || 0),
        don_gia_nhap: Number(line.don_gia_nhap || 0),
        giam_gia_dong: Number(line.giam_gia_dong || 0),
        kieu_giam_gia_dong: line.kieu_giam_gia_dong === 'percent' ? 'percent' : 'vnd',
        thanh_tien: 0,
        ghi_chu: String(line.ghi_chu || ''),
        lot_info: line.lot_info && typeof line.lot_info === 'object' ? JSON.parse(JSON.stringify(line.lot_info)) : line.lot_info
    };
    recalcPurchaseLineTotal(cloned);
    return cloned;
}

function applyPurchaseTotals(ticket, lines, paidAmount) {
    const goodsTotal = (lines || []).reduce((sum, line) => sum + Number(line.thanh_tien || 0), 0);
    const discountType = ticket.kieu_giam_gia === 'percent' ? 'percent' : 'vnd';
    const rawDiscount = Math.max(0, Number(ticket.giam_gia || 0));
    const discount = discountType === 'percent'
        ? goodsTotal * Math.min(rawDiscount, 100) / 100
        : Math.min(rawDiscount, goodsTotal);
    const payable = Math.max(goodsTotal - discount, 0);
    const paid = Math.max(0, Number(paidAmount || 0));
    ticket.tong_tien_hang = goodsTotal;
    ticket.tong_tien = payable;
    ticket.can_tra_ncc = payable;
    ticket.da_tra_ncc = paid;
    ticket.con_no_ncc = Math.max(0, payable - paid);
}

async function generateMergePurchaseCode(session = null) {
    const lastMerge = await GopPhieuNhap.findOne({ ma_gop_phieu_nhap: /^GPN\d+$/ })
        .sort({ ma_gop_phieu_nhap: -1 })
        .select('ma_gop_phieu_nhap')
        .session(session)
        .lean();
    const currentMax = Number(String(lastMerge?.ma_gop_phieu_nhap || '').replace(/^GPN/, '')) || 0;
    await Counter.updateOne(
        { _id: 'gop_phieu_nhap' },
        { $max: { seq: currentMax } },
        { upsert: true, session }
    );
    const counter = await Counter.findOneAndUpdate(
        { _id: 'gop_phieu_nhap' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, session }
    ).lean();
    return 'GPN' + String(counter.seq).padStart(6, '0');
}

async function reassignPurchasePaymentDocs(sourceIds, receivingId, session) {
    const sourceIdStrings = (sourceIds || []).map(id => String(id));
    if (!sourceIdStrings.length) return;

    await PhieuThuChi.updateMany(
        {
            phieu_nhap_id: { $in: sourceIds },
            trang_thai: { $ne: 'cancelled' }
        },
        { $set: { phieu_nhap_id: receivingId } },
        { session }
    );

    const receipts = await PhieuThuChi.find({
        $or: [
            { phieu_nhap_id: receivingId },
            { 'allocations.phieu_nhap_id': { $in: sourceIds } }
        ],
        trang_thai: { $ne: 'cancelled' }
    }).session(session);

    for (const receipt of receipts) {
        let changed = false;
        if (Array.isArray(receipt.allocations) && receipt.allocations.length) {
            receipt.allocations = receipt.allocations.map(alloc => {
                const allocPurchaseId = String(alloc?.phieu_nhap_id || '');
                if (sourceIdStrings.includes(allocPurchaseId)) {
                    changed = true;
                    return Object.assign({}, alloc, { phieu_nhap_id: receivingId });
                }
                return alloc;
            });
        }
        if (changed) {
            receipt.markModified('allocations');
            await receipt.save({ session });
        }
    }

    await CongNoNhaCungCap.updateMany(
        { phieu_nhap_id: { $in: sourceIds } },
        { $set: { phieu_nhap_id: receivingId } },
        { session }
    );

    // Sau remap: chỉ giữ 1 dòng tang_no / phiếu nhận (tránh lặp trên tab công nợ).
    const tangNoRows = await CongNoNhaCungCap.find({
        phieu_nhap_id: receivingId,
        loai: 'tang_no'
    }).sort({ created_at: 1, _id: 1 }).session(session).select('_id so_tien');

    if (tangNoRows.length > 1) {
        const keepId = tangNoRows[0]._id;
        const removeIds = tangNoRows.slice(1).map(row => row._id);
        const receivingPurchase = await PhieuNhap.findById(receivingId)
            .select('can_tra_ncc tong_tien')
            .session(session)
            .lean();
        const mergedAmount = Math.max(
            0,
            Number(receivingPurchase?.can_tra_ncc || receivingPurchase?.tong_tien || tangNoRows[0].so_tien || 0)
        );
        await CongNoNhaCungCap.updateOne(
            { _id: keepId },
            { $set: { so_tien: mergedAmount, phieu_nhap_id: receivingId } },
            { session }
        );
        await CongNoNhaCungCap.deleteMany(
            { _id: { $in: removeIds } },
            { session }
        );
    }
}

async function mergePurchasesInSession(req, session) {
    const body = req.body || {};
    const purchaseIds = uniqueObjectIds(Array.isArray(body.phieu_nhap_ids) ? body.phieu_nhap_ids : [])
        .map(id => String(id));
    if (purchaseIds.length < 2) {
        const error = new Error('Vui lòng chọn ít nhất 2 phiếu nhập để gộp.');
        error.status = 400;
        throw error;
    }

    const receivingPurchaseId = body.phieu_nhan_id && purchaseIds.includes(String(body.phieu_nhan_id))
        ? String(body.phieu_nhan_id)
        : purchaseIds[0];
    const sourcePurchaseIds = purchaseIds.filter(id => id !== receivingPurchaseId);
    const note = String(body.ghi_chu || '').trim();

    const purchases = await PhieuNhap.find({ _id: { $in: purchaseIds }, deleted_at: null })
        .populate('nha_cung_cap_id')
        .session(session);
    if (purchases.length !== purchaseIds.length) {
        const error = new Error('Một hoặc nhiều phiếu nhập không tồn tại.');
        error.status = 400;
        throw error;
    }

    const purchaseById = new Map(purchases.map(ticket => [String(ticket._id), ticket]));
    const receivingPurchase = purchaseById.get(receivingPurchaseId);
    const sourcePurchases = sourcePurchaseIds.map(id => purchaseById.get(id));

    const storeIds = new Set(purchases.map(ticket => String(ticket.cua_hang_id || '')).filter(Boolean));
    if (storeIds.size !== 1) {
        const error = new Error('Không thể gộp các phiếu nhập khác cửa hàng.');
        error.status = 400;
        throw error;
    }

    const warehouseIds = new Set(purchases.map(ticket => String(ticket.kho_id || '')).filter(Boolean));
    if (warehouseIds.size > 1) {
        const error = new Error('Không thể gộp các phiếu nhập khác kho trong phase này.');
        error.status = 400;
        throw error;
    }

    const supplierIds = new Set(purchases.map(ticket => String(ticket.nha_cung_cap_id?._id || ticket.nha_cung_cap_id || '')).filter(Boolean));
    if (supplierIds.size !== 1) {
        const error = new Error('Không thể gộp các phiếu nhập khác nhà cung cấp.');
        error.status = 400;
        throw error;
    }

    const returnRows = await PhieuTraHangNhap.find({
        phieu_nhap_id: { $in: purchaseIds },
        trang_thai: { $ne: 'cancelled' },
        deleted_at: null
    }).select('phieu_nhap_id').session(session).lean();
    const returnPurchaseIds = new Set(returnRows.map(row => String(row.phieu_nhap_id || '')));

    const details = await CTPhieuNhap.find({ phieu_nhap_id: { $in: purchaseIds } }).session(session);
    const detailMap = details.reduce((map, detail) => {
        const key = String(detail.phieu_nhap_id || '');
        if (!map[key]) map[key] = [];
        map[key].push(detail);
        return map;
    }, {});

    for (const ticket of purchases) {
        if (['cancelled', 'merged'].includes(String(ticket.trang_thai || ''))) {
            const message = ticket.trang_thai === 'merged'
                ? `Phiếu ${ticket.ma_phieu_nhap} đã được gộp vào ${ticket.merged_to_ma_phieu_nhap || 'phiếu khác'}.`
                : `Không thể gộp phiếu ${ticket.ma_phieu_nhap} ở trạng thái hiện tại.`;
            const error = new Error(message);
            error.status = 400;
            throw error;
        }
        if (!ticket.nha_cung_cap_id) {
            const error = new Error(`Phiếu ${ticket.ma_phieu_nhap} chưa có nhà cung cấp.`);
            error.status = 400;
            throw error;
        }
        if (returnPurchaseIds.has(String(ticket._id))) {
            const error = new Error(`Không thể gộp phiếu ${ticket.ma_phieu_nhap} vì đã phát sinh trả hàng nhập.`);
            error.status = 400;
            throw error;
        }
    }

    const allPaidBefore = purchases.reduce((sum, ticket) => sum + Number(ticket.da_tra_ncc || 0), 0);
    const allGoodsBefore = purchases.reduce((sum, ticket) => sum + Number(ticket.tong_tien_hang || ticket.tong_tien || 0), 0);

    const receivingLines = detailMap[receivingPurchaseId] || [];
    const receivingLineByKey = new Map(receivingLines.map(line => [purchaseMergeLineKey(line), line]));

    for (const sourcePurchase of sourcePurchases) {
        const sourceLines = detailMap[String(sourcePurchase._id)] || [];
        for (const sourceLine of sourceLines) {
            const key = purchaseMergeLineKey(sourceLine);
            const sourceQuantity = Number(sourceLine.so_luong || 0);
            const targetLine = receivingLineByKey.get(key);
            if (targetLine) {
                targetLine.so_luong = Number(targetLine.so_luong || 0) + sourceQuantity;
                recalcPurchaseLineTotal(targetLine);
                await targetLine.save({ session });
            } else {
                const clonedLine = await CTPhieuNhap.create([cloneMergedPurchaseLine(sourceLine, receivingPurchase._id)], { session });
                receivingLines.push(clonedLine[0]);
                receivingLineByKey.set(key, clonedLine[0]);
            }
        }
    }

    const updatedReceivingLines = await CTPhieuNhap.find({ phieu_nhap_id: receivingPurchase._id }).session(session);
    applyPurchaseTotals(receivingPurchase, updatedReceivingLines, allPaidBefore);
    receivingPurchase.is_merged_purchase = true;
    receivingPurchase.merged_from_phieu_nhap_ids = uniqueObjectIds([
        ...(receivingPurchase.merged_from_phieu_nhap_ids || []),
        ...sourcePurchases.map(ticket => ticket._id)
    ]);
    receivingPurchase.merged_from_ma_phieu_nhaps = Array.from(new Set([
        ...(receivingPurchase.merged_from_ma_phieu_nhaps || []),
        ...sourcePurchases.map(ticket => ticket.ma_phieu_nhap).filter(Boolean)
    ]));
    receivingPurchase.merged_at = new Date();
    receivingPurchase.merged_by = req.user?._id;
    receivingPurchase.merge_note = note;
    await receivingPurchase.save({ session });

    await PhieuNhap.updateMany(
        { _id: { $in: sourcePurchases.map(ticket => ticket._id) } },
        {
            $set: {
                trang_thai: 'merged',
                merged_to_phieu_nhap_id: receivingPurchase._id,
                merged_to_ma_phieu_nhap: receivingPurchase.ma_phieu_nhap,
                merged_at: receivingPurchase.merged_at,
                merged_by: req.user?._id,
                merge_note: note
            }
        },
        { session }
    );

    await reassignPurchasePaymentDocs(sourcePurchases.map(ticket => ticket._id), receivingPurchase._id, session);

    const maGopPhieu = await generateMergePurchaseCode(session);
    const mergeRecord = await GopPhieuNhap.create([{
        ma_gop_phieu_nhap: maGopPhieu,
        cua_hang_id: receivingPurchase.cua_hang_id,
        phieu_nhan_id: receivingPurchase._id,
        ma_phieu_nhan: receivingPurchase.ma_phieu_nhap,
        nha_cung_cap_id: receivingPurchase.nha_cung_cap_id?._id || receivingPurchase.nha_cung_cap_id || null,
        phieu_nguon_ids: sourcePurchases.map(ticket => ticket._id),
        ma_phieu_nguon: sourcePurchases.map(ticket => ticket.ma_phieu_nhap),
        tong_tien_hang_truoc_gop: allGoodsBefore,
        tong_da_tra_truoc_gop: allPaidBefore,
        tong_tien_hang_sau_gop: Number(receivingPurchase.tong_tien_hang || 0),
        tong_da_tra_sau_gop: Number(receivingPurchase.da_tra_ncc || 0),
        so_luong_phieu_gop: purchases.length,
        ghi_chu: note,
        trang_thai: 'active',
        nguoi_tao_id: req.user?._id,
        ngay_gop: receivingPurchase.merged_at
    }], { session });

    return {
        gop_phieu_nhap_id: mergeRecord[0]._id,
        ma_gop_phieu_nhap: mergeRecord[0].ma_gop_phieu_nhap,
        phieu_nhan_id: receivingPurchase._id,
        ma_phieu_nhan: receivingPurchase.ma_phieu_nhap,
        phieu_nguon_ids: sourcePurchases.map(ticket => ticket._id),
        ma_phieu_nguon: sourcePurchases.map(ticket => ticket.ma_phieu_nhap),
        tong_tien_hang_sau_gop: Number(receivingPurchase.tong_tien_hang || 0),
        tong_da_tra_sau_gop: Number(receivingPurchase.da_tra_ncc || 0)
    };
}

module.exports = {
    mergePurchasesInSession
};
