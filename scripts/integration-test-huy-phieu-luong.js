/**
 * Integration test: Huy/hoan phieu luong Phase 1
 * Chay: node scripts/integration-test-huy-phieu-luong.js
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
const bangLuongController = require('../controllers/bangLuong.controller');

const TAG = '__IT_HUY_PL__';

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
  res.status = function (code) { res.statusCode = code; return res; };
  res.json = function (data) { res.body = data; return res; };
  return res;
}

async function callCancel(req, receiptId, body) {
  req.params = { id: String(receiptId) };
  req.body = body || { ly_do_huy: TAG + ' test' };
  const res = mockRes();
  await bangLuongController.apiCancelPayrollReceipt(req, res, () => {});
  return { status: res.statusCode, body: res.body };
}

async function callPay(req, detailId, soQuyId, amount) {
  req.params = { id: String(detailId) };
  req.body = {
    so_tien: amount,
    so_quy_id: String(soQuyId),
    phuong_thuc_thanh_toan: 'tien_mat',
    ghi_chu: TAG
  };
  const res = mockRes();
  await bangLuongController.apiPayDetail(req, res, () => {});
  return { status: res.statusCode, body: res.body };
}

function makeReq(storeId) {
  return {
    session: { cua_hang_id: String(storeId) },
    user: { _id: new mongoose.Types.ObjectId() }
  };
}

async function seedLockedPayroll(storeId, tongLuong) {
  const now = new Date();
  const payroll = await BangLuong.create({
    cua_hang_id: storeId,
    ma_bang_luong: TAG + Date.now() + Math.random(),
    ten_bang_luong: TAG + ' BL',
    tu_ngay: now,
    den_ngay: now,
    tong_luong: tongLuong,
    da_tra_nhan_vien: 0,
    con_can_tra: tongLuong,
    trang_thai: 'locked'
  });
  const detail = await ChiTietBangLuong.create({
    cua_hang_id: storeId,
    bang_luong_id: payroll._id,
    nhan_vien_id: new mongoose.Types.ObjectId(),
    ma_nhan_vien: TAG + 'NV',
    ten_nhan_vien: TAG + ' NV',
    tong_luong: tongLuong,
    da_tra: 0,
    con_can_tra: tongLuong,
    trang_thai: 'locked'
  });
  return { payroll, detail };
}

async function seedSoQuy(storeId, soDu) {
  return SoQuy.create({
    cua_hang_id: storeId,
    ten_so_quy: TAG + ' SQ',
    loai: 'tien_mat',
    so_du: soDu,
    cho_phep_am: true,
    trang_thai: 'active'
  });
}

async function payAndGetReceipt(req, detail, soQuy, amount) {
  const pay = await callPay(req, detail._id, soQuy._id, amount);
  if (pay.status !== 200 || !pay.body || !pay.body.success) {
    throw new Error('Pay failed: ' + (pay.body && pay.body.message));
  }
  return pay.body.receipt;
}

async function cleanup(storeId, ids) {
  await PhieuThuChi.deleteMany({ ghi_chu: TAG, cua_hang_id: storeId });
  await PhieuThuChi.deleteMany({ ly_do_huy: new RegExp(TAG), cua_hang_id: storeId });
  if (ids.receiptIds.length) await PhieuThuChi.deleteMany({ _id: { $in: ids.receiptIds } });
  if (ids.detailIds.length) await ChiTietBangLuong.deleteMany({ _id: { $in: ids.detailIds } });
  if (ids.payrollIds.length) await BangLuong.deleteMany({ _id: { $in: ids.payrollIds } });
  if (ids.soQuyIds.length) await SoQuy.deleteMany({ _id: { $in: ids.soQuyIds } });
}

async function main() {
  await connectDB();
  const store = await CuaHang.findOne({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
  if (!store) throw new Error('No active store');
  const storeId = store._id;
  const req = makeReq(storeId);
  const ids = { payrollIds: [], detailIds: [], soQuyIds: [], receiptIds: [] };
  const report = { tests: {} };

  try {
    // Test A — Huy phieu tra mot phan
    console.log('\n=== Test A: Huy phieu 3M (tong 10M) ===');
    const soQuyA = await seedSoQuy(storeId, 10000000);
    ids.soQuyIds.push(soQuyA._id);
    const seedA = await seedLockedPayroll(storeId, 10000000);
    ids.payrollIds.push(seedA.payroll._id);
    ids.detailIds.push(seedA.detail._id);
    const beforeSoQuyA = money((await SoQuy.findById(soQuyA._id).lean()).so_du);
    const receiptA = await payAndGetReceipt(req, seedA.detail, soQuyA, 3000000);
    ids.receiptIds.push(receiptA._id);
    const midSoQuyA = money((await SoQuy.findById(soQuyA._id).lean()).so_du);
    const rA = await callCancel(req, receiptA._id, { ly_do_huy: TAG + ' A' });
    const afterA = {
      receipt: await PhieuThuChi.findById(receiptA._id).lean(),
      ct: await ChiTietBangLuong.findById(seedA.detail._id).lean(),
      bl: await BangLuong.findById(seedA.payroll._id).lean(),
      soQuy: await SoQuy.findById(soQuyA._id).lean()
    };
    report.tests.A = {
      cancel: { status: rA.status, success: !!(rA.body && rA.body.success) },
      beforeSoQuy: beforeSoQuyA,
      afterPaySoQuy: midSoQuyA,
      after: {
        receipt: snap(afterA.receipt, []),
        ct: snap(afterA.ct, ['da_tra', 'con_can_tra']),
        bl: snap(afterA.bl, ['da_tra_nhan_vien', 'con_can_tra']),
        soQuy: snap(afterA.soQuy, ['so_du'])
      },
      pass:
        rA.status === 200 &&
        afterA.receipt.trang_thai === 'cancelled' &&
        money(afterA.ct.da_tra) === 0 &&
        money(afterA.ct.con_can_tra) === 10000000 &&
        money(afterA.bl.da_tra_nhan_vien) === 0 &&
        money(afterA.bl.con_can_tra) === 10000000 &&
        money(afterA.soQuy.so_du) === beforeSoQuyA
    };
    console.log(JSON.stringify(report.tests.A, null, 2));

    // Test B — Huy 1 trong 2 phieu
    console.log('\n=== Test B: Huy 1/2 phieu ===');
    const soQuyB = await seedSoQuy(storeId, 20000000);
    ids.soQuyIds.push(soQuyB._id);
    const seedB = await seedLockedPayroll(storeId, 10000000);
    ids.payrollIds.push(seedB.payroll._id);
    ids.detailIds.push(seedB.detail._id);
    const r3 = await payAndGetReceipt(req, seedB.detail, soQuyB, 3000000);
    const r7 = await payAndGetReceipt(req, seedB.detail, soQuyB, 7000000);
    ids.receiptIds.push(r3._id, r7._id);
    const cancelB = await callCancel(req, r3._id, { ly_do_huy: TAG + ' B' });
    const afterB = {
      ct: await ChiTietBangLuong.findById(seedB.detail._id).lean(),
      r3: await PhieuThuChi.findById(r3._id).lean(),
      r7: await PhieuThuChi.findById(r7._id).lean()
    };
    report.tests.B = {
      cancel: { status: cancelB.status, success: !!(cancelB.body && cancelB.body.success) },
      ct: snap(afterB.ct, ['da_tra', 'con_can_tra']),
      r3: afterB.r3.trang_thai,
      r7: afterB.r7.trang_thai,
      pass:
        cancelB.status === 200 &&
        money(afterB.ct.da_tra) === 7000000 &&
        money(afterB.ct.con_can_tra) === 3000000 &&
        afterB.r3.trang_thai === 'cancelled' &&
        afterB.r7.trang_thai === 'paid'
    };
    console.log(JSON.stringify(report.tests.B, null, 2));

    // Test C — Double cancel
    console.log('\n=== Test C: Double cancel ===');
    const soQuyC = await seedSoQuy(storeId, 10000000);
    ids.soQuyIds.push(soQuyC._id);
    const seedC = await seedLockedPayroll(storeId, 5000000);
    ids.payrollIds.push(seedC.payroll._id);
    ids.detailIds.push(seedC.detail._id);
    const receiptC = await payAndGetReceipt(req, seedC.detail, soQuyC, 5000000);
    ids.receiptIds.push(receiptC._id);
    const soQuyBeforeC = money((await SoQuy.findById(soQuyC._id).lean()).so_du);
    const [c1, c2] = await Promise.all([
      callCancel(req, receiptC._id, { ly_do_huy: TAG + ' C1' }),
      callCancel(req, receiptC._id, { ly_do_huy: TAG + ' C2' })
    ]);
    const okC = [c1, c2].filter((r) => r.status === 200 && r.body && r.body.success).length;
    const afterC = {
      receipt: await PhieuThuChi.findById(receiptC._id).lean(),
      ct: await ChiTietBangLuong.findById(seedC.detail._id).lean(),
      soQuy: await SoQuy.findById(soQuyC._id).lean()
    };
    report.tests.C = {
      requests: [
        { status: c1.status, success: !!(c1.body && c1.body.success), message: c1.body && c1.body.message },
        { status: c2.status, success: !!(c2.body && c2.body.success), message: c2.body && c2.body.message }
      ],
      soQuyBefore: soQuyBeforeC,
      soQuyAfter: money(afterC.soQuy.so_du),
      ct: snap(afterC.ct, ['da_tra', 'con_can_tra']),
      pass:
        okC === 1 &&
        afterC.receipt.trang_thai === 'cancelled' &&
        money(afterC.ct.da_tra) === 0 &&
        money(afterC.soQuy.so_du) === soQuyBeforeC + 5000000
    };
    console.log(JSON.stringify(report.tests.C, null, 2));

    // Test D — PC khong phai luong
    console.log('\n=== Test D: PC thuong ===');
    const pc = await PhieuThuChi.create({
      ma_phieu: TAG + 'PC' + Date.now(),
      loai_phieu: 'chi',
      loai_thu_chi: 'chi_khac',
      gia_tri: 100000,
      trang_thai: 'paid',
      cua_hang_id: storeId,
      so_quy_id: soQuyC._id
    });
    ids.receiptIds.push(pc._id);
    const rD = await callCancel(req, pc._id, { ly_do_huy: TAG + ' D' });
    report.tests.D = {
      status: rD.status,
      message: rD.body && rD.body.message,
      pass: rD.status === 400 && /khong hop le|da duoc huy/i.test(rD.body && rD.body.message || '')
    };
    console.log(JSON.stringify(report.tests.D, null, 2));

    // Test E — Rollback
    console.log('\n=== Test E: Rollback ===');
    const rollbackCases = [];
    const hooks = [
      {
        label: 'sau cancelled, truoc SoQuy',
        patch: async () => {
          const orig = SoQuy.updateOne.bind(SoQuy);
          SoQuy.updateOne = async function () {
            throw new Error(TAG + ' forced after receipt');
          };
          return () => { SoQuy.updateOne = orig; };
        }
      },
      {
        label: 'sau SoQuy, truoc CT',
        patch: async () => {
          const orig = ChiTietBangLuong.findOneAndUpdate.bind(ChiTietBangLuong);
          ChiTietBangLuong.findOneAndUpdate = async function () {
            throw new Error(TAG + ' forced after so quy');
          };
          return () => { ChiTietBangLuong.findOneAndUpdate = orig; };
        }
      },
      {
        label: 'sau CT, truoc BL',
        patch: async () => {
          const orig = BangLuong.findOneAndUpdate.bind(BangLuong);
          BangLuong.findOneAndUpdate = async function () {
            throw new Error(TAG + ' forced after ct');
          };
          return () => { BangLuong.findOneAndUpdate = orig; };
        }
      }
    ];

    for (const hook of hooks) {
      const soQuyE = await seedSoQuy(storeId, 8000000);
      ids.soQuyIds.push(soQuyE._id);
      const seedE = await seedLockedPayroll(storeId, 8000000);
      ids.payrollIds.push(seedE.payroll._id);
      ids.detailIds.push(seedE.detail._id);
      const receiptE = await payAndGetReceipt(req, seedE.detail, soQuyE, 2000000);
      ids.receiptIds.push(receiptE._id);
      const before = {
        receipt: await PhieuThuChi.findById(receiptE._id).lean(),
        ct: await ChiTietBangLuong.findById(seedE.detail._id).lean(),
        bl: await BangLuong.findById(seedE.payroll._id).lean(),
        soQuy: await SoQuy.findById(soQuyE._id).lean()
      };
      const restore = await hook.patch();
      const fail = await callCancel(req, receiptE._id, { ly_do_huy: TAG + ' E ' + hook.label });
      restore();
      const after = {
        receipt: await PhieuThuChi.findById(receiptE._id).lean(),
        ct: await ChiTietBangLuong.findById(seedE.detail._id).lean(),
        bl: await BangLuong.findById(seedE.payroll._id).lean(),
        soQuy: await SoQuy.findById(soQuyE._id).lean()
      };
      const unchanged =
        after.receipt.trang_thai === 'paid' &&
        money(after.ct.da_tra) === money(before.ct.da_tra) &&
        money(after.bl.da_tra_nhan_vien) === money(before.bl.da_tra_nhan_vien) &&
        money(after.soQuy.so_du) === money(before.soQuy.so_du);
      rollbackCases.push({
        scenario: hook.label,
        status: fail.status,
        unchanged,
        pass: fail.status === 400 && unchanged
      });
    }
    report.tests.E = rollbackCases;
    report.tests.E_pass = rollbackCases.every((x) => x.pass);
    console.log(JSON.stringify(report.tests.E, null, 2));

    report.summary = {
      allPass:
        report.tests.A.pass &&
        report.tests.B.pass &&
        report.tests.C.pass &&
        report.tests.D.pass &&
        report.tests.E_pass
    };
    console.log('\n=== SUMMARY ===');
    console.log(JSON.stringify(report.summary, null, 2));
    if (!report.summary.allPass) process.exitCode = 1;
  } finally {
    await cleanup(storeId, ids);
    await mongoose.connection.close();
    console.log('[IT] Cleanup done');
  }
}

main().catch((err) => {
  console.error('[IT] FATAL', err);
  process.exit(1);
});
