"""ให้เทสต์ import tools/staff_admin.py ได้ไม่ว่าจะสั่ง pytest จากโฟลเดอร์ไหน

รัน:  py -m pytest tools/tests          (Windows)
      python3 -m pytest tools/tests     (Linux/macOS — เทสต์หน้าจอข้ามเองถ้าไม่มีจอ/ไม่มี tkinter)
"""

from __future__ import annotations

import sys
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent.parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))
