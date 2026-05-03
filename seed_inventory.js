const { mongoose } = require('./models/db.model');
const { NhaCungCap, NhomHang, HangHoa } = require('./models/kiot.model');

async function seedInventory() {
    try {
        if (mongoose.connection.readyState !== 1) {
            await new Promise((resolve, reject) => {
                mongoose.connection.once('open', resolve);
                mongoose.connection.once('error', reject);
            });
        }
        
        console.log('Đã có kết nối MongoDB...');

        // 1. Seed Nhóm hàng
        let nhom = await NhomHang.findOne({ ten_nhom_hang: 'Nước giải khát' });
        if (!nhom) {
            nhom = new NhomHang({ ten_nhom_hang: 'Nước giải khát', mo_ta: 'Các loại nước ngọt, nước suối' });
            await nhom.save();
        }

        // 2. Seed Nhà cung cấp
        let ncc = await NhaCungCap.findOne({ ma_ncc: 'NCC001' });
        if (!ncc) {
            ncc = new NhaCungCap({
                ma_ncc: 'NCC001',
                ten_ncc: 'Công ty Coca-Cola Việt Nam',
                sdt: '0281234567',
                email: 'contact@coca.vn',
                dia_chi: 'Quận Thủ Đức, TP.HCM'
            });
            await ncc.save();
        }

        // 3. Seed Hàng hóa
        const items = [
            { ma_hang: 'SP001', ten_hang: 'Coca Cola Lon 330ml', don_vi_tinh: 'Lon', nhom_hang_id: nhom._id, gia_von: 8000, gia_ban: 12000, ton_kho: 100 },
            { ma_hang: 'SP002', ten_hang: 'Pepsi Lon 330ml', don_vi_tinh: 'Lon', nhom_hang_id: nhom._id, gia_von: 7500, gia_ban: 11500, ton_kho: 50 },
            { ma_hang: 'SP003', ten_hang: 'Nước suối Aquafina 500ml', don_vi_tinh: 'Chai', nhom_hang_id: nhom._id, gia_von: 4000, gia_ban: 6000, ton_kho: 200 }
        ];

        for (const item of items) {
            const exist = await HangHoa.findOne({ ma_hang: item.ma_hang });
            if (!exist) {
                await new HangHoa(item).save();
                console.log(`Đã thêm hàng: ${item.ten_hang}`);
            }
        }

        console.log('Hoàn thành seed dữ liệu kho hàng.');
        process.exit(0);
    } catch (error) {
        console.error('Lỗi seed dữ liệu:', error);
        process.exit(1);
    }
}

seedInventory();
