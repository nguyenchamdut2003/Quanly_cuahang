const { mongoose } = require('./models/db.model');
const { DonHang, KhachHang, CuaHang } = require('./models/kiot.model');

async function seedReports() {
    try {
        if (mongoose.connection.readyState !== 1) {
            await new Promise((resolve, reject) => {
                mongoose.connection.once('open', resolve);
                mongoose.connection.once('error', reject);
            });
        }
        
        console.log('Đang seed dữ liệu báo cáo...');

        const kh = await KhachHang.findOne();
        const ch = await CuaHang.findOne();

        if (!kh || !ch) {
            console.log('Cần có Khách hàng và Cửa hàng trước khi seed báo cáo.');
            process.exit(1);
        }

        // Tạo dữ liệu cho 30 ngày qua
        for (let i = 0; i < 30; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const revenue = Math.floor(Math.random() * (5000000 - 500000 + 1)) + 500000;
            
            const dh = new DonHang({
                ma_don_hang: 'DH_SEED_' + i,
                ngay_dat: date,
                khach_hang_id: kh._id,
                cua_hang_id: ch._id,
                tong_tien: revenue,
                trang_thai: 'completed'
            });
            await dh.save();
        }

        console.log('Hoàn thành seed dữ liệu báo cáo (30 đơn hàng).');
        process.exit(0);
    } catch (error) {
        console.error('Lỗi seed dữ liệu báo cáo:', error);
        process.exit(1);
    }
}

seedReports();
