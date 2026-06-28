#!/usr/bin/env python3
# JPTrust ad render — 2-column split layout (phone left / copy right)
import base64, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
FONTS = HERE / "fonts"

def b64(p): return base64.b64encode(pathlib.Path(p).read_bytes()).decode()
def face(fam, fn, w, st="normal"):
    return (f"@font-face{{font-family:'{fam}';font-style:{st};font-weight:{w};"
            f"font-display:block;src:url(data:font/woff2;base64,{b64(FONTS/fn)}) format('woff2');}}")

faces=[]
for w in [300,400,500,600,700]:
    faces.append(face("Anuphan",f"anuphan-latin-{w}-normal.woff2",w))
    faces.append(face("Anuphan",f"anuphan-thai-{w}-normal.woff2",w))
for w in [400,600]:
    faces.append(face("Cinzel",f"cinzel-latin-{w}-normal.woff2",w))
faces.append(face("DM Serif Display","dm-serif-display-latin-400-normal.woff2",400))
fontcss="\n".join(faces)
screen=b64(HERE/"screen_vs.jpg")

html=f"""<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><style>
{fontcss}
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{width:1080px;height:1350px}}
body{{font-family:'Anuphan',sans-serif;position:relative;overflow:hidden;
  background:
    radial-gradient(ellipse at 20% 14%, rgba(114,47,55,.48) 0%, transparent 50%),
    radial-gradient(ellipse at 88% 26%, rgba(212,175,55,.10) 0%, transparent 46%),
    radial-gradient(ellipse at 66% 90%, rgba(90,30,40,.38) 0%, transparent 54%),
    linear-gradient(155deg,#1a0a0e 0%,#2d1018 30%,#3a1520 50%,#2d1018 72%,#150709 100%);}}
.stars{{position:absolute;inset:0;opacity:.5;background-image:
    radial-gradient(1.5px 1.5px at 12% 22%, rgba(212,175,55,.55), transparent),
    radial-gradient(1.5px 1.5px at 80% 12%, rgba(244,228,186,.5), transparent),
    radial-gradient(1.2px 1.2px at 58% 40%, rgba(212,175,55,.4), transparent),
    radial-gradient(1.3px 1.3px at 30% 72%, rgba(212,175,55,.4), transparent),
    radial-gradient(1.4px 1.4px at 92% 64%, rgba(244,228,186,.45), transparent),
    radial-gradient(1.2px 1.2px at 46% 90%, rgba(212,175,55,.35), transparent),
    radial-gradient(1.1px 1.1px at 8% 52%, rgba(212,175,55,.3), transparent);}}
.frame{{position:absolute;inset:26px;border:1px solid rgba(212,175,55,.18);border-radius:14px;pointer-events:none}}

.wrap{{position:absolute;inset:0;padding:54px 56px 50px;display:flex;flex-direction:column}}

.brandrow{{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex:0 0 auto}}
.logo{{font-family:'Cinzel',serif;font-weight:600;font-size:27px;letter-spacing:3px;
  background:linear-gradient(135deg,#D4AF37,#F4E4BA 55%,#D4AF37);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}}
.tagpill{{font-family:'Cinzel',serif;font-size:14px;letter-spacing:4px;color:#C4B88A;
  border:1px solid rgba(212,175,55,.3);border-radius:40px;padding:8px 18px;background:rgba(212,175,55,.05)}}

.main{{flex:1;min-height:0;display:flex;gap:42px;align-items:center}}

/* LEFT — phone fills height */
.phonecol{{flex:0 0 430px;height:100%;position:relative;display:flex;align-items:center;justify-content:center}}
.glow{{position:absolute;width:460px;height:520px;border-radius:50%;
  background:radial-gradient(circle,rgba(212,175,55,.28),transparent 62%);
  top:50%;left:50%;transform:translate(-50%,-50%);filter:blur(8px)}}
.phone{{position:relative;width:416px;border-radius:46px;padding:12px;
  background:linear-gradient(150deg,#3a1520,#1a0a0e 60%);
  box-shadow:0 34px 80px rgba(0,0,0,.6),0 0 0 1px rgba(212,175,55,.30),0 0 70px rgba(212,175,55,.12);}}
.phone img{{width:100%;display:block;border-radius:36px}}
.badge{{position:absolute;top:-20px;right:-16px;z-index:3;font-weight:700;font-size:21px;color:#1a0a0e;
  background:linear-gradient(135deg,#F4E4BA,#D4AF37);padding:13px 22px;border-radius:44px;
  box-shadow:0 10px 30px rgba(212,175,55,.45);transform:rotate(3deg);display:flex;align-items:center;gap:8px}}

/* RIGHT — copy, larger type */
.copy{{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center}}
.eyebrow{{font-family:'Cinzel',serif;font-size:22px;letter-spacing:6px;color:#D4AF37;
  display:flex;align-items:center;gap:14px;margin-bottom:20px}}
.eyebrow::before{{content:"";width:42px;height:1.5px;background:linear-gradient(90deg,#D4AF37,transparent)}}
h1{{font-weight:600;font-size:70px;line-height:1.1;color:#F4E4BA;letter-spacing:.2px;margin-bottom:26px}}
h1 .g{{background:linear-gradient(120deg,#D4AF37,#F4E4BA 50%,#D4AF37);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}}
.sub{{font-weight:400;font-size:25px;line-height:1.55;color:#B6A595;margin-bottom:34px}}
.sub b{{color:#E2D3B6;font-weight:600}}
.blabel{{font-family:'Cinzel',serif;font-size:16px;letter-spacing:4px;color:#C4B88A;margin-bottom:20px}}
.bullets{{display:flex;flex-direction:column;gap:20px}}
.bi{{display:flex;gap:15px;align-items:flex-start}}
.di{{color:#D4AF37;font-size:21px;line-height:1.4;margin-top:3px;flex:0 0 auto}}
.bt{{font-weight:500;font-size:30px;line-height:1.34;color:#E8E4DC}}
.bt .en{{font-weight:600;color:#EBDCBE}}

.foot{{flex:0 0 auto;margin-top:22px;border-top:1px solid rgba(212,175,55,.22);padding-top:22px;
  display:flex;align-items:center;justify-content:space-between;gap:24px}}
.disc{{font-weight:300;font-size:16px;color:#8E8073;line-height:1.5;max-width:560px}}
.cta{{font-weight:700;font-size:23px;color:#1a0a0e;background:linear-gradient(135deg,#F4E4BA,#D4AF37);
  padding:16px 32px;border-radius:50px;white-space:nowrap;box-shadow:0 10px 32px rgba(212,175,55,.38);text-align:center}}
.cta small{{display:block;font-weight:500;font-size:14px;color:#3a1d12;letter-spacing:.5px;opacity:.85}}
</style></head><body>
<div class="stars"></div><div class="frame"></div>
<div class="wrap">
  <div class="brandrow">
    <div class="logo">JP TRUST LEARNING</div>
    <div class="tagpill">MOMENTUM&nbsp;·&nbsp;GOLD</div>
  </div>

  <div class="main">
    <div class="phonecol">
      <div class="glow"></div>
      <div class="phone">
        <div class="badge">★ ชนะดัชนีเกือบทุกปี</div>
        <img src="data:image/jpeg;base64,{screen}" alt="VS S&P 500">
      </div>
    </div>

    <div class="copy">
      <div class="eyebrow">PROVEN PERFORMANCE</div>
      <h1>กลยุทธ์ที่<br><span class="g">พิสูจน์แล้ว</span><br>ไม่ใช่แค่คำพูด</h1>
      <div class="sub">ผลทดสอบย้อนหลัง <b>10 ปีเต็ม</b> เทียบกับ S&amp;P 500 โปร่งใส ปีต่อปี — ระบบ Backtest ที่เปิดดูเองได้ทุกตัวเลข</div>
      <div class="blabel">KEY FEATURES</div>
      <div class="bullets">
        <div class="bi"><span class="di">◆</span><span class="bt">เทียบผลตอบแทนกับ <span class="en">S&amp;P 500</span> รายปี</span></div>
        <div class="bi"><span class="di">◆</span><span class="bt"><span class="en">Backtest</span> ย้อนหลังกว่า 10 ปี</span></div>
        <div class="bi"><span class="di">◆</span><span class="bt">กราฟ <span class="en">Equity · Drawdown</span> + สถิติเชิงลึก</span></div>
        <div class="bi"><span class="di">◆</span><span class="bt">ดูได้ทุกตัวเลข ตรวจสอบได้จริง</span></div>
        <div class="bi"><span class="di">◆</span><span class="bt">โปร่งใส ไม่ขายฝัน</span></div>
      </div>
    </div>
  </div>

  <div class="foot">
    <div class="disc">* ผล Backtest เป็นการทดสอบย้อนหลัง ไม่ใช่การรับประกันผลตอบแทนในอนาคต การลงทุนมีความเสี่ยง</div>
    <div class="cta">ดาวน์โหลดแอปวันนี้<small>app.jptrustlearning.com</small></div>
  </div>
</div>
</body></html>"""

(HERE/"ad1.html").write_text(html,encoding="utf-8")
print("wrote ad1.html")
if "--no-render" in sys.argv: sys.exit(0)
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    pg=b.new_page(viewport={"width":1080,"height":1350},device_scale_factor=2)
    pg.goto((HERE/"ad1.html").as_uri()); pg.wait_for_timeout(600)
    pg.screenshot(path=str(HERE/"ad1.png"),clip={"x":0,"y":0,"width":1080,"height":1350})
    b.close()
print("rendered ad1.png")
