const fs = require('fs');
const path = require('path');
const multer = require('multer');
const {
    HangHoa,
    NhomHang,
    ThuongHieu,
    DonViTinh,
    NhaCungCap,
    CuaHang,
    ViTri
} = require('../models/kiot.model');

const uploadDir = path.join(__dirname, '../public/uploads/hang-hoa');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
    }
});

exports.uploadProductImages = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file?.mimetype?.startsWith('image/')) return cb(null, true);
        cb(new Error('Chỉ chấp nhận file ảnh!'), false);
    }
}).array('anh_san_pham', 4);

exports.importProductFile = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
}).single('file');

function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];

        if (ch === '"' && inQuotes && next === '"') {
            cell += '"';
            i++;
        } else if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            row.push(cell);
            cell = '';
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (ch === '\r' && next === '\n') i++;
            row.push(cell);
            if (row.some(v => v.trim())) rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += ch;
        }
    }

    row.push(cell);
    if (row.some(v => v.trim())) rows.push(row);
    return rows;
}

function numberFromCsv(value) {
    if (!value) return 0;
    const normalized = String(value).replace(/\./g, '').replace(/,/g, '').trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function parseNumber(value, fallback = 0) {
    if (value === undefined || value === null) return fallback;
    const parsed = Number(String(value).replace(/\./g, '').replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableId(value) {
    return value && String(value).trim() !== '' ? value : null;
}

async function getProductFormData() {
    const [categories, brands, units, suppliers, stores, locations] = await Promise.all([
        NhomHang.find().sort({ ten_nhom_hang: 1 }),
        ThuongHieu.find().sort({ ten_thuong_hieu: 1 }),
        DonViTinh.find().sort({ ten_don_vi: 1 }),
        NhaCungCap.find().sort({ ten_ncc: 1 }),
        CuaHang.find().sort({ ten_cua_hang: 1 }),
        ViTri.find().sort({ ten_vi_tri: 1 })
    ]);

    return { categories, brands, units, suppliers, stores, locations };
}

exports.index = async (req, res, next) => {
    try {
        const { q, nhom_hang_id, ton_kho, nha_cung_cap_id, vi_tri_id, loai_hang, ban_truc_tiep } = req.query || {};
        const filter = {};

        if (q && q.trim() !== '') {
            const keyword = q.trim();
            filter.$or = [
                { ma_hang: { $regex: keyword, $options: 'i' } },
                { ten_hang: { $regex: keyword, $options: 'i' } }
            ];
        }
        if (nhom_hang_id) filter.nhom_hang_id = nhom_hang_id;
        if (nha_cung_cap_id) filter.nha_cung_cap_id = nha_cung_cap_id;
        if (vi_tri_id) filter.vi_tri_id = vi_tri_id;
        if (['hang_hoa', 'dich_vu', 'combo'].includes(loai_hang)) filter.loai_hang = loai_hang;
        if (ban_truc_tiep === 'true') filter.ban_truc_tiep = true;
        if (ban_truc_tiep === 'false') filter.ban_truc_tiep = false;
        if (ton_kho === 'con') filter.ton_kho = { $gt: 0 };
        if (ton_kho === 'het') filter.ton_kho = { $lte: 0 };
        if (ton_kho === 'duoi_dinh_muc') {
            filter.$expr = { $lte: ['$ton_kho', '$dinh_muc_ton_thap'] };
        }

        const [products, formData] = await Promise.all([
            HangHoa.find(filter)
                .populate('nhom_hang_id')
                .populate('thuong_hieu_id')
                .populate('nha_cung_cap_id')
                .populate('don_vi_tinh_id')
                .populate('vi_tri_id')
                .sort({ created_at: -1 }),
            getProductFormData()
        ]);

        res.render('hang-hoa/index', {
            title: 'Quản lý Hàng hóa',
            products,
            ...formData,
            filters: req.query || {}
        });
    } catch (error) {
        next(error);
    }
};

exports.priceSetup = async (req, res, next) => {
    try {
        const { q, nhom_hang_id, ton_kho, gia_ban_dk, gia_ban_value, page, limit } = req.query || {};
        const filter = {};

        if (q && q.trim() !== '') {
            const keyword = q.trim();
            filter.$or = [
                { ma_hang: { $regex: keyword, $options: 'i' } },
                { ten_hang: { $regex: keyword, $options: 'i' } }
            ];
        }
        if (nhom_hang_id) filter.nhom_hang_id = nhom_hang_id;
        if (ton_kho === 'con') filter.ton_kho = { $gt: 0 };
        if (ton_kho === 'het') filter.ton_kho = { $lte: 0 };

        const priceValue = parseNumber(gia_ban_value, null);
        if (priceValue !== null && gia_ban_dk) {
            const ops = {
                eq: priceValue,
                gt: { $gt: priceValue },
                gte: { $gte: priceValue },
                lt: { $lt: priceValue },
                lte: { $lte: priceValue }
            };
            if (ops[gia_ban_dk] !== undefined) filter.gia_ban = ops[gia_ban_dk];
        }

        const perPage = Math.min(Math.max(parseInt(limit, 10) || 15, 10), 50);
        const currentPage = Math.max(parseInt(page, 10) || 1, 1);
        const skip = (currentPage - 1) * perPage;

        const [products, total, categories] = await Promise.all([
            HangHoa.find(filter)
                .populate('nhom_hang_id')
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(perPage),
            HangHoa.countDocuments(filter),
            NhomHang.find().sort({ ten_nhom_hang: 1 })
        ]);

        res.render('hang-hoa/thiet-lap-gia', {
            title: 'Thiết lập giá',
            products,
            categories,
            filters: req.query || {},
            pagination: {
                page: currentPage,
                limit: perPage,
                total,
                totalPages: Math.max(Math.ceil(total / perPage), 1)
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.updatePrices = async (req, res, next) => {
    try {
        const prices = Array.isArray(req.body?.prices) ? req.body.prices : [];
        if (!prices.length) {
            return res.status(400).json({ success: false, message: 'Chưa có giá cần cập nhật' });
        }

        const ops = prices
            .filter(item => item && item.id)
            .map(item => ({
                updateOne: {
                    filter: { _id: item.id },
                    update: { $set: { gia_ban: parseNumber(item.gia_ban) } }
                }
            }));

        if (!ops.length) {
            return res.status(400).json({ success: false, message: 'Dữ liệu cập nhật không hợp lệ' });
        }

        const result = await HangHoa.bulkWrite(ops);
        res.json({
            success: true,
            message: `Đã cập nhật ${result.modifiedCount || result.matchedCount || 0} hàng hóa`,
            updated: result.modifiedCount || result.matchedCount || 0
        });
    } catch (error) {
        next(error);
    }
};

exports.add = async (req, res, next) => {
    try {
        const {
            ma_hang, ten_hang, loai_hang, mo_ta, nhom_hang_id, thuong_hieu_id, don_vi_tinh_id, don_vi_tinh, vi_tri_id,
            gia_von, gia_ban, dinh_muc_ton_thap, dinh_muc_ton_cao,
            trong_luong, don_vi_trong_luong, quan_ly_theo_lo, ban_truc_tiep
        } = req.body || {};

        if (!ten_hang || ten_hang.trim() === '') {
            return res.status(400).json({ success: false, message: 'Tên hàng là bắt buộc' });
        }

        const productType = ['hang_hoa', 'dich_vu', 'combo'].includes(loai_hang) ? loai_hang : 'hang_hoa';
        const prefixMap = { hang_hoa: 'HH', dich_vu: 'DV', combo: 'CB' };
        const count = await HangHoa.countDocuments({ loai_hang: productType });
        const generatedCode = prefixMap[productType] + String(count + 1).padStart(4, '0');
        const anh_san_pham = (req.files || []).map(f => '/uploads/hang-hoa/' + f.filename);

        const item = await HangHoa.create({
            ma_hang: ma_hang && ma_hang.trim() !== '' ? ma_hang.trim() : generatedCode,
            ten_hang: ten_hang.trim(),
            loai_hang: productType,
            mo_ta: mo_ta || '',
            nhom_hang_id: nullableId(nhom_hang_id),
            thuong_hieu_id: nullableId(thuong_hieu_id),
            don_vi_tinh_id: nullableId(don_vi_tinh_id),
            don_vi_tinh: don_vi_tinh && don_vi_tinh.trim() !== '' ? don_vi_tinh.trim() : 'cái',
            vi_tri_id: nullableId(vi_tri_id),
            gia_von: parseNumber(gia_von),
            gia_ban: parseNumber(gia_ban),
            ton_kho: productType === 'dich_vu' ? 0 : 0,
            dinh_muc_ton_thap: parseNumber(dinh_muc_ton_thap),
            dinh_muc_ton_cao: parseNumber(dinh_muc_ton_cao, 999999999),
            trong_luong: parseNumber(trong_luong),
            don_vi_trong_luong: don_vi_trong_luong || 'g',
            quan_ly_theo_lo: quan_ly_theo_lo === 'true' || quan_ly_theo_lo === true,
            ban_truc_tiep: ban_truc_tiep !== 'false' && ban_truc_tiep !== false,
            anh_san_pham,
            trang_thai: 'active'
        });

        res.json({ success: true, message: 'Thêm hàng hóa thành công', data: item });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: 'Mã hàng đã tồn tại' });
        }
        next(error);
    }
};

exports.update = async (req, res, next) => {
    try {
        const productId = req.params?.id;
        if (!productId) return res.status(400).json({ success: false, message: 'ID không hợp lệ' });

        const {
            ma_hang, ten_hang, loai_hang, mo_ta, nhom_hang_id, thuong_hieu_id, don_vi_tinh_id, don_vi_tinh, vi_tri_id,
            gia_von, gia_ban, dinh_muc_ton_thap, dinh_muc_ton_cao,
            trong_luong, don_vi_trong_luong, quan_ly_theo_lo, ban_truc_tiep
        } = req.body || {};

        if (!ten_hang || ten_hang.trim() === '') {
            return res.status(400).json({ success: false, message: 'Tên hàng là bắt buộc' });
        }

        const item = await HangHoa.findById(productId);
        if (!item) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy hàng hóa' });
        }

        if (ma_hang && ma_hang.trim() !== '') item.ma_hang = ma_hang.trim();
        item.ten_hang = ten_hang.trim();
        if (['hang_hoa', 'dich_vu', 'combo'].includes(loai_hang)) item.loai_hang = loai_hang;
        item.mo_ta = mo_ta || '';
        item.nhom_hang_id = nullableId(nhom_hang_id);
        item.thuong_hieu_id = nullableId(thuong_hieu_id);
        item.don_vi_tinh_id = nullableId(don_vi_tinh_id);
        item.don_vi_tinh = don_vi_tinh && don_vi_tinh.trim() !== '' ? don_vi_tinh.trim() : 'cái';
        item.vi_tri_id = nullableId(vi_tri_id);
        item.gia_von = parseNumber(gia_von);
        item.gia_ban = parseNumber(gia_ban);
        item.dinh_muc_ton_thap = parseNumber(dinh_muc_ton_thap);
        item.dinh_muc_ton_cao = parseNumber(dinh_muc_ton_cao, 999999999);
        item.trong_luong = parseNumber(trong_luong);
        item.don_vi_trong_luong = don_vi_trong_luong || 'g';
        item.quan_ly_theo_lo = quan_ly_theo_lo === 'true' || quan_ly_theo_lo === true;
        item.ban_truc_tiep = ban_truc_tiep !== 'false' && ban_truc_tiep !== false;

        const newImages = (req.files || []).map(f => '/uploads/hang-hoa/' + f.filename);
        if (newImages.length > 0) item.anh_san_pham = newImages;

        await item.save();
        res.json({ success: true, message: 'Cập nhật hàng hóa thành công', data: item });
    } catch (error) {
        next(error);
    }
};

exports.remove = async (req, res, next) => {
    try {
        const productId = req.params?.id;
        if (!productId) return res.status(400).json({ success: false, message: 'ID không hợp lệ' });

        const item = await HangHoa.findByIdAndDelete(productId);
        if (!item) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy hàng hóa' });
        }
        res.json({ success: true, message: 'Đã xóa hàng hóa' });
    } catch (error) {
        next(error);
    }
};

exports.importCsv = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn file CSV' });
        }

        const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
        const rows = parseCsv(text);
        if (!Array.isArray(rows) || rows.length < 2) {
            return res.status(400).json({ success: false, message: 'File không có dữ liệu để import' });
        }

        const headers = rows[0].map(h => h.trim().toLowerCase());
        const indexOf = (...names) => headers.findIndex(h => names.includes(h));
        const idx = {
            ma_hang: indexOf('ma_hang', 'mã hàng', 'ma hang'),
            ten_hang: indexOf('ten_hang', 'tên hàng', 'ten hang'),
            nhom_hang: indexOf('nhom_hang', 'nhóm hàng', 'nhom hang'),
            gia_ban: indexOf('gia_ban', 'giá bán', 'gia ban'),
            gia_von: indexOf('gia_von', 'giá vốn', 'gia von'),
            ton_kho: indexOf('ton_kho', 'tồn kho', 'ton kho')
        };

        if (idx.ten_hang < 0) {
            return res.status(400).json({ success: false, message: 'File cần có cột ten_hang hoặc Tên hàng' });
        }

        let created = 0;
        let skipped = 0;
        let autoCodeCount = await HangHoa.countDocuments();

        for (const row of rows.slice(1)) {
            const tenHang = (row[idx.ten_hang] || '').trim();
            if (!tenHang) {
                skipped++;
                continue;
            }

            let maHang = idx.ma_hang >= 0 ? (row[idx.ma_hang] || '').trim() : '';
            if (!maHang) {
                autoCodeCount++;
                maHang = 'HH' + String(autoCodeCount).padStart(4, '0');
            }

            const exists = await HangHoa.exists({ ma_hang: maHang });
            if (exists) {
                skipped++;
                continue;
            }

            let nhomHangId = null;
            const tenNhom = idx.nhom_hang >= 0 ? (row[idx.nhom_hang] || '').trim() : '';
            if (tenNhom) {
                const nhom = await NhomHang.findOneAndUpdate(
                    { ten_nhom_hang: tenNhom },
                    { $setOnInsert: { ten_nhom_hang: tenNhom } },
                    { new: true, upsert: true }
                );
                nhomHangId = nhom._id;
            }

            await HangHoa.create({
                ma_hang: maHang,
                ten_hang: tenHang,
                nhom_hang_id: nhomHangId,
                gia_ban: idx.gia_ban >= 0 ? numberFromCsv(row[idx.gia_ban]) : 0,
                gia_von: idx.gia_von >= 0 ? numberFromCsv(row[idx.gia_von]) : 0,
                ton_kho: idx.ton_kho >= 0 ? numberFromCsv(row[idx.ton_kho]) : 0,
                trang_thai: 'active'
            });
            created++;
        }

        res.json({ success: true, message: `Đã import ${created} hàng hóa, bỏ qua ${skipped} dòng`, created, skipped });
    } catch (error) {
        next(error);
    }
};

