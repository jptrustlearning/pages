#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
news_check.py — ด่านตรวจ batch ข่าวก่อนขึ้นแอป + push ในคำสั่งเดียว (A283 · 24 ต.ค. 2026)

ทำไมต้องมี
    เดิมขั้น "validate" เป็นโค้ดตัวอย่างในคู่มือ (NEWS-INSTRUCTION §7 · §9.6 · §11) ที่รอบข่าวต้องคัดลอกไปรันเอง
    ไม่มีสคริปต์จริงใน repo → ถ้าไม่ได้รันก็หลุด · ตั้งแต่ 1 ก.ย. 2026 ขึ้น 124 batch แก้ทีหลัง 6 ครั้ง:
    เวลา batch อยู่ในอนาคต 3 ครั้ง (7 ก.ย. · 16 ต.ค. · 23 ต.ค.) · ชิปหุ้นไม่ครบ 1 ครั้ง (5 ต.ค. จูนทัก) · เกินแหล่ง 2 ครั้ง
    ไฟล์นี้ตรวจทุกข้อที่สคริปต์ตรวจได้ แล้ว push ให้เองเมื่อผ่าน — push ข่าวด้วยคำสั่งนี้เท่านั้น

ใช้ (รันจาก root ของ repo pages)
    python3 tools/news_check.py news/2026-10-24-0750.md
        ตรวจอย่างเดียว · exit 0 = ผ่าน (อาจมีคำเตือน) · exit 1 = ไม่ผ่าน
    python3 tools/news_check.py news/2026-10-24-0750.md --publish -m "feat(news): batch …"
        ตรวจ → gen_news_latest.py (+ --check) → commit backup index (ถ้ามี) → commit batch → rebase → push (ลองซ้ำได้ 3 ครั้ง)
        ไม่ผ่านด่าน = ไม่แตะ git เลย
    python3 tools/news_check.py --history 2026-10-05
        ตรวจย้อนหลังทุก batch ตั้งแต่วันนั้น (ข้ามเช็คเวลาอนาคต/ตำแหน่งบนสุด) — ใช้ปรับ tools/news_check_names.json

ไม่ผ่าน (บล็อก)                                          เตือน (ไม่บล็อก)
- เวลา batch อยู่ในอนาคต (เวลาไทยตอนรัน)                    - เวลา batch เก่ากว่า 60 นาที
- เวลาในชื่อไฟล์ · frontmatter · footer · index ไม่ตรงกัน    - tickers ของ batch ไม่ตรงกับชิปรวมทุกหัวข้อ
- batch ไม่ได้อยู่บนสุดของ index · lastUpdated ไม่ตรง        - ดัชนี/สินค้า/ค่าเงิน/ETF ที่เอ่ยถึงแต่ไม่มีชิป
- จำนวนหัวข้อใน .md ≠ index · ขาด source/published          - ชิปที่ยังไม่มีชื่อเรียกในตารางและไม่เจอในเนื้อข่าว
- ทุกหัวข้อต้องมี "สำหรับนักลงทุนไทย" + "ปัจจัยที่ต้องติดตาม"
- footer · คำต้องห้าม · ตาราง markdown · เส้น --- กลางหัวข้อ · ขนาด 8,000–40,000 ตัวอักษร
- หัวข้อหุ้นเด่น ≥ 1 · รอบ 22:xx จันทร์–ศุกร์ ≥ 2 (ตั้งแต่ 23 ต.ค. 2026)
- ชิปหุ้น: หุ้นที่ข่าวเอ่ยถึงต้องมีชิปในหัวข้อนั้น · ชิปที่รู้ชื่อเรียกต้องมีชื่ออยู่ในเนื้อหัวข้อนั้น
- news-latest.json ไม่ตรงกับ index (ตอน --publish)

