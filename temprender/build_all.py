#!/usr/bin/env python3
# JPTrust ad render — master builder for all 4 parts (same premium black/gold template)
# Run:  python3 build_all.py            (renders ad1..ad4 .html + .png)
#       python3 build_all.py --no-render
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
FONTCSS="\n".join(faces)
OWL=b64(HERE/"owl.png")
G="#D4AF37"
def svg(inner): return f'<svg viewBox="0 0 24 24" fill="none" stroke="{G}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{inner}</svg>'
ICON={
 "bars":svg('<line x1="4" y1="20" x2="4" y2="11"/><line x1="10" y1="20" x2="10" y2="4"/><line x1="16" y1="20" x2="16" y2="14"/><line x1="20" y1="20" x2="20" y2="8"/>'),
 "hist":svg('<path d="M3 4v5h5"/><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3 9"/><path d="M12 8v4.5l3 1.7"/>'),
 "line":svg('<polyline points="3 16 9 10 13 14 21 5"/><polyline points="15 5 21 5 21 11"/>'),
 "shield":svg('<path d="M12 3l7 3v6c0 4.6-3.1 7.8-7 9-3.9-1.2-7-4.4-7-9V6z"/><polyline points="9 12 11 14 15 10"/>'),
 "map":svg('<polygon points="3 6 9 4 15 6 21 4 21 18 15 20 9 18 3 20"/><line x1="9" y1="4" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="20"/>'),
 "wallet":svg('<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.3"/>'),
 "pie":svg('<path d="M12 12 L12 3 A9 9 0 0 1 21 12 Z"/><circle cx="12" cy="12" r="9"/>'),
 "target":svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>'),
 "flask":svg('<path d="M9 3h6"/><path d="M10 3v5.5L5.2 17.5A2 2 0 0 0 7 20.5h10a2 2 0 0 0 1.8-3L14 8.5V3"/><path d="M8 15h8"/>'),
 "refresh":svg('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8"/><polyline points="20 3 20 8 15 8"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 16"/><polyline points="4 21 4 16 9 16"/>'),
 "log":svg('<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.1"/><circle cx="4.5" cy="12" r="1.1"/><circle cx="4.5" cy="18" r="1.1"/>'),
 "scan":svg('<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>'),
 "news":svg('<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 8h3v9a2 2 0 0 1-2 2h-1"/><line x1="7" y1="9" x2="14" y2="9"/><line x1="7" y1="13" x2="14" y2="13"/><line x1="7" y1="17" x2="11" y2="17"/>'),
 "tone":svg('<polyline points="3 9 7 5 11 9"/><line x1="7" y1="5" x2="7" y2="13"/><polyline points="13 15 17 19 21 15"/><line x1="17" y1="11" x2="17" y2="19"/>'),
 "tag":svg('<path d="M3.5 12.5l8-8a2 2 0 0 1 1.4-.6H19a1.5 1.5 0 0 1 1.5 1.5v6.1a2 2 0 0 1-.6 1.4l-8 8a2 2 0 0 1-2.8 0l-5.6-5.6a2 2 0 0 1 0-2.8z"/><circle cx="16" cy="8" r="1.4"/>'),
 "pulse":svg('<polyline points="3 12 7 12 9.5 5 14.5 19 17 12 21 12"/>'),
 "globe":f'<svg viewBox="0 0 24 24" fill="none" stroke="{G}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.2"/><line x1="2.8" y1="12" x2="21.2" y2="12"/><path d="M12 2.8c2.6 2.5 4 5.8 4 9.2s-1.4 6.7-4 9.2c-2.6-2.5-4-5.8-4-9.2s1.4-6.7 4-9.2z"/></svg>',
}

