require('dotenv').config();

const { mongoose, connectDB } = require('../models/db.model');

async function dropIndexIfExists(collection, key) {
  const indexes = await collection.indexes();
  const found = indexes.find(index => JSON.stringify(index.key) === JSON.stringify(key));
  if (!found) return false;
  await collection.dropIndex(found.name);
  return true;
}

async function main() {
  await connectDB();
  const collection = mongoose.connection.collection('ton_kho_lo');
  const oldKey = { kho_id: 1, hang_hoa_id: 1, lo_hang_id: 1 };
  const newKey = { kho_id: 1, hang_hoa_id: 1, lo_hang_id: 1, gia_tri_thuoc_tinh_id: 1 };

  const droppedOld = await dropIndexIfExists(collection, oldKey);
  await collection.createIndex(newKey, {
    unique: true,
    name: 'kho_id_1_hang_hoa_id_1_lo_hang_id_1_gia_tri_thuoc_tinh_id_1'
  });

  console.log(`[Migration] ton_kho_lo oldIndexDropped=${droppedOld} newIndexEnsured=true`);
}

main()
  .then(async () => {
    await mongoose.connection.close();
  })
  .catch(async (error) => {
    console.error('[Migration] Failed:', error);
    await mongoose.connection.close();
    process.exit(1);
  });
