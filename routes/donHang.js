const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const {
    DonHang,
    CTDonHang,
    HoaDonBanHang,
    CTHoaDonBanHang,
    PhieuTraHang,
    CTPhieuTraHang,
    HangHoa,
    KhachHang,
    DiaChiKhachHang,
    CuaHang,
    NguoiDung,
    DoiTacGiaoHang,
    VanDon,
    PhieuThuChi,
    CongNoKhachHang
} = require('../models/kiot.model');

router.use(isAuthenticated);

function buildOrderFilter(query = {}) {
    const filter = {};
    if (query.q && query.q.trim() !== '') {
        filter.ma_don_hang = { $regex: query.q.trim(), $options: 'i' };
    }
    const statuses = Array.isArray(query.trang_thai) ? query.trang_thai : (query.trang_thai ? [query.trang_thai] : []);
    const cleanStatuses = statuses.filter(item => item && item !== 'all');
    if (cleanStatuses.length) {
        filter.trang_thai = { $in: cleanStatuses };
    }
    const dateFrom = query.date_from ? new Date(query.date_from + 'T00:00:00') : null;
    const dateTo = query.date_to ? new Date(query.date_to + 'T23:59:59') : null;
    if (query.time_type === 'this_month') {
        const now = new Date();
        filter.ngay_dat = { $gte: new Date(now.getFullYear(), now.getMonth(), 1), $lte: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59) };
    } else if (dateFrom || dateTo) {
        filter.ngay_dat = {};
        if (dateFrom && !Number.isNaN(dateFrom.getTime())) filter.ngay_dat.$gte = dateFrom;
        if (dateTo && !Number.isNaN(dateTo.getTime())) filter.ngay_dat.$lte = dateTo;
    }
    if (query.nguoi_tao && /^[0-9a-fA-F]{24}$/.test(query.nguoi_tao)) {
        filter.nguoi_tao_id = query.nguoi_tao;
    }
    return filter;
}

async function buildShipmentOrderFilter(query = {}) {
    const shipmentFilter = {};
    if (query.doi_tac && query.doi_tac !== 'all') shipmentFilter.doi_tac_giao_hang_id = query.doi_tac;
    if (query.khu_vuc && query.khu_vuc.trim() !== '') shipmentFilter.dia_chi_nhan = { $regex: query.khu_vuc.trim(), $options: 'i' };
    if (query.nguoi_nhan && query.nguoi_nhan.trim() !== '') shipmentFilter.ten_nguoi_nhan = { $regex: query.nguoi_nhan.trim(), $options: 'i' };

    const deliveryFrom = query.delivery_from ? new Date(query.delivery_from + 'T00:00:00') : null;
    const deliveryTo = query.delivery_to ? new Date(query.delivery_to + 'T23:59:59') : null;
    if (deliveryFrom || deliveryTo) {
        shipmentFilter.created_at = {};
        if (deliveryFrom && !Number.isNaN(deliveryFrom.getTime())) shipmentFilter.created_at.$gte = deliveryFrom;
        if (deliveryTo && !Number.isNaN(deliveryTo.getTime())) shipmentFilter.created_at.$lte = deliveryTo;
    }

    if (!Object.keys(shipmentFilter).length) return null;
    const shipments = await VanDon.find(shipmentFilter).select('don_hang_id');
    return shipments.map(item => item.don_hang_id).filter(Boolean);
}

function applyOrderIdFilter(filter, ids) {
    if (!filter._id) {
        filter._id = { $in: ids };
        return;
    }
    const currentIds = (filter._id.$in || []).map(id => String(id));
    const allowed = new Set(ids.map(id => String(id)));
    filter._id.$in = currentIds.filter(id => allowed.has(id));
}

function toArray(value) {
    if (value === undefined || value === null || value === '') return [];
    return Array.isArray(value) ? value : [value];
}

function cleanArray(value) {
    return toArray(value).filter(item => item && item !== 'all');
}

function dateRange(query = {}, fromKey, toKey, fallbackThisMonth) {
    const range = {};
    if (fallbackThisMonth) {
        const now = new Date();
        range.$gte = new Date(now.getFullYear(), now.getMonth(), 1);
        range.$lte = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    }
    const from = query[fromKey] ? new Date(query[fromKey] + 'T00:00:00') : null;
    const to = query[toKey] ? new Date(query[toKey] + 'T23:59:59') : null;
    if (from && !Number.isNaN(from.getTime())) range.$gte = from;
    if (to && !Number.isNaN(to.getTime())) range.$lte = to;
    return Object.keys(range).length ? range : null;
}

function applyIdIntersection(filter, field, ids) {
    const cleanIds = ids.filter(Boolean);
    if (!filter[field]) {
        filter[field] = { $in: cleanIds };
        return;
    }
    const currentIds = (filter[field].$in || []).map(id => String(id));
    const allowed = new Set(cleanIds.map(id => String(id)));
    filter[field].$in = currentIds.filter(id => allowed.has(id));
}

