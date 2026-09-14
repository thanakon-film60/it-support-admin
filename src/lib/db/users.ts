import { readCollection, upsertOne } from "./store";
import { newId } from "../utils";
import type { User } from "../types";

const COLLECTION = "users";

function seed(): User[] {
  const now = new Date().toISOString();
  const rows: Omit<User, "id" | "created_at">[] = [
    { display_name: "สมชาย ใจดี", employee_id: "E1001", department: "บัญชี", line_user_id: "U_mock_0001", email: "somchai@example.com" },
    { display_name: "สุนีย์ พงษ์สิน", employee_id: "E1002", department: "การตลาด", line_user_id: "U_mock_0002", email: "sunee@example.com" },
    { display_name: "วิชัย ศรีสุข", employee_id: "E1003", department: "ขายหน้าร้าน", line_user_id: "U_mock_0003", email: null },
    { display_name: "กมลชนก อารีย์", employee_id: "E1004", department: "HR", line_user_id: "U_mock_0004", email: "kamolchanok@example.com" },
    { display_name: "ธนพล เจริญสุข", employee_id: "E1005", department: "คลังสินค้า", line_user_id: "U_mock_0005", email: null },
    { display_name: "อรทัย บุญมี", employee_id: "E1006", department: "การเงิน", line_user_id: "U_mock_0006", email: "orathai@example.com" },
    { display_name: "ปิยะพงษ์ วงศ์ษา", employee_id: "E1007", department: "IT", line_user_id: "U_mock_0007", email: "piyapong@example.com" },
    { display_name: "นภัสสร ทองดี", employee_id: "E1008", department: "ขายหน้าร้าน", line_user_id: "U_mock_0008", email: null },
    { display_name: "เอกชัย พันธุ์ดี", employee_id: "E1009", department: "จัดซื้อ", line_user_id: "U_mock_0009", email: "ekkachai@example.com" },
    { display_name: "ชลธิชา แสงทอง", employee_id: "E1010", department: "การตลาด", line_user_id: "U_mock_0010", email: null },
    { display_name: "ณัฐวุฒิ ใจกล้า", employee_id: "E1011", department: "IT", line_user_id: "U_mock_0011", email: "natthawut@example.com" },
    { display_name: "พิมพ์ชนก รุ่งเรือง", employee_id: "E1012", department: "บัญชี", line_user_id: "U_mock_0012", email: null },
  ];
  return rows.map((r) => ({ ...r, id: newId(), created_at: now }));
}

export async function listUsers(): Promise<User[]> {
  return readCollection<User>(COLLECTION, seed);
}

export async function getUserById(id: string): Promise<User | null> {
  const all = await listUsers();
  return all.find((u) => u.id === id) ?? null;
}

export async function getUserByLineId(lineUserId: string): Promise<User | null> {
  const all = await listUsers();
  return all.find((u) => u.line_user_id === lineUserId) ?? null;
}

/** หา user จากชื่อ+รหัสพนักงาน ถ้าไม่เจอให้สร้างใหม่ (ใช้ตอนแอดมินพิมพ์ชื่อผู้ครอบครองอิสระในฟอร์มทรัพย์สิน) */
export async function findOrCreateUserByName(input: {
  display_name: string;
  employee_id?: string | null;
  department?: string | null;
}): Promise<User> {
  const all = await listUsers();
  const existing = all.find(
    (u) =>
      u.display_name.trim() === input.display_name.trim() &&
      (input.employee_id ? u.employee_id === input.employee_id : true)
  );
  if (existing) return existing;
  const user: User = {
    id: newId(),
    display_name: input.display_name.trim(),
    employee_id: input.employee_id || null,
    department: input.department || null,
    line_user_id: null,
    email: null,
    created_at: new Date().toISOString(),
  };
  await upsertOne<User>(COLLECTION, user, seed);
  return user;
}

/** หา user จาก line_user_id ถ้าไม่เจอให้สร้างใหม่ (ใช้โดย LINE webhook / LIFF เพื่อผูกผู้ใช้ LINE
 *  เข้ากับ users table เดียวกับที่แอดมินเห็น — ให้ ticket ที่มาจาก LINE อ้างถึง requester ถูกคน) */
export async function upsertLineUser(
  lineUserId: string,
  displayName: string
): Promise<User> {
  const existing = await getUserByLineId(lineUserId);
  if (existing) return existing;

  const user: User = {
    id: newId(),
    display_name: displayName,
    employee_id: null,
    department: null,
    line_user_id: lineUserId,
    email: null,
    created_at: new Date().toISOString(),
  };
  await upsertOne<User>(COLLECTION, user, seed);
  return user;
}
