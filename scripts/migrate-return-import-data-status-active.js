require('dotenv').config();

const { mongoose, connectDB } = require('../models/db.model');
const { PhieuTraHangNhap } = require('../models/kiot.model');

async function backfillReturnImportDataStatus() {
  await connectDB();

  const result = await PhieuTraHangNhap.updateMany(
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

  console.log('[migrate] phieu_tra_hang_nhap active:', result.modifiedCount);
  console.log('[migrate] Hoan tat.');
}

backfillReturnImportDataStatus()
  .catch(function(error) {
    console.error('[migrate] Loi:', error);
    process.exitCode = 1;
  })
  .finally(async function() {
    await mongoose.connection.close();
  });
