const path = require('path');
const ExcelJS = require('exceljs');

const headers = ['TC ID', 'Tên test case', 'Bước thực hiện', 'Kết quả mong đợi', 'Trạng thái', 'Dữ liệu test/User', 'Ghi chú'];

function row(name, steps, expected, data = '', note = '') {
  return [0, name, steps, expected, 'Chưa test', data, note];
}

function rowsWithIds(rows) {
  return rows.map((r, idx) => {
    r[0] = idx + 1;
    return r;
  });
}

function masterCases(m) {
  const rows = [
    row('Kiểm tra truy cập màn hình danh sách', `Đăng nhập admin active > vào menu ${m.menu}.`, `Hiển thị màn hình ${m.name}, URL ${m.url}, không lỗi 403/500.`, 'admin active'),
    row('Kiểm tra bố cục danh sách và cột hiển thị', `Vào ${m.url} > quan sát bảng danh sách.`, `Bảng hiển thị các cột: ${m.columns}.`, '', ''),
    row('Kiểm tra trạng thái rỗng của danh sách', `Xóa/ẩn dữ liệu test hoặc lọc để không có dữ liệu > xem danh sách.`, 'Hiển thị trạng thái không có dữ liệu, không vỡ layout, không lỗi JS.', '', 'Có thể cần môi trường test riêng.'),
    row('Kiểm tra mở form thêm mới', `Nhấn nút ${m.createButton || 'Tạo mới/Thêm mới'}.`, `Modal/form thêm mới mở đúng, có các trường: ${m.fields}.`, '', ''),
    row('Kiểm tra đóng form thêm mới bằng Bỏ qua/Đóng', 'Mở form thêm mới > nhập thử dữ liệu > nhấn Bỏ qua/Đóng.', 'Form đóng, không tạo bản ghi mới.', '', ''),
    row('Validate trường bắt buộc', `Mở form thêm mới > bỏ trống trường bắt buộc: ${m.required}. > nhấn Lưu.`, 'Không lưu dữ liệu; hiển thị validate/không cho submit theo HTML5 hoặc server.', '', ''),
    row('Validate định dạng số điện thoại', 'Nhập số điện thoại chứa chữ/ký tự đặc biệt > Lưu.', 'Hệ thống không lưu sai định dạng nếu có validate; nếu vẫn lưu cần xác nhận rule nghiệp vụ.', 'SĐT: abc@@@', 'Source chưa thấy regex chung cho SĐT.'),
    row('Validate định dạng email', 'Nhập email sai định dạng > Lưu.', 'Trường email type=email chặn submit hoặc server trả lỗi.', 'email: abc@', 'Áp dụng khi form có email.'),
    row('Validate dữ liệu số âm', 'Nhập giá trị số âm vào các trường tiền/số lượng/nợ/tồn nếu có > Lưu.', 'Không cho lưu số âm với trường không chấp nhận âm; hiển thị lỗi phù hợp.', '-1', 'Cần xác nhận rule từng trường.'),
    row('Thêm mới thành công với dữ liệu tối thiểu', `Mở form thêm mới > nhập đủ ${m.required}. > Lưu.`, 'Tạo bản ghi thành công, quay lại danh sách/đóng modal, bản ghi xuất hiện trong danh sách.', m.sample),
    row('Thêm mới thành công với đầy đủ dữ liệu', `Mở form thêm mới > nhập tất cả trường: ${m.fields}. > Lưu.`, 'Dữ liệu được lưu đúng, xem lại chi tiết thấy đủ thông tin.', m.fullSample || m.sample),
    row('Thêm mới thất bại do mã/tên trùng', 'Tạo bản ghi có mã/tên đã tồn tại theo unique index hoặc rule source > Lưu.', 'Không tạo bản ghi trùng; hiển thị lỗi trùng dữ liệu hoặc server trả lỗi.', m.duplicate || '', 'Unique index có trong model với một số mã/tên.'),
    row('Kiểm tra chỉnh sửa bản ghi', 'Chọn một bản ghi > mở chi tiết/chỉnh sửa > đổi một trường không khóa > Lưu.', 'Thông tin cập nhật thành công và hiển thị lại đúng trên danh sách/chi tiết.', m.editSample || ''),
    row('Kiểm tra không mất dữ liệu khi chỉnh sửa một phần', 'Chỉnh sửa một trường > Lưu > mở lại chi tiết.', 'Các trường không sửa vẫn giữ nguyên.', '', ''),
    row('Kiểm tra xem chi tiết bản ghi', 'Click mã/tên bản ghi trong danh sách.', `Panel/chi tiết hiển thị đúng các tab/thông tin: ${m.tabs || 'Thông tin'}.`, '', ''),
    row('Kiểm tra xóa một bản ghi chưa phát sinh liên quan', 'Chọn bản ghi mới tạo chưa liên kết chứng từ > nhấn Xóa > xác nhận.', 'Bản ghi được xóa/ẩn khỏi danh sách; không còn tìm thấy khi reload.', '', ''),
    row('Kiểm tra xóa bản ghi đã phát sinh liên quan', 'Chọn bản ghi đã liên kết chứng từ/phiếu > nhấn Xóa > xác nhận.', 'Hệ thống chặn xóa hoặc thông báo dữ liệu đã phát sinh liên quan; dữ liệu không bị mất sai.', '', 'Cần xác nhận nghiệp vụ từng loại liên kết.'),
    row('Kiểm tra xóa hàng loạt', 'Tick nhiều bản ghi > nhấn Xóa đã chọn > xác nhận.', 'Các bản ghi hợp lệ bị xóa; bản ghi có ràng buộc được chặn/thông báo rõ.', '', m.bulkDelete ? '' : 'Nếu UI không có nút xóa hàng loạt thì bỏ qua.'),
    row('Kiểm tra tìm kiếm theo mã/tên', `Nhập keyword vào ô tìm kiếm (${m.searchHint || 'mã/tên'}) > Enter/Lọc.`, 'Danh sách chỉ hiển thị bản ghi khớp keyword; không phân biệt hoa thường nếu source hỗ trợ regex i.', m.searchSample || ''),
    row('Kiểm tra tìm kiếm không có kết quả', 'Nhập keyword chắc chắn không tồn tại > tìm kiếm.', 'Danh sách rỗng, không lỗi, vẫn giữ keyword tìm kiếm.', 'ZZZ_NOT_FOUND_999'),
    row('Kiểm tra lọc dữ liệu', `Chọn một bộ lọc trong màn hình: ${m.filters}. > Áp dụng.`, 'Danh sách trả về đúng dữ liệu theo bộ lọc.', '', ''),
    row('Kiểm tra kết hợp nhiều bộ lọc', `Chọn đồng thời nhiều bộ lọc: ${m.filters}. > Áp dụng.`, 'Kết quả thỏa đồng thời các điều kiện; query string giữ đúng filter.', '', ''),
    row('Kiểm tra reset/xóa lọc', 'Áp dụng lọc > nhấn Xóa lọc/Bỏ lọc.', 'Danh sách trở về trạng thái mặc định; URL/filter được reset.', '', ''),
    row('Kiểm tra phân trang', 'Tạo/chuẩn bị dữ liệu nhiều hơn 1 trang > chuyển trang kế/cuối/trước.', 'Trang chuyển đúng, số bản ghi không vượt page size, filter/search vẫn được giữ.', '', 'Nếu màn hình chưa có phân trang UI thì ghi nhận thiếu.'),
    row('Kiểm tra sort nếu có', 'Click tiêu đề cột hoặc dùng tham số sort nếu UI hỗ trợ.', 'Dữ liệu được sắp xếp đúng; nếu UI không hỗ trợ thì không có thay đổi ngoài ý muốn.', '', 'Cần xác nhận nếu source không thể hiện sort UI.'),
    row('Kiểm tra export file', `Nhấn ${m.exportButton || 'Xuất file'}.`, 'Tải file Excel/CSV thành công, file mở được, không rỗng khi danh sách có dữ liệu.', '', m.exportApi ? `API: ${m.exportApi}` : ''),
    row('Kiểm tra dữ liệu trong file export', 'Export theo một bộ lọc > mở file tải về > đối chiếu danh sách.', 'Cột và dữ liệu export khớp dữ liệu đang lọc; không export nhầm cửa hàng.', '', ''),
    row('Kiểm tra import file hợp lệ', 'Tải file mẫu nếu có > nhập dữ liệu hợp lệ > Import.', 'Import thành công, bản ghi mới xuất hiện trong danh sách.', '', m.importApi ? `API: ${m.importApi}` : 'Nếu màn hình không có import thì bỏ qua.'),
    row('Validate file import thiếu cột bắt buộc', 'Import file thiếu cột bắt buộc/tên cột sai.', 'Không import dữ liệu lỗi; hiển thị thông báo lỗi rõ dòng/cột nếu source hỗ trợ.', '', 'Nếu màn hình không có import thì bỏ qua.'),
    row('Validate file import sai định dạng', 'Import file có email/số/ ngày sai định dạng.', 'Dòng lỗi không được lưu hoặc import bị chặn; có thông báo lỗi.', '', 'Nếu màn hình không có import thì bỏ qua.'),
    row('Kiểm tra lỗi API/server', 'Giả lập API trả 500/mất kết nối khi Lưu/Xóa/Export.', 'UI hiển thị lỗi, không treo loading, dữ liệu cũ không bị thay đổi.', '', 'Có thể test bằng devtool/proxy.'),
    row('Kiểm tra phân quyền', `Đăng nhập user không phải admin hoặc inactive > truy cập ${m.url}.`, 'Bị chặn và chuyển logout/error admin_required theo middleware isAuthenticated.', 'user vai_tro=user hoặc trang_thai=inactive', 'Source hiện route chính yêu cầu admin active.')
  ];
  return rows;
}