async function userIdFilter(value) {
    if (!value || value.trim() === '') return null;
    if (/^[0-9a-fA-F]{24}$/.test(value)) return [value];
    const users = await NguoiDung.find({
        $or: [
            { ho_ten: { $regex: value.trim(), $options: 'i' } },
            { username: { $regex: value.trim(), $options: 'i' } },
            { email: { $regex: value.trim(), $options: 'i' } }
        ]
    }).select('_id');
    return users.map(user => user._id);
}

async function buildInvoiceFilter(query = {}) {
    const filter = {};
    if (query.q && query.q.trim() !== '') {
        filter.ma_hoa_don = { $regex: query.q.trim(), $options: 'i' };
    }
    const statuses = cleanArray(query.trang_thai);
    if (statuses.length) filter.trang_thai = { $in: statuses };

    const saleRange = dateRange(query, 'date_from', 'date_to', query.time_type === 'this_month');
    if (saleRange) filter.ngay_ban = saleRange;
    if (query.phuong_thuc_tt && query.phuong_thuc_tt.trim() !== '') filter.phuong_thuc_tt = query.phuong_thuc_tt.trim();

    const sellerIds = await userIdFilter(query.nguoi_ban || query.nguoi_tao || '');
    if (sellerIds) filter.nguoi_ban_id = { $in: sellerIds };

    const shipmentFilter = {};
    if (query.doi_tac && query.doi_tac !== 'all') shipmentFilter.doi_tac_giao_hang_id = query.doi_tac;
    if (query.trang_thai_giao_hang && query.trang_thai_giao_hang !== 'all') shipmentFilter.trang_thai = query.trang_thai_giao_hang;
    if (query.khu_vuc && query.khu_vuc.trim() !== '') shipmentFilter.dia_chi_nhan = { $regex: query.khu_vuc.trim(), $options: 'i' };
    const deliveryRange = dateRange(query, 'delivery_from', 'delivery_to', false);
    if (deliveryRange) shipmentFilter.created_at = deliveryRange;

    const invoiceTypes = cleanArray(query.loai_hoa_don);
    const needsShipmentLookup = Object.keys(shipmentFilter).length || invoiceTypes.length;
    if (needsShipmentLookup) {
        const shipments = await VanDon.find(shipmentFilter).select('hoa_don_id');
        const shipmentInvoiceIds = shipments.map(item => item.hoa_don_id).filter(Boolean);
        if (invoiceTypes.includes('giao_hang') && !invoiceTypes.includes('khong_giao_hang')) {
            applyIdIntersection(filter, '_id', shipmentInvoiceIds);
        } else if (invoiceTypes.includes('khong_giao_hang') && !invoiceTypes.includes('giao_hang')) {
            filter._id = filter._id || {};
            filter._id.$nin = shipmentInvoiceIds;
        } else if (Object.keys(shipmentFilter).length) {
            applyIdIntersection(filter, '_id', shipmentInvoiceIds);
        }
    }

    return filter;
}

async function buildReturnFilter(query = {}) {
    const filter = {};
    if (query.q && query.q.trim() !== '') filter.ma_phieu_tra = { $regex: query.q.trim(), $options: 'i' };
    const statuses = cleanArray(query.trang_thai);
    if (statuses.length) filter.trang_thai = { $in: statuses };
    const returnRange = dateRange(query, 'date_from', 'date_to', query.time_type === 'this_month');
    if (returnRange) filter.ngay_tra = returnRange;
    const creatorIds = await userIdFilter(query.nguoi_tao || '');
    if (creatorIds) filter.nguoi_tao_id = { $in: creatorIds };
    const types = cleanArray(query.loai_tra_hang);
    if (types.includes('theo_hoa_don') && !types.includes('tra_nhanh')) filter.hoa_don_id = { $ne: null };
    if (types.includes('tra_nhanh') && !types.includes('theo_hoa_don')) filter.hoa_don_id = null;
    if (query.nguoi_nhan_tra && query.nguoi_nhan_tra.trim() !== '') {
        const customers = await KhachHang.find({
            $or: [
                { ma_khach_hang: { $regex: query.nguoi_nhan_tra.trim(), $options: 'i' } },
                { ten_khach_hang: { $regex: query.nguoi_nhan_tra.trim(), $options: 'i' } },
                { sdt: { $regex: query.nguoi_nhan_tra.trim(), $options: 'i' } }
            ]
        }).select('_id');
        filter.khach_hang_id = { $in: customers.map(item => item._id) };
    }
    return filter;
}

async function getOrderCreateData() {
    const [customersRaw, products, stores, partners, addresses] = await Promise.all([
        KhachHang.find().sort({ ten_khach_hang: 1 }),
        HangHoa.find({ trang_thai: 'active' }).sort({ ten_hang: 1 }),
        CuaHang.find().sort({ ten_cua_hang: 1 }),
        DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ ten_doi_tac: 1 }),
        DiaChiKhachHang.find()
    ]);

    const addressesByCustomer = addresses.reduce((acc, address) => {
        const key = String(address.khach_hang_id);
        if (!acc[key]) acc[key] = [];
        acc[key].push(address);
        return acc;
    }, {});

    const customers = customersRaw.map(customer => {
        const data = customer.toObject();
        data.dia_chi_list = addressesByCustomer[String(customer._id)] || [];
        return data;
    });

    return { customers, products, stores, partners };
}

