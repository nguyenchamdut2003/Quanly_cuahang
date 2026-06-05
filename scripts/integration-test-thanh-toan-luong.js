/**
 * Integration test: Thanh toán lương Phase 1 (race + rollback + mã PL)
 * Chạy: node scripts/integration-test-thanh-toan-luong.js
 * Yêu cầu: MONGO_URI Atlas/staging có replica set (transaction).
 * Không gọi API hủy/hoàn phiếu lương.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SHARD_HOSTS = [
  'ac-loxe2hx-shard-00-00.lzgqfpy.mongodb.net:27017',
  'ac-loxe2hx-shard-00-01.lzgqfpy.mongodb.net:27017',
  'ac-loxe2hx-shard-00-02.lzgqfpy.mongodb.net:27017'
];
const REPLICA_SET = 'atlas-wb7i1p-shard-0';

function srvToDirectUri(srvUri) {
  if (!srvUri || !srvUri.startsWith('mongodb+srv://')) return srvUri;
  const rest = srvUri.slice('mongodb+srv://'.length);
  const at = rest.lastIndexOf('@');
  const slash = rest.indexOf('/', at);
  const cred = rest.slice(0, at);
  const pathQuery = rest.slice(slash + 1);
  const hosts = SHARD_HOSTS.join(',');
  const qs = pathQuery.includes('?') ? pathQuery.split('?')[1] : '';
  const params = new URLSearchParams(qs);
  params.set('ssl', 'true');
  params.set('replicaSet', REPLICA_SET);
  if (!params.has('authSource')) params.set('authSource', 'admin');
  const dbName = pathQuery.split('?')[0];
  return 'mongodb://' + cred + '@' + hosts + '/' + dbName + '?' + params.toString();
}

if (process.env.MONGO_URI && process.env.MONGO_URI.startsWith('mongodb+srv://')) {
  process.env.MONGO_URI = srvToDirectUri(process.env.MONGO_URI);
}

const mongoose = require('mongoose');
const { connectDB } = require('../models/db.model');
const { BangLuong, ChiTietBangLuong } = require('../models/hr.model');
const { SoQuy, PhieuThuChi, CuaHang } = require('../models/kiot.model');
const { calculateCashBookBalances } = require('../services/cashBookBalance.service');
const bangLuongController = require('../controllers/bangLuong.controller');

const TAG = '__IT_PAYROLL__';
const AMOUNT_A = 7000000;
const AMOUNT_B = 4000000;

function money(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function snap(doc, fields) {
  if (!doc) return null;
  const o = {};
  fields.forEach((f) => { o[f] = money(doc[f]); });
  if (doc.trang_thai != null) o.trang_thai = doc.trang_thai;
  return o;
}

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = function (code) {
    res.statusCode = code;
    return res;
  };
  res.json = function (data) {
    res.body = data;
    return res;
  };
  return res;
}

async function callPayDetail(req, detailId, body) {
  req.params = { id: String(detailId) };
  req.body = body;
  const res = mockRes();
  await bangLuongController.apiPayDetail(req, res, () => {});
  return { status: res.statusCode, body: res.body };
}

async function loadCashBalance(storeId, soQuyId) {
  const map = await calculateCashBookBalances({
    cua_hang_id: storeId,
    so_quy_ids: [soQuyId]
  });
  return map[String(soQuyId)] || { tong_thu: 0, tong_chi: 0, so_du_tinh_toan: 0 };
}

async function loadState(storeId, payrollId, detailIds, soQuyId) {
  const [payroll, details, soQuy, plCount, balance] = await Promise.all([
    BangLuong.findById(payrollId).lean(),
    ChiTietBangLuong.find({ _id: { $in: detailIds } }).lean(),
    SoQuy.findById(soQuyId).lean(),
    PhieuThuChi.countDocuments({
      cua_hang_id: storeId,
      loai_thu_chi: 'tra_luong_nhan_vien',
      ma_phieu: /^PL/,
      ghi_chu: new RegExp(TAG)
    }),
    loadCashBalance(storeId, soQuyId)
  ]);
  return { payroll, details, soQuy, balance, plCount };
}

async function cleanup(storeId, ids) {
  const { payrollIds, detailIds, soQuyIds, receiptIds } = ids;
  if (receiptIds && receiptIds.length) {
    await PhieuThuChi.deleteMany({ _id: { $in: receiptIds } });
  }
  await PhieuThuChi.deleteMany({
    cua_hang_id: storeId,
    ghi_chu: new RegExp(TAG)
  });
  if (detailIds.length) await ChiTietBangLuong.deleteMany({ _id: { $in: detailIds } });
  if (payrollIds.length) await BangLuong.deleteMany({ _id: { $in: payrollIds } });
  if (soQuyIds.length) await SoQuy.deleteMany({ _id: { $in: soQuyIds } });
}

async function ensureStore() {
  let store = await CuaHang.findOne({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
  if (!store) {
    store = await CuaHang.create({
      ten_cua_hang: TAG + ' store',
      trang_thai: 'active'
    });
  }
  return store;
}

async function seedPayroll(storeId, opts) {
  const now = new Date();
  const nvId = new mongoose.Types.ObjectId();
  const payroll = await BangLuong.create({
    cua_hang_id: storeId,
    ma_bang_luong: TAG + Date.now(),
    ten_bang_luong: TAG + ' bang luong',
    tu_ngay: now,
    den_ngay: now,
    tong_luong: opts.tongLuong,
    da_tra_nhan_vien: 0,
    con_can_tra: opts.tongLuong,
    trang_thai: 'locked'
  });
  const details = [];
  for (let i = 0; i < opts.detailCount; i += 1) {
    const tong = opts.detailTong || opts.tongLuong;
    details.push(await ChiTietBangLuong.create({
      cua_hang_id: storeId,
      bang_luong_id: payroll._id,
      nhan_vien_id: new mongoose.Types.ObjectId(),
      ma_nhan_vien: TAG + 'NV' + i,
      ten_nhan_vien: TAG + ' Nhan vien ' + i,
      tong_luong: tong,
      da_tra: 0,
      con_can_tra: tong,
      trang_thai: 'locked'
    }));
  }
  return { payroll, details };
}

async function seedSoQuy(storeId, suffix) {
  return SoQuy.create({
    cua_hang_id: storeId,
    ten_so_quy: TAG + ' so quy ' + (suffix || ''),
    trang_thai: 'active'
  });
}

function makeReq(storeId) {
  return {
    session: { cua_hang_id: String(storeId) },
    user: { _id: new mongoose.Types.ObjectId() }
  };
}

async function runTestC(storeId, payroll, detail, soQuy, req) {
  const results = [];
  const hooks = [
    {
      label: 'sau update BangLuong, truoc PhieuThuChi',
      patch: async () => {
        const origCreate = PhieuThuChi.create.bind(PhieuThuChi);
        PhieuThuChi.create = async function () {
          throw new Error(TAG + ' forced before receipt');
        };
        return () => { PhieuThuChi.create = origCreate; };
      }
    },
    {
      label: 'sau update CT, truoc PhieuThuChi',
      patch: async () => {
        const orig = PhieuThuChi.create.bind(PhieuThuChi);
        PhieuThuChi.create = async function () {
          throw new Error(TAG + ' forced after CT');
        };
        return () => { PhieuThuChi.create = orig; };
      }
    }
  ];

  for (const hook of hooks) {
    await ChiTietBangLuong.updateOne(
      { _id: detail._id },
      { $set: { da_tra: 0, con_can_tra: 10000000, trang_thai: 'locked' } }
    );
    await BangLuong.updateOne(
      { _id: payroll._id },
      { $set: { da_tra_nhan_vien: 0, con_can_tra: 10000000, trang_thai: 'locked' } }
    );
    const before = await loadState(storeId, payroll._id, [detail._id], soQuy._id);
    const restore = await hook.patch();
    const pay = await callPayDetail(req, detail._id, {
      so_tien: 1000000,
      so_quy_id: String(soQuy._id),
      phuong_thuc_thanh_toan: 'tien_mat',
      ghi_chu: TAG + ' rollback ' + hook.label
    });
    restore();

    const after = await loadState(storeId, payroll._id, [detail._id], soQuy._id);
    const plForCt = await PhieuThuChi.countDocuments({ ct_bang_luong_id: detail._id });
    const unchanged =
      money(after.details[0].da_tra) === money(before.details[0].da_tra) &&
      money(after.details[0].con_can_tra) === money(before.details[0].con_can_tra) &&
      money(after.balance.so_du_tinh_toan) === money(before.balance.so_du_tinh_toan) &&
      money(after.payroll.da_tra_nhan_vien) === money(before.payroll.da_tra_nhan_vien) &&
      plForCt === 0;

    results.push({
      scenario: hook.label,
      status: pay.status,
      message: pay.body && pay.body.message,
      success: pay.body && pay.body.success,
      unchanged,
      before: {
        ct: snap(before.details[0], ['da_tra', 'con_can_tra']),
        bl: snap(before.payroll, ['da_tra_nhan_vien', 'con_can_tra']),
        balance: snap(before.balance, ['tong_thu', 'tong_chi', 'so_du_tinh_toan'])
      },
      after: {
        ct: snap(after.details[0], ['da_tra', 'con_can_tra']),
        bl: snap(after.payroll, ['da_tra_nhan_vien', 'con_can_tra']),
        balance: snap(after.balance, ['tong_thu', 'tong_chi', 'so_du_tinh_toan']),
        plForCt
      }
    });
  }
  return results;
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error('Missing MONGO_URI');
  await connectDB();
  console.log('[IT] Connected via connectDB (direct URI if srv converted)');

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await BangLuong.findOne().session(session).limit(1);
    });
    console.log('[IT] Transaction support: OK');
  } catch (e) {
    console.error('[IT] Transaction support: FAIL', e.message);
    process.exit(2);
  } finally {
    session.endSession();
  }

  const report = { tests: {}, cleanup: 'pending' };
  const store = await ensureStore();
  const storeId = store._id;
  const req = makeReq(storeId);
  const allPayrollIds = [];
  const allDetailIds = [];
  const allSoQuyIds = [];
  const allReceiptIds = [];

  try {
    // --- Test A ---
    console.log('\n=== Test A: Race cùng ChiTietBangLuong ===');
    const soQuyA = await seedSoQuy(storeId, 'A');
    allSoQuyIds.push(soQuyA._id);
    const seedA = await seedPayroll(storeId, { tongLuong: 10000000, detailCount: 1 });
    allPayrollIds.push(seedA.payroll._id);
    allDetailIds.push(seedA.details[0]._id);
    const ctA = seedA.details[0]._id;
    const beforeA = await loadState(storeId, seedA.payroll._id, [ctA], soQuyA._id);

    const [rA1, rA2] = await Promise.all([
      callPayDetail(req, ctA, {
        so_tien: AMOUNT_A,
        so_quy_id: String(soQuyA._id),
        phuong_thuc_thanh_toan: 'tien_mat',
        ghi_chu: TAG + ' Race test A1'
      }),
      callPayDetail(req, ctA, {
        so_tien: AMOUNT_A,
        so_quy_id: String(soQuyA._id),
        phuong_thuc_thanh_toan: 'tien_mat',
        ghi_chu: TAG + ' Race test A2'
      })
    ]);

    const afterA = await loadState(storeId, seedA.payroll._id, [ctA], soQuyA._id);
    const plA = await PhieuThuChi.find({
      ct_bang_luong_id: ctA,
      loai_thu_chi: 'tra_luong_nhan_vien',
      ghi_chu: new RegExp(TAG)
    }).lean();
    plA.forEach((p) => allReceiptIds.push(p._id));

    const okCountA = [rA1, rA2].filter((r) => r.status === 200 && r.body && r.body.success).length;
    const failCountA = [rA1, rA2].filter((r) => r.status !== 200 || !(r.body && r.body.success)).length;

    report.tests.A = {
      requests: [
        { label: 'req1', status: rA1.status, success: !!(rA1.body && rA1.body.success), message: rA1.body && rA1.body.message, ma_phieu: rA1.body && rA1.body.receipt && rA1.body.receipt.ma_phieu },
        { label: 'req2', status: rA2.status, success: !!(rA2.body && rA2.body.success), message: rA2.body && rA2.body.message, ma_phieu: rA2.body && rA2.body.receipt && rA2.body.receipt.ma_phieu }
      ],
      before: {
        balance: snap(beforeA.balance, ['tong_thu', 'tong_chi', 'so_du_tinh_toan']),
        ct: snap(beforeA.details[0], ['da_tra', 'con_can_tra', 'tong_luong']),
        bl: snap(beforeA.payroll, ['da_tra_nhan_vien', 'con_can_tra', 'tong_luong'])
      },
      after: {
        balance: snap(afterA.balance, ['tong_thu', 'tong_chi', 'so_du_tinh_toan']),
        ct: snap(afterA.details[0], ['da_tra', 'con_can_tra']),
        bl: snap(afterA.payroll, ['da_tra_nhan_vien', 'con_can_tra'])
      },
      plReceipts: plA.map((p) => ({ ma_phieu: p.ma_phieu, gia_tri: p.gia_tri })),
      expect: {
        oneSuccess: okCountA === 1,
        oneFail: failCountA === 1,
        da_tra: 7000000,
        con_can_tra: 3000000,
        balanceChi: 7000000,
        plCount: 1
      },
      pass:
        okCountA === 1 && failCountA === 1 &&
        money(afterA.details[0].da_tra) === 7000000 &&
        money(afterA.details[0].con_can_tra) === 3000000 &&
        money(afterA.payroll.da_tra_nhan_vien) === 7000000 &&
        money(afterA.payroll.con_can_tra) === 3000000 &&
        money(afterA.balance.tong_chi) - money(beforeA.balance.tong_chi) === 7000000 &&
        money(beforeA.balance.so_du_tinh_toan) - money(afterA.balance.so_du_tinh_toan) === 7000000 &&
        plA.length === 1
    };
    console.log(JSON.stringify(report.tests.A, null, 2));

    // --- Test B ---
    console.log('\n=== Test B: Race hai dong luong (khong con chan so du SoQuy) ===');
    const soQuyB = await seedSoQuy(storeId, 'B');
    allSoQuyIds.push(soQuyB._id);
    const seedB = await seedPayroll(storeId, { tongLuong: 8000000, detailCount: 2, detailTong: 5000000 });
    allPayrollIds.push(seedB.payroll._id);
    seedB.details.forEach((d) => allDetailIds.push(d._id));
    const beforeB = await loadState(storeId, seedB.payroll._id, seedB.details.map((d) => d._id), soQuyB._id);

    const [rB1, rB2] = await Promise.all([
      callPayDetail(req, seedB.details[0]._id, {
        so_tien: AMOUNT_B,
        so_quy_id: String(soQuyB._id),
        phuong_thuc_thanh_toan: 'tien_mat',
        ghi_chu: TAG + ' Race test B1'
      }),
      callPayDetail(req, seedB.details[1]._id, {
        so_tien: AMOUNT_B,
        so_quy_id: String(soQuyB._id),
        phuong_thuc_thanh_toan: 'tien_mat',
        ghi_chu: TAG + ' Race test B2'
      })
    ]);

    const afterB = await loadState(storeId, seedB.payroll._id, seedB.details.map((d) => d._id), soQuyB._id);
    const plB = await PhieuThuChi.find({
      so_quy_id: soQuyB._id,
      loai_thu_chi: 'tra_luong_nhan_vien',
      ghi_chu: new RegExp(TAG + ' Race test B')
    }).lean();
    plB.forEach((p) => allReceiptIds.push(p._id));

    const okB = [rB1, rB2].filter((r) => r.status === 200 && r.body && r.body.success).length;

    report.tests.B = {
      requests: [
        { label: 'ct1', status: rB1.status, success: !!(rB1.body && rB1.body.success), message: rB1.body && rB1.body.message },
        { label: 'ct2', status: rB2.status, success: !!(rB2.body && rB2.body.success), message: rB2.body && rB2.body.message }
      ],
      before: { balance: snap(beforeB.balance, ['tong_thu', 'tong_chi', 'so_du_tinh_toan']) },
      after: {
        balance: snap(afterB.balance, ['tong_thu', 'tong_chi', 'so_du_tinh_toan']),
        details: afterB.details.map((d) => snap(d, ['da_tra', 'con_can_tra']))
      },
      plReceipts: plB.map((p) => p.ma_phieu),
      note: 'Moi model: khong chan chi khi so du tinh toan am; ca hai co the thanh cong',
      pass:
        okB === 2 &&
        money(afterB.balance.tong_chi) === 8000000 &&
        plB.length === 2
    };
    console.log(JSON.stringify(report.tests.B, null, 2));

    // --- Test C ---
    console.log('\n=== Test C: Rollback (patch trong script test) ===');
    const soQuyC = await seedSoQuy(storeId, 'C');
    allSoQuyIds.push(soQuyC._id);
    const seedC = await seedPayroll(storeId, { tongLuong: 10000000, detailCount: 1 });
    allPayrollIds.push(seedC.payroll._id);
    allDetailIds.push(seedC.details[0]._id);
    report.tests.C = await runTestC(storeId, seedC.payroll, seedC.details[0], soQuyC, req);
    report.tests.C_pass = report.tests.C.every((x) => x.unchanged && !x.success);
    console.log(JSON.stringify(report.tests.C, null, 2));

    // --- Test D ---
    console.log('\n=== Test D: Mã phiếu PL tuần tự ===');
    const soQuyD = await seedSoQuy(storeId, 'D');
    allSoQuyIds.push(soQuyD._id);
    const seedD = await seedPayroll(storeId, { tongLuong: 10000000, detailCount: 1 });
    allPayrollIds.push(seedD.payroll._id);
    allDetailIds.push(seedD.details[0]._id);
    const ctD = seedD.details[0]._id;

    const rD1 = await callPayDetail(req, ctD, {
      so_tien: 2000000,
      so_quy_id: String(soQuyD._id),
      phuong_thuc_thanh_toan: 'tien_mat',
      ghi_chu: TAG + ' Test D pay1'
    });
    const rD2 = await callPayDetail(req, ctD, {
      so_tien: 3000000,
      so_quy_id: String(soQuyD._id),
      phuong_thuc_thanh_toan: 'tien_mat',
      ghi_chu: TAG + ' Test D pay2'
    });

    const plD = await PhieuThuChi.find({
      ct_bang_luong_id: ctD,
      loai_thu_chi: 'tra_luong_nhan_vien',
      ghi_chu: new RegExp(TAG + ' Test D')
    }).sort({ created_at: 1 }).lean();
    plD.forEach((p) => allReceiptIds.push(p._id));

    const codes = plD.map((p) => p.ma_phieu);
    const pcCollision = await PhieuThuChi.find({
      ma_phieu: { $in: codes },
      loai_thu_chi: { $ne: 'tra_luong_nhan_vien' }
    }).countDocuments();
    const dupMa = codes.length !== new Set(codes).size;

    report.tests.D = {
      pay1: { status: rD1.status, ma_phieu: rD1.body && rD1.body.receipt && rD1.body.receipt.ma_phieu },
      pay2: { status: rD2.status, ma_phieu: rD2.body && rD2.body.receipt && rD2.body.receipt.ma_phieu },
      codes,
      allPLPrefix: codes.every((c) => /^PL\d{6}$/.test(c)),
      noDuplicate: !dupMa,
      noPcCollision: pcCollision === 0,
      pass: rD1.status === 200 && rD2.status === 200 && codes.length === 2 && codes.every((c) => /^PL/.test(c)) && !dupMa
    };
    console.log(JSON.stringify(report.tests.D, null, 2));

    report.huyHoanReady = {
      apiHuyPhieuLuong: false,
      apiHoanPhieuLuong: false,
      note: 'Phase 1 chi co thanh toan; chua co endpoint huy/hoan phiếu tra luong — khong test huy/hoan theo yeu cau.'
    };

    const allPass =
      report.tests.A.pass &&
      report.tests.B.pass &&
      report.tests.C_pass &&
      report.tests.D.pass;

    report.summary = { allPass };
    console.log('\n=== SUMMARY ===');
    console.log(JSON.stringify(report.summary, null, 2));
  } finally {
    await cleanup(storeId, {
      payrollIds: allPayrollIds,
      detailIds: allDetailIds,
      soQuyIds: allSoQuyIds,
      receiptIds: allReceiptIds
    });
    report.cleanup = 'done';
    await mongoose.connection.close();
    console.log('[IT] Cleanup done, disconnected');
  }

  return report;
}

main().catch((err) => {
  console.error('[IT] FATAL', err);
  process.exit(1);
});