function transactionCases(m) {
  const rows = [
    row('Kiểm tra truy cập màn hình danh sách phiếu', `Đăng nhập admin active > vào menu ${m.menu}.`, `Hiển thị danh sách ${m.name}, URL ${m.url}, không lỗi 403/500.`, 'admin active'),
    row('Kiểm tra cột danh sách phiếu', `Vào ${m.url} > quan sát bảng.`, `Bảng hiển thị các cột chính: ${m.columns}.`, '', ''),
    row('Kiểm tra trạng thái rỗng danh sách phiếu', 'Lọc khoảng thời gian không có dữ liệu.', 'Hiển thị empty state đúng, không lỗi layout.', '', ''),
    row('Kiểm tra lọc theo trạng thái', `Chọn trạng thái: ${m.statuses}.`, 'Danh sách chỉ hiển thị phiếu đúng trạng thái.', '', ''),
    row('Kiểm tra lọc theo thời gian', 'Chọn từ ngày/đến ngày > Lọc.', 'Danh sách chỉ hiển thị phiếu trong khoảng ngày đã chọn.', '', ''),
    row('Kiểm tra lọc theo đối tượng/kho/người tạo', `Chọn bộ lọc nghiệp vụ: ${m.filters}.`, 'Kết quả đúng theo điều kiện lọc.', '', ''),
    row('Kiểm tra kết hợp nhiều bộ lọc', `Kết hợp thời gian + trạng thái + ${m.filters}.`, 'Kết quả thỏa tất cả điều kiện; export cũng giữ filter.', '', ''),
    row('Kiểm tra tìm kiếm theo mã phiếu', 'Nhập mã phiếu có tồn tại vào ô tìm kiếm > Enter.', 'Hiển thị đúng phiếu khớp mã.', m.searchSample || ''),
    row('Kiểm tra tìm kiếm không có kết quả', 'Nhập mã phiếu không tồn tại.', 'Danh sách rỗng, không lỗi.', 'NO_DOC_999999'),
    row('Kiểm tra mở màn hình tạo phiếu', `Nhấn ${m.createButton || 'Tạo mới'}.`, `Mở màn hình tạo ${m.name}, có các trường: ${m.fields}.`, '', ''),
    row('Validate thiếu thông tin bắt buộc', `Tạo phiếu nhưng bỏ trống: ${m.required}. > Lưu/Hoàn thành.`, 'Không tạo phiếu; hiển thị lỗi bắt buộc.', '', ''),
    row('Validate chưa có dòng hàng hóa', 'Mở form tạo phiếu > nhập thông tin chung > không thêm hàng > Lưu/Hoàn thành.', 'Không tạo phiếu; thông báo cần thêm hàng hóa/dòng chi tiết.', '', ''),
    row('Validate số lượng bằng 0', 'Thêm hàng hóa > nhập số lượng = 0 > Lưu/Hoàn thành.', 'Không cho lưu dòng số lượng 0.', 'Số lượng: 0'),
    row('Validate số lượng âm', 'Thêm hàng hóa > nhập số lượng âm > Lưu/Hoàn thành.', 'Không cho lưu dòng số lượng âm.', 'Số lượng: -1'),
    row('Validate đơn giá/giá trị âm', 'Nhập đơn giá hoặc giảm giá âm.', 'Không cho lưu giá trị âm hoặc tính toán sai.', 'Đơn giá: -1000'),
    row('Kiểm tra chọn hàng hóa từ dropdown/API', `Tìm/chọn hàng hóa trong form tạo phiếu.`, `Dropdown/API lấy dữ liệu đúng từ ${m.productApi || '/api/hang-hoa hoặc API kho liên quan'}, chỉ hiển thị hàng hợp lệ.`, '', ''),
    row('Kiểm tra hàng hóa quản lý theo lô/quy cách', 'Chọn hàng quản lý theo lô/quy cách > chọn lô/quy cách > nhập số lượng.', 'Dòng hàng lưu đúng lô/quy cách, tồn kho tính theo đúng cấp tồn.', '', 'Áp dụng khi hàng có quản lý lô/quy cách.'),
    row('Kiểm tra tính thành tiền từng dòng', 'Nhập số lượng, đơn giá, giảm giá nếu có.', 'Thành tiền từng dòng tính đúng theo công thức trên UI/server.', 'SL 2, đơn giá 50.000, giảm 0'),
    row('Kiểm tra tổng tiền phiếu', 'Thêm nhiều dòng hàng > kiểm tra tổng số lượng/tổng tiền/tổng thanh toán.', 'Tổng phiếu bằng tổng các dòng và các khoản giảm/phí/thanh toán.', '', ''),
    row('Kiểm tra lưu nháp nếu có', 'Tạo phiếu ở chế độ nháp/draft nếu UI hỗ trợ.', 'Phiếu tạo trạng thái draft, chưa tác động tồn/công nợ nếu nghiệp vụ yêu cầu.', '', 'Nếu UI không có draft thì bỏ qua.'),
    row('Kiểm tra tạo/hoàn thành phiếu thành công', `Nhập dữ liệu hợp lệ: ${m.sample}. > Lưu/Hoàn thành.`, 'Phiếu được tạo, có mã tự sinh, xuất hiện ở danh sách và chi tiết.', m.sample),
    row('Kiểm tra tác động tồn kho sau khi hoàn thành', 'Ghi nhận tồn trước > hoàn thành phiếu > kiểm tra tồn sau.', m.inventoryExpected, '', ''),
    row('Kiểm tra tác động công nợ/thanh toán', 'Tạo phiếu có thanh toán một phần/toàn phần > kiểm tra công nợ và sổ quỹ.', m.debtExpected || 'Công nợ/sổ quỹ cập nhật đúng theo phiếu.', '', ''),
    row('Kiểm tra tạo phiếu với thanh toán tiền mặt', 'Chọn sổ tiền mặt > nhập tiền thanh toán > Hoàn thành.', 'Tạo phiếu thu/chi tương ứng trong Sổ quỹ, số dư sổ quỹ thay đổi đúng.', '', 'Áp dụng nếu màn hình có thanh toán.'),
    row('Kiểm tra tạo phiếu với chuyển khoản', 'Chọn tài khoản chuyển khoản > nhập tiền chuyển khoản > Hoàn thành.', 'Tạo phiếu thu/chi đúng sổ chuyển khoản, không ghi nhầm sổ tiền mặt.', '', 'Áp dụng nếu màn hình có thanh toán.'),
    row('Validate thanh toán vượt tổng tiền', 'Nhập số tiền thanh toán vượt tổng tiền nếu nghiệp vụ không cho phép.', 'Hệ thống chặn hoặc xử lý tiền thừa đúng rule; không sai công nợ.', '', 'Cần xác nhận nghiệp vụ tiền thừa từng phiếu.'),
    row('Kiểm tra xem chi tiết phiếu', 'Click mã phiếu trong danh sách.', `Chi tiết hiển thị thông tin chung, dòng hàng, trạng thái, tổng tiền, tab/chức năng: ${m.tabs || 'Thông tin'}.`, '', ''),
    row('Kiểm tra chỉnh sửa/lưu chi tiết phiếu', 'Mở chi tiết phiếu còn được sửa > thay đổi ghi chú/thông tin cho phép > Lưu.', 'Thông tin được cập nhật; các trường khóa theo trạng thái không sửa được.', '', ''),
    row('Kiểm tra hủy phiếu', 'Mở phiếu đã hoàn thành > nhấn Hủy > xác nhận.', 'Trạng thái chuyển cancelled; tồn kho/công nợ/sổ quỹ được đảo đúng nếu source hỗ trợ.', '', ''),
    row('Kiểm tra không hủy lặp phiếu đã hủy', 'Mở phiếu trạng thái cancelled > nhấn Hủy lại hoặc gọi API hủy lại.', 'Không phát sinh đảo tồn/công nợ lần 2; hiển thị thông báo phù hợp.', '', ''),
    row('Kiểm tra sao chép phiếu nếu có', 'Mở chi tiết phiếu > nhấn Sao chép.', 'Mở form tạo mới với dữ liệu copy; mã phiếu mới; chưa lưu khi chưa xác nhận.', '', 'Nếu UI không có sao chép thì bỏ qua.'),
    row('Kiểm tra gộp phiếu nếu có', 'Chọn nhiều phiếu đủ điều kiện > nhấn gộp.', 'Phiếu nhận chứa đúng dữ liệu, phiếu nguồn được đánh dấu merged, không nhân đôi tồn/công nợ.', '', m.mergeApi || 'Nếu UI/API không có gộp thì bỏ qua.'),
    row('Kiểm tra in/mở chứng từ', 'Mở chi tiết phiếu > nhấn In/Mở riêng/PDF.', 'Trang in/PDF hiển thị đúng mẫu, số liệu khớp phiếu.', '', m.printApi || ''),
    row('Kiểm tra export danh sách', `Từ danh sách ${m.name} > nhấn Xuất file.`, 'File tải về thành công, dữ liệu khớp filter hiện tại.', '', m.exportApi || ''),
    row('Kiểm tra export một phiếu', 'Mở chi tiết phiếu > nhấn Xuất file.', 'File một phiếu mở được, thông tin khớp chi tiết.', '', ''),
    row('Kiểm tra lỗi API/server khi lưu phiếu', 'Giả lập API tạo phiếu trả 500/mất mạng.', 'UI hiển thị lỗi, không tạo phiếu nửa vời, không thay đổi tồn kho.', '', 'Có thể test bằng devtool/proxy.'),
    row('Kiểm tra phân quyền', `Đăng nhập user không phải admin hoặc inactive > truy cập ${m.url}.`, 'Bị chặn theo middleware admin active.', 'user inactive/non-admin', 'Source hiện route chính yêu cầu admin active.')
  ];
  return rows;
}

