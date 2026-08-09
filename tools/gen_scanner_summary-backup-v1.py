#!/usr/bin/env python3
"""
gen_scanner_summary.py — build scanner-summary.json for the member-dashboard
S&P 500 Scanner tab (Planning Toolkit).

Reads the SAME daily price data the full scanner uses and computes momentum with
the SAME formula (Free_scannerSP500 -> computeAllMetrics):
    momScore weights = ret1m*0.15 + ret3m*0.25 + ret6m*0.35 + ret1y*0.25
Ranking uses a percentile-rank composite (robust to short-history / data-artifact
outliers e.g. recent IPOs). No numeric score is exposed — only Trend + Momentum
labels + Bullish/Neutral/Bearish counts (classified from SMA50/SMA200).

INPUTS (defaults assume an `sp500` checkout as a sibling of the `pages` repo):
    SP500_DIR (env)                 default ../sp500
      - {SP500_DIR}/input_sp500_daily.csv        (long: Ticker,Date,Open,High,Low,Close,Volume)
      - {SP500_DIR}/output_combined_score_sp500.csv  (Ticker->Company fallback)
      - {SP500_DIR}/all_profiles.csv                 (Ticker->Company fallback)
    CONSTITUENTS (env)              default ./constituents.csv OR fetched from datasets/s-and-p-500-companies
      - Symbol->Security  (primary, full-coverage company names)

OUTPUT: ./scanner-summary.json  (repo root of `pages`)

Run:  python3 tools/gen_scanner_summary.py
NOTE: the pipeline's own output_momentum/combined CSVs were stale (Feb 2026) while
the daily price input stays current, so this recomputes from input_sp500_daily.csv.
For daily auto-refresh, wire this into the sp500 GitHub Action and publish the JSON.
"""
import pandas as pd, numpy as np, json, datetime, sys, os

SP500 = os.environ.get('SP500_DIR', os.path.join(os.path.dirname(__file__), '..', '..', 'sp500'))
SRC = os.path.join(SP500, 'input_sp500_daily.csv')
CONS = os.environ.get('CONSTITUENTS', 'constituents.csv')
OUT = os.path.join(os.path.dirname(__file__), '..', 'scanner-summary.json')
NAME_SRCS = [(CONS, 'Symbol', 'Security'),
             (os.path.join(SP500, 'output_combined_score_sp500.csv'), 'Ticker', 'Company'),
             (os.path.join(SP500, 'all_profiles.csv'), 'Ticker', 'Company')]
TOPN = 25

def load_names():
    comp = {}
    for path, tc, cc in NAME_SRCS:
        try:
            pp = pd.read_csv(path, usecols=[tc, cc]).dropna(subset=[cc])
            for t, c in zip(pp[tc].astype(str).str.strip(), pp[cc].astype(str).str.strip()):
                if t and c and c.lower() != 'nan' and t not in comp:
                    comp[t] = c
        except Exception as e:
            print('name src skip', path, e, file=sys.stderr)
    return comp

def rsi14(c):
    if len(c) < 15: return 50.0
    d = np.diff(c[-15:]); g = d[d > 0].sum(); l = -d[d < 0].sum()
    return 100.0 if l == 0 else 100 - 100 / (1 + g / l)

def main():
    df = pd.read_csv(SRC, usecols=['Ticker', 'Date', 'Close'])
    df['Date'] = df['Date'].astype(str)
    max_date = df['Date'].max()
    cutoff = (datetime.date.fromisoformat(max_date) - datetime.timedelta(days=365 * 3)).isoformat()
    df = df[df['Date'] >= cutoff]
    comp = load_names()

    recs = []
    for tk, g in df.groupby('Ticker'):
        c = g.sort_values('Date')['Close'].to_numpy(float); n = len(c)
        if n < 252: continue  # require full 1Y history (drops IPO artifacts)
        latest = c[-1]
        ret1m = (latest - c[-22]) / c[-22] * 100
        ret3m = (latest - c[-64]) / c[-64] * 100
        ret6m = (latest - c[-127]) / c[-127] * 100
        ret1y = (latest - c[-253]) / c[-253] * 100
        sma50 = c[-50:].mean(); sma200 = c[-200:].mean()
        nm = comp.get(tk); nm = tk if (nm is None or str(nm).strip().lower() in ('', 'nan')) else str(nm)
        recs.append(dict(ticker=tk, company=nm,
                         ret1m=round(ret1m, 2), ret3m=round(ret3m, 2), ret6m=round(ret6m, 2), ret1y=round(ret1y, 2),
                         rsi=round(float(rsi14(c)), 1), a50=bool(latest > sma50), a200=bool(latest > sma200)))

    N = len(recs)
    for key in ['ret1m', 'ret3m', 'ret6m', 'ret1y']:
        order = sorted(range(N), key=lambda i: recs[i][key])
        for rank, i in enumerate(order): recs[i][key + '_pr'] = rank / (N - 1)
    for r in recs:
        r['mom'] = 0.15 * r['ret1m_pr'] + 0.25 * r['ret3m_pr'] + 0.35 * r['ret6m_pr'] + 0.25 * r['ret1y_pr']
    recs.sort(key=lambda r: r['mom'], reverse=True)

    def cls(r): return 'bullish' if (r['a50'] and r['a200']) else ('bearish' if (not r['a50'] and not r['a200']) else 'neutral')
    counts = {'bullish': 0, 'neutral': 0, 'bearish': 0}
    for r in recs: counts[cls(r)] += 1

    def trend(r):
        if r['a50'] and r['a200']: return 'Strong Up'
        if r['a200']: return 'Up'
        if r['a50']: return 'Mixed'
        return 'Down'
    def momlab(r):
        m = r['mom']
        return 'Strong' if m >= 0.80 else ('Moderate' if m >= 0.55 else ('Weak' if m >= 0.30 else 'Very Weak'))

    rows = [dict(rank=i + 1, ticker=r['ticker'], company=r['company'], trend=trend(r), momentum=momlab(r),
                 ret1m=r['ret1m'], ret3m=r['ret3m'], ret6m=r['ret6m'], ret1y=r['ret1y'], rsi=r['rsi'])
            for i, r in enumerate(recs[:TOPN])]

    summary = dict(as_of=max_date, generated_at=datetime.datetime.now(datetime.UTC).strftime('%Y-%m-%dT%H:%M:%SZ'),
                   universe='S&P 500', total=N, counts=counts,
                   pct={k: round(v / N * 100, 1) for k, v in counts.items()}, rows=rows)
    json.dump(summary, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('wrote', OUT, '| as_of', max_date, '| total', N, '| counts', counts)

if __name__ == '__main__':
    main()
