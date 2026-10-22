"""Build the user guide as a pastel, landscape infographic inspired by the supplied Canva reference."""
from pathlib import Path
import base64, html, json, re, zipfile
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'manual/users/visual'
OUT.mkdir(exist_ok=True)
STEM='IT-Support-User-Guide-Visual-TH'
REF='https://www.canva.com/design/DAHPOuTerUc/Pr72eCg8hzMmPfvYRwZjSQ/view'

def uri(path):
    path=ROOT/path
    mime='font/ttf' if path.suffix=='.ttf' else 'image/png' if path.suffix=='.png' else 'image/jpeg'
    return f'data:{mime};base64,'+base64.b64encode(path.read_bytes()).decode()
def e(s): return html.escape(s)
def phone(n):
    return f'<div class="phone"><img src="{uri(f"It-support_Pictures/{n}.jpg")}" alt="ภาพหน้าจอ LINE ขั้นตอนการใช้งาน {n}"></div>'
def tag(s): return '<span class="tag">'+e(s)+'</span>'
def tip(s): return '<div class="tip"><b>จำไว้สักนิด</b><span>'+e(s)+'</span></div>'
def bullets(items): return '<ul>'+''.join('<li>'+e(x)+'</li>' for x in items)+'</ul>'
def steps(items): return '<ol>'+''.join('<li>'+e(x)+'</li>' for x in items)+'</ol>'
def card(num,title,desc,pic,color,tail=''):
    return f'<article class="card {color}"><div class="card-head"><span class="badge">{num}</span><h2>{e(title)}</h2></div><p class="desc">{e(desc)}</p>{phone(pic)}<p class="tail">{e(tail)}</p></article>'
def detail(num,title,desc,pic,color,items):
    return f'<article class="detail {color}"><div class="card-head"><span class="badge">{num}</span><h2>{e(title)}</h2></div><p class="desc">{e(desc)}</p><div class="detail-row">{phone(pic)}<div class="instructions">{steps(items)}</div></div></article>'

P=[]
def add(title,subtitle,content,klass='',ribbon='คู่มือสำหรับพนักงาน'):
    P.append(dict(title=title,subtitle=subtitle,content=content,klass=klass,ribbon=ribbon))

add('แจ้งปัญหา IT ง่าย ๆ ใน 5 ขั้นตอน','ผ่าน LINE OA : IT-Support-Admin',
    '<div class="five">'+
    card('1','เพิ่มเพื่อน','สแกน QR ด้านบน หรือค้นหา LINE ID',1,'lavender','@891ujhzo')+
    card('2','เลือกเรื่อง / สาขา','กดแจ้งเรื่องใหม่ แล้วตอบบริษัท สาขา และประเภทงาน',14,'aqua','เลือกสถานที่ที่เกิดปัญหาจริง')+
    card('3','บอกปัญหาให้ชัด','ระบุอุปกรณ์ ผู้แจ้ง และอาการ พร้อมรูปถ้ามี',6,'lime','ไม่ทราบสาเหตุ ก็แจ้งอาการได้')+
    card('4','เก็บเลข Ticket','ได้รับการ์ด “รับเรื่องแล้ว” จึงถือว่าส่งสำเร็จ',10,'yellow','กด “เช็คสถานะเรื่องนี้” เพื่อติดตาม')+
    card('5','ทดสอบและยืนยัน','เมื่อ IT แก้ไขแล้ว ให้ลองใช้งานจริงก่อนตอบ',12,'pink','กด “เรียบร้อยแล้ว” หรือ “ยังไม่หาย”')+
    '</div><div class="service-strip">'+tag('แจ้งซ่อม')+tag('เบิกอุปกรณ์')+tag('คืนอุปกรณ์')+tag('ขอใช้บริการ IT')+'<span>รายละเอียดแต่ละขั้นตอนอยู่ในหน้าถัดไป →</span></div>', 'overview')

