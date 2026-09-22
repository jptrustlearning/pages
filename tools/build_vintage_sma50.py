#!/usr/bin/env python3
"""
build_vintage_sma50.py — data for vintage-sma50_uat.html

Rule (Joon, 22 Sep 2026):
  - Universe: S&P 500 (input_sp500_daily.csv) + current Nasdaq-100 (Yahoo, via runner)
  - Signal day t: Close[t] > SMA50[t] and Close[t-1] <= SMA50[t-1]  (close just crossed above)
  - Entry: Open of the next trading day (t+1)
  - Track: D1..D180 = Close[entry + k-1] / EntryOpen - 1   (D1 = close of the entry day)
  - Fell back below SMA50 and crossed again = a new row (name = TICKER YYYYMONDD of signal day)
  - One tab per entry year, from 2015

Output (pages/vintage-sma50/):
  meta.json     {asof, years:[{y,n}], k, ...}
  y{YEAR}.json  {y, asof, k, t:[[ticker, uni, L0, [deltas...], ended]], s:[[ti, sig, ent, pos, open, below]]}
    prices are stored as round(ln(price) * k) with k = 2000, delta-encoded per ticker
    (precision ~0.05%, plenty for 0.1% display). sig/ent are yymmdd ints.
    pos = entry row index inside the ticker slice (-1 = entry pending: signal on the last data day)
    open = entry open price (adjusted, as in the source file); chg = exp(L/k) / open - 1
    ended = yymmdd of the ticker's last data day when it is before asof (left the file), else 0
    below = first D (1..180) whose close is back under SMA50, 0 = not within tracked days

Usage:
  R=../jptrustdocs/research/vintage-sma50-20260922
  python3 tools/build_vintage_sma50.py --sp500 ../sp500/input_sp500_daily.csv \
      --ndx $R/ndx_daily.csv --ndx-list $R/ndx_list.csv --sp-yahoo $R/sp_daily_yahoo.csv \
      --bench ../sp500/input_benchmark_daily.csv
"""
import argparse, json, math, os
import numpy as np
import pandas as pd

K = 2000
HOLD = 180
SMA = 50
FIRST_YEAR = 2015

ap = argparse.ArgumentParser()
ap.add_argument('--sp500', required=True)
ap.add_argument('--ndx', default=None)
ap.add_argument('--ndx-list', default=None)
ap.add_argument('--bench', default=None, help='input_benchmark_daily.csv (SPY/QQQ, same dividend-adjusted basis)')
ap.add_argument('--sp-yahoo', default=None, help='Yahoo 4-dp series for S&P tickers (replaces the 2-dp file inside its own date range)')
ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'vintage-sma50'))
a = ap.parse_args()

MACRO = {'USDJPY', 'WTI', 'GOLD', 'BIL', 'FXY', 'GLD', 'SGOV', 'SHY', 'USL', 'USO', 'SPY', 'QQQ'}

sp = pd.read_csv(a.sp500)
sp = sp[~sp.Ticker.isin(MACRO)]
series = {}   # ticker -> DataFrame(Date, Open, Close) sorted
uni = {}
for t, g in sp.groupby('Ticker'):
    series[t] = g.sort_values('Date')[['Date', 'Open', 'Close']].reset_index(drop=True)
    uni[t] = 'S'
print('S&P tickers', len(series))

# Yahoo replacement for S&P-only names: same date range as the S&P file (keeps its add/remove
# coverage and avoids duplicates on renames like BK -> BNY), but 4 dp and properly split-adjusted.
if a.sp_yahoo and os.path.exists(a.sp_yahoo):
    yh = pd.read_csv(a.sp_yahoo)
    used, kept = 0, []
    for t, g in yh.groupby('Ticker'):
        if t not in series:
            continue
        s0 = series[t]
        g = g[(g.Date >= s0.Date.iloc[0]) & (g.Date <= s0.Date.iloc[-1])].sort_values('Date')[['Date', 'Open', 'Close']].dropna().reset_index(drop=True)
        if len(g) >= len(s0) - 5:
            series[t] = g; used += 1
        else:
            kept.append(t)
    print('S&P names on Yahoo series:', used, 'kept S&P file (short Yahoo):', kept)

sp_asof = sp.Date.max()
if a.ndx and os.path.exists(a.ndx):
    nd = pd.read_csv(a.ndx)
    nd = nd[nd.Date <= sp_asof]   # same last day as the S&P file (never a partial/intraday bar)
    ndx_names = set(pd.read_csv(a.ndx_list).Ticker) if a.ndx_list else set(nd.Ticker)
    swapped = []
    for t, g in nd.groupby('Ticker'):
        if t not in ndx_names:
            continue
        g = g.sort_values('Date')[['Date', 'Open', 'Close']].dropna().reset_index(drop=True)
        if t in series:
            uni[t] = 'SN'
            # in both: use the Yahoo 4-dp series — the S&P file is rounded to 2 dp, which is
            # up to ~1% noise on low adjusted prices (e.g. NVDA 2015 ~ $0.5) and some names only
            # start in the S&P file on their index-add date (e.g. MRVL)
            if len(g) >= len(series[t]) - 5:
                series[t] = g
                swapped.append(t)
        else:
            series[t] = g
            uni[t] = 'N'
    print('NDX added', sum(1 for v in uni.values() if v == 'N'), 'both', sum(1 for v in uni.values() if v == 'SN'),
          'in-both using Yahoo series:', len(swapped))

