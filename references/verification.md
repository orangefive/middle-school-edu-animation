# 验证手册

## 1. 三条命令

```bash
python scripts/validate_project.py        # 静态结构与一致性
node scripts/verify_lesson.js <lesson.html> [--case <id>] [--json out.json]
python scripts/run_tests.py --set dev|holdout|all
```

`validate_project.py` 不启动浏览器，检查文件、元数据、构建新鲜度、用例覆盖度、分镜字段。

`verify_lesson.js` 启动真实 Chromium（Playwright），逐帧检查。它需要的依赖在 `scripts/node_modules`：

```bash
cd scripts && npm install     # playwright + pngjs，仅验证需要
```

若没有安装 Playwright，`verify_lesson.js` 会以 MODULE_NOT_FOUND 失败——这属于"未执行"，不是"通过"。

## 2. 自动检查项

| id | 检查 | 判定 |
|---|---|---|
| load | 页面加载、`__lesson.ready` | 15s 内就绪 |
| duration | 总时长在用例区间 | 否则 fail |
| timeline | 镜头首尾相接、末镜结束=总时长 | 误差 0.01s |
| storyboard | storyboard 与实现逐镜一致 | 数量/id/时长 |
| layout-clip | 文字不越出画布 | 2px 容差 |
| layout-caption | 正文不进入字幕带（y>594） | 文字 bbox |
| layout-header | 正文不进入标题带（y<130） | 文字 bbox |
| layout-overlap | 文字间无实质重叠 | 交叠 > 较小面积 28% 且 >260px² |
| layout-font | 正文 ≥13.5px、字幕 ≥20px | 字号 |
| blank | 无空白帧 | 非背景像素 <0.4% |
| jump | 0.25s 内画面变化 <55% | 像素差 |
| static | 镜头后 25% 仍有变化 | 像素差 <0.08% 记 warn |
| probe | 数值断言全部通过 | 缺失或超差 → fail |
| required-text | 关键词都出现 | 出现在任一采样帧 |
| forbidden-text | 禁用表述不出现 | 任一帧出现即 fail |
| caption | 每个镜头都有字幕 | 采样帧字幕非空 |
| viewport | 1024×576 / 1920×1080 可读 | 折算字号 ≥11.5px、无溢出 |
| console | 无 JS 错误、无资源加载失败 | 0 error |

## 3. 自动检查查不到什么

必须由人工（或独立评审）判断：

- 讲解是否真的易懂，类比是否恰当；
- 动画是否表达关系，还是只是"会动的 PPT"；
- 镜头衔接是否自然，节奏是否让人跟得上；
- 知识是否有代码检查不到的错误（用词、因果、示意图与实物关系）；
- 颜色/形状是否让色弱用户也能区分；
- 是否符合教材表述习惯。

因此 `verify_lesson.js` 全绿 ≠ 合格。必须按 `tests/evaluation-rubric.md` 打分。

## 4. 采样策略

每个镜头取 3 个时刻（起始 +0.7s、45%、82%）与末帧，另加：
- 每镜头中段取 0.25s 间隔的两帧做跳变检测；
- 每镜头 60% 与 85% 两帧做静止检测。

一个 8 镜课程约 25–30 张截图，存放在 `outputs/frames/<case-id>/`。

采样是离散的，可能漏掉两个采样点之间的瞬时错误（例如只在 0.2s 内出现的错位）。
所以关键结论仍需人工抽查连续播放。

## 5. 环境差异

- 字体：使用系统 "Microsoft YaHei"，不同机器字形宽度略有差异，字幕换行可能不同。CI 与他人机器上应重跑。
- 无头浏览器：Playwright Chromium headless shell，1x DPR。高分屏下的视觉效果需人工确认。
- 本机 Edge 无法以 headless 启动，因此统一使用 Playwright 自带 Chromium；这不影响动画本身的浏览器兼容性（引擎只用了 SVG 基础能力）。

## 6. 新增用例

1. 在 `tests/test-cases.json` 增加对象（参考现有字段）。
2. 在课程里用 `ctx.probe('name', () => value)` 暴露可计算的量。
3. `python scripts/run_tests.py --set dev --case <id>` 单独跑。
4. 若属于保留集，标记 `"set": "holdout"`，并且在版本冻结前不要运行它。

## 7. 结果解读

- `PASS`：全部自动项通过。
- `PASS_WITH_WARNINGS`：有非阻断问题（如某镜头后段静止），需人工确认是否可接受。
- `FAIL`：存在 fail 项；若 fail 属于硬失败集合（load/console/probe/required-text/forbidden-text/timeline），该用例直接判定不合格。
- `ERROR`：脚本未产出结果（依赖缺失、超时）。按"未执行"记录，不得算通过。
