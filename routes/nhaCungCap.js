const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const {
    NhaCungCap,
    PhieuNhap,
    PhieuTraHangNhap,
    CongNoNhaCungCap
} = require('../models/kiot.model');

router.use(isAuthenticated);

function parseMoney(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(String(value).replace(/\./g, '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
}

function buildSupplierFilter(query = {}) {
    const { q, trang_thai } = query || {};
    const filter = {};

    if (q && q.trim() !== '') {
        const keyword = q.trim();
        filter.$or = [
            { ma_ncc: { $regex: keyword, $options: 'i' } },
            { ten_ncc: { $regex: keyword, $options: 'i' } },
            { sdt: { $regex: keyword, $options: 'i' } }
        ];
    }
    if (trang_thai === 'active' || trang_thai === 'inactive') filter.trang_thai = trang_thai;
    if (query.nhom_ncc && query.nhom_ncc !== 'all') filter.nhom_ncc = query.nhom_ncc;

    const totalFrom = parseMoney(query.tong_mua_from);
    const totalTo = parseMoney(query.tong_mua_to);
    if (totalFrom !== null || totalTo !== null) {
        filter.tong_mua = {};
        if (totalFrom !== null) filter.tong_mua.$gte = totalFrom;
        if (totalTo !== null) filter.tong_mua.$lte = totalTo;
    }

    const debtFrom = parseMoney(query.tong_no_from);
    const debtTo = parseMoney(query.tong_no_to);
    if (debtFrom !== null || debtTo !== null) {
        filter.tong_no = {};
        if (debtFrom !== null) filter.tong_no.$gte = debtFrom;
        if (debtTo !== null) filter.tong_no.$lte = debtTo;
    }

    return filter;
}

router.get('/', async (req, res, next) => {
    try {
        const filter = buildSupplierFilter(req.query);

        const [suppliers, groups] = await Promise.all([
            NhaCungCap.find(filter).populate('nguoi_tao_id').sort({ created_at: -1 }),
            NhaCungCap.distinct('nhom_ncc', { nhom_ncc: { $nin: [null, ''] } })
        ]);
        const supplierIds = suppliers.map(item => item._id);
        const [imports, returns, debts] = supplierIds.length ? await Promise.all([
            PhieuNhap.find({ nha_cung_cap_id: { $in: supplierIds } })
                .populate('nguoi_tao_id')
                .sort({ ngay_nhap: -1, created_at: -1 }),
            PhieuTraHangNhap.find({ nha_cung_cap_id: { $in: supplierIds } })
                .populate('nguoi_tao_id')
                .sort({ ngay_tra: -1, created_at: -1 }),
            CongNoNhaCungCap.find({ nha_cung_cap_id: { $in: supplierIds } })
                .populate('phieu_nhap_id')
                .populate('phieu_thu_chi_id')
                .sort({ ngay: -1, created_at: -1 })
        ]) : [[], [], []];
        const supplierDetails = {};
        supplierIds.forEach(id => {
            supplierDetails[String(id)] = { imports: [], returns: [], debts: [] };
        });
        imports.forEach(item => {
            const key = String(item.nha_cung_cap_id || '');
            if (supplierDetails[key]) supplierDetails[key].imports.push(item);
        });
        returns.forEach(item => {
            const key = String(item.nha_cung_cap_id || '');
            if (supplierDetails[key]) supplierDetails[key].returns.push(item);
        });
        debts.forEach(item => {
            const key = String(item.nha_cung_cap_id || '');
            if (supplierDetails[key]) supplierDetails[key].debts.push(item);
        });
        res.render('nha-cung-cap/index', {
            title: 'Nhà cung cấp',
            suppliers,
            groups: groups.sort(),
            supplierDetails,
            filters: req.query || {}
        });
    } catch (error) {
        next(error);
    }
});

router.get('/export.csv', async (req, res, next) => {
    try {
        const suppliers = await NhaCungCap.find(buildSupplierFilter(req.query)).sort({ created_at: -1 });
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['ma_ncc', 'ten_ncc', 'sdt', 'email', 'dia_chi', 'tong_no', 'tong_mua', 'trang_thai'],
            ...suppliers.map(s => [
                s.ma_ncc, s.ten_ncc, s.sdt, s.email, s.dia_chi, s.tong_no || 0, s.tong_mua || 0, s.trang_thai || 'active'
            ])
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="nha-cung-cap.csv"');
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
});

router.get('/data', async (req, res, next) => {
    try {
        const suppliers = await NhaCungCap.find().sort({ ten_ncc: 1 });
        res.json({ success: true, data: suppliers });
    } catch (error) {
        next(error);
    }
});

router.post('/add', async (req, res, next) => {
    try {
        const {
            ma_ncc, ten_ncc, sdt, email, dia_chi,
            tinh_thanh, phuong_xa, nhom_ncc, ghi_chu, ten_cong_ty, ma_so_thue
        } = req.body || {};

        if (!ten_ncc || ten_ncc.trim() === '') {
            return res.status(400).json({ success: false, message: 'Tên nhà cung cấp là bắt buộc' });
        }

        const count = await NhaCungCap.countDocuments();
        const code = ma_ncc && ma_ncc.trim() !== '' ? ma_ncc.trim() : 'NCC' + String(count + 1).padStart(4, '0');
        const exist = await NhaCungCap.findOne({ ma_ncc: code });
        if (exist) return res.status(400).json({ success: false, message: 'Mã nhà cung cấp đã tồn tại' });

        await NhaCungCap.create({
            ma_ncc: code,
            ten_ncc: ten_ncc.trim(),
            sdt: sdt?.trim(),
            email: email?.trim(),
            dia_chi: dia_chi?.trim(),
            tinh_thanh: tinh_thanh?.trim(),
            phuong_xa: phuong_xa?.trim(),
            nhom_ncc: nhom_ncc?.trim(),
            ghi_chu: ghi_chu?.trim(),
            ten_cong_ty: ten_cong_ty?.trim(),
            ma_so_thue: ma_so_thue?.trim(),
            trang_thai: 'active'
        });

        res.json({ success: true, message: 'Thêm nhà cung cấp thành công' });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/update', async (req, res, next) => {
    try {
        const {
            ma_ncc, ten_ncc, sdt, email, dia_chi,
            tinh_thanh, phuong_xa, nhom_ncc, ghi_chu, ten_cong_ty, ma_so_thue, trang_thai
        } = req.body || {};

        if (!ten_ncc || ten_ncc.trim() === '') {
            return res.status(400).json({ success: false, message: 'Tên nhà cung cấp là bắt buộc' });
        }

        const supplier = await NhaCungCap.findById(req.params.id);
        if (!supplier) return res.status(404).json({ success: false, message: 'Không tìm thấy nhà cung cấp' });

        if (ma_ncc && ma_ncc.trim() !== '' && ma_ncc.trim() !== supplier.ma_ncc) {
            const exist = await NhaCungCap.findOne({ ma_ncc: ma_ncc.trim(), _id: { $ne: supplier._id } });
            if (exist) return res.status(400).json({ success: false, message: 'Mã nhà cung cấp đã tồn tại' });
            supplier.ma_ncc = ma_ncc.trim();
        }

        supplier.ten_ncc = ten_ncc.trim();
        supplier.sdt = sdt?.trim();
        supplier.email = email?.trim();
        supplier.dia_chi = dia_chi?.trim();
        supplier.tinh_thanh = tinh_thanh?.trim();
        supplier.phuong_xa = phuong_xa?.trim();
        supplier.nhom_ncc = nhom_ncc?.trim();
        supplier.ghi_chu = ghi_chu?.trim();
        supplier.ten_cong_ty = ten_cong_ty?.trim();
        supplier.ma_so_thue = ma_so_thue?.trim();
        if (trang_thai === 'active' || trang_thai === 'inactive') supplier.trang_thai = trang_thai;

        await supplier.save();
        res.json({ success: true, message: 'Cập nhật nhà cung cấp thành công' });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/delete', async (req, res, next) => {
    try {
        const supplier = await NhaCungCap.findByIdAndDelete(req.params.id);
        if (!supplier) return res.status(404).json({ success: false, message: 'Không tìm thấy nhà cung cấp' });
        res.json({ success: true, message: 'Đã xóa nhà cung cấp' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
