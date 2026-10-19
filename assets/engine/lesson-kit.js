/*!
 * lesson-kit.js — 中学知识点讲解动画引擎 v1.0
 * 设计原则：画面状态是时间 t 的纯函数。任意时刻 seek(t) 可复现，
 * 不使用 CSS animation / setTimeout 驱动主视觉，便于自动化逐帧验证。
 * 无任何外部依赖。
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var W = 1280, H = 720;
  var SAFE = { x: 64, y: 150, w: 1152, h: 442 };
  var CAPTION = { x: 64, y: 600, w: 1152, h: 92 };

  var EASE = {
    linear: function (p) { return p; },
    out: function (p) { return 1 - Math.pow(1 - p, 3); },
    outQuint: function (p) { return 1 - Math.pow(1 - p, 5); },
    inOut: function (p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; },
    outBack: function (p) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); }
  };

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function lerp(a, b, p) { return a + (b - a) * p; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function n(v) { return Math.round(v * 100) / 100; }
  function uid(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 9); }

  function svg(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) {
      if (attrs[k] === null || attrs[k] === undefined) continue;
      e.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(e);
    return e;
  }

  function markerHead(id, color) {
    var m = svg('marker', {
      id: id, viewBox: '0 0 10 10', refX: 9, refY: 5,
      markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'
    });
    svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: color }, m);
    return m;
  }

  /* ------------------------------------------------------------------ */
  /* Lesson                                                              */
  /* ------------------------------------------------------------------ */

  function createLesson(config) {
    var cfg = config || {};
    var meta = cfg.meta || {};
    var theme = cfg.theme || {};
    var accent = theme.accent || '#2f6fed';

    var stage = document.getElementById('lesson');
    if (!stage) throw new Error('[lesson-kit] 缺少 #lesson 容器');

    stage.style.setProperty('--accent', accent);
    if (theme.accentSoft) stage.style.setProperty('--accent-soft', theme.accentSoft);

    var svgRoot = svg('svg', {
      viewBox: '0 0 ' + W + ' ' + H, class: 'lesson-svg',
      preserveAspectRatio: 'xMidYMid meet', role: 'img',
      'aria-label': (meta.title || '教学动画') + ' 动画画面'
    }, stage);

    var defs = svg('defs', null, svgRoot);

    var measureCanvas = document.createElement('canvas');
    var mctx = measureCanvas.getContext('2d');
    function measure(str, size, weight) {
      mctx.font = (weight || 400) + ' ' + size + 'px "Microsoft YaHei", "PingFang SC", sans-serif';
      return mctx.measureText(str).width;
    }
    if (!theme.accentSoft) {
      stage.style.setProperty('--accent-soft', 'rgba(47,111,237,0.10)');
    }

    // 背景与内容层
    svg('rect', { x: 0, y: 0, width: W, height: H, fill: 'var(--bg, #f6f8fb)' }, svgRoot);
    var bgLayer = svg('g', { class: 'bg-layer' }, svgRoot);
    var sceneLayer = svg('g', { class: 'scene-layer' }, svgRoot);
    var hudLayer = svg('g', { class: 'hud-layer' }, svgRoot);

    // 顶部装饰线
    if (theme.showTopBar !== false) {
      svg('rect', { x: 0, y: 0, width: W, height: 6, fill: accent, opacity: 0.9 }, bgLayer);
    }

    /* ---- HUD ---- */
    var badge = svg('g', { class: 'hud-badge' }, hudLayer);
    var badgeRect = svg('rect', { x: 64, y: 30, height: 30, rx: 15, fill: 'var(--accent-soft)' }, badge);
    var badgeText = svg('text', {
      x: 80, y: 51, 'font-size': 15, 'font-weight': 600, fill: accent, 'data-role': 'ui'
    }, badge);
    badgeText.textContent = (meta.subject || '') + (meta.grade ? ' · ' + meta.grade : '');

    var sceneTitle = svg('text', {
      x: 64, y: 108, 'font-size': 34, 'font-weight': 700, fill: 'var(--ink)', 'data-role': 'ui'
    }, hudLayer);

    var lessonTitle = svg('text', {
      x: 1216, y: 52, 'font-size': 16, fill: 'var(--muted)', 'text-anchor': 'end', 'data-role': 'ui'
    }, hudLayer);
    lessonTitle.textContent = meta.title || '';

    var counter = svg('text', {
      x: 1216, y: 108, 'font-size': 16, fill: 'var(--muted)', 'text-anchor': 'end',
      'font-variant-numeric': 'tabular-nums', 'data-role': 'ui'
    }, hudLayer);

    svg('line', { x1: 64, y1: 128, x2: 1216, y2: 128, stroke: 'var(--line)', 'stroke-width': 1 }, hudLayer);

    /* ---- 字幕层 ---- */
    var capGroup = svg('g', { class: 'caption', 'data-role': 'caption-group' }, hudLayer);
    svg('rect', { x: 0, y: 590, width: W, height: 116, fill: '#ffffff', opacity: 0.92 }, capGroup);
    svg('line', { x1: 64, y1: 590, x2: 1216, y2: 590, stroke: 'var(--line)', 'stroke-width': 1 }, capGroup);
    var capText = svg('text', {
      x: 64, y: 628, 'font-size': 24, fill: 'var(--ink)', 'data-role': 'caption'
    }, capGroup);

    /* ---- 底部进度 ---- */
    svg('rect', { x: 0, y: 714, width: W, height: 6, fill: 'var(--line-soft, #e3eaf3)' }, hudLayer);
    var progress = svg('rect', { x: 0, y: 714, width: 0, height: 6, fill: accent }, hudLayer);
    var timeText = svg('text', {
      x: 1216, y: 706, 'font-size': 13, fill: 'var(--muted)', 'text-anchor': 'end',
      'font-variant-numeric': 'tabular-nums', 'data-role': 'ui'
    }, hudLayer);
    var hintText = svg('text', {
      x: 64, y: 706, 'font-size': 13, fill: 'var(--muted)', 'data-role': 'ui'
    }, hudLayer);
    hintText.textContent = '空格 播放/暂停 · ← → 跳转 5 秒 · R 重播';
    var hit = svg('rect', {
      x: 0, y: 690, width: W, height: 30, fill: 'transparent', style: 'cursor:pointer'
    }, hudLayer);

    /* ---- 时间轴构建 ---- */
    var scenes = [];
    var t = 0;
    (cfg.scenes || []).forEach(function (sc, i) {
      var start = (typeof sc.start === 'number') ? sc.start : t;
      var dur = Number(sc.duration);
      if (!isFinite(dur) || dur <= 0) throw new Error('[lesson-kit] 镜头 ' + sc.id + ' 时长非法');
      var scene = {
        id: sc.id || ('scene-' + (i + 1)),
        title: sc.title || '',
        objective: sc.objective || '',
        visual: sc.visual || '',
        motion: sc.motion || '',
        camera: sc.camera || '固定机位',
        link: sc.link || '',
        check: sc.check || '',
        start: start,
        duration: dur,
        end: start + dur,
        cues: (sc.cues || []).slice(),
        tracks: [],
        probes: {},
        cfg: sc,
        g: svg('g', { class: 'scene', 'data-scene': sc.id || ('scene-' + (i + 1)) }, sceneLayer)
      };
      scenes.push(scene);
      t = start + dur;
    });
    var duration = Math.max.apply(null, scenes.map(function (s) { return s.end; }));

    /* ---- 每镜头上下文 ---- */
    scenes.forEach(function (scene, idx) {
      var ctx = makeContext(scene, idx, scenes.length);
      try {
        scene.cfg.build(ctx);
      } catch (err) {
        console.error('[lesson-kit] 镜头 ' + scene.id + ' 构建失败: ' + err.message);
        throw err;
      }
      // 引擎接管：入场淡入
      scene.tracks.push({
        t0: 0, t1: 0.4, fn: function (p) { scene.g.setAttribute('opacity', n(clamp(p, 0, 1))); }
      });
    });
    // 初始隐藏
    scenes.forEach(function (s) { s.g.setAttribute('display', 'none'); });

    /* ---- 渲染 ---- */
    var current = 0;
    var playing = false;
    var speed = 1;
    var lastTs = 0;
    var lastSceneIdx = -1;
    var lastCueKey = '';

    function activeSceneIndex(tt) {
      if (tt >= duration - 1e-6) return scenes.length - 1;
      for (var i = 0; i < scenes.length; i++) {
        if (tt >= scenes[i].start - 1e-6 && tt < scenes[i].end - 1e-6) return i;
      }
      return 0;
    }

    function render(tt) {
      tt = clamp(tt, 0, duration);
      current = tt;
      var idx = activeSceneIndex(tt);
      var scene = scenes[idx];

      if (idx !== lastSceneIdx) {
        scenes.forEach(function (s, i) { s.g.setAttribute('display', i === idx ? '' : 'none'); });
        sceneTitle.textContent = scene.title;
        counter.textContent = pad(idx + 1) + ' / ' + pad(scenes.length);
        lastSceneIdx = idx;
        lastCueKey = '';
      }

      var local = clamp(tt - scene.start, 0, scene.duration);
      scene.tracks.forEach(function (tr) {
        var span = Math.max(1e-6, tr.t1 - tr.t0);
        var p = clamp((local - tr.t0) / span, 0, 1);
        tr.fn(p, local);
      });

      // 字幕
      var cue = pickCue(scene, local);
      var key = cue ? cue.text : '';
      if (key !== lastCueKey) {
        setCaption(key);
        lastCueKey = key;
      }
      if (cue) {
        var op = clamp((local - cue.t) / 0.24, 0, 1);
        capGroup.setAttribute('opacity', n(0.25 + 0.75 * op));
      } else {
        capGroup.setAttribute('opacity', '0.25');
      }

      progress.setAttribute('width', n(W * (tt / duration)));
      timeText.textContent = fmt(tt) + ' / ' + fmt(duration);
    }

    function pad(v) { return v < 10 ? '0' + v : '' + v; }
    function fmt(s) {
      s = Math.max(0, Math.round(s));
      return Math.floor(s / 60) + ':' + pad(s % 60);
    }
    function pickCue(scene, local) {
      var out = null;
      for (var i = 0; i < scene.cues.length; i++) {
        if (scene.cues[i].t <= local + 1e-6) out = scene.cues[i];
        else break;
      }
      return out;
    }

    function wrapCaption(str, maxW) {
      var lines = [], line = '';
      for (var i = 0; i < str.length; i++) {
        var ch = str[i];
        if (ch === '\n') { lines.push(line); line = ''; continue; }
        if (measure(line + ch, 24) > maxW && line) { lines.push(line); line = ch; }
        else line += ch;
      }
      if (line) lines.push(line);
      return lines.slice(0, 2);
    }
    function setCaption(str) {
      while (capText.firstChild) capText.removeChild(capText.firstChild);
      if (!str) return;
      var lines = wrapCaption(str, 1120);
      lines.forEach(function (ln, i) {
        var ts = svg('tspan', { x: 64, dy: i === 0 ? 0 : 36 }, capText);
        ts.textContent = ln;
      });
    }

    /* ---- 播放控制 ---- */
    function seek(tt, opts) {
      render(tt);
      if (!(opts && opts.silent)) { /* no-op */ }
    }
    function play() {
      if (playing) return;
      if (current >= duration - 0.05) current = 0;
      playing = true; lastTs = 0;
      requestAnimationFrame(loop);
    }
    function pause() { playing = false; }
    function loop(ts) {
      if (!playing) return;
      if (!lastTs) lastTs = ts;
      var dt = (ts - lastTs) / 1000;
      lastTs = ts;
      var nt = current + dt * speed;
      if (nt >= duration) { render(duration); playing = false; return; }
      render(nt);
      requestAnimationFrame(loop);
    }

    /* ---- 自定义 t 起点（?t=12.5&autoplay=0&speed=1.5） ---- */
    var params = new URLSearchParams(location.search);
    var t0 = parseFloat(params.get('t'));
    if (isFinite(t0)) { render(clamp(t0, 0, duration)); }
    else render(0);
    if (params.get('speed')) speed = clamp(parseFloat(params.get('speed')) || 1, 0.25, 4);
    var autoplay = params.get('autoplay') !== '0';
    if (autoplay) play();

    /* ---- 交互 ---- */
    document.addEventListener('keydown', function (e) {
      if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); }
      else if (e.code === 'ArrowRight') { pause(); render(clamp(current + 5, 0, duration)); }
      else if (e.code === 'ArrowLeft') { pause(); render(clamp(current - 5, 0, duration)); }
      else if (e.key === 'r' || e.key === 'R') { render(0); play(); }
      else if (e.key === 'Home') { pause(); render(0); }
    });
    hit.addEventListener('click', function (e) {
      var r = svgRoot.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width * W;
      render(clamp(px / W * duration, 0, duration));
    });

    /* ---- 供自动化测试使用 ---- */
    var probes = {};
    scenes.forEach(function (s) {
      Object.keys(s.probes).forEach(function (k) { probes[k] = s.probes[k]; });
    });

    function inspect() {
      var r = svgRoot.getBoundingClientRect();
      var sx = r.width / W, sy = r.height / H;
      var out = [];
      var idx = activeSceneIndex(current);
      var nodeList = Array.prototype.slice.call(scenes[idx].g.querySelectorAll('text'));
      if (capText.textContent && capText.textContent.trim()) nodeList.push(capText);
      for (var i = 0; i < nodeList.length; i++) {
        var el = nodeList[i];
        var bb = el.getBoundingClientRect();
        if (bb.width < 0.5 || bb.height < 0.5) continue;
        var op = 1;
        var p = el;
        while (p && p !== svgRoot) { op *= parseFloat(getComputedStyle(p).opacity || '1'); p = p.parentNode; }
        if (op < 0.06) continue;
        out.push({
          text: (el.textContent || '').trim(),
          role: el.getAttribute('data-role') || 'content',
          x: n((bb.left - r.left) / sx), y: n((bb.top - r.top) / sy),
          w: n(bb.width / sx), h: n(bb.height / sy),
          size: n(parseFloat(getComputedStyle(el).fontSize) / sx),
          opacity: n(op)
        });
      }
      return {
        t: n(current), duration: duration, scene: scenes[idx].id,
        sceneIndex: idx, texts: out.filter(function (x) { return x.text.length > 0; }),
        captionOpacity: parseFloat(capGroup.getAttribute('opacity') || '1'),
        playing: playing
      };
    }

    var api = {
      version: '1.0',
      meta: meta,
      duration: duration,
      scenes: scenes.map(function (s) {
        return {
          id: s.id, title: s.title, objective: s.objective, start: s.start, duration: s.duration,
          visual: s.visual, motion: s.motion, camera: s.camera, link: s.link, check: s.check,
          captions: s.cues.map(function (c) { return { t: n(c.t), text: c.text }; })
        };
      }),
      seek: function (v) { pause(); render(v); return current; },
      play: play, pause: pause,
      isPlaying: function () { return playing; },
      inspect: inspect,
      probes: probes,
      ready: true
    };
    global.__lesson = api;
    return api;

    /* ================================================================ */
    /* Context helpers                                                   */
    /* ================================================================ */

    function makeContext(scene, index, total) {
      var g = scene.g;

      function roleOf(opts) { return (opts && opts.role) || 'content'; }
      function applyText(el, opts) {
        opts = opts || {};
        if (opts.size) el.setAttribute('font-size', opts.size);
        if (opts.fill) el.setAttribute('fill', opts.fill);
        if (opts.weight) el.setAttribute('font-weight', opts.weight);
        if (opts.anchor) el.setAttribute('text-anchor', opts.anchor);
        if (opts.italic) el.setAttribute('font-style', 'italic');
        if (opts.opacity !== undefined) el.setAttribute('opacity', opts.opacity);
        if (opts.halo !== false) {
          el.setAttribute('paint-order', 'stroke');
          el.setAttribute('stroke', opts.haloFill || '#ffffff');
          el.setAttribute('stroke-width', opts.haloWidth || 4);
          el.setAttribute('stroke-linejoin', 'round');
        }
        el.setAttribute('data-role', roleOf(opts));
        return el;
      }

      var ctx = {
        index: index, total: total, start: scene.start, duration: scene.duration,
        safe: SAFE, W: W, H: H, accent: accent,
        scene: scene,
        g: g,
        $: function (sel) { return g.querySelector(sel); },
        $$: function (sel) { return Array.prototype.slice.call(g.querySelectorAll(sel)); },
        add: function (e) { g.appendChild(e); return e; },

        group: function (html, attrs) {
          var el = svg('g', attrs || {}, g);
          if (html) el.innerHTML = html;
          return el;
        },

        text: function (x, y, str, opts) {
          opts = opts || {};
          var el = svg('text', {
            x: x, y: y, 'font-size': opts.size || 22,
            fill: opts.fill || 'var(--ink)',
            'font-weight': opts.weight || 400,
            'text-anchor': opts.anchor || 'start'
          }, g);
          el.textContent = str;
          return applyText(el, opts);
        },

        rect: function (x, y, w, h, opts) {
          opts = opts || {};
          return svg('rect', {
            x: x, y: y, width: w, height: h,
            rx: opts.rx === undefined ? 12 : opts.rx,
            fill: opts.fill || '#ffffff',
            stroke: opts.stroke || 'none',
            'stroke-width': opts.width || 1.5,
            opacity: opts.opacity === undefined ? 1 : opts.opacity,
            'data-role': opts.role || 'shape'
          }, g);
        },

        circle: function (cx, cy, r, opts) {
          opts = opts || {};
          return svg('circle', {
            cx: cx, cy: cy, r: r, fill: opts.fill || 'none',
            stroke: opts.stroke || 'none', 'stroke-width': opts.width || 2,
            opacity: opts.opacity === undefined ? 1 : opts.opacity,
            'data-role': opts.role || 'shape'
          }, g);
        },

        line: function (x1, y1, x2, y2, opts) {
          opts = opts || {};
          return svg('line', {
            x1: x1, y1: y1, x2: x2, y2: y2,
            stroke: opts.stroke || 'var(--line)',
            'stroke-width': opts.width || 1.5,
            'stroke-dasharray': opts.dash || null,
            'stroke-linecap': 'round',
            opacity: opts.opacity === undefined ? 1 : opts.opacity,
            'data-role': opts.role || 'shape'
          }, g);
        },

        path: function (d, opts) {
          opts = opts || {};
          return svg('path', {
            d: d, fill: opts.fill || 'none',
            stroke: opts.stroke || 'var(--ink)',
            'stroke-width': opts.width || 3,
            'stroke-dasharray': opts.dash || null,
            'stroke-linecap': opts.linecap || 'round',
            'stroke-linejoin': 'round',
            opacity: opts.opacity === undefined ? 1 : opts.opacity,
            'data-role': opts.role || 'shape'
          }, g);
        },

        /* 箭头：线 + 三角头，可动画生长 */
        arrow: function (opts) {
          var color = opts.color || accent;
          var width = opts.width || 3;
          var head = opts.head || 12;
          var grp = svg('g', { 'data-role': 'arrow' }, g);
          var ln = svg('line', {
            x1: opts.x1, y1: opts.y1, x2: opts.x1, y2: opts.y1,
            stroke: color, 'stroke-width': width, 'stroke-linecap': 'round'
          }, grp);
          var hd = svg('path', { d: 'M0,0 L1,0 L0.5,1 z', fill: color, opacity: 0 }, grp);
          var t0 = opts.t0 || 0, dur = opts.dur === undefined ? 0.6 : opts.dur;
          var label = null;
          if (opts.label) {
            label = svg('text', {
              x: 0, y: 0, 'font-size': opts.labelSize || 17,
              fill: opts.labelFill || color, 'text-anchor': 'middle',
              'font-weight': 600, 'data-role': 'label'
            }, grp);
            label.textContent = opts.label;
            label.setAttribute('paint-order', 'stroke');
            label.setAttribute('stroke', '#ffffff');
            label.setAttribute('stroke-width', 4);
          }
          function draw(p) {
            var x2 = lerp(opts.x1, opts.x2, p), y2 = lerp(opts.y1, opts.y2, p);
            var ang = Math.atan2(opts.y2 - opts.y1, opts.x2 - opts.x1) * 180 / Math.PI;
            var shorten = p > 0.9 ? head * 0.8 : 0;
            ln.setAttribute('x2', n(x2 - Math.cos(ang * Math.PI / 180) * shorten));
            ln.setAttribute('y2', n(y2 - Math.sin(ang * Math.PI / 180) * shorten));
            hd.setAttribute('transform', 'translate(' + n(x2) + ',' + n(y2) + ') rotate(' + n(ang) + ') scale(' + head + ',' + head * 0.55 + ') translate(-1,-0.5)');
            hd.setAttribute('opacity', p > 0.55 ? n(clamp((p - 0.55) / 0.3, 0, 1)) : 0);
            if (label) {
              var mx = (opts.x1 + x2) / 2 + (opts.labelDx || 0);
              var my = (opts.y1 + y2) / 2 + (opts.labelDy || -10);
              label.setAttribute('x', n(mx));
              label.setAttribute('y', n(my));
              label.setAttribute('opacity', p > 0.5 ? n(clamp((p - 0.5) / 0.4, 0, 1)) * 0.95 : 0);
            }
          }
          draw(0);
          ctx.tween(t0, dur, draw, opts.ease ? EASE[opts.ease] : EASE.out);
          return grp;
        },

        /* 基础动画 */
        tween: function (t0, dur, fn, ease) {
          var e = typeof ease === 'function' ? ease : (EASE[ease] || EASE.out);
          scene.tracks.push({
            t0: t0, t1: t0 + Math.max(0.001, dur),
            fn: function (p) { fn(e(p), p); }
          });
        },
        fade: function (el, t0, dur, from, to) {
          dur = dur === undefined ? 0.5 : dur;
          from = from === undefined ? 0 : from;
          to = to === undefined ? 1 : to;
          ctx.tween(t0, dur, function (p) { el.setAttribute('opacity', n(lerp(from, to, p))); }, 'out');
        },
        rise: function (el, t0, dur, dy) {
          dur = dur === undefined ? 0.5 : dur; dy = dy === undefined ? 14 : dy;
          ctx.tween(t0, dur, function (p) {
            el.setAttribute('opacity', n(clamp(p * 1.15, 0, 1)));
            el.setAttribute('transform', 'translate(0,' + n(dy * (1 - p)) + ')');
          }, 'out');
        },
        pop: function (el, t0, dur, from) {
          dur = dur === undefined ? 0.45 : dur; from = from === undefined ? 0.82 : from;
          var bb = el.getBBox();
          var cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
          ctx.tween(t0, dur, function (p) {
            var s = lerp(from, 1, p);
            el.setAttribute('opacity', n(clamp(p * 1.4, 0, 1)));
            el.setAttribute('transform', 'translate(' + n(cx) + ',' + n(cy) + ') scale(' + n(s) + ') translate(' + n(-cx) + ',' + n(-cy) + ')');
          }, 'outBack');
        },
        draw: function (el, t0, dur) {
          dur = dur === undefined ? 1.2 : dur;
          el.setAttribute('pathLength', '1');
          el.setAttribute('stroke-dasharray', '1');
          ctx.tween(t0, dur, function (p) { el.setAttribute('stroke-dashoffset', n(1 - p)); }, 'inOut');
        },
        count: function (el, t0, dur, from, to, fmtFn) {
          ctx.tween(t0, dur, function (p) {
            var v = lerp(from, to, p);
            el.textContent = fmtFn ? fmtFn(v) : String(Math.round(v));
          }, 'out');
        },
        move: function (el, t0, dur, from, to, ease) {
          ctx.tween(t0, dur, function (p) {
            el.setAttribute('transform', 'translate(' + n(lerp(from[0], to[0], p)) + ',' + n(lerp(from[1], to[1], p)) + ')');
          }, ease || 'inOut');
        },
        /* 光点沿路径移动 */
        travel: function (pathEl, opts) {
          var len = pathEl.getTotalLength();
          var dot = svg('circle', {
            r: opts.r || 5, fill: opts.color || '#ffb703', opacity: 0,
            'data-role': 'shape'
          }, opts.parent || g);
          ctx.tween(opts.t0 || 0, opts.dur || 2, function (p) {
            var pt = pathEl.getPointAtLength(len * clamp(p, 0, 1));
            dot.setAttribute('cx', n(pt.x));
            dot.setAttribute('cy', n(pt.y));
            dot.setAttribute('opacity', p > 0.02 && p < 0.995 ? 1 : 0);
          }, 'linear');
          return dot;
        },
        emphasize: function (el, t0, dur, opts) {
          opts = opts || {};
          var bb = el.getBBox();
          var cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
          var baseW = parseFloat(el.getAttribute('stroke-width') || '3');
          ctx.tween(t0, dur, function (p) {
            var k = Math.sin(Math.PI * clamp(p, 0, 1)) * 0.5 + 1;
            el.setAttribute('stroke-width', n(baseW * k));
            if (opts.fill) el.setAttribute('fill', opts.fill);
            el.setAttribute('transform', 'translate(' + n(cx) + ',' + n(cy) + ') scale(' + n(lerp(1, 1.06, p)) + ') translate(' + n(-cx) + ',' + n(-cy) + ')');
          }, 'inOut');
        },
        probe: function (name, fn) { scene.probes[name] = fn; },
        cue: function (tt, text) { scene.cues.push({ t: tt, text: text }); },
        cues: function (arr) { arr.forEach(function (c) { scene.cues.push(c); }); },
        sortCues: function () { scene.cues.sort(function (a, b) { return a.t - b.t; }); },

        /* 面板 */
        panel: function (x, y, w, h, opts) {
          opts = opts || {};
          var grp = svg('g', {}, g);
          svg('rect', {
            x: x, y: y, width: w, height: h, rx: opts.rx === undefined ? 16 : opts.rx,
            fill: opts.fill || '#ffffff', stroke: opts.stroke || 'var(--line)', 'stroke-width': 1.5
          }, grp);
          if (opts.title) {
            var tt = svg('text', {
              x: x + 24, y: y + 38, 'font-size': opts.titleSize || 20,
              'font-weight': 700, fill: opts.titleFill || 'var(--ink)', 'data-role': 'label'
            }, grp);
            tt.textContent = opts.title;
          }
          return grp;
        },

        /* 标注（带引线或不带） */
        callout: function (x, y, text, opts) {
          opts = opts || {};
          var size = opts.size || 17;
          var grp = svg('g', {}, g);
          var tw = measure(text, size, 600) + 20;
          var th = size + 16;
          var anchor = opts.anchor || 'start';
          var bx = anchor === 'end' ? x - tw : (anchor === 'middle' ? x - tw / 2 : x);
          var fill = opts.fill || 'var(--accent-soft)';
          if (opts.outline) {
            svg('rect', { x: bx, y: y - th + 4, width: tw, height: th, rx: 8, fill: '#ffffff', stroke: opts.color || accent, 'stroke-width': 1.5 }, grp);
          } else {
            svg('rect', { x: bx, y: y - th + 4, width: tw, height: th, rx: 8, fill: fill }, grp);
          }
          var tx = svg('text', {
            x: bx + 10, y: y - 4, 'font-size': size, 'font-weight': 600,
            fill: opts.color || 'var(--ink)', 'data-role': 'label'
          }, grp);
          tx.textContent = text;
          return grp;
        },

        /* 坐标轴 + 数据坐标映射 */
        axes: function (opts) { return makeAxes(ctx, opts); },

        /* 表格：返回 cell(row,col) 便于逐格淡入 */
        table: function (opts) {
          var x = opts.x, y = opts.y, rowH = opts.rowH || 44;
          var colW = opts.colW, rows = opts.rows || [], header = opts.header || null;
          var allRows = header ? [header].concat(rows) : rows;
          var totalW = colW.reduce(function (a, b) { return a + b; }, 0);
          var grp = svg('g', { 'data-role': 'table' }, g);
          var cellEls = [];
          allRows.forEach(function (row, ri) {
            var cy = y + ri * rowH;
            var isHead = header && ri === 0;
            svg('rect', {
              x: x, y: cy, width: totalW, height: rowH,
              fill: isHead ? 'var(--accent-soft)' : (ri % 2 === 0 ? '#ffffff' : '#fbfcfe'),
              stroke: 'var(--line)', 'stroke-width': 1
            }, grp);
            var cx = x;
            var line = [];
            row.forEach(function (val, ci) {
              if (ci > 0) {
                svg('line', { x1: cx, y1: cy, x2: cx, y2: cy + rowH, stroke: 'var(--line)', 'stroke-width': 1 }, grp);
              }
              var tEl = svg('text', {
                x: cx + colW[ci] / 2, y: cy + rowH / 2 + (opts.size || 20) * 0.36,
                'font-size': opts.size || 20, 'text-anchor': 'middle',
                'font-weight': isHead ? 700 : (opts.weight || 500),
                fill: isHead ? accent : 'var(--ink)', 'data-role': 'label'
              }, grp);
              tEl.textContent = val;
              line.push(tEl);
              cx += colW[ci];
            });
            cellEls.push(line);
          });
          return {
            g: grp, cells: cellEls,
            revealRow: function (ri, t0, dur) {
              var row = cellEls[ri] || [];
              row.forEach(function (c, ci) { ctx.fade(c, t0 + ci * 0.06, dur || 0.3); });
              var bg = grp.querySelectorAll('rect')[ri];
              if (bg) ctx.fade(bg, t0, dur || 0.3, 0, 1);
            }
          };
        },

        /* 分栏辅助 */
        divider: function (x, y1, y2, label) {
          svg('line', { x1: x, y1: y1, x2: x, y2: y2, stroke: 'var(--line)', 'stroke-width': 1, 'stroke-dasharray': '4 6' }, g);
          if (label) {
            var t = svg('text', { x: x, y: y1 - 10, 'font-size': 14, fill: 'var(--muted)', 'text-anchor': 'middle', 'data-role': 'ui' }, g);
            t.textContent = label;
          }
        }
      };
      return ctx;
    }

    /* ---------------- axes ---------------- */
    function makeAxes(ctx, opts) {
      var x0 = opts.x[0], x1 = opts.x[1], y0 = opts.y[0], y1 = opts.y[1];
      var box = opts.box;
      var sx = function (v) { return box.x + (v - x0) / (x1 - x0) * box.w; };
      var sy = function (v) { return box.y + box.h - (v - y0) / (y1 - y0) * box.h; };
      var grp = svg('g', { 'data-role': 'axes' }, ctx.g);
      var clipId = uid('clip');
      var cp = svg('clipPath', { id: clipId }, svg('defs', null, ctx.g.ownerSVGElement));
      svg('rect', { x: box.x, y: box.y, width: box.w, height: box.h }, cp);

      var t0 = opts.t0 || 0;
      var gridColor = opts.gridColor || 'var(--grid)';
      var axisColor = opts.axisColor || 'var(--line-strong, #9fb0c6)';

      // 网格
      if (opts.grid !== false) {
        var gx = opts.xStep || 1, gy = opts.yStep || 1;
        for (var gxv = Math.ceil(x0 / gx) * gx; gxv <= x1 + 1e-9; gxv += gx) {
          if (Math.abs(gxv) < 1e-9) continue;
          svg('line', { x1: sx(gxv), y1: box.y, x2: sx(gxv), y2: box.y + box.h, stroke: gridColor, 'stroke-width': 1 }, grp);
        }
        for (var gyv = Math.ceil(y0 / gy) * gy; gyv <= y1 + 1e-9; gyv += gy) {
          if (Math.abs(gyv) < 1e-9) continue;
          svg('line', { x1: box.x, y1: sy(gyv), x2: box.x + box.w, y2: sy(gyv), stroke: gridColor, 'stroke-width': 1 }, grp);
        }
      }

      // 轴
      var ax = (x0 <= 0 && x1 >= 0) ? sx(0) : box.x;
      var ay = (y0 <= 0 && y1 >= 0) ? sy(0) : box.y + box.h;
      svg('line', { x1: box.x, y1: ay, x2: box.x + box.w, y2: ay, stroke: axisColor, 'stroke-width': 1.8 }, grp);
      svg('line', { x1: ax, y1: box.y + box.h, x2: ax, y2: box.y, stroke: axisColor, 'stroke-width': 1.8 }, grp);
      // 箭头
      svg('path', { d: 'M' + (box.x + box.w) + ',' + ay + ' l-9,-4.5 v9 z', fill: axisColor }, grp);
      svg('path', { d: 'M' + ax + ',' + box.y + ' l-4.5,9 h9 z', fill: axisColor }, grp);

      // 刻度
      var tickSize = opts.tickSize || 14;
      var stepX = opts.xTick || opts.xStep || 1;
      var stepY = opts.yTick || opts.yStep || 1;
      for (var vx = Math.ceil(x0 / stepX) * stepX; vx <= x1 + 1e-9; vx += stepX) {
        if (Math.abs(vx) < 1e-9) continue;
        svg('line', { x1: sx(vx), y1: ay - 4, x2: sx(vx), y2: ay + 4, stroke: axisColor, 'stroke-width': 1.4 }, grp);
        if (opts.tickLabels !== false) {
          var tx = svg('text', {
            x: sx(vx), y: ay + 22, 'font-size': tickSize, fill: 'var(--muted)',
            'text-anchor': 'middle', 'data-role': 'label'
          }, grp);
          tx.textContent = fmtNum(vx);
        }
      }
      for (var vy = Math.ceil(y0 / stepY) * stepY; vy <= y1 + 1e-9; vy += stepY) {
        if (Math.abs(vy) < 1e-9) continue;
        svg('line', { x1: ax - 4, y1: sy(vy), x2: ax + 4, y2: sy(vy), stroke: axisColor, 'stroke-width': 1.4 }, grp);
        if (opts.tickLabels !== false) {
          var ty = svg('text', {
            x: ax - 10, y: sy(vy) + 5, 'font-size': tickSize, fill: 'var(--muted)',
            'text-anchor': 'end', 'data-role': 'label'
          }, grp);
          ty.textContent = fmtNum(vy);
        }
      }
      var ox = svg('text', { x: ax - 10, y: ay + 20, 'font-size': tickSize, fill: 'var(--muted)', 'text-anchor': 'end', 'data-role': 'label' }, grp);
      ox.textContent = 'O';
      if (opts.xLabel) {
        var xl = svg('text', { x: box.x + box.w + 8, y: ay - 10, 'font-size': 18, fill: 'var(--muted)', 'font-style': 'italic', 'data-role': 'label' }, grp);
        xl.textContent = opts.xLabel;
      }
      if (opts.yLabel) {
        var yl = svg('text', { x: ax + 12, y: box.y + 8, 'font-size': 18, fill: 'var(--muted)', 'font-style': 'italic', 'data-role': 'label' }, grp);
        yl.textContent = opts.yLabel;
      }

      function fmtNum(v) {
        var r = Math.round(v * 100) / 100;
        return (r === Math.floor(r)) ? String(r) : String(r).replace(/\.?0+$/, '');
      }

      var api = {
        px: sx, py: sy, box: box, g: grp, clip: 'url(#' + clipId + ')',
        fmt: fmtNum,
        /* 曲线：samples 点采样 + 生长动画 */
        curve: function (fn, o) {
          o = o || {};
          var N = o.samples || 320;
          var pts = [], started = false, d = '';
          for (var i = 0; i <= N; i++) {
            var xv = x0 + (x1 - x0) * i / N;
            var yv = fn(xv);
            if (!isFinite(yv)) { started = false; continue; }
            var px = sx(xv), py = sy(yv);
            if (py < box.y - 400 || py > box.y + box.h + 400) { started = false; continue; }
            if (!started) { d += 'M' + n(px) + ',' + n(py); started = true; }
            else d += 'L' + n(px) + ',' + n(py);
          }
          var el = svg('path', {
            d: d, fill: 'none', stroke: o.color || accent,
            'stroke-width': o.width || 3.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
            'clip-path': 'url(#' + clipId + ')', 'data-role': 'shape'
          }, ctx.g);
          if (o.t0 !== undefined) ctx.draw(el, o.t0, o.dur === undefined ? 2 : o.dur);
          return el;
        },
        /* 线段（带生长） */
        segment: function (xa, ya, xb, yb, o) {
          o = o || {};
          var ln = svg('line', {
            x1: sx(xa), y1: sy(ya), x2: sx(xa), y2: sy(ya),
            stroke: o.color || accent, 'stroke-width': o.width || 2.4,
            'stroke-dasharray': o.dash || null, 'stroke-linecap': 'round',
            'clip-path': 'url(#' + clipId + ')', 'data-role': 'shape'
          }, ctx.g);
          var t0 = o.t0 || 0, dur = o.dur === undefined ? 0.7 : o.dur;
          ctx.tween(t0, dur, function (p) {
            ln.setAttribute('x2', n(lerp(sx(xa), sx(xb), p)));
            ln.setAttribute('y2', n(lerp(sy(ya), sy(yb), p)));
          }, 'out');
          return ln;
        },
        vline: function (xv, o) {
          o = o || {};
          return api.segment(xv, o.from === undefined ? y0 : o.from, xv, o.to === undefined ? y1 : o.to, o);
        },
        hline: function (yv, o) {
          o = o || {};
          return api.segment(o.from === undefined ? x0 : o.from, yv, o.to === undefined ? x1 : o.to, yv, o);
        },
        /* 点 + 标签 */
        point: function (xv, yv, o) {
          o = o || {};
          var grp2 = svg('g', { 'data-role': 'point' }, ctx.g);
          svg('circle', {
            cx: sx(xv), cy: sy(yv), r: o.r || 5.5,
            fill: o.color || accent, stroke: '#ffffff', 'stroke-width': 2
          }, grp2);
          if (o.label) {
            var tx = svg('text', {
              x: sx(xv) + (o.dx === undefined ? 10 : o.dx),
              y: sy(yv) + (o.dy === undefined ? -12 : o.dy),
              'font-size': o.size || 16, 'font-weight': 600, fill: o.color || accent,
              'text-anchor': (o.dx || 0) < 0 ? 'end' : 'start', 'data-role': 'label'
            }, grp2);
            tx.textContent = o.label;
            tx.setAttribute('paint-order', 'stroke');
            tx.setAttribute('stroke', '#ffffff');
            tx.setAttribute('stroke-width', 4);
          }
          if (o.t0 !== undefined) ctx.pop(grp2, o.t0, 0.4);
          return grp2;
        }
      };
      return api;
    }
  }

  global.EduKit = { createLesson: createLesson, EASE: EASE, W: W, H: H, SAFE: SAFE };
})(window);
