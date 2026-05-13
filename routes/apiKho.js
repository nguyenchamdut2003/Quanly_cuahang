const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const {
    Kho,
    HangHoa,
    TonKho,
    TonKhoLo,
    LoHang,
    DiaChiDoiTuong,
    DiaChiKhachHang,
    DiaChiNcc,
    PhanBoHang,
    CTPhanBoHang,
    PhieuNhap,
    DonHang,
    CTDonHang,
    BangGia,
    CTBangGia,
    HoaDonBanHang,
    PhieuTraHang,
    PhieuKiemKho,
    PhieuXuatNoiBo,
    PhieuXuatHuy
} = require('../models/kiot.model');
const { layTonKhoTheoKho, layTonKhoTheoLo } = require('../services/kho.service');
const { tinhPhiGiaoHang } = require('../services/phiGiaoHang.service');

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

function scopedBody(body = {}) {
    const data = { ...body };
    delete data._id;
    delete data.created_at;
    delete data.updated_at;
    return data;
}

router.post('/giao-hang/tinh-phi', async (req, res) => {
    try {
        if (!req.body.khach_hang_id || !req.body.dia_chi_khach_hang_id || !req.body.doi_tac_giao_hang_id) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng chọn đủ khách hàng, địa chỉ nhận hàng và đối tác giao hàng'
            });
        }
        const result = await tinhPhiGiaoHang({
            cua_hang_id: req.body.cua_hang_id,
            khach_hang_id: req.body.khach_hang_id,
            dia_chi_khach_hang_id: req.body.dia_chi_khach_hang_id,
            doi_tac_giao_hang_id: req.body.doi_tac_giao_hang_id,
            diem_di: req.body.diem_di,
            diem_den: req.body.diem_den,
            khoang_cach_km: req.body.khoang_cach_km
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Không tính được phí giao hàng' });
    }
});

async function khoHasActivity(khoId) {
    const [stockCount, docCount] = await Promise.all([
        TonKho.countDocuments({ kho_id: khoId, so_luong: { $ne: 0 } }),
        Promise.all([
            PhieuNhap.exists({ kho_id: khoId }),
            DonHang.exists({ kho_id: khoId }),
            HoaDonBanHang.exists({ kho_id: khoId }),
            PhieuTraHang.exists({ kho_id: khoId }),
            PhieuKiemKho.exists({ kho_id: khoId }),
            PhieuXuatNoiBo.exists({ kho_id: khoId }),
            PhieuXuatHuy.exists({ kho_id: khoId })
        ]).then(results => results.filter(Boolean).length)
    ]);

    return stockCount > 0 || docCount > 0;
}