CSS = f"""
{FONTCSS}
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
.wrap{{position:absolute;inset:0;padding:48px 46px 44px;display:flex;flex-direction:column}}
.main{{flex:1;min-height:0;display:flex;gap:24px}}
.left{{flex:1 1 0;min-width:0;display:flex;flex-direction:column}}
.lock{{display:flex;align-items:center;gap:16px;margin-bottom:30px}}
.lock img{{width:74px;height:74px;border-radius:18px;box-shadow:0 6px 22px rgba(0,0,0,.5),0 0 0 1px rgba(212,175,55,.3)}}
.wm{{font-family:'Cinzel',serif;line-height:1.06}}
.wm .a{{font-weight:600;font-size:30px;letter-spacing:3px;color:#EBD9A8}}
.wm .b{{font-weight:400;font-size:17px;letter-spacing:8px;color:#B79A55}}
.eyebrow{{font-family:'Cinzel',serif;font-size:18px;letter-spacing:5px;color:#D4AF37;
  display:flex;align-items:center;gap:12px;margin-bottom:16px}}
.eyebrow::before{{content:"";width:36px;height:1.5px;background:linear-gradient(90deg,#D4AF37,transparent)}}
h1{{font-weight:600;font-size:52px;line-height:1.08;letter-spacing:.2px;margin-bottom:18px;
  background:linear-gradient(120deg,#F4E4BA 0%,#D4AF37 45%,#B8860B 100%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  filter:drop-shadow(0 2px 14px rgba(212,175,55,.18))}}
.block{{margin:auto 0;display:flex;flex-direction:column}}
.sub{{font-weight:400;font-size:21px;line-height:1.5;color:#B6A491;max-width:480px}}
.sub b{{color:#E2D3B6;font-weight:600}}
.divider{{width:120px;height:2px;background:linear-gradient(90deg,#D4AF37,rgba(212,175,55,0));margin:22px 0 26px}}
.feats{{display:flex;flex-direction:column;gap:26px}}
.frow{{display:flex;align-items:center;gap:20px}}
.ftile{{flex:0 0 72px;width:72px;height:72px;border-radius:18px;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(150deg,#2c1512,#160a0c);border:1px solid rgba(212,175,55,.34);
  box-shadow:inset 0 1px 8px rgba(212,175,55,.08),0 4px 14px rgba(0,0,0,.4)}}
.ftile svg{{width:36px;height:36px}}
.ftxt .t{{font-weight:600;font-size:40px;color:#F0E6D2;line-height:1.16}}
.ftxt .d{{font-weight:400;font-size:23px;color:#9C8B78;line-height:1.3;margin-top:3px}}
.ftxt .d .en,.ftxt .t .en{{color:#C2B188;font-weight:500}}
.right{{flex:0 0 482px;position:relative;display:flex;align-items:center;justify-content:center}}
.glow{{position:absolute;width:520px;height:660px;border-radius:46%;
  background:radial-gradient(circle,rgba(212,175,55,.26),transparent 64%);
  top:48%;left:52%;transform:translate(-50%,-50%);filter:blur(12px)}}
.pwrap{{perspective:2000px}}
.phone{{position:relative;width:478px;border-radius:50px;padding:12px;
  background:linear-gradient(150deg,#41202a,#1a0a0e 58%);
  transform:rotateY(-11deg) rotateX(2deg) rotate(.4deg);transform-style:preserve-3d;
  box-shadow:-32px 40px 90px rgba(0,0,0,.62),0 0 0 1px rgba(212,175,55,.30),0 0 80px rgba(212,175,55,.13);}}
.phone img{{width:100%;display:block;border-radius:40px}}
.badge{{position:absolute;top:34px;left:-6px;z-index:5;font-weight:700;font-size:20px;color:#1a0a0e;
  background:linear-gradient(135deg,#F4E4BA,#D4AF37);padding:12px 20px;border-radius:42px;
  box-shadow:0 10px 30px rgba(212,175,55,.5);transform:rotate(-3deg);display:flex;align-items:center;gap:7px}}
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
"""