add('เริ่มต้นให้ถูกที่ เลือกเรื่องให้ตรง','เพิ่มเพื่อน → เลือกบริษัทและสาขา → เลือกบริการ',
    '<div class="three">'+
    detail('01','เปิดห้องแชท IT','ตรวจชื่อบัญชีและโลโก้ให้ตรงก่อนเริ่ม',1,'lavender',[
        'เพิ่มเพื่อน IT-Support-Admin จาก QR หรือ LINE ID @891ujhzo',
        'เปิดแชท แล้วแตะ “เมนู IT” ด้านล่าง',
        'กด “แจ้งเรื่องใหม่” หรือเลือกบริการที่ต้องการ'])+
    detail('02','บริษัทและสาขา','เลือกสถานที่ที่ต้องการรับบริการ',14,'aqua',[
        'เลือกบริษัทตามรายการที่บอทแสดง',
        'หากมีเมนูกลุ่ม / ทีม ให้เลือกก่อนเลือกสาขา',
        'ตรวจชื่อสาขาอีกครั้ง เพราะบางสาขาชื่อเหมือนกันข้ามบริษัท'])+
    detail('03','เลือกประเภทงาน','มีบริการหลักให้เลือก 4 ประเภท',3,'lime',[
        'แจ้งซ่อม: อุปกรณ์หรือระบบมีปัญหา',
        'เบิกอุปกรณ์ / คืนอุปกรณ์: แจ้งรายการที่ต้องการ',
        'ขอใช้บริการ IT: ติดตั้งโปรแกรม ย้ายข้อมูล หรือขอความช่วยเหลือ'])+
    '</div>'+tip('หากเลือกผิดระหว่างกรอก ให้พิมพ์ “ยกเลิก” แล้วเริ่มใหม่ หากได้เลข Ticket แล้ว ให้ติดต่อทีม IT โดยอ้างเลขเรื่องนั้น'))

add('ระบุอุปกรณ์ ผู้แจ้ง และอาการ','ข้อมูลครบ ช่วยให้ทีม IT ตรวจสอบได้ตรงจุด',
    '<div class="three">'+
    detail('04','เลือกอุปกรณ์','ใช้ข้อมูลที่ตรงกับเครื่องที่มีปัญหา',17,'lime',[
        'เลือกประเภท → ยี่ห้อ / รุ่น → รหัสทรัพย์สิน หรือพิมพ์รหัส',
        'หากมีหลายเครื่องรหัสเหมือนกัน ให้ตรวจรุ่นและสถานที่',
        'ไม่ทราบรหัส ใช้ “ไม่มี / ไม่ทราบ” หรือ “พิมพ์รายละเอียด”'])+
    detail('05','ตรวจชื่อผู้แจ้ง','ใช้ชื่อของผู้ที่แจ้งเรื่องจริง',18,'yellow',[
        'พิมพ์ชื่อจริง ชื่อเล่น หรือรหัสพนักงาน แล้วเลือก / ยืนยันชื่อ',
        'ไม่พบรายชื่อ ใช้ “ใช้ชื่อที่พิมพ์” ตามตัวเลือกของบอท',
        'ครั้งถัดไปตรวจ “แจ้งในชื่อ” หากผิด ให้กด “เปลี่ยนคนแจ้ง”'])+
    detail('06','อธิบายปัญหา','บอกอาการที่พบ ไม่ต้องเดาสาเหตุ',6,'pink',[
        'ระบุว่าอุปกรณ์ใด เกิดอาการอะไร เริ่มเมื่อใด และกระทบงานอย่างไร',
        'ส่งรูปประกอบระหว่างกรอก ก่อนจบการรับเรื่อง',
        'หากเล่าไว้แล้ว กด “ไม่มี ส่งเลย” ได้เมื่อปุ่มปรากฏ'])+
    '</div>'+tip('ภาพชื่อผู้แจ้งเป็นรุ่นก่อน ปัจจุบันมีการค้นหาและผูกชื่อจากทะเบียน ข้อความหรือรูปที่ส่งหลังได้ Ticket จะไม่เพิ่มเข้าเรื่องเดิมโดยอัตโนมัติ'))

