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

    # ----- ระบบ ticket (Next.js) -----
    backend_base_url: str = "http://localhost:3000"
    internal_api_key: str = ""
    backend_timeout_seconds: float = 10.0

    # ----- เก็บ state ของบทสนทนา -----
    # ถ้าใส่ redis_url จะใช้ Redis อัตโนมัติ ถ้าเว้นว่างจะใช้ in-memory (เหมาะกับ dev เท่านั้น)
    redis_url: str = ""
    session_ttl_seconds: int = 1800  # 30 นาที — ทิ้ง session ที่คุยค้างไว้ ไม่ให้ค้างในหน่วยความจำถาวร

    # ----- ชั้น AI -----
    # การตัดคำไทย + TF-IDF ทำงานเสมอโดยไม่ต้องตั้งค่าอะไรและไม่มีค่าใช้จ่าย
    # ส่วนตรงนี้คือชั้นเสริมที่ให้ LLM เรียบเรียงคำตอบจาก FAQ ที่ค้นเจอ (RAG)
    # ปิดไว้เป็นค่าตั้งต้น เพราะมีค่าใช้จ่ายต่อครั้งและต้องต่อเน็ตออกนอกองค์กร
    ai_provider: str = "none"  # none | openai | anthropic
    ai_api_key: str = ""
    ai_model: str = ""  # เช่น gpt-4o-mini หรือ claude-3-5-haiku-latest
    ai_timeout_seconds: float = 12.0
    knowledge_ttl_seconds: int = 300  # cache ข้อมูลจาก DB นานแค่ไหนก่อนดึงใหม่

    # ----- อื่นๆ -----
    # เวลาสูงสุดที่ยอมให้ประมวลผล 1 event ก่อนตัดจบ (reply token ของ LINE มีอายุสั้นมาก)
    event_timeout_seconds: float = 12.0
    log_level: str = "INFO"

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


settings = Settings()
