#!/usr/bin/env python3
# JPTrust ad render — premium black/gold, icon-card features, tilted phone, full CTA bar
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
owl=b64(HERE/"owl.png")

# inline gold-stroke icons
GOLD="#D4AF37"
ic_bars=f'<svg viewBox="0 0 24 24" fill="none" stroke="{GOLD}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="20" x2="4" y2="11"/><line x1="10" y1="20" x2="10" y2="4"/><line x1="16" y1="20" x2="16" y2="14"/><line x1="20" y1="20" x2="20" y2="8"/></svg>'
ic_hist=f'<svg viewBox="0 0 24 24" fill="none" stroke="{GOLD}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4v5h5"/><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3 9"/><path d="M12 8v4.5l3 1.7"/></svg>'
ic_line=f'<svg viewBox="0 0 24 24" fill="none" stroke="{GOLD}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 16 9 10 13 14 21 5"/><polyline points="15 5 21 5 21 11"/></svg>'
ic_shield=f'<svg viewBox="0 0 24 24" fill="none" stroke="{GOLD}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.6-3.1 7.8-7 9-3.9-1.2-7-4.4-7-9V6z"/><polyline points="9 12 11 14 15 10"/></svg>'
ic_globe=f'<svg viewBox="0 0 24 24" fill="none" stroke="{GOLD}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.2"/><line x1="2.8" y1="12" x2="21.2" y2="12"/><path d="M12 2.8c2.6 2.5 4 5.8 4 9.2s-1.4 6.7-4 9.2c-2.6-2.5-4-5.8-4-9.2s1.4-6.7 4-9.2z"/></svg>'