router.get('/', async (req, res, next) => {
    try {
        const filter = buildOrderFilter(req.query);
        const shipmentOrderIds = await buildShipmentOrderFilter(req.query);
        if (shipmentOrderIds) filter._id = { $in: shipmentOrderIds };

        if (req.query?.phuong_thuc_tt && req.query.phuong_thuc_tt.trim() !== '') {
            const invoices = await HoaDonBanHang.find({ phuong_thuc_tt: req.query.phuong_thuc_tt.trim(), don_hang_id: { $ne: null } }).select('don_hang_id');
            applyOrderIdFilter(filter, invoices.map(item => item.don_hang_id).filter(Boolean));
        }

        if (req.query?.nguoi_tao && req.query.nguoi_tao.trim() !== '' && !filter.nguoi_tao_id) {
            const usersByName = await NguoiDung.find({
                $or: [
                    { ho_ten: { $regex: req.query.nguoi_tao.trim(), $options: 'i' } },
                    { username: { $regex: req.query.nguoi_tao.trim(), $options: 'i' } }
                ]
            }).select('_id');
            filter.nguoi_tao_id = { $in: usersByName.map(user => user._id) };
        }

        const orders = await DonHang.find(filter)
            .populate('khach_hang_id')
            .populate('cua_hang_id')
            .populate('nguoi_tao_id')
            .sort({ created_at: -1 });

        const [partners, users] = await Promise.all([
            DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ ten_doi_tac: 1 }),
            NguoiDung.find().sort({ ho_ten: 1, username: 1 })
        ]);
        res.render('don-hang/index', {
            title: 'Đặt hàng',
            orders,
            partners,
            users,
            filters: req.query || {}
        });
    } catch (error) {
        next(error);
    }
});

router.get('/export.csv', async (req, res, next) => {
    try {
        const orders = await DonHang.find(buildOrderFilter(req.query)).populate('khach_hang_id').sort({ created_at: -1 });
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['ma_don_hang', 'thoi_gian', 'ma_khach_hang', 'khach_hang', 'khach_can_tra', 'trang_thai'],
            ...orders.map(order => [
                order.ma_don_hang,
                order.ngay_dat ? order.ngay_dat.toISOString() : '',
                order.khach_hang_id?.ma_khach_hang || '',
                order.khach_hang_id?.ten_khach_hang || '',
                order.tong_thanh_toan || order.tong_tien || 0,
                order.trang_thai || ''
            ])
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="dat-hang.csv"');
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
});

router.get('/create', async (req, res, next) => {
    try {
        const data = await getOrderCreateData();
        res.render('don-hang/create', { title: 'Đặt hàng', ...data });
    } catch (error) {
        next(error);
    }
});

router.post('/add', async (req, res, next) => {
    try {
        const {
            khach_hang_id,
            cua_hang_id,
            items,
            chiet_khau,
            phi_van_chuyen,
            ghi_chu,
            trang_thai,
            doi_tac_giao_hang_id,
            ten_nguoi_nhan,
            sdt_nguoi_nhan,
            dia_chi_nhan,
            ghi_chu_giao_hang,
            thu_ho_cod
        } = req.body || {};

        if (!Array.isArray(items) || !items.length) {
            return res.status(400).json({ success: false, message: 'Đơn hàng chưa có sản phẩm' });
        }

        let tong_tien_hang = 0;
        items.forEach(item => {
            tong_tien_hang += Number(item.so_luong) * Number(item.don_gia_ban);
        });

        const discount = Number(chiet_khau || 0);
        const shippingFee = Number(phi_van_chuyen || 0);
        const tong_thanh_toan = Math.max(tong_tien_hang - discount + shippingFee, 0);
        const count = await DonHang.countDocuments();
        const ma_don_hang = 'DH' + String(count + 1).padStart(6, '0');

        const order = await DonHang.create({
            ma_don_hang,
            khach_hang_id: khach_hang_id || null,
            cua_hang_id: cua_hang_id || null,
            nguoi_tao_id: req.user?._id,
            ngay_dat: new Date(),
            ngay_tao: new Date(),
            tong_tien: tong_thanh_toan,
            tong_tien_hang,
            tong_thanh_toan,
            trang_thai: trang_thai || 'draft',
            ghi_chu
        });

        for (const item of items) {
            await CTDonHang.create({
                don_hang_id: order._id,
                hang_hoa_id: item.hang_hoa_id,
                so_luong: Number(item.so_luong),
                don_gia_ban: Number(item.don_gia_ban),
                chiet_khau: Number(item.chiet_khau || 0),
                thanh_tien: Number(item.so_luong) * Number(item.don_gia_ban) - Number(item.chiet_khau || 0)
            });
        }

        const shipmentCount = await VanDon.countDocuments();
        await VanDon.create({
            ma_van_don: 'VD' + String(shipmentCount + 1).padStart(6, '0'),
            don_hang_id: order._id,
            doi_tac_giao_hang_id: doi_tac_giao_hang_id || null,
            cua_hang_id: cua_hang_id || null,
            khach_hang_id: khach_hang_id || null,
            ten_nguoi_nhan,
            sdt_nguoi_nhan,
            dia_chi_nhan,
            phi_giao_hang: shippingFee,
            ghi_chu: ghi_chu_giao_hang,
            trang_thai: 'draft'
        });

        res.json({ success: true, message: 'Đã tạo đơn đặt hàng', ma_don_hang });
    } catch (error) {
        next(error);
    }
});

router.get('/hoa-don', async (req, res, next) => {
    try {
        const filter = await buildInvoiceFilter(req.query);
        const invoices = await HoaDonBanHang.find(filter)
            .populate('khach_hang_id')
            .populate('don_hang_id')
            .populate('nguoi_ban_id')
            .sort({ created_at: -1 });
        const [partners, users] = await Promise.all([
            DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ ten_doi_tac: 1 }),
            NguoiDung.find().sort({ ho_ten: 1, username: 1 })
        ]);
        res.render('don-hang/hoa-don', { title: 'Hóa đơn', invoices, partners, users, filters: req.query || {} });
    } catch (error) {
        next(error);
    }
});

