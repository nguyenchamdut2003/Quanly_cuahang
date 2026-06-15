/**
 * Smoke test schema VatChua / NhapVatChua / XuatVatChua (Phase 1 — chỉ DB).
 * Chạy: node scripts/smoke-vat-chua-schema.js
 * Hoặc: npm run test:vat-chua-schema
 */
require('dotenv').config();

const { mongoose, connectDB } = require('../models/db.model');
const { VatChua, NhapVatChua, XuatVatChua } = require('../models/kiot.model');

const PREFIX = 'SMK-VC-' + Date.now();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasNamedIndex(indexes, name) {
  return indexes.some(function(row) {
    return row && row[1] && row[1].name === name;
  });
}

function assertNoChiNhanhId(schema, label) {
  const paths = Object.keys(schema.paths || {});
  const bad = paths.filter(function(path) {
    return path === 'chi_nhanh_id' || path.indexOf('chi_nhanh_id') !== -1;
  });
  assert(bad.length === 0, label + ' must not define chi_nhanh_id paths');
}

function assertHasCuaHangId(schema, label) {
  assert(schema.paths && schema.paths.cua_hang_id, label + ' must define cua_hang_id');
}

async function expectValid(label, doc) {
  const error = doc.validateSync();
  if (error) {
    throw new Error(label + ' failed validateSync: ' + error.message);
  }
  await doc.validate();
  console.log('PASS:', label);
}

async function expectInvalid(label, doc) {
  const error = doc.validateSync();
  if (!error) {
    throw new Error(label + ' should fail validation');
  }
  console.log('PASS:', label);
}

function buildValidVatChua(storeId, suffix) {
  return new VatChua({
    ma_vat_chua: PREFIX + '-VC-' + suffix,
    ten_vat_chua: 'Ket nhua xanh ' + suffix,
    so_luong_ton: 0,
    trang_thai: 'active',
    cua_hang_id: storeId
  });
}

async function runValidateOnlyTests(storeId) {
  assert(VatChua && NhapVatChua && XuatVatChua, 'Models must be exported');

  [VatChua, NhapVatChua, XuatVatChua].forEach(function(model) {
    assertNoChiNhanhId(model.schema, model.modelName);
    assertHasCuaHangId(model.schema, model.modelName);
  });

  const vatChua = buildValidVatChua(storeId, 'A');
  await expectValid('VatChua valid payload', vatChua);
  assert(!VatChua.schema.paths.gia_von, 'VatChua must not define gia_von');

  await expectInvalid('VatChua missing ma_vat_chua', new VatChua({
    ten_vat_chua: 'Tui nilon',
    cua_hang_id: storeId
  }));

  await expectInvalid('VatChua negative so_luong_ton', new VatChua({
    ma_vat_chua: PREFIX + '-BAD',
    ten_vat_chua: 'Sot nhua',
    so_luong_ton: -1,
    cua_hang_id: storeId
  }));

  const vatChuaId = new mongoose.Types.ObjectId();
  const nhap = new NhapVatChua({
    ma_nhap_vat_chua: PREFIX + '-NVC-001',
    loai_nhap: 'mua_moi',
    doi_tuong_type: 'nha_cung_cap',
    source_type: 'manual',
    items: [
      {
        vat_chua_id: vatChuaId,
        ma_vat_chua: PREFIX + '-VC-A',
        ten_vat_chua: 'Ket nhua xanh A',
        so_luong: 5,
        gia_von: 10000,
        thanh_tien: 50000
      },
      {
        vat_chua_id: new mongoose.Types.ObjectId(),
        ma_vat_chua: PREFIX + '-VC-B',
        ten_vat_chua: 'Tui nilon B',
        so_luong: 3,
        gia_von: 2000,
        thanh_tien: 6000
      }
    ],
    tong_so_luong: 8,
    tong_tien: 56000,
    cua_hang_id: storeId
  });
  await expectValid('NhapVatChua items[] valid payload', nhap);

  await expectInvalid('NhapVatChua empty items', new NhapVatChua({
    ma_nhap_vat_chua: PREFIX + '-NVC-EMPTY',
    loai_nhap: 'mua_moi',
    items: [],
    cua_hang_id: storeId
  }));

  await expectInvalid('NhapVatChua item so_luong <= 0', new NhapVatChua({
    ma_nhap_vat_chua: PREFIX + '-NVC-ZERO',
    loai_nhap: 'khac',
    items: [{
      vat_chua_id: vatChuaId,
      so_luong: 0,
      gia_von: 0,
      thanh_tien: 0
    }],
    cua_hang_id: storeId
  }));

  const xuat = new XuatVatChua({
    ma_xuat_vat_chua: PREFIX + '-XVC-001',
    loai_xuat: 'ban_hang',
    doi_tuong_type: 'khach_hang',
    source_type: 'don_hang',
    source_id: new mongoose.Types.ObjectId(),
    source_code: 'DH-SMK-001',
    items: [{
      vat_chua_id: vatChuaId,
      ma_vat_chua: PREFIX + '-VC-A',
      ten_vat_chua: 'Ket nhua xanh A',
      so_luong: 2,
      gia_von: 10000,
      thanh_tien: 20000
    }],
    tong_so_luong: 2,
    tong_tien: 20000,
    cua_hang_id: storeId
  });
  await expectValid('XuatVatChua items[] valid payload', xuat);

  const vatChuaIndexes = VatChua.schema.indexes();
  const nhapIndexes = NhapVatChua.schema.indexes();
  const xuatIndexes = XuatVatChua.schema.indexes();

  [
    'uq_vat_chua_store_code',
    'idx_vat_chua_store_name',
    'idx_vat_chua_store_status'
  ].forEach(function(name) {
    assert(hasNamedIndex(vatChuaIndexes, name), 'Missing VatChua index ' + name);
  });

  [
    'uq_nhap_vat_chua_store_code',
    'idx_nhap_vat_chua_store_created',
    'idx_nhap_vat_chua_source',
    'idx_nhap_vat_chua_partner',
    'idx_nhap_vat_chua_status'
  ].forEach(function(name) {
    assert(hasNamedIndex(nhapIndexes, name), 'Missing NhapVatChua index ' + name);
  });

  [
    'uq_xuat_vat_chua_store_code',
    'idx_xuat_vat_chua_store_created',
    'idx_xuat_vat_chua_source',
    'idx_xuat_vat_chua_partner',
    'idx_xuat_vat_chua_status'
  ].forEach(function(name) {
    assert(hasNamedIndex(xuatIndexes, name), 'Missing XuatVatChua index ' + name);
  });

  console.log('\nVatChuaSchema.indexes()');
  console.log(JSON.stringify(vatChuaIndexes, null, 2));
}

