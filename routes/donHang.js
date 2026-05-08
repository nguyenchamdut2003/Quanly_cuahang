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
    CongNoKhachHang,
    Kho,
    BangGia,
    CTBangGia,
    TonKho,
    TonKhoLo
} = require('../models/kiot.model');
const { truTonKho } = require('../services/kho.service');
const { tinhPhiGiaoHang, luuPhiVanChuyenKhachHang } = require('../services/phiGiaoHang.service');

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

function normalizeDiscount(value, type, baseAmount) {
    const raw = Math.max(0, Number(value || 0));
    const base = Math.max(0, Number(baseAmount || 0));
    const mode = type === 'phan_tram' ? 'phan_tram' : 'vnd';
    const amount = mode === 'phan_tram' ? base * Math.min(raw, 100) / 100 : raw;
    return Math.min(amount, base);
}

async function resolveSalePrice(product, priceBookId) {
    if (priceBookId && /^[0-9a-fA-F]{24}$/.test(String(priceBookId))) {
        const row = await CTBangGia.findOne({ bang_gia_id: priceBookId, hang_hoa_id: product._id }).lean();
        if (row && Number(row.gia_ban || 0) > 0) return Number(row.gia_ban || 0);
    }
    return Number(product.gia_co_dinh || 0) || 0;
}

