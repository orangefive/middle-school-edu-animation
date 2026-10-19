# 开源可用性实测

- 日期：2026-10-19
- 问题：把本 Skill 推到 GitHub，别人克隆后能不能直接在 agent 里用它生成知识点动画？
- 方法：不靠推断，做三次真实验证——干净副本、模拟 git 提交、在空项目里初始化并做一课。

## 1. 干净副本（去掉 node_modules 与截图）

```bash
cp -r middle-school-edu-animation /tmp/clean
rm -rf scripts/node_modules outputs/frames outputs/review
```

| 检查 | 结果 |
|---|---|
| 体积 | 2.1 MB（含 13 个已构建 lesson.html 与 13 份分镜） |
| `python scripts/build_lesson.py --all` | 通过，13/13，未修改任何文件 |
| `python scripts/validate_project.py` | 0 错误 0 警告 |
| `node scripts/verify_lesson.js ...` | 缺依赖时**抛堆栈**（已改为中文提示 + 退出码 3） |
| 补上 `NODE_PATH` 后 | 19/19 通过 |

结论：**工具链可移植，路径不依赖作者机器**；问题只在依赖缺失时的提示不友好。

## 2. 模拟 git 提交

```bash
git init && git add -A && git commit -m init
python scripts/build_lesson.py --all
git diff --stat
```

| 项 | 结果 |
|---|---|
| 提交文件数 | 98 |
| `.git` 体积 | 822 KB |
| node_modules / 截图 | 已被 `.gitignore` 排除 |
| 13 个 lesson.html | 已包含（克隆即可播放） |
| 提交后重建 | **零 diff**（固定 LF 写入，跨平台一致） |

结论：可以直接推送；CI 的"构建后不应有差异"检查能稳定通过。

## 3. 在空项目里初始化（模拟真实使用）

```bash
python <skill>/scripts/init_project.py D:/my-project/edu-anim
cd D:/my-project/edu-anim
cp templates/lesson-src-template.html examples/physics/reflection/lesson.src.html
python scripts/build_lesson.py examples/physics/reflection
node scripts/export_storyboard.js examples/physics/reflection/lesson.html
python scripts/validate_project.py --workspace
node scripts/verify_lesson.js examples/physics/reflection/lesson.html
```

| 步骤 | 结果 |
|---|---|
| 初始化 | 19 个文件，生成 assets/scripts/templates/references/examples/outputs |
| 构建 | 42 KB 单文件，通过 |
| 分镜导出 | 3 镜 / 86s |
| 校验（工作区模式） | 0 错误 |
| 自动验证 | 15 项通过 + 1 警告（模板无 probe，属预期） |

结论：产物落在用户项目里，不污染技能安装目录。

## 4. 仍然存在的阻塞（按严重程度）

| # | 问题 | 影响 | 现状 |
|---|---|---|---|
| 1 | 运行中的会话发现不了新安装的技能 | 装完当次不能用 | **平台机制**，需新开会话。已写入 INSTALL.md 与 README，无法在包内修复 |
| 2 | 没有 LICENSE | 严格说不能算"开源" | 待项目所有者选择（建议 MIT 或 Apache-2.0） |
| 3 | 验证需下载 Chromium（约 100 MB） | 首次安装慢，CI 也需装 | 已提供 `doctor.py` 检查与安装命令；不影响构建与播放 |
| 4 | CI 在 Linux 上缺中文字体 | 截图文字宽度变化可能导致检查失败 | workflow 已安装 `fonts-noto-cjk` |
| 5 | 用户若用 `mklink /J` 安装 | 克隆后目录为空 | INSTALL.md 明确要求复制而非联接 |

## 5. 结论

**能用，但不是"双击即用"。**

- 内容层：克隆 → 新会话 → 说一句"用 middle-school-edu-animation 做一个……"即可，流程与检查项都在包内。
- 环境层：至少要 Python 才能改课；要完整体验（分镜 + 自动验证）还需 Node 与一次浏览器下载。
- 工程层：安装位置、工作区、依赖缺失提示、跨平台一致性，这次已经补齐；剩下的是平台级的"技能热加载"和 LICENSE 决策。

一句话：**把仓库当"可安装的脚手架"，而不是"复制一个文件夹就自动生效的插件"。**
