const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const {
    PhieuThuChi,
    SoQuy,
    KhachHang,
    NhaCungCap,
    CuaHang,
    CongNoKhachHang,
    CongNoNhaCungCap,
    NguoiDung
} = require('../models/kiot.model');

router.use(isAuthenticated);

function parseMoney(value) {
    return Number(String(value || '').replace(/\./g, '').replace(/,/g, '')) || 0;
}

function buildFilter(query = {}) {
    const filter = {};
    if (query.q && query.q.trim() !== '') {
        filter.ma_phieu = { $regex: query.q.trim(), $options: 'i' };
    }
    if (query.loai_phieu && ['thu', 'chi'].includes(query.loai_phieu)) {
        filter.loai_phieu = query.loai_phieu;
    }
    if (query.so_quy_id && query.so_quy_id !== 'all' && /^[0-9a-fA-F]{24}$/.test(query.so_quy_id)) {
        filter.so_quy_id = query.so_quy_id;
    }
    if (query.doi_tuong_search && query.doi_tuong_search.trim() !== '') {
        filter.doi_tuong = { $regex: query.doi_tuong_search.trim(), $options: 'i' };
    }
    if (query.loai_thu_chi && query.loai_thu_chi.trim() !== '') {
        filter.loai_thu_chi = { $regex: query.loai_thu_chi.trim(), $options: 'i' };
    }
    if (query.trang_thai && query.trang_thai !== 'all') {
        filter.trang_thai = query.trang_thai;
    }
    if (query.hach_toan === 'yes') filter.hach_toan = true;
    if (query.hach_toan === 'no') filter.hach_toan = false;
    const dateFrom = query.date_from ? new Date(query.date_from + 'T00:00:00') : null;
    const dateTo = query.date_to ? new Date(query.date_to + 'T23:59:59') : null;
    if (dateFrom || dateTo || query.time_type === 'this_month') {
        filter.ngay_lap = {};
        if (query.time_type === 'this_month') {
            const now = new Date();
            filter.ngay_lap.$gte = new Date(now.getFullYear(), now.getMonth(), 1);
            filter.ngay_lap.$lte = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        }
        if (dateFrom && !Number.isNaN(dateFrom.getTime())) filter.ngay_lap.$gte = dateFrom;
        if (dateTo && !Number.isNaN(dateTo.getTime())) filter.ngay_lap.$lte = dateTo;
    }
    if (query.nguoi_tao && /^[0-9a-fA-F]{24}$/.test(query.nguoi_tao)) {
        filter.nguoi_tao_id = query.nguoi_tao;
    }
    if (query.doi_tuong_loai === 'khach_hang') filter.khach_hang_id = { $ne: null };
    if (query.doi_tuong_loai === 'nha_cung_cap') filter.nha_cung_cap_id = { $ne: null };
    if (query.doi_tuong_loai === 'khac') {
        filter.khach_hang_id = null;
        filter.nha_cung_cap_id = null;
    }
    return filter;
}

async function ensureCashBook() {
    let cashBook = await SoQuy.findOne({ loai: 'cash' });
    if (!cashBook) {
        const store = await CuaHang.findOne().sort({ created_at: 1 });
        cashBook = await SoQuy.create({
            ten_so_quy: 'Sổ tiền mặt',
            loai: 'cash',
            so_du: 0,
            trang_thai: 'active',
            cua_hang_id: store?._id || null
        });
    }
    return cashBook;
}

router.get('/', async (req, res, next) => {
    try {
        const cashBook = await ensureCashBook();
        const selectedCashBook = req.query.so_quy_id && req.query.so_quy_id !== 'all' && /^[0-9a-fA-F]{24}$/.test(req.query.so_quy_id)
            ? (await SoQuy.findById(req.query.so_quy_id)) || cashBook
            : cashBook;
        const filter = buildFilter(req.query);
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
        if (req.query?.doi_tuong_phone && req.query.doi_tuong_phone.trim() !== '') {
            const phone = req.query.doi_tuong_phone.trim();
            const [phoneCustomers, phoneSuppliers] = await Promise.all([
                KhachHang.find({ sdt: { $regex: phone, $options: 'i' } }).select('_id'),
                NhaCungCap.find({ sdt: { $regex: phone, $options: 'i' } }).select('_id')
            ]);
            filter.$or = [
                { khach_hang_id: { $in: phoneCustomers.map(item => item._id) } },
                { nha_cung_cap_id: { $in: phoneSuppliers.map(item => item._id) } }
            ];
        }
        if (!filter.so_quy_id) filter.so_quy_id = selectedCashBook._id;

        const [list, cashBooks, customers, suppliers, users, totals] = await Promise.all([
            PhieuThuChi.find(filter)
                .populate('cua_hang_id')
                .populate('nguoi_tao_id')
                .populate('khach_hang_id')
                .populate('nha_cung_cap_id')
                .populate('so_quy_id')
                .sort({ ngay_lap: -1 }),
            SoQuy.find({ trang_thai: 'active' }).sort({ ten_so_quy: 1 }),
            KhachHang.find({ trang_thai: { $ne: 'inactive' } }).sort({ ten_khach_hang: 1 }),
            NhaCungCap.find({ trang_thai: 'active' }).sort({ ten_ncc: 1 }),
            NguoiDung.find().sort({ ho_ten: 1, username: 1 }),
            PhieuThuChi.aggregate([
                { $match: { so_quy_id: selectedCashBook._id } },
                { $group: { _id: '$loai_phieu', total: { $sum: '$gia_tri' } } }
            ])
        ]);

        const totalMap = new Map(totals.map(item => [item._id, item.total || 0]));
        const summary = {
            opening: 0,
            totalThu: totalMap.get('thu') || 0,
            totalChi: totalMap.get('chi') || 0,
            balance: typeof selectedCashBook.so_du === 'number'
                ? selectedCashBook.so_du
                : ((totalMap.get('thu') || 0) - (totalMap.get('chi') || 0))
        };

        res.render('so-quy/index', {
            title: 'Sổ quỹ tiền mặt',
            list,
            cashBooks,
            customers,
            suppliers,
            users,
            selectedCashBook,
            summary,
            filters: req.query || {}
        });
    } catch (error) {
        next(error);
    }
});

