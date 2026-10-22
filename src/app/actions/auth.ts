"use server";

import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth";
import { landingPath, safeRedirectPath } from "@/lib/access";

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  // ค่านี้มาจาก ?from= ใน URL ซึ่งใครก็แต่งได้ — ผ่าน safeRedirectPath ก่อนเสมอ (กัน open redirect)
  const redirectTo = safeRedirectPath(formData.get("redirectTo"));

  if (!username || !password) {
    return { error: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" };
  }

  const result = await signIn(username, password);
  if (!result.ok) {
    return { error: result.error };
  }

  // ไม่ได้ขอหน้าไหนเป็นพิเศษ = พาไปหน้าแรกที่ "มีสิทธิ์" — เจ้าหน้าที่ที่ไม่ได้รับสิทธิ์หน้าภาพรวม
  // จะได้ไม่เจอหน้า "ไม่มีสิทธิ์" เป็นอย่างแรกหลังล็อกอินทุกครั้ง
  redirect(redirectTo === "/" ? landingPath(result.session.pages) : redirectTo);
}

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect("/login");
}
