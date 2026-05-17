const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const {
    DonHang, CTDonHang, HangHoa, KhachHang, DiaChiKhachHang,
    CuaHang, DoiTacGiaoHang, VanDon
} = require('../models/kiot.model');
const { luuPhiVanChuyenKhachHang } = require('../services/phiGiaoHang.service');

router.use(isAuthenticated);

router.get('/', async (req, res, next) => {
    try {
        const [customersRaw, products, stores, partners, addresses, draftOrdersRaw] = await Promise.all([
            KhachHang.find(),
            HangHoa.find({ ton_kho: { $gt: 0 } })
                .populate('nha_cung_cap_id', 'ma_ncc ten_ncc ten_cong_ty'),
            CuaHang.find(),
            DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ ten_doi_tac: 1 }),
            DiaChiKhachHang.find(),
            DonHang.find({ trang_thai: 'draft' })
                .populate('khach_hang_id')
                .sort({ ngay_tao: -1, created_at: -1 })
                .limit(20)
        ]);

        const addressesByCustomer = addresses.reduce((acc, item) => {
            const key = String(item.khach_hang_id);
            if (!acc[key]) acc[key] = [];
            acc[key].push(item);
            return acc;
        }, {});

        const customers = customersRaw.map(customer => {
            const obj = customer.toObject();
            obj.dia_chi_list = addressesByCustomer[String(customer._id)] || [];
            return obj;
        });

        const draftOrderIds = draftOrdersRaw.map(order => order._id);
        const [draftDetails, draftShipments] = await Promise.all([
            draftOrderIds.length ? CTDonHang.find({ don_hang_id: { $in: draftOrderIds } }).populate('hang_hoa_id') : [],
            draftOrderIds.length ? VanDon.find({ don_hang_id: { $in: draftOrderIds } }).populate('doi_tac_giao_hang_id') : []
        ]);

        const detailsByOrder = draftDetails.reduce((acc, item) => {
            const key = String(item.don_hang_id);
            if (!acc[key]) acc[key] = [];
            acc[key].push(item);
            return acc;
        }, {});

        const shipmentByOrder = draftShipments.reduce((acc, item) => {
            acc[String(item.don_hang_id)] = item;
            return acc;
        }, {});

        const draftOrders = draftOrdersRaw.map(order => {
            const shipment = shipmentByOrder[String(order._id)];
            return {
                _id: String(order._id),
                ma_don_hang: order.ma_don_hang,
                ngay_tao: order.ngay_tao || order.created_at,
                khach_hang_id: order.khach_hang_id ? String(order.khach_hang_id._id) : '',
                kho_id: order.kho_id ? String(order.kho_id) : '',
                ten_khach_hang: order.khach_hang_id?.ten_khach_hang || 'Khách lẻ',
                tong_tien_hang: order.tong_tien_hang || 0,
                tong_thanh_toan: order.tong_thanh_toan || order.tong_tien || 0,
                ghi_chu: order.ghi_chu || '',
                items: (detailsByOrder[String(order._id)] || []).map(detail => ({
                    hang_hoa_id: String(detail.hang_hoa_id?._id || detail.hang_hoa_id),
                    ten_hang: detail.hang_hoa_id?.ten_hang || '',
                    ma_hang: detail.hang_hoa_id?.ma_hang || '',
                    so_luong: detail.so_luong || 0,
                    don_gia_ban: detail.don_gia_ban || 0
                })),
                delivery: shipment ? {
                    doi_tac_giao_hang_id: shipment.doi_tac_giao_hang_id ? String(shipment.doi_tac_giao_hang_id._id) : '',
                    cua_hang_id: shipment.cua_hang_id ? String(shipment.cua_hang_id) : '',
                    ten_nguoi_nhan: shipment.ten_nguoi_nhan || '',
                    sdt_nguoi_nhan: shipment.sdt_nguoi_nhan || '',
                    dia_chi_nhan: shipment.dia_chi_nhan || '',
                    phi_giao_hang: shipment.phi_giao_hang || 0,
                    ghi_chu: shipment.ghi_chu || ''
                } : null
            };
        });

        res.render('ban-hang/index', {
            title: 'Bán hàng',
            customers,
            products,
            stores,
            partners,
            draftOrders
        });
    } catch (error) {
        next(error);
    }
});

