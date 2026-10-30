#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_market_data.py — 采集黄金仪表盘行情并生成 assets/app/data.json

纯标准库实现，无第三方依赖。口径与降级策略见 ../references/data-sources.md。
任一源失败不中断：对应字段置 null / available=false，前端显示 "--"。

Usage:
    python fetch_market_data.py                 # 写到 ../assets/app/data.json
    python fetch_market_data.py --out path.json
    python fetch_market_data.py --timeout 15
"""
import argparse
import json
import re
import ssl
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

CN_TZ = timezone(timedelta(hours=8))
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
SINA_HEADERS = {"User-Agent": UA, "Referer": "https://finance.sina.com.cn", "Accept": "*/*"}
EM_HEADERS = {"User-Agent": UA, "Accept": "*/*"}

OZ_PER_GRAM = 31.1035


def http_get(url, headers, timeout, encoding="utf-8"):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as resp:
        raw = resp.read()
    return raw.decode(encoding, errors="replace")


def sina_fields(code, timeout):
    """Parse Sina 'var hq_str_xxx="a,b,c";' into a list of strings."""
    url = f"https://hq.sinajs.cn/list={code}"
    text = http_get(url, SINA_HEADERS, timeout, encoding="gbk")
    m = re.search(r'="(.*)";', text, re.S)
    if not m:
        return []
    return m.group(1).split(",")


def fnum(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


# ---------- individual collectors ----------

def fetch_shge(timeout):
    """SHFE/SGE Au99.99 CNY per gram: realtime from Eastmoney + daily klines."""
    realtime_url = ("https://push2.eastmoney.com/api/qt/stock/get?"
                    "secid=118.AU9999&fields=f43,f44,f45,f46,f60,f170")
    data = json.loads(http_get(realtime_url, EM_HEADERS, timeout)).get("data") or {}
    price = (data.get("f43") or 0) / 100.0
    prev = (data.get("f60") or 0) / 100.0
    change_pct = (data.get("f170") or 0) / 100.0
    if price <= 0:
        price = None

    trend = []
    end = datetime.now(CN_TZ).strftime("%Y%m%d")
    beg = (datetime.now(CN_TZ) - timedelta(days=90)).strftime("%Y%m%d")
    kline_url = ("https://push2his.eastmoney.com/api/qt/stock/kline/get?"
                 "secid=118.AU9999&fields1=f1,f2,f3,f4,f5,f6&"
                 "fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=0"
                 f"&beg={beg}&end={end}")
    kdata = json.loads(http_get(kline_url, EM_HEADERS, timeout)).get("data") or {}
    for row in kdata.get("klines", []):
        parts = row.split(",")
        if len(parts) >= 3:
            trend.append({"date": parts[0], "close": fnum(parts[2])})
    trend = trend[-30:]
    return {"available": price is not None, "price": price,
            "prev_close": prev, "change_pct": change_pct, "trend": trend}


def fetch_comex(timeout):
    """COMEX gold futures (USD/oz) snapshot from Sina hf_GC."""
    f = sina_fields("hf_GC", timeout)
    if len(f) < 9 or not f[0]:
        raise ValueError("hf_GC empty payload")
    price = fnum(f[0])
    basis = fnum(f[7]) or fnum(f[8])
    change_pct = round((price - basis) / basis * 100, 2) if price and basis else None

    daily = []  # 长日线 OHLC（最近400根，短键 o/h/l/c），供技术分析详情的 MA/RSI/MACD 与多周期切换
    try:
        kl_url = ("https://stock2.finance.sina.com.cn/futures/api/jsonp.php/"
                  "var%20_GC=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=GC")
        txt = http_get(kl_url, SINA_HEADERS, timeout)
        m = re.search(r"\[.*\]", txt, re.S)
        if m:
            rows = json.loads(m.group(0))
            for r in rows[-400:]:
                o, h, l, c = (fnum(r.get("open")), fnum(r.get("high")),
                              fnum(r.get("low")), fnum(r.get("close")))
                if c is None or None in (o, h, l):
                    continue
                daily.append({"date": r["date"], "o": o, "h": h, "l": l, "c": c})
    except Exception:
        daily = []
    # 兼容主页迷你图：candles 取尾部30根 OHLC；trend 取尾部30根收盘
    candles = [{"date": k["date"], "open": k["o"], "high": k["h"],
                "low": k["l"], "close": k["c"]} for k in daily[-30:]]
    trend = [{"date": k["date"], "close": k["c"]} for k in daily[-30:]]

    # 日内分时（分钟线）：首行[1]为前结算基准，其后每行 [0]时间 [1]最新价
    intraday = {"date": None, "baseline": None, "points": []}
    try:
        ml_url = ("https://stock2.finance.sina.com.cn/futures/api/jsonp.php/"
                  "var%20_GC=/GlobalFuturesService.getGlobalFuturesMinLine?symbol=GC")
        txt = http_get(ml_url, SINA_HEADERS, timeout)
        m = re.search(r"minLine_1d\":(\[.*?\])\s*\}", txt, re.S)
        if m:
            rows = json.loads(m.group(1))
            base = fnum(rows[0][1]) if rows else None
            day = rows[0][0] if rows else None
            pts = []
            for r in rows[1:]:
                p = fnum(r[1])
                if p is not None:
                    pts.append({"t": r[0], "p": p})
            if len(pts) > 160:  # 等距抽样，避免迷你图过密
                step = (len(pts) - 1) / 159
                pts = [pts[round(i * step)] for i in range(160)]
            intraday = {"date": day, "baseline": base, "points": pts}
    except Exception:
        intraday = {"date": None, "baseline": None, "points": []}

    return {"available": price is not None, "price": price, "change_pct": change_pct,
            "trend": trend, "candles": candles, "daily": daily, "intraday": intraday}


def fetch_xau(timeout):
    """London spot gold (USD/oz) from Sina hf_XAU."""
    f = sina_fields("hf_XAU", timeout)
    if len(f) < 8 or not f[0]:
        raise ValueError("hf_XAU empty payload")
    price = fnum(f[0])
    basis = fnum(f[7])
    change_pct = round((price - basis) / basis * 100, 2) if price and basis else None
    return {"available": price is not None, "price": price, "change_pct": change_pct}


def fetch_gld(timeout):
    """GLD ETF price as a flow proxy; holdings/flows are manually maintained."""
    f = sina_fields("gb_gld", timeout)
    if len(f) < 2 or not f[1]:
        raise ValueError("gb_gld empty payload")
    return {"available": True, "price": fnum(f[1])}


def fetch_gld_flow(timeout):
    """GLD 逐日持仓增减（吨）。源：SPDR Gold Trust 每日持仓，经 uhas.com/spdr 公开聚合（CC-BY 4.0）。
    history[] 按日期升序；delta=当日持仓变化吨。返回逐日序列 + 最新持仓/5日环比，供 ETF 报告 Tab。
    失败由主流程捕获并回退 disclosure.json 中的静态披露，不影响其他源。"""
    url = "https://uhas.com/api/spdr-history?fund=gld"
    data = json.loads(http_get(url, EM_HEADERS, timeout))
    hist = data.get("history") or []
    if not hist:
        raise ValueError("gld history empty")
    flow = [{"date": r["date"], "change_tons": round(float(r["delta"]), 3)}
            for r in hist if r.get("date")]
    last = hist[-1]
    weekly = (data.get("change") or {}).get("change_5d_tonnes")
    return {
        "available": True,
        "holdings_flow": flow,
        "latest_date": last.get("date"),
        "latest_tonnes_reported": last.get("tonnes_reported"),
        "latest_tonnes": last.get("tonnes"),
        "weekly_change_tons": round(float(weekly), 3) if isinstance(weekly, (int, float)) else None,
        "source": f"SPDR Gold Trust 每日持仓（uhas.com/spdr 公开聚合 CC-BY 4.0；截至 {last.get('date')}）",
    }


def fetch_fx_usdcny(timeout):
    f = sina_fields("fx_susdcny", timeout)
    if len(f) < 4 or not f[3]:
        raise ValueError("fx_susdcny empty payload")
    return {"available": True, "price": fnum(f[3]), "prev": fnum(f[7])}


def fetch_us10y(timeout):
    """US 10Y Treasury yield.
    Realtime quote: CNBC Tradeweb cache (last / previous_day_closing / change).
    Trend: CNBC daily bars; fallback to U.S. Treasury official XML (BC_10YEAR).
    Any failure degrades to available=false; frontend renders '--'."""
    value = prev = change_bps = None

    # 1) realtime quote
    try:
        url = ("https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol"
               "?symbols=US10Y&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json")
        q = json.loads(http_get(url, EM_HEADERS, timeout))["FormattedQuoteResult"]["FormattedQuote"][0]
        value = fnum(str(q.get("last", "")).replace("%", "").strip())
        prev = fnum(str(q.get("previous_day_closing", "")).replace("%", "").strip())
        if value is not None and prev is not None:
            change_bps = round((value - prev) * 100)
    except Exception:
        value = prev = change_bps = None

    # 2) trend series: CNBC bars -> Treasury XML fallback
    trend = []
    try:
        cu = "https://ts-api.cnbc.com/harmony/app/charts/1M.json?symbol=US10Y"
        bars = json.loads(http_get(cu, EM_HEADERS, timeout))["barData"]["priceBars"]
        trend = [v for v in (fnum(b.get("close")) for b in bars[-30:]) if v is not None]
    except Exception:
        trend = []
    if not trend:
        try:
            tu = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?"
                  "data=daily_treasury_yield_curve&field_tdr_date_value=2026")
            tx = http_get(tu, EM_HEADERS, timeout)
            vals = re.findall(r"<d:BC_10YEAR[^>]*>([^<]+)</d:BC_10YEAR>", tx)
            trend = [v for v in (fnum(x) for x in vals[-30:]) if v is not None]
        except Exception:
            trend = []

    available = value is not None
    tag = None
    if available:
        tag = "利好金价" if (change_bps or 0) < 0 else ("利空金价" if (change_bps or 0) > 0 else "中性")
    return {"available": available, "value": value, "prev": prev,
            "change_bps": change_bps, "tag": tag, "trend": trend}


def fetch_dxy(timeout):
    """US Dollar Index (DXY, Eastmoney secid 100.UDI): snapshot + daily close trend.
    价格与 f170 涨跌幅均放大 100 倍需除以 100。美元走强通常压制金价。"""
    realtime_url = ("https://push2.eastmoney.com/api/qt/stock/get?"
                    "secid=100.UDI&fields=f43,f44,f45,f46,f60,f170")
    data = json.loads(http_get(realtime_url, EM_HEADERS, timeout)).get("data") or {}
    price = (data.get("f43") or 0) / 100.0
    prev = (data.get("f60") or 0) / 100.0
    change_pct = (data.get("f170") or 0) / 100.0
    if price <= 0:
        raise ValueError("dxy empty payload")

    trend = []
    end = datetime.now(CN_TZ).strftime("%Y%m%d")
    beg = (datetime.now(CN_TZ) - timedelta(days=90)).strftime("%Y%m%d")
    kline_url = ("https://push2his.eastmoney.com/api/qt/stock/kline/get?"
                 "secid=100.UDI&fields1=f1,f2,f3,f4,f5,f6&"
                 "fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=0"
                 f"&beg={beg}&end={end}")
    try:
        kdata = json.loads(http_get(kline_url, EM_HEADERS, timeout)).get("data") or {}
        for row in kdata.get("klines", []):
            parts = row.split(",")
            if len(parts) >= 3:
                trend.append(fnum(parts[2]))
        trend = [v for v in trend[-30:] if v is not None]
    except Exception:
        trend = []

    tag = "中性"
    if change_pct < 0:
        tag = "利好金价"
    elif change_pct > 0:
        tag = "压制金价"
    return {"available": True, "value": price, "prev": prev, "change_pct": change_pct,
            "high": (data.get("f44") or 0) / 100.0, "low": (data.get("f45") or 0) / 100.0,
            "tag": tag, "trend": trend}


def fetch_shfe_main(timeout):
    """沪金主连连续合约（东财 113.AUM，元/克）：实时快照 + 长日线 OHLC。
    详情视图第二个标的；报价 f43 与涨跌幅 f170 均放大100倍需 /100。
    kline 行格式：日期,开,收,高,低,量,额。"""
    realtime_url = ("https://push2.eastmoney.com/api/qt/stock/get?"
                    "secid=113.AUM&fields=f43,f44,f45,f46,f60,f170")
    data = json.loads(http_get(realtime_url, EM_HEADERS, timeout)).get("data") or {}
    price = (data.get("f43") or 0) / 100.0
    prev = (data.get("f60") or 0) / 100.0
    change_pct = (data.get("f170") or 0) / 100.0
    if price <= 0:
        raise ValueError("shfe_main empty payload")

    daily = []
    end = datetime.now(CN_TZ).strftime("%Y%m%d")
    beg = (datetime.now(CN_TZ) - timedelta(days=420)).strftime("%Y%m%d")
    kline_url = ("https://push2his.eastmoney.com/api/qt/stock/kline/get?"
                 "secid=113.AUM&fields1=f1,f2,f3,f4,f5,f6&"
                 "fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=0"
                 f"&beg={beg}&end={end}")
    try:
        kdata = json.loads(http_get(kline_url, EM_HEADERS, timeout)).get("data") or {}
        for row in kdata.get("klines", []):
            parts = row.split(",")
            if len(parts) >= 5:
                daily.append({"date": parts[0], "o": fnum(parts[1]),
                              "c": fnum(parts[2]), "h": fnum(parts[3]),
                              "l": fnum(parts[4])})
    except Exception:
        daily = []
    return {"available": True, "price": price, "prev_close": prev,
            "change_pct": change_pct, "daily": daily}


# ---------- derived signals ----------

def backfill(cur, old, scalar_keys, seq_keys=()):
    """本次采集缺失（None / 空序列 / 空 dict）时沿用上一份 data.json 的旧值，
    避免休市或单次超时把上次成交价清空。只在当前为空时回填，绝不覆盖本次新采到的值；
    补到报价后把 available 置 True，前端才不会误判为 '--'。"""
    cur = cur if isinstance(cur, dict) else {}
    old = old if isinstance(old, dict) else {}
    out = dict(cur)
    filled_price = False
    for k in scalar_keys:
        if out.get(k) is None and old.get(k) is not None:
            out[k] = old[k]
            if k in ("price", "value"):
                filled_price = True
    for k in seq_keys:
        if not out.get(k) and old.get(k):
            out[k] = old[k]
    if filled_price and out.get("available") is not True:
        out["available"] = True
    return out


def build_premium(shge, xau, fx):
    shge, xau, fx = shge or {}, xau or {}, fx or {}
    if not (shge.get("available") and xau.get("available") and fx.get("available")):
        return {"available": False, "value_pct": None, "tag": "数据不足",
                "note": "汇率或金价缺失，溢价率暂无法计算", "footnote": ""}
    # 元/克 × 31.1035 = 元/盎司；÷汇率 = 美元/盎司
    domestic_oz_usd = shge["price"] * OZ_PER_GRAM / fx["price"]
    premium_pct = (domestic_oz_usd - xau["price"]) / xau["price"] * 100
    value = round(premium_pct, 1)
    if 0 <= value < 3:
        tag, note = "健康区间", "处于健康区间 (<3%)，情绪理性"
        tone = "good"
    elif 3 <= value < 5:
        tag, note = "偏高预警", "溢价略高于 3%，留意追高风险"
        tone = "gold"
    elif value >= 5:
        tag, note = "过热预警", "溢价 ≥5%，情绪偏热，谨慎追高"
        tone = "red"
    else:
        tag, note = "折价观察", "国内相对折价，需求偏弱需观察"
        tone = "neutral"
    return {"available": True, "value_pct": value, "tag": tag, "note": note,
            "footnote": "溢价按 上海金价/31.1035/汇率 与伦敦金现货折算", "tone": tone}


def build_verdict(comex, premium, us10y, dxy=None):
    comex, premium = comex or {}, premium or {}
    score = 0
    tags = []
    cp = comex.get("change_pct")
    if cp is not None:
        if cp > 0.5:
            score += 1
        elif cp < -1.0:
            score -= 1
    if premium.get("available"):
        pv = premium["value_pct"]
        if 0 <= pv < 3:
            score += 1
            tags.append({"text": f"溢价 {pv}%", "tone": "good"})
        elif pv >= 5:
            score -= 1
            tags.append({"text": f"溢价 {pv}% 偏高", "tone": "red"})
        elif pv >= 3:
            tags.append({"text": f"溢价 {pv}% 关注", "tone": "gold"})
        else:
            tags.append({"text": "国内折价", "tone": "neutral"})
    if us10y.get("available") and us10y.get("change_bps") is not None:
        if us10y["change_bps"] < 0:
            score += 1
            tags.append({"text": "美债利率下行", "tone": "good"})
    # 美元指数：走弱利好金价、走强压制金价；阈值 ±0.2% 过滤微小波动
    if dxy and dxy.get("available") and dxy.get("change_pct") is not None:
        dp = dxy["change_pct"]
        if dp <= -0.2:
            score += 1
            tags.append({"text": f"美元走弱 {dp:+.2f}%", "tone": "good"})
        elif dp >= 0.2:
            score -= 1
            tags.append({"text": f"美元走强 {dp:+.2f}%", "tone": "red"})

    if score >= 2:
        light, headline, sub = "green", "建议维持定投节奏", "趋势与溢价信号偏正面，风险可控"
        tags.insert(0, {"text": "趋势偏强", "tone": "good"})
    elif score >= 0:
        light, headline, sub = "yellow", "保持观察，控制节奏", "信号分化，建议分批操作、不追高"
        tags.insert(0, {"text": "信号中性", "tone": "gold"})
    else:
        light, headline, sub = "red", "短线谨慎，等待回落信号", "短线承压，优先控制仓位"
        tags.insert(0, {"text": "短线承压", "tone": "red"})
    return {"light": light, "headline": headline, "sub": sub, "tags": tags[:4]}


def build_compare(comex, shge, premium, gld, us10y, macro=None, dxy=None):
    macro = macro or {}
    comex, premium, gld, us10y = comex or {}, premium or {}, gld or {}, us10y or {}
    tag, facts = macro.get("tag"), macro.get("facts") or []
    if tag and facts:
        rows = [{"label": "宏观风向", "value": tag,
                 "tone": "good" if tag == "利好" else "red" if tag == "利空" else "neutral"}]
    else:
        rows = [{"label": "宏观风向", "value": "-- 待补充", "tone": "neutral"}]
    if us10y.get("available") and us10y.get("value") is not None:
        rows.append({"label": "美债收益率",
                     "value": f"{us10y['prev']}% → {us10y['value']}%",
                     "tone": "good" if (us10y.get("change_bps") or 0) < 0 else "red"})
    else:
        rows.append({"label": "美债收益率", "value": "-- 暂缺", "tone": "neutral"})
    if dxy and dxy.get("available") and dxy.get("value") is not None:
        cp = dxy.get("change_pct") or 0
        rows.append({"label": "美元指数",
                     "value": f"{dxy.get('prev')} → {dxy['value']}（{cp:+.2f}%）",
                     "tone": "red" if cp > 0 else "good"})
    else:
        rows.append({"label": "美元指数", "value": "-- 暂缺", "tone": "neutral"})
    weekly = gld.get("etf_weekly_change_tons")
    if isinstance(weekly, (int, float)):
        rows.append({"label": "资金流向",
                     "value": f"GLD 周 {weekly:+.2f} 吨 · ${gld.get('price')}",
                     "tone": "red" if weekly < 0 else "good"})
    elif gld.get("price"):
        rows.append({"label": "资金流向", "value": f"GLD ${gld.get('price')}", "tone": "gold"})
    else:
        rows.append({"label": "资金流向", "value": "-- 暂缺", "tone": "neutral"})
    if comex.get("available") and comex.get("change_pct") is not None:
        c = comex["change_pct"]
        rows.append({"label": "金价走势",
                     "value": f"{'上涨' if c >= 0 else '回调'} {c:+.2f}%",
                     "tone": "good" if c >= 0 else "red"})
    else:
        rows.append({"label": "金价走势", "value": "-- 暂缺", "tone": "neutral"})
    if premium.get("available"):
        rows.append({"label": "国内溢价", "value": f"{premium['value_pct']}%（{premium['tag']}）",
                     "tone": premium.get("tone", "good")})
    else:
        rows.append({"label": "国内溢价", "value": "-- 暂缺", "tone": "neutral"})
    return rows


def load_disclosure():
    """周度/月度披露与宏观要点（人工维护，不随行情刷新覆盖）。
    独立分发目录：脚本同级 disclosure.json；技能布局：assets/app/disclosure.json。"""
    here = Path(__file__).resolve().parent
    candidates = [here / "disclosure.json",
                  here.parent / "assets" / "app" / "disclosure.json"]
    for p in candidates:
        if p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                return {}
    return {}


def build_gld_details(gld, disc):
    rows = []
    if disc.get("etf_holdings_tons") is not None:
        w = disc.get("etf_weekly_change_tons")
        wtxt = f"，周环比 {w:+.2f} 吨" if isinstance(w, (int, float)) else ""
        rows.append(f"GLD 持仓 {disc['etf_holdings_tons']:.2f} 吨（{disc.get('etf_holdings_date', '')}）{wtxt}")
    if disc.get("pbo_months"):
        rows.append(f"中国央行连续 {disc['pbo_months']} 个月增持；储备 {disc.get('pbo_reserve_oz_wan')} 万盎司（截至 {disc.get('pbo_date', '')}）")
    if not rows:
        rows.append("周度披露字段待更新（见 disclosure.json）")
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None, help="output JSON path")
    ap.add_argument("--timeout", type=float, default=12.0)
    args = ap.parse_args()

    here = Path(__file__).resolve().parent
    if args.out:
        out_path = Path(args.out).resolve()
    elif (here / ".." / "assets" / "app").exists():
        # 技能原始布局：scripts/ ../assets/app/data.json
        out_path = (here / ".." / "assets" / "app" / "data.json").resolve()
    else:
        # 独立分发目录（脚本与页面同级）：写到脚本同目录 data.json
        out_path = here / "data.json"

    # 上一份 data.json 作为字段级兜底：自动源本次失败时沿用旧值，不把真实序列清空
    prev = {}
    try:
        if out_path.exists():
            prev = json.loads(out_path.read_text(encoding="utf-8")) or {}
    except Exception:
        prev = {}
    prev_gld = prev.get("gld") or {}

    collected, failed = {}, []
    collectors = {
        "shge": fetch_shge, "comex": fetch_comex, "xau": fetch_xau,
        "gld": fetch_gld, "gld_flow": fetch_gld_flow, "fx": fetch_fx_usdcny,
        "us10y": fetch_us10y, "dxy": fetch_dxy, "shfe_main": fetch_shfe_main,
    }
    for key, fn in collectors.items():
        try:
            collected[key] = fn(args.timeout)
            # 部分源内部容错：返回了 dict 但 available=false 也算失败
            if collected[key] and collected[key].get("available") is False:
                raise ValueError("payload unavailable")
            print(f"[ok]   {key}")
        except Exception as e:
            collected[key] = None
            failed.append(key)
            print(f"[fail] {key}: {type(e).__name__}: {e}")

    us10y = collected.get("us10y") or {"available": False, "value": None, "prev": None,
                                       "change_bps": None, "tag": None, "trend": []}
    us10y = backfill(us10y, prev.get("us10y") or {},
                     ["value", "prev", "change_bps", "tag"], ["trend"])
    disc = load_disclosure()
    gld_disc = disc.get("gld", {})
    macro = disc.get("macro", {"tag": "中性", "title": "", "facts": [], "sources": []})
    premium = build_premium(collected.get("shge") or {}, collected.get("xau") or {}, collected.get("fx") or {})
    verdict = build_verdict(collected.get("comex") or {}, premium, us10y, collected.get("dxy"))

    gld = collected.get("gld") or {}
    # 休市 / 个别源超时：单点报价与空序列沿用上一份 data.json，不把上次成交数据清空
    shge = backfill(collected.get("shge") or {}, prev.get("shge") or {},
                    ["price", "prev_close", "change_pct"], ["trend"])
    comex = backfill(collected.get("comex") or {}, prev.get("comex") or {},
                     ["price", "change_pct"], ["trend", "candles", "daily", "intraday"])
    shfe = backfill(collected.get("shfe_main") or {}, prev.get("shfe_main") or {},
                    ["price", "prev_close", "change_pct"], ["daily"])
    dxy = backfill(collected.get("dxy"), prev.get("dxy") or {},
                   ["value", "prev", "change_pct", "high", "low", "tag"], ["trend"])

    # GLD 持仓优先级：本次自动源 > disclosure 静态披露（非空才覆盖）> 上一份 data.json 旧值兜底
    gflow = collected.get("gld_flow") or {}
    gld_disc_eff = dict(prev_gld)
    for k, v in gld_disc.items():
        if v not in (None, [], {}, ""):
            gld_disc_eff[k] = v
    if gflow:
        if gflow.get("latest_tonnes_reported") is not None:
            gld_disc_eff["etf_holdings_tons"] = gflow["latest_tonnes_reported"]
            gld_disc_eff["etf_holdings_date"] = gflow.get("latest_date")
        if gflow.get("weekly_change_tons") is not None:
            gld_disc_eff["etf_weekly_change_tons"] = gflow["weekly_change_tons"]
        if gflow.get("source"):
            gld_disc_eff["etf_source"] = gflow["source"]

    payload = {
        "generated_at": datetime.now(CN_TZ).isoformat(timespec="seconds"),
        "fetch_status": {"ok": [k for k, v in collected.items() if v and v.get("available", True)],
                         "failed": failed},
        "verdict": verdict,
        "macro": macro,
        "us10y": us10y,
        "dxy": dxy,
        "gld": {"tag": gld_disc_eff.get("tag", "价格代理情绪"),
                "title": gld_disc_eff.get("title", "GLD ETF 价格（资金代理指标）"),
                "price": gld.get("price"),
                "details": build_gld_details(gld, gld_disc_eff),
                "etf_holdings_tons": gld_disc_eff.get("etf_holdings_tons"),
                "etf_holdings_date": gld_disc_eff.get("etf_holdings_date"),
                "etf_weekly_change_tons": gld_disc_eff.get("etf_weekly_change_tons"),
                "etf_source": gld_disc_eff.get("etf_source"),
                "holdings_flow": (gflow.get("holdings_flow") or gld_disc.get("holdings_flow")
                                  or prev_gld.get("holdings_flow") or []),
                "pbo_months": gld_disc_eff.get("pbo_months"),
                "pbo_reserve_oz_wan": gld_disc_eff.get("pbo_reserve_oz_wan"),
                "pbo_date": gld_disc_eff.get("pbo_date"),
                "pbo_source": gld_disc_eff.get("pbo_source"),
                "reserve_series": (gld_disc.get("reserve_series")
                                   or prev_gld.get("reserve_series") or [])},
        "comex": {**{k: v for k, v in comex.items()},
                  "tag": "趋势向上" if (comex.get("change_pct") or 0) >= 0 else "技术回调",
                  "note": "日内分时（分钟线）；虚线为前结算基准价，日K序列见 candles"},
        "shfe_main": shfe,
        "shge": {**shge, "trend_dates": [t["date"] for t in shge.get("trend", [])],
                 "trend": [t["close"] for t in shge.get("trend", [])]},
        "premium": premium,
        "compare": build_compare(comex, shge, premium,
                                 {**gld, **gld_disc_eff, "price": gld.get("price")},
                                 us10y, macro, dxy),
    }

    # flatten comex trend arrays
    payload["comex"]["trend_dates"] = [t["date"] for t in comex.get("trend", [])]
    payload["comex"]["trend"] = [t["close"] for t in comex.get("trend", [])]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWritten: {out_path}")
    print(f"OK sources: {payload['fetch_status']['ok']} | failed: {failed}")
    # 周末休市或个别源超时导致部分失败属预期：failed 已记录、缺失字段由 prev 兜底并在前端显示 --。
    # 只要 data.json 成功写出就应以 0 退出，保证后续 commit 步骤执行、数据回写仓库；
    # 仅当写出文件本身不存在（真正 IO 故障）时才非零退出。
    if not out_path.exists():
        sys.exit(1)


if __name__ == "__main__":
    main()