exports.addCategory = async (req, res, next) => {
    try {
        const { ten_nhom_hang, nhom_cha_id } = req.body || {};
        if (!ten_nhom_hang || ten_nhom_hang.trim() === '') {
            return res.status(400).json({ success: false, message: 'Thiếu tên nhóm hàng' });
        }
        const exists = await NhomHang.findOne({ ten_nhom_hang: ten_nhom_hang.trim() });
        if (exists) {
            return res.status(400).json({ success: false, message: 'Nhóm hàng đã tồn tại' });
        }
        const nhom = await NhomHang.create({
            ten_nhom_hang: ten_nhom_hang.trim(),
            nhom_cha_id: nullableId(nhom_cha_id)
        });
        res.json({ success: true, data: nhom });
    } catch (error) {
        next(error);
    }
};

exports.addBrand = async (req, res, next) => {
    try {
        const { ten_thuong_hieu } = req.body || {};
        if (!ten_thuong_hieu || ten_thuong_hieu.trim() === '') {
            return res.status(400).json({ success: false, message: 'Thiếu tên thương hiệu' });
        }
        const brand = await ThuongHieu.create({ ten_thuong_hieu: ten_thuong_hieu.trim() });
        res.json({ success: true, data: brand });
    } catch (error) {
        next(error);
    }
};

exports.addUnit = async (req, res, next) => {
    try {
        const { ten_don_vi } = req.body || {};
        if (!ten_don_vi || ten_don_vi.trim() === '') {
            return res.status(400).json({ success: false, message: 'Thiếu tên đơn vị tính' });
        }
        const unit = await DonViTinh.create({ ten_don_vi: ten_don_vi.trim() });
        res.json({ success: true, data: unit });
    } catch (error) {
        next(error);
    }
};

exports.addLocation = async (req, res, next) => {
    try {
        const { ten_vi_tri } = req.body || {};
        if (!ten_vi_tri || ten_vi_tri.trim() === '') {
            return res.status(400).json({ success: false, message: 'Thiếu tên vị trí' });
        }
        const location = await ViTri.create({ ten_vi_tri: ten_vi_tri.trim() });
        res.json({ success: true, data: location });
    } catch (error) {
        next(error);
    }
};
