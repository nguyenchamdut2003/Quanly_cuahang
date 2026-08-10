require('dotenv').config();

const { mongoose, connectDB } = require('../models/db.model');
const { DiaChiKhachHang, DiaChiNcc } = require('../models/kiot.model');

async function backfillAddressStatus() {
  await connectDB();

  const missingStatusFilter = {
    $or: [
      { trang_thai: { $exists: false } },
      { trang_thai: null },
      { trang_thai: '' }
    ]
  };

  const customerResult = await DiaChiKhachHang.updateMany(
    missingStatusFilter,
    { $set: { trang_thai: 'active' } },
    { runValidators: true }
  );

  const supplierResult = await DiaChiNcc.updateMany(
    missingStatusFilter,
    { $set: { trang_thai: 'active' } },
    { runValidators: true }
  );

  console.log('[migrate] dia_chi_khach_hang active:', customerResult.modifiedCount);
  console.log('[migrate] dia_chi_ncc active:', supplierResult.modifiedCount);
  console.log('[migrate] Hoan tat.');
}

backfillAddressStatus()
  .catch(function(error) {
    console.error('[migrate] Loi:', error);
    process.exitCode = 1;
  })
  .finally(async function() {
    await mongoose.connection.close();
  });