add('รับเลขเรื่อง ติดตาม แล้วบอกผล','การแจ้งสำเร็จและการแก้ไขเสร็จ เป็นคนละขั้นตอน',
    '<div class="three">'+
    detail('07','ได้รับเรื่องแล้ว','ตรวจข้อมูลบนการ์ดก่อนปิดแชท',10,'lavender',[
        'ต้องเห็นการ์ด “รับเรื่องแล้ว” พร้อมเลข Ticket',
        'ตรวจประเภทเรื่อง สาขา ชื่อผู้แจ้ง และรายละเอียด',
        'เก็บเลข Ticket ไว้อ้างอิงทุกครั้งที่ติดต่อทีม IT'])+
    detail('08','เช็กความคืบหน้า','ใช้เลขเรื่องเดิมในการติดตาม',11,'aqua',[
        'กด “เช็คสถานะเรื่องนี้” ใต้การ์ด',
        'หรือเปิดเมนู “เรื่องที่ฉันแจ้ง”',
        'ถ้ารอข้อมูลเพิ่มเติม ให้ติดต่อทีม IT พร้อมเลข Ticket'])+
    detail('09','ยืนยันผลแก้ไข','ทดสอบจริงจากบัญชี LINE ที่แจ้ง',12,'pink',[
        'เมื่อได้รับผลแก้ไข ให้ทดลองใช้งาน',
        'ใช้งานได้ กด “เรียบร้อยแล้ว” → ดำเนินการเสร็จสิ้น',
        'ยังมีปัญหา กด “ยังไม่หาย” → กลับไปกำลังดำเนินการ'])+
    '</div>'+tip('การพิมพ์ขอบคุณอย่างเดียวไม่แทนการกดปุ่มยืนยัน หากยังไม่ได้รับเลข Ticket ให้ดูว่าบอทรอข้อมูลใด ก่อนเริ่มแจ้งเรื่องเดิมซ้ำ'))

def service(number,title,color,lead,items,example,warning):
    return f'<article class="service {color}"><div class="card-head"><span class="badge">{number}</span><h2>{e(title)}</h2></div><p class="lead">{e(lead)}</p>{steps(items)}<div class="example"><b>ตัวอย่างข้อมูลที่ควรเตรียม</b><p>{e(example)}</p></div><div class="service-note">{e(warning)}</div></article>'

