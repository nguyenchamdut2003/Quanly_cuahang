const mongoose = require('mongoose');
const { ChuyenXe } = require('../../models/kiot.model');
const {
    HoaDonBanHang,
    DoiTacGiaoHang,
    VanDon,
    Counter,
    decorateInvoices,
    generateShipmentCode,
    resolveStoreId
} = require('./helpers/common.helper');

function isValidObjectId(value) {
    return mongoose.Types.ObjectId.isValid(String(value || ''));
}

function parseDateInput(value) {
    if (value == null || value === '') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function tripStatusText(status) {
    if (status === 'dang_giao') return 'Đang giao';
    if (status === 'hoan_thanh') return 'Hoàn thành';
    if (status === 'huy') return 'Hủy';
    return 'Nháp';
}

function formatTripRow(trip) {
    const partner = trip.doi_tac_giao_hang_id || {};
    return {
        id: String(trip._id),
        ma_chuyen: trip.ma_chuyen || '',
        doi_tac_giao_hang_id: partner._id ? String(partner._id) : String(trip.doi_tac_giao_hang_id || ''),
        ten_doi_tac: partner.ten_doi_tac || '',
        ngay_gio_xuat_phat: trip.ngay_gio_xuat_phat || null,
        ngay_gio_du_kien_ve: trip.ngay_gio_du_kien_ve || null,
        ngay_gio_ket_thuc: trip.ngay_gio_ket_thuc || null,
        tai_xe_ten: trip.tai_xe_ten || '',
        tai_xe_sdt: trip.tai_xe_sdt || '',
        bien_so_xe: trip.bien_so_xe || '',
        tuyen: trip.tuyen || '',
        trang_thai: trip.trang_thai || 'draft',
        trang_thai_text: tripStatusText(trip.trang_thai),
        trang_thai_du_lieu: trip.trang_thai_du_lieu || 'active',
        ghi_chu: trip.ghi_chu || ''
    };
}

function formatInvoiceCandidate(invoice, shipment, trip) {
    const customer = invoice.khach_hang_id || {};
    return {
        id: String(invoice._id),
        ma_hoa_don: invoice.ma_hoa_don || '',
        ngay_ban: invoice.ngay_ban || invoice.created_at || null,
        ma_khach_hang: customer.ma_khach_hang || '',
        ten_khach_hang: customer.ten_khach_hang || 'Khách lẻ',
        tong_tien: Number(invoice.tong_tien || 0),
        thanh_toan: Number(invoice.thanh_toan || 0),
        khach_da_tra: Number(invoice.khach_da_tra || 0),
        con_no: Number(invoice.con_no != null ? invoice.con_no : Math.max(0, Number(invoice.thanh_toan || 0) - Number(invoice.khach_da_tra || 0))),
        trang_thai: invoice.trang_thai_chuan || invoice.trang_thai || '',
        van_don_id: shipment?._id ? String(shipment._id) : '',
        ma_van_don: shipment?.ma_van_don || '',
        chuyen_xe_id: trip?._id ? String(trip._id) : (shipment?.chuyen_xe_id ? String(shipment.chuyen_xe_id) : ''),
        ma_chuyen: trip?.ma_chuyen || '',
        ten_doi_tac: trip?.doi_tac_giao_hang_id?.ten_doi_tac || '',
        ngay_gio_xuat_phat: trip?.ngay_gio_xuat_phat || null,
        trang_thai_chuyen: trip?.trang_thai || '',
        trang_thai_chuyen_text: trip ? tripStatusText(trip.trang_thai) : ''
    };
}

async function generateChuyenXeCode() {
    const lastTrip = await ChuyenXe.findOne({ ma_chuyen: /^CX\d+$/ })
        .sort({ ma_chuyen: -1 })
        .select('ma_chuyen')
        .lean();
    const currentMax = Number(String(lastTrip?.ma_chuyen || '').replace(/^CX/, '')) || 0;
    await Counter.updateOne(
        { _id: 'chuyen_xe' },
        { $max: { seq: currentMax } },
        { upsert: true }
    );
    const counter = await Counter.findOneAndUpdate(
        { _id: 'chuyen_xe' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    ).lean();
    return 'CX' + String(counter.seq).padStart(6, '0');
}

async function loadStoreInvoices(storeId) {
    const filter = {
        trang_thai_du_lieu: 'active',
        trang_thai: { $nin: ['cancelled', 'merged', 'huy'] }
    };
    if (storeId) filter.cua_hang_id = storeId;
    const invoices = await HoaDonBanHang.find(filter)
        .populate('khach_hang_id', 'ma_khach_hang ten_khach_hang')
        .sort({ created_at: -1 })
        .limit(500)
        .lean();
    return decorateInvoices(invoices);
}

function resolveShipmentForInvoice(invoice) {
    return invoice.van_don || null;
}

async function ensureShipmentForInvoice(invoice, trip, options = {}) {
    const allowReassign = options.allowReassign === true;
    let shipment = await VanDon.findOne({
        $or: [
            { hoa_don_id: invoice._id },
            ...(invoice.don_hang_id ? [{ don_hang_id: invoice.don_hang_id }] : [])
        ]
    });

    if (!shipment) {
        shipment = await VanDon.create({
            ma_van_don: await generateShipmentCode(),
            hoa_don_id: invoice._id,
            don_hang_id: invoice.don_hang_id || null,
            cua_hang_id: invoice.cua_hang_id || trip.cua_hang_id || null,
            khach_hang_id: invoice.khach_hang_id || null,
            doi_tac_giao_hang_id: trip.doi_tac_giao_hang_id || null,
            trang_thai: trip.trang_thai === 'dang_giao' ? 'shipping' : 'draft'
        });
    }

    if (shipment.chuyen_xe_id && String(shipment.chuyen_xe_id) !== String(trip._id) && !allowReassign) {
        const err = new Error(`Hóa đơn ${invoice.ma_hoa_don || ''} đã thuộc chuyến xe khác.`);
        err.status = 400;
        throw err;
    }

    shipment.chuyen_xe_id = trip._id;
    if (trip.doi_tac_giao_hang_id) {
        shipment.doi_tac_giao_hang_id = trip.doi_tac_giao_hang_id;
    }
    if (!shipment.hoa_don_id) shipment.hoa_don_id = invoice._id;
    if (trip.trang_thai === 'dang_giao' && shipment.trang_thai === 'draft') {
        shipment.trang_thai = 'shipping';
    }
    await shipment.save();
    return shipment;
}

async function assignInvoicesToTrip(trip, hoaDonIds, options = {}) {
    const ids = (hoaDonIds || []).map(String).filter(isValidObjectId);
    if (!ids.length) {
        const err = new Error('Vui lòng chọn ít nhất 1 hóa đơn.');
        err.status = 400;
        throw err;
    }

    const invoices = await HoaDonBanHang.find({
        _id: { $in: ids },
        trang_thai_du_lieu: 'active'
    }).lean();

    if (invoices.length !== ids.length) {
        const err = new Error('Một số hóa đơn không hợp lệ hoặc đã bị xóa.');
        err.status = 400;
        throw err;
    }

    const results = [];
    for (const invoice of invoices) {
        const shipment = await ensureShipmentForInvoice(invoice, trip, options);
        results.push({
            hoa_don_id: String(invoice._id),
            ma_hoa_don: invoice.ma_hoa_don || '',
            van_don_id: String(shipment._id),
            ma_van_don: shipment.ma_van_don || ''
        });
    }
    return results;
}

exports.getChuyenXeHoaDonCandidates = async function(req, res, next) {
    try {
        const storeId = await resolveStoreId(req);
        const invoices = await loadStoreInvoices(storeId);
        const shipmentTripIds = invoices
            .map(invoice => {
                const shipment = resolveShipmentForInvoice(invoice);
                return shipment?.chuyen_xe_id ? String(shipment.chuyen_xe_id) : '';
            })
            .filter(Boolean);

        const [selectableTrips, relatedTrips, partners] = await Promise.all([
            ChuyenXe.find({
                ...(storeId ? { cua_hang_id: storeId } : {}),
                trang_thai_du_lieu: 'active',
                trang_thai: { $ne: 'huy' }
            })
                .populate('doi_tac_giao_hang_id', 'ma_doi_tac ten_doi_tac')
                .sort({ ngay_gio_xuat_phat: -1, created_at: -1 })
                .lean(),
            shipmentTripIds.length
                ? ChuyenXe.find({ _id: { $in: shipmentTripIds } })
                    .populate('doi_tac_giao_hang_id', 'ma_doi_tac ten_doi_tac')
                    .lean()
                : Promise.resolve([]),
            DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ ten_doi_tac: 1 }).select('ma_doi_tac ten_doi_tac').lean()
        ]);

        const tripMap = {};
        relatedTrips.forEach(trip => {
            tripMap[String(trip._id)] = trip;
        });
        selectableTrips.forEach(trip => {
            tripMap[String(trip._id)] = trip;
        });

        const withoutTrip = [];
        const withTrip = [];
        invoices.forEach(invoice => {
            const shipment = resolveShipmentForInvoice(invoice);
            const tripId = shipment?.chuyen_xe_id ? String(shipment.chuyen_xe_id) : '';
            const trip = tripId ? tripMap[tripId] : null;
            const row = formatInvoiceCandidate(invoice, shipment, trip);
            if (tripId) withTrip.push(row);
            else withoutTrip.push(row);
        });

        res.json({
            success: true,
            data: {
                without_trip: withoutTrip,
                with_trip: withTrip,
                trips: selectableTrips.map(formatTripRow),
                partners: partners.map(item => ({
                    id: String(item._id),
                    ma_doi_tac: item.ma_doi_tac || '',
                    ten_doi_tac: item.ten_doi_tac || ''
                }))
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.getChuyenXeList = async function(req, res, next) {
    try {
        const storeId = await resolveStoreId(req);
        const trips = await ChuyenXe.find({
            ...(storeId ? { cua_hang_id: storeId } : {}),
            trang_thai_du_lieu: 'active',
            trang_thai: { $ne: 'huy' }
        })
            .populate('doi_tac_giao_hang_id', 'ma_doi_tac ten_doi_tac')
            .sort({ ngay_gio_xuat_phat: -1, created_at: -1 })
            .lean();
        res.json({ success: true, data: trips.map(formatTripRow) });
    } catch (error) {
        next(error);
    }
};

exports.createChuyenXe = async function(req, res, next) {
    try {
        const storeId = await resolveStoreId(req);
        if (!storeId) {
            return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng.' });
        }

        const body = req.body || {};
        const partnerId = String(body.doi_tac_giao_hang_id || '').trim();
        if (!isValidObjectId(partnerId)) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn nhà xe / đối tác giao hàng.' });
        }

        const partner = await DoiTacGiaoHang.findOne({ _id: partnerId, trang_thai: 'active' }).lean();
        if (!partner) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy đối tác giao hàng.' });
        }

        const trangThai = ['draft', 'dang_giao', 'hoan_thanh', 'huy'].includes(body.trang_thai)
            ? body.trang_thai
            : 'draft';

        const trip = await ChuyenXe.create({
            ma_chuyen: await generateChuyenXeCode(),
            cua_hang_id: storeId,
            doi_tac_giao_hang_id: partnerId,
            ngay_gio_xuat_phat: parseDateInput(body.ngay_gio_xuat_phat),
            ngay_gio_du_kien_ve: parseDateInput(body.ngay_gio_du_kien_ve),
            ngay_gio_ket_thuc: parseDateInput(body.ngay_gio_ket_thuc),
            tai_xe_ten: String(body.tai_xe_ten || '').trim(),
            tai_xe_sdt: String(body.tai_xe_sdt || '').trim(),
            bien_so_xe: String(body.bien_so_xe || '').trim(),
            tuyen: String(body.tuyen || '').trim(),
            trang_thai: trangThai,
            trang_thai_du_lieu: 'active',
            ghi_chu: String(body.ghi_chu || '').trim()
        });

        const hoaDonIds = Array.isArray(body.hoa_don_ids) ? body.hoa_don_ids : [];
        let assigned = [];
        if (hoaDonIds.length) {
            assigned = await assignInvoicesToTrip(trip, hoaDonIds, {
                allowReassign: body.allow_reassign === true
            });
        }

        const populated = await ChuyenXe.findById(trip._id)
            .populate('doi_tac_giao_hang_id', 'ma_doi_tac ten_doi_tac')
            .lean();

        res.json({
            success: true,
            message: 'Đã tạo chuyến xe.',
            data: {
                trip: formatTripRow(populated),
                assigned
            }
        });
    } catch (error) {
        if (error.status === 400) {
            return res.status(400).json({ success: false, message: error.message });
        }
        next(error);
    }
};

exports.assignHoaDonToChuyenXe = async function(req, res, next) {
    try {
        const storeId = await resolveStoreId(req);
        const tripId = String(req.params.id || '').trim();
        if (!isValidObjectId(tripId)) {
            return res.status(400).json({ success: false, message: 'Chuyến xe không hợp lệ.' });
        }

        const trip = await ChuyenXe.findOne({
            _id: tripId,
            ...(storeId ? { cua_hang_id: storeId } : {}),
            trang_thai_du_lieu: 'active'
        });
        if (!trip) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy chuyến xe.' });
        }
        if (trip.trang_thai === 'huy' || trip.trang_thai === 'hoan_thanh') {
            return res.status(400).json({ success: false, message: 'Không thể thêm hóa đơn vào chuyến đã hoàn thành hoặc đã hủy.' });
        }

        const assigned = await assignInvoicesToTrip(trip, (req.body || {}).hoa_don_ids, {
            allowReassign: (req.body || {}).allow_reassign === true
        });
        res.json({
            success: true,
            message: (req.body || {}).allow_reassign === true
                ? 'Đã đổi chuyến xe cho hóa đơn.'
                : 'Đã thêm hóa đơn vào chuyến xe.',
            data: { assigned }
        });
    } catch (error) {
        if (error.status === 400) {
            return res.status(400).json({ success: false, message: error.message });
        }
        next(error);
    }
};

exports.updateChuyenXeTrangThai = async function(req, res, next) {
    try {
        const storeId = await resolveStoreId(req);
        const tripId = String(req.params.id || '').trim();
        if (!isValidObjectId(tripId)) {
            return res.status(400).json({ success: false, message: 'Chuyến xe không hợp lệ.' });
        }

        const trangThai = String((req.body || {}).trang_thai || '').trim();
        const allowed = ['draft', 'dang_giao', 'hoan_thanh', 'huy'];
        if (!allowed.includes(trangThai)) {
            return res.status(400).json({ success: false, message: 'Trạng thái chuyến không hợp lệ.' });
        }

        const trip = await ChuyenXe.findOne({
            _id: tripId,
            ...(storeId ? { cua_hang_id: storeId } : {}),
            trang_thai_du_lieu: 'active'
        });
        if (!trip) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy chuyến xe.' });
        }

        trip.trang_thai = trangThai;
        if (trangThai === 'dang_giao' && !trip.ngay_gio_xuat_phat) {
            trip.ngay_gio_xuat_phat = new Date();
        }
        if ((trangThai === 'hoan_thanh' || trangThai === 'huy') && !trip.ngay_gio_ket_thuc) {
            trip.ngay_gio_ket_thuc = new Date();
        }
        await trip.save();

        const populated = await ChuyenXe.findById(trip._id)
            .populate('doi_tac_giao_hang_id', 'ma_doi_tac ten_doi_tac')
            .lean();

        res.json({
            success: true,
            message: 'Đã cập nhật trạng thái chuyến xe.',
            data: formatTripRow(populated)
        });
    } catch (error) {
        next(error);
    }
};
