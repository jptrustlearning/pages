#!/usr/bin/env python3
"""
scanner_weekly.py — อัปเดต scanner-summary.json อัตโนมัติ (workflow .github/workflows/scanner_summary.yml · A342.1)

ครอบ tools/gen_scanner_summary.py (ไม่แก้สูตร ไม่แก้ไฟล์นั้น) + ด่านตรวจตาม jptrustdocs reference/weekly-scan/README.md
  1) ข้อมูลสด: วันล่าสุดของ input_sp500_daily.csv ห่างจากวันนี้ไม่เกิน MAX_AGE_DAYS · จำนวนหุ้นวันล่าสุด >= MIN_TICKERS
  2) ไม่มีข้อมูลใหม่ (วันล่าสุด <= as_of เดิม) -> จบเฉยๆ ไม่เขียนไฟล์
  3) parity: ตัดข้อมูลที่ as_of เดิม รันสูตรเดิม -> as_of/total/counts/pct + ทุกแถว (ยกเว้นชื่อบริษัท) ต้องตรงไฟล์เดิมเป๊ะ
     ไม่ตรง = หยุด (เช่น ข้อมูลย้อนหลังถูกซ่อม split) ให้คนตรวจก่อน
  4) ผลใหม่สมเหตุสมผล: total ในช่วง TOTAL_RANGE · counts รวม = total · 3 ตาราง ตารางละ TOPN แถว
  5) backup ไฟล์เดิมเป็น scanner-summary-backup-as-of-YYYYMMDD.json (ไม่ทับ backup ที่มีอยู่) แล้วค่อยเขียนไฟล์ใหม่

env:
  SP500_DIR      โฟลเดอร์ที่มี input_sp500_daily.csv (+ output_combined_score_sp500.csv · all_profiles.csv)
  CONSTITUENTS   path ของ constituents.csv (datasets/s-and-p-500-companies)
  DRY_RUN        true = ตรวจ + คำนวณ แต่ไม่เขียนไฟล์ · ถ้าไม่มีข้อมูลใหม่จะรัน parity กับไฟล์ปัจจุบันเป็น self-test
  MAX_AGE_DAYS   ค่าเริ่มต้น 5 · TODAY (YYYY-MM-DD) ไว้ทดสอบ
exit 0 = เขียนแล้ว / ไม่มีข้อมูลใหม่ (ดู GITHUB_OUTPUT changed) · exit 1 = ด่านไม่ผ่าน (ไม่แตะไฟล์)
"""
import os, sys, json, shutil, tempfile, datetime, importlib.util
import pandas as pd
sys.dont_write_bytecode = True  # ไม่ทิ้ง tools/__pycache__ ไว้ใน working tree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SP500 = os.environ.get('SP500_DIR', os.path.join(ROOT, '..', 'sp500'))
SRC = os.path.join(SP500, 'input_sp500_daily.csv')
CUR = os.path.join(ROOT, 'scanner-summary.json')
DRY = os.environ.get('DRY_RUN', '').strip().lower() in ('1', 'true', 'yes')
MAX_AGE_DAYS = int(os.environ.get('MAX_AGE_DAYS', '5'))
TODAY = datetime.date.fromisoformat(os.environ['TODAY']) if os.environ.get('TODAY') else datetime.datetime.now(datetime.UTC).date()
MIN_TICKERS = 490          # วันปกติมี 500–501 ตัว
TOTAL_RANGE = (470, 505)   # รอบที่ผ่านมา 481–484
ROW_KEYS = ['rank', 'ticker', 'trend', 'momentum', 'ret1m', 'ret3m', 'ret6m', 'ret1y', 'rsi']  # ไม่รวม company

out_lines, summary = {}, []

def say(msg):
    print(msg)
    summary.append(msg)

def finish(code):
    gh_out, gh_sum = os.environ.get('GITHUB_OUTPUT'), os.environ.get('GITHUB_STEP_SUMMARY')
    if gh_out:
        with open(gh_out, 'a', encoding='utf-8') as f:
            for k, v in out_lines.items():
                f.write(f'{k}={v}\n')
    if gh_sum:
        with open(gh_sum, 'a', encoding='utf-8') as f:
            f.write('## Scanner summary (weekly)\n\n' + '\n'.join(f'- {s}' for s in summary) + '\n')
    sys.exit(code)

def fail(msg):
    say('FAIL: ' + msg)
    out_lines['changed'] = 'false'
    finish(1)

def load_gen():
    spec = importlib.util.spec_from_file_location('gen_scanner_summary', os.path.join(ROOT, 'tools', 'gen_scanner_summary.py'))
    g = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(g)
    return g

def run_gen(g, src, out):
    g.SRC, g.OUT = src, out
    g.main()
    with open(out, encoding='utf-8') as f:
        return json.load(f)

def fingerprint(d):
    fp = {k: d[k] for k in ('as_of', 'total', 'counts', 'pct')}
    for k in ('rows_bullish', 'rows_neutral', 'rows_bearish'):
        fp[k] = [[r[x] for x in ROW_KEYS] for r in d[k]]
    return fp

