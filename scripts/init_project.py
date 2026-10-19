#!/usr/bin/env python3
"""在任意项目里搭一个动画工作区（不把产物写进 Skill 安装目录）。

用法：
  python scripts/init_project.py D:/my-project/edu-anim
  python scripts/init_project.py ../lessons --force

生成：
  assets/engine/  scripts/  templates/  references/  SKILL.md
  examples/  tests/  outputs/  README.md  .gitignore
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ["build_lesson.py", "validate_project.py", "doctor.py", "run_tests.py",
           "verify_lesson.js", "export_storyboard.js", "package.json", "package-lock.json"]

README = """# 知识点动画工作区

由 middle-school-edu-animation 初始化。

## 开始

```bash
cd scripts && npm ci && npx playwright install chromium   # 仅自动验证需要
cd ..
python scripts/doctor.py                                  # 环境自检
```

## 新增一课

1. 复制 `templates/lesson-src-template.html` 到
   `examples/<subject>/<slug>/lesson.src.html`，改写镜头与字幕。
2. 构建：

```bash
python scripts/build_lesson.py examples/<subject>/<slug>
```

3. 导出分镜：

```bash
node scripts/export_storyboard.js examples/<subject>/<slug>/lesson.html
```

4. 验证（需要 Node 依赖）：

```bash
node scripts/verify_lesson.js examples/<subject>/<slug>/lesson.html
```

产物 `lesson.html` 是单文件，双击即可播放。

## 规则

- 动画状态必须是时间的纯函数，用 `ctx.tween` / `ctx.fade`，不要用 CSS animation 或 setTimeout。
- 讲解文字一律放字幕（`cues`），不要写进内容区。
- 改引擎后重建全部课程：`python scripts/build_lesson.py --all`。
"""

CHANGELOG = """# CHANGELOG

## v0.1

- 由 middle-school-edu-animation 初始化工作区。
"""


def copy_tree(src: Path, dst: Path, overwrite: bool) -> int:
    n = 0
    for f in src.rglob("*"):
        if not f.is_file():
            continue
        if "node_modules" in f.parts or "__pycache__" in f.parts:
            continue
        rel = f.relative_to(src)
        target = dst / rel
        if target.exists() and not overwrite:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, target)
        n += 1
    return n


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    if not args:
        print(__doc__)
        return 2
    target = Path(args[0]).expanduser().resolve()
    if target == ROOT:
        print("目标不能是 Skill 目录本身")
        return 2

    target.mkdir(parents=True, exist_ok=True)
    copied = 0
    copied += copy_tree(ROOT / "assets", target / "assets", force)
    for name in SCRIPTS:
        src = ROOT / "scripts" / name
        if not src.exists():
            continue
        dst = target / "scripts" / name
        if dst.exists() and not force:
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1
    copied += copy_tree(ROOT / "templates", target / "templates", force)
    copied += copy_tree(ROOT / "references", target / "references", force)
    if (ROOT / "SKILL.md").exists():
        shutil.copy2(ROOT / "SKILL.md", target / "SKILL.md")

    for d in ["examples", "outputs/demos", "outputs/reports", "outputs/frames", "tests"]:
        (target / d).mkdir(parents=True, exist_ok=True)
    (target / "examples" / ".gitkeep").write_text("", encoding="utf-8")

    cases = target / "tests" / "test-cases.json"
    if not cases.exists() or force:
        cases.write_text(json.dumps({"version": "1.0", "cases": []}, ensure_ascii=False, indent=2), encoding="utf-8")
    for name in ["evaluation-rubric.md", "regression-tests.md"]:
        src = ROOT / "tests" / name
        if src.exists():
            dst = target / "tests" / name
            if not dst.exists() or force:
                shutil.copy2(src, dst)

    for name, content in [("README.md", README), ("CHANGELOG.md", CHANGELOG)]:
        p = target / name
        if not p.exists() or force:
            p.write_text(content, encoding="utf-8")

    gi = target / ".gitignore"
    if not gi.exists() or force:
        gi.write_text("scripts/node_modules/\noutputs/frames/\n__pycache__/\n*.pyc\n.DS_Store\n", encoding="utf-8")

    print(f"工作区已创建：{target}")
    print(f"  复制 {copied} 个文件")
    print("\n下一步：")
    print(f"  cd {target}")
    print("  cd scripts && npm ci && npx playwright install chromium   # 仅自动验证需要")
    print("  cd .. && python scripts/doctor.py")
    print("  python scripts/build_lesson.py examples/<subject>/<slug>")
    return 0


if __name__ == "__main__":
    sys.exit(main())
