require('dotenv').config();
const mongoose = require('mongoose');
const {
  HangHoa,
  Kho,
  TonKho,
  TonKhoLo,
  TonKhoLoQuyCach,
  LoHang
} = require('../models/kiot.model');

function qty(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function keyOf(...parts) {
  return parts.map(part => String(part || '')).join('|');
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGO_URI');
  await mongoose.connect(uri);

  const [products, warehouses, totalRows, lotRows, qcRows, lots] = await Promise.all([
    HangHoa.find({}).select('ma_hang ten_hang').lean(),
    Kho.find({}).select('ma_kho ten_kho').lean(),
    TonKho.find({}).lean(),
    TonKhoLo.find({}).lean(),
    TonKhoLoQuyCach.find({}).lean(),
    LoHang.find({}).select('ma_lo ten_lo so_luong_con_lai trang_thai').lean()
  ]);

  const productMap = products.reduce((map, row) => {
    map[String(row._id)] = row;
    return map;
  }, {});
  const warehouseMap = warehouses.reduce((map, row) => {
    map[String(row._id)] = row;
    return map;
  }, {});
  const lotMap = lots.reduce((map, row) => {
    map[String(row._id)] = row;
    return map;
  }, {});

  const totalMap = totalRows.reduce((map, row) => {
    map[keyOf(row.kho_id, row.hang_hoa_id)] = row;
    return map;
  }, {});
  const lotSumByProduct = {};
  const lotStockMap = {};
  lotRows.forEach(row => {
    const productKey = keyOf(row.kho_id, row.hang_hoa_id);
    lotSumByProduct[productKey] = qty(lotSumByProduct[productKey]) + qty(row.so_luong);
    lotStockMap[keyOf(row.kho_id, row.hang_hoa_id, row.lo_hang_id)] = row;
  });

  const qcSumByLot = {};
  qcRows.forEach(row => {
    const lotKey = keyOf(row.kho_id, row.hang_hoa_id, row.lo_hang_id);
    qcSumByLot[lotKey] = qty(qcSumByLot[lotKey]) + qty(row.so_luong);
  });

  const findings = [];
  const allProductKeys = new Set([
    ...Object.keys(totalMap),
    ...Object.keys(lotSumByProduct)
  ]);

  for (const productKey of allProductKeys) {
    const [khoId, hangHoaId] = productKey.split('|');
    const totalQty = qty(totalMap[productKey]?.so_luong);
    const lotTotal = qty(lotSumByProduct[productKey]);
    if (totalQty !== lotTotal) {
      findings.push({
        type: 'TonKho_vs_TonKhoLo',
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        ton_kho: totalQty,
        tong_ton_kho_lo: lotTotal
      });
    }
  }

  const allLotKeys = new Set([
    ...Object.keys(lotStockMap),
    ...Object.keys(qcSumByLot)
  ]);

  for (const lotKey of allLotKeys) {
    const [khoId, hangHoaId, loHangId] = lotKey.split('|');
    const lotStock = lotStockMap[lotKey];
    const lot = lotMap[loHangId];
    const lotStockQty = qty(lotStock?.so_luong);
    const lotRemainQty = qty(lot?.so_luong_con_lai);
    const qcTotal = qty(qcSumByLot[lotKey]);
    if (lotStockQty !== qcTotal) {
      findings.push({
        type: 'TonKhoLo_vs_TonKhoLoQuyCach',
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        lo_hang_id: loHangId,
        ton_kho_lo: lotStockQty,
        tong_quy_cach: qcTotal
      });
    }
    if (lot && lotStockQty !== lotRemainQty) {
      findings.push({
        type: 'TonKhoLo_vs_LoHang',
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        lo_hang_id: loHangId,
        ton_kho_lo: lotStockQty,
        lo_hang_con_lai: lotRemainQty
      });
    }
  }

  findings.forEach(item => {
    const product = productMap[item.hang_hoa_id] || {};
    const warehouse = warehouseMap[item.kho_id] || {};
    const lot = lotMap[item.lo_hang_id] || {};
    const label = [
      `[${item.type}]`,
      warehouse.ten_kho || warehouse.ma_kho || item.kho_id,
      product.ma_hang || item.hang_hoa_id,
      product.ten_hang || '',
      lot.ma_lo || lot.ten_lo || item.lo_hang_id || ''
    ].filter(Boolean).join(' | ');
    console.log(label, JSON.stringify(item));
  });

  console.log(JSON.stringify({
    mode: 'dry-run',
    checked: {
      ton_kho: totalRows.length,
      ton_kho_lo: lotRows.length,
      ton_kho_lo_quy_cach: qcRows.length,
      lo_hang: lots.length
    },
    mismatched: findings.length
  }, null, 2));

  await mongoose.disconnect();
}

main().catch(async error => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
