const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const {
    PhieuThuChi,
    SoQuy,
    KhachHang,
    NhaCungCap,
    NguoiDung,
    DonHang,
    HoaDonBanHang,
    PhieuNhap,
    PhieuTraHangNhap,
    VanDon
} = require('../models/kiot.model');
const { taoPhieuThuChi, ensureDefaultSoQuy, parseMoney } = require('../services/soQuy.service');

router.use(isAuthenticated);

function isObjectId(value) {
    return /^[0-9a-fA-F]{24}$/.test(String(value || ''));
}

function buildFilter(query = {}) {
    const filter = {};
    if (query.q && query.q.trim() !== '') filter.ma_phieu = { $regex: query.q.trim(), $options: 'i' };
    if (query.loai_phieu && ['thu', 'chi'].includes(query.loai_phieu)) filter.loai_phieu = query.loai_phieu;
    if (query.so_quy_id && query.so_quy_id !== 'all' && isObjectId(query.so_quy_id)) filter.so_quy_id = query.so_quy_id;
    if (query.doi_tuong_search && query.doi_tuong_search.trim() !== '') filter.doi_tuong = { $regex: query.doi_tuong_search.trim(), $options: 'i' };
    if (query.loai_thu_chi && query.loai_thu_chi.trim() !== '') filter.loai_thu_chi = { $regex: query.loai_thu_chi.trim(), $options: 'i' };
    if (query.trang_thai && query.trang_thai !== 'all') filter.trang_thai = query.trang_thai;
    if (query.hach_toan === 'yes') filter.hach_toan = true;
    if (query.hach_toan === 'no') filter.hach_toan = false;
    if (query.nhom_doi_tuong && query.nhom_doi_tuong !== 'all') filter.nhom_doi_tuong = query.nhom_doi_tuong;
    if (query.phuong_thuc_thanh_toan && query.phuong_thuc_thanh_toan !== 'all') filter.phuong_thuc_thanh_toan = query.phuong_thuc_thanh_toan;

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
    if (query.nguoi_tao && isObjectId(query.nguoi_tao)) filter.nguoi_tao_id = query.nguoi_tao;
    if (query.doi_tuong_loai === 'khach_hang') filter.khach_hang_id = { $ne: null };
    if (query.doi_tuong_loai === 'nha_cung_cap') filter.nha_cung_cap_id = { $ne: null };
    if (query.doi_tuong_loai === 'khac') {
        filter.khach_hang_id = null;
        filter.nha_cung_cap_id = null;
    }
    return filter;
}

async function ensureCashBook(cuaHangId) {
    return ensureDefaultSoQuy(cuaHangId);
}

