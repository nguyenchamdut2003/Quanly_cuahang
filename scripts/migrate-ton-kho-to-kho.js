require('dotenv').config();

const { mongoose } = require('../models/db.model');
const { ChiNhanh, Kho } = require('../models/kiot.model');

const DEFAULT_WAREHOUSE_NAME = 'Kho mặc định';

function defaultWarehouseCode(branchId) {
  return `KHO-MAC-DINH-${branchId}`;
}

async function getOrCreateDefaultWarehouse(branch) {
  const existingWarehouse = await Kho.findOne({
    chi_nhanh_id: branch._id,
    ten_kho: DEFAULT_WAREHOUSE_NAME,
    loai_kho: 'ban_hang'
  });

  if (existingWarehouse) {
    return { warehouse: existingWarehouse, created: false };
  }

  const warehouseCode = defaultWarehouseCode(branch._id.toString());
  const result = await Kho.updateOne(
    { ma_kho: warehouseCode },
    {
      $setOnInsert: {
        ma_kho: warehouseCode,
        ten_kho: DEFAULT_WAREHOUSE_NAME,
        loai_kho: 'ban_hang',
        trang_thai: 'active',
        cua_hang_id: branch.cua_hang_id,
        chi_nhanh_id: branch._id,
        ghi_chu: 'Kho mặc định tạo khi migration tồn kho theo kho'
      }
    },
    { upsert: true }
  );
  const warehouse = await Kho.findOne({ ma_kho: warehouseCode });

  return { warehouse, created: result.upsertedCount > 0 };
}

async function main() {
  const tonKhoCollection = mongoose.connection.collection('ton_kho');
  const branchIds = await tonKhoCollection.distinct('chi_nhanh_id', {
    chi_nhanh_id: { $exists: true, $ne: null }
  });

  let warehousesCreated = 0;
  let warehousesReused = 0;
  let inventoryUpdated = 0;
  let skippedMissingBranch = 0;

  console.log(`[Migration] Found ${branchIds.length} chi_nhanh_id values in ton_kho`);

  for (const branchId of branchIds) {
    const branch = await ChiNhanh.findById(branchId);

    if (!branch) {
      skippedMissingBranch += 1;
      console.log(`[Migration] Skipped chi_nhanh_id=${branchId}: branch not found`);
      continue;
    }

    const { warehouse, created } = await getOrCreateDefaultWarehouse(branch);
    if (created) {
      warehousesCreated += 1;
      console.log(`[Migration] Created default warehouse ${warehouse._id} for chi_nhanh_id=${branch._id}`);
    } else {
      warehousesReused += 1;
      console.log(`[Migration] Reused default warehouse ${warehouse._id} for chi_nhanh_id=${branch._id}`);
    }

    const result = await tonKhoCollection.updateMany(
      {
        chi_nhanh_id: branch._id,
        $or: [
          { kho_id: { $exists: false } },
          { kho_id: null }
        ]
      },
      {
        $set: {
          kho_id: warehouse._id
        }
      }
    );

    const modifiedCount = result.modifiedCount || 0;
    inventoryUpdated += modifiedCount;
    console.log(`[Migration] Updated ${modifiedCount} ton_kho records for chi_nhanh_id=${branch._id}`);
  }

  console.log(JSON.stringify({
    warehousesCreated,
    warehousesReused,
    inventoryUpdated,
    skippedMissingBranch
  }, null, 2));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