function reportCases(m) {
  return [
    row('Kiểm tra truy cập báo cáo', `Đăng nhập admin active > vào menu ${m.menu}.`, `Hiển thị báo cáo ${m.name}, URL ${m.url}.`, 'admin active'),
    row('Kiểm tra bố cục bộ lọc', 'Quan sát sidebar/filter báo cáo.', `Hiển thị các bộ lọc: ${m.filters}.`, '', ''),
    row('Kiểm tra dữ liệu mặc định', 'Mở báo cáo không truyền query.', 'Báo cáo tải được dữ liệu mặc định, không lỗi 500.', '', ''),
    row('Lọc theo khoảng ngày hợp lệ', 'Chọn from/to hợp lệ > Lọc.', 'Số liệu chỉ tính trong khoảng ngày.', 'from/to trong tháng hiện tại'),
    row('Validate từ ngày lớn hơn đến ngày', 'Chọn from > to > Lọc.', 'Hệ thống không lỗi; nếu vẫn trả dữ liệu cần xác nhận rule xử lý ngày đảo.', '', 'Cần xác nhận nghiệp vụ.'),
    row('Lọc theo cửa hàng/kho nếu có', 'Chọn cửa hàng/kho > Lọc.', 'Số liệu chỉ gồm dữ liệu thuộc cửa hàng/kho được chọn.', '', 'Source có currentStore và một số báo cáo có kho.'),
    row('Lọc theo đối tượng/hàng hóa', `Nhập/chọn ${m.objectFilter || 'keyword/đối tượng'} > Lọc.`, 'Báo cáo chỉ hiển thị dòng khớp điều kiện.', '', ''),
    row('Kết hợp nhiều bộ lọc', `Kết hợp ngày + ${m.filters}.`, 'Số liệu thỏa đồng thời tất cả điều kiện.', '', ''),
    row('Reset/bỏ lọc', 'Áp dụng filter > nhấn Bỏ lọc/Xóa lọc.', 'Báo cáo trở về mặc định; URL query được reset.', '', ''),
    row('Kiểm tra tổng hợp số liệu', 'Tạo chứng từ nguồn đã biết số tiền/số lượng > mở báo cáo.', `Các chỉ tiêu ${m.metrics} khớp chứng từ phát sinh.`, 'Dữ liệu seed thủ công'),
    row('Kiểm tra dòng tổng cộng', 'Mở báo cáo có nhiều dòng > đối chiếu dòng tổng.', 'Tổng cộng bằng tổng các dòng chi tiết.', '', ''),
    row('Kiểm tra dữ liệu khi không có chứng từ', 'Lọc khoảng ngày không có chứng từ.', 'Hiển thị 0/empty state, không lỗi chia cho 0.', '', ''),
    row('Kiểm tra số âm/phiếu hủy', 'Tạo phiếu hủy/trả hàng trong kỳ > mở báo cáo.', 'Phiếu hủy không làm tăng số liệu; phiếu trả hàng giảm đúng chỉ tiêu nếu báo cáo có tính trả.', '', 'Cần đối chiếu từng report service.'),
    row('Kiểm tra drill-down/expand nếu có', 'Nhấn dòng ngày/mã/toggle + nếu UI hỗ trợ.', 'Hiển thị chi tiết đúng dòng tổng, không lệch số liệu.', '', 'Nếu không có drill-down thì bỏ qua.'),
    row('Kiểm tra chế độ biểu đồ/báo cáo nếu có', 'Chuyển giữa Biểu đồ và Báo cáo.', 'Hai chế độ hiển thị cùng bộ lọc, số liệu nhất quán.', '', 'Áp dụng báo cáo KH/NCC.'),
    row('Kiểm tra export CSV/XLSX', `Nhấn export: ${m.exportApi}.`, 'File tải thành công, mở được, không lỗi encoding tiếng Việt.', '', ''),
    row('Kiểm tra dữ liệu file export', 'Export với filter đã chọn > mở file > đối chiếu UI.', 'File export giữ đúng filter, cột và tổng số liệu khớp UI.', '', ''),
    row('Kiểm tra in/print/PDF nếu có', 'Nhấn in hoặc export PDF nếu màn hình có.', 'Bản in/PDF đúng mẫu, không mất cột quan trọng.', '', m.printApi || ''),
    row('Kiểm tra phân quyền', `Đăng nhập user không phải admin hoặc inactive > truy cập ${m.url}.`, 'Bị chặn theo middleware admin active.', 'user inactive/non-admin', 'Source hiện route báo cáo dùng isAuthenticated.'),
    row('Kiểm tra lỗi API/server', 'Giả lập API report/export trả 500.', 'UI hiển thị lỗi hoặc trang lỗi có thông điệp; không tải file lỗi rỗng.', '', '')
  ];
}

