const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const {
    PhieuNhap, CTPhieuNhap, HangHoa, NhaCungCap, CuaHang,
    HoaDonDauVao, PhieuTraHangNhap, CTPhieuTraHangNhap, NguoiDung,
    Kho, LoHang, TonKho, CongNoNhaCungCap
} = require('../models/kiot.model');
const { congTonKho } = require('../services/kho.service');
const { taoPhieuThuChi, ensureDefaultSoQuy } = require('../services/soQuy.service');

router.use(isAuthenticated);

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

function toAggregateObjectId(value) {
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.Types.ObjectId.isValid(String(value || '').trim())) return null;
    return new mongoose.Types.ObjectId(value);
}

async function calculateMovingAverageCost(productId, quantity, unitCost) {
    const hangHoaId = toAggregateObjectId(productId);
    const incomingQty = Number(quantity || 0);
    const incomingCost = Number(unitCost || 0);
    if (!hangHoaId || incomingQty <= 0) return Math.round(incomingCost);

    const [product, stockRows] = await Promise.all([
        HangHoa.findById(hangHoaId).select('gia_von').lean(),
        TonKho.aggregate([
            { $match: { hang_hoa_id: hangHoaId } },
            { $group: { _id: '$hang_hoa_id', total: { $sum: { $ifNull: ['$so_luong', 0] } } } }
        ])
    ]);

    const currentStock = Number(stockRows && stockRows[0] ? stockRows[0].total : 0);
    const currentCost = Number(product && product.gia_von ? product.gia_von : 0);
    const nextStock = currentStock + incomingQty;
    if (currentStock <= 0 || nextStock <= 0) return Math.round(incomingCost);

    return Math.round(((currentStock * currentCost) + (incomingQty * incomingCost)) / nextStock);
}

function normalizePaymentMethod(daTraNcc, conNoNcc, inputMethod) {
    if (inputMethod && String(inputMethod).trim() !== '') return String(inputMethod).trim();
    if (daTraNcc <= 0) return 'cong_no';
    if (conNoNcc > 0) return 'thanh_toan_mot_phan';
    return 'da_thanh_toan';
}

function safeLotCodeSegment(value) {
    return String(value || '').trim().replace(/\s+/g, '').replace(/[^A-Za-z0-9_-]/g, '');
}

function makePurchaseLotCode(purchaseCode, productCode) {
    const safePurchaseCode = safeLotCodeSegment(purchaseCode);
    const safeProductCode = safeLotCodeSegment(productCode);
    return safePurchaseCode && safeProductCode ? `LO-${safePurchaseCode}-${safeProductCode}` : '';
}

function formatLotName(dateValue) {
    const d = dateValue ? new Date(dateValue) : new Date();
    if (Number.isNaN(d.getTime())) return 'Lô';
    return 'Lô ' + d.toLocaleDateString('vi-VN');
}

async function buildPurchaseFilter(query = {}) {
    const filter = {};
    if (query.q && query.q.trim() !== '') {
        filter.ma_phieu_nhap = { $regex: query.q.trim(), $options: 'i' };
    }
    const statuses = Array.isArray(query.trang_thai) ? query.trang_thai : (query.trang_thai ? [query.trang_thai] : []);
    const cleanStatuses = statuses.filter(item => item && item !== 'all');
    if (cleanStatuses.length) filter.trang_thai = { $in: cleanStatuses };

    const dateFrom = query.date_from ? new Date(query.date_from + 'T00:00:00') : null;
    const dateTo = query.date_to ? new Date(query.date_to + 'T23:59:59') : null;
    if (dateFrom || dateTo || query.time_type === 'this_month') {
        filter.ngay_nhap = {};
        if (query.time_type === 'this_month') {
            const now = new Date();
            filter.ngay_nhap.$gte = new Date(now.getFullYear(), now.getMonth(), 1);
            filter.ngay_nhap.$lte = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        }
        if (dateFrom && !Number.isNaN(dateFrom.getTime())) filter.ngay_nhap.$gte = dateFrom;
        if (dateTo && !Number.isNaN(dateTo.getTime())) filter.ngay_nhap.$lte = dateTo;
    }
    if (query.nguoi_tao && /^[0-9a-fA-F]{24}$/.test(query.nguoi_tao)) {
        filter.nguoi_tao_id = query.nguoi_tao;
    } else if (query.nguoi_tao && query.nguoi_tao.trim() !== '') {
        const users = await NguoiDung.find({
            $or: [
                { ho_ten: { $regex: query.nguoi_tao.trim(), $options: 'i' } },
                { username: { $regex: query.nguoi_tao.trim(), $options: 'i' } },
                { email: { $regex: query.nguoi_tao.trim(), $options: 'i' } }
            ]
        }).select('_id');
        filter.nguoi_tao_id = { $in: users.map(user => user._id) };
    }
    if (query.nha_cung_cap && query.nha_cung_cap.trim() !== '') {
        const suppliers = await NhaCungCap.find({
            $or: [
                { ma_ncc: { $regex: query.nha_cung_cap.trim(), $options: 'i' } },
                { ten_ncc: { $regex: query.nha_cung_cap.trim(), $options: 'i' } },
                { sdt: { $regex: query.nha_cung_cap.trim(), $options: 'i' } }
            ]
        }).select('_id');
        filter.nha_cung_cap_id = { $in: suppliers.map(item => item._id) };
    }
    return filter;
}

