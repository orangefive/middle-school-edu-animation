#!/usr/bin/env node
/**
 * export_storyboard.js — 从已构建的 lesson.html 导出 storyboard.json。
 * 分镜数据直接来自动画本身（镜头 id / 标题 / 时长 / 字幕 / probe），
 * 保证"文档即实现"，不会出现分镜与代码两张皮。
 *
 * 用法：
 *   node scripts/export_storyboard.js examples/mathematics/quadratic-function/lesson.html
 *   node scripts/export_storyboard.js --all
 */
'use strict';

const fs = require('fs');
const path = require('path');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('缺少依赖：playwright。分镜导出需要真实浏览器读取时间轴。');
  console.error('请在 scripts/ 目录执行：npm ci && npx playwright install chromium');
  process.exit(3);
}

const ROOT = path.resolve(__dirname, '..');

function listLessons() {
  const out = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name === 'lesson.html') out.push(p);
    }
  })(path.join(ROOT, 'examples'));
  return out.sort();
}

async function exportOne(browser, file) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const url = 'file:///' + file.replace(/\\/g, '/').replace(/^\/+/, '');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__lesson && window.__lesson.ready', null, { timeout: 15000 });
  const data = await page.evaluate(() => ({ meta: window.__lesson.meta, duration: window.__lesson.duration, scenes: window.__lesson.scenes }));
  await page.close();

  const m = data.meta || {};
  const storyboard = {
    meta: {
      title: m.title, subject: m.subject, grade: m.grade,
      duration: data.duration,
      objectives: m.objectives || [],
      prerequisites: m.prerequisites || [],
      misconceptions: m.misconceptions || [],
      corePoints: m.corePoints || [],
      optionalPoints: m.optionalPoints || [],
      animationAffordances: m.animationAffordances || [],
      durationRationale: m.durationRationale || ''
    },
    scenes: data.scenes.map(s => ({
      id: s.id,
      title: s.title,
      start: s.start,
      duration: s.duration,
      objective: s.objective,
      visual: s.visual,
      motion: s.motion,
      camera: s.camera,
      captions: s.captions,
      link: s.link,
      check: s.check
    }))
  };
  const outPath = path.join(path.dirname(file), 'storyboard.json');
  fs.writeFileSync(outPath, JSON.stringify(storyboard, null, 2), 'utf8');

  const total = storyboard.scenes.reduce((a, s) => a + s.duration, 0);
  console.log(`  ${path.relative(ROOT, outPath)} — ${storyboard.scenes.length} 镜 / ${total}s`);
  return storyboard;
}

(async () => {
  const args = process.argv.slice(2);
  const files = args.includes('--all') || args.length === 0 ? listLessons() : args.map(a => path.isAbsolute(a) ? a : path.join(ROOT, a));
  const browser = await chromium.launch();
  for (const f of files) await exportOne(browser, f);
  await browser.close();
  console.log(`[storyboard] 导出 ${files.length} 个`);
})().catch(e => { console.error(e); process.exit(1); });
