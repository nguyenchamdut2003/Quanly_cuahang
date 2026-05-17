const mongoose = require('mongoose');
const {
  PhieuNhap,
  CTPhieuNhap,
  NhaCungCap,
  HangHoa,
  LoHang,
  TonKho,
  TonKhoLo,
  LichSuKho,
  CongNoNhaCungCap,
  PhieuThuChi,
  SoQuy,
  HangHoaThuocTinh
} = require('../models/kiot.model');
const { taoPhieuThuChi, ensureDefaultSoQuy } = require('./soQuy.service');

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

function cleanId(value) {
  const id = String(value || '').trim();
  return isObjectId(id) ? id : undefined;
}

function parseMoney(value) {
  const n = Number(String(value ?? '').replace(/\./g, '').replace(/,/g, '').trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function parseDate(value) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function safeLotCodeSegment(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9_-]/g, '');
}

function makePurchaseLotCode(purchaseCode, productCode) {
  const safePurchaseCode = safeLotCodeSegment(purchaseCode);
  const safeProductCode = safeLotCodeSegment(productCode);
  if (!safePurchaseCode || !safeProductCode) return '';
  return 'LO-' + safePurchaseCode + '-' + safeProductCode;
}

function formatLotName(dateValue) {
  const d = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(d.getTime())) return 'Lô';
  return 'Lô ' + d.toLocaleDateString('vi-VN');
}

