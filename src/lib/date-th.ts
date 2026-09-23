// วันที่แบบ "เวลาประเทศไทย" — ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และฝั่งเบราว์เซอร์
//
// ทำไมต้องระบุ time zone ตรงๆ แทนการใช้เวลาเครื่อง:
//
//   1. container ที่รันแอปตั้ง TZ เป็น UTC (ไม่ได้ตั้งค่าอะไรใน docker-compose.yml)
//      ส่วนเบราว์เซอร์ของแอดมินอยู่ UTC+7 — ถ้าต่างคนต่างใช้ "เวลาเครื่อง" เซิร์ฟเวอร์กับ
//      เบราว์เซอร์จะคำนวณ "วันนี้" ไม่ตรงกันในช่วง 00:00–07:00 ตามเวลาไทย
//      ผลคือ React hydration mismatch และปฏิทินกะพริบเปลี่ยนวันหลังโหลดเสร็จ
//
//   2. ในเชิงธุรกิจ "เคสที่แจ้งวันนี้" ควรหมายถึงวันตามเวลาไทยเสมอ ไม่ใช่วันตามเครื่อง
//      ของคนเปิดดู — แอดมินเปิดจากต่างประเทศก็ต้องเห็นวันเดียวกับทีมที่ไทย
//
// จึงคำนวณ key ของวันทั้งหมดด้วย Asia/Bangkok ที่เดียว แล้วส่งเป็นสตริงลงไปให้ฝั่ง client
// ใช้ต่อแบบ deterministic (เทียบสตริงล้วน ไม่แตะ Date อีก)

export const BUSINESS_TIME_ZONE = "Asia/Bangkok";

/** en-CA ให้รูปแบบ YYYY-MM-DD มาตรงๆ จึงใช้เป็น key เรียงลำดับได้เลยโดยไม่ต้องประกอบเอง */
const DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const TIME_HM = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

export const THAI_WEEKDAYS_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

/** ตัวย่อเดือนไทยไม่ได้ตัดตามจำนวนตัวอักษร (กันยายน -> ก.ย. ไม่ใช่ "กัน")
 *  จึงต้องเขียนไว้เป็นรายการ ตัดเอาเองจะได้คำที่คนไทยไม่ได้ใช้กัน */
const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/** "2026-09-17" ตามเวลาไทย */
export function dayKeyTH(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return DAY_KEY.format(d);
}

export function todayKeyTH(): string {
  return dayKeyTH(new Date());
}

/** "15:15" ตามเวลาไทย */
export function timeKeyTH(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return TIME_HM.format(d);
}

/** "2026-09" — key ของเดือน ใช้เลือกว่าปฏิทินเปิดเดือนไหน */
export function monthKeyOf(dayKey: string): string {
  return dayKey.slice(0, 7);
}

/** แปลง key เป็นตัวเลข ปี/เดือน/วัน — ทุกฟังก์ชันด้านล่างทำงานกับตัวเลขล้วน ไม่แตะ time zone อีก */
export function partsOfKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

export function makeDayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** เลื่อนเดือน (+1 / -1) โดยข้ามปีให้ถูก */
export function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const zero = year * 12 + (month - 1) + delta;
  return `${Math.floor(zero / 12)}-${String((zero % 12) + 1).padStart(2, "0")}`;
}

/** จำนวนวันในเดือน — ใช้ Date.UTC ล้วน จึงไม่ขึ้นกับ time zone ของเครื่องที่รัน */
export function daysInMonth(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** วันแรกของเดือนตรงกับวันอะไร (0 = อาทิตย์) ใช้เว้นช่องหัวตารางปฏิทิน */
export function firstWeekdayOfMonth(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

/** "กันยายน 2569" — ปี พ.ศ. ตามที่ใช้ทั้งระบบ */
export function thaiMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `${THAI_MONTHS[month - 1]} ${year + 543}`;
}

/** "17 ก.ย." สั้นๆ สำหรับหัวรายการ */
export function thaiDayLabel(dayKey: string): string {
  const { month, day } = partsOfKey(dayKey);
  return `${day} ${THAI_MONTHS_SHORT[month - 1]}`;
}

/** จำนวนวันระหว่าง 2 key (b - a) — เทียบเป็นวันเต็ม ไม่สนเวลาในวัน */
export function daysBetween(a: string, b: string): number {
  const pa = partsOfKey(a);
  const pb = partsOfKey(b);
  const ms =
    Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day);
  return Math.round(ms / 86400000);
}
