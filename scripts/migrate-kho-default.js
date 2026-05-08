require('dotenv').config();

const { mongoose, connectDB } = require('../models/db.model');
const models = require('../models/kiot.model');

const { ChiNhanh, HangHoa, Kho } = models;

const DEFAULT_WAREHOUSE_NAME = 'Kho mặc định';
const DEFAULT_LOT_NAME = 'Lô mặc định';

const BUSINESS_COLLECTIONS = [
  'phieu_nhap',
  'don_hang',
  'hoa_don_ban_hang',
  'phieu_tra_hang',
  'phieu_kiem_kho',
  'lich_su_kho',
  'phieu_xuat_noi_bo'
];

function missingKhoQuery(extra = {}) {
  return {
    ...extra,
    $or: [
      { kho_id: { $exists: false } },
      { kho_id: null }
    ]
  };
}

function hasBranchQuery() {
  return {
    chi_nhanh_id: { $exists: true, $ne: null }
  };
}

function missingBranchQuery() {
  return {
    $and: [
      missingKhoQuery(),
      {
        $or: [
          { chi_nhanh_id: { $exists: false } },
          { chi_nhanh_id: null }
        ]
      }
    ]
  };
}

function defaultWarehouseCode(branch) {
  return `KHO_MD_${branch._id.toString()}`;
}

function defaultLotCode(inventory) {
  return `LO_MD_${inventory.hang_hoa_id.toString()}_${inventory.kho_id.toString()}`;
}

async function getDefaultWarehouse(branch) {
  const warehouseCode = defaultWarehouseCode(branch);
  const existingWarehouse = await Kho.findOne({
    $or: [
      {
        chi_nhanh_id: branch._id,
        ten_kho: DEFAULT_WAREHOUSE_NAME
      },
      { ma_kho: warehouseCode }
    ]
  });

  if (existingWarehouse) {
    return { warehouse: existingWarehouse, created: false };
  }

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
        ghi_chu: 'Kho mặc định tạo khi migration dữ liệu tồn kho cũ'
      }
    },
    { upsert: true }
  );

  const warehouse = await Kho.findOne({ ma_kho: warehouseCode });
  return { warehouse, created: result.upsertedCount > 0 };
}

async function createDefaultWarehouses(tonKhoCollection) {
  const branchIds = await tonKhoCollection.distinct('chi_nhanh_id', hasBranchQuery());
  const warehouseByBranchId = new Map();
  const stats = {
    branchCount: branchIds.length,
    warehousesCreated: 0,
    warehousesExisting: 0,
    skippedMissingBranch: 0
  };

  console.log(`[Kho] Tổng số chi nhánh có tồn kho: ${branchIds.length}`);

  for (const branchId of branchIds) {
    const branch = await ChiNhanh.findById(branchId);

    if (!branch) {
      stats.skippedMissingBranch += 1;
      console.warn(`[Kho] Bỏ qua chi_nhanh_id=${branchId}: không tìm thấy chi nhánh`);
      continue;
    }

    const { warehouse, created } = await getDefaultWarehouse(branch);
    warehouseByBranchId.set(branch._id.toString(), warehouse);

    if (created) {
      stats.warehousesCreated += 1;
      console.log(`[Kho] Đã tạo kho mặc định ${warehouse._id} cho chi_nhanh_id=${branch._id}`);
    } else {
      stats.warehousesExisting += 1;
      console.log(`[Kho] Kho mặc định đã tồn tại ${warehouse._id} cho chi_nhanh_id=${branch._id}`);
    }
  }

  return { warehouseByBranchId, stats };
}

async function migrateInventory(tonKhoCollection, warehouseByBranchId) {
  let inventoryUpdated = 0;
  let inventoryCuaHangUpdated = 0;
  const missingBranchSkipped = await tonKhoCollection.countDocuments(missingBranchQuery());

  for (const [branchId, warehouse] of warehouseByBranchId.entries()) {
    const updateResult = await tonKhoCollection.updateMany(
      missingKhoQuery({ chi_nhanh_id: warehouse.chi_nhanh_id }),
      { $set: { kho_id: warehouse._id } }
    );

    const cuaHangResult = await tonKhoCollection.updateMany(
      {
        chi_nhanh_id: warehouse.chi_nhanh_id,
        kho_id: warehouse._id,
        $or: [
          { cua_hang_id: { $exists: false } },
          { cua_hang_id: null }
        ]
      },
      { $set: { cua_hang_id: warehouse.cua_hang_id } }
    );

    inventoryUpdated += updateResult.modifiedCount || 0;
    inventoryCuaHangUpdated += cuaHangResult.modifiedCount || 0;
    console.log(`[ton_kho] chi_nhanh_id=${branchId}: cập nhật kho_id=${updateResult.modifiedCount || 0}, cua_hang_id=${cuaHangResult.modifiedCount || 0}`);
  }

  if (missingBranchSkipped > 0) {
    console.warn(`[ton_kho] Bỏ qua ${missingBranchSkipped} bản ghi thiếu chi_nhanh_id và chưa có kho_id`);
  }

  return {
    inventoryUpdated,
    inventoryCuaHangUpdated,
    missingBranchSkipped
  };
}

