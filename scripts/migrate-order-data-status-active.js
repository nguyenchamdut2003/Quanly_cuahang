require('dotenv').config();

const { mongoose, connectDB } = require('../models/db.model');
const { DonHang } = require('../models/kiot.model');

async function backfillOrderDataStatus() {
  await connectDB();

  const result = await DonHang.updateMany(
    {
      $or: [
        { trang_thai_du_lieu: { $exists: false } },
        { trang_thai_du_lieu: null },
        { trang_thai_du_lieu: '' }
      ]
    },
    { $set: { trang_thai_du_lieu: 'active' } },
    { runValidators: true }
  );

  console.log('[migrate] don_hang active:', result.modifiedCount);
  console.log('[migrate] Hoan tat.');
}

backfillOrderDataStatus()
  .catch(function(error) {
    console.error('[migrate] Loi:', error);
    process.exitCode = 1;
  })
  .finally(async function() {
    await mongoose.connection.close();
  });
