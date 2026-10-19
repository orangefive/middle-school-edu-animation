#!/usr/bin/env python3
"""把 lesson.src.html（引用共享引擎）构建为单文件、离线可播的 lesson.html。

用法：
  python scripts/build_lesson.py examples/mathematics/quadratic-function
  python scripts/build_lesson.py --all
  python scripts/build_lesson.py --all --check   # 仅检查是否过期，不写入
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENGINE_JS = ROOT / "assets" / "engine" / "lesson-kit.js"
ENGINE_CSS = ROOT / "assets" / "engine" / "lesson-kit.css"
BUILD_MARK = "<!-- built-by: build_lesson.py -->"


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def find_sources(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    return sorted(target.rglob("lesson.src.html"))


def build_one(src: Path, check_only: bool = False, quiet: bool = False) -> dict:
    html = src.read_text(encoding="utf-8")
    js = ENGINE_JS.read_text(encoding="utf-8")
    css = ENGINE_CSS.read_text(encoding="utf-8")

    if "<!-- @engine-css -->" not in html or "<!-- @engine-js -->" not in html:
        raise SystemExit(f"[build] {src} 缺少 <!-- @engine-css --> 或 <!-- @engine-js --> 占位符")

    out = html.replace("<!-- @engine-css -->", f"<style>\n{css}\n</style>")
    out = out.replace("<!-- @engine-js -->", f"<script>\n{js}\n</script>")
    stamp = f"{BUILD_MARK}\n<!-- engine-sha: {sha(js + css)} · source-sha: {sha(html)} -->"
    out = out.replace("</head>", stamp + "\n</head>", 1)

    dst = src.with_name("lesson.html")
    stale = True
    if dst.exists():
        old = dst.read_text(encoding="utf-8")
        stale = old != out
    if not check_only:
        with open(dst, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(out)
    result = {
        "source": str(src.relative_to(ROOT)),
        "output": str(dst.relative_to(ROOT)),
        "stale": stale,
        "bytes": len(out.encode("utf-8")),
        "engine_sha": sha(js + css),
    }
    if not quiet:
        flag = "STALE" if (check_only and stale) else ("ok" if not stale else "built")
        print(f"  [{flag}] {result['output']} ({result['bytes']/1024:.0f} KB)")
    return result


def main(argv: list[str]) -> int:
    check_only = "--check" in argv
    argv = [a for a in argv if a != "--check"]
    targets: list[Path]
    if "--all" in argv or not argv:
        targets = sorted((ROOT / "examples").rglob("lesson.src.html"))
    else:
        targets = []
        for a in argv:
            p = Path(a)
            if not p.is_absolute():
                p = ROOT / p
            targets.extend(find_sources(p))

    if not targets:
        print("[build] 没有找到 lesson.src.html")
        return 1

    results = [build_one(t, check_only=check_only) for t in targets]
    stale = [r for r in results if r["stale"]]
    print(f"[build] {len(results)} 个课程，{len(stale)} 个{'待重建' if check_only else '已更新'}")
    report = ROOT / "outputs" / "reports" / "build-report.json"
    with open(report, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps({"lessons": results}, ensure_ascii=False, indent=2))
    if check_only and stale:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
