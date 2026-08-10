const {
    DoiTacGiaoHang,
    VanDon
} = require('../../models/kiot.model');
const { normalizeAddress } = require('../../utils/address');

exports.getDoiTacGiaoHang = async (req, res, next) => {
    try {
        const partners = await DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ created_at: -1 });
        const partnerIds = partners.map(partner => partner._id);
        const shipments = partnerIds.length
            ? await VanDon.find({ doi_tac_giao_hang_id: { $in: partnerIds } })
                .populate('don_hang_id')
                .populate('hoa_don_id')
                .populate('khach_hang_id')
                .sort({ created_at: -1 })
            : [];
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
};

exports.postDoiTacGiaoHangIdDeactivate = async (req, res, next) => {
    try {
        const partner = await DoiTacGiaoHang.findByIdAndUpdate(
            req.params.id,
            { $set: { trang_thai: 'inactive' } },
            { new: true, runValidators: true }
        );
        if (!partner) return res.status(404).json({ success: false, message: 'Không tìm thấy đối tác giao hàng' });
        res.json({ success: true, message: 'Đã ngừng hoạt động đối tác giao hàng' });
    } catch (error) {
        next(error);
    }
};

exports.postDoiTacGiaoHangAdd = async (req, res, next) => {
    try {
        const { ma_doi_tac, ten_doi_tac, sdt, email, ghi_chu } = req.body || {};
        if (!ten_doi_tac || ten_doi_tac.trim() === '') {
            return res.status(400).json({ success: false, message: 'Tên đối tác là bắt buộc' });
        }
        const count = await DoiTacGiaoHang.countDocuments();
        const code = ma_doi_tac && ma_doi_tac.trim() !== ''
            ? ma_doi_tac.trim()
            : 'DTGH' + String(count + 1).padStart(4, '0');
        const address = normalizeAddress(req.body);
        await DoiTacGiaoHang.create({
            ma_doi_tac: code,
            ten_doi_tac: ten_doi_tac.trim(),
            sdt: sdt?.trim(),
            email: email?.trim(),
            dia_chi_chi_tiet: address.dia_chi_chi_tiet,
            phuong_xa: address.phuong_xa,
            tinh_thanh: address.tinh_thanh,
            dia_chi_day_du: address.dia_chi_day_du,
            ghi_chu: ghi_chu?.trim(),
            trang_thai: 'active'
        });
        res.json({ success: true, message: 'Đã thêm đối tác giao hàng' });
    } catch (error) {
        next(error);
    }
};

exports.postDoiTacGiaoHangIdUpdate = async (req, res, next) => {
    try {
        const { ma_doi_tac, ten_doi_tac, sdt, email, ghi_chu, trang_thai } = req.body || {};
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
        const address = normalizeAddress(req.body);
        partner.dia_chi_chi_tiet = address.dia_chi_chi_tiet;
        partner.phuong_xa = address.phuong_xa;
        partner.tinh_thanh = address.tinh_thanh;
        partner.dia_chi_day_du = address.dia_chi_day_du;
        partner.ghi_chu = ghi_chu?.trim();
        if (trang_thai === 'active' || trang_thai === 'inactive') partner.trang_thai = trang_thai;
        await partner.save();
        res.json({ success: true, message: 'Đã cập nhật đối tác giao hàng', data: partner });
    } catch (error) {
        next(error);
    }
};
