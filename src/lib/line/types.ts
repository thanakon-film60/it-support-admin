// Type ขั้นต่ำสำหรับ payload ที่ LINE Messaging API ส่งเข้า webhook
// (ไม่ครอบคลุมทุก event type ของจริง — ใส่เฉพาะส่วนที่ระบบนี้ใช้งาน)

export interface LineEventSource {
  type: "user" | "group" | "room";
  userId?: string;
}

export interface LineMessageObject {
  id: string;
  type: "text" | "image" | "sticker" | "video" | "audio" | "file" | "location";
  text?: string;
}

export interface LineEvent {
  type: "message" | "follow" | "unfollow" | "postback" | "join" | "leave" | string;
  replyToken?: string;
  source: LineEventSource;
  timestamp: number;
  message?: LineMessageObject;
}

export interface LineWebhookBody {
  destination: string;
  events: LineEvent[];
}
