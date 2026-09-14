"use server";

import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth";

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirectTo") ?? "/");

  if (!username || !password) {
    return { error: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" };
  }

  const result = await signIn(username, password);
  if (!result.ok) {
    return { error: result.error };
  }

  redirect(redirectTo || "/");
}

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect("/login");
}
