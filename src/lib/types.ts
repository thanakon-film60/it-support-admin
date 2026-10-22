// โครงสร้างข้อมูลหลักของระบบ — อิงจาก schema ที่วิเคราะห์จาก it-support-admin.vercel.app
// ดูรายละเอียดการวิเคราะห์ที่ PROJECT.md

export type EquipmentCategory =
  | "notebook"
  | "desktop"
  | "monitor"
  | "mouse"
  | "keyboard"
  | "phone"
  | "headset"
  | "printer"
  | "scanner"
  | "router"
  | "projector"
  | "ups"
  | "server"
  | "tablet"
  | "other";

export type EquipmentStatus =
  | "ว่าง"
  | "จองแล้ว"
  | "ใช้งานอยู่"
  | "ส่งซ่อม"
  | "เลิกใช้งาน";

export type TicketType = "repair" | "withdraw" | "return" | "it_service";

/** สถานะของเรื่อง — 3 ค่า (21 ต.ค. 2026 ผู้ใช้ขอ: ยุบเหลือ 2 แล้วเพิ่ม "ยกเลิก" กลับในวันเดียวกัน)
 *
 *  pending   = รอดำเนินการ — ทุกอย่างที่ทีม IT ยังต้องทำอะไรต่อ (รวมที่เดิมแยกเป็นกำลังทำ/รอข้อมูล/รออะไหล่)
 *  resolved  = แก้ไขแล้ว — ทีม IT ปิดงาน ผู้แจ้งได้การ์ดให้คะแนน 1–5 ดาว (meta.rating · lib/ticket-feedback.ts)
 *              ผู้แจ้งกด "ยังมีปัญหาอยู่" ภายในเวลาที่กำหนด = กลับเป็น pending
 *  cancelled = ยกเลิก — ปิดเรื่องโดยไม่ได้แก้ (แจ้งซ้ำ/แจ้งผิด/ผู้แจ้งขอยกเลิก) ไม่มีการ์ดให้คะแนน ไม่นับเป็นงานที่แก้เสร็จ
 *
 *  ข้อมูลเก่าที่ยังเป็นสถานะเดิมถูกแปลงอัตโนมัติตอนอ่าน (migrateLegacyStatuses ใน lib/db/tickets.ts) */
export type TicketStatus = "pending" | "resolved" | "cancelled";

/** สถานะของระบบเดิม — ยังโผล่ใน status_history / ไทม์ไลน์ของเรื่องเก่า (อ่านอย่างเดียว ห้ามเขียนใหม่)
 *  ความหมาย "resolved" ของระบบเดิม (รอผู้แจ้งกดยืนยัน) ไม่ได้อยู่ในนี้ เพราะชื่อซ้ำกับสถานะปัจจุบัน
 *  — ประวัติเก่าที่เขียนว่า resolved จึงแสดงเป็น "แก้ไขแล้ว" ซึ่งตรงความหมายอยู่แล้ว */
export type LegacyTicketStatus = "in_progress" | "waiting_info" | "waiting_delivery" | "completed" | "closed";

export type AnyTicketStatus = TicketStatus | LegacyTicketStatus;

export type StockTxnType = "in" | "adjust" | "out";

export type FaqCategory =
  | "general"
  | "hardware"
  | "software"
  | "network"
  | "printer"
  | "account";

export interface User {
  id: string;
  display_name: string;
  employee_id: string | null;
  department: string | null;
  line_user_id: string | null;
  email: string | null;
  created_at: string;

  /* ---- ข้อมูลจากทะเบียนพนักงานของ HR (src/lib/db/employees.seed.json) ----
   *
   * ทุกช่องเป็น optional โดยตั้งใจ: data/users.json ที่มีอยู่แล้วในเครื่อง/บน volume
   * ถูกสร้างก่อนจะมีช่องพวกนี้ ถ้าประกาศเป็น required แถวเก่าจะกลายเป็นข้อมูลผิด type ทันที
   * โดยที่ไม่มีใครรู้ (JSON.parse ไม่ตรวจ type ให้) แล้วไปพังตอนอ่านค่าในหน้าเว็บแทน */

  /** คำนำหน้า นาย/นาง/นางสาว — เก็บแยกจากชื่อ เพราะเมนูใน LINE ใช้แค่ชื่อจริงจะสั้นกว่า */
  title?: string | null;
  /** ชื่อเล่น — เป็นคำที่คนในบริษัทใช้เรียกกันจริง ใช้ค้นหาได้แม่นกว่าชื่อจริงในหลายกรณี */
  nickname?: string | null;
  position?: string | null;
  /** ระดับตามผังองค์กร เช่น CEO / DM-3 / SF-2 */
  level?: string | null;
  company?: CompanyCode | null;
  /** พนักงานลาออกให้ตั้ง false ไม่ใช่ลบทิ้ง เพราะ ticket เก่าอ้าง requester_id นี้อยู่ */
  active?: boolean;
}

