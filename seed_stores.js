const { mongoose } = require('./models/db.model');
const { CuaHang } = require('./models/kiot.model');

async function seedStores() {
    try {
        // Chờ connection sẵn sàng
        if (mongoose.connection.readyState !== 1) {
            await new Promise((resolve, reject) => {
                mongoose.connection.once('open', resolve);
                mongoose.connection.once('error', reject);
            });
        }
        
        console.log('Đã có kết nối MongoDB...');

        const stores = [
            {
                ma_cua_hang: 'CH001',
                ten_cua_hang: 'Kiot Hà Nội - Cầu Giấy',
                sdt: '0988111222',
                email: 'caugiay@kiot.vn',
                dia_chi_gui_hang: 'Số 10 Cầu Giấy, Hà Nội',
                trang_thai: 'active'
            },
            {
                ma_cua_hang: 'CH002',
                ten_cua_hang: 'Kiot Đà Nẵng - Hải Châu',
                sdt: '0977333444',
                email: 'haichau@kiot.vn',
                dia_chi_gui_hang: '150 Hùng Vương, Đà Nẵng',
                trang_thai: 'active'
            },
            {
                ma_cua_hang: 'CH003',
                ten_cua_hang: 'Kiot HCM - Quận 1',
                sdt: '0966555666',
                email: 'quan1@kiot.vn',
                dia_chi_gui_hang: '200 Lê Lợi, Quận 1, TP.HCM',
                trang_thai: 'active'
            }
        ];

        for (const store of stores) {
            const exist = await CuaHang.findOne({ ma_cua_hang: store.ma_cua_hang });
            if (!exist) {
                await new CuaHang(store).save();
                console.log(`Đã thêm: ${store.ten_cua_hang}`);
            } else {
                console.log(`Đã tồn tại: ${store.ma_cua_hang}`);
            }
        }

        console.log('Hoàn thành seed dữ liệu cửa hàng.');
        process.exit(0);
    } catch (error) {
        console.error('Lỗi seed dữ liệu:', error);
        process.exit(1);
    }
}

seedStores();
