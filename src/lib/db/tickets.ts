import { readCollection, upsertOne, patchOne } from "./store";
import { byNewestFirst } from "../sorting";
import { resolveBranch } from "./branches";
import { companyLabel } from "../companies";
import { recordTicketEvent } from "./ticketEvents";
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

function seed(): Ticket[] {
  const now = new Date();
  const iso = (daysAgo: number, hourOffset = 0) =>
    new Date(now.getTime() - daysAgo * 86400000 + hourOffset * 3600000).toISOString();
  const users = listUsers();
  const equipment = listEquipment();
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
    // completed นับเป็น "จบงาน" ด้วย เพราะมันคือขั้นถัดจาก resolved (ผู้แจ้งยืนยันแล้ว)
  const resolvedStatuses: TicketStatus[] = ["resolved", "completed", "closed"];
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

export function listTickets(): Ticket[] {
  // เรียงใหม่→เก่าตั้งแต่ชั้นนี้ ไม่ใช่ไปเรียงเอาทีหลังในแต่ละหน้า
  //
  // เดิมคืนตามลำดับในไฟล์ JSON ตรงๆ ซึ่ง store.ts ต่อท้ายด้วย all.push(item)
  // ผลคือ ticket ที่พนักงานเพิ่งแจ้งผ่าน LINE ไปอยู่ "แถวล่างสุด" ของตาราง
  // ข้อมูลชุดตั้งต้น (seed) บังเอิญเรียงมาแล้วเลยดูเหมือนถูกต้องมาตลอด
  // จนกระทั่งมีเรื่องแจ้งเข้ามาจริง แอดมินถึงจะเจอว่าเรื่องใหม่หาไม่เจอ
  return byNewestFirst(readCollection<Ticket>(COLLECTION, seed), "created_at");
}

/** หา ticket จากเลขที่ — ไม่สนตัวพิมพ์เล็กใหญ่และช่องว่างหัวท้าย
 *  (เลขที่ตั๋วเดินทางผ่านแชท LINE ซึ่งผู้ใช้ก็อปวางเองได้ จึงเจอช่องว่างติดมาบ่อย) */
export function getTicketByCode(code: string): Ticket | null {
  const target = code.trim().toUpperCase();
  if (!target) return null;
  return listTickets().find((t) => t.ticket_code.toUpperCase() === target) ?? null;
}

export function getTicketById(id: string): Ticket | null {
  return listTickets().find((t) => t.id === id) ?? null;
}

export function listTicketsWithRelations(): TicketWithRelations[] {
  const users = listUsers();
  const equipment = listEquipment();
  return listTickets().map((t) => {
    // Preserve the reporting company; infer only for legacy rows without the field.
    const resolved = t.company === undefined ? resolveBranch(t.location) : null;
    return {
      ...t,
      requester: users.find((u) => u.id === t.requester_id) ?? null,
      equipment: t.equipment_id ? equipment.find((e) => e.id === t.equipment_id) ?? null : null,
      company: t.company === undefined ? resolved?.company ?? null : t.company,
      company_label: t.company ? companyLabel(t.company) : t.company === undefined ? resolved?.companyLabel ?? null : null,
    };
  });
}

export function listRepairHistory(): TicketWithRelations[] {
  return listTicketsWithRelations().filter((t) => t.type === "repair");
}

export type NewTicketInput = Omit<Ticket, "id" | "ticket_code" | "created_at" | "resolved_at">;

export function createTicket(input: NewTicketInput): Ticket {
  const existingOfType = listTickets()
    .filter((t) => t.type === input.type)
    .map((t) => t.ticket_code);
  const ticket: Ticket = {
    ...input,
    company: input.company === undefined ? resolveBranch(input.location)?.company ?? null : input.company,
    id: newId(),
    ticket_code: generateTicketCode(input.type, existingOfType),
    created_at: new Date().toISOString(),
    resolved_at: null,
  };
  upsertOne<Ticket>(COLLECTION, ticket, seed);

  // ต้นเรื่องของไทม์ไลน์ — ถ้าไม่บันทึกตรงนี้ หน้า log จะเริ่มจากกลางเรื่องเสมอ
  recordTicketEvent({
    ticket_id: ticket.id,
    ticket_code: ticket.ticket_code,
    type: "created",
    to_status: ticket.status,
    actor: listUsers().find((u) => u.id === ticket.requester_id)?.display_name ?? "ผู้แจ้ง",
    actor_role: "requester",
    note: ticket.description || null,
  });

  return ticket;
}

/** บันทึกว่า "ผู้แจ้งรับทราบแล้ว" — เก็บลง meta ไม่เปลี่ยน status
 *
 *  จงใจไม่แตะ status เพราะ status เป็นของทีม IT ("งานถึงไหนแล้ว")
 *  ส่วนการที่ผู้แจ้งเปิดดูเป็นคนละเรื่องกัน ("เขารู้แล้วหรือยัง")
 *  ถ้าเอามารวมกัน ticket ที่ยังซ่อมไม่เสร็จจะเปลี่ยนสถานะเองเพียงเพราะมีคนกดดู ซึ่งผิด
 *
 *  บันทึกเฉพาะ "ครั้งแรก" ที่รับทราบ (acknowledged_at ไม่ทับของเดิม)
 *  เพราะสิ่งที่ทีม IT อยากรู้คือ "เขาเห็นตั้งแต่เมื่อไหร่" ไม่ใช่ "เขาเปิดดูล่าสุดเมื่อไหร่"
 *  (อย่างหลังดูได้จากตาราง ticket_views อยู่แล้ว)
 */
export function markTicketAcknowledged(id: string, viewerName: string): Ticket | null {
  const ticket = getTicketById(id);
  if (!ticket) return null;

  const meta = ticket.meta ?? {};
  if (typeof meta.acknowledged_at === "string" && meta.acknowledged_at) return ticket;

  return patchOne<Ticket>(COLLECTION, id, {
    meta: {
      ...meta,
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: viewerName,
    },
  });
}

export interface ChangeStatusInput {
  id: string;
  status: TicketStatus;
  /** ใครเป็นคนเปลี่ยน — ชื่อแอดมิน หรือชื่อผู้แจ้งตอนกดตกลงในแชท */
  actor: string;
  actorRole: "admin" | "requester" | "system";
  /** วิธีแก้ไข / หมายเหตุของช่าง — ติดไปกับไทม์ไลน์ของขั้นนั้น */
  note?: string | null;
}

/** เปลี่ยนสถานะพร้อมบันทึกไทม์ไลน์ในคราวเดียว
 *
 *  จงใจรวมไว้ที่ฟังก์ชันเดียว ไม่แยกเป็น "แก้สถานะ" กับ "บันทึก log"
 *  เพราะถ้าแยก วันหนึ่งจะมีที่ที่เรียกอย่างเดียวแล้วไทม์ไลน์ขาดช่วงโดยไม่มีใครรู้
 *  — ซึ่งทำให้ log การแก้ปัญหาเชื่อถือไม่ได้ทั้งระบบ
 */
export function changeTicketStatus(input: ChangeStatusInput): Ticket | null {
  const before = getTicketById(input.id);
  if (!before) return null;

  // completed นับเป็น "จบงาน" ด้วย เพราะมันคือขั้นถัดจาก resolved (ผู้แจ้งยืนยันแล้ว)
  const resolvedStatuses: TicketStatus[] = ["resolved", "completed", "closed"];

  const meta = { ...(before.meta ?? {}) };
  const at = new Date(Math.max(Date.now(), Date.parse(before.status_updated_at ?? "") + 1 || 0)).toISOString();
  meta.status_history = [...readStatusHistory(before), {
    id: newId(), from: before.status, to: input.status, by: input.actor,
    at, note: input.note?.trim() || "", notified: null,
  } satisfies StatusHistoryEntry];
  if (input.note?.trim()) {
    // เก็บวิธีแก้ล่าสุดไว้บน ticket ด้วย หน้า log จะได้ไม่ต้องไล่ไทม์ไลน์เพื่อโชว์บรรทัดเดียว
    meta.resolution_note = input.note.trim();
  }
  if (input.status === "completed") {
    meta.completed_at = new Date().toISOString();
    meta.completed_by = input.actor;
  }

  const updated = patchOne<Ticket>(
    COLLECTION,
    input.id,
    {
      status: input.status,
      ...(input.actorRole === "admin" && input.actor.trim() ? {
        status_updated_by: input.actor.trim(), status_updated_at: at,
      } : {}),
      // resolved_at = "ทีม IT ทำเสร็จเมื่อไหร่" ไม่ใช่ "ปิดเรื่องเมื่อไหร่"
      // ตอนผู้แจ้งกดตกลงจึงต้องคงค่าเดิมไว้ ไม่ทับด้วยเวลาที่เพิ่งกด
      resolved_at:
        !resolvedStatuses.includes(input.status)
          ? null
          : input.status === before.status || input.status === "completed"
            ? before.resolved_at ?? at
            : at,
      meta,
    },
    seed
  );

  recordTicketEvent({
    ticket_id: before.id,
    ticket_code: before.ticket_code,
    type: input.status === "completed" && input.actorRole === "requester" ? "confirmed" : "status",
    from_status: before.status,
    to_status: input.status,
    actor: input.actor,
    actor_role: input.actorRole,
    note: input.note ?? null,
  });

  return updated;
}

/** รูปแบบเดิม เก็บไว้ให้โค้ดเก่าเรียกได้ — บันทึกไทม์ไลน์ให้ด้วยเสมอ */
export function updateTicketStatus(id: string, status: TicketStatus, editor?: string, options?: { note?: string }): Ticket | null {
  return changeTicketStatus({ id, status, actor: editor?.trim() || "ระบบ", actorRole: editor?.trim() ? "admin" : "system", note: options?.note });
}

export interface StatusHistoryEntry {
  id: string;
  from: TicketStatus;
  to: TicketStatus;
  by: string;
  at: string;
  note: string;
  notified: boolean | null;
}

export function readStatusHistory(ticket: Pick<Ticket, "meta">): StatusHistoryEntry[] {
  const raw = ticket.meta?.status_history;
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is StatusHistoryEntry => e && typeof e === "object" && typeof e.at === "string" && typeof e.by === "string" && typeof e.to === "string");
}