# Cream / iridescent-gold variant — reuse layout, override colours.
# Feature tiles, phone bezel, badge and CTA bar stay dark for contrast on cream.
CSS_CREAM = CSS + """
body{
  background:
    radial-gradient(ellipse 55% 42% at 16% 16%, rgba(212,175,55,.20) 0%, transparent 55%),
    radial-gradient(ellipse 50% 40% at 86% 84%, rgba(184,134,11,.18) 0%, transparent 55%),
    radial-gradient(ellipse 65% 55% at 82% 10%, rgba(255,252,242,.6) 0%, transparent 52%),
    linear-gradient(118deg, transparent 32%, rgba(212,175,55,.08) 46%, rgba(255,243,210,.24) 50%, rgba(212,175,55,.08) 54%, transparent 68%),
    linear-gradient(155deg,#FFFDF6 0%,#FAF6ED 28%,#F3E8CF 54%,#FBF7EE 78%,#F5EEDB 100%);}
.streak{opacity:.5;background-image:
    radial-gradient(1.3px 1.3px at 18% 26%, rgba(184,134,11,.40), transparent),
    radial-gradient(1.2px 1.2px at 74% 16%, rgba(212,175,55,.40), transparent),
    radial-gradient(1.2px 1.2px at 60% 42%, rgba(184,134,11,.32), transparent),
    radial-gradient(1.2px 1.2px at 33% 72%, rgba(212,175,55,.30), transparent),
    radial-gradient(1.1px 1.1px at 90% 66%, rgba(184,134,11,.32), transparent);}
.frame{border-color:rgba(184,134,11,.28)}
.wm .a{color:#5A3D20}
.wm .b{color:#8B6914}
.eyebrow{color:#B8860B}
.eyebrow::before{background:linear-gradient(90deg,#B8860B,transparent)}
h1{background-image:linear-gradient(120deg,#B8860B 0%,#8B6914 42%,#722F37 100%);
   -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
   filter:drop-shadow(0 2px 10px rgba(184,134,11,.18))}
.sub{color:#7A6F62}
.sub b{color:#5A3D20}
.divider{background:linear-gradient(90deg,#B8860B,rgba(184,134,11,0))}
.ftxt .t{color:#3D3228}
.ftxt .d{color:#8A7B68}
.ftxt .d .en,.ftxt .t .en{color:#8B6914}
.disc{color:#9A8B72}
"""

def feats_html(feats):
    rows=[]
    for ic,t,d in feats:
        rows.append(f'<div class="frow"><div class="ftile">{ICON[ic]}</div>'
                    f'<div class="ftxt"><div class="t">{t}</div><div class="d">{d}</div></div></div>')
    return "\n        ".join(rows)

def page(cfg):
    screen=b64(HERE/cfg["screen"])
    css = CSS_CREAM if cfg.get("theme")=="cream" else CSS
    return f"""<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><style>{css}</style></head><body>
<div class="streak"></div><div class="frame"></div>
<div class="wrap">
  <div class="main">
    <div class="left">
      <div class="lock"><img src="data:image/png;base64,{OWL}" alt=""><div class="wm"><div class="a">JPTRUST</div><div class="b">LEARNING</div></div></div>
      <div class="block">
      <div class="eyebrow">{cfg["eyebrow"]}</div>
      <h1>{cfg["headline"]}</h1>
      <div class="sub">{cfg["sub"]}</div>
      <div class="divider"></div>
      <div class="feats">
        {feats_html(cfg["feats"])}
      </div>
      </div>
    </div>
    <div class="right">
      <div class="glow"></div>
      <div class="badge">{cfg["badge"]}</div>
      <div class="pwrap"><div class="phone"><img src="data:image/jpeg;base64,{screen}" alt=""></div></div>
    </div>
  </div>
  <div class="ctabar">
    <div class="gbtn">{ICON["globe"]}</div>
    <div class="ctatext"><div class="pre">SUBSCRIBE AT</div><div class="dom">jptrustlearning.com</div>
      <div class="tl">เริ่มต้นเส้นทางการลงทุนอย่างมีระบบไปกับเรา</div></div>
  </div>
  <div class="disc">{cfg["disc"]}</div>
</div></body></html>"""

DISC_GEN="* การลงทุนมีความเสี่ยง · เนื้อหาเพื่อการศึกษา ไม่ใช่คำแนะนำการลงทุน · ผลในอดีตไม่ใช่การการันตีผลในอนาคต"