async function getSellableStock(khoId, product) {
    if (!product?.quan_ly_theo_lo) {
        const stock = await TonKho.findOne({ kho_id: khoId, hang_hoa_id: product._id }).lean();
        return Number(stock?.so_luong || 0);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lotRows = await TonKhoLo.find({ kho_id: khoId, hang_hoa_id: product._id, so_luong: { $gt: 0 } })
        .populate('lo_hang_id')
        .lean();

    return lotRows.reduce((total, row) => {
        const lot = row.lo_hang_id;
        if (!lot || lot.trang_thai === 'huy') return total;
        if (lot.han_su_dung) {
            const expiry = new Date(lot.han_su_dung);
            expiry.setHours(0, 0, 0, 0);
            if (expiry.getTime() < today.getTime()) return total;
        }
        return total + Number(row.so_luong || 0);
    }, 0);
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

async function seedVanDonIfEmpty(userId) {
    const shipmentCount = await VanDon.countDocuments();
    if (shipmentCount > 0) return;

    let store = await CuaHang.findOne().sort({ created_at: 1 });
    if (!store) {
        store = await CuaHang.create({
            ma_cua_hang: 'CH_DEMO_VD',
            ten_cua_hang: 'Cua hang demo',
            dia_chi: '12 Nguyen Trai',
            dia_chi_gui_hang: '12 Nguyen Trai, Thanh Xuan, Ha Noi',
            tinh_thanh: 'Ha Noi',
            quan_huyen: 'Thanh Xuan',
            phuong_xa: 'Thuong Dinh',
            sdt: '0901000001',
            email: 'demo-store@example.com',
            trang_thai: 'active'
        });
    }

    let partners = await DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ ten_doi_tac: 1 });
    if (partners.length === 0) {
        partners = await DoiTacGiaoHang.insertMany([
            {
                cua_hang_id: store._id,
                ma_doi_tac: 'GHN_DEMO',
                ten_doi_tac: 'GHN Express',
                sdt: '1900636677',
                email: 'demo-ghn@example.com',
                dia_chi: 'Ha Noi',
                ghi_chu: 'Du lieu mau',
                trang_thai: 'active'
            },
            {
                cua_hang_id: store._id,
                ma_doi_tac: 'GHTK_DEMO',
                ten_doi_tac: 'Giao Hang Tiet Kiem',
                sdt: '19006092',
                email: 'demo-ghtk@example.com',
                dia_chi: 'TP Ho Chi Minh',
                ghi_chu: 'Du lieu mau',
                trang_thai: 'active'
            }
        ]);
    }

    let customers = await KhachHang.find().sort({ created_at: 1 }).limit(3);
    if (customers.length === 0) {
        customers = await KhachHang.insertMany([
            {
                cua_hang_id: store._id,
                ma_khach_hang: 'KH_DEMO_001',
                ten_khach_hang: 'Nguyen Van Minh',
                ten_ca_nhan: 'Nguyen Van Minh',
                sdt: '0912345678',
                email: 'minh.demo@example.com',
                khu_vuc_giao_hang: 'Ha Noi',
                trang_thai: 'active'
            },
            {
                cua_hang_id: store._id,
                ma_khach_hang: 'KH_DEMO_002',
                ten_khach_hang: 'Tran Thi Lan',
                ten_ca_nhan: 'Tran Thi Lan',
                sdt: '0987654321',
                email: 'lan.demo@example.com',
                khu_vuc_giao_hang: 'TP Ho Chi Minh',
                trang_thai: 'active'
            },
            {
                cua_hang_id: store._id,
                ma_khach_hang: 'KH_DEMO_003',
                ten_khach_hang: 'Cong ty An Phat',
                ten_cong_ty: 'Cong ty An Phat',
                sdt: '0909888777',
                email: 'anphat.demo@example.com',
                khu_vuc_giao_hang: 'Da Nang',
                trang_thai: 'active'
            }
        ]);
    }

    const now = new Date();
    const rows = [
        {
            suffix: '001',
            customer: customers[0],
            partner: partners[0],
            status: 'shipping',
            total: 1250000,
            fee: 30000,
            address: '12 Nguyen Trai, Thanh Xuan, Ha Noi',
            receiver: customers[0]?.ten_khach_hang || 'Nguyen Van Minh',
            phone: customers[0]?.sdt || '0912345678'
        },
        {
            suffix: '002',
            customer: customers[1] || customers[0],
            partner: partners[1] || partners[0],
            status: 'completed',
            total: 890000,
            fee: 25000,
            address: '25 Le Loi, Quan 1, TP Ho Chi Minh',
            receiver: customers[1]?.ten_khach_hang || 'Tran Thi Lan',
            phone: customers[1]?.sdt || '0987654321'
        },
        {
            suffix: '003',
            customer: customers[2] || customers[0],
            partner: partners[0],
            status: 'draft',
            total: 2140000,
            fee: 45000,
            address: '40 Bach Dang, Hai Chau, Da Nang',
            receiver: customers[2]?.ten_khach_hang || 'Cong ty An Phat',
            phone: customers[2]?.sdt || '0909888777'
        }
    ];

    for (const row of rows) {
        const order = await DonHang.create({
            ma_don_hang: 'DH_DEMO_VD_' + row.suffix,
            khach_hang_id: row.customer?._id || null,
            cua_hang_id: store._id,
            nguoi_tao_id: userId || null,
            ngay_dat: now,
            ngay_tao: now,
            tong_tien: row.total + row.fee,
            tong_tien_hang: row.total,
            tong_thanh_toan: row.total + row.fee,
            trang_thai: row.status === 'completed' ? 'completed' : 'shipping',
            trang_thai_giao_hang: row.status === 'completed' ? 'giao_du' : 'chua_giao',
            ngay_giao_thuc_te: row.status === 'completed' ? now : null,
            ghi_chu: 'Du lieu mau van don'
        });

        const invoice = await HoaDonBanHang.create({
            ma_hoa_don: 'HD_DEMO_VD_' + row.suffix,
            ngay_ban: now,
            tong_tien: row.total,
            giam_gia: 0,
            thanh_toan: row.total + row.fee,
            phuong_thuc_tt: 'COD',
            trang_thai: row.status === 'completed' ? 'completed' : 'processing',
            ghi_chu: 'Du lieu mau van don',
            cua_hang_id: store._id,
            don_hang_id: order._id,
            khach_hang_id: row.customer?._id || null,
            nguoi_ban_id: userId || null
        });

        await VanDon.create({
            ma_van_don: 'VD_DEMO_' + row.suffix,
            don_hang_id: order._id,
            hoa_don_id: invoice._id,
            doi_tac_giao_hang_id: row.partner?._id || null,
            cua_hang_id: store._id,
            khach_hang_id: row.customer?._id || null,
            ten_nguoi_nhan: row.receiver,
            sdt_nguoi_nhan: row.phone,
            dia_chi_nhan: row.address,
            phi_giao_hang: row.fee,
            trang_thai: row.status,
            ghi_chu: 'Du lieu mau van don'
        });
    }
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
    const [customersRaw, products, stores, partners, addresses, priceBooks, priceRows] = await Promise.all([
        KhachHang.find().sort({ ten_khach_hang: 1 }),
        HangHoa.find({ trang_thai: 'active' }).sort({ ten_hang: 1 }),
        CuaHang.find().sort({ ten_cua_hang: 1 }),
        DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ ten_doi_tac: 1 }),
        DiaChiKhachHang.find(),
        BangGia.find({ trang_thai: 'active' }).sort({ ten_bang_gia: 1 }),
        CTBangGia.find().select('bang_gia_id hang_hoa_id gia_ban').lean()
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

    return { customers, products, stores, partners, priceBooks, priceRows };
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
            bang_gia_id,
            items,
            chiet_khau,
            kieu_giam_gia,
            phi_van_chuyen,
            ghi_chu,
            kho_id,
            trang_thai,
            doi_tac_giao_hang_id,
            dia_chi_khach_hang_id,
            ten_nguoi_nhan,
            sdt_nguoi_nhan,
            dia_chi_nhan,
            diem_di,
            diem_den,
            khoang_cach_km,
            ghi_chu_giao_hang,
            thu_ho_cod,
            cod_enabled,
            nguoi_tra_phi_giao_hang
        } = req.body || {};

        const orderItems = parseItems(items);
        if (!Array.isArray(orderItems) || !orderItems.length) {
            return res.status(400).json({ success: false, message: 'Đơn hàng chưa có sản phẩm' });
        }
        if (!kho_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho.' });
        }
        if (!khach_hang_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn khách hàng.' });
        }
        if (!dia_chi_khach_hang_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn địa chỉ nhận hàng.' });
        }
        if (!doi_tac_giao_hang_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn đối tác giao hàng.' });
        }
        const kho = await Kho.findById(kho_id).lean();
        if (!kho) {
            return res.status(400).json({ success: false, message: 'Kho không hợp lệ.' });
        }
        const validBangGiaId = /^[0-9a-fA-F]{24}$/.test(String(bang_gia_id || '')) ? bang_gia_id : null;

        let tong_tien_hang = 0;
        const normalizedItems = [];
        for (const item of orderItems) {
            const productId = String(item.hang_hoa_id || '').trim();
            const quantity = Number(item.so_luong_dat ?? item.so_luong) || 0;
            if (!productId || quantity <= 0) {
                return res.status(400).json({ success: false, message: 'Dòng hàng không hợp lệ.' });
            }
            const product = await HangHoa.findById(productId).lean();
            if (!product) {
                return res.status(400).json({ success: false, message: 'Không tìm thấy hàng hóa.' });
            }
            const unitPrice = await resolveSalePrice(product, validBangGiaId);
            const lineBase = quantity * unitPrice;
            const lineDiscountAmount = normalizeDiscount(item.chiet_khau, item.kieu_chiet_khau, lineBase);
            const lineDiscountValue = item.kieu_chiet_khau === 'phan_tram'
                ? Math.min(Math.max(Number(item.chiet_khau || 0), 0), 100)
                : lineDiscountAmount;
            const lineTotal = Math.max(lineBase - lineDiscountAmount, 0);
            tong_tien_hang += lineTotal;
            normalizedItems.push({
                product,
                hang_hoa_id: productId,
                lo_hang_id: item.lo_hang_id || null,
                so_luong: quantity,
                don_gia_ban: unitPrice,
                chiet_khau: lineDiscountValue,
                kieu_chiet_khau: item.kieu_chiet_khau === 'phan_tram' ? 'phan_tram' : 'vnd',
                thanh_tien: lineTotal
            });
        }

        const orderDiscount = normalizeDiscount(chiet_khau, kieu_giam_gia, tong_tien_hang);
        const orderDiscountValue = kieu_giam_gia === 'phan_tram'
            ? Math.min(Math.max(Number(chiet_khau || 0), 0), 100)
            : orderDiscount;
        const calculatedShippingFee = await tinhPhiGiaoHang({
            cua_hang_id: cua_hang_id || kho.cua_hang_id || null,
            khach_hang_id,
            dia_chi_khach_hang_id,
            doi_tac_giao_hang_id,
            diem_di,
            diem_den: diem_den || dia_chi_nhan,
            khoang_cach_km
        });
        const manualShippingFee = Number(phi_van_chuyen);
        if (Number.isFinite(manualShippingFee) && manualShippingFee < 0) {
            return res.status(400).json({ success: false, message: 'Phí giao hàng không được âm.' });
        }
        const shippingFee = Number.isFinite(manualShippingFee) && manualShippingFee >= 0
            ? manualShippingFee
            : Number(calculatedShippingFee.phi_giao_hang || 0);
        if (shippingFee < 0) {
            return res.status(400).json({ success: false, message: 'Phí giao hàng không được âm.' });
        }
        const shippingFeePayer = nguoi_tra_phi_giao_hang === 'cua_hang' ? 'cua_hang' : 'khach';
        await luuPhiVanChuyenKhachHang({
            cua_hang_id: cua_hang_id || kho.cua_hang_id || null,
            khach_hang_id,
            dia_chi_khach_hang_id,
            doi_tac_giao_hang_id,
            phi_van_chuyen: shippingFee,
            ghi_chu: ghi_chu_giao_hang
        });
        const shippingFeeForCustomer = shippingFeePayer === 'khach' ? shippingFee : 0;
        const tong_thanh_toan = Math.max(tong_tien_hang - orderDiscount + shippingFeeForCustomer, 0);
        const codEnabled = thu_ho_cod === true || thu_ho_cod === 'true' || cod_enabled === true || cod_enabled === 'true';
        const khachCanTra = tong_thanh_toan;
        const khachThanhToan = codEnabled ? 0 : khachCanTra;
        const codAmount = codEnabled ? khachCanTra : 0;
        const tienThuaTraKhach = khachThanhToan - khachCanTra;
        const count = await DonHang.countDocuments();
        const ma_don_hang = 'DH' + String(count + 1).padStart(6, '0');

        const order = await DonHang.create({
            ma_don_hang,
            bang_gia_id: validBangGiaId,
            khach_hang_id: khach_hang_id || null,
            cua_hang_id: cua_hang_id || kho.cua_hang_id || null,
            kho_id: kho_id || null,
            nguoi_tao_id: req.user?._id,
            ngay_dat: new Date(),
            ngay_tao: new Date(),
            tong_tien: tong_thanh_toan,
            tong_tien_hang,
            giam_gia: orderDiscountValue,
            kieu_giam_gia: kieu_giam_gia === 'phan_tram' ? 'phan_tram' : 'vnd',
            tong_thanh_toan,
            khach_can_tra: khachCanTra,
            khach_thanh_toan: khachThanhToan,
            tien_thua_tra_khach: tienThuaTraKhach,
            cod_enabled: codEnabled,
            cod_amount: codAmount,
            trang_thai: trang_thai || 'draft',
            trang_thai_giao_hang: 'chua_giao',
            ghi_chu
        });

        for (const item of normalizedItems) {
            await CTDonHang.create({
                don_hang_id: order._id,
                hang_hoa_id: item.hang_hoa_id,
                so_luong: item.so_luong,
                so_luong_dat: item.so_luong,
                so_luong_xac_nhan: 0,
                so_luong_da_giao: 0,
                so_luong_con_thieu: item.so_luong,
                trang_thai_giao: 'chua_giao',
                lo_hang_id: item.lo_hang_id || null,
                don_gia_ban: item.don_gia_ban,
                chiet_khau: item.chiet_khau,
                kieu_chiet_khau: item.kieu_chiet_khau,
                thanh_tien: item.thanh_tien
            });
        }

        const shipmentCount = await VanDon.countDocuments();
        await VanDon.create({
            ma_van_don: 'VD' + String(shipmentCount + 1).padStart(6, '0'),
            don_hang_id: order._id,
            doi_tac_giao_hang_id: doi_tac_giao_hang_id || null,
            cua_hang_id: cua_hang_id || kho.cua_hang_id || null,
            khach_hang_id: khach_hang_id || null,
            dia_chi_khach_hang_id: dia_chi_khach_hang_id || null,
            ten_nguoi_nhan,
            sdt_nguoi_nhan,
            dia_chi_nhan,
            phi_giao_hang: shippingFee,
            nguoi_tra_phi_giao_hang: shippingFeePayer,
            cod_enabled: codEnabled,
            cod_amount: codAmount,
            trang_thai_cod: codEnabled ? 'chua_thu' : 'khong_cod',
            ghi_chu: ghi_chu_giao_hang,
            trang_thai: 'draft'
        });

        res.json({ success: true, message: 'Đã tạo đơn đặt hàng', ma_don_hang });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Không tạo được đơn hàng' });
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
            kho_id,
            doi_tac_giao_hang_id,
            dia_chi_khach_hang_id,
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
        if (!kho_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho.' });
        }

        let tong_tien_hang = 0;
        items.forEach(item => {
            tong_tien_hang += Number(item.so_luong) * Number(item.don_gia_ban);
        });
        const discount = Number(chiet_khau || 0);
        let shippingFee = Number(phi_van_chuyen);
        if (!Number.isFinite(shippingFee) || shippingFee < 0) {
            const calculatedShippingFee = await tinhPhiGiaoHang({
                cua_hang_id: cua_hang_id || null,
                khach_hang_id,
                dia_chi_khach_hang_id,
                doi_tac_giao_hang_id,
                diem_den: dia_chi_nhan
            });
            shippingFee = Number(calculatedShippingFee.phi_giao_hang || 0);
        }
        await luuPhiVanChuyenKhachHang({
            cua_hang_id: cua_hang_id || null,
            khach_hang_id,
            dia_chi_khach_hang_id,
            doi_tac_giao_hang_id,
            phi_van_chuyen: shippingFee,
            ghi_chu: ghi_chu_giao_hang
        });
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
            kho_id,
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

