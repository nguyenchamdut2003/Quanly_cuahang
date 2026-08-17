require('dotenv').config();

const { mongoose, connectDB } = require('../models/db.model');
const { TamUngNhanVien } = require('../models/chamcong.model');
const { PhieuThuChi } = require('../models/kiot.model');

function tamUngCode(number) {
  return 'TA' + String(number).padStart(4, '0');
}

function tamUngCodeNumber(code) {
  const match = String(code || '').trim().match(/^TA(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function backfillStore(storeId) {
  const rows = await TamUngNhanVien.find({ cua_hang_id: storeId })
    .sort({ ngay_tam_ung: 1, created_at: 1, _id: 1 });

  const used = new Set();
  let maxNumber = 0;
  rows.forEach(function(row) {
    const code = String(row.ma_tam_ung || '').trim().toUpperCase();
    if (!code) return;
    used.add(code);
    maxNumber = Math.max(maxNumber, tamUngCodeNumber(code));
  });

  let assigned = 0;
  let receiptUpdated = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row.ma_tam_ung) {
      let nextCode = '';
      do {
        maxNumber += 1;
        nextCode = tamUngCode(maxNumber);
      } while (used.has(nextCode));

      row.ma_tam_ung = nextCode;
      used.add(nextCode);
      await row.save();
      assigned += 1;
    }

    const oldId = String(row._id);
    const result = await PhieuThuChi.updateMany(
      {
        cua_hang_id: storeId,
        loai_phieu: 'chi',
        $or: [
          { ma_chung_tu_goc: oldId },
          { chung_tu_khac: 'TAM_UNG_NHAN_VIEN:' + oldId },
          { ma_chung_tu_goc: row.ma_tam_ung },
          { chung_tu_khac: row.ma_tam_ung }
        ]
      },
      {
        $set: {
          ma_chung_tu_goc: row.ma_tam_ung,
          chung_tu_khac: row.ma_tam_ung,
          nhom_doi_tuong: 'nhan_vien',
          nhan_vien_id: row.nhan_vien_id
        }
      },
      { runValidators: true }
    );
    receiptUpdated += result.modifiedCount || 0;
  }

  return { assigned, receiptUpdated };
}

async function main() {
  await connectDB();

  const storeIds = await TamUngNhanVien.distinct('cua_hang_id');
  let assigned = 0;
  let receiptUpdated = 0;

  for (let index = 0; index < storeIds.length; index += 1) {
    const result = await backfillStore(storeIds[index]);
    assigned += result.assigned;
    receiptUpdated += result.receiptUpdated;
  }

  console.log('[backfill] tam_ung_nhan_vien ma_tam_ung:', assigned);
  console.log('[backfill] phieu_thu_chi chung_tu_lien_quan:', receiptUpdated);
  console.log('[backfill] Hoan tat.');
}

main()
  .catch(function(error) {
    console.error('[backfill] Loi:', error);
    process.exitCode = 1;
  })
  .finally(async function() {
    await mongoose.connection.close();
  });
