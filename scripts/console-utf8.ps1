#Requires -Version 5.1
<#
    ทำให้ข้อความภาษาไทยในหน้าต่าง cmd/PowerShell อ่านออก

    อาการที่เจอ: ข้อความไทยกลายเป็นสี่เหลี่ยมทึบ [][][] หรือเครื่องหมายคำถาม
    ซึ่งมีต้นเหตุคนละเรื่องกัน 2 อย่าง และต้องแก้ทั้งคู่:

      1. code page / encoding ผิด -> ตัวอักษรถูก "แปลงเสีย" ตั้งแต่ตอนเขียนออกจอ
         ก๊อปไปวางที่อื่นก็ยังอ่านไม่ออก แก้ด้วย chcp 65001 + [Console]::OutputEncoding

      2. ฟอนต์ของหน้าต่างไม่มีตัวอักษรไทย -> ตัวอักษร "ถูกต้อง" แต่วาดไม่ได้เลยเห็นเป็นสี่เหลี่ยม
         (สังเกตได้จาก: ก๊อปข้อความไปวางใน Notepad แล้วอ่านออกปกติ)
         ฟอนต์ตั้งต้นของ cmd คือ Consolas ซึ่ง "ไม่มี" ตัวอักษรไทย ส่วน Courier New มี
         แก้ด้วยการสลับฟอนต์ของหน้าต่างที่กำลังรันอยู่ผ่าน SetCurrentConsoleFontEx

    Windows Terminal ไม่มีปัญหาข้อ 2 เพราะมันหาฟอนต์สำรองให้เอง — ถ้าเครื่องมี ใช้อันนั้นดีที่สุด
#>

function Initialize-ThaiConsole {
    # ---- 1. encoding ----
    # ถึง deploy.bat จะสั่ง chcp 65001 มาแล้ว แต่ PowerShell จำค่า OutputEncoding
    # ไว้ตั้งแต่ตอนสตาร์ท การตั้งซ้ำตรงนี้จึงจำเป็น ไม่ใช่การทำงานซ้ำซ้อน
    try {
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [Console]::OutputEncoding = $utf8
        $global:OutputEncoding = $utf8
    } catch { }

    # ---- 2. ฟอนต์ ----
    # Windows Terminal ตั้ง WT_SESSION ไว้ให้ — ถ้าอยู่ในนั้นอยู่แล้วไม่ต้องยุ่งกับฟอนต์
    if ($env:WT_SESSION) { return }

    $switched = $false
    try {
        if (-not ('ConsoleFontHelper' -as [type])) {
            Add-Type -ErrorAction Stop -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class ConsoleFontHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CONSOLE_FONT_INFO_EX
    {
        public uint cbSize;
        public uint nFont;
        public short dwFontSizeX;
        public short dwFontSizeY;
        public uint FontFamily;
        public uint FontWeight;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string FaceName;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool SetCurrentConsoleFontEx(IntPtr hConsoleOutput, bool bMaximumWindow,
                                               ref CONSOLE_FONT_INFO_EX lpConsoleCurrentFontEx);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool GetCurrentConsoleFontEx(IntPtr hConsoleOutput, bool bMaximumWindow,
                                               ref CONSOLE_FONT_INFO_EX lpConsoleCurrentFontEx);

    public static string CurrentFace()
    {
        var info = new CONSOLE_FONT_INFO_EX();
        info.cbSize = (uint)Marshal.SizeOf(info);
        if (!GetCurrentConsoleFontEx(GetStdHandle(-11), false, ref info)) { return null; }
        return info.FaceName;
    }

    public static bool Use(string faceName, short height)
    {
        var info = new CONSOLE_FONT_INFO_EX();
        info.cbSize = (uint)Marshal.SizeOf(info);
        if (!GetCurrentConsoleFontEx(GetStdHandle(-11), false, ref info)) { return false; }
        info.FaceName = faceName;
        info.dwFontSizeX = 0;              // 0 = ให้ระบบเลือกความกว้างที่เข้าคู่กับความสูง
        info.dwFontSizeY = height;
        info.FontFamily = 54;              // TMPF_TRUETYPE | TMPF_VECTOR | FF_MODERN
        info.FontWeight = 400;             // ปกติ (ไม่หนา)
        return SetCurrentConsoleFontEx(GetStdHandle(-11), false, ref info);
    }
}
'@
        }

        $current = [ConsoleFontHelper]::CurrentFace()
        # ฟอนต์ที่ลงท้ายรายการคือตัวที่มีตัวอักษรไทยแน่นอนและมากับ Windows ทุกเครื่อง
        # ไล่ลองจากตัวที่หน้าตาใกล้เคียงของเดิมที่สุดก่อน
        foreach ($face in @('Courier New', 'MS Gothic')) {
            if ($current -eq $face) { $switched = $true; break }
            if ([ConsoleFontHelper]::Use($face, 16)) { $switched = $true; break }
        }
    } catch {
        $switched = $false
    }

    if (-not $switched) {
        # เขียนเป็นภาษาอังกฤษโดยตั้งใจ — ถ้าฟอนต์ไทยใช้ไม่ได้ ข้อความไทยตรงนี้ก็จะอ่านไม่ออกด้วย
        Write-Host "  Note: Thai text may show as boxes in this window." -ForegroundColor DarkYellow
        Write-Host "        Fix: right-click the title bar > Properties > Font > Courier New" -ForegroundColor DarkYellow
        Write-Host "        (or run this from Windows Terminal, which handles Thai automatically)" -ForegroundColor DarkYellow
    }
}