const modules = [
  {
    type: 'master', name: 'Khách hàng', menu: 'Khách hàng', url: '/khach-hang',
    columns: 'checkbox, Mã KH, Tên khách hàng, Điện thoại, Nhóm, Tổng bán, Tổng nợ, Thời gian tạo',
    fields: 'mã KH, loại khách hàng, tên khách hàng/tên cá nhân/tên công ty, SĐT, email, MST/CCCD, nhóm KH, địa chỉ, ghi chú, trạng thái',
    required: 'tên khách hàng', filters: 'nhóm khách hàng, trạng thái, keyword, thời gian tạo', tabs: 'Thông tin khách hàng, Danh sách địa chỉ, Lịch sử mua/trả, Công nợ',
    sample: 'Tên KH: Nguyễn Văn Test; SĐT: 0901234567', duplicate: 'ma_khach_hang trùng',
    exportApi: 'GET /khach-hang/export.xlsx; GET /khach-hang/:id/export.xlsx; GET /khach-hang/:id/export/:section.xlsx', importApi: 'GET /khach-hang/import/template.xlsx; POST /khach-hang/import', bulkDelete: true
  },
  {
    type: 'master', name: 'Nhà cung cấp', menu: 'Mua hàng > Nhà cung cấp', url: '/nha-cung-cap',
    columns: 'checkbox, Mã NCC, Tên NCC, Điện thoại, Email, Công ty, Tổng mua, Tổng nợ, Trạng thái',
    fields: 'mã NCC, tên NCC, SĐT, email, tên công ty, mã số thuế, nhóm NCC, ghi chú, trạng thái, địa chỉ',
    required: 'tên nhà cung cấp', filters: 'nhóm NCC, trạng thái, keyword, nợ cần trả', tabs: 'Thông tin NCC, Danh sách địa chỉ, Lịch sử nhập/trả hàng, Nợ cần trả NCC, Xuất dùng nội bộ',
    sample: 'Tên NCC: NCC Test; SĐT: 0912345678', duplicate: 'ma_ncc hoặc nhóm/loại địa chỉ trùng',
    exportApi: 'GET /nha-cung-cap/export.xlsx; GET /nha-cung-cap/:id/export/:section', importApi: 'GET /nha-cung-cap/import/template.xlsx; POST /nha-cung-cap/import', bulkDelete: true
  },
  {
    type: 'master', name: 'Đối tác giao hàng', menu: 'Đơn hàng > Đối tác giao hàng', url: '/don-hang/doi-tac-giao-hang',
    columns: 'checkbox, Mã đối tác, Tên đối tác, SĐT, Email, Địa chỉ, Trạng thái',
    fields: 'mã đối tác, tên đối tác, SĐT, email, địa chỉ, ghi chú',
    required: 'tên đối tác giao hàng', filters: 'keyword, trạng thái', tabs: 'Thông tin đối tác/bảng giá vận chuyển nếu có',
    sample: 'Tên đối tác: GH Test; SĐT: 19001234', duplicate: 'ma_doi_tac trùng',
    exportApi: 'GET /don-hang/doi-tac-giao-hang/export.xlsx; GET /don-hang/doi-tac-giao-hang/:id/export.xlsx', importApi: '', bulkDelete: false
  },
  {
    type: 'master', name: 'Danh sách hàng hóa', menu: 'Hàng hóa > Danh sách hàng hóa', url: '/hang-hoa',
    columns: 'checkbox, Mã hàng, Tên hàng, Giá vốn trung bình, Giá bán trung bình, Tồn kho, Nhóm hàng, Nhà cung cấp, Thời gian tạo',
    fields: 'mã hàng, tên hàng, nhóm hàng, đơn vị tính, nhà cung cấp, giá vốn, loại giá, giá cố định, tồn ban đầu, tồn tối thiểu, bán trực tiếp, quản lý theo lô, hạn sử dụng mặc định, lô ban đầu, mô tả, trạng thái',
    required: 'tên hàng', filters: 'nhóm hàng, nhà cung cấp, tồn kho, thời gian tạo, liên kết bán hàng, trạng thái, keyword', tabs: 'Thông tin hàng hóa, tồn kho/lô, ghi chú, lợi nhuận theo lô',
    sample: 'Tên hàng: Hàng QA Test; Giá vốn: 10000; Giá bán: 15000', duplicate: 'ma_hang trùng',
    exportApi: 'POST /hang-hoa/export-excel; GET /hang-hoa/api/:id/loi-lo-theo-lo/export.xlsx', importApi: '', bulkDelete: true
  },
  {
    type: 'master', name: 'Thiết lập giá', menu: 'Hàng hóa > Thiết lập giá', url: '/hang-hoa/thiet-lap-gia',
    columns: 'Mã hàng, Tên hàng, Đơn vị, Giá bán lẻ, Các bảng giá',
    fields: 'bảng giá, tên bảng giá, sản phẩm, giá bán lẻ, giá theo bảng giá, giá theo quy cách/lô nếu có',
    required: 'tên bảng giá khi tạo bảng giá, giá hợp lệ khi cập nhật', filters: 'bảng giá, nhóm hàng, nhà cung cấp, keyword', tabs: 'Bảng giá, giá bán hàng hóa',
    sample: 'Bảng giá QA; Giá: 20000', duplicate: 'tên bảng giá/ma_bang_gia trùng',
    exportApi: '', importApi: '', bulkDelete: false
  },
  {
    type: 'master', name: 'Vật chứa', menu: 'Hàng hóa > Vật chứa hàng hóa', url: '/vat-chua',
    columns: 'checkbox, Mã vật chứa, Tên vật chứa, Tồn hiện tại, Giá vốn, Trạng thái',
    fields: 'mã vật chứa, tên vật chứa, số lượng tồn, giá vốn, trạng thái, nhập vật chứa, chứng từ liên quan',
    required: 'mã vật chứa, tên vật chứa', filters: 'keyword, trạng thái, tồn kho', tabs: 'Thông tin, lịch sử nhập/xuất, chứng từ liên quan',
    sample: 'Mã: VCQA001; Tên: Thùng QA', duplicate: 'ma_vat_chua hoặc ten_vat_chua trong cùng cửa hàng',
    exportApi: 'API detail: GET /vat-chua/api/:id/detail; document: GET /vat-chua/api/document/:kind/:id', importApi: 'POST /vat-chua/nhap', bulkDelete: true
  },
  {
    type: 'transaction', name: 'Nhập hàng', menu: 'Mua hàng > Nhập hàng', url: '/nhap-hang',
    columns: 'checkbox, Mã phiếu nhập, Nhà cung cấp, Kho, Thời gian, Tổng tiền, Đã trả, Còn nợ, Trạng thái',
    fields: 'nhà cung cấp, kho, ngày nhập, hàng hóa, lô/quy cách, số lượng, đơn giá nhập, giảm giá, thanh toán, sổ quỹ, ghi chú, vật chứa',
    required: 'nhà cung cấp, kho, ít nhất một hàng hóa, số lượng > 0', filters: 'nhà cung cấp, kho, trạng thái, thời gian, người tạo', statuses: 'draft, completed, cancelled, merged',
    sample: 'NCC Test; Kho mặc định; Hàng QA; SL 10; Đơn giá 10000', productApi: 'GET /api/hang-hoa; GET /nhap-hang/api/nha-cung-cap/:id/hang-hoa; POST /api/hang-hoa/quick-create',
    inventoryExpected: 'Tồn kho tăng theo số lượng nhập; lô/quy cách được tạo/cộng đúng.', debtExpected: 'NCC tăng tổng mua/tổng nợ; thanh toán tạo phiếu chi nếu có.',
    exportApi: 'GET /nhap-hang/:id/export.xlsx; GET /nhap-hang/:id/export.csv', printApi: 'GET /nhap-hang/:id/in; /in/pdf; /in-tong-hop; /bang-ke-02-tndn; /hd-mua-ban-nguyen-tac', mergeApi: 'POST /nhap-hang/gop-phieu-nhap'
  },
  {
    type: 'transaction', name: 'Trả hàng nhập', menu: 'Mua hàng > Trả hàng nhập', url: '/tra-hang-nhap',
    columns: 'Mã phiếu trả nhập, Nhà cung cấp, Kho, Ngày trả, Tổng tiền trả, Trạng thái',
    fields: 'kho, phiếu nhập, nhà cung cấp, hàng trả, lô/quy cách, số lượng trả, đơn giá, thanh toán hoàn tiền, sổ quỹ, ghi chú, vật chứa',
    required: 'kho, phiếu nhập/hàng trả, số lượng > 0', filters: 'nhà cung cấp, kho, trạng thái, thời gian', statuses: 'draft, completed, cancelled',
    sample: 'Phiếu nhập còn hàng; trả SL 1', productApi: 'GET /api/phieu-nhap; GET /api/kho/:khoId/phieu-nhap; GET /api/phieu-nhap/:id/chi-tiet-tra-hang',
    inventoryExpected: 'Tồn kho giảm đúng hàng/lô/quy cách đã trả; không cho trả vượt tồn/còn lại.', debtExpected: 'Công nợ NCC giảm hoặc tạo phiếu thu tiền nhà cung cấp hoàn nếu có.',
    exportApi: 'GET /tra-hang-nhap/export.csv; /export.xlsx; /:id/export.xlsx', printApi: 'GET /tra-hang-nhap/:id/in; /:id/in/pdf'
  },
  {
    type: 'transaction', name: 'Kiểm kho', menu: 'Hàng hóa > Kiểm kho', url: '/kiem-kho',
    columns: 'Mã kiểm kho, Kho, Ngày kiểm, Tổng SL thực tế, Tổng SL lệch, Giá trị lệch, Trạng thái',
    fields: 'kho, ngày kiểm, hàng hóa, lô/quy cách, tồn hệ thống, tồn thực tế, số lượng lệch, ghi chú',
    required: 'kho, ít nhất một hàng hóa kiểm, số lượng thực tế hợp lệ', filters: 'kho, trạng thái, thời gian, keyword', statuses: 'pending, completed, cancelled',
    sample: 'Kho mặc định; Hàng QA; Tồn thực tế 8', productApi: 'GET /api/kho/:id/hang-kiem-kho; POST /kiem-kho/preview-ton-he-thong; POST /kiem-kho/preview-gia-tri-kho',
    inventoryExpected: 'Tồn kho điều chỉnh về số lượng thực tế khi hoàn thành; lịch sử kho ghi nhận chênh lệch.', debtExpected: 'Không phát sinh công nợ; giá trị lệch được tính theo giá vốn.',
    exportApi: 'GET /kiem-kho/export.csv; POST /kiem-kho/export-excel; GET /kiem-kho/:id/export.csv', printApi: 'GET /kiem-kho/in-ton-he-thong-preview; /in-gia-tri-kho-preview'
  },
  {
    type: 'transaction', name: 'Xuất dùng nội bộ', menu: 'Hàng hóa > Xuất dùng nội bộ', url: '/xuat-dung-noi-bo',
    columns: 'Mã xuất nội bộ, Ngày xuất, Kho, Loại xuất, Người nhận, Tổng SL, Tổng giá trị, Trạng thái',
    fields: 'kho, ngày xuất, loại xuất, loại người nhận, người nhận, hàng hóa, lô/quy cách, số lượng, đơn giá vốn, vật chứa, cộng dồn vào thẻ, ghi chú',
    required: 'kho, loại xuất/người nhận theo rule, ít nhất một hàng hóa, số lượng > 0', filters: 'kho, loại xuất, người nhận, trạng thái, thời gian', statuses: 'draft, completed, cancelled',
    sample: 'Kho mặc định; Loại xuất: dùng nội bộ; Hàng QA; SL 1', productApi: 'GET /xuat-dung-noi-bo/api/san-pham; GET /xuat-dung-noi-bo/api/vat-chua',
    inventoryExpected: 'Tồn kho giảm đúng số lượng xuất; không cho xuất vượt tồn.', debtExpected: 'Không phát sinh công nợ bán/mua; có thể ghi nhận vật chứa nếu chọn.',
    exportApi: 'GET /xuat-dung-noi-bo/export.csv; /export.xlsx; /:id/export.xlsx'
  },
  {
    type: 'transaction', name: 'Xuất hủy', menu: 'Hàng hóa > Xuất hủy', url: '/xuat-huy',
    columns: 'Mã xuất hủy, Ngày xuất, Kho, Lý do hủy, Tổng SL, Tổng giá trị, Trạng thái',
    fields: 'kho, ngày xuất, lý do hủy, hàng hóa, lô/quy cách, số lượng, giá vốn, ghi chú',
    required: 'kho, lý do hủy, ít nhất một hàng hóa, số lượng > 0', filters: 'kho, trạng thái, thời gian, keyword', statuses: 'draft, completed, cancelled',
    sample: 'Kho mặc định; Lý do: hỏng; Hàng QA; SL 1', productApi: 'GET /api/phieu-nhap/con-hang-xuat-huy; GET /api/kho/:khoId/hang-xuat-huy; GET /api/xuat-huy/lo-hang/:loHangId/quy-cach-ton',
    inventoryExpected: 'Tồn kho giảm; hàng quản lý lô/quy cách bắt buộc chọn lô/quy cách và không vượt tồn.', debtExpected: 'Không phát sinh công nợ; giá trị hủy ghi nhận theo giá vốn.',
    exportApi: 'GET /xuat-huy/export.xlsx; GET /xuat-huy/:id/export.xlsx'
  },
  {
    type: 'transaction', name: 'Đặt hàng', menu: 'Đơn hàng > Đặt hàng', url: '/don-hang',
    columns: 'Mã đơn hàng, Thời gian, Khách hàng, Tổng tiền, Khách đã trả, Trạng thái, Trạng thái giao hàng',
    fields: 'khách hàng, kho, hàng hóa, lô/quy cách nếu có, số lượng đặt/xác nhận, đơn giá, giảm giá, thanh toán, giao hàng, vật chứa, ghi chú',
    required: 'khách hàng hoặc thông tin người nhận theo rule, kho, ít nhất một hàng hóa, số lượng > 0', filters: 'trạng thái, trạng thái giao, khách hàng, người tạo, thời gian', statuses: 'trạng thái đơn hàng source dạng string; giao hàng: chua_giao, giao_mot_phan, giao_thieu, giao_du',
    sample: 'Khách QA; Hàng QA; SL đặt 2', productApi: 'GET /api/kho/:id/hang-ban-hang; GET /api/hang-hoa/:id/gia',
    inventoryExpected: 'Đơn đặt hàng giữ/ảnh hưởng số lượng khách đã đặt; xác nhận giao cập nhật so_luong_da_giao/con_thieu.', debtExpected: 'Thanh toán trước tạo phiếu thu và công nợ khách hàng theo rule.',
    exportApi: 'GET /don-hang/export.csv; /export.xlsx; GET /don-hang/:id/export.xlsx', mergeApi: 'POST /don-hang/gop-don'
  },
  {
    type: 'transaction', name: 'Hóa đơn', menu: 'Đơn hàng > Hóa đơn', url: '/don-hang/hoa-don',
    columns: 'Mã hóa đơn, Thời gian, Khách hàng, Tổng tiền, Khách đã trả, Trạng thái, Giao hàng/COD',
    fields: 'khách hàng, kho, hàng hóa, số lượng, tồn/khả dụng, đơn giá, giảm giá, thanh toán tiền mặt/chuyển khoản, đối tác giao hàng, phí giao, vật chứa',
    required: 'kho, ít nhất một hàng hóa, số lượng > 0, thanh toán hợp lệ', filters: 'trạng thái, khách hàng, người bán, thời gian, giao hàng', statuses: 'completed, cancelled, merged/source string',
    sample: 'Khách QA; Hàng QA; SL 1; Tiền mặt đủ', productApi: 'GET /api/kho/:id/hang-ban-hang; GET /api/hang-hoa/:id/gia; GET /api/so-quy/active',
    inventoryExpected: 'Tồn kho giảm ngay khi hóa đơn hoàn thành; không bán vượt tồn khả dụng.', debtExpected: 'Phiếu thu tạo trong sổ quỹ; công nợ khách tăng/giảm theo số đã thanh toán.',
    exportApi: 'GET /don-hang/hoa-don/export.csv; /export.xlsx; GET /don-hang/hoa-don/:id/export.xlsx', mergeApi: 'POST /don-hang/gop-hoa-don'
  },
  {
    type: 'transaction', name: 'Trả hàng', menu: 'Đơn hàng > Trả hàng', url: '/don-hang/tra-hang',
    columns: 'Loại, Mã trả hàng, Người bán, Thời gian, Mã KH, Khách hàng, Hàng trả, Hàng đổi, Cần thu/trả, Trạng thái',
    fields: 'hóa đơn nguồn, loại trả hàng, hàng trả, hàng đổi, số lượng, giá trả, giảm giá, phí trả hàng, tiền cần trả/thu, phương thức nhận trả, giao hàng trả, vật chứa',
    required: 'hóa đơn hoặc hàng trả theo rule, ít nhất một hàng trả/đổi, số lượng > 0', filters: 'loại trả hàng, trạng thái, thời gian, người tạo, người nhận trả, kênh bán', statuses: 'completed, cancelled; loại: theo_hoa_don, tra_nhanh, chuyen_hoan',
    sample: 'Hóa đơn đã bán; trả 1 sản phẩm', productApi: 'GET /don-hang/tra-hang/invoices/search; GET /don-hang/tra-hang/:id/detail',
    inventoryExpected: 'Hàng trả nhập lại tồn; hàng đổi trừ tồn nếu có; không trả vượt số lượng hóa đơn.', debtExpected: 'Tiền trả khách/thu thêm cập nhật công nợ và sổ quỹ đúng.',
    exportApi: 'GET /don-hang/tra-hang/export.csv; /export.xlsx; GET /don-hang/tra-hang/:id/export.xlsx'
  },
  {
    type: 'master', name: 'Chấm công mới', menu: 'Chấm công mới', url: '/chamcongmoi',
    columns: 'Nhân viên, tuần/ngày, giờ vào, giờ ra, trạng thái, lương/công nếu có',
    fields: 'nhân viên, tuần/tháng, giờ vào, giờ ra, trạng thái, ghi chú, bảng lương, thanh toán lương',
    required: 'nhân viên và dữ liệu chấm công theo ô/ngày', filters: 'nhân viên, tuần/tháng, trạng thái', tabs: 'Nhân viên, tuần chấm công, bảng lương/thanh toán',
    sample: 'NV QA; Giờ vào 08:00; Giờ ra 17:00', duplicate: 'bảng lương unique theo nhân viên/tháng/loại',
    exportApi: '', importApi: '', bulkDelete: false
  },
  {
    type: 'master', name: 'Sổ quỹ', menu: 'Sổ quỹ', url: '/so-quy',
    columns: 'Mã phiếu, Ngày lập, Loại thu/chi, Sổ quỹ, Đối tượng, Giá trị, Hạch toán, Trạng thái',
    fields: 'sổ quỹ, loại phiếu thu/chi, ngày lập, đối tượng, giá trị, phương thức thanh toán, chứng từ liên quan, ghi chú, hạch toán',
    required: 'sổ quỹ, loại phiếu, giá trị hợp lệ', filters: 'loại phiếu, loại sổ quỹ, thời gian, đối tượng, chứng từ liên quan', tabs: 'Chi tiết phiếu, chứng từ liên quan, in tổng hợp',
    sample: 'Phiếu thu 100000 vào sổ tiền mặt', duplicate: 'ma_phieu tự sinh unique',
    exportApi: 'GET /so-quy/export.csv; GET /so-quy/:id/in-phieu; /in-phieu/pdf; /in-tong-hop; /in-chung-tu-lien-quan', importApi: '', bulkDelete: false
  },
  {
    type: 'report', name: 'Báo cáo', menu: 'Báo cáo', url: '/bao-cao',
    filters: 'loại báo cáo, thời gian, cửa hàng/kho, khách hàng, nhà cung cấp, hàng hóa/keyword tùy báo cáo',
    objectFilter: 'khách hàng/NCC/hàng hóa/keyword', metrics: 'doanh thu, giá trị trả, doanh thu thuần, công nợ, tồn kho, lợi nhuận',
    exportApi: 'GET /bao-cao/cuoi-ngay/export.csv; /ban-hang/export.csv; /dat-hang/export.csv; /khach-hang/export.csv; /nha-cung-cap/export.csv; /loi-nhuan-lo/export.csv',
    printApi: 'window.print trên các viewer báo cáo'
  },
  {
    type: 'report', name: 'Báo cáo 58', menu: 'Báo cáo 58', url: '/bao-cao/58',
    filters: 'kỳ báo cáo, ngày từ/đến, mẫu/sổ, cửa hàng, dữ liệu vật tư/thanh toán',
    objectFilter: 'mẫu báo cáo/sổ/kỳ', metrics: 'dòng vật tư, nhập, xuất, tồn, chứng từ thanh toán, sổ/ledger theo Thông tư 58',
    exportApi: 'GET /bao-cao/58/export.csv; /58/export.xlsx; /58/preview/excel',
    printApi: 'GET /bao-cao/58/preview.pdf; /58/export.pdf'
  }
];

