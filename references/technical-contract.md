# 技术契约：时间轴引擎与课程结构

## 1. 为什么是"时间的纯函数"

绝大多数动画 bug 来自"状态依赖播放历史"：用 CSS animation、setTimeout 链、或每帧累加。

本引擎要求：**画面 = f(t)**。任何时刻 `seek(t)` 都必须得到与连续播放到 t 时完全一致的一帧。
好处：

- 可以在 0.1 秒内跳到任意时间点做截图检查；
- 可以对比 0.25s 前后的像素差判断是否闪烁；
- 可以在不同分辨率下重复同一时刻；
- 回归测试可重复。

因此禁止：

- 主视觉使用 CSS `animation` / `transition`（UI 主题色除外）；
- 用 `setTimeout` 推进动画；
- 依赖 `Math.random()`（需要随机时用固定种子）；
- 根据"上一帧"计算"这一帧"。

## 2. 文件结构

```
examples/<subject>/<slug>/
  lesson.src.html   ← 作者编辑；通过 <!-- @engine-css --> <!-- @engine-js --> 引用共享引擎
  lesson.html       ← build_lesson.py 生成；单文件、离线可播、含引擎与源文件哈希
  storyboard.json   ← 由 export_storyboard.js 从 lesson.html 导出，保证"文档即实现"
  script.md         ← 教学脚本（人读）
```

`lesson.html` 不允许有任何外部引用（`<script src>`、`<link>`、`http(s)://`）。

## 3. 引擎 API

```js
EduKit.createLesson({
  meta: {
    title, subject, grade, duration,
    objectives: [], prerequisites: [], misconceptions: [],
    corePoints: [], optionalPoints: [], animationAffordances: [], durationRationale
  },
  theme: { accent: '#2f6fed' },
  scenes: [ { id, title, duration, objective, visual, motion, link, check,
              cues: [{t, text}],
              build(ctx) { ... } } ]
});
```

### 3.1 画布与安全区

| 项 | 值 |
|---|---|
| 画布 | 1280 × 720，`viewBox` 固定，等比缩放 |
| 内容安全区 | x 64–1216，y 150–592 |
| 字幕带 | y 600–690，最多 2 行，24px |
| 标题带 | y 30–128 |

引擎自动绘制：学科徽标、镜头标题、进度条、时间、字幕、快捷键提示。

### 3.2 `ctx` 绘图

| 方法 | 说明 |
|---|---|
| `ctx.text(x, y, str, opts)` | opts: `size`(默认22) `fill` `weight` `anchor` `italic` `halo` |
| `ctx.rect / circle / line / path` | 基础图形，`opts.role` 参与自动检查 |
| `ctx.arrow({x1,y1,x2,y2,color,width,head,t0,dur,label})` | 线 + 三角头，可生长，箭头方向由端点决定 |
| `ctx.axes({x:[min,max], y:[min,max], box:{x,y,w,h}, xStep,yStep,xTick,yTick,xLabel,yLabel,tickSize})` | 返回 `{px(v), py(v), curve(fn,opts), point(x,y,opts), segment, vline, hline, box}` |
| `ctx.table({x,y,rowH,colW,header,rows,size})` | 返回 `{cells, revealRow(i,t0,dur)}` |
| `ctx.panel(x,y,w,h,{title,fill,stroke})` | 圆角面板 |
| `ctx.callout(x,y,text,{color,anchor,outline})` | 带底色的标注 |
| `ctx.group(html)` | 插入原始 SVG 片段，返回 `<g>` |

### 3.3 `ctx` 动画

| 方法 | 说明 |
|---|---|
| `ctx.tween(t0, dur, fn, ease)` | 核心：`fn(p, localT)`，p 已 clamp 到 [0,1] |
| `ctx.fade(el, t0, dur=0.5, from=0, to=1)` | 透明度 |
| `ctx.rise(el, t0, dur=0.5, dy=14)` | 淡入 + 上浮 |
| `ctx.pop(el, t0, dur=0.45, from=0.82)` | 弹出（以 bbox 中心缩放） |
| `ctx.draw(el, t0, dur)` | 路径生长（内部使用 pathLength=1） |
| `ctx.move(el, t0, dur, from, to, ease)` | 平移 |
| `ctx.count(el, t0, dur, from, to, fmt)` | 数字滚动 |
| `ctx.travel(pathEl, {t0,dur,dot})` | 光点沿路径移动 |
| `ctx.emphasize(el, t0, dur)` | 放大 + 加粗 |
| `ctx.cue(t, text)` / `ctx.cues([...])` | 字幕（同一镜头多条） |
| `ctx.probe(name, fn)` | 注册可被测试读取的数值断言 |

**规则**：同一元素同一属性不要被两个重叠的 tween 同时驱动（后注册的会覆盖），需要分段时用互不重叠的时间区间。

### 3.4 对外接口

```js
window.__lesson = {
  duration, meta, scenes:[{id,title,objective,start,duration,captions}],
  seek(t), play(), pause(), isPlaying(),
  inspect(),          // 当前帧可见文字及其 bbox、字号、透明度
  probes: { name: fn },
  ready: true
};
```

`inspect()` 是自动检查的基础：它返回的 bbox 已换算回 1280×720 坐标系。

## 4. 构建

```bash
python scripts/build_lesson.py examples/physics/refraction   # 单课
python scripts/build_lesson.py --all                        # 全部
python scripts/build_lesson.py --all --check                # 只检查是否过期（CI 用）
```

构建写入 `<!-- engine-sha: … · source-sha: … -->`。改了引擎却忘记重建，`validate_project.py` 会报错。

## 5. 分镜导出

```bash
node scripts/export_storyboard.js --all
```

从 `__lesson.scenes` 读取真实时长、字幕、目标，写入 `storyboard.json`。
好处：分镜不可能与实现脱节；改代码后重跑一次即可同步。

## 6. 常见技术陷阱

| 陷阱 | 后果 | 正确做法 |
|---|---|---|
| 在循环里用 `var` 捕获元素并注册 tween | 只有最后一个元素动 | 用 IIFE 或 `forEach` 回调 |
| `ctx.axes` 外手写屏幕坐标 | 图像与解析式错位 | 一律用 `px()/py()` |
| 用 `getBBox()` 前元素未插入 DOM | 返回 0 | 先 append 再测量 |
| 字幕写进 `ctx.text`（content 角色） | 侵入内容区、被检测判失败 | 用 `cues` |
| 用颜色区分两类对象 | 色弱不可读 | 加形状/文字/位置差异 |
| 动画只在 0–12s 有效，之后冻结 | 后段静止告警 | tween 的 dur 覆盖整个镜头 |