CONFIGS={
 "ad1":{
   "screen":"screen_vs.jpg","badge":"★ ชนะดัชนีเกือบทุกปี","eyebrow":"PROVEN PERFORMANCE",
   "headline":"กลยุทธ์ที่พิสูจน์แล้ว<br>ไม่ใช่แค่คำพูด",
   "sub":"ผลทดสอบย้อนหลัง <b>30 ปีเต็ม</b> เทียบกับ S&amp;P 500 โปร่งใส ปีต่อปี — เปิดดูเองได้ทุกตัวเลข",
   "disc":"* ผล Backtest เป็นการทดสอบย้อนหลัง ไม่ใช่การรับประกันผลตอบแทนในอนาคต · การลงทุนมีความเสี่ยง",
   "feats":[("bars","เทียบ S&amp;P 500 รายปี","เห็นผลตอบแทนปีต่อปี ชนะดัชนีชัดเจน"),
            ("hist",'<span class="en">Backtest</span> 30 ปี',"ทดสอบกลยุทธ์กับข้อมูลจริงย้อนหลัง"),
            ("line","วิเคราะห์เชิงลึก",'<span class="en">Equity · Drawdown</span> · สถิติ'),
            ("shield","โปร่งใส ตรวจสอบได้","เปิดดูทุกตัวเลข ไม่ขายฝัน")],
 },
 "ad2":{
   "screen":"screen_roadmap.jpg","badge":"★ เริ่มได้ทันที","eyebrow":"90-DAY ROADMAP",
   "headline":"มือใหม่ก็เริ่มได้<br>มีแผนให้ทีละก้าว",
   "sub":"ไม่รู้จะเริ่มตรงไหน? JPTrust วาง <b>Roadmap 90 วัน</b> ให้เดินตาม พร้อมเครื่องมือวางแผนครบในแอปเดียว",
   "disc":DISC_GEN,
   "feats":[("map",'<span class="en">Roadmap</span> 90 วัน',"แบ่งเป็นรอบ ทำตามได้จริงทีละก้าว"),
            ("wallet","วางแผนการเงิน","รายรับ · รายจ่าย · เงินสำรอง · เป้าหมาย"),
            ("pie","จัดพอร์ตลงทุน",'<span class="en">Asset Allocation · Rebalancing</span>'),
            ("target","ติดตามความคืบหน้า","เห็นพัฒนาการรายวัน วัดผลได้")],
 },
 "ad3":{
   "screen":"screen_lab.jpg","badge":"★ อัปเดตทุกวัน","eyebrow":"STRATEGY LAB",
   "headline":"ทดสอบกลยุทธ์ลงทุน<br>ระดับมือโปร",
   "sub":"Dashboard ใช้งานจริง ไม่ต้องนั่งคำนวณเอง ไม่ต้องจ้างที่ปรึกษาแพง — การวิเคราะห์ระดับสถาบันที่คุณเข้าถึงได้",
   "disc":DISC_GEN,
   "feats":[("flask","หลากหลายกลยุทธ์",'<span class="en">Weekly · 6M · Rolling</span> + <span class="en">Gold</span>'),
            ("refresh","อัปเดตทุกวัน","Dashboard พร้อมใช้ ไม่ต้องคำนวณเอง"),
            ("log","วิเคราะห์ครบทุกมุม",'<span class="en">Trade Log · Yearly · Heatmap</span>'),
            ("scan",'<span class="en">Scanner</span> คัดหุ้น','ตามสัญญาณ <span class="en">Momentum</span> อัตโนมัติ')],
 },
 "ad4":{
   "screen":"screen_news.jpg","badge":"★ เช้า-บ่าย-เย็น","eyebrow":"DAILY DISPATCHES",
   "headline":"อ่านตลาดให้ขาด<br>ทุกเช้า-บ่าย-เย็น",
   "sub":"ข่าวกรองการลงทุนรายวัน คัดจาก <b>Wall Street</b> สรุปเป็นไทย — ไม่ใช่แค่รายงานข่าว แต่บอกว่ากระทบพอร์ตคุณยังไง วิเคราะห์ทั้งโอกาสและปัจจัยเสี่ยง",
   "disc":DISC_GEN,
   "feats":[("news","ข่าวกรองรายวัน","อัปเดตทุกเช้า-บ่าย-เย็น"),
            ("tone",'โทน <span class="en">Bull / Bear</span>',"รู้ทันทีว่าข่าวบวกหรือลบ"),
            ("globe",'คัดจาก <span class="en">Wall Street</span>',"สรุปเป็นไทย ในภาษาที่เข้าใจ"),
            ("tag","บอกผลต่อพอร์ต","แท็กหุ้นที่เกี่ยวข้องในแต่ละข่าว")],
 },
 "ad5":{
   "screen":"screen_home.jpg","badge":"★ ครบในที่เดียว","eyebrow":"ALL-IN-ONE PLATFORM",
   "headline":"ทุกเครื่องมือลงทุน<br>ครบในแอปเดียว",
   "sub":"JP Trust Learning เปลี่ยน<b>งานวิจัย</b>ให้เป็นระบบใช้งานจริง — กลยุทธ์ · ข้อมูล · แผน ครบ จบ ในที่เดียว",
   "disc":DISC_GEN,
   "feats":[("flask","กลยุทธ์ + Dashboard","Momentum หลายแบบ + ทองคำ"),
            ("pulse","ราคาตลาด Live",'หุ้น · ทองคำ · คริปโต เรียลไทม์'),
            ("pie","วางแผน + จัดพอร์ต",'การเงินส่วนตัว · <span class="en">Asset Allocation</span>'),
            ("map","Roadmap + ข่าว","แผน 90 วัน + ข่าวกรองรายวัน")],
 },
 "ad5_cream":{
   "theme":"cream",
   "screen":"screen_home.jpg","badge":"★ ครบในที่เดียว","eyebrow":"ALL-IN-ONE PLATFORM",
   "headline":"ทุกเครื่องมือลงทุน<br>ครบในแอปเดียว",
   "sub":"JP Trust Learning เปลี่ยน<b>งานวิจัย</b>ให้เป็นระบบใช้งานจริง — กลยุทธ์ · ข้อมูล · แผน ครบ จบ ในที่เดียว",
   "disc":DISC_GEN,
   "feats":[("flask","กลยุทธ์ + Dashboard","Momentum หลายแบบ + ทองคำ"),
            ("pulse","ราคาตลาด Live",'หุ้น · ทองคำ · คริปโต เรียลไทม์'),
            ("pie","วางแผน + จัดพอร์ต",'การเงินส่วนตัว · <span class="en">Asset Allocation</span>'),
            ("map","Roadmap + ข่าว","แผน 90 วัน + ข่าวกรองรายวัน")],
 },
 "ad6":{
   "screen":"screen_gold.jpg","badge":"★ วัดแรงซื้อ-ขาย","eyebrow":"GOLD SENTIMENT LAB",
   "headline":"จับโมเมนตัมทองคำ<br>Bull หรือ Bear",
   "sub":"<b>Gold Sentiment Lab</b> วัดแรงซื้อ-แรงขายในตลาดทองคำแบบเรียลไทม์ — รู้ว่าตลาดเอนไป Bull หรือ Bear ด้วยค่า Net Bias",
   "disc":DISC_GEN,
   "feats":[("pulse","ราคาทองคำ Live",'<span class="en">XAU/USD</span> อัปเดตเรียลไทม์'),
            ("tone",'<span class="en">Net Bias</span> ทองคำ',"ชี้ชัด Bull / Bear เป็นตัวเลข"),
            ("target","สัญญาณ Sentiment","จับจุดแรงซื้อ-ขายอิ่มตัว"),
            ("refresh","อัปเดตทุกวัน","ข้อมูล Sentiment สดใหม่ทุกวัน")],
 },
}

def main():
    do_render = "--no-render" not in sys.argv
    for name,cfg in CONFIGS.items():
        (HERE/f"{name}.html").write_text(page(cfg),encoding="utf-8")
        print("wrote",name+".html")
    if not do_render: return
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b=p.chromium.launch()
        for name in CONFIGS:
            pg=b.new_page(viewport={"width":1080,"height":1350},device_scale_factor=2)
            pg.goto((HERE/f"{name}.html").as_uri()); pg.wait_for_timeout(500)
            pg.screenshot(path=str(HERE/f"{name}.png"),clip={"x":0,"y":0,"width":1080,"height":1350})
            pg.close()
            print("rendered",name+".png")
        b.close()

if __name__=="__main__":
    main()