async function main() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Codex QA Analyst';
  workbook.created = new Date();

  modules.forEach((m) => {
    const ws = workbook.addWorksheet(m.name.substring(0, 31));
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    const cases = m.type === 'transaction' ? transactionCases(m) : (m.type === 'report' ? reportCases(m) : masterCases(m));
    rowsWithIds(cases).forEach((r) => ws.addRow(r));

    ws.addRow([]);
    const start = ws.rowCount + 1;
    ws.addRow(['Thông tin chức năng đã phát hiện']);
    ws.getRow(start).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(start).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF548235' } };
    const info = [
      ['Menu/URL', `${m.menu}: ${m.url}`],
      ['Các nút chính', m.type === 'report' ? 'Lọc, Bỏ lọc, Export, In/PDF nếu có' : 'Tạo mới/Thêm mới, Lưu, Bỏ qua, Chỉnh sửa, Xóa, Xóa đã chọn nếu có, Export/Import nếu có, In/Sao chép/Gộp nếu có'],
      ['Các trường dữ liệu', m.fields || 'Theo bộ lọc và bảng báo cáo'],
      ['Các bộ lọc', m.filters || 'Keyword/trạng thái/thời gian nếu có'],
      ['API liên quan', [m.exportApi, m.importApi, m.productApi, m.printApi, m.mergeApi].filter(Boolean).join('; ') || 'Xem route/controller tương ứng trong source'],
      ['Ràng buộc nghiệp vụ', m.inventoryExpected || m.debtExpected || 'Dữ liệu theo cửa hàng hiện tại; route yêu cầu admin active; các mã unique theo schema nếu có.'],
      ['Điểm cần xác nhận thêm', 'Thông báo chính xác từng lỗi, rule format SĐT/MST/email chi tiết, trạng thái nghiệp vụ hiển thị theo BA/dev nếu source chưa mô tả đầy đủ.']
    ];
    info.forEach((r) => ws.addRow(['', r[0], r[1]]));

    ws.columns = [
      { width: 8 }, { width: 34 }, { width: 58 }, { width: 58 }, { width: 14 }, { width: 34 }, { width: 42 }
    ];
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          left: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          bottom: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          right: { style: 'thin', color: { argb: 'FFD9E2F3' } }
        };
      });
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: 'G1' };
  });

  const output = path.join(__dirname, '..', 'docs', 'QA_Testcases_SourceCode_2026-07-09.xlsx');
  await workbook.xlsx.writeFile(output);
  console.log(output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