add('นอกจากแจ้งซ่อม ยังทำอะไรได้อีก','เลือกบริการให้ตรง แล้วตรวจการ์ดรับเรื่องทุกครั้ง',
    '<div class="three services">'+
    service('A','เบิกอุปกรณ์','yellow','เลือกจากรายการที่บอทแสดง',[
        'เลือกบริษัทและสาขาตามที่บอทถาม',
        'เลือกอุปกรณ์ในสต็อก และกรอกจำนวนเป็นตัวเลข',
        'เพิ่มรายการอื่นได้ตามตัวเลือก แล้วตรวจจำนวนทั้งหมด',
        'ระบุหรือยืนยันชื่อผู้เบิกให้ถูกคน',
        'ตรวจการ์ดรับเรื่องและเลข Ticket'],
        'เมาส์ 1 ชิ้น • คีย์บอร์ด 1 ชิ้น • สาขาปลายทาง • ชื่อผู้รับ',
        'เมื่อยืนยันผู้เบิกครบ ระบบส่งเรื่องทันที ไม่มีขั้นถามรายละเอียดเพิ่มเติม จึงต้องตรวจรายการก่อนยืนยัน')+
    service('B','คืนอุปกรณ์','aqua','ระบุเครื่องและสภาพที่ส่งคืน',[
        'เลือก “คืนอุปกรณ์” และบริษัท / สาขา',
        'เลือกทรัพย์สินหรือพิมพ์รหัสให้ตรงเครื่อง',
        'ระบุผู้คืน และข้อมูลสภาพอุปกรณ์',
        'ไม่มีรายละเอียดเพิ่ม กด “ไม่มี ส่งเลย” เมื่อปุ่มแสดง',
        'ตรวจเลข Ticket และประสานส่งมอบกับ IT'],
        'รหัสเครื่อง • ผู้คืน • สภาพเครื่อง • สายชาร์จหรืออุปกรณ์ที่คืนพร้อมกัน',
        'การได้เลข Ticket คือรับคำขอคืนแล้ว ยังต้องส่งมอบอุปกรณ์จริงให้ทีม IT')+
    service('C','ขอใช้บริการ IT','pink','อธิบายสิ่งที่ต้องการให้ช่วย',[
        'เลือก “ขอใช้บริการ IT” และบริษัท / สาขา',
        'ระบุผู้แจ้งและทรัพย์สินที่เกี่ยวข้อง ถ้ามี',
        'บอกงานที่ต้องการและข้อมูลประกอบให้ครบ',
        'ส่งรายละเอียดแล้วตรวจการ์ดรับเรื่อง',
        'ติดตามความคืบหน้าด้วยเลข Ticket'],
        'ขอติดตั้งโปรแกรมบัญชี • ย้ายข้อมูลเครื่องเดิม • ขอสิทธิ์เข้าโฟลเดอร์แผนก',
        'งานบริการไม่จำเป็นต้องมีรหัสทรัพย์สิน แต่ต้องบอกสิ่งที่ต้องการให้ช่วยอย่างชัดเจน')+
    '</div>'+tip('หากองค์กรเปิดใช้แบบฟอร์ม LIFF ใช้ลิงก์ที่ทีม IT ให้ไว้ แล้วกรอกชื่อ ประเภทเรื่อง บริษัท สาขา ทรัพย์สิน (ถ้ามี) และรายละเอียด ก่อนกด “ส่งเรื่อง”'))

statuses=[('รอดำเนินการ','ระบบรับเรื่องแล้ว รอทีม IT ตรวจ'),('กำลังดำเนินการ','ทีม IT กำลังตรวจหรือแก้ไข'),('รอข้อมูล','ต้องให้ข้อมูลเพิ่มเติมกับทีม IT'),('รอส่งมอบ','รออุปกรณ์ / อะไหล่ / จัดส่ง'),('แก้ไขแล้ว','ให้ทดสอบและกดปุ่มยืนยันผล'),('ดำเนินการเสร็จสิ้น','ผู้แจ้งยืนยันว่าเรียบร้อยแล้ว'),('ปิดแล้ว / ยกเลิก','เรื่องสิ้นสุดหรือยุติ หากยังต้องการบริการให้ติดต่อ IT')]
lookups=[('สต็อกคงเหลือ','“คีย์บอร์ดเหลือกี่อัน”'),('เรื่องที่ฉันแจ้ง','“เรื่องที่ฉันแจ้งไว้ถึงไหนแล้ว”'),('ทรัพย์สินของฉัน','ตรวจอุปกรณ์ที่เกี่ยวข้องกับตนเอง'),('ค้นหาทรัพย์สิน','พิมพ์รหัสอุปกรณ์ที่ต้องการค้น'),('คำถามที่พบบ่อย','เลือกหัวข้อ หรือพิมพ์อาการสั้น ๆ')]
add('เช็กข้อมูลเองได้ อ่านสถานะให้เป็น','ใช้เมนูเช็กข้อมูลและคำถามที่พบบ่อยใน LINE',
    '<div class="two"><article class="panel aqua"><h2>อยากรู้อะไร ลองถามบอท</h2><div class="lookup-list">'+''.join(f'<div><b>{e(a)}</b><span>{e(b)}</span></div>' for a,b in lookups)+'</div><div class="example"><b>ลองทำตามคำแนะนำแล้ว ยังแก้ไม่ได้?</b><p>กดแจ้งเรื่องใหม่ พร้อมอธิบายอาการที่ยังพบ การอ่าน FAQ อย่างเดียวยังไม่สร้าง Ticket</p></div></article><article class="panel lavender"><h2>สถานะนี้ หมายความว่าอย่างไร</h2><div class="status-list">'+''.join(f'<div><b class="s{i}">{e(a)}</b><span>{e(b)}</span></div>' for i,(a,b) in enumerate(statuses))+'</div><p class="small">ใน LINE “รอส่งมอบ” อาจแสดงเป็น “รออะไหล่/จัดส่ง” และ “แก้ไขแล้ว” อาจแสดงเป็น “แก้ไขเสร็จแล้ว”</p></article></div>'+tip('สถานะ “แก้ไขแล้ว” ยังต้องให้ผู้แจ้งทดสอบและยืนยัน กด “ยังไม่หาย” หากปัญหายังอยู่ เพื่อให้ทีม IT ตรวจต่อ'))

