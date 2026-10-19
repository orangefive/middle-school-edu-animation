#!/usr/bin/env node
/**
 * verify_lesson.js — 用真实浏览器（Playwright Chromium）逐帧检查讲解动画。
 *
 * 用法：
 *   node scripts/verify_lesson.js examples/mathematics/quadratic-function/lesson.html
 *   node scripts/verify_lesson.js <lesson.html> --case M1-quadratic
 *   node scripts/verify_lesson.js <lesson.html> --case M1-quadratic --json outputs/reports/x.json
 *
 * 只做可确定性验证的事：加载、时长、镜头衔接、字幕、排版、像素稳定性、probe 数值。
 * 教学好坏不在这里判断（见 tests/evaluation-rubric.md 的人工评审）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
let chromium, PNG;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('缺少依赖：playwright。请在 scripts/ 目录执行：npm ci && npx playwright install chromium');
  process.exit(3);
}
try {
  ({ PNG } = require('pngjs'));
} catch (e) {
  console.error('缺少依赖：pngjs。请在 scripts/ 目录执行：npm ci');
  process.exit(3);
}

const ROOT = path.resolve(__dirname, '..');
const VIEW = { width: 1280, height: 720 };
const STAGE_W = 1280, STAGE_H = 720;
const CAPTION_TOP = 594;
const HEADER_BOTTOM = 130;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
    else out._.push(a);
  }
  return out;
}

function loadCases() {
  const p = path.join(ROOT, 'tests', 'test-cases.json');
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8')).cases || [];
}

function pngStats(buf) {
  const png = PNG.sync.read(buf);
  const { width, height, data } = png;
  let sum = 0, sum2 = 0, n = 0;
  const hist = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += lum; sum2 += lum * lum; n++;
    const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  let bgKey = 0, bgCount = 0;
  for (const [k, v] of hist) if (v > bgCount) { bgCount = v; bgKey = k; }
  // 非背景像素比例（与主色差 > 12 灰度）
  let nonBg = 0;
  const br = ((bgKey >> 10) & 31) * 8, bg = ((bgKey >> 5) & 31) * 8, bb = (bgKey & 31) * 8;
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.abs(data[i] - br) + Math.abs(data[i + 1] - bg) + Math.abs(data[i + 2] - bb);
    if (d > 36) nonBg++;
  }
  return { width, height, mean, sd, nonBgRatio: nonBg / n, pixels: png };
}

function pngDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let diff = 0, n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (d > 60) diff++;
    n++;
  }
  return diff / n;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args._[0];
  if (!target) {
    console.error('用法: node scripts/verify_lesson.js <lesson.html> [--case id] [--json out.json]');
    process.exit(2);
  }
  const lessonPath = path.isAbsolute(target) ? target : path.join(ROOT, target);
  if (!fs.existsSync(lessonPath)) {
    console.error('找不到文件: ' + lessonPath);
    process.exit(2);
  }

  const cases = loadCases();
  const testCase = args.case && args.case !== true ? cases.find(c => c.id === args.case) : null;
  if (args.case && !testCase) {
    console.error('未找到测试用例: ' + args.case);
    process.exit(2);
  }
  const label = testCase ? testCase.id : path.basename(path.dirname(lessonPath));
  const frameDir = path.join(ROOT, 'outputs', 'frames', label);
  fs.mkdirSync(frameDir, { recursive: true });

  const checks = [];
  const add = (id, name, status, detail) => checks.push({ id, name, status, detail });
  const frames = [];

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
  page.on('requestfailed', r => consoleErrors.push('requestfailed: ' + r.url()));

  const url = 'file:///' + lessonPath.replace(/\\/g, '/').replace(/^\/+/, '');
  let info = null;
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    await page.waitForFunction('window.__lesson && window.__lesson.ready', null, { timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(120);
    info = await page.evaluate(() => ({
      duration: window.__lesson.duration,
      scenes: window.__lesson.scenes,
      meta: window.__lesson.meta,
      probes: Object.keys(window.__lesson.probes)
    }));
    add('load', '页面加载与引擎就绪', 'pass', `meta=${info.meta.title || ''} scenes=${info.scenes.length} duration=${info.duration}s`);
  } catch (err) {
    add('load', '页面加载与引擎就绪', 'fail', err.message);
    await browser.close();
    return finish({ label, lessonPath, info: null, checks, frames, consoleErrors });
  }

  // 1. 时长
  const dur = info.duration;
  if (testCase && testCase.durationRange) {
    const [lo, hi] = testCase.durationRange;
    add('duration', '时长符合知识点复杂度', (dur >= lo && dur <= hi) ? 'pass' : 'fail',
      `实际 ${dur}s，期望 ${lo}–${hi}s`);
  } else {
    add('duration', '时长存在且合理', dur >= 60 && dur <= 360 ? 'pass' : 'warn', `实际 ${dur}s`);
  }

  // 2. 时间轴闭合
  let timelineOk = true, timelineDetail = [];
  info.scenes.forEach((s, i) => {
    if (s.duration <= 0) { timelineOk = false; timelineDetail.push(`${s.id} 时长<=0`); }
    if (i > 0) {
      const prev = info.scenes[i - 1];
      if (Math.abs((prev.start + prev.duration) - s.start) > 0.01) {
        timelineOk = false;
        timelineDetail.push(`${prev.id} 结束 ${prev.start + prev.duration} ≠ ${s.id} 开始 ${s.start}`);
      }
    }
  });
  const last = info.scenes[info.scenes.length - 1];
  if (Math.abs((last.start + last.duration) - dur) > 0.01) {
    timelineOk = false;
    timelineDetail.push(`末镜头结束 ${last.start + last.duration} ≠ 总时长 ${dur}`);
  }
  add('timeline', '镜头时间轴连续闭合', timelineOk ? 'pass' : 'fail',
    timelineOk ? `${info.scenes.length} 个镜头合计 ${dur}s` : timelineDetail.join('；'));

  // 3. 分镜一致性
  const storyboardPath = path.join(path.dirname(lessonPath), 'storyboard.json');
  if (fs.existsSync(storyboardPath)) {
    try {
      const sb = JSON.parse(fs.readFileSync(storyboardPath, 'utf8'));
      const issues = [];
      if (sb.scenes.length !== info.scenes.length) issues.push(`镜头数 ${sb.scenes.length} vs ${info.scenes.length}`);
      sb.scenes.forEach((s, i) => {
        const real = info.scenes[i];
        if (!real) return;
        if (s.id !== real.id) issues.push(`#${i + 1} id ${s.id}≠${real.id}`);
        if (Math.abs(Number(s.duration) - real.duration) > 0.01) issues.push(`${s.id} 时长 ${s.duration}≠${real.duration}`);
      });
      if (Math.abs(Number(sb.meta.duration) - dur) > 0.01) issues.push(`总时长 ${sb.meta.duration}≠${dur}`);
      add('storyboard', 'storyboard.json 与动画一致', issues.length ? 'fail' : 'pass',
        issues.length ? issues.join('；') : `${sb.scenes.length} 镜头一一对应`);
    } catch (e) {
      add('storyboard', 'storyboard.json 与动画一致', 'fail', '解析失败: ' + e.message);
    }
  } else {
    add('storyboard', 'storyboard.json 与动画一致', 'warn', '缺少 storyboard.json');
  }

  // 4. 逐帧采样
  const stageBox = await page.locator('#lesson').boundingBox();
  const sampleTimes = [];
  info.scenes.forEach((s, i) => {
    const ts = [s.start + 0.7, s.start + s.duration * 0.45, s.start + s.duration * 0.82];
    ts.forEach(t => { if (t < dur - 0.05) sampleTimes.push({ scene: i, t: Math.round(t * 10) / 10 }); });
    if (i === info.scenes.length - 1) sampleTimes.push({ scene: i, t: Math.round((dur - 0.15) * 10) / 10 });
  });

  const layoutIssues = { clip: [], caption: [], header: [], font: [], overlap: [], contrast: [] };
  const textUnion = new Set();
  const captionByScene = new Map();
  let blankFrames = 0;
  const seenFrames = [];

  for (const st of sampleTimes) {
    await page.evaluate(t => window.__lesson.seek(t), st.t);
    await page.waitForTimeout(45);
    const insp = await page.evaluate(() => window.__lesson.inspect());
    const shotPath = path.join(frameDir, `s${String(st.scene + 1).padStart(2, '0')}_${String(st.t).replace('.', 'p')}.png`);
    const buf = await page.screenshot({ clip: stageBox });
    fs.writeFileSync(shotPath, buf);
    const stats = pngStats(buf);
    if (stats.nonBgRatio < 0.004) blankFrames++;

    // 文字区域对比度：若 bbox 内亮度极差过小，说明文字与底色接近（例如压在同类色块上）
    const pngNow = stats.pixels;
    for (const x of insp.texts) {
      if (x.role === 'ui' || x.opacity < 0.5 || x.w < 6 || x.h < 6) continue;
      const x0 = Math.max(0, Math.floor(x.x)), y0 = Math.max(0, Math.floor(x.y));
      const x1 = Math.min(pngNow.width - 1, Math.ceil(x.x + x.w));
      const y1 = Math.min(pngNow.height - 1, Math.ceil(x.y + x.h));
      let lo = 255, hi = 0;
      for (let yy = y0; yy <= y1; yy += 1) {
        for (let xx = x0; xx <= x1; xx += 1) {
          const i = (yy * pngNow.width + xx) * 4;
          const lum = 0.2126 * pngNow.data[i] + 0.7152 * pngNow.data[i + 1] + 0.0722 * pngNow.data[i + 2];
          if (lum < lo) lo = lum;
          if (lum > hi) hi = lum;
        }
      }
      if (hi - lo < 55) {
        layoutIssues.contrast.push(`t=${st.t}s「${x.text.slice(0, 14)}」与底色对比不足(Δ=${Math.round(hi - lo)})`);
      }
    }

    const texts = insp.texts.filter(x => x.role !== 'ui');
    texts.forEach(x => textUnion.add(x.text.replace(/\s+/g, '')));
    const caps = insp.texts.filter(x => x.role === 'caption' && x.opacity > 0.3 && x.text);
    if (caps.length) {
      captionByScene.set(st.scene, (captionByScene.get(st.scene) || 0) + 1);
    }

    texts.forEach(x => {
      if (x.x < -2 || x.y < -2 || x.x + x.w > STAGE_W + 2 || x.y + x.h > STAGE_H + 2) {
        layoutIssues.clip.push(`t=${st.t}s「${x.text.slice(0, 18)}」越界(${Math.round(x.x)},${Math.round(x.y)},${Math.round(x.w)}×${Math.round(x.h)})`);
      }
      if (x.role !== 'caption' && x.y + x.h > CAPTION_TOP) {
        layoutIssues.caption.push(`t=${st.t}s「${x.text.slice(0, 18)}」进入字幕区(y=${Math.round(x.y + x.h)})`);
      }
      if (x.role !== 'caption' && x.y < HEADER_BOTTOM) {
        layoutIssues.header.push(`t=${st.t}s「${x.text.slice(0, 18)}」进入标题区(y=${Math.round(x.y)})`);
      }
      const minSize = x.role === 'caption' ? 20 : 13.5;
      if (x.size < minSize) {
        layoutIssues.font.push(`t=${st.t}s「${x.text.slice(0, 14)}」字号 ${x.size}px < ${minSize}`);
      }
    });

    const visible = texts.filter(x => x.opacity > 0.5 && x.role !== 'caption' && x.w > 4 && x.h > 4);
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const a = visible[i], b = visible[j];
        const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        const area = ox * oy;
        const minArea = Math.min(a.w * a.h, b.w * b.h);
        if (area > 260 && area > minArea * 0.28) {
          layoutIssues.overlap.push(`t=${st.t}s「${a.text.slice(0, 12)}」与「${b.text.slice(0, 12)}」重叠 ${Math.round(area)}px²`);
        }
      }
    }

    seenFrames.push({ scene: st.scene, t: st.t, path: shotPath, nonBg: +stats.nonBgRatio.toFixed(4), sd: +stats.sd.toFixed(1) });
    frames.push({ scene: info.scenes[st.scene].id, t: st.t, file: path.relative(ROOT, shotPath), texts: texts.length, nonBg: +stats.nonBgRatio.toFixed(3) });
  }

  add('layout-clip', '文字未越出画面', layoutIssues.clip.length ? 'fail' : 'pass',
    layoutIssues.clip.length ? layoutIssues.clip.slice(0, 4).join('；') : `${frames.length} 帧全部在画布内`);
  add('layout-caption', '正文不侵入字幕区', layoutIssues.caption.length ? 'fail' : 'pass',
    layoutIssues.caption.length ? layoutIssues.caption.slice(0, 4).join('；') : '内容区与字幕区物理分离');
  add('layout-header', '正文不侵入标题区', layoutIssues.header.length ? 'fail' : 'pass',
    layoutIssues.header.length ? layoutIssues.header.slice(0, 4).join('；') : '无重叠');
  add('layout-overlap', '文字之间无实质重叠', layoutIssues.overlap.length ? 'fail' : 'pass',
    layoutIssues.overlap.length ? layoutIssues.overlap.slice(0, 4).join('；') : '未检出重叠');
  add('layout-font', '字号满足可读性下限', layoutIssues.font.length ? 'fail' : 'pass',
    layoutIssues.font.length ? layoutIssues.font.slice(0, 4).join('；') : '最小正文 13.5px / 字幕 20px');
  add('contrast', '文字与底色对比足够', layoutIssues.contrast.length ? 'fail' : 'pass',
    layoutIssues.contrast.length ? layoutIssues.contrast.slice(0, 4).join('；') : '未检出低对比文字');
  add('blank', '无空白帧', blankFrames === 0 ? 'pass' : 'fail', `${blankFrames} 个采样帧内容过少`);

  // 5. 镜头内运动与跳变
  const jumpIssues = [];
  const staticScenes = [];
  for (let i = 0; i < info.scenes.length; i++) {
    const s = info.scenes[i];
    const tA = s.start + Math.max(1.2, s.duration * 0.3);
    const tB = Math.min(tA + 0.25, s.start + s.duration - 0.1);
    await page.evaluate(t => window.__lesson.seek(t), tA);
    await page.waitForTimeout(40);
    const a = pngStats(await page.screenshot({ clip: stageBox })).pixels;
    await page.evaluate(t => window.__lesson.seek(t), tB);
    await page.waitForTimeout(40);
    const b = pngStats(await page.screenshot({ clip: stageBox })).pixels;
    const d = pngDiff(a, b);
    if (d > 0.55) jumpIssues.push(`${s.id} 在 0.25s 内画面变化 ${(d * 100).toFixed(0)}%`);

    const tC = s.start + s.duration * 0.6, tD = s.start + s.duration * 0.85;
    await page.evaluate(t => window.__lesson.seek(t), tC);
    await page.waitForTimeout(40);
    const c = pngStats(await page.screenshot({ clip: stageBox })).pixels;
    await page.evaluate(t => window.__lesson.seek(t), tD);
    await page.waitForTimeout(40);
    const e = pngStats(await page.screenshot({ clip: stageBox })).pixels;
    if (pngDiff(c, e) < 0.0008 && s.duration > 8) staticScenes.push(s.id);
  }
  add('jump', '无异常闪烁或瞬变', jumpIssues.length ? 'fail' : 'pass',
    jumpIssues.length ? jumpIssues.join('；') : '0.25s 间隔画面变化均 < 55%');
  add('static', '镜头后段仍有内容推进', staticScenes.length ? 'warn' : 'pass',
    staticScenes.length ? `后 25% 时长画面几乎静止: ${staticScenes.join(', ')}` : '各镜头后段均有变化');

  // 6. probe 数值
  if (testCase && testCase.probes) {
    const probeIssues = [];
    const probeDetail = [];
    for (const [name, exp] of Object.entries(testCase.probes)) {
      const exists = info.probes.includes(name);
      if (!exists) { probeIssues.push(`缺少 probe: ${name}`); continue; }
      const val = await page.evaluate(n => {
        try { return window.__lesson.probes[n](); } catch (e) { return 'ERR:' + e.message; }
      }, name);
      const want = exp.value, tol = exp.tol === undefined ? 0.01 : exp.tol;
      if (typeof val !== 'number' || Math.abs(val - want) > tol) {
        probeIssues.push(`${name}=${val}，期望 ${want}±${tol}`);
      } else {
        probeDetail.push(`${name}=${val}`);
      }
    }
    add('probe', '关键数值/几何关系正确', probeIssues.length ? 'fail' : 'pass',
      probeIssues.length ? probeIssues.join('；') : probeDetail.join('；') || '全部通过');
  } else {
    add('probe', '关键数值/几何关系正确', 'skip', '用例未定义 probe');
  }

  // 7. 文本覆盖
  if (testCase) {
    const missing = (testCase.requiredText || []).filter(k => ![...textUnion].some(t => t.includes(k.replace(/\s+/g, ''))));
    add('required-text', '必须出现的关键表述齐备', missing.length ? 'fail' : 'pass',
      missing.length ? '缺少: ' + missing.join('、') : `${(testCase.requiredText || []).length} 项全部出现`);

    const forbidden = (testCase.forbiddenText || []).filter(k => [...textUnion].some(t => t.includes(k.replace(/\s+/g, ''))));
    add('forbidden-text', '未出现错误表述', forbidden.length ? 'fail' : 'pass',
      forbidden.length ? '出现: ' + forbidden.join('、') : '未检出禁止表述');
  }

  // 8. 字幕覆盖
  const noCaption = info.scenes.map((s, i) => i).filter(i => !captionByScene.get(i));
  add('caption', '每个镜头都有字幕讲解', noCaption.length ? 'fail' : 'pass',
    noCaption.length ? '无字幕镜头: ' + noCaption.map(i => info.scenes[i].id).join(', ') : `${info.scenes.length} 个镜头均有字幕`);

  // 9. 多分辨率
  const viewportIssues = [];
  for (const vp of [{ width: 1024, height: 576 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(vp);
    await page.evaluate(t => window.__lesson.seek(t), dur * 0.6);
    await page.waitForTimeout(120);
    const r = await page.evaluate(() => {
      const stage = document.getElementById('lesson').getBoundingClientRect();
      const svg = document.querySelector('.lesson-svg').getBoundingClientRect();
      const insp = window.__lesson.inspect();
      const minFont = Math.min(...insp.texts.filter(t => t.role !== 'ui').map(t => t.size * svg.width / 1280));
      return { minFont, svgW: svg.width, svgH: svg.height, stageW: stage.width, overflow: svg.width > stage.width + 1 || svg.height > stage.height + 1 };
    });
    if (r.overflow) viewportIssues.push(`${vp.width}×${vp.height} 画面溢出`);
    if (r.minFont < 11.5) viewportIssues.push(`${vp.width}×${vp.height} 最小字号折算 ${r.minFont.toFixed(1)}px`);
  }
  await page.setViewportSize(VIEW);
  add('viewport', '不同窗口尺寸下可读', viewportIssues.length ? 'fail' : 'pass',
    viewportIssues.length ? viewportIssues.join('；') : '1024×576 最小字号 ≥11.5px，无溢出');

  // 10. 控制台
  add('console', '运行期无脚本错误', consoleErrors.length ? 'fail' : 'pass',
    consoleErrors.length ? consoleErrors.slice(0, 3).join('；') : '0 error');

  await browser.close();
  return finish({ label, lessonPath, info, checks, frames, consoleErrors });
}

function finish(payload) {
  const failed = payload.checks.filter(c => c.status === 'fail');
  const warned = payload.checks.filter(c => c.status === 'warn');
  const result = {
    case: payload.label,
    file: path.relative(ROOT, payload.lessonPath),
    generatedAt: new Date().toISOString(),
    duration: payload.info ? payload.info.duration : null,
    scenes: payload.info ? payload.info.scenes : [],
    checks: payload.checks,
    summary: {
      total: payload.checks.length,
      pass: payload.checks.filter(c => c.status === 'pass').length,
      fail: failed.length,
      warn: warned.length,
      skip: payload.checks.filter(c => c.status === 'skip').length,
      verdict: failed.length ? 'FAIL' : (warned.length ? 'PASS_WITH_WARNINGS' : 'PASS')
    },
    frames: payload.frames,
    consoleErrors: payload.consoleErrors
  };
  return result;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const res = await main();
  const outArg = args.json && args.json !== true ? args.json : null;
  if (outArg) {
    const p = path.isAbsolute(outArg) ? outArg : path.join(ROOT, outArg);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(res, null, 2), 'utf8');
  }
  console.log(`\n=== ${res.case} ===`);
  res.checks.forEach(c => {
    const mark = c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : c.status === 'warn' ? '!' : '-';
    console.log(`${mark} [${c.id}] ${c.name}: ${c.detail}`);
  });
  console.log(`结果: ${res.summary.verdict} (pass ${res.summary.pass} / fail ${res.summary.fail} / warn ${res.summary.warn} / skip ${res.summary.skip})`);
  process.exit(res.summary.verdict === 'FAIL' ? 1 : 0);
})().catch(err => { console.error(err); process.exit(2); });
