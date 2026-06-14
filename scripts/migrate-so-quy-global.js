require('dotenv').config();

const { mongoose, connectDB } = require('../models/db.model');
const { SoQuy } = require('../models/kiot.model');

async function main() {
  await connectDB();

  const duplicates = await SoQuy.aggregate([
    {
      $group: {
        _id: { loai_so_quy: '$loai_so_quy', ten_so_quy: '$ten_so_quy' },
        count: { $sum: 1 },
        ids: { $push: '$_id' }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]);

  if (duplicates.length) {
    console.log('[migrate-so-quy-global] Found duplicate books by type + name:');
    duplicates.forEach(function(row) {
      console.log(' -', JSON.stringify(row._id), 'count=', row.count, 'ids=', row.ids.map(String).join(', '));
    });
    console.log('[migrate-so-quy-global] Resolve duplicates manually before creating unique indexes.');
    process.exitCode = 1;
    await mongoose.connection.close();
    return;
  }

  const result = await SoQuy.updateMany({}, {
    $unset: { cua_hang_id: '', chi_nhanh_id: '' }
  });
  console.log('[migrate-so-quy-global] Unset store/branch fields:', {
    matched: result.matchedCount,
    modified: result.modifiedCount
  });
  console.log('[migrate-so-quy-global] Drop old indexes manually if needed, then restart app.');
  await mongoose.connection.close();
}

main().catch(async function(error) {
  console.error(error && error.stack ? error.stack : error);
  try { await mongoose.connection.close(); } catch (_) {}
  process.exit(1);
});
