#!/usr/bin/env python3
"""结构、一致性、可运行性以外的静态校验。

检查项：
  1. Skill 目录与必备文件
  2. SKILL.md 元数据
  3. 测试用例覆盖度（学科、难度、保留集、特殊用例）
  4. 课程产物完整性（src/html/storyboard）
  5. 单文件自包含（无外链）
  6. 构建是否过期（引擎/源文件哈希）
  7. 分镜与实现一致（时长、镜头字段）
  8. 字幕长度与镜头时长下限

退出码：0 通过；1 有 error；2 仅有 warning。
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def check_structure() -> None:
    required = [
        "SKILL.md", "README.md", "CHANGELOG.md", "INSTALL.md", "INSTALL.md",
        "references/teaching-design.md", "references/animation-direction.md",
        "references/subject-guidelines.md", "references/quality-standards.md",
        "templates/storyboard-template.json", "templates/lesson-script-template.md",
        "tests/test-cases.json", "tests/evaluation-rubric.md", "tests/regression-tests.md",
        "scripts/build_lesson.py", "scripts/validate_project.py", "scripts/verify_lesson.js",
        "scripts/run_tests.py", "scripts/doctor.py", "scripts/init_project.py",
        "assets/engine/lesson-kit.js", "assets/engine/lesson-kit.css",
    ]
    for rel in required:
        if not (ROOT / rel).exists():
            err(f"缺少必需文件: {rel}")


def check_skill_md() -> None:
    p = ROOT / "SKILL.md"
    if not p.exists():
        return
    text = p.read_text(encoding="utf-8")
    if not text.startswith("---"):
        err("SKILL.md 缺少 YAML frontmatter")
        return
    head = text.split("---")[1]
    if "name:" not in head:
        err("SKILL.md frontmatter 缺少 name")
    if "description:" not in head:
        err("SKILL.md frontmatter 缺少 description")
    if len(text) < 2000:
        warn("SKILL.md 过短，可能缺少流程说明")
    for phase in ["阶段 A", "阶段 B", "阶段 C", "阶段 D", "阶段 E"]:
        if phase not in text:
            err(f"SKILL.md 缺少 {phase}")


def check_cases() -> dict:
    p = ROOT / "tests" / "test-cases.json"
    if not p.exists():
        return {}
    data = json.loads(p.read_text(encoding="utf-8"))
    cases = data.get("cases", [])
    if len(cases) < 12:
        err(f"测试用例不足 12 个（当前 {len(cases)}）")

    by_subject: dict[str, int] = {}
    difficulties = set()
    holdout = 0
    for c in cases:
        by_subject[c.get("subject", "?")] = by_subject.get(c.get("subject", "?"), 0) + 1
        difficulties.add(c.get("difficulty"))
        if c.get("set") == "holdout":
            holdout += 1
        for key in ["id", "topic", "grade", "keyPoints", "forbiddenErrors", "durationRange",
                    "requiredVisuals", "autoChecks", "manualChecks", "lesson"]:
            if key not in c:
                err(f"用例 {c.get('id')} 缺少字段 {key}")
        if not c.get("probes"):
            warn(f"用例 {c.get('id')} 没有 probes，仅能做排版与存在性检查")
        if len(c.get("keyPoints", [])) < 3:
            warn(f"用例 {c.get('id')} 核心知识点少于 3 条")

    if by_subject.get("mathematics", 0) < 4:
        err("数学用例不足 4 个")
    if by_subject.get("physics", 0) < 3:
        err("物理用例不足 3 个")
    if by_subject.get("chemistry", 0) < 2:
        err("化学用例不足 2 个")
    if by_subject.get("biology", 0) < 1:
        err("生物用例不足 1 个")
    if holdout < 4:
        err(f"保留集不足 4 个（当前 {holdout}）")
    if not any(c.get("durationUnspecified") for c in cases):
        err("缺少“用户未指定时长”的用例")
    if not any(c.get("focus") == "misconception" for c in cases):
        err("缺少“常见误解”专项用例")
    for d in ["easy", "medium", "complex"]:
        if d not in difficulties:
            warn(f"缺少 {d} 难度用例")
    return {c["id"]: c for c in cases}


def check_lessons(cases: dict, allow_empty: bool = False) -> None:
    htmls = sorted((ROOT / "examples").rglob("lesson.html"))
    if not htmls:
        if allow_empty:
            warn("examples/ 下还没有课程（工作区尚未添加课程）")
        else:
            err("examples/ 下没有任何 lesson.html")
        return
    lessons_by_path = {str(h.relative_to(ROOT)).replace("\\", "/"): h for h in htmls}

    for cid, c in cases.items():
        lp = c.get("lesson", "").replace("\\", "/")
        if lp not in lessons_by_path:
            err(f"用例 {cid} 指向的课程不存在: {lp}")

    engine = (ROOT / "assets" / "engine" / "lesson-kit.js").read_text(encoding="utf-8")
    css = (ROOT / "assets" / "engine" / "lesson-kit.css").read_text(encoding="utf-8")
    engine_sha = sha(engine + css)

    for rel, h in lessons_by_path.items():
        src = h.with_name("lesson.src.html")
        sb = h.with_name("storyboard.json")
        for f in (src, sb):
            if not f.exists():
                err(f"{rel} 缺少配套文件 {f.name}")
        text = h.read_text(encoding="utf-8")
        if "<!-- built-by: build_lesson.py -->" not in text:
            err(f"{rel} 不是由 build_lesson.py 构建")
        m = re.search(r"engine-sha: ([0-9a-f]{12})", text)
        if not m:
            err(f"{rel} 缺少引擎哈希，无法判断是否过期")
        elif m.group(1) != engine_sha:
            err(f"{rel} 引擎已更新但未重建（engine-sha 不匹配）")
        if re.search(r'(src|href)\s*=\s*["\']https?://', text):
            err(f"{rel} 引用了外部资源，无法离线播放")
        if "<script src=" in text or "<link rel=\"stylesheet\"" in text:
            err(f"{rel} 未内联脚本/样式，不是单文件")
        if "__lesson" not in text:
            err(f"{rel} 未暴露 __lesson 接口，无法自动验证")

        if not sb.exists():
            continue
        board = json.loads(sb.read_text(encoding="utf-8"))
        scenes = board.get("scenes", [])
        total = sum(float(s.get("duration", 0)) for s in scenes)
        if abs(total - float(board["meta"].get("duration", -1))) > 0.01:
            err(f"{rel} storyboard 总时长 {total} 与 meta.duration {board['meta'].get('duration')} 不一致")
        if not scenes:
            err(f"{rel} storyboard 无镜头")
        for s in scenes:
            for key in ["id", "title", "duration", "objective", "visual", "motion", "camera", "captions", "link", "check"]:
                if not s.get(key) and key != "check":
                    err(f"{rel} 镜头 {s.get('id')} 缺少 {key}")
            if float(s.get("duration", 0)) < 6:
                warn(f"{rel} 镜头 {s.get('id')} 时长 {s.get('duration')}s 偏短")
            for cap in s.get("captions", []):
                if len(cap.get("text", "")) > 40:
                    warn(f"{rel} 镜头 {s.get('id')} 字幕过长（{len(cap['text'])} 字）: {cap['text'][:20]}…")
            if not s.get("captions"):
                err(f"{rel} 镜头 {s.get('id')} 没有字幕")


def main() -> int:
    # --workspace：在用户项目里只校验课程产物，不要求 Skill 自身结构完整
    workspace = "--workspace" in sys.argv
    if workspace:
        print("[workspace 模式] 只校验 examples/ 下的课程产物")
        cases: dict = {}
        p = ROOT / "tests" / "test-cases.json"
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                cases = {c["id"]: c for c in data.get("cases", []) if "id" in c}
            except Exception as e:  # noqa: BLE001
                warn(f"test-cases.json 解析失败: {e}")
    else:
        check_structure()
        check_skill_md()
        cases = check_cases()
    check_lessons(cases, allow_empty=workspace)

    print(f"检查完成：{len(errors)} 个错误，{len(warnings)} 个警告")
    for e in errors[:30]:
        print(f"  ✗ {e}")
    for w in warnings[:20]:
        print(f"  ! {w}")
    if errors:
        return 1
    if warnings:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
