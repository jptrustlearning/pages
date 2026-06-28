#!/usr/bin/env python3
# JPTrust ad render — portable build script
# Re-render:  python3 build_ad.py
# Requires once per machine:  python3 -m playwright install chromium
# Fonts + screenshot are bundled in this folder (no npm / internet needed).

import base64, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
FONTS = HERE / "fonts"

def b64(p):
    return base64.b64encode(pathlib.Path(p).read_bytes()).decode()

def face(family, fname, weight, style="normal"):
    data = b64(FONTS / fname)
    return (f"@font-face{{font-family:'{family}';font-style:{style};"
            f"font-weight:{weight};font-display:block;"
            f"src:url(data:font/woff2;base64,{data}) format('woff2');}}")

faces = []
for w in [300, 400, 500, 600, 700]:
    faces.append(face("Anuphan", f"anuphan-latin-{w}-normal.woff2", w))
    faces.append(face("Anuphan", f"anuphan-thai-{w}-normal.woff2", w))
for w in [400, 600]:
    faces.append(face("Cinzel", f"cinzel-latin-{w}-normal.woff2", w))
faces.append(face("DM Serif Display", "dm-serif-display-latin-400-normal.woff2", 400))
fontcss = "\n".join(faces)

screen = b64(HERE / "screen_vs.jpg")

