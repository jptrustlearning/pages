#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_news_latest.py — สร้าง news/news-latest.json จาก batch บนสุดของ news/news-index.json

ทำไมต้องมี
    หน้า Tool&Kit (สาธารณะ) โชว์การ์ด "Insight วันนี้" = summary + โทนตลาดของ batch ล่าสุด
    news-index.json หนัก >1 MB และโตทุกวัน — ไม่ควรให้ผู้เข้าชมโหลดทั้งก้อนเพื่อย่อหน้าเดียว
    ไฟล์นี้จึงเป็น "สำเนาย่อ" ~2 KB ของ batch ล่าสุดเท่านั้น

    แอปสมาชิก (member-dashboard.html) ไม่ได้อ่านไฟล์นี้ — ยังอ่าน news-index.json ตามเดิม
    ถ้าลืมรันสคริปต์นี้: แอปยังถูกต้องเสมอ มีแค่การ์ดใน Tool&Kit ที่ค้างรอบก่อน

ใช้ยังไง (รันจาก root ของ repo pages ทุกครั้งหลังแก้ news-index.json ก่อน commit)
    python3 tools/gen_news_latest.py            # เขียนไฟล์
    python3 tools/gen_news_latest.py --check    # ตรวจว่าไฟล์ตรงกับ index ไหม (exit 1 ถ้าไม่ตรง/ไม่มี)

ตั้งใจ "ไม่" ใส่หัวข้อข่าวรายตัว/เนื้อหา — นั่นเป็นสิทธิ์ของสมาชิก หน้า Tool&Kit เป็นหน้าสาธารณะ
การนับโทนใช้ตรรกะเดียวกับ renderInsight() ในแอป: นับ sentiment ของ ticker ทุกตัวในทุก headline (ไม่ดู tone_override)
"""
import json, sys, os

INDEX = os.path.join('news', 'news-index.json')
OUT = os.path.join('news', 'news-latest.json')


def build(index):
    b = index['batches'][0]                      # newest-first ตาม NEWS-INSTRUCTION §4
    pos = neg = neu = 0
    for h in b.get('headlines', []):
        for t in h.get('tickers', []):
            s = t.get('sentiment')
            if s == 'positive':
                pos += 1
            elif s == 'negative':
                neg += 1
            else:
                neu += 1
    tilt = 'positive' if pos > neg else 'negative' if neg > pos else 'mixed'
    return {
        'source': 'news-index.json (batch บนสุด) — สร้างโดย tools/gen_news_latest.py ห้ามแก้มือ',
        'lastUpdated': index.get('lastUpdated'),
        'batch': {
            'file': b.get('file'),
            'date': b.get('date'),
            'date_display': b.get('date_display'),
            'summary': b.get('summary', ''),
            'headlines': len(b.get('headlines', [])),
            'tone': {'positive': pos, 'negative': neg, 'neutral': neu, 'total': pos + neg + neu, 'tilt': tilt},
        },
    }


def main():
    if not os.path.exists(INDEX):
        sys.exit('ไม่พบ %s — ต้องรันจาก root ของ repo pages' % INDEX)
    with open(INDEX, encoding='utf-8') as f:
        want = build(json.load(f))
    if '--check' in sys.argv:
        if not os.path.exists(OUT):
            sys.exit('✗ ยังไม่มี %s — รัน: python3 tools/gen_news_latest.py' % OUT)
        with open(OUT, encoding='utf-8') as f:
            have = json.load(f)
        if have != want:
            sys.exit('✗ %s ไม่ตรงกับ batch บนสุดของ index (มี %s · ควรเป็น %s) — รันสคริปต์ใหม่'
                     % (OUT, have.get('batch', {}).get('file'), want['batch']['file']))
        print('✓ %s ตรงกับ index (%s)' % (OUT, want['batch']['file']))
        return
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(want, f, ensure_ascii=False, indent=2)
        f.write('\n')
    t = want['batch']['tone']
    print('✓ เขียน %s ← %s · %d headlines · โทน +%d / −%d / =%d (%s) · %d bytes'
          % (OUT, want['batch']['file'], want['batch']['headlines'], t['positive'], t['negative'], t['neutral'], t['tilt'],
             os.path.getsize(OUT)))


if __name__ == '__main__':
    main()