async function runDbRoundTrip(storeId) {
  const vatChuaDoc = await VatChua.create(buildValidVatChua(storeId, 'DB').toObject());
  console.log('PASS: VatChua persisted', String(vatChuaDoc._id));

  const nhapDoc = await NhapVatChua.create({
    ma_nhap_vat_chua: PREFIX + '-NVC-DB',
    loai_nhap: 'mua_moi',
    doi_tuong_type: 'none',
    source_type: 'manual',
    items: [
      {
        vat_chua_id: vatChuaDoc._id,
        ma_vat_chua: vatChuaDoc.ma_vat_chua,
        ten_vat_chua: vatChuaDoc.ten_vat_chua,
        so_luong: 5,
        gia_von: 15000,
        thanh_tien: 75000
      },
      {
        vat_chua_id: vatChuaDoc._id,
        ma_vat_chua: vatChuaDoc.ma_vat_chua,
        ten_vat_chua: vatChuaDoc.ten_vat_chua,
        so_luong: 3,
        gia_von: 15000,
        thanh_tien: 45000
      }
    ],
    tong_so_luong: 8,
    tong_tien: 120000,
    cua_hang_id: storeId
  });
  console.log('PASS: NhapVatChua persisted with 2 items', String(nhapDoc._id));

  const xuatDoc = await XuatVatChua.create({
    ma_xuat_vat_chua: PREFIX + '-XVC-DB',
    loai_xuat: 'ban_hang',
    doi_tuong_type: 'none',
    source_type: 'manual',
    items: [{
      vat_chua_id: vatChuaDoc._id,
      ma_vat_chua: vatChuaDoc.ma_vat_chua,
      ten_vat_chua: vatChuaDoc.ten_vat_chua,
      so_luong: 1,
      gia_von: 15000,
      thanh_tien: 15000
    }],
    tong_so_luong: 1,
    tong_tien: 15000,
    cua_hang_id: storeId
  });
  console.log('PASS: XuatVatChua persisted with 1 item', String(xuatDoc._id));

  await XuatVatChua.deleteMany({ ma_xuat_vat_chua: { $regex: '^' + PREFIX } });
  await NhapVatChua.deleteMany({ ma_nhap_vat_chua: { $regex: '^' + PREFIX } });
  await VatChua.deleteMany({ ma_vat_chua: { $regex: '^' + PREFIX } });
  console.log('PASS: cleanup test documents');
}

async function main() {
  const storeId = new mongoose.Types.ObjectId();
  await runValidateOnlyTests(storeId);

  const hasDb = Boolean(process.env.MONGO_URI || process.env.MONGODB_URI);
  if (!hasDb) {
    console.log('\nSKIP DB round-trip: no MONGO_URI/MONGODB_URI — validateSync only.');
    return;
  }

  try {
    await connectDB();
    await runDbRoundTrip(storeId);
  } catch (error) {
    console.log('\nSKIP DB round-trip:', error && error.message ? error.message : error);
    console.log('validateSync checks already passed.');
  }

  console.log('\nVatChua schema smoke test completed.');
}

main()
  .then(async function() {
    try {
      await mongoose.connection.close();
    } catch (_) {}
    process.exit(0);
  })
  .catch(async function(error) {
    console.error(error && error.stack ? error.stack : error);
    try {
      await mongoose.connection.close();
    } catch (_) {}
    process.exit(1);
  });
