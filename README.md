# ระบบบันทึกรายรับ-รายจ่าย (Income & Expense Tracker)
> พัฒนาขึ้นตามมาตรฐานวิศวกรรมซอฟต์แวร์ระดับสากล (Software Engineering Skills 01 - 10)  
> ขับเคลื่อนด้วย **Cloudflare Workers**, **Cloudflare D1 Database** และ **Google Identity Services (OAuth 2.0)**  
> ดีไซน์หน้าบ้านสไตล์ **Dribbble/Figma Quality Dual-Tone Financial Dashboard (Dark Sidebar + Crisp Content)** พร้อม **Financial Calculator** ในตัว

---

## 📑 สารบัญ (Table of Contents)
1. [ภาพรวมสถาปัตยกรรมระบบ (System Architecture)](#1-ภาพรวมสถาปัตยกรรมระบบ-system-architecture)
2. [การปฏิบัติตามมาตรฐานวิศวกรรมซอฟต์แวร์ (Skills 01 - 10)](#2-การปฏิบัติตามมาตรฐานวิศวกรรมซอฟต์แวร์-skills-01---10)
3. [โครงสร้างฐานข้อมูล (Database Schema & D1 Migrations)](#3-โครงสร้างฐานข้อมูล-database-schema--d1-migrations)
4. [ข้อกำหนดสิทธิ์และการจัดการ Role (RBAC & Admin Policy)](#4-ข้อกำหนดสิทธิ์และการจัดการ-role-rbac--admin-policy)
5. [สารบัญ API (RESTful API Catalog)](#5-สารบัญ-api-restful-api-catalog)
6. [คู่มือการติดตั้งและรันระบบ (Setup & Deployment Guide)](#6-คู่มือการติดตั้งและรันระบบ-setup--deployment-guide)
7. [การทดสอบระบบ (Automated Testing & QA)](#7-การทดสอบระบบ-automated-testing--qa)

---

## 1. ภาพรวมสถาปัตยกรรมระบบ (System Architecture)

ระบบถูกออกแบบโดยแยกชั้นสถาปัตยกรรมอย่างเป็นระบบ (Layered Architecture & Separation of Concerns):

```
+-----------------------------------------------------------------------------+
|                 Modern Glassmorphic SPA Frontend (HTML5 / Tailwind / Chart.js)|
|                 - Google Identity Services (GSI) Button & Sign-In            |
|                 - CRUD Transactions UI, Date/Category Filters, CSV Export   |
|                 - Summary Dashboard & Interactive Category Donut/Trend Charts|
|                 - Protected Admin Panel View                                |
+---------------------------------------+-------------------------------------+
                                        | HTTP / REST (JWT Bearer Token)
+---------------------------------------v-------------------------------------+
|                      Cloudflare Workers (Edge Serverless API)               |
|  +-----------------------------------------------------------------------+  |
|  | [Middleware Layer]                                                    |  |
|  | - CORS Handler & Security Headers                                     |  |
|  | - Auth Middleware (HMAC-SHA256 JWT Verify via WebCrypto)              |  |
|  | - Role Middleware (RBAC: Admin Guard)                                 |  |
|  +-----------------------------------+-----------------------------------+  |
|                                      |                                      |
|  +-----------------------------------v-----------------------------------+  |
|  | [Controller / Routes Layer]                                           |  |
|  | - /api/auth/*        (Google Tokeninfo Verify, Session Issue, Me)     |  |
|  | - /api/transactions  (CRUD, Input Validation, Pagination)             |  |
|  | - /api/summary       (Aggregations, Donut & Bar Charts Data)          |  |
|  | - /api/admin/*       (System Stats, User Management, Audit Logs)      |  |
|  +-----------------------------------+-----------------------------------+  |
|                                      | Prepared Statements (Parameterized)  |
|  +-----------------------------------v-----------------------------------+  |
|  | [Data Access Layer (DAL)]                                              |  |
|  | - users.ts & transactions.ts                                          |  |
|  +-----------------------------------+-----------------------------------+  |
+---------------------------------------|-------------------------------------+
                                        | SQLite Native Binding
+---------------------------------------v-------------------------------------+
|                    Cloudflare D1 Serverless SQL Database                    |
|  - Table: users (PK: id, email, name, picture, role, created_at)            |
|  - Table: transactions (PK: id, FK: user_id, type, amount, category...)      |
|  - B-Tree Indexes on (user_id, date), (user_id, type), (category)           |
+-----------------------------------------------------------------------------+
```

---

## 2. การปฏิบัติตามมาตรฐานวิศวกรรมซอฟต์แวร์ (Skills 01 - 10)

| สกิล (Skill) | การนำมาประยุกต์ใช้ในโปรเจกต์นี้ |
| :--- | :--- |
| **01 Requirements Engineering** | ออกแบบฟังก์ชันครบถ้วน: เพิ่ม/ลบ/แก้ไข (CRUD), สรุปยอด, แสดงกราฟ, แบ่งสิทธิ์ User/Admin, รองรับการ Export ข้อมูล |
| **02 System Design** | วางขอบเขตระบบ (System Boundaries), สถาปัตยกรรมแบบ Edge Serverless, Zero Cold Start, Latency ต่ำทั่วโลก |
| **03 Software Architecture** | แยก Concerns ชัดเจน: Types, Auth, Database DAL, Controllers, Middlewares, Utilities ไม่ผูกติดกัน (Loose Coupling) |
| **04 Database Design** | Normalization 3NF, Foreign Key พร้อม `ON DELETE CASCADE`, Compound Indexes สำหรับ Query ประสิทธิภาพสูง |
| **05 API Design** | RESTful Convention, HTTP Status Codes ถูกต้อง (200, 201, 400, 401, 403, 404, 500), Consistent JSON Envelope |
| **06 Code Quality** | เขียน TypeScript Strict Mode, Clean Code, Type Safety, ไร้ Dead Code, รัน `tsc --noEmit` ผ่าน 100% |
| **07 Testing & QA** | มี Automated Unit & Integration Tests ครอบคลุม JWT, Admin Email Rules, Input Validation, RBAC |
| **08 Debugging & Refactoring** | โค้ดอ่านง่าย ตรวจจับข้อผิดพลาดล่วงหน้า มี Error Handling ทุกจุด พร้อม Logging แบบปลอดภัย |
| **09 OWASP Security** | ป้องกัน SQL Injection (Prepared Statements 100%), ป้องกัน XSS (Input Sanitization), ป้องกัน Broken Access Control (RBAC) |
| **10 DevOps & CI/CD** | คอนฟิก `wrangler.jsonc`, จัดการ `.dev.vars`, มีคำสั่ง Migration และ Deploy แบบอัตโนมัติ |

---

## 3. โครงสร้างฐานข้อมูล (Database Schema & D1 Migrations)

ไฟล์ Migration อยู่ที่ [`migrations/0001_initial_schema.sql`](file:///D:/อาจารย์เสรี/งานที่1/migrations/0001_initial_schema.sql):

### 3.1 ตาราง `users`
| คอลัมน์ | ชนิดข้อมูล | เงื่อนไข (Constraints) | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `PRIMARY KEY` | รหัสผู้ใช้ (Google Subject ID หรือ UUID) |
| `email` | `TEXT` | `UNIQUE NOT NULL` | อีเมลของผู้ใช้งาน (บันทึกตัวพิมพ์เล็ก) |
| `name` | `TEXT` | `NOT NULL` | ชื่อที่แสดง |
| `picture` | `TEXT` | `NULL` | URL รูปโปรไฟล์ |
| `role` | `TEXT` | `NOT NULL CHECK(role IN ('admin', 'user'))` | สิทธิ์ ('admin' หรือ 'user') |
| `created_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | เวลาที่ลงทะเบียน |

### 3.2 ตาราง `transactions`
| คอลัมน์ | ชนิดข้อมูล | เงื่อนไข (Constraints) | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `id` | `TEXT` | `PRIMARY KEY` | รหัสรายการธุรกรรม (UUID) |
| `user_id` | `TEXT` | `NOT NULL REFERENCES users(id)` | ผู้บันทึกรายการ (Cascade on delete) |
| `type` | `TEXT` | `NOT NULL CHECK(type IN ('income', 'expense'))`| ประเภท ('income' หรือ 'expense') |
| `category` | `TEXT` | `NOT NULL` | หมวดหมู่รายการ |
| `amount` | `REAL` | `NOT NULL CHECK(amount > 0)` | จำนวนเงิน (ต้องมากกว่า 0) |
| `note` | `TEXT` | `NULL` | หมายเหตุ/รายละเอียด (สูงสุด 255 ตัวอักษร) |
| `transaction_date` | `DATE` | `NOT NULL` | วันที่ทำรายการ (YYYY-MM-DD) |
| `created_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | วันที่สร้างเรคอร์ด |

---

## 4. ข้อกำหนดสิทธิ์และการจัดการ Role (RBAC & Admin Policy)

ระบบจะตรวจสอบอีเมลอัตโนมัติในกระบวนการ Authenticate:
- **สิทธิ์ Admin (`admin`)**: กำหนดให้กับ 2 อีเมลนี้เท่านั้น:
  1. `seree999@gmail.com`
  2. `674295021@parichat.skru.ac.th`
- **สิทธิ์ User ทั่วไป (`user`)**: กำหนดให้กับอีเมลอื่นๆ ทั้งหมด
- **ความสามารถของ Admin**:
  - เข้าถึงแท็บ **👑 Admin Panel**
  - ตรวจสอบสถิติรวมทั้งระบบ (จำนวนผู้ใช้, จำนวนธุรกรรมรวม, ยอดหมุนเวียนรวม, สภาพคล่องสุทธิ)
  - เรียกดูรายชื่อผู้ใช้งานทั้งหมด พร้อมจำนวนรายการและยอดเงินของแต่ละคน
  - เรียกดูบันทึกธุรกรรมล่าสุดทั้งหมดในระบบ (Audit Feed)

---

## 5. สารบัญ API (RESTful API Catalog)

| Method | Endpoint | สิทธิ์ที่ต้องการ | คำอธิบาย |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/auth/config` | สาธารณะ | ดึงการตั้งค่า Google Client ID สำหรับหน้าบ้าน |
| `POST` | `/api/auth/google` | สาธารณะ | ตรวจสอบ Google Credential Token และออก Session JWT |
| `POST` | `/api/auth/demo` | สาธารณะ | เข้าสู่ระบบทดสอบสำหรับผู้ตรวจประเมิน |
| `GET` | `/api/auth/me` | Bearer JWT | ดึงข้อมูลโปรไฟล์ผู้ใช้งานปัจจุบัน |
| `GET` | `/api/summary` | Bearer JWT | ดึงยอดรวม (รายรับ, รายจ่าย, คงเหลือ) และข้อมูลสำหรับกราฟ |
| `GET` | `/api/transactions` | Bearer JWT | ดึงรายการธุรกรรม (รองรับ type, category, date, search) |
| `POST` | `/api/transactions` | Bearer JWT | สร้างรายการธุรกรรมใหม่ (พร้อม Data Validation) |
| `GET` | `/api/transactions/:id`| Bearer JWT | ดึงข้อมูลรายการธุรกรรมเดี่ยว |
| `PUT` | `/api/transactions/:id`| Bearer JWT | แก้ไขข้อมูลรายการธุรกรรม |
| `DELETE`| `/api/transactions/:id`| Bearer JWT | ลบรายการธุรกรรม |
| `GET` | `/api/admin/stats` | Admin Only | สถิติภาพรวมระบบทั้งหมด |
| `GET` | `/api/admin/users` | Admin Only | รายชื่อผู้ใช้ทั้งหมดในระบบพร้อมสถิติการใช้งาน |
| `GET` | `/api/admin/transactions` | Admin Only | ธุรกรรมทั้งหมดในระบบทั่วทุกผู้ใช้งาน |

---

## 6. คู่มือการติดตั้งและรันระบบ (Setup & Deployment Guide)

### 6.1 การรันระบบในเครื่องสำหรับการพัฒนา (Local Development)

1. รันการ Migrate ฐานข้อมูล D1 บนเครื่อง Local:
```bash
npm run db:migrate:local
```

2. รัน Local Development Server:
```bash
npm run dev
```
เปิดเบราว์เซอร์ไปที่ `http://localhost:8787` เพื่อใช้งานระบบได้ทันที!

### 6.2 การ Deploy ขึ้น Cloudflare Workers และ D1 จริง (Production)

1. สร้าง D1 Database บน Cloudflare:
```bash
npx wrangler d1 create income-expense-db
```
นำค่า `database_id` ที่ได้ไปใส่ในไฟล์ `wrangler.jsonc`

2. ดำเนินการ Migrate ไปยัง Remote D1:
```bash
npm run db:migrate:remote
```

3. อัปโหลด Production Secrets:
```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
```

4. สั่ง Deploy ขึ้น Cloudflare Edge:
```bash
npm run deploy
```

---

## 7. การทดสอบระบบ (Automated Testing & QA)

ระบบมาพร้อมชุดการทดสอบอัตโนมัติ ครอบคลุมทั้ง Unit Test และ Integration Test:

```bash
npm test
```

ผลการทดสอบ:
```text
✔ API Route Contracts & RBAC Access Control
  ✔ Admin endpoint grants access to user with role admin
  ✔ Admin endpoint blocks access for user with role user with 403 Forbidden
  ✔ Admin endpoint blocks access when user is null
✔ Admin Role Assignment Rules
  ✔ assigns admin to seree999@gmail.com regardless of case
  ✔ assigns admin to 674295021@parichat.skru.ac.th regardless of case
  ✔ assigns regular user to all other emails
✔ JWT Signing and Verification
  ✔ successfully signs and verifies a valid token
  ✔ fails verification with wrong secret
  ✔ fails verification on expired token
✔ Transaction Input Validation
  ✔ validates correct income transaction
  ✔ validates correct expense transaction
  ✔ rejects negative or zero amounts
  ✔ rejects invalid transaction type
  ✔ rejects invalid date format
ℹ tests 18, pass 18, fail 0
```
