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
}

export interface StockItemWithComputed extends StockItem {
  stock_status: "ปกติ" | "ถึงขั้นต่ำ" | "ต่ำกว่า";
}
