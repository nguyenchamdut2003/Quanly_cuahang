require('dotenv').config();

const { mongoose, connectDB } = require('../models/db.model');
const { KhachHang } = require('../models/kiot.model');

async function migrateKhachHangCccdToMst() {
  await connectDB();

  const collection = KhachHang.collection;
  const withCccd = await collection.countDocuments({ cccd: { $exists: true, $ne: null, $ne: '' } });
  const withMstOnly = await collection.countDocuments({
    mst: { $exists: true, $ne: null, $ne: '' },
    $or: [
      { cccd: { $exists: false } },
      { cccd: null },
      { cccd: '' }
    ]
  });

  console.log('[migrate] Khach hang co cccd:', withCccd);
  console.log('[migrate] Khach hang chi co mst:', withMstOnly);

  const copyResult = await collection.updateMany(
    {
      cccd: { $exists: true, $ne: null, $ne: '' },
      $or: [
        { mst: { $exists: false } },
        { mst: null },
        { mst: '' }
      ]
    },
    [{ $set: { mst: '$cccd' } }]
  );

  const unsetResult = await collection.updateMany(
    { cccd: { $exists: true } },
    { $unset: { cccd: '' } }
  );

  console.log('[migrate] Da copy cccd -> mst:', copyResult.modifiedCount);
  console.log('[migrate] Da xoa field cccd:', unsetResult.modifiedCount);
  console.log('[migrate] Hoan tat.');
}

migrateKhachHangCccdToMst()
  .catch(function(error) {
    console.error('[migrate] Loi:', error);
    process.exitCode = 1;
  })
  .finally(async function() {
    await mongoose.connection.close();
  });