function getPeriodStart(query = {}) {
    if (query.date_from) {
        const from = new Date(query.date_from + 'T00:00:00');
        if (!Number.isNaN(from.getTime())) return from;
    }
    if (query.time_type === 'this_month') {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    return null;
}

async function loadRelatedDocuments() {
    const [orders, invoices, purchases, purchaseReturns, shipments] = await Promise.all([
        DonHang.find().select('ma_don_hang khach_hang_id tong_thanh_toan tong_tien').populate('khach_hang_id').sort({ created_at: -1 }).limit(80).lean(),
        HoaDonBanHang.find().select('ma_hoa_don khach_hang_id don_hang_id thanh_toan tong_tien').populate('khach_hang_id').sort({ created_at: -1 }).limit(80).lean(),
        PhieuNhap.find().select('ma_phieu_nhap nha_cung_cap_id can_tra_ncc da_tra_ncc con_no_ncc tong_tien').populate('nha_cung_cap_id').sort({ created_at: -1 }).limit(80).lean(),
        PhieuTraHangNhap.find().select('ma_phieu_tra_nhap nha_cung_cap_id phieu_nhap_id ncc_can_tra ncc_da_tra').populate('nha_cung_cap_id').sort({ created_at: -1 }).limit(80).lean(),
        VanDon.find().select('ma_van_don khach_hang_id doi_tac_giao_hang_id don_hang_id hoa_don_id cod_amount phi_giao_hang').populate('khach_hang_id').populate('doi_tac_giao_hang_id').sort({ created_at: -1 }).limit(80).lean()
    ]);
    return { orders, invoices, purchases, purchaseReturns, shipments };
}

function relatedCode(item) {
    return item.don_hang_id?.ma_don_hang
        || item.hoa_don_id?.ma_hoa_don
        || item.phieu_nhap_id?.ma_phieu_nhap
        || item.phieu_tra_hang_nhap_id?.ma_phieu_tra_nhap
        || item.van_don_id?.ma_van_don
        || item.ma_chung_tu_goc
        || '';
}

router.get('/', async (req, res, next) => {
    try {
        const cashBook = await ensureCashBook();
        const selectedCashBook = req.query.so_quy_id && req.query.so_quy_id !== 'all' && isObjectId(req.query.so_quy_id)
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
        filter.so_quy_id = selectedCashBook._id;

        const [list, cashBooks, customers, suppliers, users, relatedDocuments] = await Promise.all([
            PhieuThuChi.find(filter)
                .populate('cua_hang_id')
                .populate('nguoi_tao_id')
                .populate('khach_hang_id')
                .populate('nha_cung_cap_id')
                .populate('so_quy_id')
                .populate('don_hang_id')
                .populate('hoa_don_id')
                .populate('phieu_nhap_id')
                .populate('phieu_tra_hang_nhap_id')
                .populate('van_don_id')
                .sort({ ngay_lap: -1 }),
            SoQuy.find({ trang_thai: 'active' }).sort({ ten_so_quy: 1 }),
            KhachHang.find({ trang_thai: { $ne: 'inactive' } }).sort({ ten_khach_hang: 1 }),
            NhaCungCap.find({ trang_thai: 'active' }).sort({ ten_ncc: 1 }),
            NguoiDung.find().sort({ ho_ten: 1, username: 1 }),
            loadRelatedDocuments()
        ]);

        const periodStart = getPeriodStart(req.query);
        const openingFilter = { so_quy_id: selectedCashBook._id };
        if (periodStart) openingFilter.ngay_lap = { $lt: periodStart };
        const [openingRows, periodTotals] = await Promise.all([
            periodStart
                ? PhieuThuChi.aggregate([
                    { $match: openingFilter },
                    { $group: { _id: '$loai_phieu', total: { $sum: '$gia_tri' } } }
                ])
                : [],
            PhieuThuChi.aggregate([
                { $match: filter },
                { $group: { _id: '$loai_phieu', total: { $sum: '$gia_tri' } } }
            ])
        ]);
        const openingMap = new Map(openingRows.map(item => [item._id, item.total || 0]));
        const totalMap = new Map(periodTotals.map(item => [item._id, item.total || 0]));
        const opening = periodStart ? (openingMap.get('thu') || 0) - (openingMap.get('chi') || 0) : 0;
        const totalThu = totalMap.get('thu') || 0;
        const totalChi = totalMap.get('chi') || 0;
        const summary = {
            opening,
            totalThu,
            totalChi,
            balance: opening + totalThu - totalChi
        };

        res.render('so-quy/index', {
            title: 'So quy tien mat',
            list,
            cashBooks,
            customers,
            suppliers,
            users,
            relatedDocuments,
            selectedCashBook,
            summary,
            filters: req.query || {},
            relatedCode
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
            ['ma_phieu', 'thoi_gian', 'loai_phieu', 'loai_thu_chi', 'doi_tuong', 'gia_tri', 'so_quy', 'chung_tu_lien_quan', 'phuong_thuc_thanh_toan', 'ghi_chu'],
            ...list.map(item => [
                item.ma_phieu,
                item.ngay_lap ? item.ngay_lap.toISOString() : '',
                item.loai_phieu,
                item.loai_thu_chi || '',
                item.doi_tuong,
                item.gia_tri || 0,
                item.so_quy_id?.ten_so_quy || '',
                item.ma_chung_tu_goc || '',
                item.phuong_thuc_thanh_toan || '',
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
        const cashBook = req.body?.so_quy_id && isObjectId(req.body.so_quy_id)
            ? await SoQuy.findById(req.body.so_quy_id)
            : await ensureCashBook(req.body?.cua_hang_id);
        if (!cashBook) return res.status(400).json({ success: false, message: 'Khong tim thay so quy' });

        const receipt = await taoPhieuThuChi({
            ...req.body,
            gia_tri: parseMoney(req.body?.gia_tri),
            so_quy_id: cashBook._id,
            cua_hang_id: req.body?.cua_hang_id || cashBook.cua_hang_id || undefined,
            nguoi_tao_id: req.user?._id,
            hach_toan: req.body?.hach_toan === true || req.body?.hach_toan === 'true' || req.body?.hach_toan === 'on'
                || req.body?.tinh_cong_no === true || req.body?.tinh_cong_no === 'true' || req.body?.tinh_cong_no === 'on'
        });
        res.json({ success: true, message: `Da tao phieu ${receipt.loai_phieu}`, data: receipt });
    } catch (error) {
        if (error.code === 11000) return res.status(400).json({ success: false, message: 'Ma phieu da ton tai' });
        return res.status(400).json({ success: false, message: error.message || 'Khong tao duoc phieu' });
    }
});

module.exports = router;
