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
  PhieuKiemKho,
  CTPhieuKiemKho,
  SoQuy,
  PhieuThuChi,
  CongNoKhachHang,
  CongNoNhaCungCap,
  LichSuKho,
  PhieuXuatNoiBo,
  CTXuatNoiBo
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

function daysAgo(days, hour = 9, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date;
}

async function seed() {
  await waitDb();
  console.log('[seed] Connected. Seeding test data...');

  const store = await upsert(CuaHang, { ma_cua_hang: 'CH0001' }, {
    ma_cua_hang: 'CH0001',
    ten_cua_hang: 'Cửa hàng Nguyên Chấm Dứt',
    sdt: '0376946978',
    email: 'cuahang@example.com',
    dia_chi: '25 Nguyễn Trãi, Thanh Xuân, Hà Nội',
    dia_chi_gui_hang: '25 Nguyễn Trãi, Thanh Xuân, Hà Nội',
    tinh_thanh: 'Hà Nội',
    quan_huyen: 'Thanh Xuân',
    phuong_xa: 'Thượng Đình',
    trang_thai: 'active'
  });

  const branch = await upsert(ChiNhanh, { ma_chi_nhanh: 'CN0001' }, {
    ma_chi_nhanh: 'CN0001',
    ten_chi_nhanh: 'Chi nhánh trung tâm',
    dia_chi: store.dia_chi,
    sdt: store.sdt,
    cua_hang_id: store._id,
    trang_thai: 'active'
  });

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  await upsert(NguoiDung, { email: adminEmail }, {
    email: adminEmail,
    ho_ten: 'Quản trị cửa hàng',
    vai_tro: 'admin',
    trang_thai: 'active',
    cua_hang_id: store._id,
    chi_nhanh_id: branch._id
  });

  const retailGroup = await upsert(NhomKhachHang, { ten_nhom: 'Khách lẻ' }, { ten_nhom: 'Khách lẻ', cua_hang_id: store._id });
  const vipGroup = await upsert(NhomKhachHang, { ten_nhom: 'Khách VIP' }, { ten_nhom: 'Khách VIP', cua_hang_id: store._id });

  const customersSeed = [
    { ma_khach_hang: 'KH000001', ten_khach_hang: 'Nguyễn Văn Hải', sdt: '0901000001', email: 'hai@example.com', gioi_tinh: 'nam', nhom_khach_hang_id: vipGroup._id, dia_chi_nhan: '12 Láng Hạ, Đống Đa, Hà Nội', tinh_thanh: 'Hà Nội', quan_huyen: 'Đống Đa', phuong_xa: 'Láng Hạ', tong_no: 0 },
    { ma_khach_hang: 'KH000002', ten_khach_hang: 'Phạm Thu Hương', sdt: '0901000002', email: 'huong@example.com', gioi_tinh: 'nu', nhom_khach_hang_id: retailGroup._id, dia_chi_nhan: '88 Lê Lợi, Quận 1, TP.HCM', tinh_thanh: 'TP.HCM', quan_huyen: 'Quận 1', phuong_xa: 'Bến Nghé', tong_no: 0 },
    { ma_khach_hang: 'KH000003', ten_khach_hang: 'Tuấn - Hà Nội', sdt: '0901000003', nhom_khach_hang_id: retailGroup._id, dia_chi_nhan: '5 Trần Duy Hưng, Cầu Giấy, Hà Nội', tinh_thanh: 'Hà Nội', quan_huyen: 'Cầu Giấy', phuong_xa: 'Trung Hòa', tong_no: 150000 },
    { ma_khach_hang: 'KH000004', ten_khach_hang: 'Anh Hoàng - Sài Gòn', sdt: '0901000004', loai_khach_hang: 'cong_ty', ten_cong_ty: 'Công ty Hoàng Gia', ma_so_thue: '0312345678', dia_chi_nhan: '22 Nguyễn Huệ, Quận 1, TP.HCM', tinh_thanh: 'TP.HCM', quan_huyen: 'Quận 1', phuong_xa: 'Bến Nghé', tong_no: 0 },
    { ma_khach_hang: 'KH000005', ten_khach_hang: 'Anh Giang - Kim Mã', sdt: '0901000005', dia_chi_nhan: '105 Kim Mã, Ba Đình, Hà Nội', tinh_thanh: 'Hà Nội', quan_huyen: 'Ba Đình', phuong_xa: 'Kim Mã', tong_no: 0 }
  ];
  const customers = [];
  for (const data of customersSeed) {
    const customer = await upsert(KhachHang, { ma_khach_hang: data.ma_khach_hang }, {
      ...data,
      cua_hang_id: store._id,
      trang_thai: 'active'
    });
    await DiaChiKhachHang.findOneAndUpdate(
      { khach_hang_id: customer._id, mac_dinh: true },
      {
        khach_hang_id: customer._id,
        dia_chi: data.dia_chi_nhan,
        tinh_thanh: data.tinh_thanh,
        quan_huyen: data.quan_huyen,
        phuong_xa: data.phuong_xa,
        mac_dinh: true
      },
      { upsert: true, new: true }
    );
    customers.push(customer);
  }

  const suppliersSeed = [
    { ma_ncc: 'NCC0001', ten_ncc: 'Công ty TNHH Citigo', sdt: '02811110001', email: 'citigo@example.com', dia_chi: 'Hà Nội', tong_mua: 3200000 },
    { ma_ncc: 'NCC0002', ten_ncc: 'Công ty Hoàng Gia', sdt: '02811110002', email: 'hoanggia@example.com', dia_chi: 'TP.HCM', tong_mua: 4800000 },
    { ma_ncc: 'NCC0003', ten_ncc: 'Công ty Pharmedic', sdt: '02811110003', email: 'pharmedic@example.com', dia_chi: 'Đà Nẵng', tong_mua: 1500000 },
    { ma_ncc: 'NCC0004', ten_ncc: 'Đại lý Hồng Phúc', sdt: '02811110004', dia_chi: 'Hải Phòng', tong_mua: 2200000 },
    { ma_ncc: 'NCC0005', ten_ncc: 'Cửa hàng Đại Việt', sdt: '02811110005', dia_chi: 'Cần Thơ', tong_mua: 1800000 }
  ];
  const suppliers = [];
  for (const data of suppliersSeed) {
    suppliers.push(await upsert(NhaCungCap, { ma_ncc: data.ma_ncc }, { ...data, trang_thai: 'active', cua_hang_id: store._id }));
  }

  const frozenGroup = await upsert(NhomHang, { ten_nhom_hang: 'Hàng đông lạnh' }, { ten_nhom_hang: 'Hàng đông lạnh', cua_hang_id: store._id });
  const drinkGroup = await upsert(NhomHang, { ten_nhom_hang: 'Đồ uống' }, { ten_nhom_hang: 'Đồ uống', cua_hang_id: store._id });
  const serviceGroup = await upsert(NhomHang, { ten_nhom_hang: 'Dịch vụ' }, { ten_nhom_hang: 'Dịch vụ', cua_hang_id: store._id });
  await upsert(DonViTinh, { ten_don_vi: 'cái' }, { ten_don_vi: 'cái', cua_hang_id: store._id });
  await upsert(DonViTinh, { ten_don_vi: 'kg' }, { ten_don_vi: 'kg', cua_hang_id: store._id });
  const brand = await upsert(ThuongHieu, { ten_thuong_hieu: 'Newbie Food' }, { ten_thuong_hieu: 'Newbie Food', cua_hang_id: store._id });
  const position = await upsert(ViTri, { ten_vi_tri: 'Kho chính' }, { ten_vi_tri: 'Kho chính', cua_hang_id: store._id });

  const productsSeed = [
    { ma_hang: 'NSTP00030', ten_hang: 'Sáu đông lạnh Vibafood 300g', gia_von: 48000, gia_ban: 65000, ton_kho: 30, nhom_hang_id: frozenGroup._id, nha_cung_cap_id: suppliers[1]._id, loai_hang: 'hang_hoa' },
    { ma_hang: 'NSTP00029', ten_hang: 'Gà ta đông lạnh', gia_von: 92000, gia_ban: 125000, ton_kho: 18, nhom_hang_id: frozenGroup._id, nha_cung_cap_id: suppliers[4]._id, loai_hang: 'hang_hoa' },
    { ma_hang: 'NSTP00028', ten_hang: 'Bò ba chỉ Mỹ ACE FOODS 500gr', gia_von: 135000, gia_ban: 178000, ton_kho: 22, nhom_hang_id: frozenGroup._id, nha_cung_cap_id: suppliers[0]._id, loai_hang: 'hang_hoa' },
    { ma_hang: 'NSTP00027', ten_hang: 'Chả ram tôm đất Bình Định đặc biệt', gia_von: 69000, gia_ban: 95000, ton_kho: 40, nhom_hang_id: frozenGroup._id, nha_cung_cap_id: suppliers[3]._id, loai_hang: 'hang_hoa' },
    { ma_hang: 'DV000001', ten_hang: 'Giao hàng nội thành', gia_von: 0, gia_ban: 30000, ton_kho: 0, nhom_hang_id: serviceGroup._id, loai_hang: 'dich_vu' },
    { ma_hang: 'CB000001', ten_hang: 'Combo lẩu hải sản 2 người', gia_von: 210000, gia_ban: 285000, ton_kho: 12, nhom_hang_id: frozenGroup._id, loai_hang: 'combo' },
    { ma_hang: 'DR000001', ten_hang: 'Nước suối Aquafina 500ml', gia_von: 4000, gia_ban: 7000, ton_kho: 200, nhom_hang_id: drinkGroup._id, nha_cung_cap_id: suppliers[2]._id, loai_hang: 'hang_hoa' }
  ];
  const products = [];
  for (const data of productsSeed) {
    products.push(await upsert(HangHoa, { ma_hang: data.ma_hang }, {
      ...data,
      cua_hang_id: store._id,
      thuong_hieu_id: brand._id,
      vi_tri_id: position._id,
      don_vi_tinh: data.loai_hang === 'dich_vu' ? 'lần' : 'cái',
      ban_truc_tiep: true,
      trang_thai: 'active'
    }));
  }

  const priceBook = await upsert(BangGia, { ten_bang_gia: 'Bảng giá chung' }, { ten_bang_gia: 'Bảng giá chung', trang_thai: 'active', cua_hang_id: store._id });
  await CTBangGia.deleteMany({ bang_gia_id: priceBook._id });
  await CTBangGia.insertMany(products.map(product => ({ bang_gia_id: priceBook._id, hang_hoa_id: product._id, gia_ban: product.gia_ban })));

  const partnersSeed = [
    { ma_doi_tac: 'DTGH0001', ten_doi_tac: 'Nhà xe Hoàng Long', sdt: '19001001', email: 'hoanglong@example.com' },
    { ma_doi_tac: 'DTGH0002', ten_doi_tac: 'Giao hàng Nội Thành', sdt: '19001002', email: 'noithanh@example.com' },
    { ma_doi_tac: 'DTGH0003', ten_doi_tac: 'Xe lạnh Miền Bắc', sdt: '19001003', email: 'xelanh@example.com' }
  ];
  const partners = [];
  for (const data of partnersSeed) partners.push(await upsert(DoiTacGiaoHang, { ma_doi_tac: data.ma_doi_tac }, { ...data, trang_thai: 'active' }));

  const purchase = await upsert(PhieuNhap, { ma_phieu_nhap: 'PN000046' }, {
    ma_phieu_nhap: 'PN000046',
    ngay_nhap: daysAgo(0, 16, 24),
    tong_tien: 2570000,
    trang_thai: 'completed',
    cua_hang_id: store._id,
    chi_nhanh_id: branch._id,
    nha_cung_cap_id: suppliers[1]._id
  });
  await CTPhieuNhap.deleteMany({ phieu_nhap_id: purchase._id });
  await CTPhieuNhap.insertMany([
    { phieu_nhap_id: purchase._id, hang_hoa_id: products[0]._id, so_luong: 20, don_gia_nhap: 48000, thanh_tien: 960000 },
    { phieu_nhap_id: purchase._id, hang_hoa_id: products[2]._id, so_luong: 10, don_gia_nhap: 135000, thanh_tien: 1350000 },
    { phieu_nhap_id: purchase._id, hang_hoa_id: products[6]._id, so_luong: 65, don_gia_nhap: 4000, thanh_tien: 260000 }
  ]);
  await upsert(HoaDonDauVao, { ma_hoa_don: 'HDV000046' }, {
    ma_hoa_don: 'HDV000046',
    ngay_hoa_don: daysAgo(0, 16, 25),
    nha_cung_cap_id: suppliers[1]._id,
    phieu_nhap_id: purchase._id,
    tong_tien: 2570000,
    trang_thai: 'completed'
  });

  const purchaseReturn = await upsert(PhieuTraHangNhap, { ma_phieu_tra_nhap: 'THN000001' }, {
    ma_phieu_tra_nhap: 'THN000001',
    ngay_tra: daysAgo(0, 17, 0),
    nha_cung_cap_id: suppliers[1]._id,
    phieu_nhap_id: purchase._id,
    tong_tien_tra: 96000,
    trang_thai: 'completed',
    ly_do: 'Hàng lỗi bao bì'
  });
  await CTPhieuTraHangNhap.deleteMany({ phieu_tra_nhap_id: purchaseReturn._id });
  await CTPhieuTraHangNhap.create({ phieu_tra_nhap_id: purchaseReturn._id, hang_hoa_id: products[0]._id, so_luong: 2, don_gia: 48000, thanh_tien: 96000 });

  const order = await upsert(DonHang, { ma_don_hang: 'DH000046' }, {
    ma_don_hang: 'DH000046',
    ngay_dat: daysAgo(0, 15, 36),
    ngay_tao: daysAgo(0, 15, 36),
    tong_tien: 255000,
    tong_tien_hang: 255000,
    tong_thanh_toan: 255000,
    trang_thai: 'shipping',
    cua_hang_id: store._id,
    chi_nhanh_id: branch._id,
    khach_hang_id: customers[0]._id
  });
  await CTDonHang.deleteMany({ don_hang_id: order._id });
  await CTDonHang.insertMany([
    { don_hang_id: order._id, hang_hoa_id: products[0]._id, so_luong: 2, don_gia_ban: 65000, chiet_khau: 0, thanh_tien: 130000 },
    { don_hang_id: order._id, hang_hoa_id: products[1]._id, so_luong: 1, don_gia_ban: 125000, chiet_khau: 0, thanh_tien: 125000 }
  ]);

  const invoice = await upsert(HoaDonBanHang, { ma_hoa_don: 'HD000046' }, {
    ma_hoa_don: 'HD000046',
    ngay_ban: daysAgo(0, 16, 24),
    tong_tien: 255000,
    giam_gia: 0,
    thanh_toan: 255000,
    phuong_thuc_tt: 'COD',
    trang_thai: 'processing',
    cua_hang_id: store._id,
    chi_nhanh_id: branch._id,
    don_hang_id: order._id,
    khach_hang_id: customers[0]._id
  });
  await CTHoaDonBanHang.deleteMany({ hoa_don_id: invoice._id });
  await CTHoaDonBanHang.insertMany([
    { hoa_don_id: invoice._id, hang_hoa_id: products[0]._id, so_luong: 2, don_gia: 65000, chiet_khau: 0, thanh_tien: 130000 },
    { hoa_don_id: invoice._id, hang_hoa_id: products[1]._id, so_luong: 1, don_gia: 125000, chiet_khau: 0, thanh_tien: 125000 }
  ]);

  await upsert(VanDon, { ma_van_don: 'VD000046' }, {
    ma_van_don: 'VD000046',
    don_hang_id: order._id,
    hoa_don_id: invoice._id,
    doi_tac_giao_hang_id: partners[1]._id,
    cua_hang_id: store._id,
    khach_hang_id: customers[0]._id,
    ten_nguoi_nhan: customers[0].ten_khach_hang,
    sdt_nguoi_nhan: customers[0].sdt,
    dia_chi_nhan: customers[0].dia_chi_nhan,
    phi_giao_hang: 30000,
    trang_thai: 'shipping',
    ghi_chu: 'Giao giờ hành chính'
  });

  const returnSlip = await upsert(PhieuTraHang, { ma_phieu_tra: 'TH000001' }, {
    ma_phieu_tra: 'TH000001',
    ngay_tra: daysAgo(0, 18, 0),
    tong_tien_tra: 65000,
    ly_do: 'Khách đổi món',
    trang_thai: 'completed',
    hoa_don_id: invoice._id,
    khach_hang_id: customers[0]._id
  });
  await CTPhieuTraHang.deleteMany({ phieu_tra_hang_id: returnSlip._id });
  await CTPhieuTraHang.create({ phieu_tra_hang_id: returnSlip._id, hang_hoa_id: products[0]._id, so_luong: 1, don_gia: 65000, thanh_tien: 65000 });

  const cashBook = await upsert(SoQuy, { ten_so_quy: 'Sổ tiền mặt' }, {
    ten_so_quy: 'Sổ tiền mặt',
    loai: 'cash',
    so_du: 10000000,
    trang_thai: 'active',
    cua_hang_id: store._id,
    chi_nhanh_id: branch._id
  });
  await upsert(PhieuThuChi, { ma_phieu: 'PT000001' }, {
    ma_phieu: 'PT000001',
    ngay_lap: daysAgo(0, 16, 30),
    loai_phieu: 'thu',
    gia_tri: 255000,
    doi_tuong: customers[0].ten_khach_hang,
    ghi_chu: 'Thu tiền hóa đơn HD000046',
    cua_hang_id: store._id,
    chi_nhanh_id: branch._id,
    so_quy_id: cashBook._id,
    khach_hang_id: customers[0]._id
  });
  await upsert(PhieuThuChi, { ma_phieu: 'PC000001' }, {
    ma_phieu: 'PC000001',
    ngay_lap: daysAgo(0, 17, 30),
    loai_phieu: 'chi',
    gia_tri: 96000,
    doi_tuong: suppliers[1].ten_ncc,
    ghi_chu: 'Chi hoàn trả nhà cung cấp',
    cua_hang_id: store._id,
    chi_nhanh_id: branch._id,
    so_quy_id: cashBook._id,
    nha_cung_cap_id: suppliers[1]._id
  });

  const stockCheck = await upsert(PhieuKiemKho, { ma_kiem_kho: 'KK000001' }, {
    ma_kiem_kho: 'KK000001',
    ngay_kiem: daysAgo(1, 10, 0),
    tong_so_luong_thuc_te: 40,
    tong_so_luong_lech: -1,
    trang_thai: 'completed',
    ghi_chu: 'Kiểm kho mẫu',
    cua_hang_id: store._id,
    chi_nhanh_id: branch._id
  });
  await CTPhieuKiemKho.deleteMany({ phieu_kiem_kho_id: stockCheck._id });
  await CTPhieuKiemKho.create({ phieu_kiem_kho_id: stockCheck._id, hang_hoa_id: products[0]._id, ton_kho_he_thong: 31, so_luong_thuc_te: 30, so_luong_lech: -1, gia_tri_lech: -48000 });

  const internalExport = await upsert(PhieuXuatNoiBo, { ma_xuat_noi_bo: 'XNB000001' }, {
    ma_xuat_noi_bo: 'XNB000001',
    ngay_xuat: daysAgo(2, 14, 0),
    loai_xuat: 'sample',
    cua_hang_id: store._id,
    nguoi_nhan: 'Bộ phận bếp',
    tong_gia_tri: 96000,
    trang_thai: 'completed',
    ghi_chu: 'Xuất dùng nội bộ mẫu'
  });
  await CTXuatNoiBo.deleteMany({ phieu_xuat_id: internalExport._id });
  await CTXuatNoiBo.create({ phieu_xuat_id: internalExport._id, hang_hoa_id: products[0]._id, so_luong: 2, gia_von: 48000, thanh_tien: 96000 });

  await CongNoKhachHang.deleteMany({ khach_hang_id: { $in: customers.map(item => item._id) }, ghi_chu: /^Seed/ });
  await CongNoKhachHang.create({ khach_hang_id: customers[2]._id, don_hang_id: order._id, hoa_don_id: invoice._id, so_tien: 150000, loai: 'debit', ghi_chu: 'Seed công nợ khách hàng' });
  await CongNoNhaCungCap.deleteMany({ nha_cung_cap_id: { $in: suppliers.map(item => item._id) }, ghi_chu: /^Seed/ });
  await CongNoNhaCungCap.create({ nha_cung_cap_id: suppliers[1]._id, phieu_nhap_id: purchase._id, so_tien: 500000, loai: 'debit', ghi_chu: 'Seed công nợ nhà cung cấp' });
  await LichSuKho.deleteMany({ ma_phieu: { $in: ['PN000046', 'HD000046', 'TH000001'] } });
  await LichSuKho.insertMany([
    { cua_hang_id: store._id, chi_nhanh_id: branch._id, hang_hoa_id: products[0]._id, loai_phieu: 'purchase', ma_phieu: 'PN000046', so_luong_thay_doi: 20, ton_kho_sau: 32, ghi_chu: 'Seed nhập hàng' },
    { cua_hang_id: store._id, chi_nhanh_id: branch._id, hang_hoa_id: products[0]._id, loai_phieu: 'sale', ma_phieu: 'HD000046', so_luong_thay_doi: -2, ton_kho_sau: 30, ghi_chu: 'Seed bán hàng' },
    { cua_hang_id: store._id, chi_nhanh_id: branch._id, hang_hoa_id: products[0]._id, loai_phieu: 'return', ma_phieu: 'TH000001', so_luong_thay_doi: 1, ton_kho_sau: 31, ghi_chu: 'Seed trả hàng' }
  ]);

  console.log('[seed] Done.');
  console.log(`[seed] Admin seeded with email: ${adminEmail}`);
  await mongoose.disconnect();
}

seed().catch(async error => {
  console.error('[seed] Failed:', error);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
