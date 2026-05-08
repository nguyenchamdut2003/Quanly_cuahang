const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const {
    PhieuKiemKho,
    CTPhieuKiemKho,
    HangHoa,
    CuaHang,
    NguoiDung,
    Kho,
    TonKho,
    TonKhoLo
} = require('../models/kiot.model');
const { congTonKho, truTonKho } = require('../services/kho.service');

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

router.get('/', async (req, res, next) => {
    try {
        const filter = {};
        const q = String(req.query.q || '').trim();
        const dateMode = req.query.date_mode || 'this_month';
        const statuses = Array.isArray(req.query.trang_thai)
            ? req.query.trang_thai
            : (req.query.trang_thai ? [req.query.trang_thai] : ['pending', 'completed']);

        if (q) {
            filter.ma_kiem_kho = { $regex: q, $options: 'i' };
        }

        if (statuses.length) {
            filter.trang_thai = { $in: statuses };
        }

        if (req.query.nguoi_tao_id) {
            filter.nguoi_tao_id = req.query.nguoi_tao_id;
        }

        const now = new Date();
        if (dateMode === 'this_month') {
            filter.created_at = {
                $gte: new Date(now.getFullYear(), now.getMonth(), 1),
                $lt: new Date(now.getFullYear(), now.getMonth() + 1, 1)
            };
        } else if (dateMode === 'custom' && (req.query.from_date || req.query.to_date)) {
            filter.created_at = {};
            if (req.query.from_date) filter.created_at.$gte = new Date(req.query.from_date);
            if (req.query.to_date) {
                const toDate = new Date(req.query.to_date);
                toDate.setDate(toDate.getDate() + 1);
                filter.created_at.$lt = toDate;
            }
        }

        const pageSize = Math.min(Math.max(Number(req.query.page_size || 15), 1), 100);
        const [list, users] = await Promise.all([
            PhieuKiemKho.find(filter)
                .populate('cua_hang_id')
                .populate('kho_id')
                .populate('nguoi_tao_id')
                .sort({ created_at: -1 })
                .limit(pageSize),
            NguoiDung.find().sort({ ho_ten: 1, username: 1 })
        ]);

        const ticketIds = list.map(item => item._id);
        const details = ticketIds.length
            ? await CTPhieuKiemKho.find({ phieu_kiem_kho_id: { $in: ticketIds } })
                .populate('hang_hoa_id')
                .populate('lo_hang_id')
            : [];
        const detailMap = details.reduce((acc, item) => {
            const key = String(item.phieu_kiem_kho_id);
            if (!acc[key]) acc[key] = { positive: 0, negative: 0, actual: 0, value: 0, items: [] };
            const diff = Number(item.so_luong_lech || 0);
            if (diff > 0) acc[key].positive += diff;
            if (diff < 0) acc[key].negative += Math.abs(diff);
            acc[key].actual += Number(item.so_luong_thuc_te || 0);
            acc[key].value += Number(item.gia_tri_lech || 0);
            acc[key].items.push(item.toObject());
            return acc;
        }, {});

        const tickets = list.map(item => {
            const obj = item.toObject();
            obj.summary = detailMap[String(item._id)] || { positive: 0, negative: 0, actual: 0, value: 0, items: [] };
            return obj;
        });

        res.render('kiem-kho/index', {
            title: 'Phiếu kiểm kho',
            tickets,
            users,
            filters: {
                q,
                date_mode: dateMode,
                from_date: req.query.from_date || '',
                to_date: req.query.to_date || '',
                trang_thai: statuses,
                nguoi_tao_id: req.query.nguoi_tao_id || '',
                page_size: req.query.page_size || '15'
            }
        });
    } catch (error) {
        next(error);
    }
});

router.get('/create', async (req, res, next) => {
    try {
        const [stores, warehouses, products] = await Promise.all([
            CuaHang.find(),
            Kho.find({ trang_thai: 'active' }).sort({ ten_kho: 1 }),
            HangHoa.find()
        ]);
        res.render('kiem-kho/create', { title: 'Kiem kho moi', user: req.user, stores, warehouses, products });
    } catch (error) {
        next(error);
    }
});

