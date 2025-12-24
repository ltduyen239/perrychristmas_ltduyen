# 🎄 Duyên xinh đẹp – Giáng Sinh Vui Vẻ 🎄

> Một ứng dụng Web cây thông Noel 3D có độ chân thực cao, được xây dựng dựa trên **React**, **Three.js (R3F)** và **AI nhận diện cử chỉ tay**.

Dự án này không chỉ đơn thuần là một cây thông Noel — mà là một **phòng trưng bày ký ức mang tính tương tác**.  
Hàng trăm nghìn hạt ánh sáng, những dải đèn rực rỡ và các bức ảnh Polaroid lơ lửng kết hợp lại tạo nên một cây thông Noel sang trọng.  
Người dùng có thể **điều khiển hình dạng cây (tụ lại / tách ra)** và **xoay góc nhìn** bằng cử chỉ tay, mang đến trải nghiệm thị giác đậm chất điện ảnh.

![Project Preview](public/preview.png)  
*(Gợi ý: nên thay bằng ảnh chụp màn hình thực tế của dự án)*

---

## ✨ Tính năng nổi bật

- **Trải nghiệm hình ảnh đỉnh cao**: Thân cây được tạo từ hơn **45.000 hạt phát sáng**, kết hợp hiệu ứng Bloom và Glow tạo nên không gian huyền ảo.
- **Thư viện ký ức**: Ảnh được hiển thị theo phong cách **Polaroid** lơ lửng trên cây, mỗi ảnh là một vật thể phát sáng riêng biệt, hỗ trợ render hai mặt.
- **Điều khiển bằng cử chỉ AI**: Không cần chuột, chỉ cần camera để điều khiển hình dạng cây (tụ lại / tách ra) và góc nhìn.
- **Chi tiết phong phú**: Đèn nhấp nháy động, tuyết vàng – bạc rơi, quà Giáng sinh và kẹo trang trí được phân bố ngẫu nhiên.
- **Khả năng tùy biến cao**: **Dễ dàng thay thế ảnh cá nhân và tự do điều chỉnh số lượng ảnh.**

---

## 🛠️ Công nghệ sử dụng

- **Framework**: React 18, Vite  
- **3D Engine**: React Three Fiber (Three.js)  
- **Thư viện hỗ trợ**: @react-three/drei, Maath  
- **Hậu kỳ hình ảnh**: @react-three/postprocessing  
- **AI thị giác**: MediaPipe Tasks Vision (Google)

---

## 🚀 Bắt đầu nhanh

### 1. Chuẩn bị môi trường
Đảm bảo máy bạn đã cài đặt [Node.js](https://nodejs.org/) (khuyến nghị **v18 trở lên**).

### 2. Cài đặt dependencies
Mở terminal tại thư mục gốc của dự án và chạy:
```bash
npm install
```

### 3. Chạy dự án
```bash
npm run dev
```

---

## 🖼️ Tùy chỉnh ảnh cá nhân

### 1. Chuẩn bị ảnh
Tìm thư mục:
```
public/photos/
```

- **Ảnh đỉnh / ảnh bìa**: đặt tên `top.jpg`  
  (hiển thị trên ngôi sao 3D ở đỉnh cây)
- **Ảnh thân cây**: đặt tên `1.jpg`, `2.jpg`, `3.jpg`, … theo thứ tự

📌 Khuyến nghị:
- Ảnh tỷ lệ **vuông** hoặc **4:3**
- Dung lượng mỗi ảnh **≤ 500kb** để đảm bảo hiệu năng mượt

### 2. Thay ảnh
Chỉ cần sao chép ảnh của bạn vào thư mục `public/photos/` và **ghi đè ảnh cũ**.  
⚠️ Giữ nguyên định dạng tên file (`1.jpg`, `2.jpg`, …).

### 3. Thay đổi số lượng ảnh
Nếu bạn thêm nhiều ảnh hơn (ví dụ từ 31 lên 100 ảnh), cần chỉnh sửa code:

Mở file:
```
src/App.tsx
```

Tìm đoạn (khoảng dòng 19):

```ts
// --- Tạo danh sách ảnh động (top.jpg + 1.jpg đến 31.jpg) ---
const TOTAL_NUMBERED_PHOTOS = 31; // <--- Thay đổi số này!
```

---

## 🖐️ Hướng dẫn điều khiển bằng cử chỉ

> **Dự án tích hợp hệ thống AI nhận diện cử chỉ tay.  
Hãy đứng trước webcam để điều khiển (có nút DEBUG ở góc phải dưới để xem camera).**

| Cử chỉ | Hành động | Hiệu ứng |
|------|---------|--------|
| 🖐 Mở bàn tay (Open Palm) | Tách ra (Disperse) | Cây thông bung ra thành các hạt và ảnh bay |
| ✊ Nắm tay (Closed Fist) | Tụ lại (Assemble) | Tất cả hợp lại thành cây thông hoàn chỉnh |
| 👋 Di chuyển tay trái / phải | Xoay góc nhìn | Tay trái → cây xoay trái, tay phải → xoay phải |
| 👋 Di chuyển tay lên / xuống | Thay đổi góc nhìn | Tay lên → góc nhìn cao, tay xuống → thấp |

---

## ⚙️ Cấu hình nâng cao

Nếu bạn quen thuộc với code, có thể chỉnh trong `src/App.tsx` (object `CONFIG`):

```ts
const CONFIG = {
  colors: { ... }, // Thay đổi màu cây, đèn, khung ảnh
  counts: {
    foliage: 15000,   // Số hạt lá (cấu hình thấp có thể giảm hiệu ứng)
    ornaments: 300,   // Số ảnh / Polaroid
    lights: 400       // Số lượng đèn
  },
  tree: { height: 22, radius: 9 }, // Kích thước cây
  // ...
};
```

---

## 📄 Giấy phép
MIT License. Bạn có thể tự do sử dụng và chỉnh sửa cho các dịp lễ, đặc biệt là Giáng Sinh 🎄

---

### 🎄✨ Duyên xinh đẹp – Giáng Sinh An Lành & Năm Mới Vui Vẻ!
