require('dotenv').config();
const { mongoose } = require('./models/db.model');
const {
  CuaHang,
  ChiNhanh,
  NguoiDung,
  NhomKhachHang,
  KhachHang,
  DiaChiKhachHang,
  NhaCungCap,
  NhomHang,
  DonViTinh,
  ThuongHieu,
  ViTri,
  HangHoa,
  BangGia,
  CTBangGia,
  PhieuNhap,
  CTPhieuNhap,
  HoaDonDauVao,
  PhieuTraHangNhap,
  CTPhieuTraHangNhap,
  DonHang,
  CTDonHang,
  HoaDonBanHang,
  CTHoaDonBanHang,
  DoiTacGiaoHang,
  VanDon,
  PhieuTraHang,
  CTPhieuTraHang,
  SoQuy,
  PhieuThuChi,
  CongNoKhachHang,
  CongNoNhaCungCap,
  LichSuKho
} = require('./models/kiot.model');

async function waitDb() {
  if (mongoose.connection.readyState === 1) return;
  await new Promise((resolve, reject) => {
    mongoose.connection.once('open', resolve);
    mongoose.connection.once('error', reject);
  });
}

async function upsert(Model, filter, data) {
  return Model.findOneAndUpdate(filter, { $set: data }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
}

function dateAgo(days, hour = 9, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function pick(list, index) {
  return list[index % list.length];
}

async function clearBulkData() {
  const orderIds = (await DonHang.find({ ma_don_hang: /^BULK-DH/ }).select('_id')).map(x => x._id);
  const invoiceIds = (await HoaDonBanHang.find({ ma_hoa_don: /^BULK-HD/ }).select('_id')).map(x => x._id);
  const returnIds = (await PhieuTraHang.find({ ma_phieu_tra: /^BULK-TH/ }).select('_id')).map(x => x._id);
  const purchaseIds = (await PhieuNhap.find({ ma_phieu_nhap: /^BULK-PN/ }).select('_id')).map(x => x._id);
  const purchaseReturnIds = (await PhieuTraHangNhap.find({ ma_phieu_tra_nhap: /^BULK-TN/ }).select('_id')).map(x => x._id);

  await Promise.all([
    CTDonHang.deleteMany({ don_hang_id: { $in: orderIds } }),
    CTHoaDonBanHang.deleteMany({ hoa_don_id: { $in: invoiceIds } }),
    CTPhieuTraHang.deleteMany({ phieu_tra_hang_id: { $in: returnIds } }),
    CTPhieuNhap.deleteMany({ phieu_nhap_id: { $in: purchaseIds } }),
    CTPhieuTraHangNhap.deleteMany({ phieu_tra_nhap_id: { $in: purchaseReturnIds } }),
    VanDon.deleteMany({ ma_van_don: /^BULK-VD/ }),
    PhieuThuChi.deleteMany({ ma_phieu: /^BULK-(PT|PC)/ }),
    CongNoKhachHang.deleteMany({ ghi_chu: /^BULK/ }),
    CongNoNhaCungCap.deleteMany({ ghi_chu: /^BULK/ }),
    LichSuKho.deleteMany({ ma_phieu: /^BULK-/ }),
    HoaDonDauVao.deleteMany({ ma_hoa_don: /^BULK-HDV/ })
  ]);

  await Promise.all([
    DonHang.deleteMany({ _id: { $in: orderIds } }),
    HoaDonBanHang.deleteMany({ _id: { $in: invoiceIds } }),
    PhieuTraHang.deleteMany({ _id: { $in: returnIds } }),
    PhieuNhap.deleteMany({ _id: { $in: purchaseIds } }),
    PhieuTraHangNhap.deleteMany({ _id: { $in: purchaseReturnIds } })
  ]);
}

async function seedBaseData(store, branch, admin) {
  const groups = [];
  for (const name of ['BULK Khach le', 'BULK Khach VIP', 'BULK Cong ty']) {
    groups.push(await upsert(NhomKhachHang, { ten_nhom: name }, { ten_nhom: name, cua_hang_id: store._id }));
  }

  const customerNames = [
    'BULK Nguyen An', 'BULK Pham Binh', 'BULK Tran Chi', 'BULK Le Dung', 'BULK Hoang Giang',
    'BULK Mai Hoa', 'BULK Dang Khoa', 'BULK Bui Linh', 'BULK Vo Minh', 'BULK Do Ngan',
    'BULK Phan Oanh', 'BULK Truong Phuc', 'BULK Dinh Quyen', 'BULK Ngo Son', 'BULK Cao Tam',
    'BULK Huynh Uyen', 'BULK Luu Viet', 'BULK Ta Xuan', 'BULK Chu Yen', 'BULK Vu Long'
  ];
  const customers = [];
  for (let i = 0; i < customerNames.length; i += 1) {
    const code = `BULK-KH${String(i + 1).padStart(4, '0')}`;
    const city = i % 3 === 0 ? 'Ha Noi' : i % 3 === 1 ? 'TP.HCM' : 'Da Nang';
    const customer = await upsert(KhachHang, { ma_khach_hang: code }, {
      ma_khach_hang: code,
      ten_khach_hang: customerNames[i],
      sdt: `0988${String(100000 + i).slice(1)}`,
      email: `bulk.customer${i + 1}@example.com`,
      gioi_tinh: i % 2 === 0 ? 'nam' : 'nu',
      loai_khach_hang: i % 5 === 0 ? 'cong_ty' : 'ca_nhan',
      dia_chi_nhan: `${10 + i} Duong mau, ${city}`,
      tinh_thanh: city,
      quan_huyen: i % 2 === 0 ? 'Quan trung tam' : 'Quan ngoai thanh',
      phuong_xa: `Phuong ${i + 1}`,
      ngay_sinh: dateAgo(8000 + i * 40),
      nhom_khach_hang_id: pick(groups, i)._id,
      nguoi_tao_id: admin._id,
      cua_hang_id: store._id,
      tong_no: i % 4 === 0 ? 150000 + i * 10000 : 0,
      trang_thai: i % 13 === 0 ? 'inactive' : 'active'
    });
    await DiaChiKhachHang.findOneAndUpdate(
      { khach_hang_id: customer._id, mac_dinh: true },
      {
        khach_hang_id: customer._id,
        dia_chi: customer.dia_chi_nhan,
        tinh_thanh: customer.tinh_thanh,
        quan_huyen: customer.quan_huyen,
        phuong_xa: customer.phuong_xa,
        mac_dinh: true
      },
      { upsert: true, returnDocument: 'after' }
    );
    await DiaChiKhachHang.findOneAndUpdate(
      { khach_hang_id: customer._id, dia_chi: `Kho nhan hang ${i + 1}` },
      {
        khach_hang_id: customer._id,
        dia_chi: `Kho nhan hang ${i + 1}`,
        tinh_thanh: customer.tinh_thanh,
        quan_huyen: 'Khu vuc phu',
        phuong_xa: `Phuong phu ${i + 1}`,
        mac_dinh: false
      },
      { upsert: true, returnDocument: 'after' }
    );
    customers.push(customer);
  }

  const suppliers = [];
  for (let i = 1; i <= 8; i += 1) {
    suppliers.push(await upsert(NhaCungCap, { ma_ncc: `BULK-NCC${String(i).padStart(4, '0')}` }, {
      ma_ncc: `BULK-NCC${String(i).padStart(4, '0')}`,
      ten_ncc: `BULK Nha cung cap ${i}`,
      sdt: `02877770${String(i).padStart(2, '0')}`,
      email: `bulk.supplier${i}@example.com`,
      dia_chi: i % 2 === 0 ? 'Ha Noi' : 'TP.HCM',
      tong_mua: 0,
      tong_no: 0,
      cua_hang_id: store._id,
      nguoi_tao_id: admin._id,
      trang_thai: i === 8 ? 'inactive' : 'active'
    }));
  }

  const group = await upsert(NhomHang, { ten_nhom_hang: 'BULK Hang mau' }, { ten_nhom_hang: 'BULK Hang mau', cua_hang_id: store._id });
  const unit = await upsert(DonViTinh, { ten_don_vi: 'BULK cai' }, { ten_don_vi: 'BULK cai', cua_hang_id: store._id });
  const brand = await upsert(ThuongHieu, { ten_thuong_hieu: 'BULK Brand' }, { ten_thuong_hieu: 'BULK Brand', cua_hang_id: store._id });
  const position = await upsert(ViTri, { ten_vi_tri: 'BULK Kho A' }, { ten_vi_tri: 'BULK Kho A', cua_hang_id: store._id });
  const productNames = ['Ca hoi cat khuc', 'Bo my ba chi', 'Ga ta dong lanh', 'Tom su size 30', 'Nuoc suoi 500ml', 'Tra dao chai', 'Combo lau', 'Dich vu giao hang', 'Xuc xich Duc', 'Pizza mini'];
  const products = [];
  for (let i = 0; i < productNames.length; i += 1) {
    products.push(await upsert(HangHoa, { ma_hang: `BULK-SP${String(i + 1).padStart(4, '0')}` }, {
      ma_hang: `BULK-SP${String(i + 1).padStart(4, '0')}`,
      ten_hang: `BULK ${productNames[i]}`,
      loai_hang: i === 7 ? 'dich_vu' : i === 6 ? 'combo' : 'hang_hoa',
      gia_von: i === 7 ? 0 : 25000 + i * 9000,
      gia_ban: i === 7 ? 30000 : 42000 + i * 12000,
      ton_kho: i === 7 ? 0 : 50 + i * 8,
      dinh_muc_ton_thap: 10,
      don_vi_tinh: i === 7 ? 'lan' : 'cai',
      cua_hang_id: store._id,
      nhom_hang_id: group._id,
      don_vi_tinh_id: unit._id,
      thuong_hieu_id: brand._id,
      vi_tri_id: position._id,
      nha_cung_cap_id: pick(suppliers, i)._id,
      nguoi_tao_id: admin._id,
      trang_thai: i === 9 ? 'inactive' : 'active'
    }));
  }

  const priceBook = await upsert(BangGia, { ten_bang_gia: 'BULK Bang gia le' }, { ten_bang_gia: 'BULK Bang gia le', cua_hang_id: store._id, trang_thai: 'active' });
  await CTBangGia.deleteMany({ bang_gia_id: priceBook._id });
  await CTBangGia.insertMany(products.map(product => ({ bang_gia_id: priceBook._id, hang_hoa_id: product._id, gia_ban: product.gia_ban })));

  const partners = [];
  for (let i = 1; i <= 5; i += 1) {
    partners.push(await upsert(DoiTacGiaoHang, { ma_doi_tac: `BULK-DTGH${String(i).padStart(3, '0')}` }, {
      ma_doi_tac: `BULK-DTGH${String(i).padStart(3, '0')}`,
      ten_doi_tac: `BULK Doi tac giao hang ${i}`,
      sdt: `1900666${i}`,
      email: `bulk.shipper${i}@example.com`,
      dia_chi: i % 2 === 0 ? 'Ha Noi' : 'TP.HCM',
      trang_thai: i === 5 ? 'inactive' : 'active'
    }));
  }

  let cashBook = await SoQuy.findOne({ loai: 'cash', trang_thai: 'active' }).sort({ created_at: 1 });
  if (!cashBook) {
    cashBook = await SoQuy.findOne({ trang_thai: 'active' }).sort({ created_at: 1 });
  }
  if (!cashBook) {
    throw new Error('Khong tim thay so quy tien mat de gan phieu thu chi. Hay chay seed_test_data.js truoc.');
  }

  return { customers, suppliers, products, partners, cashBook };
}

async function seedPurchases(ctx, store, branch, admin) {
  const statuses = ['completed', 'draft', 'cancelled', 'completed', 'completed'];
  for (let i = 1; i <= 18; i += 1) {
    const code = `BULK-PN${String(i).padStart(4, '0')}`;
    const productA = pick(ctx.products, i);
    const productB = pick(ctx.products, i + 3);
    const qtyA = 5 + (i % 6);
    const qtyB = 3 + (i % 4);
    const total = qtyA * productA.gia_von + qtyB * productB.gia_von;
    const purchase = await PhieuNhap.create({
      ma_phieu_nhap: code,
      ngay_nhap: dateAgo(i, 8 + (i % 8), 10),
      tong_tien: total,
      trang_thai: pick(statuses, i),
      ghi_chu: `BULK nhap hang trang thai ${pick(statuses, i)}`,
      cua_hang_id: store._id,
      chi_nhanh_id: branch._id,
      nha_cung_cap_id: pick(ctx.suppliers, i)._id,
      nguoi_tao_id: admin._id
    });
    await CTPhieuNhap.insertMany([
      { phieu_nhap_id: purchase._id, hang_hoa_id: productA._id, so_luong: qtyA, don_gia_nhap: productA.gia_von, thanh_tien: qtyA * productA.gia_von },
      { phieu_nhap_id: purchase._id, hang_hoa_id: productB._id, so_luong: qtyB, don_gia_nhap: productB.gia_von, thanh_tien: qtyB * productB.gia_von }
    ]);
    await HoaDonDauVao.create({
      ma_hoa_don: `BULK-HDV${String(i).padStart(4, '0')}`,
      ngay_hoa_don: purchase.ngay_nhap,
      nha_cung_cap_id: purchase.nha_cung_cap_id,
      phieu_nhap_id: purchase._id,
      tong_tien: total,
      trang_thai: purchase.trang_thai === 'cancelled' ? 'cancelled' : purchase.trang_thai === 'draft' ? 'draft' : 'completed',
      nguoi_tao_id: admin._id
    });
    if (purchase.trang_thai === 'completed') {
      await CongNoNhaCungCap.create({
        nha_cung_cap_id: purchase.nha_cung_cap_id,
        phieu_nhap_id: purchase._id,
        so_tien: total,
        loai: 'debit',
        ghi_chu: 'BULK cong no nhap hang',
        ngay: purchase.ngay_nhap
      });
    }
    if (i % 5 === 0) {
      const ret = await PhieuTraHangNhap.create({
        ma_phieu_tra_nhap: `BULK-TN${String(i).padStart(4, '0')}`,
        ngay_tra: dateAgo(i - 1, 15, 30),
        nha_cung_cap_id: purchase.nha_cung_cap_id,
        phieu_nhap_id: purchase._id,
        tong_tien_tra: productA.gia_von,
        trang_thai: i % 10 === 0 ? 'cancelled' : 'completed',
        ly_do: 'BULK tra NCC do hang loi',
        nguoi_tao_id: admin._id
      });
      await CTPhieuTraHangNhap.create({ phieu_tra_nhap_id: ret._id, hang_hoa_id: productA._id, so_luong: 1, don_gia: productA.gia_von, thanh_tien: productA.gia_von });
    }
  }
}

async function seedSales(ctx, store, branch, admin) {
  const orderStatuses = ['draft', 'shipping', 'completed', 'cancelled'];
  const invoiceStatuses = ['processing', 'completed', 'failed', 'cancelled'];
  const shipmentStatuses = ['draft', 'shipping', 'completed', 'cancelled'];

  for (let i = 1; i <= 45; i += 1) {
    const customer = pick(ctx.customers, i);
    const productA = pick(ctx.products, i);
    const productB = pick(ctx.products, i + 4);
    const qtyA = 1 + (i % 4);
    const qtyB = 1 + (i % 3);
    const discount = i % 6 === 0 ? 15000 : 0;
    const goodsTotal = qtyA * productA.gia_ban + qtyB * productB.gia_ban;
    const payable = Math.max(goodsTotal - discount, 0);
    const orderStatus = pick(orderStatuses, i);
    const invoiceStatus = pick(invoiceStatuses, i);
    const createdAt = dateAgo(i % 35, 8 + (i % 9), (i * 7) % 60);

    const order = await DonHang.create({
      ma_don_hang: `BULK-DH${String(i).padStart(4, '0')}`,
      ngay_dat: createdAt,
      ngay_tao: createdAt,
      tong_tien: payable,
      tong_tien_hang: goodsTotal,
      tong_thanh_toan: payable,
      trang_thai: orderStatus,
      ghi_chu: `BULK dat hang ${orderStatus}`,
      cua_hang_id: store._id,
      chi_nhanh_id: branch._id,
      khach_hang_id: customer._id,
      nguoi_tao_id: admin._id
    });
    await CTDonHang.insertMany([
      { don_hang_id: order._id, hang_hoa_id: productA._id, so_luong: qtyA, don_gia_ban: productA.gia_ban, chiet_khau: 0, thanh_tien: qtyA * productA.gia_ban },
      { don_hang_id: order._id, hang_hoa_id: productB._id, so_luong: qtyB, don_gia_ban: productB.gia_ban, chiet_khau: discount, thanh_tien: qtyB * productB.gia_ban - discount }
    ]);

    const invoice = await HoaDonBanHang.create({
      ma_hoa_don: `BULK-HD${String(i).padStart(4, '0')}`,
      ngay_ban: createdAt,
      tong_tien: goodsTotal,
      giam_gia: discount,
      thanh_toan: payable,
      phuong_thuc_tt: i % 3 === 0 ? 'Chuyen khoan' : 'COD',
      trang_thai: invoiceStatus,
      ghi_chu: `BULK hoa don ${invoiceStatus}`,
      cua_hang_id: store._id,
      chi_nhanh_id: branch._id,
      don_hang_id: order._id,
      khach_hang_id: customer._id,
      nguoi_ban_id: admin._id
    });
    await CTHoaDonBanHang.insertMany([
      { hoa_don_id: invoice._id, hang_hoa_id: productA._id, so_luong: qtyA, don_gia: productA.gia_ban, chiet_khau: 0, thanh_tien: qtyA * productA.gia_ban },
      { hoa_don_id: invoice._id, hang_hoa_id: productB._id, so_luong: qtyB, don_gia: productB.gia_ban, chiet_khau: discount, thanh_tien: qtyB * productB.gia_ban - discount }
    ]);

    const shipment = await VanDon.create({
      ma_van_don: `BULK-VD${String(i).padStart(4, '0')}`,
      don_hang_id: order._id,
      hoa_don_id: invoice._id,
      doi_tac_giao_hang_id: pick(ctx.partners, i)._id,
      cua_hang_id: store._id,
      khach_hang_id: customer._id,
      ten_nguoi_nhan: customer.ten_khach_hang,
      sdt_nguoi_nhan: customer.sdt,
      dia_chi_nhan: customer.dia_chi_nhan,
      phi_giao_hang: 20000 + (i % 5) * 5000,
      trang_thai: pick(shipmentStatuses, i),
      ghi_chu: `BULK van don ${pick(shipmentStatuses, i)}`
    });

    if (invoiceStatus !== 'cancelled') {
      await CongNoKhachHang.create({
        khach_hang_id: customer._id,
        don_hang_id: order._id,
        hoa_don_id: invoice._id,
        so_tien: payable,
        loai: 'debit',
        ghi_chu: 'BULK cong no ban hang',
        ngay: createdAt
      });
    }

    if (i % 2 === 0 && invoiceStatus !== 'cancelled') {
      const paid = i % 8 === 0 ? Math.floor(payable / 2) : payable;
      const receipt = await PhieuThuChi.create({
        ma_phieu: `BULK-PT${String(i).padStart(4, '0')}`,
        ngay_lap: dateAgo(i % 35, 17, (i * 3) % 60),
        loai_phieu: 'thu',
        loai_thu_chi: i % 8 === 0 ? 'Thu mot phan cong no' : 'Thu tien ban hang',
        gia_tri: paid,
        doi_tuong: customer.ten_khach_hang,
        ghi_chu: 'BULK thu tien khach hang',
        trang_thai: 'paid',
        hach_toan: true,
        cua_hang_id: store._id,
        chi_nhanh_id: branch._id,
        so_quy_id: ctx.cashBook._id,
        nguoi_tao_id: admin._id,
        khach_hang_id: customer._id
      });
      await CongNoKhachHang.create({
        khach_hang_id: customer._id,
        hoa_don_id: invoice._id,
        phieu_thu_chi_id: receipt._id,
        so_tien: -paid,
        loai: 'thu',
        ghi_chu: 'BULK thanh toan hoa don',
        ngay: receipt.ngay_lap
      });
    }

    if (i % 7 === 0) {
      const retTotal = productA.gia_ban;
      const returnSlip = await PhieuTraHang.create({
        ma_phieu_tra: `BULK-TH${String(i).padStart(4, '0')}`,
        ngay_tra: dateAgo((i % 35) - 1, 11, 20),
        tong_tien_tra: retTotal,
        ly_do: i % 14 === 0 ? 'BULK khach huy mot phan' : 'BULK doi tra hang',
        trang_thai: i % 14 === 0 ? 'cancelled' : 'completed',
        ghi_chu: 'BULK phieu tra hang',
        cua_hang_id: store._id,
        chi_nhanh_id: branch._id,
        hoa_don_id: invoice._id,
        khach_hang_id: customer._id,
        nguoi_tao_id: admin._id
      });
      await CTPhieuTraHang.create({ phieu_tra_hang_id: returnSlip._id, hang_hoa_id: productA._id, so_luong: 1, don_gia: productA.gia_ban, thanh_tien: retTotal });
    }

    await LichSuKho.insertMany([
      { cua_hang_id: store._id, chi_nhanh_id: branch._id, hang_hoa_id: productA._id, nguoi_tao_id: admin._id, loai_phieu: 'sale', ma_phieu: invoice.ma_hoa_don, so_luong_thay_doi: -qtyA, ton_kho_sau: Math.max(productA.ton_kho - qtyA, 0), ghi_chu: 'BULK ban hang', ngay: createdAt },
      { cua_hang_id: store._id, chi_nhanh_id: branch._id, hang_hoa_id: productB._id, nguoi_tao_id: admin._id, loai_phieu: 'sale', ma_phieu: invoice.ma_hoa_don, so_luong_thay_doi: -qtyB, ton_kho_sau: Math.max(productB.ton_kho - qtyB, 0), ghi_chu: 'BULK ban hang', ngay: createdAt }
    ]);

    if (shipment.trang_thai === 'completed') {
      order.trang_thai = 'completed';
      await order.save();
    }
  }
}

async function seedCashAdjustments(ctx, store, branch, admin) {
  for (let i = 1; i <= 16; i += 1) {
    const isIncome = i % 2 === 1;
    const targetCustomer = pick(ctx.customers, i);
    const targetSupplier = pick(ctx.suppliers, i);
    await PhieuThuChi.create({
      ma_phieu: `BULK-${isIncome ? 'PT' : 'PC'}X${String(i).padStart(3, '0')}`,
      ngay_lap: dateAgo(i, 13, 15),
      loai_phieu: isIncome ? 'thu' : 'chi',
      loai_thu_chi: isIncome ? (i % 3 === 0 ? 'Thu khac' : 'Thu cong no') : (i % 4 === 0 ? 'Chi phi van hanh' : 'Chi nha cung cap'),
      gia_tri: 50000 + i * 12000,
      doi_tuong: isIncome ? targetCustomer.ten_khach_hang : targetSupplier.ten_ncc,
      ghi_chu: 'BULK phieu thu chi da dang',
      trang_thai: i % 5 === 0 ? 'cancelled' : 'paid',
      hach_toan: i % 6 !== 0,
      cua_hang_id: store._id,
      chi_nhanh_id: branch._id,
      so_quy_id: ctx.cashBook._id,
      nguoi_tao_id: admin._id,
      khach_hang_id: isIncome ? targetCustomer._id : null,
      nha_cung_cap_id: isIncome ? null : targetSupplier._id
    });
  }
}

async function printCounts() {
  const entries = await Promise.all([
    ['customers', KhachHang.countDocuments()],
    ['suppliers', NhaCungCap.countDocuments()],
    ['products', HangHoa.countDocuments()],
    ['orders', DonHang.countDocuments()],
    ['invoices', HoaDonBanHang.countDocuments()],
    ['shipments', VanDon.countDocuments()],
    ['returns', PhieuTraHang.countDocuments()],
    ['purchases', PhieuNhap.countDocuments()],
    ['cash slips', PhieuThuChi.countDocuments()]
  ].map(async ([label, promise]) => [label, await promise]));
  entries.forEach(([label, count]) => console.log(`[seed-bulk] ${label}: ${count}`));
}

async function main() {
  await waitDb();
  console.log('[seed-bulk] Connected. Reviewing current data...');
  await printCounts();

  const store = await upsert(CuaHang, { ma_cua_hang: 'BULK-CH0001' }, {
    ma_cua_hang: 'BULK-CH0001',
    ten_cua_hang: 'BULK Cua hang du lieu lon',
    dia_chi: '1 Duong du lieu, Ha Noi',
    dia_chi_gui_hang: '1 Duong du lieu, Ha Noi',
    tinh_thanh: 'Ha Noi',
    quan_huyen: 'Cau Giay',
    phuong_xa: 'Dich Vong',
    sdt: '0909000000',
    email: 'bulk-store@example.com',
    trang_thai: 'active'
  });
  const branch = await upsert(ChiNhanh, { ma_chi_nhanh: 'BULK-CN0001' }, {
    ma_chi_nhanh: 'BULK-CN0001',
    ten_chi_nhanh: 'BULK Chi nhanh trung tam',
    dia_chi: store.dia_chi,
    sdt: store.sdt,
    cua_hang_id: store._id,
    trang_thai: 'active'
  });
  const admin = await upsert(NguoiDung, { email: 'bulk-admin@example.com' }, {
    email: 'bulk-admin@example.com',
    ho_ten: 'BULK Quan tri vien',
    vai_tro: 'admin',
    trang_thai: 'active',
    cua_hang_id: store._id,
    chi_nhanh_id: branch._id
  });

  await clearBulkData();
  const ctx = await seedBaseData(store, branch, admin);
  await seedPurchases(ctx, store, branch, admin);
  await seedSales(ctx, store, branch, admin);
  await seedCashAdjustments(ctx, store, branch, admin);

  console.log('[seed-bulk] Done. Data after seeding:');
  await printCounts();
  await mongoose.disconnect();
}

main().catch(async error => {
  console.error('[seed-bulk] Failed:', error);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
