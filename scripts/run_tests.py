#!/usr/bin/env python3
"""批量运行测试用例：调用 verify_lesson.js，计算自动分，汇总报告。

用法：
  python scripts/run_tests.py --set dev
  python scripts/run_tests.py --set holdout --tag v1.1-holdout
  python scripts/run_tests.py --set all --tag v1.0

自动分覆盖 83 分（知识准确性代理 25、动画匹配 20、视觉 18、时间轴 10、工程 10），
教学逻辑 20 分由人工评审给出（tests/review-scores.json），最终分 = 0.6×自动 + 0.4×人工。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NODE = "node"

# 检查项 → (维度, 分值)
WEIGHTS = {
    "probe": ("accuracy", 15),
    "forbidden-text": ("accuracy", 5),
    "required-text": ("accuracy", 5),
    "static": ("animation", 8),
    "jump": ("animation", 6),
    "caption": ("animation", 6),
    "layout-clip": ("visual", 5),
    "layout-caption": ("visual", 5),
    "layout-overlap": ("visual", 3),
    "layout-font": ("visual", 2),
    "contrast": ("visual", 3),
    "timeline": ("timeline", 4),
    "duration": ("timeline", 3),
    "storyboard": ("timeline", 3),
    "console": ("engineering", 5),
    "load": ("engineering", 5),
}
HARD_FAIL = {"load", "console", "probe", "required-text", "forbidden-text", "timeline"}


def load_cases() -> list[dict]:
    data = json.loads((ROOT / "tests" / "test-cases.json").read_text(encoding="utf-8"))
    return data["cases"]


def run_one(case: dict, tag: str) -> dict:
    cid = case["id"]
    out_json = ROOT / "outputs" / "reports" / f"verify-{cid}.json"
    cmd = [NODE, str(ROOT / "scripts" / "verify_lesson.js"), case["lesson"], "--case", cid, "--json", str(out_json)]
    t0 = time.time()
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT))
    elapsed = round(time.time() - t0, 1)
    if not out_json.exists():
        return {
            "case": cid, "verdict": "ERROR", "autoScore": 0, "elapsed": elapsed,
            "error": (proc.stderr or proc.stdout or "")[-800:], "checks": []
        }
    res = json.loads(out_json.read_text(encoding="utf-8"))
    res["verdict"] = res.get("summary", {}).get("verdict", "ERROR")
    res["elapsed"] = elapsed
    res["hardFail"] = [c["id"] for c in res["checks"] if c["status"] == "fail" and c["id"] in HARD_FAIL]
    res["autoScore"] = score(res["checks"])
    return res


def score(checks: list[dict]) -> float:
    earned = 0.0
    for c in checks:
        w = WEIGHTS.get(c["id"])
        if not w:
            continue
        dim, pts = w
        if c["status"] == "pass":
            earned += pts
        elif c["status"] == "warn":
            earned += pts * 0.6
    return round(earned / 83 * 100, 1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default="dev", choices=["dev", "holdout", "all"])
    ap.add_argument("--tag", default="")
    ap.add_argument("--case", default="")
    args = ap.parse_args()

    cases = load_cases()
    if args.set != "all":
        cases = [c for c in cases if c["set"] == args.set]
    if args.case:
        cases = [c for c in cases if c["id"] == args.case]
    if not cases:
        print("没有匹配的用例")
        return 1

    tag = args.tag or datetime.now().strftime("%Y%m%d-%H%M")
    results = []
    print(f"运行 {len(cases)} 个用例（set={args.set}）…\n")
    for c in cases:
        r = run_one(c, tag)
        results.append(r)
        mark = "PASS" if r["verdict"] in ("PASS", "PASS_WITH_WARNINGS") and not r.get("hardFail") else "FAIL"
        print(f"  [{mark}] {c['id']:<18} 自动分 {r.get('autoScore', 0):>5}  ({r.get('elapsed', 0)}s)  硬失败: {','.join(r.get('hardFail', [])) or '-'}")
        if r.get("error"):
            print(f"         error: {r['error'][:160]}")

    summary = {
        "tag": tag,
        "set": args.set,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "total": len(results),
        "pass": sum(1 for r in results if r["verdict"] in ("PASS", "PASS_WITH_WARNINGS") and not r.get("hardFail")),
        "avgAutoScore": round(sum(r.get("autoScore", 0) for r in results) / len(results), 1),
        "hardFailCases": [r["case"] for r in results if r.get("hardFail")],
        "cases": [
            {
                "case": r["case"], "verdict": r["verdict"], "autoScore": r.get("autoScore", 0),
                "hardFail": r.get("hardFail", []), "duration": r.get("duration"),
                "checks": [{"id": c["id"], "status": c["status"], "detail": c["detail"]} for c in r.get("checks", [])],
                "frames": r.get("frames", [])[:3],
                "error": r.get("error"),
            }
            for r in results
        ],
    }
    out = ROOT / "outputs" / "reports" / f"run-{args.set}-{tag}.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "outputs" / "reports" / "latest.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n汇总：{summary['pass']}/{summary['total']} 通过工程检查，平均自动分 {summary['avgAutoScore']}")
    print(f"报告：{out.relative_to(ROOT)}")
    return 0 if summary["pass"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
