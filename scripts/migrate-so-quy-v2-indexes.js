require('dotenv').config();

const { mongoose, connectDB } = require('../models/db.model');
const { SoQuy, PhieuThuChi } = require('../models/kiot.model');

const OLD_SO_QUY_NAME_INDEX_KEY = { cua_hang_id: 1, ten_so_quy: 1 };

function sameIndexKey(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function printIndexes(title, indexes) {
  console.log('\n' + title);
  indexes.forEach(function(index) {
    console.log(JSON.stringify({
      name: index.name,
      key: index.key,
      unique: Boolean(index.unique),
      partialFilterExpression: index.partialFilterExpression || undefined
    }));
  });
}

async function collectionExists(name) {
  return mongoose.connection.db.listCollections({ name: name }).hasNext();
}

async function assertNoDuplicateSoQuyData(soQuyCollection) {
  var count = await soQuyCollection.countDocuments();
  if (!count) {
    console.log('so_quy is empty - duplicate preflight skipped.');
    return;
  }

  var duplicateNames = await soQuyCollection.aggregate([
    {
      $group: {
        _id: {
          cua_hang_id: '$cua_hang_id',
          chi_nhanh_id: { $ifNull: ['$chi_nhanh_id', null] },
          loai_so_quy: { $ifNull: ['$loai_so_quy', 'tien_mat'] },
          ten_so_quy: '$ten_so_quy'
        },
        count: { $sum: 1 },
        ids: { $push: '$_id' }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  var duplicateBankAccounts = await soQuyCollection.aggregate([
    {
      $match: {
        loai_so_quy: 'chuyen_khoan',
        'thong_tin_ngan_hang.so_tai_khoan': { $type: 'string' }
      }
    },
    {
      $group: {
        _id: {
          cua_hang_id: '$cua_hang_id',
          so_tai_khoan: '$thong_tin_ngan_hang.so_tai_khoan'
        },
        count: { $sum: 1 },
        ids: { $push: '$_id' }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  var duplicateDefaults = await soQuyCollection.aggregate([
    { $match: { mac_dinh: true } },
    {
      $group: {
        _id: {
          cua_hang_id: '$cua_hang_id',
          chi_nhanh_id: { $ifNull: ['$chi_nhanh_id', null] },
          loai_so_quy: { $ifNull: ['$loai_so_quy', 'tien_mat'] }
        },
        count: { $sum: 1 },
        ids: { $push: '$_id' }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  if (duplicateNames.length || duplicateBankAccounts.length || duplicateDefaults.length) {
    console.error('Cannot create SoQuy v2 unique indexes because duplicate data exists.');
    console.error(JSON.stringify({
      duplicateNames: duplicateNames,
      duplicateBankAccounts: duplicateBankAccounts,
      duplicateDefaults: duplicateDefaults
    }, null, 2));
    throw new Error('Duplicate so_quy data must be cleaned before running this migration.');
  }
}

async function dropOldSoQuyNameIndex(soQuyCollection) {
  var indexes = await soQuyCollection.indexes();
  var oldIndexes = indexes.filter(function(index) {
    return index.name !== '_id_' && sameIndexKey(index.key, OLD_SO_QUY_NAME_INDEX_KEY);
  });

  if (!oldIndexes.length) {
    console.log('Old index { cua_hang_id: 1, ten_so_quy: 1 } not found.');
    return;
  }

  for (var i = 0; i < oldIndexes.length; i++) {
    console.log('Dropping old SoQuy index:', oldIndexes[i].name);
    await soQuyCollection.dropIndex(oldIndexes[i].name);
  }
}

async function main() {
  await connectDB();

  var hasSoQuy = await collectionExists('so_quy');
  var soQuyCollection = mongoose.connection.collection('so_quy');
  var phieuThuChiCollection = mongoose.connection.collection('phieu_thu_chi');

  if (!hasSoQuy) {
    console.log('Collection so_quy does not exist yet. Indexes will be created from schema.');
  }

  var beforeSoQuyIndexes = hasSoQuy ? await soQuyCollection.indexes() : [];
  var beforePhieuThuChiIndexes = await collectionExists('phieu_thu_chi')
    ? await phieuThuChiCollection.indexes()
    : [];

  printIndexes('SoQuy indexes before migration:', beforeSoQuyIndexes);
  printIndexes('PhieuThuChi indexes before migration:', beforePhieuThuChiIndexes);

  if (hasSoQuy) {
    await assertNoDuplicateSoQuyData(soQuyCollection);
    await dropOldSoQuyNameIndex(soQuyCollection);
  }

  console.log('\nSyncing SoQuy indexes...');
  await SoQuy.syncIndexes();

  console.log('Syncing PhieuThuChi indexes...');
  await PhieuThuChi.syncIndexes();

  printIndexes('SoQuy indexes after migration:', await soQuyCollection.indexes());
  printIndexes('PhieuThuChi indexes after migration:', await phieuThuChiCollection.indexes());
}

main()
  .then(async function() {
    await mongoose.connection.close();
    console.log('\nSoQuy v2 index migration completed.');
    process.exit(0);
  })
  .catch(async function(error) {
    console.error('\nSoQuy v2 index migration failed.');
    console.error(error && error.stack ? error.stack : error);
    try {
      await mongoose.connection.close();
    } catch (_) {}
    process.exit(1);
  });