export interface Equipment {
  id: string;
  asset_code: string;
  brand_model: string | null;
  serial_number: string | null;
  category: EquipmentCategory;
  status: EquipmentStatus;
  purchase_price: number | null;
  install_location: string | null;
  notes: string | null;
  purchase_date: string | null;
  warranty_expiry: string | null;
  current_holder_id: string | null;
  current_holder_since: string | null;
  created_at: string;
}

export interface Ticket {
  id: string;
  company?: CompanyCode | null;
  status_updated_by?: string | null;
  status_updated_at?: string | null;
  ticket_code: string;
  type: TicketType;
  status: TicketStatus;
  location: string; // สาขา
  requester_id: string;
  equipment_id: string | null;
  description: string;
  repair_cost: number | null;
  created_at: string;
  resolved_at: string | null;
  // เก็บ payload เพิ่มเติมของแต่ละประเภท (เช่น รายการอุปกรณ์ที่เบิก, จำนวน) แบบยืดหยุ่น
  meta: Record<string, unknown> | null;
}

export interface StockItem {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  location: string | null;
  quantity_available: number;
  safety_stock: number;
  created_at: string;
}

export interface StockTransaction {
  id: string;
  stock_item_id: string;
  type: StockTxnType;
  quantity: number;
  staff_name: string | null;
  reference_no: string | null;
  note: string | null;
  created_at: string;
}

export interface FaqItem {
  id: string;
  title: string;
  keywords: string[];
  content: string;
  category: FaqCategory;
  image_urls: string[];
  created_at: string;
}

/** บัญชีเจ้าหน้าที่ที่ล็อกอินหน้าแอดมิน — data/staff_accounts.json
 *
 *  สร้าง/แก้ด้วยโปรแกรม tools/staff_admin.py (หน้าเว็บไม่มีเมนูจัดการบัญชี โดยตั้งใจ:
 *  งานนี้ทำได้เฉพาะคนที่เข้าถึงเครื่องเซิร์ฟเวอร์ ไม่ใช่ทุกคนที่เปิดเว็บจากอินเทอร์เน็ตได้)
 *  ช่องที่มี ? = บัญชีรุ่นก่อนไม่มี ต้องอ่านแบบมีค่าตั้งต้นเสมอ (ดู pagesOf / getSession) */
export interface StaffAccount {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  /** admin = เข้าได้ทุกหน้า · it_staff = เฉพาะหน้าใน pages */
  role: "admin" | "it_staff";
  created_at: string;
  /** key ของหน้าที่เข้าได้ (ดู lib/pages.json) — ใช้เฉพาะ it_staff */
  pages?: string[];
  /** false = ปิดใช้งาน: ล็อกอินไม่ได้ และ session ที่ค้างอยู่ใช้ไม่ได้ทันที · ไม่มีช่องนี้ = ใช้งานได้ */
  active?: boolean;
  /** เพิ่มทีละ 1 ทุกครั้งที่เปลี่ยนรหัสผ่าน/สั่งออกจากระบบ — cookie ที่ออกก่อนหน้านั้นใช้ไม่ได้อีก */
  session_version?: number;
  updated_at?: string;
}

// ----- view-model types (คำนวณจากข้อมูลดิบ ไม่ใช่คอลัมน์จริงในตาราง) -----

export interface EquipmentSummary extends Equipment {
  owner_name: string | null;
  owner_department: string | null;
  repair_count: number;
}

export interface TicketWithRelations extends Ticket {
  requester: User | null;
  equipment: Equipment | null;
  /** บริษัทที่แจ้งเรื่อง — ข้อมูลเก่าที่ไม่มีฟิลด์นี้จะเทียบทะเบียนสาขาเมื่ออ่าน */
  company: CompanyCode | null;
  company_label: string | null;
}

/** หนึ่งครั้งที่มีคนเปิดดูสถานะของ ticket
 *
 *  ⚠️ เรื่อง IP ที่ต้องเข้าใจก่อนใช้ข้อมูลนี้:
 *  เวลาผู้ใช้กดปุ่ม "เช็คสถานะเรื่องนี้" ในแชท LINE นั้น **มือถือของเขาไม่ได้ต่อมาที่เซิร์ฟเวอร์เราเลย**
 *  LINE รับการกดปุ่มไว้แล้วยิง webhook มาจากเซิร์ฟเวอร์ของ LINE เอง
 *  ค่า `ip` ที่บันทึกได้จึงเป็น IP ของ "เซิร์ฟเวอร์ LINE / ตัวพร็อกซีหน้าบ้าน" ไม่ใช่ของพนักงาน
 *  ฟิลด์ `ip_note` มีไว้เขียนกำกับตรงนี้ให้คนอ่าน log เข้าใจตรงกัน จะได้ไม่เอาไปใช้ผิด
 *
 *  ตัวที่ระบุ "ใครกด" ได้จริงคือ `line_user_id` (แมปกลับเป็นชื่อพนักงานได้) ซึ่งแม่นกว่า IP มาก
 *  ถ้าต้องการ IP ของเครื่องจริงๆ ต้องเปลี่ยนปุ่มไปเปิดหน้าเว็บ (LIFF) แทน postback
 */
