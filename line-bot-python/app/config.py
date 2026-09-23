"""ค่า config ทั้งหมดของ bot — อ่านจาก environment variable / ไฟล์ .env

ใช้ pydantic-settings แทนการอ่าน os.environ ตรงๆ เพราะ:
  1. validate ตั้งแต่ตอน start ถ้าค่าจำเป็นหาย service จะตายทันทีพร้อมบอกว่าขาดตัวไหน
     (ดีกว่าไปพังตอน user ทักเข้ามาจริง แล้วได้ KeyError กลางทาง)
  2. มี type ชัดเจน ไม่ต้อง cast เอง
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ----- LINE Messaging API -----
    # เอามาจาก LINE Developers Console > channel ของคุณ
    #   channel_secret       -> แท็บ "Basic settings"
    #   channel_access_token -> แท็บ "Messaging API" (กด Issue ถ้ายังไม่มี)
    line_channel_secret: str = ""
    line_channel_access_token: str = ""
    # ปล่อยว่างไว้เสมอในการใช้งานจริง — มีไว้ชี้ไปเซิร์ฟเวอร์จำลองตอนทดสอบ e2e เท่านั้น
    line_api_host: str = ""
    # โดเมนสำหรับ "ดาวน์โหลดไฟล์" ของ LINE — คนละตัวกับ api.line.me ที่ใช้ส่งข้อความ
    # ยิงผิดโดเมนจะได้ 404 (กับดักเดียวกับตอนอัปโหลดรูป rich menu ที่ต้องใช้ api-data.line.me)
    line_blob_host: str = "https://api-data.line.me"

    # ----- ระบบ ticket (Next.js) -----
    backend_base_url: str = "http://localhost:3000"
    internal_api_key: str = ""
    backend_timeout_seconds: float = 10.0

    # ----- เก็บ state ของบทสนทนา -----
    # ถ้าใส่ redis_url จะใช้ Redis อัตโนมัติ ถ้าเว้นว่างจะใช้ in-memory (เหมาะกับ dev เท่านั้น)
    redis_url: str = ""
    session_ttl_seconds: int = 1800  # 30 นาที — ทิ้ง session ที่คุยค้างไว้ ไม่ให้ค้างในหน่วยความจำถาวร

    # หายไปนานกว่ากี่วันถึงจะทักต้อนรับกลับอีกครั้งตอนพิมพ์เข้ามา
    # ตั้ง 0 เพื่อปิด (คนเก่าจะไม่ถูกทักเลย) — 7 วันคือ "ไม่ได้ใช้มาทั้งสัปดาห์"
    # ซึ่งนานพอที่คนจะลืมว่าบอทนี้ทำอะไรได้ แต่ไม่ถี่จนคนที่ใช้ประจำรำคาญ
    welcome_back_days: int = 7

    # ----- ชั้น AI -----
    # การตัดคำไทย + TF-IDF ทำงานเสมอโดยไม่ต้องตั้งค่าอะไรและไม่มีค่าใช้จ่าย
    # ส่วนตรงนี้คือชั้นเสริมที่ให้ LLM เรียบเรียงคำตอบจาก FAQ ที่ค้นเจอ (RAG)
    # ปิดไว้เป็นค่าตั้งต้น เพราะมีค่าใช้จ่ายต่อครั้งและต้องต่อเน็ตออกนอกองค์กร
    ai_provider: str = "none"  # none | openai | anthropic
    ai_api_key: str = ""
    ai_model: str = ""  # เช่น gpt-4o-mini หรือ claude-3-5-haiku-latest
    ai_timeout_seconds: float = 12.0
    knowledge_ttl_seconds: int = 300  # cache ข้อมูลจาก DB นานแค่ไหนก่อนดึงใหม่

    # ----- รูปที่ผู้ใช้ส่งเข้ามา -----
    # ปิดได้ด้วย ACCEPT_IMAGES=false ถ้าไม่อยากให้บอทรับรูปเลย
    accept_images: bool = True
    # รูปจากกล้องมือถือปกติ 1-4 MB — เกินนี้ถือว่าผิดปกติ ไม่ดาวน์โหลดต่อ
    # (ฝั่ง Next.js มีลิมิตของตัวเองที่ 10 MB อีกชั้น — ตรงนี้กันไม่ให้เสียเวลาโหลดมาก่อน)
    max_image_bytes: int = 10 * 1024 * 1024
    # จำนวนรูปสูงสุดต่อ 1 ticket — กันคนส่งรัวจนเปลือง session และดิสก์
    max_images_per_ticket: int = 5

    # ----- Rich menu -----
    # ติดตั้ง rich menu ให้อัตโนมัติตอนบอทสตาร์ท (idempotent — มีอยู่แล้วจะข้าม)
    # ปิดได้ถ้าอยากจัดการเมนูเองด้วย line-oa/setup_richmenu.py
    richmenu_auto_install: bool = True
    # path ในคอนเทนเนอร์ — docker-compose mount ./line-oa/assets มาไว้ที่นี่
    richmenu_image_path: str = "/app/line-oa/richmenu-main.png"
    # รูปเมนูชั้นที่ 2 (เช็คข้อมูล) — ถ้าไม่มีไฟล์นี้ จะติดตั้งเป็นเมนูเดียวแบบเดิมให้อัตโนมัติ
    richmenu_data_image_path: str = "/app/line-oa/richmenu-data.png"
    # บังคับติดตั้งใหม่แม้มีอยู่แล้ว (ใช้ตอนเปลี่ยนรูปหรือเปลี่ยนปุ่ม แล้วค่อยตั้งกลับเป็น false)
    richmenu_force_reinstall: bool = False

    # ----- กันสแปม -----
    # จำนวน event สูงสุดต่อผู้ใช้ 1 คนต่อนาที (0 = ปิดการจำกัด)
    # ทำไมต้องมี: ทุก event ที่เข้ามาถูกแปลงเป็นการเรียก /api/internal/* ฝั่ง Next.js อย่างน้อย 1 ครั้ง
    # ถ้ามีคนกดรัวหรือสคริปต์ยิงเข้ามา ภาระจะไปตกที่ระบบแอดมินทั้งหมด
    # 20/นาที = พิมพ์ได้ทุก 3 วินาทีต่อเนื่อง ซึ่งเกินพฤติกรรมคนปกติอยู่มาก
    rate_limit_per_minute: int = 20

    # ----- อื่นๆ -----
    # เวลาสูงสุดที่ยอมให้ประมวลผล 1 event ก่อนตัดจบ (reply token ของ LINE มีอายุสั้นมาก)
    event_timeout_seconds: float = 12.0
    log_level: str = "INFO"
    # ----- แจ้งเตือนเข้า LINE (ผู้ดูแล) -----
    # comma-separated list of user IDs (หรือ group/room id) ที่จะรับการแจ้งเตือนเมื่อมี ticket ใหม่
    # ตัวอย่าง: LINE_NOTIFY_TARGETS="Uxxxx...,Uyyyy..."
    line_notify_targets: str = ""

    @property
    def use_redis(self) -> bool:
        return bool(self.redis_url.strip())

    @property
    def use_llm(self) -> bool:
        """เปิดชั้น LLM ก็ต่อเมื่อตั้งค่าครบทั้ง 3 อย่างเท่านั้น — กันเปิดครึ่งๆ กลางๆ แล้วพังตอน runtime"""
        return (
            self.ai_provider.strip().lower() in {"openai", "anthropic"}
            and bool(self.ai_api_key.strip())
            and bool(self.ai_model.strip())
        )

    def require_line_credentials(self) -> None:
        """เรียกตอน startup — ให้ fail เร็วและบอกชัดว่าขาดอะไร"""
        missing = [
            name
            for name, value in (
                ("LINE_CHANNEL_SECRET", self.line_channel_secret),
                ("LINE_CHANNEL_ACCESS_TOKEN", self.line_channel_access_token),
                ("INTERNAL_API_KEY", self.internal_api_key),
            )
            if not value.strip()
        ]
        if missing:
            raise RuntimeError(
                "ขาดค่า environment ต่อไปนี้: " + ", ".join(missing) + " — ดูตัวอย่างที่ .env.example"
            )

    @property
    def notify_targets(self) -> list[str]:
        return [t.strip() for t in (self.line_notify_targets or "").split(",") if t.strip()]


settings = Settings()
