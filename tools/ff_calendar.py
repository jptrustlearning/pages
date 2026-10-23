#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ff_calendar.py — สร้าง news/ff-calendar.json = ข่าวแดง (ผลกระทบสูง) ของสหรัฐฯ จากฟีดสาธารณะของ ForexFactory
A263.5 (23 ต.ค. 2026) · ใช้กับการ์ดปฏิทินข่าว #mkCal ใน jptrust-toolkit.html (ตาราง ‹ วันนี้ › ของเราเอง)

ทำไมต้องมี
    จูน: widget TradingView หน่วง (วัดแล้ว: main thread +1.1 วิ ที่ CPU ช้า 4 เท่า · 45 ไฟล์ · กรอบดักนิ้ว หน้าไม่เลื่อน)
    → ทำตารางเบาของเราเอง · ฟีด ForexFactory ไม่ส่ง CORS header → เบราว์เซอร์ดึงตรงไม่ได้
    → workflow ใน repo นี้ (.github/workflows/ff_calendar.yml) ดึงทุก 3 ชม. แล้ว commit ไฟล์นี้ (same-origin)

กติกา
    - เก็บเฉพาะ country == 'USD' และ impact == 'High'
    - ฟีดมีแค่ "สัปดาห์นี้" (อาทิตย์–เสาร์ เวลานิวยอร์ก) → รวมกับไฟล์เดิม: รายการในช่วงวันของสัปดาห์ในฟีดแทนด้วยของใหม่
      (ข่าวที่ถูกเลื่อน/ยกเลิกจะหายไป) · รายการนอกช่วงเก็บไว้ · ตัดที่เก่ากว่า KEEP_DAYS วัน
    - เขียนไฟล์ใหม่ "เฉพาะเมื่อเนื้อหาเปลี่ยน" → workflow commit เฉพาะตอนเปลี่ยน (ไม่ให้ Cloudflare deploy ทุก 3 ชม.)
    - ฟีดพัง/ได้ HTML/ว่าง → ไม่แตะไฟล์เดิม · exit 1 ให้เห็นใน Actions
    - ไม่มีตัวเลขผลจริงในฟีดนี้ (มีแค่ forecast / previous)

ใช้ยังไง (รันจาก root ของ repo pages)
    python3 tools/ff_calendar.py                      # ดึงจากเน็ต
    python3 tools/ff_calendar.py --input feed.json    # ทดสอบจากไฟล์ (ฟีดดิบ)
"""
import json, os, sys, urllib.request
from datetime import datetime, timedelta, timezone

FEED = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'
OUT = os.path.join('news', 'ff-calendar.json')
KEEP_DAYS = 21


def fetch():
    last = None
    for _ in range(3):
        try:
            req = urllib.request.Request(FEED, headers={'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) jptrust-calendar/1.0'})
            return json.loads(urllib.request.urlopen(req, timeout=30).read())
        except Exception as e:  # noqa: BLE001
            last = e
    raise SystemExit(f'fetch failed: {last!r}')


def day(iso):                       # วันที่ตามเวลาในฟีด (นิวยอร์ก) — ใช้ตัดช่วงสัปดาห์เท่านั้น
    return iso[:10]


def main():
    args = sys.argv[1:]
    if '--input' in args:
        feed = json.load(open(args[args.index('--input') + 1], encoding='utf-8'))
    else:
        feed = fetch()
    if not isinstance(feed, list) or not feed or not all(isinstance(e, dict) and 'date' in e for e in feed):
        raise SystemExit('feed shape unexpected — file untouched')
    span = (min(day(e['date']) for e in feed), max(day(e['date']) for e in feed))
    fresh = [{'date': e['date'], 'title': (e.get('title') or '').strip(),
              'forecast': (e.get('forecast') or '').strip(), 'previous': (e.get('previous') or '').strip()}
             for e in feed if e.get('country') == 'USD' and e.get('impact') == 'High']

    old = {}
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding='utf-8'))
        except Exception:  # noqa: BLE001
            old = {}
    cutoff = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).strftime('%Y-%m-%d')
    keep = [e for e in old.get('events', []) if not (span[0] <= day(e['date']) <= span[1]) and day(e['date']) >= cutoff]
    events = sorted(keep + fresh, key=lambda e: datetime.fromisoformat(e['date']).astimezone(timezone.utc))   # เวลาเท่ากัน = ลำดับเดิมของฟีด
    cover = [min([span[0]] + [day(e['date']) for e in keep]), max([span[1]] + [day(e['date']) for e in keep])]

    if old.get('events') == events and old.get('covers') == cover:
        print(f'no change · {len(events)} events · covers {cover[0]}..{cover[1]}')
        return
    out = {
        'source': 'ForexFactory public weekly feed (ff_calendar_thisweek.json) · USD · impact High',
        'note': 'ข่าวแดงสหรัฐฯ · date = เวลาตามฟีด (มี offset) ให้หน้าเว็บแปลงเป็นเวลาไทยเอง · ไม่มีตัวเลขผลจริง',
        'changed_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'covers': cover,
        'events': events,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'written · {len(events)} events ({len(fresh)} this week) · covers {cover[0]}..{cover[1]}')


if __name__ == '__main__':
    main()