router.get('/export.csv', async (req, res, next) => {
    try {
        const list = await PhieuThuChi.find(buildFilter(req.query)).populate('so_quy_id').sort({ ngay_lap: -1 });
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['ma_phieu', 'thoi_gian', 'loai_phieu', 'loai_thu_chi', 'doi_tuong', 'gia_tri', 'so_quy', 'ghi_chu'],
            ...list.map(item => [
                item.ma_phieu,
                item.ngay_lap ? item.ngay_lap.toISOString() : '',
                item.loai_phieu,
                item.loai_thu_chi || '',
                item.doi_tuong,
                item.gia_tri || 0,
                item.so_quy_id?.ten_so_quy || '',
                item.ghi_chu || ''
            ])
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="so-quy.csv"');
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
});

router.post('/add', async (req, res, next) => {
    try {
        const {
            loai_phieu,
            ma_phieu,
            ngay_lap,
            loai_thu_chi,
            doi_tuong_loai,
            doi_tuong_id,
            doi_tuong,
            gia_tri,
            so_quy_id,
            ghi_chu,
            tinh_cong_no
        } = req.body || {};

        if (!['thu', 'chi'].includes(loai_phieu)) {
            return res.status(400).json({ success: false, message: 'Loại phiếu không hợp lệ' });
        }

        const amount = parseMoney(gia_tri);
        if (amount <= 0) {
            return res.status(400).json({ success: false, message: 'Số tiền phải lớn hơn 0' });
        }

        const cashBook = so_quy_id && /^[0-9a-fA-F]{24}$/.test(so_quy_id)
            ? await SoQuy.findById(so_quy_id)
            : await ensureCashBook();
        if (!cashBook) {
            return res.status(400).json({ success: false, message: 'Không tìm thấy sổ quỹ' });
        }

        const count = await PhieuThuChi.countDocuments({ loai_phieu });
        const code = ma_phieu && ma_phieu.trim() !== '' ? ma_phieu.trim() : (loai_phieu === 'thu' ? 'PT' : 'PC') + String(count + 1).padStart(6, '0');
        let customerId = null;
        let supplierId = null;
        let partnerName = doi_tuong?.trim() || '';

        if (doi_tuong_loai === 'khach_hang' && doi_tuong_id) {
            const customer = await KhachHang.findById(doi_tuong_id);
            customerId = customer?._id || null;
            partnerName = customer?.ten_khach_hang || partnerName;
        }
        if (doi_tuong_loai === 'nha_cung_cap' && doi_tuong_id) {
            const supplier = await NhaCungCap.findById(doi_tuong_id);
            supplierId = supplier?._id || null;
            partnerName = supplier?.ten_ncc || partnerName;
        }
        if (!partnerName) partnerName = 'Khác';

        const receipt = await PhieuThuChi.create({
            ma_phieu: code,
            ngay_lap: ngay_lap ? new Date(ngay_lap) : new Date(),
            loai_phieu,
            loai_thu_chi: loai_thu_chi || (loai_phieu === 'thu' ? 'Thu khác' : 'Chi khác'),
            gia_tri: amount,
            doi_tuong: partnerName,
            ghi_chu,
            trang_thai: 'paid',
            hach_toan: tinh_cong_no === true || tinh_cong_no === 'true' || tinh_cong_no === 'on',
            cua_hang_id: cashBook.cua_hang_id || null,
            so_quy_id: cashBook._id,
            nguoi_tao_id: req.user?._id,
            khach_hang_id: customerId,
            nha_cung_cap_id: supplierId
        });

        await SoQuy.findByIdAndUpdate(cashBook._id, { $inc: { so_du: loai_phieu === 'thu' ? amount : -amount } });

        const shouldDebt = tinh_cong_no === true || tinh_cong_no === 'true' || tinh_cong_no === 'on';
        if (shouldDebt && customerId) {
            const change = loai_phieu === 'thu' ? -amount : amount;
            await KhachHang.findByIdAndUpdate(customerId, { $inc: { tong_no: change } });
            await CongNoKhachHang.create({
                khach_hang_id: customerId,
                phieu_thu_chi_id: receipt._id,
                so_tien: change,
                loai: loai_phieu,
                ghi_chu: ghi_chu || `Phiếu ${loai_phieu}`,
                ngay: receipt.ngay_lap
            });
        }
        if (shouldDebt && supplierId) {
            const change = loai_phieu === 'chi' ? -amount : amount;
            await NhaCungCap.findByIdAndUpdate(supplierId, { $inc: { tong_no: change } });
            await CongNoNhaCungCap.create({
                nha_cung_cap_id: supplierId,
                phieu_thu_chi_id: receipt._id,
                so_tien: change,
                loai: loai_phieu,
                ghi_chu: ghi_chu || `Phiếu ${loai_phieu}`,
                ngay: receipt.ngay_lap
            });
        }

        res.json({ success: true, message: `Đã tạo phiếu ${loai_phieu === 'thu' ? 'thu' : 'chi'}`, data: receipt });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: 'Mã phiếu đã tồn tại' });
        }
        next(error);
    }
});

module.exports = router;