def parity(g, df, old, tmp, label):
    cut = os.path.join(tmp, 'cut.csv')
    df[df['Date'] <= old['as_of']].to_csv(cut, index=False)
    rep = run_gen(g, cut, os.path.join(tmp, 'parity.json'))
    a, b = fingerprint(old), fingerprint(rep)
    bad = [k for k in a if a[k] != b[k]]
    if bad:
        for k in bad:
            if k.startswith('rows_'):
                diffs = [(i + 1, x[1], y[1]) for i, (x, y) in enumerate(zip(a[k], b[k])) if x != y][:5]
                say(f'parity diff {k}: {diffs}')
            else:
                say(f'parity diff {k}: เดิม {a[k]} · คำนวณใหม่ {b[k]}')
        fail(f'parity ไม่ตรง ({label}) — ข้อมูลย้อนหลังหรือสูตรเปลี่ยน ต้องให้คนตรวจก่อน · ไม่แตะไฟล์')
    names = [(r['ticker'], r['company'], s['company']) for k in ('rows_bullish', 'rows_neutral', 'rows_bearish')
             for r, s in zip(old[k], rep[k]) if r['company'] != s['company']]
    say(f'parity ผ่าน ({label}): as_of {old["as_of"]} · total {old["total"]} · counts {old["counts"]}'
        + (f' · ชื่อบริษัทต่าง {len(names)} แถว (ไม่กระทบตัวเลข) {names[:3]}' if names else ''))

def main():
    if not os.path.exists(CUR):
        fail('ไม่พบ scanner-summary.json เดิม')
    with open(CUR, encoding='utf-8') as f:
        old = json.load(f)
    old_asof = old['as_of']
    out_lines['old_asof'] = old_asof

    df = pd.read_csv(SRC, usecols=['Ticker', 'Date', 'Close'])
    df['Date'] = df['Date'].astype(str)
    latest = df['Date'].max()
    n_latest = int((df['Date'] == latest).sum())
    age = (TODAY - datetime.date.fromisoformat(latest)).days
    say(f'ข้อมูล sp500 ล่าสุด {latest} ({n_latest} ตัว · ห่างวันนี้ {age} วัน) · การ์ดเดิม as_of {old_asof}')
    if age > MAX_AGE_DAYS:
        fail(f'ข้อมูล sp500 ค้าง (ล่าสุด {latest} เกิน {MAX_AGE_DAYS} วัน) — เช็ค workflow ของ sp500')
    if n_latest < MIN_TICKERS:
        fail(f'วันล่าสุด {latest} มีหุ้นแค่ {n_latest} ตัว (< {MIN_TICKERS}) — ข้อมูลอาจยังเข้าไม่ครบ')

    g = load_gen()
    with tempfile.TemporaryDirectory() as tmp:
        if latest <= old_asof:
            say('ไม่มีข้อมูลใหม่กว่าการ์ดเดิม — ไม่เปลี่ยนอะไร')
            if DRY:
                parity(g, df, old, tmp, 'self-test กับไฟล์ปัจจุบัน')
            out_lines['changed'] = 'false'
            finish(0)

        parity(g, df, old, tmp, f'ตัดข้อมูลที่ {old_asof}')

        new = run_gen(g, SRC, os.path.join(tmp, 'new.json'))
        c, t = new['counts'], new['total']
        if not (TOTAL_RANGE[0] <= t <= TOTAL_RANGE[1]):
            fail(f'total {t} นอกช่วง {TOTAL_RANGE}')
        if sum(c.values()) != t:
            fail(f'counts รวม {sum(c.values())} ไม่เท่ากับ total {t}')
        for k in ('rows_bullish', 'rows_neutral', 'rows_bearish'):
            if len(new[k]) != g.TOPN:
                fail(f'{k} มี {len(new[k])} แถว (ต้อง {g.TOPN})')
        noname = [r['ticker'] for k in ('rows_bullish', 'rows_neutral', 'rows_bearish') for r in new[k] if r['company'] == r['ticker']]
        top5 = ' '.join(r['ticker'] for r in new['rows_bullish'][:5])
        stats = f'{t} · {c["bullish"]}/{c["neutral"]}/{c["bearish"]}'
        say(f'ใหม่ as_of {new["as_of"]} · total {stats} · pct {new["pct"]} · Top 5 Bullish {top5}'
            + (f' · ชื่อบริษัทหาย {noname}' if noname else ''))
        out_lines.update(new_asof=new['as_of'], stats=stats)

        if DRY:
            say('DRY_RUN — ไม่เขียนไฟล์')
            out_lines['changed'] = 'false'
            finish(0)

        bname = f'scanner-summary-backup-as-of-{old_asof.replace("-", "")}.json'
        bpath = os.path.join(ROOT, bname)
        if os.path.exists(bpath):
            with open(bpath, 'rb') as a, open(CUR, 'rb') as b:
                same = a.read() == b.read()
            if same:
                say(f'backup {bname} มีอยู่แล้ว (เนื้อหาเดียวกัน)')
                bname = ''
            else:
                i = 2
                while os.path.exists(os.path.join(ROOT, bname.replace('.json', f'-{i}.json'))):
                    i += 1
                bname = bname.replace('.json', f'-{i}.json')
                bpath = os.path.join(ROOT, bname)
        if bname:
            shutil.copyfile(CUR, bpath)
            say(f'backup ไฟล์เดิม -> {bname}')
        shutil.copyfile(os.path.join(tmp, 'new.json'), CUR)
        say('เขียน scanner-summary.json ใหม่แล้ว')
        out_lines.update(changed='true', backup=bname)
        finish(0)

if __name__ == '__main__':
    main()