async function migrateBusinessCollections(warehouseByBranchId) {
  const stats = {};

  for (const collectionName of BUSINESS_COLLECTIONS) {
    const collection = mongoose.connection.collection(collectionName);
    let updated = 0;
    const skippedMissingBranch = await collection.countDocuments(missingBranchQuery());

    for (const [branchId, warehouse] of warehouseByBranchId.entries()) {
      const result = await collection.updateMany(
        missingKhoQuery({ chi_nhanh_id: warehouse.chi_nhanh_id }),
        { $set: { kho_id: warehouse._id } }
      );

      updated += result.modifiedCount || 0;
      if ((result.modifiedCount || 0) > 0) {
        console.log(`[${collectionName}] chi_nhanh_id=${branchId}: cập nhật kho_id=${result.modifiedCount}`);
      }
    }

    if (skippedMissingBranch > 0) {
      console.warn(`[${collectionName}] Bỏ qua ${skippedMissingBranch} bản ghi thiếu chi_nhanh_id và chưa có kho_id`);
    }

    stats[collectionName] = {
      updated,
      skippedMissingBranch
    };
  }

  return stats;
}

async function collectionExists(collectionName) {
  const collections = await mongoose.connection.db
    .listCollections({ name: collectionName })
    .toArray();

  return collections.length > 0;
}

async function migrateLotsIfAvailable(tonKhoCollection) {
  const hasLotModels = Boolean(models.LoHang && models.TonKhoLo);
  const hasLotCollections = await collectionExists('lo_hang') && await collectionExists('ton_kho_lo');

  if (!hasLotModels && !hasLotCollections) {
    console.log('[LoHang] Không tìm thấy model/collection lo_hang và ton_kho_lo, bỏ qua migration lô hàng');
    return {
      enabled: false,
      lotsCreated: 0,
      tonKhoLoCreated: 0,
      tonKhoLoUpdated: 0
    };
  }

  const loHangCollection = mongoose.connection.collection('lo_hang');
  const tonKhoLoCollection = mongoose.connection.collection('ton_kho_lo');
  const inventories = await tonKhoCollection.find({
    kho_id: { $exists: true, $ne: null },
    hang_hoa_id: { $exists: true, $ne: null },
    so_luong: { $gt: 0 }
  }).toArray();

  let lotsCreated = 0;
  let tonKhoLoCreated = 0;
  let tonKhoLoUpdated = 0;

  for (const inventory of inventories) {
    const lotCode = defaultLotCode(inventory);
    const goods = await HangHoa.findById(inventory.hang_hoa_id).select('gia_von');
    const cost = goods && typeof goods.gia_von === 'number' ? goods.gia_von : 0;

    const lotQuery = {
      $or: [
        { ma_lo: lotCode },
        {
          hang_hoa_id: inventory.hang_hoa_id,
          kho_id: inventory.kho_id,
          ten_lo: DEFAULT_LOT_NAME
        }
      ]
    };

    const lotResult = await loHangCollection.updateOne(
      lotQuery,
      {
        $setOnInsert: {
          ma_lo: lotCode,
          ten_lo: DEFAULT_LOT_NAME,
          hang_hoa_id: inventory.hang_hoa_id,
          kho_id: inventory.kho_id,
          so_luong_ban_dau: inventory.so_luong,
          so_luong_con_lai: inventory.so_luong,
          gia_von: cost,
          trang_thai: 'active',
          created_at: new Date()
        },
        $set: {
          updated_at: new Date()
        }
      },
      { upsert: true }
    );

    if (lotResult.upsertedCount > 0) {
      lotsCreated += 1;
    }

    const lot = await loHangCollection.findOne(lotQuery);
    const tonKhoLoResult = await tonKhoLoCollection.updateOne(
      {
        kho_id: inventory.kho_id,
        hang_hoa_id: inventory.hang_hoa_id,
        lo_hang_id: lot._id
      },
      {
        $setOnInsert: {
          kho_id: inventory.kho_id,
          hang_hoa_id: inventory.hang_hoa_id,
          lo_hang_id: lot._id,
          created_at: new Date()
        },
        $set: {
          so_luong: inventory.so_luong,
          gia_von: cost,
          updated_at: new Date()
        }
      },
      { upsert: true }
    );

    if (tonKhoLoResult.upsertedCount > 0) {
      tonKhoLoCreated += 1;
    } else if ((tonKhoLoResult.modifiedCount || 0) > 0) {
      tonKhoLoUpdated += 1;
    }
  }

  console.log(`[LoHang] Tạo lô=${lotsCreated}, tạo ton_kho_lo=${tonKhoLoCreated}, cập nhật ton_kho_lo=${tonKhoLoUpdated}`);

  return {
    enabled: true,
    lotsCreated,
    tonKhoLoCreated,
    tonKhoLoUpdated
  };
}

async function main() {
  await connectDB();

  const tonKhoCollection = mongoose.connection.collection('ton_kho');
  const { warehouseByBranchId, stats: warehouseStats } = await createDefaultWarehouses(tonKhoCollection);
  const inventoryStats = await migrateInventory(tonKhoCollection, warehouseByBranchId);
  const businessStats = await migrateBusinessCollections(warehouseByBranchId);
  const lotStats = await migrateLotsIfAvailable(tonKhoCollection);

  console.log('[Summary]');
  console.log(JSON.stringify({
    warehouses: warehouseStats,
    ton_kho: inventoryStats,
    businessCollections: businessStats,
    lots: lotStats
  }, null, 2));
}

main()
  .catch(error => {
    console.error('[Migration] Lỗi khi chạy migration');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
