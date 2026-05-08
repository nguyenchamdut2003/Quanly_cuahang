require('dotenv').config();

const { mongoose, connectDB } = require('../models/db.model');
const { CuaHang, Kho } = require('../models/kiot.model');

function warehouseCode(prefix, storeId) {
  return `${prefix}_${String(storeId)}`;
}

async function ensureWarehouse(store, config) {
  const code = warehouseCode(config.prefix, store._id);
  const existing = await Kho.findOne({
    $or: [
      { ma_kho: code },
      {
        cua_hang_id: store._id,
        ten_kho: config.name,
        loai_kho: config.type
      }
    ]
  });

  if (existing) {
    const updates = {};
    if (!existing.cua_hang_id) updates.cua_hang_id = store._id;
    if (existing.trang_thai !== 'active') updates.trang_thai = 'active';
    if (Object.keys(updates).length) {
      await Kho.updateOne({ _id: existing._id }, { $set: updates });
    }
    return { created: false, id: existing._id };
  }

  const created = await Kho.create({
    ma_kho: code,
    ten_kho: config.name,
    loai_kho: config.type,
    trang_thai: 'active',
    cua_hang_id: store._id,
    ghi_chu: 'Kho mặc định tạo tự động để dùng cho nghiệp vụ tồn kho'
  });

  return { created: true, id: created._id };
}

async function main() {
  await connectDB();

  const stores = await CuaHang.find().sort({ created_at: 1, ten_cua_hang: 1 });
  let createdCount = 0;
  let existedCount = 0;
  let skippedCount = 0;

  for (const store of stores) {
    const activeCount = await Kho.countDocuments({
      cua_hang_id: store._id,
      trang_thai: 'active'
    });

    if (activeCount > 0) {
      skippedCount += 1;
      console.log(`[skip] ${store.ten_cua_hang}: đã có ${activeCount} kho active`);
      continue;
    }

    const configs = [
      { prefix: 'KHO_BH', name: 'Kho bán hàng', type: 'ban_hang' },
      { prefix: 'KHO_LOI', name: 'Kho hàng lỗi', type: 'loi' }
    ];

    for (const config of configs) {
      const result = await ensureWarehouse(store, config);
      if (result.created) {
        createdCount += 1;
        console.log(`[created] ${store.ten_cua_hang}: ${config.name}`);
      } else {
        existedCount += 1;
        console.log(`[exists] ${store.ten_cua_hang}: ${config.name}`);
      }
    }
  }

  console.log('--- Summary ---');
  console.log(`Cửa hàng kiểm tra: ${stores.length}`);
  console.log(`Kho tạo mới: ${createdCount}`);
  console.log(`Kho đã tồn tại/cập nhật: ${existedCount}`);
  console.log(`Cửa hàng bỏ qua vì đã có kho active: ${skippedCount}`);
}

main()
  .catch(error => {
    console.error('[error]', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
