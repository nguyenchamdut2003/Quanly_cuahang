/**
 * Gỡ mọi unique index don_hang_id trên hoa_don_ban_hang (cho phép nhiều HĐ / một đơn).
 * Chạy một lần trên DB thật: node scripts/migrate-hoa-don-don-hang-index.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/quanly_cuahang';
  await mongoose.connect(uri);
  const col = mongoose.connection.collection('hoa_don_ban_hang');
  let indexes = await col.indexes();
  const uniqueIndexes = indexes.filter(idx => idx.key && idx.key.don_hang_id === 1 && idx.unique);
  if (uniqueIndexes.length) {
    for (const idx of uniqueIndexes) {
      await col.dropIndex(idx.name);
      console.log('Dropped unique index:', idx.name);
    }
  } else {
    console.log('No unique don_hang_id index found — OK');
  }
  indexes = await col.indexes();
  const hasPlain = indexes.some(idx => idx.key && idx.key.don_hang_id === 1 && !idx.unique);
  if (!hasPlain) {
    await col.createIndex({ don_hang_id: 1 }, { name: 'don_hang_id_1', background: true });
    console.log('Created non-unique index { don_hang_id: 1 }');
  } else {
    console.log('Non-unique don_hang_id index already exists — OK');
  }
  console.log('Current indexes on don_hang_id:', (await col.indexes()).filter(i => i.key && i.key.don_hang_id === 1));
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
