#!/usr/bin/env python3
"""环境自检：告诉使用者"现在能做什么、缺什么、怎么补"。

用法：
  python scripts/doctor.py
  python scripts/doctor.py --json

退出码：0 可用（可能有警告）；1 有阻塞项（无法构建/验证）。
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
results: list[dict] = []


def add(name: str, status: str, detail: str, fix: str = "") -> None:
    results.append({"check": name, "status": status, "detail": detail, "fix": fix})


def run(cmd: list[str], timeout: int = 20, cwd: Path | None = None) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                           timeout=timeout, cwd=str(cwd) if cwd else None)
        return p.returncode, (p.stdout or p.stderr or "").strip()
    except FileNotFoundError:
        return 127, "not found"
    except Exception as e:  # noqa: BLE001
        return 1, str(e)


def main() -> int:
    # Python
    if sys.version_info >= (3, 9):
        add("Python", "pass", f"{sys.version_info.major}.{sys.version_info.minor}")
    else:
        add("Python", "fail", f"{sys.version_info.major}.{sys.version_info.minor} < 3.9",
            "安装 Python 3.9+")

    # Node
    code, out = run(["node", "--version"])
    if code == 0:
        major = 0
        try:
            major = int(out.lstrip("v").split(".")[0])
        except ValueError:
            pass
        if major >= 18:
            add("Node.js", "pass", out)
        else:
            add("Node.js", "fail", f"{out} 过低", "升级到 Node 18+")
    else:
        add("Node.js", "fail", "未找到 node",
            "只有构建动画时可以没有 Node；但自动验证需要。安装 Node 18+")

    # 引擎与课程
    engine = ROOT / "assets" / "engine" / "lesson-kit.js"
    add("引擎", "pass" if engine.exists() else "fail",
        str(engine.relative_to(ROOT)) if engine.exists() else "缺少 assets/engine/lesson-kit.js")

    lessons = sorted((ROOT / "examples").rglob("lesson.src.html")) if (ROOT / "examples").exists() else []
    add("课程", "pass", f"{len(lessons)} 个 lesson.src.html")
    stale = 0
    for src in lessons:
        html = src.with_name("lesson.html")
        if not html.exists():
            stale += 1
    if stale:
        add("构建产物", "warn", f"{stale} 个课程尚未构建",
            "python scripts/build_lesson.py --all")

    # 验证依赖
    deps = ROOT / "scripts" / "node_modules"
    has_playwright = (deps / "playwright").exists()
    has_pngjs = (deps / "pngjs").exists()
    if has_playwright and has_pngjs:
        add("验证依赖", "pass", "playwright + pngjs 已安装")
    else:
        add("验证依赖", "warn", "未安装 playwright/pngjs（自动验证不可用）",
            "cd scripts && npm ci   # 约 57 MB")

    # 浏览器
    if has_playwright:
        # 真正启动一次，比检查路径可靠（headless shell 与完整 Chromium 的路径不同）
        code, out = run([
            "node", "-e",
            "const{chromium}=require('playwright');"
            "(async()=>{const b=await chromium.launch();await b.close();console.log('LAUNCH_OK');})"
            "().catch(e=>{console.log('LAUNCH_FAIL '+e.message.split('\\n')[0]);process.exit(1)})"
        ], timeout=90, cwd=ROOT / "scripts")
        if code == 0 and "LAUNCH_OK" in out:
            add("Chromium", "pass", "可启动（headless）")
        else:
            add("Chromium", "warn", f"浏览器无法启动：{out.splitlines()[0][:80] if out else 'unknown'}",
                "npx playwright install chromium   # 约 100 MB")
    else:
        add("Chromium", "skip", "依赖未安装，跳过", "先执行 cd scripts && npm ci")

    # 写权限
    outdir = ROOT / "outputs"
    try:
        outdir.mkdir(parents=True, exist_ok=True)
        probe = outdir / ".doctor-write-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        add("写权限", "pass", str(outdir))
    except Exception as e:  # noqa: BLE001
        add("写权限", "fail", f"无法写入 outputs/: {e}", "检查目录权限")

    # 磁盘
    free = shutil.disk_usage(str(ROOT)).free / 1024 / 1024
    add("磁盘", "pass" if free > 200 else "warn", f"剩余 {free:.0f} MB")

    blocking = [r for r in results if r["status"] == "fail"]
    print("环境自检")
    print("=" * 56)
    for r in results:
        mark = {"pass": "✓", "warn": "!", "fail": "✗", "skip": "-"}[r["status"]]
        print(f"{mark} {r['check']:<10} {r['detail']}")
        if r["fix"]:
            print(f"            → {r['fix']}")
    print("=" * 56)
    if blocking:
        print(f"有 {len(blocking)} 个阻塞项：无法完成构建。")
    else:
        warn = [r for r in results if r["status"] == "warn"]
        print("可以构建动画。" + ("自动验证暂不可用。" if any(r["check"] in ("验证依赖", "Chromium") for r in warn) else "自动验证可用。"))

    if "--json" in sys.argv:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    return 1 if blocking else 0


if __name__ == "__main__":
    sys.exit(main())