problems=[('ไม่เห็นเมนู','แตะแถบ “เมนู IT” ด้านล่างห้องแชท'),('สาขาหรือประเภทเรื่องผิด','ถ้ายังไม่ส่ง พิมพ์ “ยกเลิก” แล้วเริ่มใหม่'),('ไม่ทราบรหัสทรัพย์สิน','ใช้ “ไม่มี / ไม่ทราบ” แล้วอธิบายอุปกรณ์'),('ชื่อผู้แจ้งผิด','กดเปลี่ยนคนแจ้ง หรือเปลี่ยนผู้เบิกบนการ์ด'),('ยังไม่ได้เลข Ticket','อ่านข้อความล่าสุดและตอบขั้นตอนที่ยังค้าง'),('ยืนยันผลไม่ได้','ใช้บัญชี LINE ที่แจ้ง และตรวจสถานะรอยืนยัน'),('ส่งไฟล์หรือวิดีโอไม่ได้','ใช้ข้อความและรูปภาพตามที่บอทรองรับ'),('บอทไม่ตอบ','ตรวจอินเทอร์เน็ต เก็บเวลาและภาพ แล้วติดต่อ IT')]
add('ติดตรงไหน? เช็กก่อนแจ้งซ้ำ','เก็บเลข Ticket ไว้ ช่วยให้ติดตามเรื่องเดิมได้ง่าย',
    '<div class="two final-grid"><article class="panel yellow"><h2>ปัญหาที่พบบ่อย</h2><div class="problem-list">'+''.join(f'<div><b>{e(a)}</b><span>{e(b)}</span></div>' for a,b in problems)+'</div></article><article class="panel pink"><h2>เช็กครบ ก่อนจบเรื่อง</h2><div class="check-group"><h3>ก่อนส่ง</h3>'+bullets(['บริษัทและสาขาถูกต้อง','ชื่อผู้แจ้งถูกคน อุปกรณ์ถูกเครื่อง','รายละเอียดและรูปที่เกี่ยวข้องครบ'])+'<h3>หลังส่ง</h3>'+bullets(['ได้การ์ด “รับเรื่องแล้ว” และเลข Ticket','ติดตามจากเรื่องเดิม เพื่อไม่แจ้งซ้ำ'])+'<h3>หลังทีม IT แก้ไข</h3>'+bullets(['ทดสอบจริงแล้วกดปุ่มยืนยันผล','ตรวจข้อความตอบกลับและสถานะล่าสุด'])+'</div><div class="contact"><b>ติดต่อ IT พร้อมข้อมูลนี้</b><p>เลข Ticket • วันเวลา • บริษัท / สาขา<br>อาการที่พบ • ภาพประกอบ</p></div></article></div><p class="source-note">ฉบับ 1.2 • 2 ตุลาคม 2569 | ขั้นตอนอ้างอิงระบบในโครงการและภาพที่จัดเตรียมไว้ ภาพแสดงข้อมูล ณ เวลาถ่าย ไม่ใช่ยอดปัจจุบัน</p>')

