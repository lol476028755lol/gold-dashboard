/* 迷你折线图：纯 Canvas，无第三方依赖；口径见 dashboard-spec.md §4 */
(function () {
  "use strict";

  function sparkline(canvas, points, color) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 300;
    const cssH = 56;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const valid = (points || []).filter((n) => typeof n === "number" && isFinite(n));
    if (valid.length < 2) {
      ctx.save();
      ctx.strokeStyle = "rgba(139,147,179,0.35)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, cssH / 2);
      ctx.lineTo(cssW, cssH / 2);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const min = Math.min(...valid);
    const max = Math.max(...valid);
    const padY = 8;
    const range = max - min || 1;
    const x = (i) => (i / (valid.length - 1)) * cssW;
    const y = (v) => cssH - padY - ((v - min) / range) * (cssH - padY * 2);

    // gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, cssH);
    grad.addColorStop(0, hexA(color, 0.22));
    grad.addColorStop(1, hexA(color, 0));
    ctx.beginPath();
    valid.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.lineTo(cssW, cssH);
    ctx.lineTo(0, cssH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // line
    ctx.beginPath();
    valid.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    // last dot
    const lastX = x(valid.length - 1);
    const lastY = y(valid[valid.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX - 1, lastY, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  const UP = "#34d399";   // 涨：绿（与面板语义色 good 一致）
  const DOWN = "#f87171"; // 跌：红（与面板语义色 red 一致）

  // 日K蜡烛图：candles = [{date, open, high, low, close}]，逐根按涨跌着色
  function candle(canvas, candles) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 300;
    const cssH = 56;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const valid = (candles || []).filter((k) =>
      k && ["open", "high", "low", "close"].every((f) =>
        typeof k[f] === "number" && isFinite(k[f])));
    if (valid.length < 2) {
      ctx.save();
      ctx.strokeStyle = "rgba(139,147,179,0.35)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, cssH / 2);
      ctx.lineTo(cssW, cssH / 2);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const highs = valid.map((k) => k.high);
    const lows = valid.map((k) => k.low);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const padY = 8;
    const range = max - min || 1;
    const y = (v) => cssH - padY - ((v - min) / range) * (cssH - padY * 2);
    const n = valid.length;
    const slot = cssW / n;
    const bw = Math.max(2, Math.min(10, Math.floor(slot * 0.58)));

    valid.forEach((k, i) => {
      const cx = slot * i + slot / 2;
      const up = k.close >= k.open;
      const col = up ? UP : DOWN;
      // 影线（最高-最低）
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, y(k.high));
      ctx.lineTo(cx, y(k.low));
      ctx.stroke();
      // 实体（开盘-收盘）
      const yO = y(k.open);
      const yC = y(k.close);
      const top = Math.min(yO, yC);
      const h = Math.max(1, Math.abs(yC - yO));
      ctx.fillStyle = col;
      ctx.fillRect(cx - bw / 2, top, bw, h);
    });
  }

  const LINE_BLUE = "#4a86f7";

  // 日内分时图：points=[{t:"HH:MM", p:price}]，baseline=前结算基准；
  // 蓝线 + 浅蓝填充、基准灰虚线、最高/最低点高亮、底部三档时间刻度（参考分时行情样式）
  function intraday(canvas, points, baseline) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 300;
    const cssH = 84;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const valid = (points || []).filter((k) => k && typeof k.p === "number" && isFinite(k.p));
    if (valid.length < 2) {
      ctx.save();
      ctx.strokeStyle = "rgba(139,147,179,0.35)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, cssH / 2);
      ctx.lineTo(cssW, cssH / 2);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const ps = valid.map((k) => k.p);
    let base = (typeof baseline === "number" && isFinite(baseline)) ? baseline : (Math.min(...ps) + Math.max(...ps)) / 2;
    const half = Math.max(Math.max(...ps) - base, base - Math.min(...ps), 1);
    const min = base - half;
    const max = base + half;
    const padT = 10, padB = 16;
    const y = (v) => padT + (1 - (v - min) / (max - min)) * (cssH - padT - padB);
    const x = (i) => (i / (valid.length - 1)) * cssW;

    // 基准虚线
    ctx.save();
    ctx.strokeStyle = "rgba(139,147,179,0.55)";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y(base));
    ctx.lineTo(cssW, y(base));
    ctx.stroke();
    ctx.restore();

    // 填充
    const grad = ctx.createLinearGradient(0, 0, 0, cssH);
    grad.addColorStop(0, "rgba(74,134,247,0.26)");
    grad.addColorStop(1, "rgba(74,134,247,0.02)");
    ctx.beginPath();
    valid.forEach((k, i) => (i ? ctx.lineTo(x(i), y(k.p)) : ctx.moveTo(x(i), y(k.p))));
    ctx.lineTo(cssW, cssH - padB);
    ctx.lineTo(0, cssH - padB);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 主线
    ctx.beginPath();
    valid.forEach((k, i) => (i ? ctx.lineTo(x(i), y(k.p)) : ctx.moveTo(x(i), y(k.p))));
    ctx.strokeStyle = LINE_BLUE;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    // 最高 / 最低点
    const iMax = ps.indexOf(Math.max(...ps));
    const iMin = ps.indexOf(Math.min(...ps));
    [[iMax], [iMin]].forEach(([i]) => {
      ctx.beginPath();
      ctx.arc(x(i), y(ps[i]), 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x(i), y(ps[i]), 1.8, 0, Math.PI * 2);
      ctx.fillStyle = LINE_BLUE;
      ctx.fill();
    });

    // 时间刻度：首 / 中 / 尾
    ctx.fillStyle = "rgba(139,147,179,0.85)";
    ctx.font = "9px sans-serif";
    const mid = Math.floor(valid.length / 2);
    ctx.textAlign = "left";
    ctx.fillText(valid[0].t, 2, cssH - 4);
    ctx.textAlign = "center";
    ctx.fillText(valid[mid].t, cssW / 2, cssH - 4);
    ctx.textAlign = "right";
    ctx.fillText(valid[valid.length - 1].t, cssW - 2, cssH - 4);
  }

  function hexA(hex, alpha) {
    const m = hex.replace("#", "");
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ---------- 技术分析详情：指标计算（纯前端、无第三方依赖） ----------
  function sma(closes, n) {
    const out = new Array(closes.length).fill(null);
    let sum = 0;
    for (let i = 0; i < closes.length; i++) {
      sum += closes[i];
      if (i >= n) sum -= closes[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  function emaSeries(closes, n) {
    const k = 2 / (n + 1);
    const out = new Array(closes.length).fill(null);
    let prev = null;
    for (let i = 0; i < closes.length; i++) {
      if (!isFinite(closes[i])) continue;
      prev = prev === null ? closes[i] : closes[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  function rsiWilder(closes, n) {
    n = n || 14;
    const out = new Array(closes.length).fill(null);
    let avgUp = 0, avgDn = 0;
    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const up = Math.max(diff, 0), dn = Math.max(-diff, 0);
      if (i <= n) { avgUp += up / n; avgDn += dn / n; }
      else { avgUp = (avgUp * (n - 1) + up) / n; avgDn = (avgDn * (n - 1) + dn) / n; }
      if (i >= n) out[i] = avgDn === 0 ? 100 : 100 - 100 / (1 + avgUp / avgDn);
    }
    return out;
  }

  function macdSeries(closes) {
    const e12 = emaSeries(closes, 12), e26 = emaSeries(closes, 26);
    const dif = closes.map((_, i) => (e12[i] === null || e26[i] === null) ? null : e12[i] - e26[i]);
    const dea = new Array(closes.length).fill(null);
    let prev = null;
    for (let i = 0; i < closes.length; i++) {
      if (dif[i] === null) continue;
      prev = prev === null ? dif[i] : dif[i] * (2 / 10) + prev * (1 - 2 / 10);
      dea[i] = prev;
    }
    const hist = closes.map((_, i) =>
      (dif[i] === null || dea[i] === null) ? null : 2 * (dif[i] - dea[i]));
    return { dif, dea, hist };
  }

  const AXIS = "#8b93b3", GRID = "rgba(139,147,179,0.14)";

  function setupCanvas(canvas, cssH) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    return { ctx, cssW, cssH };
  }
  function placeholder(ctx, w, h) {
    ctx.save(); ctx.strokeStyle = "rgba(139,147,179,0.35)"; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke(); ctx.restore();
  }
  function fmtAxis(v, digits) {
    return v.toLocaleString("en-US", { maximumFractionDigits: digits == null ? 2 : digits, minimumFractionDigits: 0 });
  }
  function mmdd(s) { s = String(s || ""); return s.length >= 10 ? s.slice(5) : s; }

  // 详情主图：win=[{date,close,ma}]；maColor 选中均线色；digits 价格小数位
  function detailMain(canvas, win, opts) {
    opts = opts || {};
    const { ctx, cssW, cssH } = setupCanvas(canvas, 190);
    const n = win.length;
    if (n < 2) { placeholder(ctx, cssW, cssH); return; }
    const closes = win.map(w => w.close);
    const maVals = win.map(w => w.ma).filter(v => typeof v === "number" && isFinite(v));
    let min = Math.min(...closes), max = Math.max(...closes);
    if (maVals.length) { min = Math.min(min, ...maVals); max = Math.max(max, ...maVals); }
    const pad = (max - min || 1) * 0.08; min -= pad; max += pad;
    const x = i => i / (n - 1) * (cssW - 38) + 2;
    const y = v => 8 + (1 - (v - min) / (max - min)) * (cssH - 26);
    ctx.font = "9px Consolas, monospace";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    for (let g = 0; g <= 3; g++) {
      const v = min + (max - min) * g / 3, gy = y(v);
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(2, gy); ctx.lineTo(cssW - 38, gy); ctx.stroke();
      ctx.fillStyle = AXIS; ctx.fillText(fmtAxis(v, opts.digits), cssW - 35, gy);
    }
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    [0, Math.floor(n / 2), n - 1].forEach(di => {
      ctx.fillStyle = AXIS; ctx.fillText(mmdd(win[di].date), x(di), cssH - 15);
    });
    if (maVals.length) {
      ctx.beginPath();
      win.forEach((w, i) => {
        if (typeof w.ma !== "number" || !isFinite(w.ma)) return;
        i ? ctx.lineTo(x(i), y(w.ma)) : ctx.moveTo(x(i), y(w.ma));
      });
      ctx.strokeStyle = opts.maColor || "#4a86f7"; ctx.lineWidth = 1.3; ctx.stroke();
    }
    ctx.beginPath();
    win.forEach((w, i) => i ? ctx.lineTo(x(i), y(w.close)) : ctx.moveTo(x(i), y(w.close)));
    ctx.strokeStyle = "#e8ecf5"; ctx.lineWidth = 1.4; ctx.lineJoin = "round"; ctx.stroke();
  }

  function detailRsi(canvas, rsiArr) {
    const { ctx, cssW, cssH } = setupCanvas(canvas, 74);
    const n = rsiArr.length;
    if (n < 2) { placeholder(ctx, cssW, cssH); return; }
    const y = v => 6 + (1 - v / 100) * (cssH - 14);
    ctx.font = "9px Consolas, monospace";
    [[70, "#f87171"], [30, "#34d399"]].forEach(([lv, col]) => {
      ctx.save(); ctx.strokeStyle = col; ctx.globalAlpha = 0.6; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(2, y(lv)); ctx.lineTo(cssW - 30, y(lv)); ctx.stroke(); ctx.restore();
      ctx.fillStyle = col; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(String(lv), cssW - 27, y(lv));
    });
    ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = AXIS;
    ctx.fillText("100", cssW - 27, y(100)); ctx.fillText("25", cssW - 27, y(25));
    ctx.beginPath();
    rsiArr.forEach((v, i) => {
      if (typeof v !== "number" || !isFinite(v)) return;
      const px = i / (n - 1) * (cssW - 32) + 2;
      i ? ctx.lineTo(px, y(v)) : ctx.moveTo(px, y(v));
    });
    ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 1.2; ctx.stroke();
  }

  function detailMacd(canvas, macd) {
    const { ctx, cssW, cssH } = setupCanvas(canvas, 84);
    const { dif, dea, hist } = macd;
    const n = dif.length;
    if (n < 2) { placeholder(ctx, cssW, cssH); return; }
    const vals = [...dif, ...dea, ...hist].filter(v => typeof v === "number" && isFinite(v));
    let min = Math.min(0, ...vals), max = Math.max(0, ...vals);
    const pad = (max - min || 1) * 0.15; min -= pad; max += pad;
    const y = v => 8 + (1 - (v - min) / (max - min)) * (cssH - 20);
    ctx.strokeStyle = GRID; ctx.beginPath();
    ctx.moveTo(2, y(0)); ctx.lineTo(cssW - 30, y(0)); ctx.stroke();
    const slot = (cssW - 32) / n;
    const bw = Math.max(2, Math.min(7, slot * 0.6));
    for (let i = 0; i < n; i++) {
      if (hist[i] === null) continue;
      ctx.fillStyle = hist[i] >= 0 ? "#34d399" : "#f87171";
      const cx = i * slot + slot / 2 + 2;
      ctx.fillRect(cx - bw / 2, Math.min(y(hist[i]), y(0)), bw, Math.max(1, Math.abs(y(hist[i]) - y(0))));
    }
    ctx.beginPath();
    dif.forEach((v, i) => {
      if (v === null) return;
      const px = i * slot + slot / 2 + 2;
      i ? ctx.lineTo(px, y(v)) : ctx.moveTo(px, y(v));
    });
    ctx.strokeStyle = "#e8ecf5"; ctx.lineWidth = 1.1; ctx.stroke();
    ctx.beginPath();
    dea.forEach((v, i) => {
      if (v === null) return;
      const px = i * slot + slot / 2 + 2;
      i ? ctx.lineTo(px, y(v)) : ctx.moveTo(px, y(v));
    });
    ctx.strokeStyle = "#4a86f7"; ctx.lineWidth = 1.1; ctx.stroke();
  }

  window.GoldChart = { sparkline, candle, intraday,
    sma, rsiWilder, macdSeries, detailMain, detailRsi, detailMacd };
})();