/** บริษัทในกลุ่ม — สาขาทุกสาขาสังกัดหนึ่งในนี้
 *  central = สำนักงาน/คลังส่วนกลาง ไม่ใช่หน้าร้าน */
export type CompanyCode = "montipa" | "motta" | "central";

export interface Company {
  code: CompanyCode;
  name: string;
  short_name: string;
}

export interface Branch {
  id: string;
  company: CompanyCode;
  name: string;
  group: string | null;
  floor: string | null;
  sale_manager: string | null;
  area_manager: string | null;
  active: boolean;
  created_at: string;
}

/** บัญชี LINE ของทีม IT ที่สั่งเปิด/ปิดบอทจากแชทได้ (พิมพ์ "แอดมิน" หาบอท) — data/line_staff.json
 *  ขอสิทธิ์จากแชท ("ขอสิทธิ์แอดมิน") แล้วแอดมินอนุมัติในหน้า "บอท LINE" */
export interface LineStaff {
  id: string;
  line_user_id: string;
  /** ชื่อโปรไฟล์ LINE ล่าสุดที่บอทเห็น — แสดงบนการ์ดว่า "ปิดโดยใคร" */
  display_name: string | null;
  status: "pending" | "approved";
  requested_at: string;
  approved_at: string | null;
  approved_by: string | null;
  /** ครั้งล่าสุดที่ใช้คำสั่งแอดมินในแชท — ไว้ดูว่าบัญชีไหนไม่ได้ใช้แล้ว ควรถอดสิทธิ์ */
  last_seen_at: string | null;
}

export interface CustodianFormOptions {
  owners: { name: string; employee_id: string | null; department: string | null }[];
  departments: string[];
}

/** หนึ่งเหตุการณ์ในไทม์ไลน์ของ ticket
 *
 *  ทำไมต้องมีตารางแยก ไม่เก็บใน ticket.meta:
 *  ไทม์ไลน์คือ "ของที่เพิ่มเรื่อยๆ" ส่วน ticket คือ "สถานะล่าสุด" ถ้ายัดรวมกัน ticket จะบวมขึ้น
 *  ทุกครั้งที่เปลี่ยนสถานะ และการอ่านรายการ ticket (ซึ่งเกิดทุกครั้งที่เปิดหน้าเว็บ)
 *  จะต้องลากไทม์ไลน์ทั้งหมดมาด้วยทั้งที่ไม่ได้ใช้
 */
export interface TicketEvent {
  id: string;
  ticket_id: string;
  ticket_code: string;
  /** created = เปิดเรื่อง · status = เปลี่ยนสถานะ · confirmed = ผู้แจ้งกดตกลง (การ์ดรุ่นเก่า)
   *  · rated = ผู้แจ้งให้คะแนน/เขียนความเห็นหลังปิดงาน · note = บันทึกเพิ่ม */
  type: "created" | "status" | "confirmed" | "rated" | "note";
  /** เรื่องเก่ามีสถานะของระบบเดิมปนอยู่ — แสดงผลด้วย statusLabel() ไม่ใช่ TICKET_STATUS_LABEL ตรงๆ */
  from_status: AnyTicketStatus | null;
  to_status: AnyTicketStatus | null;
  actor: string;
  /** admin = ทีม IT ในหน้าแอดมิน · requester = ผู้แจ้งกดในแชท LINE · system = ระบบทำเอง */
  actor_role: "admin" | "requester" | "system";
  note: string | null;
  created_at: string;
}

