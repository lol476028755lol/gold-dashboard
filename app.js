/* 黄金投资决策仪表盘 — 数据渲染层；data.json 口径见 references/data-sources.md */
(function () {
  "use strict";

  const COLOR = { good: "#34d399", red: "#f87171", gold: "#fbbf24", neutral: "#8b93b3" };
  const $ = (id) => document.getElementById(id);

  // 数据源与自动刷新：APK / 线上部署时把 REMOTE_DATA_URL 填为公网 https JSON 地址即切换；
  // 留空则使用本地 data.json。RELOAD_MS 为前端自动轮询间隔（毫秒）。
  const REMOTE_DATA_URL = "";
  const DATA_URL = REMOTE_DATA_URL || "data.json";
  const RELOAD_MS = 120 * 1000;

  function fmt(n, digits = 2) {
    if (n === null || n === undefined || !isFinite(n)) return "--";
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return "--";
    return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function renderClock() {
    const now = new Date();
    $("clock").textContent = now.toLocaleTimeString("zh-CN", { hour12: false });
  }

  function renderHeader(d) {
    const t = d.generated_at ? new Date(d.generated_at) : null;
    $("collect-time").textContent = t
      ? "采集时间：" + t.toLocaleString("zh-CN", { hour12: false }) + "（北京时间）"
      : "采集时间：--";
    const shge = d.shge || {};
    $("shge-price-line").innerHTML = shge.available
      ? `SHGE 金价：<strong>¥${fmt(shge.price, 2)}/克</strong>`
      : "SHGE 金价：--";
  }

  function renderVerdict(d) {
    const v = d.verdict || {};
    const light = $("verdict-light");
    light.className = "light " + (v.light || "neutral");
    const head = $("verdict-headline");
    head.textContent = v.headline || "--";
    head.className = v.light === "red" ? "red" : v.light === "yellow" ? "yellow" : "";
    $("verdict-sub").textContent = v.sub || "";

    const box = $("verdict-tags");
    box.innerHTML = "";
    (v.tags || []).forEach((tg) => {
      box.appendChild(el("span", "tag tone-" + (tg.tone || "neutral"), tg.text));
    });
  }

  function renderMacro(d) {
    const m = d.macro || {};
    const tag = $("macro-tag");
    tag.textContent = m.tag || "--";
    tag.dataset.tone = m.tag === "利空" ? "red" : m.tag === "利好" ? "good" : "neutral";
    $("macro-title").textContent = m.title || "--";
    const ul = $("macro-facts");
    ul.innerHTML = "";
    const facts = (m.facts || []).length ? m.facts : ["宏观要点由 agent 结合当日公开新闻补充后写入"];
    facts.forEach((f) => ul.appendChild(el("li", "", f)));
    const src = (m.sources || []).join("；");
    $("macro-sources").textContent = src ? "来源：" + src : "";
  }

  function renderUs10y(d) {
    const u = d.us10y || {};
    const tag = $("us10y-tag");
    tag.textContent = u.tag || (u.available ? "数据维护中" : "暂缺");
    tag.dataset.tone = u.tag === "利空金价" ? "red" : u.available ? "good" : "neutral";
    $("us10y-value").textContent = u.value !== null && u.value !== undefined ? fmt(u.value, 2) + "%" : "--";
    if (u.change_bps !== null && u.change_bps !== undefined) {
      const down = u.change_bps < 0;
      $("us10y-delta").className = "delta " + (down ? "green" : "red");
      $("us10y-delta").textContent = `${down ? "▼" : "▲"} ${down ? "" : "+"}${u.change_bps} bps（${down ? "下降" : "上升"}趋势）`;
      $("us10y-range").textContent = `从 ${fmt(u.prev, 2)}% ${down ? "降至" : "升至"} ${fmt(u.value, 2)}% · 实时报价，走势为日频`;
    } else {
      $("us10y-delta").textContent = u.available ? "" : "数据源异常，等待下次刷新";
      $("us10y-range").textContent = "";
    }
    const trendColor = (u.change_bps || 0) < 0 ? COLOR.good : COLOR.red;
    window.GoldChart.sparkline($("us10y-chart"), u.trend || [], trendColor);
  }

  function renderDxy(d) {
    const x = d.dxy || {};
    const tag = $("dxy-tag");
    tag.textContent = x.tag || (x.available ? "数据维护中" : "暂缺");
    tag.dataset.tone = x.tag === "压制金价" ? "red" : x.tag === "利好金价" ? "good" : "neutral";
    $("dxy-value").textContent = x.value !== null && x.value !== undefined ? fmt(x.value, 2) : "--";
    if (x.change_pct !== null && x.change_pct !== undefined) {
      const up = x.change_pct > 0;
      $("dxy-delta").className = "delta " + (up ? "red" : "green");
      $("dxy-delta").textContent = `${up ? "▲" : "▼"} ${pct(x.change_pct)}${up ? "（走强压制金价）" : "（走弱利好金价）"}`;
      $("dxy-range").textContent = `从 ${fmt(x.prev, 2)} ${up ? "升至" : "降至"} ${fmt(x.value, 2)} · 日频趋势`;
    } else {
      $("dxy-delta").textContent = x.available ? "" : "数据源异常，等待下次刷新";
      $("dxy-range").textContent = "";
    }
    const col = (x.change_pct || 0) > 0 ? COLOR.red : COLOR.good;
    window.GoldChart.sparkline($("dxy-chart"), x.trend || [], col);
  }

  function renderGld(d) {
    const g = d.gld || {};
    const tag = $("gld-tag");
    tag.textContent = g.tag || "--";
    tag.dataset.tone = g.tag && g.tag.indexOf("流出") >= 0 ? "red" : "gold";
    $("gld-title").textContent = g.title || "--";
    const ul = $("gld-details");
    ul.innerHTML = "";
    (g.details || []).forEach((f) => ul.appendChild(el("li", "", f)));
    if (g.price !== null && g.price !== undefined) {
      ul.appendChild(el("li", "", `GLD 最新价：$${fmt(g.price, 2)}（价格代理资金情绪）`));
    }
    if (g.manual_holder_tons) {
      ul.appendChild(el("li", "", `持仓量：${fmt(g.manual_holder_tons, 2)} 吨（周度披露）`));
    }
    const parts = [];
    if (g.etf_source) parts.push(g.etf_source);
    if (g.pbo_source) parts.push(g.pbo_source);
    $("gld-source").textContent = parts.length ? "披露来源：" + parts.join("；") : "";
  }

  function renderComex(d) {
    const c = d.comex || {};
    const tag = $("comex-tag");
    tag.textContent = c.tag || "--";
    tag.dataset.tone = c.tag === "技术回调" ? "red" : "good";
    $("comex-value").textContent = c.available ? fmt(c.price, 2) : "--";
    if (c.change_pct !== null && c.change_pct !== undefined) {
      const down = c.change_pct < 0;
      $("comex-delta").className = "delta red";
      $("comex-delta").textContent = `${down ? "▼" : "▲"} ${pct(c.change_pct)}（周变动）`;
    } else {
      $("comex-delta").textContent = "--";
    }
    $("comex-note").textContent = c.note || "";
    if (c.intraday && Array.isArray(c.intraday.points) && c.intraday.points.length >= 2) {
      window.GoldChart.intraday($("comex-chart"), c.intraday.points, c.intraday.baseline);
    } else if (Array.isArray(c.candles) && c.candles.length >= 2) {
      window.GoldChart.candle($("comex-chart"), c.candles);
    } else {
      const color = (c.change_pct || 0) >= 0 ? COLOR.good : COLOR.red;
      window.GoldChart.sparkline($("comex-chart"), c.trend || [], color);
    }
  }

  function renderPremium(d) {
    const p = d.premium || {};
    const tag = $("premium-tag");
    tag.textContent = p.tag || "--";
    tag.dataset.tone = p.tone || (p.tag === "健康区间" ? "good" : "neutral");
    $("premium-value").textContent = p.value_pct !== null && p.value_pct !== undefined ? fmt(p.value_pct, 1) : "--";
    $("premium-note").textContent = p.note || "--";
    $("premium-footnote").textContent = p.footnote || "";
  }

  function renderCompare(d) {
    const box = $("compare-rows");
    box.innerHTML = "";
    (d.compare || []).forEach((row) => {
      const r = el("div", "compare-row");
      r.appendChild(el("span", "k", row.label));
      r.appendChild(el("span", "v tone-" + (row.tone || "neutral"), row.value));
      box.appendChild(r);
    });
  }

  // ---------- 技术分析详情（hash #/gold）：MA / RSI / MACD 纯前端派生 ----------
  const GOLD_SYMBOLS = {
    comex: { label: "COMEX 黄金（美元/盎司）", lastLabel: "最新收盘（美元/盎司）", digits: 2,
             daily: d => (d.comex && d.comex.daily) || [], snap: d => d.comex || {} },
    shfe:  { label: "沪金主力（元/克）", lastLabel: "最新收盘（元/克）", digits: 2,
             daily: d => (d.shfe_main && d.shfe_main.daily) || [], snap: d => d.shfe_main || {} }
  };
  const PERIOD_LIMIT = { "3M": 63, "6M": 126, "1Y": 252, "ALL": Number.MAX_SAFE_INTEGER };
  const MA_COLOR = { 20: "#fbbf24", 60: "#4a86f7", 120: "#8b93b3" };
  const goldState = { sym: "comex", ma: 60, period: "1Y" };

  function analyzeSymbol(sym, data) {
    const meta = GOLD_SYMBOLS[sym];
    const daily = meta.daily(data);
    const closes = daily.map(k => k.c);
    return {
      daily, closes, meta,
      snap: meta.snap(data),
      ma: { 20: GoldChart.sma(closes, 20), 60: GoldChart.sma(closes, 60), 120: GoldChart.sma(closes, 120) },
      rsi: GoldChart.rsiWilder(closes, 14),
      macd: GoldChart.macdSeries(closes)
    };
  }

  function renderGoldDetail(data) {
    $("quote-panel").hidden = false;
    const a = analyzeSymbol(goldState.sym, data);
    const { daily, closes, ma, rsi, macd, snap, meta } = a;
    const n = closes.length;

    $("st-last-label").textContent = meta.lastLabel;
    $("st-last").textContent = n ? fmt(closes[n - 1], meta.digits) : "--";
    const chg = snap.change_pct;
    const chgEl = $("st-last-chg");
    if (chg !== null && chg !== undefined && isFinite(chg)) {
      const up = chg >= 0;
      chgEl.textContent = (up ? "+" : "") + chg.toFixed(2) + "%（日变动）";
      chgEl.className = "stat-sub " + (up ? "tone-good" : "tone-red");
    } else { chgEl.textContent = "--"; chgEl.className = "stat-sub"; }

    const ret = back => (n > back && closes[n - 1 - back] ? (closes[n - 1] / closes[n - 1 - back] - 1) * 100 : null);
    const w = ret(5), m = ret(20);
    $("st-week").textContent = w === null ? "--" : (w > 0 ? "+" : "") + w.toFixed(2) + "%";
    $("st-week").className = "stat-value " + (w === null ? "" : w >= 0 ? "tone-good" : "tone-red");
    $("st-week-n").textContent = "5 个交易日";
    $("st-month").textContent = m === null ? "--" : (m > 0 ? "+" : "") + m.toFixed(2) + "%";
    $("st-month").className = "stat-value " + (m === null ? "" : m >= 0 ? "tone-good" : "tone-red");
    $("st-month-n").textContent = "20 个交易日";

    const lastRsi = rsi[n - 1];
    $("st-rsi").textContent = lastRsi === null || lastRsi === undefined ? "--" : lastRsi.toFixed(2);
    const rsiState = $("st-rsi-state");
    if (lastRsi === null || lastRsi === undefined) { rsiState.textContent = "--"; rsiState.className = "stat-sub"; }
    else if (lastRsi >= 70) { rsiState.textContent = "超买区域"; rsiState.className = "stat-sub tone-red"; }
    else if (lastRsi <= 30) { rsiState.textContent = "超卖区域"; rsiState.className = "stat-sub tone-good"; }
    else { rsiState.textContent = "中性区间"; rsiState.className = "stat-sub"; }

    const limit = PERIOD_LIMIT[goldState.period];
    const i0 = Math.max(0, n - limit);
    const winDaily = daily.slice(i0);
    const winMa = ma[goldState.ma].slice(i0);
    const win = winDaily.map((k, i) => ({ date: k.date, close: k.c, ma: winMa[i] }));

    const trend = $("trend-note");
    const curClose = closes[n - 1], curMa = ma[goldState.ma][n - 1];
    if (curClose && curMa) {
      const above = curClose >= curMa;
      trend.textContent = `价格位于 MA${goldState.ma} ${above ? "上方" : "下方"} · 中期趋势${above ? "偏强" : "偏弱"}`;
      trend.className = "trend-note " + (above ? "tone-good" : "tone-red");
    } else { trend.textContent = "均线数据不足"; trend.className = "trend-note"; }

    GoldChart.detailMain($("gold-main"), win, { digits: meta.digits, maColor: MA_COLOR[goldState.ma] });
    GoldChart.detailRsi($("gold-rsi"), rsi.slice(i0));
    GoldChart.detailMacd($("gold-macd"), { dif: macd.dif.slice(i0), dea: macd.dea.slice(i0), hist: macd.hist.slice(i0) });
  }

  // 黄金ETF持仓报告（GLD 逐日增减吨，披露文件维护，参考图双向条形图）
  // 演示序列仅在真实披露为空时展示条形图样式；不进入 data.json，不代表真实持仓
  const ETF_DEMO_FLOW = [
    { date: "2026-09-15", change_tons: 2.852 }, { date: "2026-09-16", change_tons: 1.711 },
    { date: "2026-09-17", change_tons: 0.856 }, { date: "2026-09-18", change_tons: 4.278 },
    { date: "2026-09-21", change_tons: -1.712 }, { date: "2026-09-22", change_tons: 0.571 },
    { date: "2026-09-23", change_tons: 0.855 }, { date: "2026-09-24", change_tons: -2.281 },
    { date: "2026-09-28", change_tons: 4.277 }, { date: "2026-09-29", change_tons: -1.425 },
    { date: "2026-09-30", change_tons: -1.711 }, { date: "2026-10-01", change_tons: 0.855 },
    { date: "2026-10-02", change_tons: -0.855 }, { date: "2026-10-05", change_tons: 0.570 },
    { date: "2026-10-06", change_tons: 3.707 }, { date: "2026-10-07", change_tons: 1.140 },
    { date: "2026-10-08", change_tons: -5.702 }, { date: "2026-10-09", change_tons: -2.281 },
    { date: "2026-10-12", change_tons: 2.281 }, { date: "2026-10-13", change_tons: -1.215 },
    { date: "2026-10-15", change_tons: -0.285 }, { date: "2026-10-16", change_tons: 5.131 },
    { date: "2026-10-19", change_tons: -0.570 }, { date: "2026-10-20", change_tons: 1.711 },
    { date: "2026-10-21", change_tons: -2.566 }, { date: "2026-10-22", change_tons: -11.973 }
  ];
  function etfRowsHtml(flow) {
    const nums = flow.map(x => Number(x.change_tons) || 0);
    const maxAbs = Math.max(0.001, ...nums.map(v => Math.abs(v)));
    return flow.slice().reverse().map(x => { // 最新在上
      const v = Number(x.change_tons) || 0;
      const pct = (Math.abs(v) / maxAbs * 50).toFixed(1);
      const pos = v >= 0;
      const val = `${v >= 0 ? "+" : ""}${v.toFixed(3)}吨`;
      return `<div class="etf-row">
        <span class="etf-date">${x.date || "--"}</span>
        <span class="etf-track"><i class="etf-bar ${pos ? "pos" : "neg"}" style="width:${pct}%"></i></span>
        <span class="etf-val ${pos ? "tone-red" : "tone-good"}">${val}</span>
      </div>`;
    }).join("");
  }
  function renderFlowEtf(data) {
    const ROW_CAP = 40; // 详情页展示最近交易日条数，全量序列保留在 data.json
    const gld = data.gld || {};
    const flow = Array.isArray(gld.holdings_flow) ? gld.holdings_flow : [];
    const nums = flow.map(x => Number(x.change_tons) || 0);
    const sumAll = nums.reduce((s, v) => s + v, 0);

    const summary = $("flow-etf-summary");
    const lines = [];
    if (gld.etf_holdings_tons != null) lines.push(`最新持仓 ${fmt(gld.etf_holdings_tons, 2)} 吨（${gld.etf_holdings_date || "--"}）`);
    if (flow.length) {
      const shown = Math.min(ROW_CAP, flow.length);
      lines.push(`共 ${flow.length} 个交易日（展示最近 ${shown} 日）· 全序列净额 ${sumAll >= 0 ? "+" : ""}${sumAll.toFixed(3)} 吨`);
    } else {
      lines.push("逐日披露序列待维护（下方为样式示例）");
    }
    if (usedExample) lines.push("示例数据（离线兜底，非真实持仓披露）");
    summary.textContent = lines.join("　·　");

    const list = $("flow-etf-list");
    const empty = $("flow-etf-empty");
    const demoBlock = $("flow-etf-demo-block");
    const demoList = $("flow-etf-demo-list");
    if (!flow.length) {
      list.innerHTML = "";
      empty.hidden = false;
      demoBlock.hidden = false;
      demoList.innerHTML = etfRowsHtml(ETF_DEMO_FLOW);
      return;
    }
    empty.hidden = true;
    demoBlock.hidden = true;
    list.innerHTML = etfRowsHtml(flow.slice(-ROW_CAP));
  }

  function bindGoldDetail() {
    $("gold-back").addEventListener("click", () => { location.hash = ""; });
    document.querySelectorAll("#gold-tabs .seg").forEach(b => b.addEventListener("click", () => {
      goldState.sym = b.dataset.sym;
      document.querySelectorAll("#gold-tabs .seg").forEach(x => x.classList.toggle("active", x === b));
      renderGoldDetail(lastData);
    }));
    document.querySelectorAll("#ma-seg .chip").forEach(b => b.addEventListener("click", () => {
      goldState.ma = parseInt(b.dataset.ma, 10);
      document.querySelectorAll("#ma-seg .chip").forEach(x => x.classList.toggle("active", x === b));
      renderGoldDetail(lastData);
    }));
    document.querySelectorAll("#period-seg .chip").forEach(b => b.addEventListener("click", () => {
      goldState.period = b.dataset.p;
      document.querySelectorAll("#period-seg .chip").forEach(x => x.classList.toggle("active", x === b));
      renderGoldDetail(lastData);
    }));
    const card = $("card-comex");
    if (card) {
      card.classList.add("clickable");
      card.addEventListener("click", () => { location.hash = "/gold"; });
    }
  }

  // ---------- 资金流向详情（hash #/flow）：持仓异动时间流 + 官方黄金储备 ----------
  const OZ_WAN_TO_TON = 0.311035; // 1 万盎司 = 0.311035 吨
  const flowState = { tab: "timeline" };

  function bindFlowDetail() {
    $("flow-back").addEventListener("click", () => { location.hash = ""; });
    document.querySelectorAll("#flow-tabs .seg").forEach(b => b.addEventListener("click", () => {
      flowState.tab = b.dataset.flowTab;
      document.querySelectorAll("#flow-tabs .seg").forEach(x => x.classList.toggle("active", x === b));
      renderFlowDetail(lastData);
    }));
    const card = $("card-gld");
    if (card) {
      card.classList.add("clickable");
      card.addEventListener("click", () => { location.hash = "/flow"; });
    }
  }

  // 顶部「立即采集」：本地 serve 的 POST /refresh 真跑采集脚本重生成 data.json；
  // 线上 GitHub Pages 无该端点（404/网络失败）时静默降级为立即重读 data.json 并重绘。
  function bindRefresh() {
    const btn = $("refresh-btn");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      const idle = btn.innerHTML;
      btn.textContent = "采集中…";
      let hint = "";
      try {
        const r = await fetch("/refresh", { method: "POST", cache: "no-store" });
        if (r.ok) {
          const j = await r.json().catch(() => ({}));
          if (j && j.ok === false) hint = "部分行情源失败，缺失项已按旧值兜底";
        } else if (r.status === 404) {
          hint = "线上静态站无采集服务，已立即刷新已发布数据";
        } else {
          hint = "采集服务返回异常，已立即刷新已加载数据";
        }
      } catch (e) {
        hint = "无本地采集服务，已立即刷新已加载数据";
      }
      await loadData();
      btn.disabled = false;
      const now = new Date().toLocaleTimeString("zh-CN", { hour12: false });
      btn.textContent = "✓ 已更新 " + now;
      btn.title = hint;
      setTimeout(() => { btn.innerHTML = idle; }, 2800);
    });
  }

  function renderFlowDetail(data) {
    $("flow-timeline-panel").hidden = flowState.tab !== "timeline";
    $("flow-etf-panel").hidden = flowState.tab !== "etf";
    $("flow-reserve-panel").hidden = flowState.tab !== "reserve";
    if (flowState.tab === "timeline") renderFlowTimeline(data);
    else if (flowState.tab === "etf") renderFlowEtf(data);
    else renderFlowReserve(data);
  }

  function renderFlowTimeline(data) {
    const ROW_CAP = 40;
    const gld = data.gld || {};
    const flow = Array.isArray(gld.holdings_flow) ? gld.holdings_flow : [];
    const summary = $("flow-tl-summary");
    const list = $("flow-tl-list");
    const empty = $("flow-tl-empty");
    if (!flow.length) {
      list.innerHTML = "";
      empty.hidden = false;
      summary.textContent = "持仓异动序列待采集维护。";
      return;
    }
    empty.hidden = true;
    const nums = flow.map(x => Number(x.change_tons) || 0);
    const sumAll = nums.reduce((s, v) => s + v, 0);
    summary.textContent = `共 ${flow.length} 个交易日（展示最近 ${Math.min(ROW_CAP, flow.length)} 日）· 全序列净额 ${sumAll >= 0 ? "+" : ""}${sumAll.toFixed(3)} 吨`;

    const recent = flow.slice(-ROW_CAP).slice().reverse(); // 最新在上
    const groups = new Map();
    recent.forEach(x => {
      const d = x.date || "--";
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(x);
    });
    let html = "";
    groups.forEach((items, date) => {
      let rows = "";
      items.forEach(x => {
        const v = Number(x.change_tons) || 0;
        const pos = v >= 0;
        const cls = pos ? "in" : "out";
        const verb = pos ? "增持（流入）" : "减持（流出）";
        rows += `<div class="tl-item">
          <span class="tl-bubble ${cls}">GLD 持仓${verb} ${pos ? "+" : ""}${v.toFixed(3)} 吨</span>
        </div>`;
      });
      html += `<div class="tl-group"><div class="tl-group-date">${date}</div>${rows}</div>`;
    });
    list.innerHTML = html;
  }

  function renderFlowReserve(data) {
    const gld = data.gld || {};
    const series = Array.isArray(gld.reserve_series) ? gld.reserve_series : [];
    const last = series[series.length - 1] || null;

    const oz = last ? last.oz_wan : gld.pbo_reserve_oz_wan;
    $("rs-tons").textContent = oz != null ? fmt(oz * OZ_WAN_TO_TON, 2) : "--";
    $("rs-oz").textContent = oz != null ? fmt(oz, 0) : "--";
    $("rs-date").textContent = gld.pbo_date ? "截至 " + gld.pbo_date : (last ? "截至 " + last.ym : "--");
    $("rs-months").textContent = gld.pbo_months ? `连续 ${gld.pbo_months} 个月增持` : "--";

    const lastChg = last ? last.change_oz_wan : null;
    if (lastChg != null) {
      $("rs-chg-tons").textContent = "+" + fmt(lastChg * OZ_WAN_TO_TON, 2);
      $("rs-chg-oz").textContent = `环比 +${fmt(lastChg, 0)} 万盎司`;
    } else {
      $("rs-chg-tons").textContent = "--";
      $("rs-chg-oz").textContent = "--";
    }
    const cumOz = series.reduce((s, x) => s + (Number(x.change_oz_wan) || 0), 0);
    $("rs-cum").textContent = series.length ? "+" + fmt(cumOz * OZ_WAN_TO_TON, 2) : "--";

    const items = series.map(x => ({ ym: x.ym, tons: (Number(x.oz_wan) || 0) * OZ_WAN_TO_TON }));
    GoldChart.reserveLine($("rs-line"), items);

    const barList = $("rs-bar-list");
    const barEmpty = $("rs-bar-empty");
    if (!series.length) {
      barList.innerHTML = "";
      barEmpty.hidden = false;
    } else {
      barEmpty.hidden = true;
      const maxAbs = Math.max(0.001, ...series.map(x => Math.abs(Number(x.change_oz_wan) || 0)));
      barList.innerHTML = series.slice().reverse().map(x => {
        const chgOz = Number(x.change_oz_wan) || 0;
        const chgT = chgOz * OZ_WAN_TO_TON;
        const w = (Math.abs(chgOz) / maxAbs * 100).toFixed(1);
        return `<div class="rs-row">
          <span class="rs-month">${x.ym}</span>
          <span class="rs-track"><i class="rs-bar" style="width:${w}%"></i></span>
          <span class="rs-val">+${fmt(chgT, 2)}</span>
        </div>`;
      }).join("");
    }
    $("rs-source").textContent = gld.pbo_source ? "来源：" + gld.pbo_source : "";
  }

  function applyRoute() {
    const gold = location.hash === "#/gold";
    const flow = location.hash === "#/flow";
    $("view-dashboard").hidden = gold || flow;
    $("view-gold-detail").hidden = !gold;
    $("view-flow-detail").hidden = !flow;
    if (gold && lastData) renderGoldDetail(lastData);
    if (flow && lastData) renderFlowDetail(lastData);
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", applyRoute);

  let lastData = null;       // 上次成功渲染的数据，轮询失败时保留不闪烁
  let usedExample = false;   // 是否最终落到离线示例（决定示例角标）

  function renderAll(data) {
    renderHeader(data);
    renderVerdict(data);
    renderMacro(data);
    renderUs10y(data);
    renderDxy(data);
    renderGld(data);
    renderComex(data);
    renderPremium(data);
    renderCompare(data);
    if (!$("view-gold-detail").hidden) renderGoldDetail(data);
    if (!$("view-flow-detail").hidden) renderFlowDetail(data);
  }

  async function loadData() {
    let data = null;
    try {
      const r = await fetch(DATA_URL + "?ts=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("http " + r.status);
      data = await r.json();
      usedExample = false;
    } catch (e) {
      if (lastData) {
        data = lastData;                 // 非首次刷新失败：沿用已渲染数据
      } else {
        const r = await fetch("data.example.json", { cache: "no-store" });
        data = await r.json();
        usedExample = true;              // 首次且主源不可用：离线示例 + 角标
      }
    }
    lastData = data;
    $("offline-badge").hidden = !usedExample;
    renderAll(data);
  }

  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  bindGoldDetail();
  bindFlowDetail();
  bindRefresh();
  applyRoute();
  renderClock();
  setInterval(renderClock, 1000);
  loadData();
  setInterval(loadData, RELOAD_MS);  // 每 120s 自动重读数据并重绘
  // 页面从后台切回前台时，定时器可能被系统节流，立即补拉一次保证显示最新值
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadData();
  });
  registerSW();
})();