# Known bad adjustment in the source data (both Yahoo and the S&P file): DHR's Fortive spin-off
# shows as a +61% overnight gap on 2016-07-05. Neutralise the gap by rescaling earlier rows.
REPAIR = {'DHR': '2016-07-05'}
for t, d in REPAIR.items():
    if t in series:
        g = series[t]
        i = g.index[g.Date == d]
        if len(i) and i[0] > 0:
            i = i[0]
            f = g.Open.iloc[i] / g.Close.iloc[i - 1]
            g.loc[:i - 1, ['Open', 'Close']] *= f
            print('repair', t, d, 'factor', round(f, 4))

asof = max(s.Date.iloc[-1] for s in series.values())
print('asof', asof)

def yymmdd(d):
    return int(d[2:4] + d[5:7] + d[8:10])

rows = []  # (ticker, sig_idx, entry_idx or -1, below)
for t, g in series.items():
    c = g.Close.to_numpy(float)
    o = g.Open.to_numpy(float)
    n = len(c)
    if n < SMA + 2:
        continue
    sma = pd.Series(c).rolling(SMA).mean().to_numpy()
    above = c > sma
    valid = ~np.isnan(sma)
    cross = np.where(above[1:] & ~above[:-1] & valid[:-1] & valid[1:])[0] + 1
    for i in cross:
        e = i + 1
        if e >= n:
            if g.Date.iloc[-1] == asof:
                rows.append((t, i, -1, 0))
            continue
        if not (o[e] > 0):
            continue
        below = 0
        for k in range(1, HOLD + 1):
            j = e + k - 1
            if j >= n:
                break
            if not np.isnan(sma[j]) and c[j] < sma[j]:
                below = k
                break
        rows.append((t, i, e, below))
print('signals', len(rows))

def entry_year(r):
    t, i, e, _ = r
    d = series[t].Date.iloc[e] if e >= 0 else asof
    return int(d[:4])

by_year = {}
for r in rows:
    y = entry_year(r)
    if y >= FIRST_YEAR:
        by_year.setdefault(y, []).append(r)

# benchmarks: SPY / QQQ open+close on their own calendar
BENCH = {}
if a.bench and os.path.exists(a.bench):
    bb = pd.read_csv(a.bench)
    for t in ('SPY', 'QQQ'):
        g = bb[(bb.Ticker == t) & (bb.Date >= '2015-01-01') & (bb.Date <= asof)].sort_values('Date').reset_index(drop=True)
        BENCH[t] = g
    print('bench', {t: (g.Date.iloc[0], g.Date.iloc[-1], len(g)) for t, g in BENCH.items()})
cal = BENCH['SPY'].Date.tolist() if BENCH else []
cal_idx = {d: i for i, d in enumerate(cal)}

def logdelta(v):
    L = np.round(np.log(np.maximum(np.asarray(v, float), 1e-6)) * K).astype(np.int64)
    return [int(L[0])] + np.diff(L).tolist()

os.makedirs(a.out, exist_ok=True)
meta = {'asof': asof, 'k': K, 'hold': HOLD, 'sma': SMA, 'years': [], 'bench': sorted(BENCH),
        'universe': {'S': sum(1 for v in uni.values() if 'S' in v), 'N': sum(1 for v in uni.values() if 'N' in v)}}
for y in sorted(by_year):
    rs = sorted(by_year[y], key=lambda r: (series[r[0]].Date.iloc[r[1]], r[0]))
    # slice per ticker: from first entry (or signal) to last entry + HOLD
    span = {}
    for t, i, e, _ in rs:
        lo = e if e >= 0 else i
        hi = (e if e >= 0 else i) + HOLD
        a0, b0 = span.get(t, (lo, hi))
        span[t] = (min(a0, lo), max(b0, hi))
    tick = sorted(span)
    tidx = {t: j for j, t in enumerate(tick)}
    tarr = []
    for t in tick:
        lo, hi = span[t]
        c = series[t].Close.to_numpy(float)[lo:hi]
        L = np.round(np.log(np.maximum(c, 1e-6)) * K).astype(np.int64)
        d = np.diff(L).tolist()
        last = series[t].Date.iloc[-1]
        tarr.append([t, uni[t], int(L[0]), d, 0 if last == asof else yymmdd(last)])
    sarr = []
    for t, i, e, below in rs:
        g = series[t]
        lo = span[t][0]
        sig = yymmdd(g.Date.iloc[i])
        if e >= 0:
            ent = yymmdd(g.Date.iloc[e])
            op = float(g.Open.iloc[e])
            op = round(op, 4)
            sarr.append([tidx[t], sig, ent, int(e - lo), op, int(below)])
        else:
            sarr.append([tidx[t], sig, 0, -1, 0, 0])
    doc = {'y': y, 'asof': asof, 'k': K, 't': tarr, 's': sarr}
    if BENCH:
        # window on the SPY calendar: first entry/signal date .. last entry + HOLD days
        firsts = [series[r[0]].Date.iloc[r[2] if r[2] >= 0 else r[1]] for r in rs]
        i0 = next(i for i, d in enumerate(cal) if d >= min(firsts))
        i1 = min(len(cal), next((i for i, d in enumerate(cal) if d >= max(firsts)), len(cal) - 1) + HOLD + 1)
        win = cal[i0:i1]
        b = {'d': [yymmdd(d) for d in win]}
        for t, key in (('SPY', 'S'), ('QQQ', 'Q')):
            g = BENCH[t].set_index('Date').reindex(win).ffill()
            b[key] = logdelta(g.Close.values)
            b[key + 'o'] = logdelta(g.Open.values)
        doc['b'] = b
    p = os.path.join(a.out, f'y{y}.json')
    with open(p, 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    meta['years'].append({'y': y, 'n': len(sarr)})
    print(y, 'rows', len(sarr), 'tickers', len(tick), 'bytes', os.path.getsize(p))

with open(os.path.join(a.out, 'meta.json'), 'w') as f:
    json.dump(meta, f, separators=(',', ':'))
print('done', meta['years'])
