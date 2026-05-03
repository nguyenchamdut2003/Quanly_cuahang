const express = require('express');
const router = express.Router();
const multer = require('multer');
const { isAuthenticated } = require('../middlewares/auth.middleware');
const {
    KhachHang,
    NhomKhachHang,
    DiaChiKhachHang,
    HoaDonBanHang,
    PhieuTraHang,
    CongNoKhachHang,
    NguoiDung
} = require('../models/kiot.model');

router.use(isAuthenticated);
const upload = multer({ storage: multer.memoryStorage() });

function parseMoney(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(String(value).replace(/\./g, '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
}

function parseDateRange(query = {}, fromKey, toKey) {
    const range = {};
    const from = query[fromKey] ? new Date(query[fromKey] + 'T00:00:00') : null;
    const to = query[toKey] ? new Date(query[toKey] + 'T23:59:59') : null;
    if (from && !Number.isNaN(from.getTime())) range.$gte = from;
    if (to && !Number.isNaN(to.getTime())) range.$lte = to;
    return Object.keys(range).length ? range : null;
}

function buildCustomerFilter(query = {}) {
    const filter = { trang_thai: { $ne: 'inactive' } };
    if (query.q && query.q.trim() !== '') {
        const q = query.q.trim();
        filter.$or = [
            { ma_khach_hang: { $regex: q, $options: 'i' } },
            { ten_khach_hang: { $regex: q, $options: 'i' } },
            { sdt: { $regex: q, $options: 'i' } },
            { sdt2: { $regex: q, $options: 'i' } }
        ];
    }
    if (query.nhom_khach_hang_id && query.nhom_khach_hang_id !== 'all') {
        filter.nhom_khach_hang_id = query.nhom_khach_hang_id;
    }
    if (query.loai_khach_hang && query.loai_khach_hang !== 'all') {
        filter.loai_khach_hang = query.loai_khach_hang;
    }
    if (query.gioi_tinh && query.gioi_tinh !== 'all') {
        filter.gioi_tinh = query.gioi_tinh;
    }
    const createdRange = parseDateRange(query, 'created_from', 'created_to');
    if (createdRange) filter.created_at = createdRange;
    const birthdayRange = parseDateRange(query, 'birthday_from', 'birthday_to');
    if (birthdayRange) filter.ngay_sinh = birthdayRange;
    if (query.nguoi_tao && /^[0-9a-fA-F]{24}$/.test(query.nguoi_tao)) {
        filter.nguoi_tao_id = query.nguoi_tao;
    }
    if (query.khu_vuc && query.khu_vuc.trim() !== '') {
        const keyword = query.khu_vuc.trim();
        filter.$and = filter.$and || [];
        filter.$and.push({
            $or: [
                { dia_chi_nhan: { $regex: keyword, $options: 'i' } },
                { tinh_thanh: { $regex: keyword, $options: 'i' } },
                { quan_huyen: { $regex: keyword, $options: 'i' } },
                { phuong_xa: { $regex: keyword, $options: 'i' } }
            ]
        });
    }
    return filter;
}

async function nextCustomerCode() {
    const count = await KhachHang.countDocuments();
    return 'KH' + String(count + 1).padStart(6, '0');
}

async function getCustomerStats(customerIds) {
    const [sales, returns] = await Promise.all([
        HoaDonBanHang.aggregate([
            { $match: { khach_hang_id: { $in: customerIds } } },
            { $group: { _id: '$khach_hang_id', total: { $sum: { $ifNull: ['$thanh_toan', '$tong_tien'] } } } }
        ]),
        PhieuTraHang.aggregate([
            { $match: { khach_hang_id: { $in: customerIds } } },
            { $group: { _id: '$khach_hang_id', total: { $sum: '$tong_tien_tra' } } }
        ])
    ]);

    return {
        sales: new Map(sales.map(item => [String(item._id), item.total || 0])),
        returns: new Map(returns.map(item => [String(item._id), item.total || 0]))
    };
}

router.get('/', async (req, res, next) => {
    try {
        const filter = buildCustomerFilter(req.query);
        if (req.query?.nguoi_tao && req.query.nguoi_tao.trim() !== '' && !filter.nguoi_tao_id) {
            const usersByName = await NguoiDung.find({
                $or: [
                    { ho_ten: { $regex: req.query.nguoi_tao.trim(), $options: 'i' } },
                    { username: { $regex: req.query.nguoi_tao.trim(), $options: 'i' } },
                    { email: { $regex: req.query.nguoi_tao.trim(), $options: 'i' } }
                ]
            }).select('_id');
            filter.nguoi_tao_id = { $in: usersByName.map(user => user._id) };
        }

        const [customersRaw, groups, users] = await Promise.all([
            KhachHang.find(filter)
                .populate('nhom_khach_hang_id')
                .populate('nguoi_tao_id')
                .sort({ created_at: -1 }),
            NhomKhachHang.find().sort({ ten_nhom: 1 }),
            NguoiDung.find().sort({ ho_ten: 1, username: 1 })
        ]);
        const ids = customersRaw.map(item => item._id);
        const [stats, addresses, debts, invoices] = await Promise.all([
            getCustomerStats(ids),
            ids.length ? DiaChiKhachHang.find({ khach_hang_id: { $in: ids } }).sort({ mac_dinh: -1 }) : [],
            ids.length ? CongNoKhachHang.find({ khach_hang_id: { $in: ids } })
                .populate('hoa_don_id')
                .populate('phieu_thu_chi_id')
                .sort({ ngay: -1, created_at: -1 }) : [],
            ids.length ? HoaDonBanHang.find({ khach_hang_id: { $in: ids } }).sort({ ngay_ban: -1, created_at: -1 }) : []
        ]);
        const detailMap = {};
        ids.forEach(id => { detailMap[String(id)] = { addresses: [], debts: [], invoices: [] }; });
        addresses.forEach(item => {
            const key = String(item.khach_hang_id || '');
            if (detailMap[key]) detailMap[key].addresses.push(item);
        });
        debts.forEach(item => {
            const key = String(item.khach_hang_id || '');
            if (detailMap[key]) detailMap[key].debts.push(item);
        });
        invoices.forEach(item => {
            const key = String(item.khach_hang_id || '');
            if (detailMap[key]) detailMap[key].invoices.push(item);
        });
        const lastInvoiceMap = new Map();
        invoices.forEach(item => {
            const key = String(item.khach_hang_id || '');
            if (!lastInvoiceMap.has(key)) lastInvoiceMap.set(key, item.ngay_ban || item.created_at);
        });

        let customers = customersRaw.map(item => {
            const data = item.toObject();
            data.tong_ban = stats.sales.get(String(item._id)) || 0;
            data.tong_ban_tru_tra = Math.max(data.tong_ban - (stats.returns.get(String(item._id)) || 0), 0);
            data.ngay_giao_dich_cuoi = lastInvoiceMap.get(String(item._id)) || null;
            return data;
        });
        const totalFrom = parseMoney(req.query.tong_ban_from);
        const totalTo = parseMoney(req.query.tong_ban_to);
        const debtFrom = parseMoney(req.query.tong_no_from);
        const debtTo = parseMoney(req.query.tong_no_to);
        const lastRange = parseDateRange(req.query, 'last_tx_from', 'last_tx_to');
        customers = customers.filter(item => {
            if (totalFrom !== null && item.tong_ban < totalFrom) return false;
            if (totalTo !== null && item.tong_ban > totalTo) return false;
            if (debtFrom !== null && Number(item.tong_no || 0) < debtFrom) return false;
            if (debtTo !== null && Number(item.tong_no || 0) > debtTo) return false;
            if (lastRange) {
                if (!item.ngay_giao_dich_cuoi) return false;
                const date = new Date(item.ngay_giao_dich_cuoi);
                if (lastRange.$gte && date < lastRange.$gte) return false;
                if (lastRange.$lte && date > lastRange.$lte) return false;
            }
            return true;
        });

        res.render('khach-hang/index', { title: 'Khách hàng', customers, groups, users, detailMap, filters: req.query || {} });
    } catch (error) {
        next(error);
    }
});

router.get('/export.csv', async (req, res, next) => {
    try {
        const customers = await KhachHang.find(buildCustomerFilter(req.query)).populate('nhom_khach_hang_id').sort({ created_at: -1 });
        const stats = await getCustomerStats(customers.map(item => item._id));
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['ma_khach_hang', 'ten_khach_hang', 'dien_thoai', 'email', 'nhom', 'gioi_tinh', 'loai_khach_hang', 'dia_chi', 'no_hien_tai', 'tong_ban', 'tong_ban_tru_tra'],
            ...customers.map(item => {
                const total = stats.sales.get(String(item._id)) || 0;
                const returnTotal = stats.returns.get(String(item._id)) || 0;
                return [
                    item.ma_khach_hang,
                    item.ten_khach_hang,
                    item.sdt,
                    item.email,
                    item.nhom_khach_hang_id?.ten_nhom || '',
                    item.gioi_tinh || '',
                    item.loai_khach_hang || '',
                    item.dia_chi_nhan || '',
                    item.tong_no || 0,
                    total,
                    Math.max(total - returnTotal, 0)
                ];
            })
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="khach-hang.csv"');
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
});

router.post('/add', async (req, res, next) => {
    try {
        const body = req.body || {};
        if (!body.ten_khach_hang || body.ten_khach_hang.trim() === '') {
            return res.status(400).json({ success: false, message: 'Tên khách hàng là bắt buộc' });
        }
        const code = body.ma_khach_hang && body.ma_khach_hang.trim() !== '' ? body.ma_khach_hang.trim() : await nextCustomerCode();
        const exist = await KhachHang.findOne({ ma_khach_hang: code });
        if (exist) return res.status(400).json({ success: false, message: 'Mã khách hàng đã tồn tại' });

        const customer = await KhachHang.create({
            ma_khach_hang: code,
            ten_khach_hang: body.ten_khach_hang.trim(),
            sdt: body.sdt?.trim(),
            sdt2: body.sdt2?.trim(),
            email: body.email?.trim(),
            facebook: body.facebook?.trim(),
            ngay_sinh: body.ngay_sinh || null,
            gioi_tinh: body.gioi_tinh || '',
            loai_khach_hang: body.loai_khach_hang || 'ca_nhan',
            dia_chi_nhan: body.dia_chi_nhan?.trim(),
            tinh_thanh: body.tinh_thanh?.trim(),
            quan_huyen: body.quan_huyen?.trim(),
            phuong_xa: body.phuong_xa?.trim(),
            ghi_chu: body.ghi_chu?.trim(),
            ten_nguoi_mua: body.ten_nguoi_mua?.trim(),
            ten_cong_ty: body.ten_cong_ty?.trim(),
            ma_so_thue: body.ma_so_thue?.trim(),
            nhom_khach_hang_id: body.nhom_khach_hang_id || null,
            nguoi_tao_id: req.user?._id,
            tong_no: 0,
            trang_thai: 'active'
        });

        if (body.dia_chi_nhan || body.tinh_thanh || body.phuong_xa) {
            await DiaChiKhachHang.create({
                khach_hang_id: customer._id,
                dia_chi: body.dia_chi_nhan?.trim(),
                tinh_thanh: body.tinh_thanh?.trim(),
                quan_huyen: body.quan_huyen?.trim(),
                phuong_xa: body.phuong_xa?.trim(),
                mac_dinh: true
            });
        }

        res.json({ success: true, message: 'Đã tạo khách hàng', data: customer });
    } catch (error) {
        next(error);
    }
});

router.post('/import', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn file CSV' });
        }
        const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
        const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
        if (lines.length < 2) {
            return res.status(400).json({ success: false, message: 'File không có dữ liệu khách hàng' });
        }
        const split = line => line.split(',').map(value => value.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
        const headers = split(lines[0]).map(item => item.toLowerCase());
        let imported = 0;

        for (const line of lines.slice(1)) {
            const values = split(line);
            const row = headers.reduce((acc, header, index) => {
                acc[header] = values[index] || '';
                return acc;
            }, {});
            const name = row.ten_khach_hang || row.ten || row.name;
            if (!name) continue;
            const code = row.ma_khach_hang || row.ma || await nextCustomerCode();
            const exists = await KhachHang.findOne({ ma_khach_hang: code });
            if (exists) continue;
            await KhachHang.create({
                ma_khach_hang: code,
                ten_khach_hang: name,
                sdt: row.sdt || row.dien_thoai || row.phone,
                email: row.email,
                dia_chi_nhan: row.dia_chi_nhan || row.dia_chi || row.address,
                loai_khach_hang: row.loai_khach_hang === 'cong_ty' ? 'cong_ty' : 'ca_nhan',
                nguoi_tao_id: req.user?._id,
                trang_thai: 'active'
            });
            imported += 1;
        }

        res.json({ success: true, message: `Đã import ${imported} khách hàng` });
    } catch (error) {
        next(error);
    }
});

router.put('/:id', async (req, res, next) => {
    try {
        const body = req.body || {};
        if (!body.ten_khach_hang || body.ten_khach_hang.trim() === '') {
            return res.status(400).json({ success: false, message: 'Tên khách hàng là bắt buộc' });
        }
        const customer = await KhachHang.findByIdAndUpdate(req.params.id, {
            ten_khach_hang: body.ten_khach_hang.trim(),
            sdt: body.sdt?.trim(),
            sdt2: body.sdt2?.trim(),
            email: body.email?.trim(),
            facebook: body.facebook?.trim(),
            ngay_sinh: body.ngay_sinh || null,
            gioi_tinh: body.gioi_tinh || '',
            loai_khach_hang: body.loai_khach_hang || 'ca_nhan',
            dia_chi_nhan: body.dia_chi_nhan?.trim(),
            tinh_thanh: body.tinh_thanh?.trim(),
            quan_huyen: body.quan_huyen?.trim(),
            phuong_xa: body.phuong_xa?.trim(),
            ghi_chu: body.ghi_chu?.trim(),
            ten_nguoi_mua: body.ten_nguoi_mua?.trim(),
            ten_cong_ty: body.ten_cong_ty?.trim(),
            ma_so_thue: body.ma_so_thue?.trim(),
            nhom_khach_hang_id: body.nhom_khach_hang_id || null
        }, { new: true });
        if (!customer) return res.status(404).json({ success: false, message: 'Không tìm thấy khách hàng' });

        await DiaChiKhachHang.findOneAndUpdate(
            { khach_hang_id: customer._id, mac_dinh: true },
            {
                khach_hang_id: customer._id,
                dia_chi: body.dia_chi_nhan?.trim(),
                tinh_thanh: body.tinh_thanh?.trim(),
                quan_huyen: body.quan_huyen?.trim(),
                phuong_xa: body.phuong_xa?.trim(),
                mac_dinh: true
            },
            { upsert: true, new: true }
        );

        res.json({ success: true, message: 'Đã cập nhật khách hàng', data: customer });
    } catch (error) {
        next(error);
    }
});

router.delete('/:id', async (req, res, next) => {
    try {
        const customer = await KhachHang.findByIdAndUpdate(req.params.id, { trang_thai: 'inactive' }, { new: true });
        if (!customer) return res.status(404).json({ success: false, message: 'Không tìm thấy khách hàng' });
        res.json({ success: true, message: 'Đã ngừng hoạt động khách hàng' });
    } catch (error) {
        next(error);
    }
});

router.post('/groups/add', async (req, res, next) => {
    try {
        const { ten_nhom, mo_ta } = req.body || {};
        if (!ten_nhom || ten_nhom.trim() === '') {
            return res.status(400).json({ success: false, message: 'Tên nhóm khách hàng là bắt buộc' });
        }
        const group = await NhomKhachHang.create({ ten_nhom: ten_nhom.trim(), mo_ta: mo_ta?.trim() });
        res.json({ success: true, message: 'Đã tạo nhóm khách hàng', data: group });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