export interface TicketView {
  id: string;
  ticket_id: string;
  ticket_code: string;
  /** line-bot = กดปุ่มในแชท · admin-panel = เปิดดูจากหน้าแอดมิน · liff = เปิดหน้าเว็บ */
  source: "line-bot" | "admin-panel" | "liff";
  line_user_id: string | null;
  viewer_name: string;
  ip: string | null;
  /** คำกำกับว่า ip ข้างบนเป็นของใคร เช่น "IP เซิร์ฟเวอร์ LINE ไม่ใช่เครื่องผู้ใช้" */
  ip_note: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface StockItemWithComputed extends StockItem {
  stock_status: "ปกติ" | "ถึงขั้นต่ำ" | "ต่ำกว่า";
}

/** ตัวเลือกสำหรับ dropdown ในฟอร์มเพิ่มทรัพย์สิน — คำนวณจากข้อมูลที่มีอยู่จริงในระบบ
 *  (หน้า /assets เป็นคนประกอบให้ตอนเรนเดอร์ฝั่งเซิร์ฟเวอร์ ฟอร์มแค่รับไปแสดง) */
export interface AssetFormOptions {
  /** ยี่ห้อ/รุ่นที่เคยบันทึกไว้ */
  brands: string[];
  /** สถานที่ติดตั้งที่เคยบันทึกไว้ */
  locations: string[];
  /** แผนกที่เคยบันทึกไว้ */
  departments: string[];
  /** ผู้ครอบครองที่มีอยู่ — เลือกชื่อแล้วฟอร์มจะเติมรหัสพนักงาน/แผนกให้เอง */
  owners: { name: string; employee_id: string | null; department: string | null }[];
  /** รหัสทรัพย์สินทั้งหมด (ตัวพิมพ์ใหญ่) ใช้เตือนตอนกรอกรหัสซ้ำ */
  assetCodes: string[];
}

/** ข้อความที่ฝากไว้ในหน้า /notes — เก็บบนเซิร์ฟเวอร์ (data/notes.json)
 *
 *  เก็บฝั่งเซิร์ฟเวอร์ ไม่ใช่ localStorage เพราะจุดประสงค์ทั้งหมดของหน้านี้คือ "เขียนจากเครื่องหนึ่ง
 *  แล้วเปิดอ่านจากอีกเครื่อง" ซึ่ง localStorage ทำไม่ได้ (อยู่แค่ในเบราว์เซอร์เครื่องนั้น และหายเมื่อล้างประวัติ) */
export interface Note {
  id: string;
  body: string;
  /** ชื่อที่แสดงของบัญชีที่ล็อกอินตอนเขียน — เก็บเป็นข้อความ ไม่เก็บ id ของบัญชี
   *  เพราะบัญชีถูกลบหรือเปลี่ยนชื่อได้ แต่ข้อความเก่าต้องยังบอกได้ว่าใครเป็นคนเขียน */
  author: string;
  created_at: string;
  /** null = ยังไม่เคยแก้ — แยกจาก created_at เพื่อให้หน้าเว็บบอกได้ว่า "ข้อความนี้ถูกแก้หลังเขียน" */
  updated_at: string | null;
  updated_by: string | null;
}

/* ---- คลังไฟล์ (/files) — ข้อมูลกำกับเก็บใน data/*.json ส่วนตัวไฟล์จริงอยู่ใน DRIVE_DIR ----
 * แยกสองที่โดยตั้งใจ: data/ ถูก backup.bat คัดลอกเข้าโฟลเดอร์โปรเจกต์ทุกครั้ง ถ้าไฟล์ขนาดหลายร้อย MB
 * อยู่ในนั้นด้วย backup จะใหญ่ขึ้นเรื่อยๆ และเสี่ยงหลุดขึ้น GitHub ไปพร้อมกับโฟลเดอร์ backups/ */

export interface DriveFolder {
  id: string;
  name: string;
  /** null = อยู่ชั้นบนสุดของคลัง */
  parent_id: string | null;
  created_at: string;
  created_by: string;
}

export interface DriveFile {
  id: string;
  folder_id: string | null;
  name: string;
  size: number;
  /** ชนิดไฟล์ที่เบราว์เซอร์บอกมาตอนอัปโหลด — ใช้แสดงผลเท่านั้น ตอนดาวน์โหลดไม่เชื่อค่านี้ */
  mime: string;
  /** ข้อความกำกับไฟล์ เช่น "ไดรเวอร์ปริ้นเตอร์ห้องบัญชี ใช้กับ Windows 11" */
  note: string | null;
  /** ไว้ตรวจว่าไฟล์ที่ดาวน์โหลดไปตรงกับที่อัปโหลดทุกไบต์ (สำคัญกับไฟล์ติดตั้งโปรแกรม) */
  sha256: string | null;
  uploaded_at: string;
  uploaded_by: string;
  updated_at: string | null;
  updated_by: string | null;
}

/** การอัปโหลดที่ยังส่งไม่ครบ — ไฟล์ใหญ่ถูกส่งเป็นท่อนๆ จึงต้องจำไว้ว่าท่อนต่อไปเป็นของไฟล์ไหน */
export interface DriveUpload {
  id: string;
  folder_id: string | null;
  name: string;
  size: number;
  mime: string;
  created_at: string;
  created_by: string;
}
