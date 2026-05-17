require('dotenv').config();

const { mongoose } = require('../models/db.model');

async function main() {
  const collection = mongoose.connection.collection('lo_hang');
  const result = await collection.updateMany(
    {},
    {
      $unset: {
        ngay_san_xuat: '',
        ngay_thu_hoach: ''
      }
    }
  );

  console.log(`[Migration] lo_hang matched=${result.matchedCount} modified=${result.modifiedCount}`);
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
