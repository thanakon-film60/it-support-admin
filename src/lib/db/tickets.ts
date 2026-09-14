import { readCollection, upsertOne, patchOne } from "./store";
import { newId, generateTicketCode } from "../utils";
import { listUsers } from "./users";
import { listEquipment } from "./equipment";
import type { Ticket, TicketStatus, TicketType, TicketWithRelations, User, Equipment } from "../types";

const COLLECTION = "tickets";

const BRANCHES = [
  "สำนักงานใหญ่",
  "สาขาเซ็นทรัล",
  "สาขาแฟชั่นไอส์แลนด์",
  "สาขาเชียงใหม่",
  "สาขาขอนแก่น",
];

async function seed(): Promise<Ticket[]> {
  const now = new Date();
  const iso = (daysAgo: number, hourOffset = 0) =>
    new Date(now.getTime() - daysAgo * 86400000 + hourOffset * 3600000).toISOString();
  const [users, equipment] = await Promise.all([listUsers(), listEquipment()]);
  const repairable = equipment.filter((e) => e.category !== "server");

  const plan: {
    type: TicketType;
    status: TicketStatus;
    daysAgo: number;
    userIdx: number;
    equipmentIdx?: number;
    description: string;
    repair_cost?: number | null;
    meta?: Record<string, unknown>;
  }[] = [
    { type: "repair", status: "closed", daysAgo: 45, userIdx: 0, equipmentIdx: 0, description: "โน้ตบุ๊คเปิดไม่ติด กดปุ่ม power ไม่มีไฟเข้า", repair_cost: 1200 },
    { type: "repair", status: "closed", daysAgo: 40, userIdx: 3, equipmentIdx: 3, description: "จอโน้ตบุ๊คมีเส้นแนวตั้ง คาดว่าสายแพจอหลวม", repair_cost: 1800 },
    { type: "repair", status: "resolved", daysAgo: 12, userIdx: 8, equipmentIdx: 11, description: "เครื่องสแกนบาร์โค้ดอ่านไม่ติด ต้องเปลี่ยนสาย USB", repair_cost: 250 },
    { type: "repair", status: "pending", daysAgo: 1, userIdx: 2, equipmentIdx: 3, description: "จอไม่ติดซ้ำอีกครั้งหลังซ่อมไปเมื่อเดือนก่อน" },
    { type: "repair", status: "in_progress", daysAgo: 2, userIdx: 9, description: "เครื่องพิมพ์ใบเสร็จที่สาขากระดาษติดบ่อย" },
    { type: "repair", status: "cancelled", daysAgo: 20, userIdx: 5, description: "แจ้งซ่อมคีย์บอร์ด แต่พบว่าใช้งานได้ปกติ ปิดงาน" },
    { type: "repair", status: "waiting_delivery", daysAgo: 5, userIdx: 10, equipmentIdx: 10, description: "เครื่องพิมพ์ลูกกลิ้งดึงกระดาษเสีย ส่งซ่อมนอกสถานที่ รออะไหล่" },

    { type: "withdraw", status: "closed", daysAgo: 30, userIdx: 1, description: "ขอเบิกเมาส์และคีย์บอร์ดสำรอง 1 ชุด", meta: { items: [{ name: "เมาส์", qty: 1 }, { name: "คีย์บอร์ด", qty: 1 }] } },
    { type: "withdraw", status: "closed", daysAgo: 25, userIdx: 4, description: "ขอเบิกสาย USB Type-C สำหรับเครื่อง POS", meta: { items: [{ name: "USB Type C", qty: 2 }] } },
    { type: "withdraw", status: "pending", daysAgo: 0, userIdx: 6, description: "ขอเบิก Adapter สำรองเผื่อเครื่องสำรองไฟดับกะทันหัน", meta: { items: [{ name: "เครื่องสำรองไฟ", qty: 1 }] } },
    { type: "withdraw", status: "resolved", daysAgo: 8, userIdx: 9, description: "ขอเบิกหมึกปริ้นเตอร์ M3870FW", meta: { items: [{ name: "หมึกเครื่อง M3870FW", qty: 1 }] } },
    { type: "withdraw", status: "cancelled", daysAgo: 15, userIdx: 2, description: "ขอเบิกจอมอนิเตอร์เพิ่ม 1 จอ (ยกเลิกเนื่องจากมีของเดิมเพียงพอ)" },

    { type: "return", status: "closed", daysAgo: 60, userIdx: 3, description: "คืนโน้ตบุ๊คเครื่องเก่าหลังได้เครื่องใหม่", equipmentIdx: 2 },
    { type: "return", status: "closed", daysAgo: 35, userIdx: 7, description: "คืนอุปกรณ์หลังพนักงานลาออก" },

    { type: "it_service", status: "resolved", daysAgo: 3, userIdx: 1, description: "ขอให้ติดตั้งโปรแกรมบัญชีเพิ่มในเครื่องใหม่" },
    { type: "it_service", status: "closed", daysAgo: 10, userIdx: 8, description: "ขอรีเซ็ตรหัสผ่านระบบ POS" },
    { type: "it_service", status: "pending", daysAgo: 0, userIdx: 5, description: "ขอเข้าถึงระบบ VPN สำหรับทำงานนอกสถานที่" },
    { type: "it_service", status: "waiting_info", daysAgo: 2, userIdx: 10, description: "อีเมลส่งไม่ออก ต้องการให้ตรวจสอบเพิ่มเติม (รอข้อมูล error เพิ่มจากผู้แจ้ง)" },
    { type: "it_service", status: "in_progress", daysAgo: 1, userIdx: 6, description: "ขอย้ายข้อมูลจากเครื่องเก่าไปเครื่องใหม่" },
    { type: "it_service", status: "closed", daysAgo: 18, userIdx: 0, description: "ขอเพิ่มสิทธิ์เข้าถึงโฟลเดอร์ใช้งานร่วมกันของแผนก" },
    { type: "it_service", status: "resolved", daysAgo: 6, userIdx: 11, description: "wifi ที่สาขาหลุดบ่อย ขอให้เข้าตรวจสอบ" },
    { type: "it_service", status: "cancelled", daysAgo: 22, userIdx: 4, description: "ขอเปลี่ยนเมาส์ (ซ้ำกับ ticket เบิกอุปกรณ์ที่แจ้งไปแล้ว)" },
    { type: "repair", status: "closed", daysAgo: 70, userIdx: 8, equipmentIdx: 20, description: "โปรเจคเตอร์ภาพเพี้ยนสี", repair_cost: 0 },
    { type: "it_service", status: "closed", daysAgo: 90, userIdx: 3, description: "ขอให้ตั้งค่าเครื่องพิมพ์เครือข่ายใหม่หลังย้ายออฟฟิศ" },
    { type: "withdraw", status: "closed", daysAgo: 5, userIdx: 8, description: "ขอเบิกสมุดเคลมสินค้าเพิ่ม", meta: { items: [{ name: "สมุดเคลมสินค้า", qty: 3 }] } },
  ];

  const byType: Record<TicketType, string[]> = {
    repair: [],
    withdraw: [],
    return: [],
    it_service: [],
  };

  const rows: Ticket[] = plan.map((p) => {
    const code = generateTicketCode(p.type, byType[p.type]);
    byType[p.type].push(code);
    const equipmentPool = p.type === "repair" ? repairable : equipment;
    const eq: Equipment | undefined =
      p.equipmentIdx !== undefined ? equipmentPool[p.equipmentIdx % equipmentPool.length] : undefined;
    const user: User = users[p.userIdx % users.length];
    const createdAt = iso(p.daysAgo);
    const resolvedStatuses: TicketStatus[] = ["resolved", "closed"];
    return {
      id: newId(),
      ticket_code: code,
      type: p.type,
      status: p.status,
      location: BRANCHES[p.userIdx % BRANCHES.length],
      requester_id: user.id,
      equipment_id: eq?.id ?? null,
      description: p.description,
      repair_cost: p.type === "repair" ? (p.repair_cost ?? null) : null,
      created_at: createdAt,
      resolved_at: resolvedStatuses.includes(p.status)
        ? iso(Math.max(p.daysAgo - 1, 0))
        : null,
      meta: p.meta ?? null,
    };
  });

  return rows.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function listTickets(): Promise<Ticket[]> {
  return readCollection<Ticket>(COLLECTION, seed);
}

export async function getTicketById(id: string): Promise<Ticket | null> {
  const all = await listTickets();
  return all.find((t) => t.id === id) ?? null;
}

export async function listTicketsWithRelations(): Promise<TicketWithRelations[]> {
  // listTickets() ต้องมาก่อน เพราะ seed ของ tickets อ้างถึง users/equipment — ถ้ายิงขนานกัน
  // ตอน DB ยังว่าง seed ของทั้งสามตารางจะชนกันเอง
  const tickets = await listTickets();
  const [users, equipment] = await Promise.all([listUsers(), listEquipment()]);
  return tickets.map((t) => ({
    ...t,
    requester: users.find((u) => u.id === t.requester_id) ?? null,
    equipment: t.equipment_id ? equipment.find((e) => e.id === t.equipment_id) ?? null : null,
  }));
}

export async function listRepairHistory(): Promise<TicketWithRelations[]> {
  const all = await listTicketsWithRelations();
  return all.filter((t) => t.type === "repair");
}

export async function createTicket(
  input: Omit<Ticket, "id" | "ticket_code" | "created_at" | "resolved_at">
): Promise<Ticket> {
  const all = await listTickets();
  const existingOfType = all
    .filter((t) => t.type === input.type)
    .map((t) => t.ticket_code);
  const ticket: Ticket = {
    ...input,
    id: newId(),
    ticket_code: generateTicketCode(input.type, existingOfType),
    created_at: new Date().toISOString(),
    resolved_at: null,
  };
  await upsertOne<Ticket>(COLLECTION, ticket, seed);
  return ticket;
}

export async function updateTicketStatus(
  id: string,
  status: TicketStatus
): Promise<Ticket | null> {
  const resolvedStatuses: TicketStatus[] = ["resolved", "closed"];
  return patchOne<Ticket>(
    COLLECTION,
    id,
    {
      status,
      resolved_at: resolvedStatuses.includes(status) ? new Date().toISOString() : null,
    },
    seed
  );
}

export async function ticketCountsByStatus(): Promise<
  Record<TicketStatus | "all", number>
> {
  const tickets = await listTickets();
  const counts: Record<TicketStatus | "all", number> = {
    all: tickets.length,
    pending: 0,
    in_progress: 0,
    waiting_info: 0,
    waiting_delivery: 0,
    resolved: 0,
    closed: 0,
    cancelled: 0,
  };
  tickets.forEach((t) => {
    counts[t.status] += 1;
  });
  return counts;
}