async function confirmOrderDelivery(req, res, next) {
    try {
        const { kho_id, items } = req.body || {};
        const deliveryItems = parseItems(items);

        if (!kho_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho.' });
        }

        const warehouse = await Kho.findById(kho_id);
        if (!warehouse) {
            return res.status(400).json({ success: false, message: 'Kho giao hang khong hop le' });
        }

        if (!deliveryItems.length) {
            return res.status(400).json({ success: false, message: 'Vui long chon hang can giao' });
        }

        const order = await DonHang.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Khong tim thay don hang' });
        }

        let hasDelivered = false;
        for (const item of deliveryItems) {
            const quantity = Number(item.so_luong_giao);
            if (!Number.isFinite(quantity) || quantity <= 0) {
                return res.status(400).json({ success: false, message: 'So luong giao phai lon hon 0' });
            }

            const detail = item.ct_don_hang_id
                ? await CTDonHang.findOne({ _id: item.ct_don_hang_id, don_hang_id: order._id })
                : await CTDonHang.findOne({ don_hang_id: order._id, hang_hoa_id: item.hang_hoa_id });

            if (!detail) {
                return res.status(400).json({ success: false, message: 'Dong hang giao khong hop le' });
            }

            const orderedQuantity = Number(detail.so_luong_dat || detail.so_luong || 0);
            const deliveredBefore = Number(detail.so_luong_da_giao || 0);
            const remainingBefore = Math.max(orderedQuantity - deliveredBefore, 0);
            if (quantity > remainingBefore) {
                return res.status(400).json({ success: false, message: 'So luong giao vuot qua so luong con thieu' });
            }

            try {
                await truTonKho({
                    kho_id,
                    hang_hoa_id: item.hang_hoa_id || detail.hang_hoa_id,
                    lo_hang_id: item.lo_hang_id || detail.lo_hang_id,
                    so_luong: quantity,
                    nguoi_tao_id: req.user?._id,
                    loai_phieu: 'ban_hang',
                    ma_phieu: order.ma_don_hang,
                    ghi_chu: `Giao hang don ${order.ma_don_hang}`
                });
            } catch (error) {
                if (/tồn kho|ton kho|Tồn kho|lo/i.test(error.message || '')) {
                    return res.status(400).json({ success: false, message: 'Không đủ tồn kho để giao hàng' });
                }
                throw error;
            }

            const deliveredAfter = deliveredBefore + quantity;
            const missingAfter = Math.max(orderedQuantity - deliveredAfter, 0);
            detail.so_luong_dat = orderedQuantity;
            detail.so_luong_xac_nhan = Number(detail.so_luong_xac_nhan || 0) + quantity;
            detail.so_luong_da_giao = deliveredAfter;
            detail.so_luong_con_thieu = missingAfter;
            detail.trang_thai_giao = deliveredAfter <= 0
                ? 'chua_giao'
                : (missingAfter <= 0 ? 'giao_du' : 'giao_thieu');
            if (item.lo_hang_id) detail.lo_hang_id = item.lo_hang_id;
            await detail.save();
            hasDelivered = true;
        }

        const allDetails = await CTDonHang.find({ don_hang_id: order._id });
        const allDelivered = allDetails.length > 0 && allDetails.every(item => Number(item.so_luong_con_thieu || 0) <= 0);
        const anyDelivered = allDetails.some(item => Number(item.so_luong_da_giao || 0) > 0);
        const anyMissing = allDetails.some(item => Number(item.so_luong_con_thieu || item.so_luong_dat || item.so_luong || 0) > 0);

        order.kho_id = kho_id;
        order.trang_thai_giao_hang = allDelivered
            ? 'giao_du'
            : (anyDelivered && anyMissing ? 'giao_mot_phan' : 'chua_giao');
        if (hasDelivered) {
            order.ngay_giao_thuc_te = new Date();
            if (!order.trang_thai || order.trang_thai === 'draft' || order.trang_thai === 'da_xac_nhan') {
                order.trang_thai = allDelivered ? 'completed' : 'shipping';
            }
        }
        await order.save();

        return res.json({
            success: true,
            message: 'Da xac nhan giao hang',
            data: {
                don_hang_id: order._id,
                trang_thai_giao_hang: order.trang_thai_giao_hang,
                ngay_giao_thuc_te: order.ngay_giao_thuc_te
            }
        });
    } catch (error) {
        next(error);
    }
}

router.put('/:id/xac-nhan-giao', confirmOrderDelivery);

router.post('/:id/status', async (req, res, next) => {
    try {
        const { trang_thai, force_complete_short } = req.body || {};
        const allowed = ['draft', 'shipping', 'completed', 'cancelled'];
        if (!allowed.includes(trang_thai)) {
            return res.status(400).json({ success: false, message: 'Trạng thái đơn hàng không hợp lệ' });
        }
        const order = await DonHang.findById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
        if (trang_thai === 'completed' && order.trang_thai_giao_hang !== 'giao_du' && !force_complete_short) {
            return res.status(400).json({
                success: false,
                code: 'NEED_CONFIRM_SHORT',
                message: 'Đơn chưa giao đủ. Cần xác nhận kết thúc thiếu.'
            });
        }
        order.trang_thai = trang_thai;
        await order.save();
        res.json({ success: true, message: 'Đã cập nhật trạng thái đơn hàng' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
