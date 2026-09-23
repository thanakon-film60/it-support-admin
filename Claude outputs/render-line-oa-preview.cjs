// Approximate browser preview of the generated Flex JSON; LINE remains the renderer in production.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, 'line-oa-ui-cards.json'), 'utf8').replace(/^\uFEFF/, ''));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const spaces = { none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 };
const fonts = { xxs: 11, xs: 12, sm: 14, md: 16, lg: 18, xl: 20, xxl: 24 };
const unit = n => typeof n === 'number' ? `${n}px` : n in spaces ? `${spaces[n]}px` : n;
function render(n) {
  if (n.type === 'bubble') return `<article class="bubble">${['header','body','footer'].filter(k => n[k]).map(k => render(n[k])).join('')}</article>`;
  const styles = [];
  const add = (k, v) => { if (v !== undefined) styles.push(`${k}:${v}`); };
  add('background', n.backgroundColor); add('color', n.color); add('border-radius', unit(n.cornerRadius));
  add('padding', unit(n.paddingAll)); add('margin-top', unit(n.margin));
  add('width', n.width); add('height', n.height && n.type !== 'button' ? n.height : undefined);
  if (n.borderWidth) add('border', `${unit(n.borderWidth)} solid ${n.borderColor}`);
  if (n.flex !== undefined) add('flex', n.flex === 0 ? '0 0 auto' : `${n.flex} 1 0%`);
  const attrs = () => `style="${esc(styles.join(';'))}"`;
  if (n.type === 'text') {
    add('font-size', `${fonts[n.size] || 14}px`); add('font-weight', n.weight === 'bold' ? 700 : 400);
    add('text-align', n.align === 'end' ? 'right' : n.align); add('white-space', n.wrap ? 'pre-wrap' : 'nowrap');
    return `<div class="text" ${attrs()}>${esc(n.text)}</div>`;
  }
  if (n.type === 'separator') return `<hr style="border:0;border-top:1px solid ${esc(n.color || '#E2EAF3')};margin:12px 0">`;
  if (n.type === 'button') {
    add('height', n.height === 'md' ? '48px' : '40px');
    add('background', n.style === 'link' ? 'transparent' : n.color || '#176BDA');
    add('color', n.style === 'primary' ? '#FFFFFF' : n.style === 'link' ? n.color : '#172B4D');
    return `<button class="button" data-action="${esc(n.action.data)}" ${attrs()}>${esc(n.action.label)}</button>`;
  }
  add('display','flex'); add('flex-direction', n.layout === 'vertical' ? 'column' : 'row');
  add('gap', unit(n.spacing)); add('align-items', n.alignItems || (n.layout === 'baseline' ? 'baseline' : undefined));
  if (n.action) add('cursor', 'pointer');
  return `<div ${attrs()}>${(n.contents || []).map(render).join('')}</div>`;
}
const labels = ['เลือกวิธีแจ้งเรื่อง', 'พิมพ์สิ่งที่ต้องการให้ช่วย', 'รับเรื่อง พร้อมติดตาม'];
const html = `<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IT Support · LINE OA UI</title><style>
*{box-sizing:border-box}body{margin:0;background:#eaf0f6;color:#172b4d;font-family:'Leelawadee UI',Tahoma,sans-serif}main{max-width:1160px;margin:auto;padding:40px 28px}.eyebrow{font:700 11px 'Segoe UI',sans-serif;letter-spacing:3px;color:#176bda}h1{font-size:30px;margin:12px 0 8px;letter-spacing:-.5px}p{margin:0;color:#64748b;font-size:14px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;margin-top:30px}.caption{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700;margin-bottom:14px}.number{font:600 11px 'Segoe UI',sans-serif;color:#176bda;background:white;border:1px solid #d8e5f3;border-radius:20px;padding:5px 8px}.bubble{border-radius:18px;overflow:hidden;background:white;box-shadow:0 10px 30px #19365312;border:1px solid #dfe8f2}.text{min-width:0;line-height:1.55;overflow-wrap:anywhere}.button{width:100%;border:0;border-radius:9px;font:600 14px 'Leelawadee UI',Tahoma,sans-serif;cursor:pointer;flex-shrink:0}.button:hover{filter:brightness(.96)}.note{margin-top:26px;font-size:11px}#feedback{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#102d50;color:white;border-radius:12px;padding:12px 20px;display:none;font-size:13px}@media(max-width:760px){main{padding:24px 18px}h1{font-size:25px}.grid{grid-template-columns:1fr;max-width:350px;margin:24px auto;gap:24px}}
</style><main><div class="eyebrow">IT SUPPORT / LINE OA</div><h1>แจ้งง่าย ดูแลได้ตรงจุด</h1><p>หน้าตาใหม่สำหรับการแจ้งเรื่องและติดตามงาน IT</p><div class="grid">${cards.map((c,i)=>`<section><div class="caption"><span class="number">0${i+1}</span>${labels[i]}</div>${render(c.flex)}</section>`).join('')}</div><p class="note">ภาพพรีวิวจากข้อมูลสมมติ · การจัดวางจริงอาจต่างกันตามหน้าจอและเวอร์ชัน LINE</p></main><div id="feedback"></div><script>document.querySelectorAll('button').forEach(b=>b.onclick=()=>{const f=document.querySelector('#feedback');f.textContent='ตัวอย่างปุ่ม: '+b.textContent+' — ใน LINE จะเข้าสู่ขั้นตอนนี้';f.style.display='block';setTimeout(()=>f.style.display='none',2200)});</script></html>`;
const htmlPath = path.join(__dirname, 'line-oa-ui-preview.html');
fs.writeFileSync(htmlPath, html, 'utf8');
(async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless:true});
  const page = await browser.newPage({viewport:{width:1160,height:1050},deviceScaleFactor:1.5});
  await page.goto(pathToFileURL(htmlPath).href);
  await page.screenshot({path:path.join(__dirname,'line-oa-ui-preview.png'),fullPage:true});
  await page.setViewportSize({width:360,height:800});
  const overflow = await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error('Mobile preview overflows horizontally');
  await page.screenshot({path:path.join(__dirname,'line-oa-ui-mobile.png'),fullPage:true});
  await browser.close();
  console.log('Desktop and mobile previews ready; no horizontal overflow at 360px.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