router.get('/', async (req, res, next) => {
    try {
        const filter = await buildPurchaseFilter(req.query);

        const [list, users] = await Promise.all([
            PhieuNhap.find(filter)
                .populate('nha_cung_cap_id')
                .populate('cua_hang_id')
                .populate('nguoi_tao_id')
                .sort({ created_at: -1 }),
            NguoiDung.find().sort({ ho_ten: 1, username: 1 })
        ]);

        res.render('phieu-nhap/index', { title: 'Nhập hàng', tickets: list, users, filters: req.query || {} });
    } catch (error) {
        next(error);
    }
});

router.get('/export.csv', async (req, res, next) => {
    try {
        const tickets = await PhieuNhap.find(await buildPurchaseFilter(req.query))
            .populate('nha_cung_cap_id')
            .sort({ created_at: -1 });
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['ma_phieu_nhap', 'ngay_nhap', 'ma_ncc', 'nha_cung_cap', 'tong_tien', 'trang_thai'],
            ...tickets.map(t => [
                t.ma_phieu_nhap,
                t.ngay_nhap ? t.ngay_nhap.toISOString() : '',
                t.nha_cung_cap_id?.ma_ncc || '',
                t.nha_cung_cap_id?.ten_ncc || '',
                t.tong_tien || 0,
                t.trang_thai || ''
            ])
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="nhap-hang.csv"');
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
});

router.get('/hoa-don-dau-vao', async (req, res, next) => {
    try {
        const [docs, suppliers, receipts] = await Promise.all([
            HoaDonDauVao.find().populate('nha_cung_cap_id').populate('phieu_nhap_id').sort({ created_at: -1 }),
            NhaCungCap.find().sort({ ten_ncc: 1 }),
            PhieuNhap.find().sort({ created_at: -1 })
        ]);
        res.render('phieu-nhap/hoa-don-dau-vao', { title: 'Hóa đơn đầu vào', docs, suppliers, receipts });
    } catch (error) {
        next(error);
    }
});

router.post('/hoa-don-dau-vao/add', async (req, res, next) => {
    try {
        const { ma_hoa_don, ngay_hoa_don, nha_cung_cap_id, phieu_nhap_id, tong_tien, ghi_chu } = req.body || {};
        const count = await HoaDonDauVao.countDocuments();
        const code = ma_hoa_don && ma_hoa_don.trim() !== '' ? ma_hoa_don.trim() : 'HDV' + String(count + 1).padStart(6, '0');
        await HoaDonDauVao.create({
            ma_hoa_don: code,
            ngay_hoa_don: ngay_hoa_don || new Date(),
            nha_cung_cap_id: nha_cung_cap_id || null,
            phieu_nhap_id: phieu_nhap_id || null,
            tong_tien: Number(tong_tien) || 0,
            ghi_chu,
            nguoi_tao_id: req.user?._id,
            trang_thai: 'completed'
        });
        res.json({ success: true, message: 'Đã tạo hóa đơn đầu vào' });
    } catch (error) {
        next(error);
    }
});

router.get('/tra-hang-nhap', async (req, res, next) => {
    try {
        const [returns, suppliers, receipts, products] = await Promise.all([
            PhieuTraHangNhap.find().populate('nha_cung_cap_id').populate('phieu_nhap_id').sort({ created_at: -1 }),
            NhaCungCap.find().sort({ ten_ncc: 1 }),
            PhieuNhap.find().sort({ created_at: -1 }),
            HangHoa.find().sort({ ten_hang: 1 })
        ]);
        res.render('phieu-nhap/tra-hang-nhap', { title: 'Trả hàng nhập', returns, suppliers, receipts, products });
    } catch (error) {
        next(error);
    }
});

router.post('/tra-hang-nhap/add', async (req, res, next) => {
    try {
        const { nha_cung_cap_id, phieu_nhap_id, ly_do, ghi_chu, items } = req.body || {};
        if (!Array.isArray(items) || !items.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn hàng trả' });
        }
        let total = 0;
        items.forEach(item => { total += Number(item.so_luong) * Number(item.don_gia); });
        const sourcePurchase = phieu_nhap_id ? await PhieuNhap.findById(phieu_nhap_id).select('cua_hang_id').lean() : null;
        const count = await PhieuTraHangNhap.countDocuments();
        const ret = await PhieuTraHangNhap.create({
            ma_phieu_tra_nhap: 'THN' + String(count + 1).padStart(6, '0'),
            ngay_tra: new Date(),
            nha_cung_cap_id,
            phieu_nhap_id: phieu_nhap_id || null,
            cua_hang_id: sourcePurchase?.cua_hang_id,
            tong_tien_tra: total,
            ly_do,
            ghi_chu,
            nguoi_tao_id: req.user?._id,
            trang_thai: 'completed'
        });
        for (const item of items) {
            await CTPhieuTraHangNhap.create({
                phieu_tra_nhap_id: ret._id,
                hang_hoa_id: item.hang_hoa_id,
                so_luong: Number(item.so_luong),
                don_gia: Number(item.don_gia),
                thanh_tien: Number(item.so_luong) * Number(item.don_gia)
            });
            await HangHoa.findByIdAndUpdate(item.hang_hoa_id, { $inc: { ton_kho: -Number(item.so_luong) } });
        }
        if (nha_cung_cap_id) {
            await NhaCungCap.findByIdAndUpdate(nha_cung_cap_id, { $inc: { tong_no: -total } });
            await CongNoNhaCungCap.create({
                cua_hang_id: ret.cua_hang_id || undefined,
                nha_cung_cap_id,
                phieu_nhap_id: phieu_nhap_id || undefined,
                phieu_tra_nhap_id: ret._id,
                so_tien: total,
                loai: 'giam_no',
                ghi_chu: `Trả hàng nhập ${ret.ma_phieu_tra_nhap}`,
                ngay: ret.ngay_tra || new Date()
            });
        }
        res.json({ success: true, message: 'Đã tạo phiếu trả hàng nhập' });
    } catch (error) {
        next(error);
    }
});

router.get('/create', async (req, res, next) => {
    try {
        const [suppliers, stores, products] = await Promise.all([
            NhaCungCap.find().sort({ ten_ncc: 1 }),
            CuaHang.find().sort({ ten_cua_hang: 1 }),
            HangHoa.find().sort({ ten_hang: 1 })
        ]);
        res.render('phieu-nhap/create', { title: 'Nhập hàng', suppliers, stores, products });
    } catch (error) {
        next(error);
    }
});

router.get('/:id/detail', async (req, res, next) => {
    try {
        const ticket = await PhieuNhap.findById(req.params.id)
            .populate('nha_cung_cap_id')
            .populate('cua_hang_id');
        if (!ticket) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập' });
        const items = await CTPhieuNhap.find({ phieu_nhap_id: ticket._id }).populate('hang_hoa_id');
        res.json({ success: true, data: { ticket, items } });
    } catch (error) {
        next(error);
    }
});

async function completeTicket(ticket) {
    const items = await CTPhieuNhap.find({ phieu_nhap_id: ticket._id });
    for (const item of items) {
        await HangHoa.findByIdAndUpdate(item.hang_hoa_id, { $inc: { ton_kho: Number(item.so_luong) || 0 } });
    }
    ticket.trang_thai = 'completed';
    await ticket.save();
    if (ticket.nha_cung_cap_id) {
        const canTra = Number(ticket.can_tra_ncc || ticket.tong_tien || 0);
        const conNo = Number(ticket.con_no_ncc || canTra || 0);
        await NhaCungCap.findByIdAndUpdate(ticket.nha_cung_cap_id, {
            $inc: { tong_mua: canTra, tong_no: conNo }
        });
        if (canTra > 0) {
            await CongNoNhaCungCap.create({
                cua_hang_id: ticket.cua_hang_id,
                nha_cung_cap_id: ticket.nha_cung_cap_id,
                phieu_nhap_id: ticket._id,
                so_tien: canTra,
                loai: 'tang_no',
                ghi_chu: `Cong no phieu nhap ${ticket.ma_phieu_nhap}`,
                ngay: ticket.ngay_nhap || new Date()
            });
        }
        const paid = Math.max(0, canTra - conNo);
        if (paid > 0) {
            await CongNoNhaCungCap.create({
                cua_hang_id: ticket.cua_hang_id,
                nha_cung_cap_id: ticket.nha_cung_cap_id,
                phieu_nhap_id: ticket._id,
                so_tien: paid,
                loai: 'thanh_toan',
                ghi_chu: `Thanh toan NCC tu phieu nhap ${ticket.ma_phieu_nhap}`,
                ngay: ticket.ngay_nhap || new Date()
            });
        }
    }
}

router.post('/:id/complete', async (req, res, next) => {
    try {
        const ticket = await PhieuNhap.findById(req.params.id);
        if (!ticket) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập' });
        if (ticket.trang_thai !== 'completed') await completeTicket(ticket);
        res.json({ success: true, message: 'Đã hoàn thành phiếu nhập' });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/cancel', async (req, res, next) => {
    try {
        const ticket = await PhieuNhap.findById(req.params.id);
        if (!ticket) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập' });
        ticket.trang_thai = 'cancelled';
        await ticket.save();
        res.json({ success: true, message: 'Đã hủy phiếu nhập' });
    } catch (error) {
        next(error);
    }
});

router.post('/add', async (req, res, next) => {
    try {
        const {
            nha_cung_cap_id,
            cua_hang_id,
            kho_id,
            ngay_nhap,
            ghi_chu,
            trang_thai,
            ma_phieu_nhap: inputCode,
            giam_gia,
            tong_tien: inputTongTien,
            da_tra_ncc: inputDaTraNcc,
            phuong_thuc_thanh_toan
        } = req.body || {};
        const items = parseItems(req.body?.items);

        if (!items.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất 1 hàng hóa' });
        }

        if (!kho_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho.' });
        }

        const kho = await Kho.findById(kho_id);
        if (!kho) {
            return res.status(400).json({ success: false, message: 'Kho nhập hàng không hợp lệ' });
        }

        if (nha_cung_cap_id) {
            const supplier = await NhaCungCap.findById(nha_cung_cap_id);
            if (!supplier) {
                return res.status(400).json({ success: false, message: 'Nhà cung cấp không hợp lệ' });
            }
        }

        let tong_tien_hang = 0;
        const normalizedItems = [];
        for (const item of items) {
            if (!item.hang_hoa_id) {
                return res.status(400).json({ success: false, message: 'Dong hang thieu hang_hoa_id' });
            }

            const so_luong = Number(item.so_luong);
            const don_gia_nhap = Number(item.don_gia_nhap);
            if (!Number.isFinite(so_luong) || so_luong <= 0) {
                return res.status(400).json({ success: false, message: 'Số lượng nhập phải lớn hơn 0' });
            }

            if (!Number.isFinite(don_gia_nhap) || don_gia_nhap < 0) {
                return res.status(400).json({ success: false, message: 'Đơn giá nhập không hợp lệ' });
            }

            const product = await HangHoa.findById(item.hang_hoa_id);
            if (!product) {
                return res.status(400).json({ success: false, message: 'Hàng hóa không hợp lệ' });
            }

            const thanh_tien = so_luong * don_gia_nhap;
            tong_tien_hang += thanh_tien;
            normalizedItems.push({
                product,
                hang_hoa_id: product._id,
                lo_hang_id: item.lo_hang_id || null,
                so_luong,
                don_gia_nhap,
                thanh_tien,
                ghi_chu_lo: item.ghi_chu_lo
            });
        }

        const discount = Number(giam_gia) || 0;
        const calculatedTotal = Math.max(tong_tien_hang - discount, 0);
        const tong_tien = inputTongTien != null && inputTongTien !== ''
            ? Number(inputTongTien) || calculatedTotal
            : calculatedTotal;
        const da_tra_ncc = Math.max(Number(inputDaTraNcc) || 0, 0);
        const can_tra_ncc = tong_tien;
        const con_no_ncc = Math.max(can_tra_ncc - da_tra_ncc, 0);
        const paymentMethod = normalizePaymentMethod(da_tra_ncc, con_no_ncc, phuong_thuc_thanh_toan);

        const count = await PhieuNhap.countDocuments();
        const ma_phieu_nhap = inputCode && inputCode.trim() !== '' ? inputCode.trim() : 'PN' + String(count + 1).padStart(6, '0');
        const phieu = await PhieuNhap.create({
            ma_phieu_nhap,
            ngay_nhap: ngay_nhap || new Date(),
            nha_cung_cap_id: nha_cung_cap_id || null,
            cua_hang_id: cua_hang_id || kho.cua_hang_id,
            chi_nhanh_id: kho.chi_nhanh_id,
            kho_id: kho._id,
            nguoi_tao_id: req.user?._id,
            tong_tien_hang,
            giam_gia: discount,
            tong_tien,
            can_tra_ncc,
            da_tra_ncc,
            con_no_ncc,
            phuong_thuc_thanh_toan: paymentMethod,
            trang_thai: trang_thai === 'draft' ? 'draft' : 'completed',
            ghi_chu
        });

        const lotCache = new Map();
        for (const item of normalizedItems) {
            let loHangId = item.lo_hang_id;
            if (!loHangId && item.product.quan_ly_theo_lo) {
                const maLo = makePurchaseLotCode(ma_phieu_nhap, item.product.ma_hang);
                if (!maLo) return res.status(400).json({ success: false, message: 'Không thể sinh mã lô từ phiếu nhập và hàng hóa' });
                if (lotCache.has(maLo)) {
                    loHangId = lotCache.get(maLo);
                    await LoHang.updateOne(
                        { _id: loHangId },
                        { $inc: { so_luong_ban_dau: item.so_luong }, $set: { gia_von: item.don_gia_nhap } }
                    );
                } else {
                    const existingLot = await LoHang.findOne({
                        ma_lo: maLo,
                        hang_hoa_id: item.hang_hoa_id,
                        phieu_nhap_id: phieu._id,
                        trang_thai: { $ne: 'huy' }
                    });
                    if (existingLot) {
                        loHangId = existingLot._id;
                        await LoHang.updateOne(
                            { _id: loHangId },
                            { $inc: { so_luong_ban_dau: item.so_luong }, $set: { gia_von: item.don_gia_nhap } }
                        );
                    } else {
                        const lot = await LoHang.create({
                            cua_hang_id: cua_hang_id || kho.cua_hang_id,
                            ma_lo: maLo,
                            ten_lo: formatLotName(ngay_nhap || new Date()),
                            ngay_nhap: ngay_nhap || new Date(),
                            hang_hoa_id: item.hang_hoa_id,
                            nha_cung_cap_id: nha_cung_cap_id || item.product.nha_cung_cap_id,
                            phieu_nhap_id: phieu._id,
                            dia_chi_vuon_id: item.product.dia_chi_vuon_id,
                            kho_id: kho._id,
                            so_luong_ban_dau: item.so_luong,
                            so_luong_con_lai: 0,
                            gia_von: item.don_gia_nhap,
                            trang_thai: 'active',
                            ghi_chu: item.ghi_chu_lo || `Tao tu phieu nhap ${ma_phieu_nhap}`
                        });
                        loHangId = lot._id;
                    }
                    lotCache.set(maLo, loHangId);
                }
            }

            await CTPhieuNhap.create({
                phieu_nhap_id: phieu._id,
                hang_hoa_id: item.hang_hoa_id,
                lo_hang_id: loHangId,
                so_luong: item.so_luong,
                don_gia_nhap: item.don_gia_nhap,
                thanh_tien: item.thanh_tien
            });

            if (phieu.trang_thai === 'completed') {
                const newProductCost = await calculateMovingAverageCost(
                    item.hang_hoa_id,
                    item.so_luong,
                    item.don_gia_nhap
                );
                await congTonKho({
                    kho_id: kho._id,
                    hang_hoa_id: item.hang_hoa_id,
                    lo_hang_id: loHangId,
                    so_luong: item.so_luong,
                    gia_von: item.don_gia_nhap,
                    nguoi_tao_id: req.user?._id,
                    loai_phieu: 'nhap_hang',
                    ma_phieu: ma_phieu_nhap,
                    ghi_chu: ghi_chu || 'Nhap hang'
                });

                await HangHoa.findByIdAndUpdate(item.hang_hoa_id, {
                    $inc: { ton_kho: item.so_luong },
                    $set: { gia_nhap_cuoi: item.don_gia_nhap, gia_von: newProductCost }
                });
            }
        }

        if (phieu.trang_thai === 'completed' && nha_cung_cap_id) {
            await NhaCungCap.findByIdAndUpdate(nha_cung_cap_id, {
                $inc: { tong_mua: can_tra_ncc, tong_no: can_tra_ncc }
            });

            if (can_tra_ncc > 0) {
                await CongNoNhaCungCap.create({
                    cua_hang_id: phieu.cua_hang_id,
                    nha_cung_cap_id,
                    phieu_nhap_id: phieu._id,
                    so_tien: can_tra_ncc,
                    loai: 'tang_no',
                    ghi_chu: `Cong no phieu nhap ${ma_phieu_nhap}`,
                    ngay: new Date()
                });
            }

            if (da_tra_ncc > 0) {
                const cashBook = await ensureDefaultSoQuy(phieu.cua_hang_id);
                await taoPhieuThuChi({
                    loai_phieu: 'chi',
                    loai_thu_chi: 'Chi tra nha cung cap',
                    gia_tri: da_tra_ncc,
                    so_quy_id: cashBook._id,
                    cua_hang_id: phieu.cua_hang_id,
                    nguoi_tao_id: req.user?._id,
                    nha_cung_cap_id,
                    phieu_nhap_id: phieu._id,
                    ma_chung_tu_goc: ma_phieu_nhap,
                    nhom_doi_tuong: 'nha_cung_cap',
                    phuong_thuc_thanh_toan: ['tien_mat', 'chuyen_khoan', 'vi_dien_tu', 'khac'].includes(phuong_thuc_thanh_toan) ? phuong_thuc_thanh_toan : 'tien_mat',
                    hach_toan: true
                });
            }
        }

        return res.json({ success: true, message: 'Nhập hàng thành công', ma_phieu_nhap, phieu_id: phieu._id });
    } catch (error) {
        return next(error);
    }
});

router.post('/add-old', async (req, res, next) => {
    try {
        const { nha_cung_cap_id, cua_hang_id, ngay_nhap, ghi_chu, items, trang_thai, ma_phieu_nhap: inputCode, giam_gia } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất 1 hàng hóa' });
        }

        let tong_tien_hang = 0;
        items.forEach(item => {
            tong_tien_hang += Number(item.so_luong) * Number(item.don_gia_nhap);
        });
        const discount = Number(giam_gia) || 0;
        const tong_tien = Math.max(tong_tien_hang - discount, 0);

        const count = await PhieuNhap.countDocuments();
        const ma_phieu_nhap = inputCode && inputCode.trim() !== '' ? inputCode.trim() : 'PN' + String(count + 1).padStart(6, '0');

        const phieu = await PhieuNhap.create({
            ma_phieu_nhap,
            ngay_nhap: ngay_nhap || new Date(),
            nha_cung_cap_id,
            cua_hang_id,
            nguoi_tao_id: req.user?._id,
            tong_tien,
            trang_thai: trang_thai === 'draft' ? 'draft' : 'completed',
            ghi_chu
        });

        for (const item of items) {
            await CTPhieuNhap.create({
                phieu_nhap_id: phieu._id,
                hang_hoa_id: item.hang_hoa_id,
                so_luong: Number(item.so_luong),
                don_gia_nhap: Number(item.don_gia_nhap),
                thanh_tien: Number(item.so_luong) * Number(item.don_gia_nhap)
            });

            if (phieu.trang_thai === 'completed') {
                await HangHoa.findByIdAndUpdate(item.hang_hoa_id, {
                    $inc: { ton_kho: Number(item.so_luong) }
                });
            }
        }

        if (phieu.trang_thai === 'completed' && nha_cung_cap_id) {
            await NhaCungCap.findByIdAndUpdate(nha_cung_cap_id, {
                $inc: { tong_mua: tong_tien, tong_no: tong_tien }
            });
            await CongNoNhaCungCap.create({
                cua_hang_id: phieu.cua_hang_id,
                nha_cung_cap_id,
                phieu_nhap_id: phieu._id,
                so_tien: tong_tien,
                loai: 'tang_no',
                ghi_chu: `Cong no phieu nhap ${ma_phieu_nhap}`,
                ngay: phieu.ngay_nhap || new Date()
            });
        }

        res.json({ success: true, message: 'Nhập hàng thành công', ma_phieu_nhap });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