export function recordStatusNotification(id: string, historyId: string, notified: boolean): Ticket | null {
  const ticket = getTicketById(id);
  if (!ticket) return null;
  return patchOne<Ticket>(COLLECTION, id, { meta: { ...ticket.meta,
    status_history: readStatusHistory(ticket).map(e => e.id === historyId ? { ...e, notified } : e),
  } });
}

export function listStatusEditors(): string[] {
  const seen = new Set<string>();
  return listTickets().sort((a, b) => (b.status_updated_at ?? "").localeCompare(a.status_updated_at ?? ""))
    .flatMap(t => {
      const name = t.status_updated_by?.trim();
      if (!name || seen.has(name.toLowerCase())) return [];
      seen.add(name.toLowerCase());
      return [name];
    });
}

export function listCompletedTickets(): TicketWithRelations[] {
  return listTicketsWithRelations().filter(t => t.status === "completed");
}

export function confirmTicketByRequester(input: {
  ticketId: string; confirmed: boolean; by: string; lineUserId?: string; note?: string;
}): Ticket | null {
  const before = getTicketById(input.ticketId);
  if (!before || !["resolved", "completed"].includes(before.status)) return null;
  if (before.status === "completed" && input.confirmed) return before;
  const updated = changeTicketStatus({ id: before.id, status: input.confirmed ? "completed" : "in_progress",
    actor: input.by, actorRole: "requester", note: input.note });
  if (!updated) return null;
  return patchOne<Ticket>(COLLECTION, before.id, { meta: { ...updated.meta, confirmation: {
    confirmed: input.confirmed, by: input.by, line_user_id: input.lineUserId ?? null,
    at: new Date().toISOString(), note: input.note?.trim() || null,
  } } });
}

export function ticketCountsByStatus(): Record<TicketStatus | "all", number> {
  const tickets = listTickets();
  const counts: Record<TicketStatus | "all", number> = {
    all: tickets.length,
    pending: 0,
    in_progress: 0,
    waiting_info: 0,
    waiting_delivery: 0,
    resolved: 0,
    completed: 0,
    closed: 0,
    cancelled: 0,
  };
  tickets.forEach((t) => {
    counts[t.status] += 1;
  });
  return counts;
}