async function saveKiemKho(req, res, next) {
    try {
        const { cua_hang_id, kho_id, ghi_chu } = req.body || {};
        const items = parseItems(req.body?.items);

        if (!kho_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho.' });
        }

        const kho = await Kho.findById(kho_id);
        if (!kho) {
            return res.status(400).json({ success: false, message: 'Kho kiem khong hop le' });
        }

        if (!items.length) {
            return res.status(400).json({ success: false, message: 'Chua chon hang hoa kiem kho' });
        }

        const ma_kiem_kho = 'KK' + Date.now();
        const phieu = await PhieuKiemKho.create({
            ma_kiem_kho,
            cua_hang_id: cua_hang_id || kho.cua_hang_id,
            chi_nhanh_id: kho.chi_nhanh_id,
            kho_id: kho._id,
            nguoi_tao_id: req.user?._id,
            ghi_chu,
            trang_thai: 'completed'
        });

        let tongThucTe = 0;
        let tongLech = 0;
        let tongGiaTriLech = 0;

        for (const item of items) {
            const actualQuantity = Number(item.so_luong_thuc_te);
            if (!item.hang_hoa_id || !Number.isFinite(actualQuantity) || actualQuantity < 0) {
                return res.status(400).json({ success: false, message: 'Du lieu kiem kho khong hop le' });
            }

            const product = await HangHoa.findById(item.hang_hoa_id);
            if (!product) {
                return res.status(400).json({ success: false, message: 'Hang hoa khong hop le' });
            }
            if (product.quan_ly_theo_lo && !item.lo_hang_id) {
                return res.status(400).json({ success: false, message: 'Hang quan ly theo lo phai co lo hang' });
            }

            const stock = item.lo_hang_id
                ? await TonKhoLo.findOne({ kho_id: kho._id, hang_hoa_id: item.hang_hoa_id, lo_hang_id: item.lo_hang_id })
                : await TonKho.findOne({ kho_id: kho._id, hang_hoa_id: item.hang_hoa_id });
            const systemQuantity = Number(stock?.so_luong || 0);
            const difference = actualQuantity - systemQuantity;

            const cost = Number(product.gia_von) || 0;
            const differenceValue = difference * cost;
            tongThucTe += actualQuantity;
            tongLech += difference;
            tongGiaTriLech += differenceValue;

            await CTPhieuKiemKho.create({
                phieu_kiem_kho_id: phieu._id,
                hang_hoa_id: item.hang_hoa_id,
                lo_hang_id: item.lo_hang_id || null,
                ton_kho_he_thong: systemQuantity,
                so_luong_thuc_te: actualQuantity,
                so_luong_lech: difference,
                gia_tri_lech: differenceValue,
                nguyen_nhan_lech: item.nguyen_nhan_lech || ''
            });

            if (difference > 0) {
                await congTonKho({
                    kho_id: kho._id,
                    hang_hoa_id: item.hang_hoa_id,
                    lo_hang_id: item.lo_hang_id,
                    so_luong: difference,
                    gia_von: cost,
                    nguoi_tao_id: req.user?._id,
                    loai_phieu: 'kiem_kho',
                    ma_phieu: ma_kiem_kho,
                    ghi_chu: item.nguyen_nhan_lech || ghi_chu
                });
            } else if (difference < 0) {
                try {
                    await truTonKho({
                        kho_id: kho._id,
                        hang_hoa_id: item.hang_hoa_id,
                        lo_hang_id: item.lo_hang_id,
                        so_luong: Math.abs(difference),
                        nguoi_tao_id: req.user?._id,
                        loai_phieu: 'kiem_kho',
                        ma_phieu: ma_kiem_kho,
                        ghi_chu: item.nguyen_nhan_lech || ghi_chu
                    });
                } catch (_) {
                    return res.status(400).json({ success: false, message: 'Khong du ton kho de dieu chinh kiem kho' });
                }
            }
        }

        phieu.tong_so_luong_thuc_te = tongThucTe;
        phieu.tong_so_luong_lech = tongLech;
        phieu.tong_gia_tri_lech = tongGiaTriLech;
        await phieu.save();

        return res.json({ success: true, message: 'Hoan thanh kiem kho', ma_kiem_kho });
    } catch (error) {
        next(error);
    }
}

router.post('/', saveKiemKho);
router.post('/add', saveKiemKho);

module.exports = router;