ห้ามแก้ตรรกะเพื่อให้ batch ผ่าน · ชื่อเรียกใหม่เพิ่มใน tools/news_check_names.json แล้ว commit ไปพร้อม batch
"""
import json, os, re, subprocess, sys
from datetime import datetime, timedelta, timezone

INDEX = os.path.join('news', 'news-index.json')
NAMES = os.path.join('tools', 'news_check_names.json')
BKK = timezone(timedelta(hours=7))
BAD_PHRASES = ['Safe Haven Premium', 'Sector Rotation', 'Premarket พุ่ง', 'Bull-Bear Spread',
               'ทำไมถึงสำคัญ', 'พุ่งทะลุ', 'ดิ่งเหว']
SENTIMENTS = {'positive', 'negative', 'neutral'}
HOT_TWO_FROM = '2026-10-23'
FNAME = re.compile(r'(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.md$')
TOKEN = re.compile(r'(?<![A-Za-z0-9.&\-])([A-Z][A-Z0-9]{1,6}(?:\.[A-Z]{1,2})?|\d{3,6}[A-Z]?\.[A-Z]{1,2})(?![A-Za-z0-9])')


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def has_word(text, word):
    """ชื่อ/สัญลักษณ์ปรากฏในข้อความแบบเป็นคำ (ตัวพิมพ์ตรง) · ภาษาไทยหาแบบ substring · ขึ้นต้น re: = regex"""
    if word.startswith('re:'):
        return re.search(word[3:], text) is not None
    if re.search(r'[฀-๿]', word):
        return word in text
    return re.search(r'(?<![A-Za-z0-9])' + re.escape(word) + r'(?![A-Za-z0-9])', text) is not None


def split_batch(md):
    if not md.startswith('---'):
        return None, md
    parts = md.split('\n---\n', 1)
    if len(parts) < 2:
        return None, md
    return parts[0][3:], parts[1]


def sections_of(body):
    """คืน [(หัวข้อ, เนื้อหา)] ตามบรรทัด '## ' · ส่วนก่อนหัวข้อแรกไม่นับ"""
    chunks = re.split(r'^## ', body, flags=re.M)[1:]
    out = []
    for c in chunks:
        head, _, rest = c.partition('\n')
        out.append((head.strip(), c))
    return out


class Report:
    def __init__(self, name):
        self.name, self.errors, self.warns = name, [], []

    def err(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warns.append(msg)


def check_batch(path, index, names, live=True, now=None):
    r = Report(os.path.basename(path))
    m = FNAME.search(path)
    if not m:
        r.err('ชื่อไฟล์ต้องเป็น news/YYYY-MM-DD-HHMM.md')
        return r
    y, mo, d, hh, mi = map(int, m.groups())
    bdt = datetime(y, mo, d, hh, mi)
    iso = bdt.strftime('%Y-%m-%dT%H:%M:00Z')
    hhmm = '%02d:%02d' % (hh, mi)
    fname = os.path.basename(path)

    # 1) เวลา
    if live:
        now = now or datetime.now(BKK).replace(tzinfo=None)
        if bdt > now:
            r.err('เวลา batch %s อยู่ในอนาคต (ตอนนี้ %s เวลาไทย) → เปลี่ยนเป็นเวลาไทยตอนนี้ลบ 5–15 นาที ทั้งชื่อไฟล์ frontmatter footer index (§9.6)'
                  % (bdt.strftime('%d/%m %H:%M'), now.strftime('%H:%M')))
        elif now - bdt > timedelta(minutes=60):
            r.warn('เวลา batch เก่ากว่าเวลาตอนนี้ %d นาที (ควรเป็นเวลาตอน push ลบ 5–15 นาที)' % ((now - bdt).seconds // 60))

    try:
        with open(path, encoding='utf-8') as f:
            md = f.read()
    except OSError as e:
        r.err('เปิดไฟล์ไม่ได้: %s' % e)
        return r
    fm, body = split_batch(md)
    if fm is None:
        r.err('ไม่มี frontmatter (--- … ---) บนสุด')
        return r
    fmd = re.search(r'^date:\s*(\S+)', fm, re.M)
    if not fmd or fmd.group(1) != iso:
        r.err('frontmatter date ต้องเป็น %s (ตรงชื่อไฟล์) · เจอ %s' % (iso, fmd.group(1) if fmd else 'ไม่มี'))
    fdisp = re.search(r'^date_display:\s*(.+)$', fm, re.M)
    if not fdisp or hhmm not in fdisp.group(1):
        r.err('frontmatter date_display ต้องลงท้ายเวลา %s' % hhmm)
    foot = re.findall(r'^\*สรุปโดย JP Trust Learning[^\n]*\*\s*$', md, re.M)
    if not foot:
        r.err('ไม่มี footer `*สรุปโดย JP Trust Learning · … *`')
    elif hhmm not in foot[-1]:
        r.err('footer ต้องมีเวลา %s (เจอ: %s)' % (hhmm, foot[-1].strip()))

    # 2) index
    entry = next((b for b in index.get('batches', []) if b.get('file') == fname), None)
    if entry is None:
        r.err('ไม่พบ %s ใน news-index.json' % fname)
        return r
    if live:
        top = index['batches'][0].get('file') if index.get('batches') else None
        if top != fname:
            r.err('batch นี้ต้องอยู่บนสุดของ index (บนสุดตอนนี้: %s)' % top)
        if index.get('lastUpdated') != iso:
            r.err('index lastUpdated ต้องเป็น %s (เจอ %s)' % (iso, index.get('lastUpdated')))
    if entry.get('date') != iso:
        r.err('index date ต้องเป็น %s (เจอ %s)' % (iso, entry.get('date')))
    if hhmm not in (entry.get('date_display') or ''):
        r.err('index date_display ต้องมีเวลา %s' % hhmm)
    if not (entry.get('summary') or '').strip():
        r.err('index ไม่มี summary (ขึ้นการ์ด Insight หน้า Tool&Kit)')

    secs = sections_of(body)
    heads = entry.get('headlines', [])
    if len(secs) != len(heads):
        r.err('จำนวนหัวข้อใน .md (%d) ไม่เท่ากับใน index (%d)' % (len(secs), len(heads)))
    if not secs:
        r.err('ต้องมีอย่างน้อย 1 หัวข้อ (บรรทัดขึ้นต้น "## ")')

    # 3) เนื้อหา
    n = len(md)
    if n < 8000 or n > 40000:
        r.err('ขนาดไฟล์ %s ตัวอักษร ต้องอยู่ระหว่าง 8,000–40,000' % format(n, ','))
    for p in BAD_PHRASES:
        if p in md:
            r.err('เจอคำต้องห้าม "%s"' % p)
    if re.search(r'^\s*\|.*\|\s*$', body, re.M):
        r.err('มีตาราง markdown (หน้าแอปแสดงตารางไม่ได้ → ใช้ bullet)')
    for i, (head, text) in enumerate(secs, 1):
        if 'สำหรับนักลงทุนไทย' not in text and 'ผลกระทบต่อนักลงทุนไทย' not in text:
            r.err('หัวข้อ %d ไม่มีส่วน "สำหรับนักลงทุนไทย"' % i)
        if 'ปัจจัยที่ต้องติดตาม' not in text:
            r.err('หัวข้อ %d ไม่มีส่วน "ปัจจัยที่ต้องติดตาม"' % i)
        lines = [ln for ln in text.split('\n') if ln.strip() and not ln.startswith('*สรุปโดย JP Trust Learning')]
        inner = [k for k, ln in enumerate(lines[:-1]) if ln.strip() == '---']
        if inner:
            r.err('หัวข้อ %d มีเส้น --- กลางหัวข้อ (ทำให้หน้าอ่านข่าวแสดงไม่ครบ)' % i)

    hot = sum(1 for h in heads if 'หุ้นเด่น' in (h.get('title') or ''))
    need = 2 if (bdt.weekday() < 5 and hh >= 22 and fname[:10] >= HOT_TWO_FROM) else 1
    if hot < need:
        r.err('ต้องมีหัวข้อหุ้นเด่นอย่างน้อย %d หัวข้อ (เจอ %d · ชื่อหัวข้อต้องมีคำว่า "หุ้นเด่น")' % (need, hot))

    # 4) ชิปหุ้น
    macro = set(names.get('macro', []))
    not_tickers = set(names.get('not_tickers', []))
    alias = names.get('names', {})
    flag_names = names.get('flag_names', {})
    known = set(alias) | set(names.get('known_symbols', []))
    for b in index.get('batches', []):
        for h in b.get('headlines', []):
            for t in h.get('tickers', []):
                if t.get('symbol'):
                    known.add(t['symbol'])
    known -= not_tickers

    union = set()
    for i, (h, (head, text)) in enumerate(zip(heads, secs), 1):
        if not h.get('source') or not h.get('published'):
            r.err('หัวข้อ %d ใน index ขาด source หรือ published' % i)
        tk = h.get('tickers') or []
        if not tk:
            r.err('หัวข้อ %d ไม่มีชิปหุ้นเลย' % i)
        syms = []
        for t in tk:
            s = t.get('symbol')
            if not s:
                r.err('หัวข้อ %d มีชิปที่ไม่มี symbol' % i)
                continue
            if t.get('sentiment') not in SENTIMENTS:
                r.err('หัวข้อ %d ชิป %s sentiment ต้องเป็น positive/negative/neutral' % (i, s))
            syms.append(s)
        dup = sorted({s for s in syms if syms.count(s) > 1})
        if dup:
            r.err('หัวข้อ %d ชิปซ้ำ: %s' % (i, ', '.join(dup)))
        chips = set(syms)
        union |= chips
        # 4a ชิป → เนื้อข่าว
        for s in syms:
            if has_word(text, s) or any(has_word(text, a) for a in alias.get(s, [])):
                continue
            if s in alias:
                r.err('หัวข้อ %d มีชิป %s แต่เนื้อหัวข้อไม่ได้เอ่ยถึง (ชื่อที่ใช้ได้: %s) — ห้ามใส่ชิปที่ข่าวไม่ได้เขียนถึง'
                      % (i, s, ' / '.join(alias[s][:4])))
            else:
                r.warn('หัวข้อ %d ไม่เจอชื่อของชิป %s ในเนื้อหัวข้อ — ถ้าเขียนเป็นชื่อบริษัท เพิ่มชื่อใน %s ช่อง names' % (i, s, NAMES))
        # 4b เนื้อข่าว → ชิป (สัญลักษณ์ที่เคยเป็นชิป)
        for tok in sorted(set(TOKEN.findall(text))):
            if tok in chips or tok not in known:
                continue
            if len(tok) <= 2 and '(%s)' % tok not in text:
                continue  # ตัวย่อ 2 ตัวอักษรชนคำอื่นบ่อย (เช่น พรรค PL) → นับเมื่อเขียนแบบ "(GS)" เท่านั้น
            if tok in macro:
                r.warn('หัวข้อ %d เอ่ยถึง %s แต่ไม่มีชิป (ดัชนี/สินค้า/ค่าเงิน/ETF — ใส่ถ้าเป็นประเด็นของหัวข้อ)' % (i, tok))
            else:
                r.err('หัวข้อ %d เอ่ยถึงหุ้น %s แต่ไม่มีชิป — หุ้นทุกตัวที่ข่าวพูดถึงต้องอยู่ในชิป (จูน 5 ต.ค. 2026)' % (i, tok))
        # 4c เนื้อข่าว → ชิป (ชื่อบริษัท)
        for nm, ok in flag_names.items():
            if has_word(text, nm) and not (chips & set(ok)):
                r.err('หัวข้อ %d เอ่ยถึง %s แต่ไม่มีชิป (%s)' % (i, nm, ' / '.join(ok[:3])))

    fmt = re.search(r'^tickers:\s*\[(.*)\]', fm, re.M)
    fm_set = {x.strip() for x in fmt.group(1).split(',') if x.strip()} if fmt else set()
    if fm_set != union or set(entry.get('tickers') or []) != union:
        r.warn('tickers ของ batch (frontmatter / index) ไม่ตรงกับชิปรวมทุกหัวข้อ')
    return r


def show(r):
    print('== %s · ไม่ผ่าน %d · เตือน %d' % (r.name, len(r.errors), len(r.warns)))
    for e in r.errors:
        print('  ❌ ' + e)
    for w in r.warns:
        print('  ⚠️ ' + w)


def git(*args, check=True):
    p = subprocess.run(['git'] + list(args), capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError('git %s: %s' % (' '.join(args), (p.stderr or p.stdout).strip()))
    return p


def publish(path, message):
    if subprocess.run([sys.executable, 'tools/gen_news_latest.py']).returncode != 0:
        sys.exit('gen_news_latest.py ล้มเหลว — ยังไม่ได้ commit อะไร')
    if subprocess.run([sys.executable, 'tools/gen_news_latest.py', '--check']).returncode != 0:
        sys.exit('news-latest.json ไม่ตรงกับ index — ยังไม่ได้ commit อะไร')
    fname = os.path.basename(path)
    st = git('status', '--porcelain').stdout.splitlines()
    backups = [ln[3:] for ln in st if ln.startswith('??') and re.match(r'news/news-index-backup.*\.json$', ln[3:])]
    if backups:
        git('add', *backups)
        git('commit', '-q', '-m', 'backup: news-index ก่อนเพิ่ม batch %s' % fname[:-3])
    files = [path, INDEX, os.path.join('news', 'news-latest.json')]
    if git('status', '--porcelain', NAMES).stdout.strip():
        files.append(NAMES)
    git('add', *files)
    git('commit', '-q', '-m', message)
    for attempt in range(1, 4):
        git('fetch', '-q', 'origin', 'main')
        rb = git('rebase', '-q', 'origin/main', check=False)
        if rb.returncode != 0:
            git('rebase', '--abort', check=False)
            sys.exit('rebase ชนกับ remote — ยกเลิกแล้ว ยังไม่ได้ push · ห้ามแก้ชนโดยเอาไฟล์ของตัวเองทับ → แจ้งจูน\n' + rb.stderr)
        ps = git('push', '-q', 'origin', 'HEAD:main', check=False)
        if ps.returncode == 0:
            sha = git('rev-parse', '--short', 'HEAD').stdout.strip()
            print('✓ push แล้ว %s · %s' % (sha, fname))
            return
        print('push ถูกปฏิเสธ (ครั้งที่ %d) — ดึงล่าสุดแล้วลองใหม่' % attempt)
    sys.exit('push ไม่สำเร็จ 3 ครั้ง — commit อยู่ในเครื่อง ยังไม่ขึ้นแอป → แจ้งจูน')


def main():
    args = sys.argv[1:]
    if not os.path.exists(INDEX):
        sys.exit('ไม่พบ %s — ต้องรันจาก root ของ repo pages' % INDEX)
    index = load_json(INDEX)
    names = load_json(NAMES) if os.path.exists(NAMES) else {}
    if args and args[0] == '--history':
        since = args[1] if len(args) > 1 else '2026-10-05'
        files = sorted({b['file'] for b in index.get('batches', []) if b.get('file', '') >= since})
        bad = 0
        for f in files:
            r = check_batch(os.path.join('news', f), index, names, live=False)
            if r.errors or r.warns:
                show(r)
            bad += bool(r.errors)
        print('\nสรุป: %d batch · ไม่ผ่าน %d' % (len(files), bad))
        return
    if not args or args[0].startswith('-'):
        sys.exit(__doc__)
    path = args[0]
    r = check_batch(path, index, names, live=True)
    show(r)
    if r.errors:
        sys.exit(1)
    print('✓ ผ่านด่านตรวจ')
    if '--publish' in args:
        if '-m' not in args or args.index('-m') + 1 >= len(args):
            sys.exit('--publish ต้องมี -m "ข้อความ commit"')
        publish(path, args[args.index('-m') + 1])


if __name__ == '__main__':
    main()
