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

export type TicketStatus =
  | "pending"
  | "in_progress"
  | "waiting_info"
  | "waiting_delivery"
  | "resolved"
  /** ผู้แจ้งกด "ตกลง" ยืนยันว่าแก้ไขเรียบร้อยแล้ว — เรื่องจบสมบูรณ์
   *  ต่างจาก resolved ตรงที่ resolved คือ "ทีม IT บอกว่าเสร็จ"
   *  ส่วน completed คือ "ผู้แจ้งยืนยันแล้วว่าใช้ได้จริง" ซึ่งเป็นหลักฐานที่ต่างกันคนละระดับ */
  | "completed"
  | "closed"
  | "cancelled";

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

export interface StaffAccount {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: "admin" | "it_staff";
  created_at: string;
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
  /** created = เปิดเรื่อง · status = เปลี่ยนสถานะ · confirmed = ผู้แจ้งกดตกลง · note = บันทึกเพิ่ม */
  type: "created" | "status" | "confirmed" | "note";
  from_status: TicketStatus | null;
  to_status: TicketStatus | null;
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