router.get('/kho', async (req, res, next) => {
    try {
        const filter = {};
        if (req.query.cua_hang_id) filter.cua_hang_id = req.query.cua_hang_id;
        if (req.query.chi_nhanh_id) filter.chi_nhanh_id = req.query.chi_nhanh_id;
        filter.trang_thai = req.query.trang_thai || 'active';

        const data = await Kho.find(filter)
            .populate('cua_hang_id')
            .sort({ ten_kho: 1 });
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.get('/cua-hang/:id/kho', async (req, res, next) => {
    try {
        const data = await Kho.find({
            cua_hang_id: req.params.id,
            trang_thai: req.query.trang_thai || 'active'
        })
            .sort({ ten_kho: 1, ma_kho: 1 });
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.get('/kho/:id', async (req, res, next) => {
    try {
        const data = await Kho.findById(req.params.id)
            .populate('cua_hang_id');
        if (!data) return res.status(404).json({ success: false, message: 'Khong tim thay kho' });
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.post('/kho', async (req, res, next) => {
    try {
        const data = await Kho.create(scopedBody(req.body));
        res.status(201).json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.put('/kho/:id', async (req, res, next) => {
    try {
        const data = await Kho.findByIdAndUpdate(req.params.id, { $set: scopedBody(req.body) }, { new: true, runValidators: true });
        if (!data) return res.status(404).json({ success: false, message: 'Khong tim thay kho' });
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.delete('/kho/:id', async (req, res, next) => {
    try {
        const kho = await Kho.findById(req.params.id);
        if (!kho) return res.status(404).json({ success: false, message: 'Khong tim thay kho' });

        await khoHasActivity(kho._id);
        kho.trang_thai = 'inactive';
        await kho.save();
        res.json({ success: true, message: 'Da chuyen kho sang inactive', data: kho });
    } catch (error) {
        next(error);
    }
});

router.get('/ton-kho', async (req, res, next) => {
    try {
        if (!req.query.kho_id) {
            return res.status(400).json({ success: false, message: 'Thieu kho_id' });
        }

        const data = await layTonKhoTheoKho(req.query.kho_id);
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.get('/kho/:id/ton-kho', async (req, res, next) => {
    try {
        const data = await layTonKhoTheoKho(req.params.id);
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.get('/kho/:id/ton-kho-lo', async (req, res, next) => {
    try {
        const filter = { kho_id: req.params.id };
        if (req.query.hang_hoa_id) filter.hang_hoa_id = req.query.hang_hoa_id;
        const rows = await TonKhoLo.find(filter)
            .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang gia_von' })
            .populate({ path: 'kho_id', select: 'ma_kho ten_kho' })
            .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo ngay_nhap han_su_dung trang_thai' })
            .sort({ updated_at: -1, created_at: -1 })
            .lean();
        res.json({ success: true, data: rows });
    } catch (error) {
        next(error);
    }
});

router.get('/hang-hoa/:id/gia', async (req, res, next) => {
    try {
        const product = await HangHoa.findById(req.params.id)
            .select('ma_hang ten_hang loai_gia gia_co_dinh gia_von gia_nhap_cuoi')
            .lean();
        if (!product) return res.status(404).json({ success: false, message: 'Khong tim thay hang hoa' });

        let price = product.loai_gia === 'co_dinh' ? Number(product.gia_co_dinh || 0) : null;
        let priceSource = product.loai_gia === 'co_dinh' ? 'gia_co_dinh' : 'thi_truong';
        const bangGiaId = String(req.query.bang_gia_id || '').trim();
        if (bangGiaId) {
            const priceRow = await CTBangGia.findOne({ bang_gia_id: bangGiaId, hang_hoa_id: product._id }).lean();
            if (priceRow) {
                price = Number(priceRow.gia_ban || 0);
                priceSource = 'bang_gia';
            }
        } else {
            const activePriceList = await BangGia.findOne({ trang_thai: 'active' }).sort({ created_at: -1 }).lean();
            if (activePriceList) {
                const priceRow = await CTBangGia.findOne({ bang_gia_id: activePriceList._id, hang_hoa_id: product._id }).lean();
                if (priceRow) {
                    price = Number(priceRow.gia_ban || 0);
                    priceSource = 'bang_gia';
                }
            }
        }

        res.json({
            success: true,
            data: {
                hang_hoa_id: product._id,
                ma_hang: product.ma_hang || '',
                ten_hang: product.ten_hang || '',
                loai_gia: product.loai_gia || 'thi_truong',
                gia_ban: price,
                nguon_gia: priceSource,
                gia_von: Number(product.gia_von || 0),
                gia_nhap_cuoi: Number(product.gia_nhap_cuoi || 0),
                cho_phep_nhap_tay: product.loai_gia !== 'co_dinh' && price == null
            }
        });
    } catch (error) {
        next(error);
    }
});

router.get('/kho/:id/hang-ban-hang', async (req, res, next) => {
    try {
        const khoId = req.params.id;
        if (!khoId) {
            return res.status(400).json({ success: false, message: 'Thieu kho_id' });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const normalRows = await TonKho.find({ kho_id: khoId, so_luong: { $gt: 0 } })
            .populate('hang_hoa_id')
            .sort({ updated_at: -1, created_at: -1 })
            .lean();

        const products = new Map();
        normalRows
            .filter(row => row.hang_hoa_id && !row.hang_hoa_id.quan_ly_theo_lo && row.hang_hoa_id.trang_thai !== 'inactive')
            .forEach(row => {
                const product = row.hang_hoa_id;
                products.set(String(product._id), {
                    _id: String(product._id),
                    ma_hang: product.ma_hang || '',
                    ten_hang: product.ten_hang || '',
                    gia_co_dinh: Number(product.gia_co_dinh || 0),
                    quan_ly_theo_lo: false,
                    ton_kho: Number(row.so_luong || 0)
                });
            });

        const lotRows = await TonKhoLo.find({ kho_id: khoId, so_luong: { $gt: 0 } })
            .populate('hang_hoa_id')
            .populate({ path: 'lo_hang_id', select: 'han_su_dung trang_thai' })
            .lean();

        lotRows
            .filter(row => {
                if (!row.hang_hoa_id || !row.hang_hoa_id.quan_ly_theo_lo || row.hang_hoa_id.trang_thai === 'inactive') return false;
                if (!row.lo_hang_id || row.lo_hang_id.trang_thai === 'huy') return false;
                if (!row.lo_hang_id.han_su_dung) return true;
                const expiry = new Date(row.lo_hang_id.han_su_dung);
                expiry.setHours(0, 0, 0, 0);
                return expiry.getTime() >= today.getTime();
            })
            .forEach(row => {
                const product = row.hang_hoa_id;
                const id = String(product._id);
                const current = products.get(id) || {
                    _id: id,
                    ma_hang: product.ma_hang || '',
                    ten_hang: product.ten_hang || '',
                    gia_co_dinh: Number(product.gia_co_dinh || 0),
                    quan_ly_theo_lo: true,
                    ton_kho: 0
                };
                current.ton_kho += Number(row.so_luong || 0);
                products.set(id, current);
            });

        const activeProducts = await HangHoa.find({ trang_thai: { $ne: 'inactive' } })
            .select('_id ma_hang ten_hang gia_co_dinh quan_ly_theo_lo')
            .lean();
        activeProducts.forEach(product => {
            const id = String(product._id);
            if (products.has(id)) return;
            products.set(id, {
                _id: id,
                ma_hang: product.ma_hang || '',
                ten_hang: product.ten_hang || '',
                gia_co_dinh: Number(product.gia_co_dinh || 0),
                quan_ly_theo_lo: !!product.quan_ly_theo_lo,
                ton_kho: 0
            });
        });

        res.json({
            success: true,
            data: Array.from(products.values())
        });
    } catch (error) {
        next(error);
    }
});

router.get('/kho/:id/hang-kiem-kho', async (req, res, next) => {
    try {
        const khoId = req.params.id;
        if (!khoId) {
            return res.status(400).json({ success: false, message: 'Thieu kho_id' });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const totalRows = await TonKho.find({ kho_id: khoId, so_luong: { $gt: 0 } })
            .populate({
                path: 'hang_hoa_id',
                populate: [
                    { path: 'don_vi_tinh_id', select: 'ten_don_vi' },
                    { path: 'nhom_hang_id', select: 'ten_nhom_hang' }
                ]
            })
            .sort({ updated_at: -1, created_at: -1 })
            .lean();

        const normalRows = totalRows
            .filter(row => row.hang_hoa_id && !row.hang_hoa_id.quan_ly_theo_lo)
            .map(row => ({
                hang_hoa_id: row.hang_hoa_id._id,
                lo_hang_id: null,
                ma_hang: row.hang_hoa_id.ma_hang || '',
                ten_hang: row.hang_hoa_id.ten_hang || '',
                don_vi_tinh: row.hang_hoa_id.don_vi_tinh_id?.ten_don_vi || '',
                nhom_hang: row.hang_hoa_id.nhom_hang_id?.ten_nhom_hang || '',
                quan_ly_theo_lo: false,
                ma_lo: '',
                han_su_dung: '',
                ton_kho_he_thong: Number(row.so_luong || 0)
            }));

        const lotRows = await TonKhoLo.find({ kho_id: khoId, so_luong: { $gt: 0 } })
            .populate({
                path: 'hang_hoa_id',
                populate: [
                    { path: 'don_vi_tinh_id', select: 'ten_don_vi' },
                    { path: 'nhom_hang_id', select: 'ten_nhom_hang' }
                ]
            })
            .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo han_su_dung trang_thai' })
            .sort({ updated_at: -1, created_at: -1 })
            .lean();

        const validLotRows = lotRows
            .filter(row => {
                if (!row.hang_hoa_id || !row.hang_hoa_id.quan_ly_theo_lo || !row.lo_hang_id) return false;
                if (row.lo_hang_id.trang_thai === 'huy') return false;
                if (!row.lo_hang_id.han_su_dung) return true;
                const expiry = new Date(row.lo_hang_id.han_su_dung);
                expiry.setHours(0, 0, 0, 0);
                return expiry.getTime() >= today.getTime();
            })
            .map(row => ({
                hang_hoa_id: row.hang_hoa_id._id,
                lo_hang_id: row.lo_hang_id._id,
                ma_hang: row.hang_hoa_id.ma_hang || '',
                ten_hang: row.hang_hoa_id.ten_hang || '',
                don_vi_tinh: row.hang_hoa_id.don_vi_tinh_id?.ten_don_vi || '',
                nhom_hang: row.hang_hoa_id.nhom_hang_id?.ten_nhom_hang || '',
                quan_ly_theo_lo: true,
                ma_lo: row.lo_hang_id.ma_lo || row.lo_hang_id.ten_lo || '',
                han_su_dung: row.lo_hang_id.han_su_dung || '',
                ton_kho_he_thong: Number(row.so_luong || 0)
            }));

        res.json({ success: true, data: normalRows.concat(validLotRows) });
    } catch (error) {
        next(error);
    }
});

router.get('/ton-kho/lo', async (req, res, next) => {
    try {
        const { kho_id, hang_hoa_id } = req.query;
        if (!kho_id || !hang_hoa_id) {
            return res.status(400).json({ success: false, message: 'Thieu kho_id hoac hang_hoa_id' });
        }

        const docs = await layTonKhoTheoLo(kho_id, hang_hoa_id);
        const data = docs.map(item => ({
            _id: item._id,
            kho_id: item.kho_id,
            hang_hoa_id: item.hang_hoa_id,
            lo_hang_id: item.lo_hang_id?._id || item.lo_hang_id,
            ma_lo: item.lo_hang_id?.ma_lo || '',
            ten_lo: item.lo_hang_id?.ten_lo || '',
            so_luong: item.so_luong,
            gia_von: item.gia_von
        }));
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.get('/ton-kho-lo/bao-cao', async (req, res, next) => {
    try {
        const filter = {};
        if (req.query.cua_hang_id) filter.cua_hang_id = req.query.cua_hang_id;
        if (req.query.kho_id) filter.kho_id = req.query.kho_id;
        if (req.query.hang_hoa_id) filter.hang_hoa_id = req.query.hang_hoa_id;
        const rows = await TonKhoLo.find(filter)
            .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang gia_von' })
            .populate({ path: 'kho_id', select: 'ma_kho ten_kho' })
            .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo ngay_nhap han_su_dung' })
            .sort({ updated_at: -1, created_at: -1 })
            .lean();
        const data = rows.map(row => {
            const quantity = Number(row.so_luong || 0);
            const cost = Number(row.gia_von || row.hang_hoa_id?.gia_von || 0);
            return {
                hang_hoa_id: row.hang_hoa_id?._id || row.hang_hoa_id,
                ma_hang: row.hang_hoa_id?.ma_hang || '',
                ten_hang: row.hang_hoa_id?.ten_hang || '',
                kho_id: row.kho_id?._id || row.kho_id,
                ma_kho: row.kho_id?.ma_kho || '',
                ten_kho: row.kho_id?.ten_kho || '',
                lo_hang_id: row.lo_hang_id?._id || row.lo_hang_id,
                ma_lo: row.lo_hang_id?.ma_lo || '',
                ten_lo: row.lo_hang_id?.ten_lo || '',
                ngay_nhap: row.lo_hang_id?.ngay_nhap || '',
                han_su_dung: row.lo_hang_id?.han_su_dung || '',
                so_luong_con_lai: quantity,
                gia_von: cost,
                tong_gia_tri: quantity * cost
            };
        });
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.get('/lo-hang', async (req, res, next) => {
    try {
        const filter = {};
        if (req.query.kho_id) filter.kho_id = req.query.kho_id;
        if (req.query.hang_hoa_id) filter.hang_hoa_id = req.query.hang_hoa_id;
        if (req.query.trang_thai) filter.trang_thai = req.query.trang_thai;

        const data = await LoHang.find(filter)
            .populate('hang_hoa_id')
            .populate('nha_cung_cap_id')
            .populate('kho_id')
            .sort({ created_at: -1 });
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.get('/lo-hang/:id', async (req, res, next) => {
    try {
        const data = await LoHang.findById(req.params.id)
            .populate('hang_hoa_id')
            .populate('nha_cung_cap_id')
            .populate('kho_id');
        if (!data) return res.status(404).json({ success: false, message: 'Khong tim thay lo hang' });
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.post('/lo-hang', async (req, res, next) => {
    try {
        const data = await LoHang.create(scopedBody(req.body));
        res.status(201).json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.put('/lo-hang/:id', async (req, res, next) => {
    try {
        const data = await LoHang.findByIdAndUpdate(req.params.id, { $set: scopedBody(req.body) }, { new: true, runValidators: true });
        if (!data) return res.status(404).json({ success: false, message: 'Khong tim thay lo hang' });
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.get('/dia-chi-doi-tuong', async (req, res, next) => {
    try {
        const filter = {};
        ['loai_doi_tuong', 'khach_hang_id', 'nha_cung_cap_id', 'loai_dia_chi'].forEach(field => {
            if (req.query[field]) filter[field] = req.query[field];
        });

        const data = await DiaChiDoiTuong.find(filter).sort({ mac_dinh: -1, created_at: -1 });
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.get('/khach-hang/:id/dia-chi', async (req, res, next) => {
    try {
        const data = await DiaChiKhachHang.find({ khach_hang_id: req.params.id })
            .sort({ mac_dinh: -1, created_at: -1 })
            .lean();
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.get('/nha-cung-cap/:id/dia-chi', async (req, res, next) => {
    try {
        const data = await DiaChiNcc.find({ nha_cung_cap_id: req.params.id })
            .sort({ mac_dinh: -1, created_at: -1 })
            .lean();
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.post('/dia-chi-doi-tuong', async (req, res, next) => {
    try {
        const data = await DiaChiDoiTuong.create(scopedBody(req.body));
        res.status(201).json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.put('/dia-chi-doi-tuong/:id', async (req, res, next) => {
    try {
        const data = await DiaChiDoiTuong.findByIdAndUpdate(req.params.id, { $set: scopedBody(req.body) }, { new: true, runValidators: true });
        if (!data) return res.status(404).json({ success: false, message: 'Khong tim thay dia chi' });
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.delete('/dia-chi-doi-tuong/:id', async (req, res, next) => {
    try {
        const data = await DiaChiDoiTuong.findByIdAndDelete(req.params.id);
        if (!data) return res.status(404).json({ success: false, message: 'Khong tim thay dia chi' });
        res.json({ success: true, message: 'Da xoa dia chi' });
    } catch (error) {
        next(error);
    }
});

async function writeAllocationDetails(allocation, items) {
    await CTPhanBoHang.deleteMany({ phan_bo_hang_id: allocation._id });
    let totalQuantity = 0;

    for (const item of items) {
        const quantity = Number(item.so_luong) || 0;
        if (!item.hang_hoa_id || quantity <= 0) continue;
        totalQuantity += quantity;
        await CTPhanBoHang.create({
            phan_bo_hang_id: allocation._id,
            hang_hoa_id: item.hang_hoa_id,
            lo_hang_id: item.lo_hang_id || null,
            so_luong: quantity,
            ghi_chu: item.ghi_chu
        });
    }

    allocation.tong_so_luong = totalQuantity;
    await allocation.save();
}

router.get('/phan-bo-hang', async (req, res, next) => {
    try {
        const filter = {};
        if (req.query.kho_id) filter.kho_id = req.query.kho_id;
        if (req.query.khach_hang_id) filter.khach_hang_id = req.query.khach_hang_id;
        if (req.query.trang_thai) filter.trang_thai = req.query.trang_thai;

        const data = await PhanBoHang.find(filter)
            .populate('kho_id')
            .populate('khach_hang_id')
            .populate('don_hang_id')
            .sort({ created_at: -1 });
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.get('/don-hang/:id/phan-bo', async (req, res, next) => {
    try {
        const order = await DonHang.findById(req.params.id)
            .populate('khach_hang_id')
            .populate('kho_id')
            .lean();
        if (!order) return res.status(404).json({ success: false, message: 'Khong tim thay don hang' });
        const details = await CTDonHang.find({ don_hang_id: order._id })
            .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang quan_ly_theo_lo gia_co_dinh loai_gia' })
            .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo han_su_dung' })
            .lean();
        const allocations = await PhanBoHang.find({ don_hang_id: order._id })
            .sort({ created_at: -1 })
            .lean();
        const allocationIds = allocations.map(item => item._id);
        const allocationDetails = allocationIds.length
            ? await CTPhanBoHang.find({ phan_bo_hang_id: { $in: allocationIds } })
                .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang' })
                .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo han_su_dung' })
                .lean()
            : [];
        res.json({
            success: true,
            data: {
                don_hang: order,
                chi_tiet: details,
                phan_bo: allocations,
                chi_tiet_phan_bo: allocationDetails
            }
        });
    } catch (error) {
        next(error);
    }
});

router.post('/phan-bo-hang', async (req, res, next) => {
    try {
        const items = parseItems(req.body?.items);
        const count = await PhanBoHang.countDocuments();
        const allocation = await PhanBoHang.create({
            ma_phan_bo: req.body.ma_phan_bo || 'PB' + String(count + 1).padStart(6, '0'),
            cua_hang_id: req.body.cua_hang_id || null,
            chi_nhanh_id: req.body.chi_nhanh_id || null,
            kho_id: req.body.kho_id || null,
            khach_hang_id: req.body.khach_hang_id || null,
            don_hang_id: req.body.don_hang_id || null,
            nguoi_tao_id: req.user?._id,
            trang_thai: req.body.trang_thai === 'confirmed' ? 'confirmed' : 'draft',
            ghi_chu: req.body.ghi_chu
        });
        await writeAllocationDetails(allocation, items);
        res.status(201).json({ success: true, data: allocation });
    } catch (error) {
        next(error);
    }
});

router.put('/phan-bo-hang/:id', async (req, res, next) => {
    try {
        const allocation = await PhanBoHang.findById(req.params.id);
        if (!allocation) return res.status(404).json({ success: false, message: 'Khong tim thay phan bo hang' });
        if (allocation.trang_thai === 'confirmed') {
            return res.status(400).json({ success: false, message: 'Phan bo da xac nhan khong the sua' });
        }

        Object.assign(allocation, scopedBody(req.body));
        await allocation.save();
        const items = parseItems(req.body?.items);
        if (items.length) await writeAllocationDetails(allocation, items);
        res.json({ success: true, data: allocation });
    } catch (error) {
        next(error);
    }
});

router.put('/phan-bo-hang/:id/xac-nhan', async (req, res, next) => {
    try {
        const allocation = await PhanBoHang.findById(req.params.id);
        if (!allocation) return res.status(404).json({ success: false, message: 'Khong tim thay phan bo hang' });
        if (allocation.trang_thai === 'cancelled') {
            return res.status(400).json({ success: false, message: 'Phan bo da huy' });
        }

        allocation.trang_thai = 'confirmed';
        allocation.ngay_xac_nhan = new Date();
        await allocation.save();
        res.json({ success: true, message: 'Da xac nhan phan bo hang. Ton kho se tru o buoc giao hang.', data: allocation });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