CSS='''
@page{size:320mm 180mm;margin:0}*{box-sizing:border-box}html,body{margin:0}body{font-family:Thai,sans-serif;color:#293044;background:#e5e8f0;font-size:18px;line-height:1.55}h1,h2,h3,p,figure{margin:0}h1,h2,h3,b,strong{font-weight:700}.page{position:relative;width:1600px;height:900px;margin:24px auto;padding:28px 40px 42px;overflow:hidden;break-after:page;background-color:#fafbf9;background-image:linear-gradient(#dfe6e747 1px,transparent 1px),linear-gradient(90deg,#dfe6e747 1px,transparent 1px);background-size:30px 30px}.page:last-child{break-after:auto}.page:before{content:'';position:absolute;left:-38px;top:-35px;width:150px;height:150px;border:16px solid #c0dbed;border-radius:50%;opacity:.45;pointer-events:none}.header{position:relative;height:138px;display:flex;align-items:flex-start;gap:18px}.logo{width:78px;height:78px;flex:0 0 auto;background-image:var(--logo);background-size:contain;background-repeat:no-repeat}.heading{flex:1}.eyebrow{font-size:13px;letter-spacing:1.4px;font-weight:700;color:#587986;margin-bottom:4px}.heading h1{font-size:39px;line-height:1.6;display:inline;box-decoration-break:clone;background:#c6df9d;padding:0 19px 3px;border-radius:50px}.subtitle{margin-top:7px;font-size:20px;display:flex;gap:14px;align-items:center}.subtitle span{padding:2px 15px;background:#ffe28a;border-radius:30px}.qr-box{display:flex;align-items:center;gap:10px;background:white;border:2px solid #293044;border-radius:17px;padding:8px 13px;box-shadow:4px 4px 0 #c6deeb;font-size:14px;line-height:1.6}.qr-box img{width:80px;height:80px}.qr-box b{font-size:18px}.qr-box a{color:inherit;text-decoration:none}.five,.three,.two{display:grid;gap:24px}.five{grid-template-columns:repeat(5,1fr);gap:22px}.three{grid-template-columns:repeat(3,1fr)}.two{grid-template-columns:1fr 1fr}.lavender{--tone:#d2dcff;--accent:#98aef5}.aqua{--tone:#d4f0ee;--accent:#82ccd0}.lime{--tone:#e7f0ce;--accent:#b6d775}.yellow{--tone:#fff0bf;--accent:#ffda68}.pink{--tone:#fbe1ef;--accent:#f2a9d1}.card,.detail,.service,.panel{position:relative;border:2px solid #303548;border-radius:20px 14px 22px 12px;background:var(--tone);box-shadow:6px 6px 0 var(--accent)}.card{height:590px;padding:20px 14px 12px;display:flex;align-items:center;flex-direction:column}.card:not(:last-child):after{content:'↝';position:absolute;right:-27px;top:245px;z-index:3;font-size:35px;font-weight:700;color:#303548}.card-head{display:flex;align-items:center;gap:12px;width:100%;margin-bottom:12px}.badge{display:inline-flex;align-items:center;justify-content:center;background:var(--accent);border:2px solid #303548;min-width:47px;height:47px;border-radius:50%;font-size:24px;font-weight:700;box-shadow:2px 2px 0 white;flex-shrink:0}.card h2{font-size:24px;line-height:1.4}.desc{font-size:18px;line-height:1.5}.card .desc{text-align:center;min-height:58px}.phone{position:relative;flex:none;border:5px solid #25262f;border-radius:25px;background:white;padding:3px;box-shadow:0 5px 0 #29304425;overflow:hidden;width:176px;margin:12px auto}.phone img{display:block;width:100%;height:auto;border-radius:16px}.tail{font-size:16px;line-height:1.5;text-align:center;margin-top:auto;font-weight:700}.service-strip{margin-top:24px;display:flex;align-items:center;justify-content:center;gap:12px;font-size:16px}.tag{display:inline-block;background:white;border:1.5px solid #303548;border-radius:24px;padding:5px 20px;font-weight:700}.service-strip>span:last-child{margin-left:16px}.detail{height:566px;padding:20px}.detail h2{font-size:28px}.detail>.desc{margin-bottom:15px}.detail-row{display:flex;align-items:flex-start;gap:19px}.detail .phone{width:183px;margin:0}.instructions{flex:1;padding-top:4px}.instructions ol{font-size:17px;line-height:1.65}.instructions li{margin-bottom:18px}ol{list-style:none;counter-reset:step;margin:0;padding:0}ol li{position:relative;padding-left:27px;margin-bottom:13px}ol li:before{counter-increment:step;content:counter(step);position:absolute;left:0;top:3px;background:#fff9;width:21px;height:21px;border-radius:50%;text-align:center;font-size:13px;font-weight:700;line-height:21px}.tip{display:flex;gap:16px;align-items:center;background:#fff;border:1.5px dashed #718394;border-radius:14px;padding:13px 20px;margin-top:24px;font-size:17px;line-height:1.6}.tip b{background:#ffe48e;padding:5px 13px;border-radius:20px;white-space:nowrap}.footer{position:absolute;bottom:15px;left:40px;right:40px;display:flex;justify-content:space-between;font-size:12px;font-weight:700;letter-spacing:.2px}.service{height:580px;padding:24px}.service h2{font-size:29px}.service .lead{margin:12px 0 18px;font-size:20px;font-weight:700}.service ol{font-size:19px;line-height:1.65}.example{background:#ffffffb8;border-radius:14px;padding:16px 18px;margin-top:20px;font-size:17px}.example p{margin-top:8px}.service-note{border-top:1.5px dashed #58626e;margin-top:19px;padding-top:17px;font-size:17px;line-height:1.65}.services+.tip{font-size:16px}.panel{height:565px;padding:25px 30px}.panel h2{font-size:29px;margin-bottom:20px}.lookup-list>div,.status-list>div,.problem-list>div{display:flex;gap:20px;padding:13px 0;border-bottom:1px dashed #71839466;align-items:center}.lookup-list b{min-width:195px}.lookup-list span{font-size:18px}.status-list>div{padding:10px 0}.status-list b{font-size:17px;width:205px;flex-shrink:0;padding:4px 10px;border-radius:20px;background:#fff9;text-align:center}.status-list span{font-size:18px}.small{font-size:14px;margin-top:17px}.problem-list>div{padding:10px 0;font-size:17px}.problem-list b{min-width:203px}.problem-list span{font-size:17px}.final-grid{grid-template-columns:1.12fr 1fr}.final-grid .panel{height:595px}.check-group{display:grid;grid-template-columns:140px 1fr;gap:10px 15px}.check-group h3{font-size:22px;padding-top:6px}.check-group ul{list-style:none;margin:0;padding:0;font-size:18px}.check-group li{position:relative;padding-left:25px;margin:6px 0}.check-group li:before{content:'✓';position:absolute;left:0;font-weight:700;color:#28726e}.contact{margin-top:24px;background:white;border-radius:15px;padding:18px 20px}.contact p{margin-top:5px}.source-note{font-size:13px;line-height:1.6;margin-top:20px;text-align:center}a{color:inherit}@media print{body{background:white}.page{margin:0;width:320mm;height:180mm;zoom:.7559055}}@media screen{.page{box-shadow:0 8px 40px #24304722}}
'''
font=uri('line-oa/fonts/NotoSansThai-Regular.ttf')
bold=uri('line-oa/fonts/NotoSansThai-Bold.ttf')
CSS='@font-face{font-family:Thai;src:url("'+font+'")}@font-face{font-family:Thai;src:url("'+bold+'");font-weight:700}'+CSS
CSS+='body{--logo:url("'+uri('line-oa/source/logo-source.png')+'")}'
CSS+='@media print{.page{width:1600px;height:900px;zoom:.7559055}}'
sections=[]
for i,pg in enumerate(P,1):
    qr=f'<div class="qr-box"><img src="{uri("qr/line-oa-qr.png")}" alt="QR เพิ่มเพื่อน IT Support"><a href="https://line.me/R/ti/p/@891ujhzo"><b>สแกนเพิ่มเพื่อน</b><br>IT-Support-Admin<br>@891ujhzo</a></div>'
    header=f'<header class="header"><div class="logo" role="img" aria-label="โลโก้ IT Support"></div><div class="heading"><div class="eyebrow">IT SUPPORT / USER GUIDE</div><h1>{e(pg["title"])}</h1><div class="subtitle"><span>{e(pg["subtitle"])}</span></div></div>{qr}</header>'
    footer=f'<footer class="footer"><span>IT-Support-Admin · คู่มือสำหรับพนักงาน · 2 ตุลาคม 2569</span><span>{i:02} / {len(P):02}</span></footer>'
    sections.append(f'<section class="page {pg["klass"]}">{header}<main>{pg["content"]}</main>{footer}</section>')
