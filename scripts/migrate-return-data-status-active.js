require('dotenv').config();

const { mongoose, connectDB } = require('../models/db.model');
const { PhieuTraHang } = require('../models/kiot.model');

async function backfillReturnDataStatus() {
  await connectDB();

  const result = await PhieuTraHang.updateMany(
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

  console.log('[migrate] phieu_tra_hang active:', result.modifiedCount);
  console.log('[migrate] Hoan tat.');
}

backfillReturnDataStatus()
  .catch(function(error) {
    console.error('[migrate] Loi:', error);
    process.exitCode = 1;
  })
  .finally(async function() {
    await mongoose.connection.close();
  });
