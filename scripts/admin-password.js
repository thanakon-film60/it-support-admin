/**
 * ตัวช่วยของ scripts/set-admin-password.ps1 — ทำงานทั้งหมดใน Node ไม่ให้ PowerShell แตะ
 *
 * ทำไมต้องแยกเป็นไฟล์ ไม่ใช้ `node -e "..."` ตรงๆ:
 *   1. PowerShell กลืนเครื่องหมายคำพูดเวลา ส่ง string เป็น argument ให้โปรแกรมภายนอก
 *      โค้ด JS ที่มี " อยู่ข้างในจึงพังทุกครั้ง (require(fs) แทน require("fs"))
 *   2. `node -e` resolve โมดูลจาก cwd ส่วนไฟล์ .js resolve จากตำแหน่งไฟล์ — วางไว้ใน scripts/
 *      จึงเจอ node_modules ของโปรเจกต์เสมอ ไม่ว่าจะสั่งรันจากโฟลเดอร์ไหน
 *
 * รับทาง stdin เป็น JSON: { password, username, displayName, existing }
 *   existing = เนื้อไฟล์ staff_accounts.json เดิม (สตริงว่างได้ ถ้ายังไม่มีไฟล์)
 * คืนทาง stdout เป็น JSON array ของ staff accounts ที่ merge แล้ว
 *
 * รหัสผ่านเข้ามาทาง stdin เท่านั้น ไม่ผ่าน argv (argv โผล่ในตาราง process ของเครื่อง)
 */
const bcrypt = require("bcryptjs");

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", () => {
  const input = JSON.parse(buf);
  const username = String(input.username || "admin").trim();
  const displayName = String(input.displayName || "ผู้ดูแลระบบ IT").trim();

  let rows = [];
  try {
    const parsed = JSON.parse(input.existing || "[]");
    if (Array.isArray(parsed)) rows = parsed;
  } catch {
    // ไฟล์เดิมพัง/ว่าง = เริ่มใหม่ ดีกว่าหยุดทั้งกระบวนการแล้วล็อกตัวเองออกจากระบบ
    rows = [];
  }

  const hash = bcrypt.hashSync(input.password, 10);
  const i = rows.findIndex(
    (r) => String(r && r.username).toLowerCase() === username.toLowerCase()
  );

  if (i >= 0) {
    rows[i].password_hash = hash;
  } else {
    rows.push({
      id: require("crypto").randomUUID(),
      username,
      password_hash: hash,
      display_name: displayName,
      role: "admin",
      created_at: new Date().toISOString(),
    });
    // ไม่พิมพ์ "created/updated" ลง stderr แล้ว — คำอังกฤษโผล่กลางหน้าจอไทยแล้วชวนสับสน
    // (เคยทำให้ผู้ใช้เห็น "created" ตามด้วย error) ฝั่ง .ps1 รู้เองว่าสร้างหรืออัปเดตจากไฟล์เดิม
  }

  process.stdout.write(JSON.stringify(rows, null, 2));
});