router.get('/hoa-don/export.csv', async (req, res, next) => {
    try {
        const invoices = await HoaDonBanHang.find(await buildInvoiceFilter(req.query)).populate('khach_hang_id').sort({ created_at: -1 });
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['ma_hoa_don', 'thoi_gian', 'ma_khach_hang', 'khach_hang', 'tong_tien_hang', 'giam_gia', 'khach_da_tra'],
            ...invoices.map(i => [
                i.ma_hoa_don,
                i.ngay_ban ? i.ngay_ban.toISOString() : '',
                i.khach_hang_id?.ma_khach_hang || '',
                i.khach_hang_id?.ten_khach_hang || '',
                i.tong_tien || 0,
                i.giam_gia || 0,
                i.thanh_toan || 0
            ])
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="hoa-don-ban-hang.csv"');
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
});

router.get('/hoa-don/create', async (req, res, next) => {
    try {
        const data = await getOrderCreateData();
        res.render('don-hang/hoa-don-create', { title: 'Hóa đơn', ...data });
    } catch (error) {
        next(error);
    }
});

router.get('/hoa-don/:id/detail', async (req, res, next) => {
    try {
        const invoice = await HoaDonBanHang.findById(req.params.id)
            .populate('khach_hang_id')
            .populate('cua_hang_id')
            .populate('nguoi_ban_id');
        if (!invoice) return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn' });

        const [items, shipment, debtHistory, receipts] = await Promise.all([
            CTHoaDonBanHang.find({ hoa_don_id: invoice._id }).populate('hang_hoa_id'),
            VanDon.findOne({ hoa_don_id: invoice._id }).populate('doi_tac_giao_hang_id').populate('cua_hang_id'),
            CongNoKhachHang.find({ hoa_don_id: invoice._id })
                .populate('phieu_thu_chi_id')
                .sort({ ngay: -1, created_at: -1 }),
            PhieuThuChi.find({ khach_hang_id: invoice.khach_hang_id, ngay_lap: { $gte: invoice.ngay_ban || invoice.created_at || new Date(0) } })
                .populate('nguoi_tao_id')
                .sort({ ngay_lap: -1, created_at: -1 })
                .limit(20)
        ]);

        res.json({ success: true, data: { invoice, items, shipment, debtHistory, receipts } });
    } catch (error) {
        next(error);
    }
});

router.post('/hoa-don/add', async (req, res, next) => {
    try {
        const {
            khach_hang_id,
            cua_hang_id,
            items,
            chiet_khau,
            phi_van_chuyen,
            ghi_chu,
            doi_tac_giao_hang_id,
            ten_nguoi_nhan,
            sdt_nguoi_nhan,
            dia_chi_nhan,
            ghi_chu_giao_hang,
            thu_ho_cod
        } = req.body || {};

        if (!Array.isArray(items) || !items.length) {
            return res.status(400).json({ success: false, message: 'Hóa đơn chưa có sản phẩm' });
        }
        if (!doi_tac_giao_hang_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn đối tác giao hàng' });
        }

        let tong_tien_hang = 0;
        items.forEach(item => {
            tong_tien_hang += Number(item.so_luong) * Number(item.don_gia_ban);
        });
        const discount = Number(chiet_khau || 0);
        const shippingFee = Number(phi_van_chuyen || 0);
        const thanh_toan = Math.max(tong_tien_hang - discount + shippingFee, 0);
        const count = await HoaDonBanHang.countDocuments();
        const ma_hoa_don = 'HD' + String(count + 1).padStart(6, '0');

        const invoice = await HoaDonBanHang.create({
            ma_hoa_don,
            ngay_ban: new Date(),
            tong_tien: tong_tien_hang,
            giam_gia: discount,
            thanh_toan,
            phuong_thuc_tt: thu_ho_cod === false ? 'Tiền mặt' : 'COD',
            trang_thai: 'processing',
            ghi_chu,
            cua_hang_id: cua_hang_id || null,
            khach_hang_id: khach_hang_id || null,
            nguoi_ban_id: req.user?._id
        });

        for (const item of items) {
            await CTHoaDonBanHang.create({
                hoa_don_id: invoice._id,
                hang_hoa_id: item.hang_hoa_id,
                so_luong: Number(item.so_luong),
                don_gia: Number(item.don_gia_ban),
                chiet_khau: Number(item.chiet_khau || 0),
                thanh_tien: Number(item.so_luong) * Number(item.don_gia_ban) - Number(item.chiet_khau || 0)
            });
            await HangHoa.findByIdAndUpdate(item.hang_hoa_id, { $inc: { ton_kho: -Number(item.so_luong) } });
        }

        const shipmentCount = await VanDon.countDocuments();
        await VanDon.create({
            ma_van_don: 'VD' + String(shipmentCount + 1).padStart(6, '0'),
            hoa_don_id: invoice._id,
            doi_tac_giao_hang_id,
            cua_hang_id: cua_hang_id || null,
            khach_hang_id: khach_hang_id || null,
            ten_nguoi_nhan,
            sdt_nguoi_nhan,
            dia_chi_nhan,
            phi_giao_hang: shippingFee,
            ghi_chu: ghi_chu_giao_hang,
            trang_thai: 'shipping'
        });

        res.json({ success: true, message: 'Đã tạo hóa đơn', ma_hoa_don });
    } catch (error) {
        next(error);
    }
});

router.get('/tra-hang', async (req, res, next) => {
    try {
        const filter = await buildReturnFilter(req.query);
        const returns = await PhieuTraHang.find(filter)
            .populate('hoa_don_id')
            .populate('khach_hang_id')
            .populate('nguoi_tao_id')
            .sort({ created_at: -1 });
        const users = await NguoiDung.find().sort({ ho_ten: 1, username: 1 });
        res.render('don-hang/tra-hang', { title: 'Trả hàng', returns, users, filters: req.query || {} });
    } catch (error) {
        next(error);
    }
});

router.get('/tra-hang/export.csv', async (req, res, next) => {
    try {
        const returns = await PhieuTraHang.find(await buildReturnFilter(req.query)).populate('khach_hang_id').populate('nguoi_tao_id').sort({ created_at: -1 });
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['ma_phieu_tra', 'thoi_gian', 'nguoi_ban', 'ma_khach_hang', 'khach_hang', 'can_tra_khach', 'trang_thai'],
            ...returns.map(item => [
                item.ma_phieu_tra,
                item.ngay_tra ? item.ngay_tra.toISOString() : '',
                item.nguoi_tao_id?.ho_ten || item.nguoi_tao_id?.username || '',
                item.khach_hang_id?.ma_khach_hang || '',
                item.khach_hang_id?.ten_khach_hang || '',
                item.tong_tien_tra || 0,
                item.trang_thai || ''
            ])
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="tra-hang.csv"');
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
});

router.get('/tra-hang/create', async (req, res, next) => {
    try {
        const products = await HangHoa.find({ trang_thai: 'active' }).sort({ ten_hang: 1 });
        const invoices = [];
        res.render('don-hang/tra-hang-create', { title: 'Trả hàng', invoices, products });
    } catch (error) {
        next(error);
    }
});

function escapedRegex(value = '') {
    return String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function intersectIdFilters(filter, ids) {
    const cleanIds = ids.filter(Boolean).map(id => String(id));
    if (!filter._id) {
        filter._id = { $in: cleanIds };
        return;
    }
    const currentIds = (filter._id.$in || []).map(id => String(id));
    const allowed = new Set(cleanIds);
    filter._id.$in = currentIds.filter(id => allowed.has(id));
}

router.get('/tra-hang/invoices/search', async (req, res, next) => {
    try {
        const page = Math.max(Number(req.query.page || 1), 1);
        const limit = Math.min(Math.max(Number(req.query.limit || 7), 1), 50);
        const filter = {};

        if (req.query.invoice_code && req.query.invoice_code.trim() !== '') {
            filter.ma_hoa_don = { $regex: escapedRegex(req.query.invoice_code), $options: 'i' };
        }

        const from = req.query.from_date ? new Date(req.query.from_date + 'T00:00:00') : null;
        const to = req.query.to_date ? new Date(req.query.to_date + 'T23:59:59') : null;
        if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
            filter.ngay_ban = {};
            if (from && !Number.isNaN(from.getTime())) filter.ngay_ban.$gte = from;
            if (to && !Number.isNaN(to.getTime())) filter.ngay_ban.$lte = to;
        }

        if (req.query.shipment_code && req.query.shipment_code.trim() !== '') {
            const shipments = await VanDon.find({
                ma_van_don: { $regex: escapedRegex(req.query.shipment_code), $options: 'i' },
                hoa_don_id: { $ne: null }
            }).select('hoa_don_id');
            intersectIdFilters(filter, shipments.map(item => item.hoa_don_id));
        }

        if (req.query.customer && req.query.customer.trim() !== '') {
            const q = escapedRegex(req.query.customer);
            const customers = await KhachHang.find({
                $or: [
                    { ma_khach_hang: { $regex: q, $options: 'i' } },
                    { ten_khach_hang: { $regex: q, $options: 'i' } },
                    { sdt: { $regex: q, $options: 'i' } },
                    { sdt2: { $regex: q, $options: 'i' } }
                ]
            }).select('_id');
            const customerIds = customers.map(item => item._id);
            const [customerInvoices, recipientShipments] = await Promise.all([
                customerIds.length ? HoaDonBanHang.find({ khach_hang_id: { $in: customerIds } }).select('_id') : [],
                VanDon.find({
                    hoa_don_id: { $ne: null },
                    $or: [
                        { ten_nguoi_nhan: { $regex: q, $options: 'i' } },
                        { sdt_nguoi_nhan: { $regex: q, $options: 'i' } }
                    ]
                }).select('hoa_don_id')
            ]);
            intersectIdFilters(filter, [
                ...customerInvoices.map(item => item._id),
                ...recipientShipments.map(item => item.hoa_don_id)
            ]);
        }

        if (req.query.item_code && req.query.item_code.trim() !== '') {
            const products = await HangHoa.find({ ma_hang: { $regex: escapedRegex(req.query.item_code), $options: 'i' } }).select('_id');
            const details = products.length
                ? await CTHoaDonBanHang.find({ hang_hoa_id: { $in: products.map(item => item._id) } }).select('hoa_don_id')
                : [];
            intersectIdFilters(filter, details.map(item => item.hoa_don_id));
        }

        if (req.query.item_name && req.query.item_name.trim() !== '') {
            const products = await HangHoa.find({ ten_hang: { $regex: escapedRegex(req.query.item_name), $options: 'i' } }).select('_id');
            const details = products.length
                ? await CTHoaDonBanHang.find({ hang_hoa_id: { $in: products.map(item => item._id) } }).select('hoa_don_id')
                : [];
            intersectIdFilters(filter, details.map(item => item.hoa_don_id));
        }

        const total = await HoaDonBanHang.countDocuments(filter);
        const invoices = await HoaDonBanHang.find(filter)
            .populate('khach_hang_id')
            .populate('nguoi_ban_id')
            .sort({ ngay_ban: -1, created_at: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        res.json({
            success: true,
            data: invoices.map(i => ({
                _id: String(i._id),
                ma_hoa_don: i.ma_hoa_don || '',
                ngay_ban: i.ngay_ban || i.created_at,
                tong_tien: i.tong_tien || 0,
                thanh_toan: i.thanh_toan || 0,
                nguoi_ban: i.nguoi_ban_id?.ho_ten || i.nguoi_ban_id?.username || 'Admin',
                khach_hang: i.khach_hang_id?.ten_khach_hang || 'KhÃ¡ch láº»',
                khach_hang_id: i.khach_hang_id ? String(i.khach_hang_id._id) : ''
            })),
            pagination: {
                page,
                limit,
                total,
                pages: Math.max(Math.ceil(total / limit), 1)
            }
        });
    } catch (error) {
        next(error);
    }
});

router.get('/tra-hang/:id/detail', async (req, res, next) => {
    try {
        const returnSlip = await PhieuTraHang.findById(req.params.id)
            .populate('hoa_don_id')
            .populate('khach_hang_id')
            .populate('nguoi_tao_id');
        if (!returnSlip) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu trả hàng' });

        const items = await CTPhieuTraHang.find({ phieu_tra_hang_id: returnSlip._id }).populate('hang_hoa_id');
        const invoice = returnSlip.hoa_don_id?._id
            ? await HoaDonBanHang.findById(returnSlip.hoa_don_id._id).populate('cua_hang_id').populate('nguoi_ban_id')
            : null;

        res.json({ success: true, data: { returnSlip, items, invoice } });
    } catch (error) {
        next(error);
    }
});

router.get('/tra-hang/invoice/:id', async (req, res, next) => {
    try {
        const invoice = await HoaDonBanHang.findById(req.params.id)
            .populate('khach_hang_id')
            .populate('nguoi_ban_id');
        if (!invoice) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn' });
        }
        const items = await CTHoaDonBanHang.find({ hoa_don_id: invoice._id }).populate('hang_hoa_id');
        res.json({ success: true, data: { invoice, items } });
    } catch (error) {
        next(error);
    }
});

router.post('/tra-hang/add', async (req, res, next) => {
    try {
        const { hoa_don_id, khach_hang_id, items, giam_gia, phi_tra_hang, ghi_chu } = req.body || {};
        if (!Array.isArray(items) || !items.length) {
            return res.status(400).json({ success: false, message: 'Phiếu trả hàng chưa có sản phẩm' });
        }

        const cleanItems = items
            .map(item => ({
                hang_hoa_id: item.hang_hoa_id,
                so_luong: Number(item.so_luong || 0),
                don_gia: Number(item.don_gia || 0)
            }))
            .filter(item => item.hang_hoa_id && item.so_luong > 0);

        if (!cleanItems.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập số lượng hàng trả' });
        }

        const tongTienHangTra = cleanItems.reduce((sum, item) => sum + item.so_luong * item.don_gia, 0);
        const discount = Number(giam_gia || 0);
        const returnFee = Number(phi_tra_hang || 0);
        const canTraKhach = Math.max(tongTienHangTra - discount - returnFee, 0);
        const count = await PhieuTraHang.countDocuments();
        const ma_phieu_tra = 'TH' + String(count + 1).padStart(6, '0');

        const returnSlip = await PhieuTraHang.create({
            ma_phieu_tra,
            ngay_tra: new Date(),
            tong_tien_tra: canTraKhach,
            ly_do: 'Khách trả hàng',
            trang_thai: 'completed',
            ghi_chu,
            hoa_don_id: hoa_don_id || null,
            khach_hang_id: khach_hang_id || null,
            nguoi_tao_id: req.user?._id
        });

        for (const item of cleanItems) {
            await CTPhieuTraHang.create({
                phieu_tra_hang_id: returnSlip._id,
                hang_hoa_id: item.hang_hoa_id,
                so_luong: item.so_luong,
                don_gia: item.don_gia,
                thanh_tien: item.so_luong * item.don_gia
            });
            await HangHoa.findByIdAndUpdate(item.hang_hoa_id, { $inc: { ton_kho: item.so_luong } });
        }

        res.json({ success: true, message: 'Đã tạo phiếu trả hàng', ma_phieu_tra });
    } catch (error) {
        next(error);
    }
});

router.get('/doi-tac-giao-hang', async (req, res, next) => {
    try {
        const partners = await DoiTacGiaoHang.find().sort({ created_at: -1 });
        const partnerIds = partners.map(partner => partner._id);
        const shipments = partnerIds.length ? await VanDon.find({ doi_tac_giao_hang_id: { $in: partnerIds } })
            .populate('don_hang_id')
            .populate('hoa_don_id')
            .populate('khach_hang_id')
            .sort({ created_at: -1 }) : [];
        const shipmentMap = {};
        partnerIds.forEach(id => { shipmentMap[String(id)] = []; });
        shipments.forEach(item => {
            const key = String(item.doi_tac_giao_hang_id || '');
            if (shipmentMap[key]) shipmentMap[key].push(item);
        });
        res.render('don-hang/doi-tac-giao-hang', { title: 'Đối tác giao hàng', partners, shipmentMap });
    } catch (error) {
        next(error);
    }
});

router.post('/doi-tac-giao-hang/add', async (req, res, next) => {
    try {
        const { ma_doi_tac, ten_doi_tac, sdt, email, dia_chi, ghi_chu } = req.body || {};
        if (!ten_doi_tac || ten_doi_tac.trim() === '') {
            return res.status(400).json({ success: false, message: 'Tên đối tác là bắt buộc' });
        }
        const count = await DoiTacGiaoHang.countDocuments();
        const code = ma_doi_tac && ma_doi_tac.trim() !== '' ? ma_doi_tac.trim() : 'DTGH' + String(count + 1).padStart(4, '0');
        await DoiTacGiaoHang.create({
            ma_doi_tac: code,
            ten_doi_tac: ten_doi_tac.trim(),
            sdt: sdt?.trim(),
            email: email?.trim(),
            dia_chi: dia_chi?.trim(),
            ghi_chu: ghi_chu?.trim(),
            trang_thai: 'active'
        });
        res.json({ success: true, message: 'Đã thêm đối tác giao hàng' });
    } catch (error) {
        next(error);
    }
});

router.post('/doi-tac-giao-hang/:id/update', async (req, res, next) => {
    try {
        const { ma_doi_tac, ten_doi_tac, sdt, email, dia_chi, ghi_chu, trang_thai } = req.body || {};
        if (!ten_doi_tac || ten_doi_tac.trim() === '') {
            return res.status(400).json({ success: false, message: 'Tên đối tác là bắt buộc' });
        }
        const partner = await DoiTacGiaoHang.findById(req.params.id);
        if (!partner) return res.status(404).json({ success: false, message: 'Không tìm thấy đối tác giao hàng' });

        if (ma_doi_tac && ma_doi_tac.trim() !== '' && ma_doi_tac.trim() !== partner.ma_doi_tac) {
            const exists = await DoiTacGiaoHang.findOne({ ma_doi_tac: ma_doi_tac.trim(), _id: { $ne: partner._id } });
            if (exists) return res.status(400).json({ success: false, message: 'Mã đối tác đã tồn tại' });
            partner.ma_doi_tac = ma_doi_tac.trim();
        }
        partner.ten_doi_tac = ten_doi_tac.trim();
        partner.sdt = sdt?.trim();
        partner.email = email?.trim();
        partner.dia_chi = dia_chi?.trim();
        partner.ghi_chu = ghi_chu?.trim();
        if (trang_thai === 'active' || trang_thai === 'inactive') partner.trang_thai = trang_thai;
        await partner.save();
        res.json({ success: true, message: 'Đã cập nhật đối tác giao hàng', data: partner });
    } catch (error) {
        next(error);
    }
});

router.get('/van-don/export.csv', async (req, res, next) => {
    try {
        const shipments = await VanDon.find()
            .populate('don_hang_id')
            .populate('hoa_don_id')
            .populate('doi_tac_giao_hang_id')
            .populate('khach_hang_id')
            .sort({ created_at: -1 });
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['ma_van_don', 'thoi_gian_tao', 'ma_hoa_don', 'ma_khach_hang', 'khach_hang', 'doi_tac_giao_hang', 'trang_thai', 'phi_giao_hang'],
            ...shipments.map(item => [
                item.ma_van_don,
                item.created_at ? item.created_at.toISOString() : '',
                item.hoa_don_id?.ma_hoa_don || item.don_hang_id?.ma_don_hang || '',
                item.khach_hang_id?.ma_khach_hang || '',
                item.khach_hang_id?.ten_khach_hang || item.ten_nguoi_nhan || '',
                item.doi_tac_giao_hang_id?.ten_doi_tac || 'Tự giao hàng',
                item.trang_thai || '',
                item.phi_giao_hang || 0
            ])
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="van-don.csv"');
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
});

router.post('/van-don/:id/status', async (req, res, next) => {
    try {
        const allowed = ['draft', 'shipping', 'completed', 'cancelled'];
        const { trang_thai } = req.body || {};
        if (!allowed.includes(trang_thai)) {
            return res.status(400).json({ success: false, message: 'Trạng thái vận đơn không hợp lệ' });
        }
        const shipment = await VanDon.findByIdAndUpdate(req.params.id, { trang_thai }, { new: true });
        if (!shipment) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy vận đơn' });
        }
        res.json({ success: true, message: 'Đã cập nhật trạng thái vận đơn', data: shipment });
    } catch (error) {
        next(error);
    }
});

router.get('/van-don', async (req, res, next) => {
    try {
        const filter = {};
        if (req.query?.q && req.query.q.trim() !== '') {
            filter.ma_van_don = { $regex: req.query.q.trim(), $options: 'i' };
        }
        if (req.query?.trang_thai && req.query.trang_thai !== 'all') {
            filter.trang_thai = req.query.trang_thai;
        }
        if (req.query?.doi_tac_giao_hang_id && req.query.doi_tac_giao_hang_id !== 'all') {
            filter.doi_tac_giao_hang_id = req.query.doi_tac_giao_hang_id;
        }
        const createdRange = dateRange(req.query, 'created_from', 'created_to', false);
        if (createdRange) filter.created_at = createdRange;
        if (req.query?.khu_vuc && req.query.khu_vuc.trim() !== '') {
            filter.dia_chi_nhan = { $regex: req.query.khu_vuc.trim(), $options: 'i' };
        }
        if (req.query?.cod === 'yes' || req.query?.cod === 'no') {
            const invoices = await HoaDonBanHang.find(req.query.cod === 'yes'
                ? { thanh_toan: { $gt: 0 } }
                : { $or: [{ thanh_toan: { $exists: false } }, { thanh_toan: 0 }, { thanh_toan: null }] }
            ).select('_id');
            filter.hoa_don_id = { $in: invoices.map(item => item._id) };
        }
        const [shipments, partners] = await Promise.all([
            VanDon.find(filter)
                .populate('don_hang_id')
                .populate('hoa_don_id')
                .populate('doi_tac_giao_hang_id')
                .populate('cua_hang_id')
                .populate('khach_hang_id')
                .sort({ created_at: -1 }),
            DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ ten_doi_tac: 1 })
        ]);
        res.render('don-hang/van-don', { title: 'Vận đơn', shipments, partners, filters: req.query || {} });
    } catch (error) {
        next(error);
    }
});

router.get('/:id/detail', async (req, res, next) => {
    try {
        const order = await DonHang.findById(req.params.id)
            .populate('khach_hang_id')
            .populate('cua_hang_id')
            .populate('nguoi_tao_id');
        if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
        const items = await CTDonHang.find({ don_hang_id: order._id }).populate('hang_hoa_id');
        const shipment = await VanDon.findOne({ don_hang_id: order._id }).populate('doi_tac_giao_hang_id').populate('cua_hang_id');
        res.json({ success: true, data: { order, items, shipment } });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/status', async (req, res, next) => {
    try {
        const { trang_thai } = req.body;
        await DonHang.findByIdAndUpdate(req.params.id, { trang_thai });
        res.json({ success: true, message: 'Đã cập nhật trạng thái đơn hàng' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