function normalizeItems(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch (_) { parsed = []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(item => {
    const discountType = item.kieu_giam_gia_dong === 'percent' ? 'percent' : 'vnd';
    return {
      hang_hoa_id: cleanId(item.hang_hoa_id),
      lo_hang_id: cleanId(item.lo_hang_id),
      gia_tri_thuoc_tinh_id: cleanId(item.gia_tri_thuoc_tinh_id),
      so_luong: Math.floor(Number(item.so_luong || 0)),
      don_gia_nhap: parseMoney(item.don_gia_nhap ?? item.don_gia),
      giam_gia_dong: parseMoney(item.giam_gia_dong ?? item.giam_gia),
      kieu_giam_gia_dong: discountType,
      lo_info: item.lo_info && typeof item.lo_info === 'object' ? {
        ma_lo: String(item.lo_info.ma_lo || '').trim(),
        ten_lo: String(item.lo_info.ten_lo || '').trim(),
        han_su_dung: String(item.lo_info.han_su_dung || '').trim(),
        ngay_nhap: String(item.lo_info.ngay_nhap || '').trim(),
        ghi_chu: String(item.lo_info.ghi_chu || '').trim()
      } : null
    };
  }).filter(item => item.hang_hoa_id && item.so_luong > 0 && item.don_gia_nhap >= 0);
}

function lineTotal(item) {
  const base = Number(item.so_luong || 0) * Number(item.don_gia_nhap || 0);
  const discount = item.kieu_giam_gia_dong === 'percent'
    ? Math.floor(base * Math.min(Number(item.giam_gia_dong || 0), 100) / 100)
    : Number(item.giam_gia_dong || 0);
  if (discount > base) throw new Error('Giam gia dong khong duoc vuot qua thanh tien');
  return Math.max(0, Math.floor(base - discount));
}

function calculateTotals(items, discountValue, discountType) {
  const tongTienHang = items.reduce((sum, item) => sum + lineTotal(item), 0);
  let giamGia = parseMoney(discountValue);
  const kieuGiamGia = discountType === 'percent' ? 'percent' : 'vnd';
  if (kieuGiamGia === 'percent') giamGia = Math.min(giamGia, 100);
  const discountAmount = kieuGiamGia === 'percent'
    ? Math.floor(tongTienHang * giamGia / 100)
    : giamGia;
  if (discountAmount > tongTienHang) throw new Error('Giam gia phieu khong duoc vuot qua tong tien hang');
  const tongTien = Math.max(0, tongTienHang - discountAmount);
  return { tongTienHang, giamGia, kieuGiamGia, tongTien };
}

async function makeCode(model, field, prefix, width) {
  const regex = new RegExp('^' + prefix + '\\d+$');
  const last = await model.findOne({ [field]: regex }).sort({ [field]: -1 }).lean();
  const next = last && last[field] ? Number(String(last[field]).replace(/\D/g, '')) + 1 : 1;
  return prefix + String(next).padStart(width, '0');
}

async function createLotForLine({ storeId, khoId, supplierId, purchase, ctDoc, product, productId, item, now, lotCache }) {
  if (item.lo_hang_id) {
    const existing = await LoHang.findOne({
      _id: item.lo_hang_id,
      hang_hoa_id: productId,
      kho_id: khoId,
      trang_thai: { $ne: 'huy' }
    });
    if (!existing) throw new Error('Lo hang khong hop le');
    return existing._id;
  }

  const lotInfo = item.lo_info;
  if (!lotInfo) throw new Error('Hang quan ly theo lo can thong tin lo');
  const lotQty = Math.floor(Number(item.so_luong || 0));
  if (lotQty <= 0) throw new Error('So luong dong hang khong hop le');

  const maLo = makePurchaseLotCode(purchase.ma_phieu_nhap, product && product.ma_hang);
  if (!maLo) throw new Error('Khong the sinh ma lo tu phieu nhap va hang hoa');
  if (lotCache && lotCache.has(maLo)) {
    const lotId = lotCache.get(maLo);
    await LoHang.updateOne(
      { _id: lotId },
      {
        $inc: { so_luong_ban_dau: lotQty },
        $set: {
          nha_cung_cap_id: supplierId || undefined,
          don_gia_nhap: item.don_gia_nhap,
          gia_von: item.don_gia_nhap
        }
      }
    );
    return lotId;
  }
  const existingByCode = await LoHang.findOne({
    ma_lo: maLo,
    hang_hoa_id: productId,
    phieu_nhap_id: purchase._id,
    trang_thai: { $ne: 'huy' }
  });
  if (existingByCode) {
    await LoHang.updateOne(
      { _id: existingByCode._id },
      {
        $inc: { so_luong_ban_dau: lotQty },
        $set: {
          nha_cung_cap_id: supplierId || undefined,
          don_gia_nhap: item.don_gia_nhap,
          gia_von: item.don_gia_nhap
        }
      }
    );
    if (lotCache) lotCache.set(maLo, existingByCode._id);
    return existingByCode._id;
  }
  const created = await LoHang.create({
    cua_hang_id: storeId,
    kho_id: khoId,
    hang_hoa_id: productId,
    nha_cung_cap_id: supplierId,
    phieu_nhap_id: purchase._id,
    ct_phieu_nhap_id: ctDoc._id,
    ma_lo: maLo,
    ten_lo: lotInfo.ten_lo || formatLotName(parseDate(lotInfo.ngay_nhap) || purchase.ngay_nhap || now),
    ngay_nhap: parseDate(lotInfo.ngay_nhap) || now,
    han_su_dung: parseDate(lotInfo.han_su_dung),
    so_luong_ban_dau: lotQty,
    so_luong_con_lai: 0,
    don_gia_nhap: item.don_gia_nhap,
    gia_von: item.don_gia_nhap,
    trang_thai: 'active',
    ghi_chu: lotInfo.ghi_chu || undefined
  });
  if (lotCache) lotCache.set(maLo, created._id);
  return created._id;
}

async function applyCompletedEffects(purchase, rows, options = {}) {
  if (purchase.__effectsApplied) throw new Error('Phieu nhap da duoc hoan tat truoc do');
  purchase.__effectsApplied = true;

  for (const row of rows) {
    const qty = Number(row.so_luong || 0);
    const updatedStock = await TonKho.findOneAndUpdate(
      { cua_hang_id: purchase.cua_hang_id, kho_id: purchase.kho_id, hang_hoa_id: row.hang_hoa_id },
      { $inc: { so_luong: qty }, $setOnInsert: { cua_hang_id: purchase.cua_hang_id } },
      { upsert: true, new: true }
    ).lean();

    if (row.lo_hang_id) {
      await TonKhoLo.findOneAndUpdate(
        {
          cua_hang_id: purchase.cua_hang_id,
          kho_id: purchase.kho_id,
          hang_hoa_id: row.hang_hoa_id,
          lo_hang_id: row.lo_hang_id,
          gia_tri_thuoc_tinh_id: row.gia_tri_thuoc_tinh_id || null
        },
        { $inc: { so_luong: qty }, $set: { gia_von: row.don_gia_nhap } },
        { upsert: true, new: true }
      );
      await LoHang.updateOne(
        { _id: row.lo_hang_id },
        { $inc: { so_luong_con_lai: qty }, $set: { trang_thai: 'active' } }
      );
    }

    await LichSuKho.create({
      cua_hang_id: purchase.cua_hang_id,
      kho_id: purchase.kho_id,
      hang_hoa_id: row.hang_hoa_id,
      lo_hang_id: row.lo_hang_id || undefined,
      gia_tri_thuoc_tinh_id: row.gia_tri_thuoc_tinh_id || undefined,
      nguoi_tao_id: options.userId,
      loai_phieu: 'nhap_hang',
      ma_phieu: purchase.ma_phieu_nhap,
      so_luong_thay_doi: qty,
      ton_kho_sau: Number(updatedStock?.so_luong || 0),
      gia_tri_thay_doi: Number(row.thanh_tien || 0),
      ghi_chu: 'Nhap hang',
      ngay: purchase.ngay_nhap || new Date()
    });

    await HangHoa.updateOne(
      { _id: row.hang_hoa_id },
      { $set: { gia_nhap_cuoi: row.don_gia_nhap, gia_von: row.don_gia_nhap } }
    );
  }

  if (purchase.nha_cung_cap_id) {
    const canTra = Number(purchase.can_tra_ncc || 0);
    const daTra = Number(purchase.da_tra_ncc || 0);
    const conNo = Number(purchase.con_no_ncc || 0);
    const includeDebt = options.includeDebt !== false;
    if (includeDebt && canTra > 0) {
      await CongNoNhaCungCap.create({
        cua_hang_id: purchase.cua_hang_id,
        nha_cung_cap_id: purchase.nha_cung_cap_id,
        phieu_nhap_id: purchase._id,
        so_tien: canTra,
        loai: 'tang_no',
        ghi_chu: 'Cong no phat sinh tu phieu nhap ' + purchase.ma_phieu_nhap,
        ngay: purchase.ngay_nhap || new Date()
      });
    }
    await NhaCungCap.updateOne(
      { _id: purchase.nha_cung_cap_id },
      { $inc: { tong_mua: canTra, tong_no: includeDebt ? conNo : 0 } }
    );

    if (daTra > 0) {
      const cashBook = cleanId(options.soQuyId)
        ? await SoQuy.findById(options.soQuyId)
        : await ensureDefaultSoQuy(purchase.cua_hang_id);
      if (!cashBook) throw new Error('Khong tim thay so quy thanh toan');
      await taoPhieuThuChi({
        loai_phieu: 'chi',
        loai_thu_chi: 'Chi tra nha cung cap',
        gia_tri: daTra,
        so_quy_id: cashBook._id,
        cua_hang_id: purchase.cua_hang_id,
        nguoi_tao_id: options.userId,
        nha_cung_cap_id: purchase.nha_cung_cap_id,
        phieu_nhap_id: purchase._id,
        ma_chung_tu_goc: purchase.ma_phieu_nhap,
        nhom_doi_tuong: 'nha_cung_cap',
        phuong_thuc_thanh_toan: purchase.phuong_thuc_thanh_toan === 'chuyen_khoan' ? 'chuyen_khoan' : 'tien_mat',
        hach_toan: false
      });
      if (includeDebt) await CongNoNhaCungCap.create({
        cua_hang_id: purchase.cua_hang_id,
        nha_cung_cap_id: purchase.nha_cung_cap_id,
        phieu_nhap_id: purchase._id,
        so_tien: daTra,
        loai: 'thanh_toan',
        ghi_chu: 'Thanh toan NCC tu phieu nhap ' + purchase.ma_phieu_nhap,
        ngay: purchase.ngay_nhap || new Date()
      });
    }
  }
}

async function createPurchase(data = {}) {
  const storeId = cleanId(data.cua_hang_id);
  const khoId = cleanId(data.kho_id);
  if (!storeId) throw new Error('Cua hang khong hop le');
  if (!khoId) throw new Error('Vui long chon kho nhap');

  const items = normalizeItems(data.items_json ?? data.items);
  if (!items.length) throw new Error('Vui long chon hang hoa');

  const supplierId = cleanId(data.nha_cung_cap_id);
  const mode = data.submitMode === 'completed' ? 'completed' : 'draft';
  const totals = calculateTotals(items, data.giam_gia, data.kieu_giam_gia);
  const canTra = parseMoney(data.can_tra_ncc || totals.tongTien);
  if (canTra > totals.tongTien) throw new Error('Can tra nha cung cap khong duoc lon hon tong tien');
  let phuongThuc = ['tien_mat', 'chuyen_khoan', 'cong_no'].includes(data.phuong_thuc_thanh_toan)
    ? data.phuong_thuc_thanh_toan
    : 'cong_no';
  let daTra = parseMoney(data.da_tra_ncc);
  if (phuongThuc === 'cong_no') daTra = 0;
  if (daTra > canTra) daTra = canTra;
  const conNo = Math.max(0, canTra - daTra);
  const now = new Date();
  const maPhieu = data.ma_phieu_nhap || await makeCode(PhieuNhap, 'ma_phieu_nhap', 'PN', 6);
  const includeDebt = data.tinh_vao_cong_no !== false
    && data.tinh_vao_cong_no !== 'false'
    && data.tinh_vao_cong_no !== '0'
    && data.tinh_vao_cong_no !== 'off';

  const productDocs = await HangHoa.find({ _id: { $in: items.map(x => x.hang_hoa_id) }, trang_thai: 'active' })
    .select('_id ma_hang don_vi_tinh_id quan_ly_theo_lo')
    .lean();
  const productMap = new Map(productDocs.map(p => [String(p._id), p]));
  if (productMap.size !== new Set(items.map(x => String(x.hang_hoa_id))).size) {
    throw new Error('Co hang hoa khong hop le hoac da ngung kinh doanh');
  }
  const productIds = Array.from(productMap.keys());
  const productAttributeRows = await HangHoaThuocTinh.find({ hang_hoa_id: { $in: productIds } }).select('hang_hoa_id gia_tri_id').lean();
  const productsWithAttributes = new Set(productAttributeRows.map(row => String(row.hang_hoa_id)));
  const allowedAttributeValues = new Set(productAttributeRows.map(row => String(row.hang_hoa_id) + ':' + String(row.gia_tri_id)));
  for (const item of items) {
    const product = productMap.get(String(item.hang_hoa_id));
    lineTotal(item);
    const productKey = String(item.hang_hoa_id);
    if (productsWithAttributes.has(productKey)) {
      if (!item.gia_tri_thuoc_tinh_id) throw new Error('Hang hoa co thuoc tinh can chon gia tri thuoc tinh');
      if (!allowedAttributeValues.has(productKey + ':' + String(item.gia_tri_thuoc_tinh_id))) {
        throw new Error('Gia tri thuoc tinh khong hop le voi hang hoa da chon');
      }
    } else if (item.gia_tri_thuoc_tinh_id) {
      item.gia_tri_thuoc_tinh_id = undefined;
    }
    if (product.quan_ly_theo_lo && mode === 'completed') {
      if (!item.lo_hang_id && !item.lo_info) throw new Error('Hang quan ly theo lo can chon hoac tao lo');
    }
  }

  const purchase = await PhieuNhap.create({
    cua_hang_id: storeId,
    kho_id: khoId,
    nha_cung_cap_id: supplierId,
    nguoi_tao_id: cleanId(data.nguoi_tao_id),
    ma_phieu_nhap: maPhieu,
    ngay_nhap: parseDate(data.ngay_nhap) || now,
    tong_tien_hang: totals.tongTienHang,
    giam_gia: totals.giamGia,
    kieu_giam_gia: totals.kieuGiamGia,
    tong_tien: totals.tongTien,
    can_tra_ncc: canTra,
    da_tra_ncc: daTra,
    con_no_ncc: conNo,
    phuong_thuc_thanh_toan: phuongThuc,
    trang_thai: mode,
    ghi_chu: String(data.ghi_chu || '').trim()
  });

  const rows = [];
  const lotCache = new Map();
  for (const item of items) {
    const product = productMap.get(String(item.hang_hoa_id));
    if (product.quan_ly_theo_lo && mode === 'completed' && !item.lo_hang_id && !item.lo_info) {
      throw new Error('Hang quan ly theo lo can chon hoac tao lo');
    }
    const total = lineTotal(item);
    const ctDoc = await CTPhieuNhap.create({
      phieu_nhap_id: purchase._id,
      hang_hoa_id: item.hang_hoa_id,
      gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id || undefined,
      don_vi_tinh_id: product.don_vi_tinh_id || undefined,
      so_luong: item.so_luong,
      don_gia_nhap: item.don_gia_nhap,
      giam_gia_dong: item.giam_gia_dong,
      kieu_giam_gia_dong: item.kieu_giam_gia_dong,
      thanh_tien: total
    });
    let lotId;
    if (product.quan_ly_theo_lo && (item.lo_hang_id || item.lo_info)) {
      lotId = await createLotForLine({
        storeId,
        khoId,
        supplierId,
        purchase,
        ctDoc,
        product,
        productId: item.hang_hoa_id,
        item,
        now,
        lotCache
      });
      await CTPhieuNhap.updateOne({ _id: ctDoc._id }, { $set: { lo_hang_id: lotId } });
    }
    rows.push({
      _id: ctDoc._id,
      hang_hoa_id: item.hang_hoa_id,
      lo_hang_id: lotId,
      gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id || undefined,
      so_luong: item.so_luong,
      don_gia_nhap: item.don_gia_nhap,
      thanh_tien: total
    });
  }

  if (mode === 'completed') {
    await applyCompletedEffects(purchase, rows, {
      userId: cleanId(data.nguoi_tao_id),
      soQuyId: cleanId(data.so_quy_id),
      includeDebt
    });
  }

  return purchase;
}

async function cancelPurchase(id, storeId, userId) {
  const filter = { _id: id };
  if (cleanId(storeId)) filter.cua_hang_id = storeId;
  const purchase = await PhieuNhap.findOne(filter);
  if (!purchase) throw new Error('Khong tim thay phieu nhap');
  if (purchase.trang_thai === 'cancelled') throw new Error('Phieu nhap da bi huy');

  const rows = await CTPhieuNhap.find({ phieu_nhap_id: purchase._id }).lean();
  if (purchase.trang_thai === 'completed') {
    for (const row of rows) {
      const qty = Number(row.so_luong || 0);
      const stock = await TonKho.findOne({ kho_id: purchase.kho_id, hang_hoa_id: row.hang_hoa_id }).lean();
      if (!stock || Number(stock.so_luong || 0) < qty) throw new Error('Ton kho khong du de huy phieu nhap');
      if (row.lo_hang_id) {
        const lotStock = await TonKhoLo.findOne({ kho_id: purchase.kho_id, hang_hoa_id: row.hang_hoa_id, lo_hang_id: row.lo_hang_id, gia_tri_thuoc_tinh_id: row.gia_tri_thuoc_tinh_id || null }).lean();
        if (!lotStock || Number(lotStock.so_luong || 0) < qty) throw new Error('Ton kho lo khong du de huy phieu nhap');
      }
    }

    for (const row of rows) {
      const qty = Number(row.so_luong || 0);
      const updated = await TonKho.findOneAndUpdate(
        { kho_id: purchase.kho_id, hang_hoa_id: row.hang_hoa_id },
        { $inc: { so_luong: -qty } },
        { new: true }
      ).lean();
      if (row.lo_hang_id) {
        await TonKhoLo.findOneAndUpdate(
          { kho_id: purchase.kho_id, hang_hoa_id: row.hang_hoa_id, lo_hang_id: row.lo_hang_id, gia_tri_thuoc_tinh_id: row.gia_tri_thuoc_tinh_id || null },
          { $inc: { so_luong: -qty } },
          { new: true }
        );
        await LoHang.updateOne({ _id: row.lo_hang_id }, { $inc: { so_luong_con_lai: -qty } });
      }
      await LichSuKho.create({
        cua_hang_id: purchase.cua_hang_id,
        kho_id: purchase.kho_id,
        hang_hoa_id: row.hang_hoa_id,
        lo_hang_id: row.lo_hang_id || undefined,
        gia_tri_thuoc_tinh_id: row.gia_tri_thuoc_tinh_id || undefined,
        nguoi_tao_id: cleanId(userId),
        loai_phieu: 'dieu_chinh',
        ma_phieu: purchase.ma_phieu_nhap,
        so_luong_thay_doi: -qty,
        ton_kho_sau: Number(updated?.so_luong || 0),
        gia_tri_thay_doi: -Number(row.thanh_tien || 0),
        ghi_chu: 'Huy phieu nhap ' + purchase.ma_phieu_nhap,
        ngay: new Date()
      });
    }

    if (purchase.nha_cung_cap_id) {
      const canTra = Number(purchase.can_tra_ncc || 0);
      const conNo = Number(purchase.con_no_ncc || 0);
      if (conNo > 0) {
        await CongNoNhaCungCap.create({
          cua_hang_id: purchase.cua_hang_id,
          nha_cung_cap_id: purchase.nha_cung_cap_id,
          phieu_nhap_id: purchase._id,
          so_tien: conNo,
          loai: 'giam_no',
          ghi_chu: 'Dao cong no do huy phieu nhap ' + purchase.ma_phieu_nhap,
          ngay: new Date()
        });
      }
      await NhaCungCap.updateOne(
        { _id: purchase.nha_cung_cap_id },
        { $inc: { tong_mua: -canTra, tong_no: -conNo } }
      );
    }

    const payments = await PhieuThuChi.find({ phieu_nhap_id: purchase._id, loai_phieu: 'chi', trang_thai: { $ne: 'cancelled' } }).lean();
    for (const payment of payments) {
      await SoQuy.updateOne({ _id: payment.so_quy_id }, { $inc: { so_du: Number(payment.gia_tri || 0) } });
      await PhieuThuChi.updateOne({ _id: payment._id }, { $set: { trang_thai: 'cancelled', ghi_chu: (payment.ghi_chu || '') + ' | Huy theo phieu nhap ' + purchase.ma_phieu_nhap } });
    }
  }

  purchase.trang_thai = 'cancelled';
  await purchase.save();
  return purchase;
}

module.exports = {
  createPurchase,
  cancelPurchase,
  calculateTotals,
  normalizeItems,
  parseMoney
};