html = f"""<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
<style>
{fontcss}
*{{margin:0;padding:0;box-sizing:border-box}}
:root{{
  --gold:#D4AF37; --gold-light:#F4E4BA; --gold-deep:#B8860B;
  --maroon:#722F37; --m-dark:#1a0a0e; --m-mid:#2d1018; --m-light:#3a1520;
  --text-light:#E8E4DC; --text-gold:#F4E4BA; --muted:#B6A595;
}}
html,body{{width:1080px;height:1350px}}
body{{
  font-family:'Anuphan',sans-serif;
  position:relative; overflow:hidden;
  background:
    radial-gradient(ellipse at 22% 16%, rgba(114,47,55,0.45) 0%, transparent 52%),
    radial-gradient(ellipse at 84% 30%, rgba(212,175,55,0.10) 0%, transparent 48%),
    radial-gradient(ellipse at 70% 86%, rgba(90,30,40,0.35) 0%, transparent 55%),
    linear-gradient(155deg,#1a0a0e 0%,#2d1018 30%,#3a1520 50%,#2d1018 72%,#150709 100%);
}}
.stars{{position:absolute;inset:0;opacity:.5;
  background-image:
    radial-gradient(1.5px 1.5px at 12% 22%, rgba(212,175,55,.55), transparent),
    radial-gradient(1.5px 1.5px at 78% 12%, rgba(244,228,186,.5), transparent),
    radial-gradient(1.2px 1.2px at 60% 40%, rgba(212,175,55,.4), transparent),
    radial-gradient(1.3px 1.3px at 30% 70%, rgba(212,175,55,.4), transparent),
    radial-gradient(1.4px 1.4px at 90% 64%, rgba(244,228,186,.45), transparent),
    radial-gradient(1.2px 1.2px at 46% 88%, rgba(212,175,55,.35), transparent),
    radial-gradient(1.1px 1.1px at 8% 52%, rgba(212,175,55,.3), transparent);
}}
.frame{{position:absolute;inset:0;border:1px solid rgba(212,175,55,.16);
  margin:26px;border-radius:14px;pointer-events:none}}
.frame::before{{content:"";position:absolute;inset:0;border-radius:14px;
  border:1px solid transparent;
  background:linear-gradient(120deg,rgba(212,175,55,0),rgba(212,175,55,.5),rgba(212,175,55,0)) border-box;
  -webkit-mask:linear-gradient(#fff 0 0) padding-box,linear-gradient(#fff 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude}}

.wrap{{position:absolute;inset:0;padding:74px 74px 60px;display:flex;flex-direction:column}}

.brandrow{{display:flex;align-items:center;justify-content:space-between;margin-bottom:34px}}
.logo{{font-family:'Cinzel',serif;font-weight:600;font-size:25px;letter-spacing:3px;
  background:linear-gradient(135deg,#D4AF37,#F4E4BA 55%,#D4AF37);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}}
.tagpill{{font-family:'Cinzel',serif;font-size:13px;letter-spacing:4px;color:#C4B88A;
  border:1px solid rgba(212,175,55,.3);border-radius:40px;padding:7px 16px;
  background:rgba(212,175,55,.05)}}

.eyebrow{{font-family:'Cinzel',serif;font-size:20px;letter-spacing:7px;color:var(--gold);
  display:flex;align-items:center;gap:14px;margin-bottom:18px}}
.eyebrow::before{{content:"";width:46px;height:1.5px;
  background:linear-gradient(90deg,var(--gold),transparent)}}

h1{{font-weight:600;font-size:60px;line-height:1.14;color:var(--text-gold);
  letter-spacing:.3px;margin-bottom:20px}}
h1 .g{{background:linear-gradient(120deg,#D4AF37,#F4E4BA 50%,#D4AF37);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}}
.sub{{font-weight:400;font-size:23px;line-height:1.62;color:var(--muted);
  max-width:880px;margin-bottom:42px}}
.sub b{{color:#E2D3B6;font-weight:600}}

.main{{display:flex;gap:48px;align-items:center;flex:1;min-height:0}}
.phonecol{{flex:0 0 352px;position:relative;display:flex;justify-content:center}}
.glow{{position:absolute;width:430px;height:430px;border-radius:50%;
  background:radial-gradient(circle,rgba(212,175,55,.30),transparent 62%);
  top:50%;left:50%;transform:translate(-50%,-50%);filter:blur(6px)}}
.phone{{position:relative;width:352px;border-radius:42px;padding:11px;
  background:linear-gradient(150deg,#3a1520,#1a0a0e 60%);
  box-shadow:0 30px 70px rgba(0,0,0,.55),0 0 0 1px rgba(212,175,55,.28),
             0 0 60px rgba(212,175,55,.12);}}
.phone img{{width:100%;display:block;border-radius:32px}}
.badge{{position:absolute;top:-18px;right:-10px;z-index:3;
  font-weight:700;font-size:18px;color:#1a0a0e;
  background:linear-gradient(135deg,#F4E4BA,#D4AF37);
  padding:11px 18px;border-radius:40px;
  box-shadow:0 8px 26px rgba(212,175,55,.4);transform:rotate(3deg);
  display:flex;align-items:center;gap:7px}}

.bullets{{flex:1;display:flex;flex-direction:column;gap:23px}}
.blabel{{font-family:'Cinzel',serif;font-size:15px;letter-spacing:4px;color:#C4B88A;
  margin-bottom:4px}}
.bi{{display:flex;gap:15px;align-items:flex-start}}
.di{{color:var(--gold);font-size:18px;line-height:1.5;margin-top:3px;flex:0 0 auto}}
.bt{{font-weight:500;font-size:25px;line-height:1.4;color:var(--text-light)}}
.bt .en{{font-weight:600;color:#EBDCBE}}

.foot{{margin-top:30px;border-top:1px solid rgba(212,175,55,.22);padding-top:24px;
  display:flex;align-items:center;justify-content:space-between}}
.disc{{font-weight:300;font-size:15px;color:#8E8073;line-height:1.5;max-width:560px}}
.cta{{font-weight:700;font-size:21px;color:#1a0a0e;
  background:linear-gradient(135deg,#F4E4BA,#D4AF37);
  padding:15px 30px;border-radius:50px;white-space:nowrap;
  box-shadow:0 8px 30px rgba(212,175,55,.35)}}
.cta small{{display:block;font-weight:500;font-size:13px;color:#3a1d12;letter-spacing:.5px;opacity:.85}}
</style></head>
<body>
<div class="stars"></div>
<div class="frame"></div>
<div class="wrap">

  <div class="brandrow">
    <div class="logo">JP TRUST LEARNING</div>
    <div class="tagpill">MOMENTUM&nbsp;·&nbsp;GOLD</div>
  </div>

  <div class="eyebrow">PROVEN PERFORMANCE</div>
  <h1>กลยุทธ์ที่<span class="g">พิสูจน์แล้ว</span><br>ไม่ใช่แค่คำพูด</h1>
  <div class="sub">ผลทดสอบย้อนหลัง <b>10 ปีเต็ม</b> เทียบกับ S&amp;P 500 แบบโปร่งใส ปีต่อปี — ไม่ใช่กราฟสวย ๆ ที่ใครก็ทำได้ แต่เป็นระบบ Backtest ที่เปิดดูเองได้ทุกตัวเลข</div>

  <div class="main">
    <div class="phonecol">
      <div class="glow"></div>
      <div class="phone">
        <div class="badge">★ ชนะดัชนีเกือบทุกปี</div>
        <img src="data:image/jpeg;base64,{screen}" alt="VS S&P 500">
      </div>
    </div>

    <div class="bullets">
      <div class="blabel">KEY FEATURES</div>
      <div class="bi"><span class="di">◆</span><span class="bt">เปรียบเทียบผลตอบแทนกับ <span class="en">S&amp;P 500</span> รายปี</span></div>
      <div class="bi"><span class="di">◆</span><span class="bt"><span class="en">Backtest</span> ย้อนหลังกว่า 10 ปี</span></div>
      <div class="bi"><span class="di">◆</span><span class="bt">กราฟ <span class="en">Equity Curve · Drawdown · Distribution</span></span></div>
      <div class="bi"><span class="di">◆</span><span class="bt">สถิติเชิงลึก ดูได้ทุกตัวเลข</span></div>
      <div class="bi"><span class="di">◆</span><span class="bt">โปร่งใส ตรวจสอบได้ ไม่ขายฝัน</span></div>
    </div>
  </div>

  <div class="foot">
    <div class="disc">* ผล Backtest เป็นการทดสอบย้อนหลัง ไม่ใช่การรับประกันผลตอบแทนในอนาคต การลงทุนมีความเสี่ยง</div>
    <div class="cta">ดาวน์โหลดแอปวันนี้<small>app.jptrustlearning.com</small></div>
  </div>

</div>
</body></html>"""

(HERE / "ad1.html").write_text(html, encoding="utf-8")
print("wrote ad1.html")

if "--no-render" in sys.argv:
    sys.exit(0)

from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1080, "height": 1350}, device_scale_factor=2)
    pg.goto((HERE / "ad1.html").as_uri())
    pg.wait_for_timeout(600)
    pg.screenshot(path=str(HERE / "ad1.png"), clip={"x": 0, "y": 0, "width": 1080, "height": 1350})
    b.close()
print("rendered ad1.png")
