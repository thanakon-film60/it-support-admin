import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // โฟลเดอร์ชั่วคราวของสคริปต์ช่วยงาน ไม่ใช่โค้ดที่ deploy
    "Claude outputs/**",
  ]),
  {
    // เทสต์กับสคริปต์กลุ่มนี้รันด้วย node ตรงๆ (.cjs) จึงต้องใช้ require()
    // เป็นรูปแบบที่ถูกต้องของไฟล์ .cjs ไม่ใช่ของที่ควรแก้ให้เป็น import
    files: ["tests/**/*.cjs", "scripts/**/*.cjs", "db/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
