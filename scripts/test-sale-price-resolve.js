/**
 * Dry-run kiểm tra resolveSalePrice Phase 0 (không ghi DB).
 * node scripts/test-sale-price-resolve.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { HangHoa, CTBangGia, BangGia } = require('../models/kiot.model');
const { resolveSalePrice } = require('../services/salePrice.service');

async function main() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
        console.error('Thiếu MONGODB_URI');
        process.exit(1);
    }
    await mongoose.connect(uri);

    const sample = await HangHoa.findOne({ gia_co_dinh: { $gt: 0 } })
        .select('ma_hang ten_hang gia_co_dinh gia_von loai_gia')
        .lean();
    if (!sample) {
        console.log('Không có hàng có gia_co_dinh > 0 để test.');
        await mongoose.disconnect();
        return;
    }

    const bangGia = await BangGia.findOne({ trang_thai: 'active' }).select('_id ten_bang_gia').lean();
    const ct = bangGia
        ? await CTBangGia.findOne({ bang_gia_id: bangGia._id, hang_hoa_id: sample._id }).lean()
        : null;

    const r0 = await resolveSalePrice({ hang_hoa_id: sample._id, product: sample });
    const r1 = bangGia
        ? await resolveSalePrice({ hang_hoa_id: sample._id, bang_gia_id: bangGia._id, product: sample })
        : null;

    console.log('Hàng:', sample.ma_hang, sample.ten_hang);
    console.log('  gia_co_dinh:', sample.gia_co_dinh, '| gia_von:', sample.gia_von);
    console.log('Không bảng giá:', r0);
    if (r1) console.log('Có bảng giá:', r1, ct ? '(CT row gia_ban=' + ct.gia_ban + ')' : '(không có CT)');

    if (r0.gia_ban === Number(sample.gia_von) && r0.gia_ban !== Number(sample.gia_co_dinh)) {
        console.error('FAIL: giá bán trùng gia_von thay vì gia_co_dinh');
        process.exitCode = 1;
    } else {
        console.log('OK: không dùng gia_von làm giá bán mặc định.');
    }

    await mongoose.disconnect();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