router.post('/add', async (req, res, next) => {
    try {
        const {
            khach_hang_id, cua_hang_id, kho_id, items, chiet_khau, phi_van_chuyen, ghi_chu,
            doi_tac_giao_hang_id, dia_chi_khach_hang_id, ten_nguoi_nhan, sdt_nguoi_nhan, dia_chi_nhan, ghi_chu_giao_hang,
            draft_order_id
        } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Đơn hàng chưa có sản phẩm' });
        }
        if (!kho_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho.' });
        }

        let tong_tien_hang = 0;
        items.forEach(item => {
            tong_tien_hang += Number(item.so_luong) * Number(item.don_gia_ban);
        });

        const tong_thanh_toan = tong_tien_hang - Number(chiet_khau || 0) + Number(phi_van_chuyen || 0);
        await luuPhiVanChuyenKhachHang({
            cua_hang_id,
            khach_hang_id,
            dia_chi_khach_hang_id,
            doi_tac_giao_hang_id,
            phi_van_chuyen,
            ghi_chu: ghi_chu_giao_hang
        });
        let donHang;

        if (draft_order_id && /^[0-9a-fA-F]{24}$/.test(draft_order_id)) {
            donHang = await DonHang.findOne({ _id: draft_order_id, trang_thai: 'draft' });
            if (!donHang) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy đơn nháp' });
            }
            await CTDonHang.deleteMany({ don_hang_id: donHang._id });
            donHang.set({
                khach_hang_id: khach_hang_id || null,
                cua_hang_id: cua_hang_id || null,
                kho_id,
                tong_tien: tong_thanh_toan,
                tong_tien_hang,
                tong_thanh_toan,
                trang_thai: 'completed',
                ghi_chu
            });
            await donHang.save();
        } else {
            const ma_don_hang = 'DH' + Date.now();
            donHang = await DonHang.create({
                ma_don_hang,
                khach_hang_id: khach_hang_id || null,
                cua_hang_id: cua_hang_id || null,
                kho_id,
                nguoi_tao_id: req.user._id,
                ngay_dat: new Date(),
                ngay_tao: new Date(),
                tong_tien: tong_thanh_toan,
                tong_tien_hang,
                tong_thanh_toan,
                trang_thai: 'completed',
                ghi_chu
            });
        }

        for (const item of items) {
            await CTDonHang.create({
                don_hang_id: donHang._id,
                hang_hoa_id: item.hang_hoa_id,
                so_luong: item.so_luong,
                don_gia_ban: item.don_gia_ban,
                thanh_tien: Number(item.so_luong) * Number(item.don_gia_ban)
            });

            await HangHoa.findByIdAndUpdate(item.hang_hoa_id, {
                $inc: { ton_kho: -Number(item.so_luong) }
            });
        }

        if (doi_tac_giao_hang_id || ten_nguoi_nhan || dia_chi_nhan) {
            const count = await VanDon.countDocuments();
            const shipment = await VanDon.findOne({ don_hang_id: donHang._id });
            const shipmentData = {
                doi_tac_giao_hang_id: doi_tac_giao_hang_id || null,
                cua_hang_id: cua_hang_id || null,
                khach_hang_id: khach_hang_id || null,
                ten_nguoi_nhan,
                sdt_nguoi_nhan,
                dia_chi_nhan,
                phi_giao_hang: Number(phi_van_chuyen || 0),
                ghi_chu: ghi_chu_giao_hang,
                trang_thai: 'draft'
            };
            if (shipment) {
                shipment.set(shipmentData);
                await shipment.save();
            } else {
                await VanDon.create({
                    ma_van_don: 'VD' + String(count + 1).padStart(6, '0'),
                    don_hang_id: donHang._id,
                    ...shipmentData
                });
            }
        }

        res.json({ success: true, message: 'Thanh toán thành công', ma_don_hang: donHang.ma_don_hang });
    } catch (error) {
        next(error);
    }
});