doc='<!doctype html><html lang="th"><meta charset="utf-8"><title>คู่มือผู้ใช้ IT Support — ฉบับภาพประกอบ</title><style>'+CSS+'</style><body>'+''.join(sections)+'</body></html>'
(OUT/f'{STEM}.html').write_text(doc,encoding='utf-8')
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True)
    page=browser.new_page(viewport={'width':1700,'height':1000},device_scale_factor=1.5)
    page.goto((OUT/f'{STEM}.html').as_uri())
    page.evaluate('document.fonts.ready')
    page.wait_for_function('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
    layout=page.evaluate('''()=>Array.from(document.querySelectorAll('.page')).map((p,i)=>({page:i+1,title:p.querySelector('h1').innerText,overflow:p.querySelector('main').getBoundingClientRect().bottom>p.querySelector('footer').getBoundingClientRect().top-5,boxes:Array.from(p.querySelectorAll('.card,.detail,.service,.panel')).filter(b=>b.scrollHeight>b.clientHeight+2).map(b=>b.querySelector('h2').innerText)}))''')
    for i in range(len(P)):
        page.locator('.page').nth(i).screenshot(path=str(OUT/f'page-{i+1:02}.png'))
    # Print the 1600 x 900 canvas at an exact 16:9 physical page size.
    page.emulate_media(media='screen')
    page.add_style_tag(content='@page{size:1600px 900px;margin:0}.page{width:1600px;height:900px;margin:0;zoom:1;box-shadow:none}')
    page.pdf(path=str(OUT/f'{STEM}.pdf'),width='1600px',height='900px',print_background=True,prefer_css_page_size=False,margin={'top':'0','right':'0','bottom':'0','left':'0'})
    browser.close()
pdf=(OUT/f'{STEM}.pdf').read_bytes()
report={'pages':len(P),'pdf_pages':len(re.findall(rb'/Type /Page\b',pdf)),'layout':layout,'reference_url':REF}
(OUT/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
with zipfile.ZipFile(OUT/'IT-Support-User-Guide-Images.zip','w',zipfile.ZIP_DEFLATED) as z:
    for img in sorted(OUT.glob('page-*.png')): z.write(img,img.name)
print(json.dumps(report,ensure_ascii=True))