html=f"""<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><style>
{fontcss}
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{width:1080px;height:1350px}}
body{{font-family:'Anuphan',sans-serif;position:relative;overflow:hidden;
  background:
    radial-gradient(ellipse 60% 50% at 12% 80%, rgba(184,108,20,.32) 0%, transparent 60%),
    radial-gradient(ellipse 50% 40% at 92% 18%, rgba(212,175,55,.16) 0%, transparent 60%),
    radial-gradient(ellipse 70% 60% at 78% 92%, rgba(120,50,40,.30) 0%, transparent 60%),
    linear-gradient(160deg,#150709 0%,#1c0c0e 28%,#241012 50%,#1a0a0e 74%,#120608 100%);}}
.streak{{position:absolute;inset:0;opacity:.6;background-image:
    radial-gradient(1.4px 1.4px at 16% 30%, rgba(212,175,55,.5), transparent),
    radial-gradient(1.3px 1.3px at 30% 78%, rgba(232,163,61,.5), transparent),
    radial-gradient(1.2px 1.2px at 60% 88%, rgba(212,175,55,.4), transparent),
    radial-gradient(1.3px 1.3px at 88% 70%, rgba(244,228,186,.45), transparent),
    radial-gradient(1.1px 1.1px at 8% 56%, rgba(212,175,55,.35), transparent);}}
.frame{{position:absolute;inset:24px;border:1px solid rgba(212,175,55,.16);border-radius:16px;pointer-events:none}}

.wrap{{position:absolute;inset:0;padding:48px 50px 44px;display:flex;flex-direction:column}}
.main{{flex:1;min-height:0;display:flex;gap:34px}}

/* LEFT */
.left{{flex:1 1 0;min-width:0;display:flex;flex-direction:column}}
.lock{{display:flex;align-items:center;gap:16px;margin-bottom:30px}}
.lock img{{width:74px;height:74px;border-radius:18px;box-shadow:0 6px 22px rgba(0,0,0,.5),0 0 0 1px rgba(212,175,55,.3)}}
.wm{{font-family:'Cinzel',serif;line-height:1.06}}
.wm .a{{font-weight:600;font-size:30px;letter-spacing:3px;color:#EBD9A8}}
.wm .b{{font-weight:400;font-size:17px;letter-spacing:8px;color:#B79A55}}

.eyebrow{{font-family:'Cinzel',serif;font-size:18px;letter-spacing:5px;color:#D4AF37;
  display:flex;align-items:center;gap:12px;margin-bottom:16px}}
.eyebrow::before{{content:"";width:36px;height:1.5px;background:linear-gradient(90deg,#D4AF37,transparent)}}
h1{{font-weight:600;font-size:62px;line-height:1.08;letter-spacing:.2px;margin-bottom:22px;
  background:linear-gradient(120deg,#F4E4BA 0%,#D4AF37 45%,#B8860B 100%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  filter:drop-shadow(0 2px 14px rgba(212,175,55,.18))}}
.block{{margin:auto 0;display:flex;flex-direction:column}}
.sub{{font-weight:400;font-size:23px;line-height:1.5;color:#B6A491;max-width:540px}}
.sub b{{color:#E2D3B6;font-weight:600}}
.divider{{width:132px;height:2px;background:linear-gradient(90deg,#D4AF37,rgba(212,175,55,0));margin:28px 0 30px}}
.feats{{display:flex;flex-direction:column;gap:22px}}
.frow{{display:flex;align-items:center;gap:18px}}
.ftile{{flex:0 0 60px;width:60px;height:60px;border-radius:15px;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(150deg,#2c1512,#160a0c);border:1px solid rgba(212,175,55,.34);
  box-shadow:inset 0 1px 8px rgba(212,175,55,.08),0 4px 14px rgba(0,0,0,.4)}}
.ftile svg{{width:30px;height:30px}}
.ftxt .t{{font-weight:600;font-size:26px;color:#F0E6D2;line-height:1.2}}
.ftxt .d{{font-weight:400;font-size:18px;color:#9C8B78;line-height:1.32;margin-top:2px}}
.ftxt .d .en{{color:#C2B188;font-weight:500}}

/* RIGHT — tilted phone */
.right{{flex:0 0 408px;position:relative;display:flex;align-items:center;justify-content:center}}
.glow{{position:absolute;width:430px;height:560px;border-radius:46%;
  background:radial-gradient(circle,rgba(212,175,55,.26),transparent 64%);
  top:48%;left:52%;transform:translate(-50%,-50%);filter:blur(10px)}}
.pwrap{{perspective:1700px}}
.phone{{position:relative;width:402px;border-radius:44px;padding:11px;
  background:linear-gradient(150deg,#41202a,#1a0a0e 58%);
  transform:rotateY(-11deg) rotateX(2deg) rotate(.4deg);transform-style:preserve-3d;
  box-shadow:-28px 36px 80px rgba(0,0,0,.62),0 0 0 1px rgba(212,175,55,.30),0 0 70px rgba(212,175,55,.12);}}
.phone img{{width:100%;display:block;border-radius:34px}}
.badge{{position:absolute;top:34px;left:-6px;z-index:5;font-weight:700;font-size:20px;color:#1a0a0e;
  background:linear-gradient(135deg,#F4E4BA,#D4AF37);padding:12px 20px;border-radius:42px;
  box-shadow:0 10px 30px rgba(212,175,55,.5);transform:rotate(-3deg);display:flex;align-items:center;gap:7px}}

/* CTA bar */
.ctabar{{flex:0 0 auto;margin-top:30px;display:flex;align-items:center;gap:26px;
  background:linear-gradient(120deg,#1c0c0f,#2a1114 55%,#1a0a0e);
  border:1px solid rgba(212,175,55,.32);border-radius:26px;padding:22px 34px;
  box-shadow:0 12px 40px rgba(0,0,0,.45),inset 0 1px 0 rgba(212,175,55,.08)}}
.gbtn{{flex:0 0 70px;width:70px;height:70px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(circle at 35% 30%,#2c1512,#150709);border:1px solid rgba(212,175,55,.4)}}
.gbtn svg{{width:38px;height:38px}}
.ctatext{{flex:1;min-width:0}}
.ctatext .pre{{font-family:'Cinzel',serif;font-weight:500;font-size:22px;letter-spacing:2px;color:#D4AF37;margin-bottom:2px}}
.ctatext .dom{{font-weight:700;font-size:44px;line-height:1;letter-spacing:.3px;
  background:linear-gradient(120deg,#F4E4BA,#D4AF37 55%,#B8860B);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}}
.ctatext .tl{{font-weight:300;font-size:18px;color:#8E7E6C;margin-top:6px}}
.disc{{position:absolute;left:50px;bottom:14px;font-weight:300;font-size:13px;color:#6f6256}}
</style></head><body>
<div class="streak"></div><div class="frame"></div>
<div class="wrap">
  <div class="main">
    <div class="left">
      <div class="lock">
        <img src="data:image/png;base64,{owl}" alt="">
        <div class="wm"><div class="a">JPTRUST</div><div class="b">LEARNING</div></div>
      </div>

      <div class="block">
      <div class="eyebrow">PROVEN PERFORMANCE</div>
      <h1>กลยุทธ์ที่พิสูจน์แล้ว<br>ไม่ใช่แค่คำพูด</h1>
      <div class="sub">ผลทดสอบย้อนหลัง <b>10 ปีเต็ม</b> เทียบกับ S&amp;P 500 โปร่งใส ปีต่อปี — เปิดดูเองได้ทุกตัวเลข</div>
      <div class="divider"></div>

      <div class="feats">
        <div class="frow"><div class="ftile">{ic_bars}</div><div class="ftxt"><div class="t">เทียบกับ S&amp;P 500 รายปี</div><div class="d">เห็นผลตอบแทนปีต่อปี ชนะดัชนีชัดเจน</div></div></div>
        <div class="frow"><div class="ftile">{ic_hist}</div><div class="ftxt"><div class="t"><span class="en">Backtest</span> ย้อนหลัง 10+ ปี</div><div class="d">ทดสอบกลยุทธ์กับข้อมูลจริง</div></div></div>
        <div class="frow"><div class="ftile">{ic_line}</div><div class="ftxt"><div class="t">วิเคราะห์เชิงลึกครบ</div><div class="d"><span class="en">Equity Curve · Drawdown</span> · สถิติ</div></div></div>
        <div class="frow"><div class="ftile">{ic_shield}</div><div class="ftxt"><div class="t">โปร่งใส ตรวจสอบได้</div><div class="d">เปิดดูทุกตัวเลข ไม่ขายฝัน</div></div></div>
      </div>
      </div>
    </div>

    <div class="right">
      <div class="glow"></div>
      <div class="badge">★ ชนะดัชนีเกือบทุกปี</div>
      <div class="pwrap">
        <div class="phone"><img src="data:image/jpeg;base64,{screen}" alt="VS S&P 500"></div>
      </div>
    </div>
  </div>

  <div class="ctabar">
    <div class="gbtn">{ic_globe}</div>
    <div class="ctatext">
      <div class="pre">SUBSCRIBE AT</div>
      <div class="dom">jptrustlearning.com</div>
      <div class="tl">เริ่มต้นเส้นทางการลงทุนอย่างมีระบบไปกับเรา</div>
    </div>
  </div>
  <div class="disc">* ผล Backtest เป็นการทดสอบย้อนหลัง ไม่ใช่การรับประกันผลตอบแทนในอนาคต · การลงทุนมีความเสี่ยง</div>
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
