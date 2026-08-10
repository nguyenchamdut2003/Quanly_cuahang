require('dotenv').config();

const { mongoose, connectDB } = require('../models/db.model');
const { HoaDonBanHang } = require('../models/kiot.model');

async function backfillInvoiceDataStatus() {
  await connectDB();

  const result = await HoaDonBanHang.updateMany(
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

  console.log('[migrate] hoa_don_ban_hang active:', result.modifiedCount);
  console.log('[migrate] Hoan tat.');
}

backfillInvoiceDataStatus()
  .catch(function(error) {
    console.error('[migrate] Loi:', error);
    process.exitCode = 1;
  })
  .finally(async function() {
    await mongoose.connection.close();
  });