async function upsertDraftShipment(orderId, data) {
    const {
        khach_hang_id, cua_hang_id, doi_tac_giao_hang_id,
        ten_nguoi_nhan, sdt_nguoi_nhan, dia_chi_nhan,
        phi_van_chuyen, ghi_chu_giao_hang
    } = data;

    const hasShipmentInfo = doi_tac_giao_hang_id
        || ten_nguoi_nhan
        || sdt_nguoi_nhan
        || dia_chi_nhan
        || Number(phi_van_chuyen || 0) > 0
        || ghi_chu_giao_hang;

    if (!hasShipmentInfo) {
        await VanDon.deleteMany({ don_hang_id: orderId, trang_thai: 'draft' });
        return;
    }

    const shipment = await VanDon.findOne({ don_hang_id: orderId });
    await luuPhiVanChuyenKhachHang({
        cua_hang_id,
        khach_hang_id,
        dia_chi_khach_hang_id: data.dia_chi_khach_hang_id,
        doi_tac_giao_hang_id,
        phi_van_chuyen,
        ghi_chu: ghi_chu_giao_hang
    });
    const shipmentData = {
        doi_tac_giao_hang_id: doi_tac_giao_hang_id || null,
        cua_hang_id: cua_hang_id || null,
        khach_hang_id: khach_hang_id || null,
        ten_nguoi_nhan,
        sdt_nguoi_nhan,
        dia_chi_nhan,
        phi_giao_hang: Number(phi_van_chuyen || 0),
        ghi_chu: ghi_chu_giao_hang,
        trang_thai: 'draft'
    };

    if (shipment) {
        shipment.set(shipmentData);
        await shipment.save();
        return;
    }

    const count = await VanDon.countDocuments();
    await VanDon.create({
        ma_van_don: 'VD' + String(count + 1).padStart(6, '0'),
        don_hang_id: orderId,
        ...shipmentData
    });
}

router.post('/draft', async (req, res, next) => {
    try {
        const {
            draft_order_id, khach_hang_id, cua_hang_id, kho_id, items,
            chiet_khau, phi_van_chuyen, ghi_chu
        } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Đơn nháp chưa có sản phẩm' });
        }
        if (!kho_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho.' });
        }

        let tong_tien_hang = 0;
        items.forEach(item => {
            tong_tien_hang += Number(item.so_luong || 0) * Number(item.don_gia_ban || 0);
        });

        const tong_thanh_toan = tong_tien_hang - Number(chiet_khau || 0) + Number(phi_van_chuyen || 0);
        let donHang;

        if (draft_order_id && /^[0-9a-fA-F]{24}$/.test(draft_order_id)) {
            donHang = await DonHang.findOne({ _id: draft_order_id, trang_thai: 'draft' });
            if (!donHang) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy đơn nháp' });
            }
            await CTDonHang.deleteMany({ don_hang_id: donHang._id });
            donHang.set({
                khach_hang_id: khach_hang_id || null,
                cua_hang_id: cua_hang_id || null,
                kho_id,
                tong_tien: tong_thanh_toan,
                tong_tien_hang,
                tong_thanh_toan,
                ghi_chu,
                ngay_tao: donHang.ngay_tao || new Date()
            });
            await donHang.save();
        } else {
            donHang = await DonHang.create({
                ma_don_hang: 'DH' + Date.now(),
                khach_hang_id: khach_hang_id || null,
                cua_hang_id: cua_hang_id || null,
                kho_id,
                nguoi_tao_id: req.user._id,
                ngay_dat: new Date(),
                ngay_tao: new Date(),
                tong_tien: tong_thanh_toan,
                tong_tien_hang,
                tong_thanh_toan,
                trang_thai: 'draft',
                ghi_chu
            });
        }

        for (const item of items) {
            await CTDonHang.create({
                don_hang_id: donHang._id,
                hang_hoa_id: item.hang_hoa_id,
                so_luong: Number(item.so_luong || 0),
                don_gia_ban: Number(item.don_gia_ban || 0),
                thanh_tien: Number(item.so_luong || 0) * Number(item.don_gia_ban || 0)
            });
        }

        await upsertDraftShipment(donHang._id, req.body);

        res.json({
            success: true,
            message: draft_order_id ? 'Cập nhật đơn nháp thành công' : 'Tạo đơn nháp thành công',
            draft_order_id: String(donHang._id),
            ma_don_hang: donHang.ma_don_hang
        });
    } catch (error) {
        next(error);
    }
});

router.delete('/draft/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!/^[0-9a-fA-F]{24}$/.test(id)) {
            return res.status(400).json({ success: false, message: 'Mã đơn nháp không hợp lệ' });
        }

        const donHang = await DonHang.findOne({ _id: id, trang_thai: 'draft' });
        if (!donHang) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy đơn nháp' });
        }

        await Promise.all([
            CTDonHang.deleteMany({ don_hang_id: donHang._id }),
            VanDon.deleteMany({ don_hang_id: donHang._id }),
            DonHang.deleteOne({ _id: donHang._id })
        ]);

        res.json({ success: true, message: 'Đã xóa đơn nháp' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
