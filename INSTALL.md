# 安装与使用方式

结论先说：**克隆下来就能构建、能播放；但"在 agent 里被自动发现并调用"取决于 agent 是否支持 `SKILL.md` 以及技能目录的加载时机。**

## 1. 三种安装方式

### 方式 A：作为项目级技能（推荐）

把仓库放到项目的技能目录：

```bash
cd <你的项目>
git clone <repo-url> .workbuddy/skills/middle-school-edu-animation
# 或直接复制文件夹
```

agent 读取 `SKILL.md` 的 `name` / `description` 决定何时调用。**新放入的技能通常要新开一次会话才会出现在可调用列表里**（本仓库实测：当前会话内调用返回 not found）。

### 方式 B：作为用户级技能

```bash
git clone <repo-url> ~/.workbuddy/skills/middle-school-edu-animation
# Claude Code 等：~/.claude/skills/middle-school-edu-animation
```

优点：所有项目可用。缺点：**产物会写进技能目录**，不适合长期使用——请配合方式 C 的工作区。

### 方式 C：当工作区用（推荐给实际生产）

技能目录只读用，产物写到你的项目：

```bash
python <skill>/scripts/init_project.py D:/my-project/edu-anim
```

生成一个自包含工作区：`assets/engine`、`scripts`、`templates`、`references`、`examples/`、`tests/`、`outputs/`。
之后所有命令都在工作区里跑，agent 也只需要知道这个目录。

## 2. 依赖与能力矩阵

| 环境 | 能构建 | 能播放 | 能导出分镜 | 能自动验证 |
|---|---|---|---|---|
| 只有浏览器 | ✗ | ✓（用仓库里已构建的 lesson.html） | ✗ | ✗ |
| Python 3.9+ | ✓ | ✓ | ✗ | ✗ |
| Python + Node 18+ | ✓ | ✓ | ✓ | ✗ |
| Python + Node + `npm ci` + Chromium | ✓ | ✓ | ✓ | ✓ |

- 构建（`build_lesson.py`）：纯 Python 标准库，把引擎内联进单文件 HTML。
- 分镜导出（`export_storyboard.js`）：需要 Node + Playwright，因为要从真实页面读时间轴。
- 自动验证（`verify_lesson.js`）：需要 Node + Playwright + Chromium。
- 依赖体积：`npm ci` 约 57 MB，Chromium 约 100 MB（装在用户缓存目录，可被多个项目共用）。

```bash
cd scripts
npm ci
npx playwright install chromium
cd .. && python scripts/doctor.py
```

`doctor.py` 会逐项告诉你缺什么、怎么补，不会甩一堆堆栈。

## 3. Windows 注意事项

- 路径用正斜杠或在 PowerShell 里用反斜杠，脚本内部都做了 `resolve()`。
- **不要**把 `mklink /J` 目录联接提交进 git：它只在当前机器有效，别人克隆后会得到一个空目录或断链。安装请用复制。
- 文件统一 UTF-8；用记事本另存时注意不要存成 GBK。

## 4. 常见问题

**Q：装好了，但 agent 说找不到技能？**
A：技能清单通常在会话启动时加载。新开一个会话，或确认目录层级是 `<skills>/middle-school-edu-animation/SKILL.md`（不要再套一层）。

**Q：`verify_lesson.js` 报 `Cannot find module 'playwright'`？**
A：进入 `scripts/` 执行 `npm ci`，再执行 `npx playwright install chromium`。

**Q：能不用 Node 吗？**
A：可以生成并播放动画，但拿不到分镜与自动验证。此时 `validate_project.py` 会报"缺少 storyboard.json"，属于预期，不是文件损坏。

**Q：构建出来的 HTML 需要联网吗？**
A：不需要。引擎、样式、字体全部本地/系统字体，零外部请求。

**Q：能改成别的学科/学段吗？**
A：可以。引擎与学科无关；学科规则在 `references/subject-guidelines.md`，按需扩展即可。小学内容需要下调字号与信息密度。
