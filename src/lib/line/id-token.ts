import "server-only";

const LINE_ID_TOKEN_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";

interface LineIdTokenPayload {
  sub?: string;
  aud?: string;
  name?: string;
}

export interface VerifiedLiffIdentity {
  userId: string;
  displayName: string;
}

/** Verify the raw LIFF ID token with LINE before trusting the user's identity. */
export async function verifyLiffIdToken(
  idToken: string
): Promise<VerifiedLiffIdentity | null> {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID?.trim();
  if (!channelId) {
    throw new Error("ไม่ได้ตั้งค่า LINE_LOGIN_CHANNEL_ID");
  }

  const token = idToken.trim();
  if (!token) return null;

  const response = await fetch(LINE_ID_TOKEN_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: token, client_id: channelId }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    console.warn(`[LINE LIFF] ID token verification failed: ${response.status}`);
    return null;
  }

  const payload = (await response.json()) as LineIdTokenPayload;
  if (!payload.sub || payload.aud !== channelId) return null;

  return {
    userId: payload.sub,
    displayName: payload.name?.trim() || "ผู้ใช้ LINE",
  };
}
