# 📰 คู่มือการอัพเดทข่าวในแอพ JP Trust Learning

> คู่มือนี้ใช้สำหรับให้ Claude ช่วยอัพเดทข่าวใน Member Dashboard PWA โดยครอบคลุมตั้งแต่ปรัชญาพื้นฐาน, วิธีเข้าถึง repo, โครงสร้างไฟล์, รูปแบบการเขียน, โทนการสังเคราะห์, หลักการวิเคราะห์ sentiment, และ workflow การ commit + push

**อัพเดทล่าสุด:** 21 เมษายน 2026 (เพิ่ม §0 ปรัชญาพื้นฐาน)
**ใช้กับ:** jptrustlearning/pages → news system

---

## 🎯 0. ปรัชญาพื้นฐาน — สังเคราะห์ ไม่ใช่แปล

**หลักคิดที่สำคัญที่สุดของระบบนี้**

ระบบอัพเดทข่าวไม่ใช่การ **แปลข่าวตรงๆ** แต่เป็นการ **สังเคราะห์ + วิเคราะห์เพิ่ม + จัดโครงสร้างใหม่** ตามมาตรฐาน Private Banking ของไทย — เหมือน Investment Analyst ของธนาคารที่อ่านข่าวเช้านี้ 5-10 แหล่ง แล้วเขียนบทวิเคราะห์ส่งให้ลูกค้า ไม่ใช่ Translator ที่แปลบทความทีละประโยค

### ❌ สิ่งที่ระบบไม่ทำ

- **ไม่แปลทีละประโยค** — ไม่หยิบบทความต้นฉบับมาแปลเป็นไทยโดยตรง
- **ไม่คัดลอกโครงสร้างของข่าวต้นทาง** — ไม่เรียงตามลำดับย่อหน้าเดิม
- **ไม่ใช้หัวข้อย่อย (subheadings) ของแหล่งข่าวเดิม** — ต้องจัดใหม่เป็น Bank-Style 3-Layer
- **ไม่พึ่งข่าวเดียว** — ถ้าข้อมูลมาจากแหล่งเดียว ถือเป็นสัญญาณว่าต้องหาแหล่งเพิ่ม
- **ไม่ใช้ภาษาข่าวสหรัฐฯ แบบดิบๆ** — เช่น "premarket soared" → ต้องอธิบายด้วยภาษาไทยที่ลูกค้าเข้าใจทันที

### ✅ สิ่งที่ระบบทำจริง

#### 1. Cross-Reference หลายแหล่ง (ขั้นต่ำ 3 แหล่ง)
- อ่านข่าวเดียวกันจาก 3-5 แหล่งที่น่าเชื่อถือ (CNBC, CNN, Bloomberg, Reuters, Yahoo Finance, CNBC, WSJ ฯลฯ)
- เปรียบเทียบตัวเลข quote เหตุการณ์ ถ้าข้อมูลขัดแย้งให้ตรวจสอบเพิ่มเติม
- สังเคราะห์เป็นเรื่องเดียวที่ไม่ตรงกับสำนักข่าวไหนเป๊ะๆ — เป็น **ผลผลิตใหม่**

#### 2. จัดโครงสร้างใหม่เป็น Bank-Style 3-Layer (บังคับ)
ทุกหัวข้อต้องบีบเข้าโครงสร้างเดียวกัน ไม่ว่าต้นทางจะเขียนแบบไหน:
- Lead paragraph (ย่อหน้านำ)
- ตัวเลขสำคัญ / ลำดับเหตุการณ์
- ปัจจัยที่ขับเคลื่อน
- ผลกระทบเชิงโครงสร้าง
- ความเสี่ยงที่ต้องระวัง
- **ผลกระทบต่อนักลงทุนไทย / สำหรับนักลงทุนไทย** ← ส่วนสำคัญที่สุด
- ปัจจัยที่ต้องติดตาม

#### 3. วิเคราะห์เพิ่มเติมที่ไม่มีในแหล่งต้นทาง

นี่คือ **ส่วนที่เพิ่มมูลค่ามากที่สุด** ของระบบ — เรื่องที่ข่าวอเมริกันไม่เคยครอบคลุม

**A. เชื่อมโยงกลับประเทศไทย**
- ดอลลาร์ขึ้น/ลง → เงินบาทได้ผลอย่างไร → กลุ่มหุ้นไทยไหนได้ประโยชน์/เสียประโยชน์
- Fed ลด/คงดอกเบี้ย → เงินทุนไหลเข้า/ออก SET
- น้ำมันขึ้น → PTT/PTTEP/BCP/TOP ได้ประโยชน์, AOT/CPALL/TU เสียประโยชน์
- ท่องเที่ยวฟื้น → AOT/ERW/MINT/CENTEL
- AI demand → DELTA/KCE/HANA

**B. ช่องทางลงทุนสำหรับนักลงทุนไทย**
- DR (Depositary Receipt) — AAPL80X, NVDA80X, SPY80X, TSLA80X
- ETF ไทย — MEGA7, GLOBAL, ASP-VIET
- กองทุน FIF (Foreign Investment Fund) — KT-US, SCBS&P500, TMBUS
- โบรกเกอร์ต่างประเทศ — Interactive Brokers, TD Ameritrade (มีภาระการส่งเงินออก)

**C. ภาษีที่ต้องระวัง**
- Withholding Tax (ภาษีหัก ณ ที่จ่าย) 30% บนเงินปันผลหุ้นสหรัฐฯ → ลดเหลือ 15% ด้วยแบบ W-8BEN
- กำไรจากขายหุ้นต่างประเทศ 15% เมื่อนำเงินกลับเข้าไทย (กฎหมายภาษีใหม่ ม.ค. 2024)
- DR ในตลาดไทยไม่ต้องเสีย Capital Gains Tax (กำไรจากการขาย)
- เงินปันผลหุ้นไทย ถูกหักภาษี 10% ที่ต้นทาง

**D. ประเมินสถานการณ์ด้วย % ของตนเอง**
- เช่น Bull Case 40% / Base Case 45% / Bear Case 15%
- ตัวเลขเหล่านี้ **เราประเมินเอง** ไม่ได้มาจากแหล่งข่าว
- เป็นเครื่องมือช่วยลูกค้าจัดการ position sizing และ risk

**E. Framework พิเศษที่สวนกับความเชื่อทั่วไป**
- **Gold/Energy War Logic** — สงครามที่เกี่ยวน้ำมัน (Iran 2026) = ทองลง ไม่ใช่ทองขึ้น เพราะน้ำมันแพง → เงินเฟ้อสูง → Fed ลดดอกเบี้ยไม่ได้ → ดอลลาร์แข็ง + Yield สูง → ทองไม่ดึงดูด (ไม่มี Yield)
- Framework นี้สวนกับภาพ "สงคราม = Safe Haven = ทองขึ้น" ที่นักข่าวทั่วไปเขียน
- ดูรายละเอียดใน §6

#### 4. ปรับโทนให้เป็นภาษาไทยอธิบายได้
- ศัพท์เทคนิคใส่วงเล็บไทยครั้งแรก: `Withholding Tax (ภาษีหัก ณ ที่จ่าย)`, `FSD (ระบบขับเคลื่อนอัตโนมัติเต็มรูปแบบ)`, `Beta 2.0 (เคลื่อนไหวแรงกว่าตลาด 2 เท่า)`
- เลี่ยงวลีอังกฤษหนักๆ ที่ลูกค้าต้องแปลเอง (ดูรายละเอียด §5)

#### 5. กรอง Sentiment ตาม Context เฉพาะ
- Ticker เดียวกันอาจ positive หรือ negative ตามบริบท
- GLD ในสงครามทั่วไป = positive, แต่ในสงครามน้ำมัน = negative
- UNH Q1 Beat + Raise Guidance = ทั้ง sector positive, แต่ถ้า Beat + Cut Guidance = neutral
- ใช้ framework ใน §6 เป็นหลัก

### 📊 เปรียบเทียบเชิงตัวเลข

| ด้าน | ข่าวต้นทาง (CNBC/Bloomberg) | Batch JP Trust |
|------|----------------------------|----------------|
| ความยาว | 800-1,500 คำ | 1,500-3,000 คำ |
| โฟกัส | US-centric | Thai investor angle |
| ส่วนที่เพิ่ม | — | SET impact, ค่าบาท, DR, ภาษี, หุ้นไทยเกี่ยวเนื่อง, สถานการณ์ % |
| โครงสร้าง | Free-form journalism | Bank-Style 3-Layer บังคับ |
| แหล่งข่าว | 1 สำนักงาน | 3-5 สำนักงาน cross-reference |
| Audience | Retail readers ทั่วไป | Private Banking clients (Thai) |

### 🎯 ตัวอย่างการเพิ่มมูลค่า — ข่าว "Warsh ให้การต่อวุฒิสภา" (21 เม.ย. 2026)

**CNBC/CNN เขียน (ต้นทาง):** เน้น Fed independence, Tillis blocking, Warren vs Warsh, AI disinflation thesis — ประมาณ 1,500 คำ โฟกัสการเมืองสหรัฐฯ

**Batch 23:30 ของเราเพิ่ม (ไม่มีในต้นทางเลย):**
- ถ้า Warsh ลดดอกเบี้ยสำเร็จ → ดอลลาร์อ่อน → บาทแข็ง → SET Foreign Inflow เพิ่ม
- หุ้นไทยที่ได้ประโยชน์: AOT, ERW, MINT, KBANK, SCB, EGCO, GULF
- หุ้นไทยที่เสียประโยชน์: DELTA, CPALL, TU (กลุ่มส่งออก)
- ทอง (GLD) — ดอกเบี้ยต่ำดีต่อทอง แต่ Iran war offset (energy war logic)
- พันธบัตรสหรัฐฯ (TLT) — ได้ประโยชน์ถ้าตลาดเชื่อ rate cut จะมา

**สรุป:** ส่วน **"สำหรับนักลงทุนไทย"** คือส่วนที่แหล่งข่าวต้นทางไม่มีเลย และเป็นเหตุผลหลักที่ลูกค้า JP Trust เปิดอ่าน batch นี้แทนไปอ่าน CNBC โดยตรง

### ⚡ Checklist ก่อนเริ่มเขียน Batch

- [ ] อ่านข่าวจากอย่างน้อย 3 แหล่งแล้ว
- [ ] แต่ละ headline จะเพิ่มอะไรบ้างที่ไม่มีในต้นทาง
- [ ] ผลกระทบต่อเงินบาทอย่างไร (ถ้าเกี่ยวข้อง)
- [ ] หุ้นไทยที่เกาะธีมนี้มีอะไรบ้าง
- [ ] ช่องทางลงทุนสำหรับคนไทย (DR, FIF, ฯลฯ)
- [ ] ภาษีที่นักลงทุนไทยต้องเจอ
- [ ] Sentiment ตรงตาม context เฉพาะ (ไม่ใช่ conventional wisdom)
- [ ] ศัพท์อังกฤษทุกคำมีวงเล็บไทยอธิบาย
- [ ] ไม่ซ้ำกับหัวข้อที่ใช้ในวันเดียวกันแล้ว (§10)

---

## 🔐 1. การเข้าถึง Repository

### Repo Info

```bash
Organization: jptrustlearning
Repo:         pages
Branch:       main
Working dir:  /home/claude/pages
```

### Personal Access Token (PAT)

```
PAT: ghp_REDACTED_SEE_LOCAL_HANDOFF
```

### Clone Command

```bash
cd /home/claude
git clone https://jptrustlearning:ghp_REDACTED_SEE_LOCAL_HANDOFF@github.com/jptrustlearning/pages.git
cd pages
git config user.email "jptrustlearning@users.noreply.github.com"
git config user.name "JP Trust Learning"
```

### Pull Latest ก่อนทำงานเสมอ

```bash
cd /home/claude/pages
git pull origin main
```

---

## 📂 2. โครงสร้างระบบข่าว

### Directory Structure

```
/home/claude/pages/
├── news/
│   ├── news-index.json                    ← Index หลัก (frontend อ่านอันนี้)
│   ├── news-index-backup-*.json           ← Backup เก็บไว้ก่อนแก้
│   │
│   ├── 2026-04-21-1530.md                 ← ไฟล์ข่าวแต่ละ batch
│   ├── 2026-04-21-2000.md
│   ├── 2026-04-21-2210.md
│   ├── 2026-04-21-2230.md
│   ├── 2026-04-21-2230-backup-english-heavy.md  ← Backup ของไฟล์เดิมก่อนแก้
│   ├── 2026-04-21-2240.md
│   │
│   └── news-backup-bank-style/            ← Folder backup ชุดเก่า
│
├── member-dashboard.html                   ← Frontend PWA (อ่าน news-index.json)
└── news-detail.html                        ← หน้าแสดงข่าวแต่ละเรื่อง
```

### Naming Convention

**Batch Files:**
```
YYYY-MM-DD-HHMM.md
```
ตัวอย่าง:
- `2026-04-21-1530.md` = 21 เม.ย. 2026 เวลา 15:30 น.
- `2026-04-21-2240.md` = 21 เม.ย. 2026 เวลา 22:40 น.

**Backup Files:**
```
YYYY-MM-DD-HHMM-backup-[reason].md
```
ตัวอย่าง:
- `2026-04-21-2230-backup-english-heavy.md` = Backup ก่อน rewrite เป็น plain Thai
- `news-index-backup-pre-21apr-evening.json` = Backup index ก่อนแก้

### URLs สำหรับ Frontend

Frontend PWA (member-dashboard + news-detail) อ่านข้อมูลจาก **Cloudflare Pages (same-origin)** — เลี่ยง raw.githubusercontent 429 บน CGNAT ไทย (แก้ 9 ก.ค. 2026, commit 98899f2):

```
Index:
https://app.jptrustlearning.com/news/news-index.json

Batch File:
https://app.jptrustlearning.com/news/2026-04-21-2240.md
```

> ⚠️ ห้ามชี้ frontend กลับไปที่ raw.githubusercontent (จะโดน 429 อีก). raw ใช้ได้เฉพาะ **verify ว่า push ขึ้น GitHub แล้ว** เท่านั้น:
> `https://raw.githubusercontent.com/jptrustlearning/pages/main/news/news-index.json`

---

## 📝 3. โครงสร้างไฟล์ Batch (.md)

### Frontmatter (YAML Header)

ทุกไฟล์ต้องมี frontmatter แบบนี้ข้างบนสุด:

```yaml
---
date: 2026-04-21T22:40:00Z
date_display: 21 เม.ย. 2026 · 22:40
tickers: [USO, XLE, PTT, PTTEP, BCP, TOP, GLD, SPY, VIX]
sources: [Fox News Digital, Bloomberg, CNN, Al Jazeera, NBC News]
---
```

| Field | คำอธิบาย | ตัวอย่าง |
|-------|----------|---------|
| `date` | ISO 8601 UTC format | `2026-04-21T22:40:00Z` |
| `date_display` | วันที่แสดงใน UI (ภาษาไทย) | `21 เม.ย. 2026 · 22:40` |
| `tickers` | หุ้น/ETF ที่เกี่ยวข้อง (Array) | `[USO, XLE, PTT]` |
| `sources` | แหล่งข่าวที่อ้างอิง | `[CNN, Bloomberg, Reuters]` |

### โครงสร้างเนื้อหา (Bank-Style 3-Layer)

ทุกหัวข้อต้องมีโครงสร้าง 3 ชั้น:

```markdown
## [Headline — หัวข้อข่าว]

[Lead paragraph — ย่อหน้านำ 2-3 ประโยค สรุปข่าว]

**ตัวเลขสำคัญ / ลำดับเหตุการณ์**

[ตัวเลข ราคา ข้อมูลเชิงปริมาณ]

**ปัจจัยที่ขับเคลื่อน**

[วิเคราะห์สาเหตุ เหตุผลเบื้องหลัง]

**ผลกระทบเชิงโครงสร้าง**

[ผลกระทบต่ออุตสาหกรรม ตลาดโดยรวม]

**ความเสี่ยงที่ต้องระวัง**

[ความเสี่ยงต่างๆ ที่อาจเกิด]

**[X สถานการณ์ที่อาจเกิด]** (ถ้ามี)

- สถานการณ์ 1 (โอกาส X%): ...
- สถานการณ์ 2 (โอกาส X%): ...

**ผลกระทบต่อนักลงทุนไทย / สำหรับนักลงทุนไทย**

[คำแนะนำเฉพาะสำหรับตลาดไทย หุ้นไทยที่เกี่ยวข้อง ค่าเงินบาท ภาษี]

**ปัจจัยที่ต้องติดตาม**

- [รายการ bullet ของ events ที่ต้องจับตา พร้อมวันที่]

---
```

### Footer (บังคับ)

```markdown
*สรุปโดย JP Trust Learning · 21 เม.ย. 2026 · 22:40*
```

---

## 🗂️ 4. โครงสร้าง news-index.json

### Schema

```json
{
  "lastUpdated": "2026-04-21T22:40:00Z",
  "batches": [
    {
      "file": "2026-04-21-2240.md",
      "date": "2026-04-21T22:40:00Z",
      "date_display": "21 เม.ย. 2026 · 22:40",
      "summary": "สรุปข่าวทั้ง batch สั้นๆ 1 บรรทัด",
      "tickers": ["USO", "XLE", "PTT"],
      "headlines": [
        {
          "title": "หัวข้อข่าว full — ข้อความยาวได้",
          "tickers": [
            {"symbol": "USO", "sentiment": "positive"},
            {"symbol": "GLD", "sentiment": "negative"}
          ],
          "source": "Fox News Digital, Bloomberg, CNN",
          "published": "21 เม.ย. 2026"
        }
      ]
    }
  ]
}
```

### Sentiment Values

| Value | สี UI | ความหมาย |
|-------|------|---------|
| `positive` | 🟢 เขียว | ขึ้น / ได้ประโยชน์ |
| `negative` | 🔴 แดง | ลง / เสียประโยชน์ |
| `neutral` | ⚪ เทา | ไม่มีทิศทางชัด / ต้องรอดู |

### การเพิ่ม Batch ใหม่

Batch ใหม่ต้องใส่ไว้ **ข้างบนสุด** ของ `batches` array (newest first):

```python
data['batches'].insert(0, new_batch)
data['lastUpdated'] = "2026-04-21T22:40:00Z"
```

---

## 🇹🇭 5. โทนการเขียน (Bank-Style Thai Analysis)

### หลักการสำคัญ

**เขียนเหมือนธนาคารส่งบทวิเคราะห์ให้ลูกค้า Private Banking** — ไม่ใช่รายงานวิจัย 50 หน้า และไม่ใช่โพสต์ Facebook

### ✅ DO — สิ่งที่ต้องทำ

1. **ใช้ภาษาไทยเป็นหลัก** — 80-90% ของเนื้อหา
2. **ศัพท์เทคนิคใส่วงเล็บอธิบายไทย** ครั้งแรก
   - ✅ `Strait of Hormuz (ช่องแคบฮอร์มุซ)`
   - ✅ `Naval Blockade (การปิดล้อมทางทะเล)`
   - ✅ `Safe Haven (สินทรัพย์ปลอดภัย)`
   - ✅ `CapEx (เงินลงทุน)`
   - ✅ `FSD (ระบบขับเคลื่อนอัตโนมัติเต็มรูปแบบ)`
   - ✅ `Beta 2.0 (เคลื่อนไหวแรงกว่าตลาด 2 เท่า)`

3. **เก็บภาษาอังกฤษไว้เฉพาะ**:
   - ชื่อบริษัท (UnitedHealth, Tesla)
   - Ticker ($UNH, $TSLA, PTT)
   - ชื่อคน (Trump, Vance, Tim Cook)
   - ชื่อสถานที่/ชื่อเฉพาะ (Washington, Islamabad)

4. **ตัวเลขและราคา** — ใช้ตัวเลขอารบิก + หน่วยไทย
   - ✅ `4,782 ดอลลาร์ต่อออนซ์`
   - ✅ `ลดลง 0.81%`
   - ✅ `1,500 ล้านดอลลาร์`

5. **Bullet points** ให้ใช้ `-` ไม่ใช่ `•` หรือ `*`

6. **อธิบายกลไกเบื้องหลัง** — ไม่ใช่แค่ "ทองลง" ต้องอธิบาย "ทำไมทองลง"

### ❌ DON'T — สิ่งที่ต้องเลี่ยง

1. **ไม่ใช้วลีภาษาอังกฤษลอยๆ ที่ลูกค้าต้องแปลเอง**:
   - ❌ "Safe Haven Premium หดตัว"
   - ❌ "Sector Rotation ไปยัง Cyclicals"
   - ❌ "Premarket พุ่ง"
   - ❌ "Fed Rate Cut Probability ลดลง"
   - ❌ "Overweight / Underweight"
   - ❌ "Bull-Bear Spread กว้าง"
   - ❌ "Earnings Beat"

2. **ไม่ใช้คำปลุกเร้าทางอารมณ์**:
   - ❌ "ทำไมถึงสำคัญ"
   - ❌ "แนวรับแนวต้านสำคัญ"
   - ❌ "พุ่งทะลุ"
   - ❌ "ดิ่งเหว"
   - ❌ "FOMO"
   - ❌ "Buy strong"

3. **ไม่ใช้ emojis ใน UI** (ยกเว้นใน summary บน index ได้เล็กน้อย)

4. **ไม่ใช้เครื่องหมายมากเกิน** — ไม่ใช้ ✨, 🔥, 💰, ⚡ ใน content

### ตัวอย่างการแปลที่ถูก

| ❌ ภาษาอังกฤษหนัก | ✅ ภาษาไทยอธิบายได้ |
|------------------|-------------------|
| Safe Haven Premium หดตัว | นักลงทุนคลายความกังวลเรื่องสงคราม |
| Fed Rate Cut Probability ลดลง | โอกาสที่ธนาคารกลางสหรัฐฯ จะลดดอกเบี้ย ลดลง |
| Medicare Advantage Cycle Pivot | วัฏจักรของธุรกิจประกันสุขภาพผู้สูงอายุกำลังพลิกกลับ |
| Implied Options Move ±5.14% | ตลาดออปชั่นคาดว่าราคาจะขยับ บวก-ลบ ประมาณ 5% |
| Beta 2.0 | เคลื่อนไหวแรงกว่าตลาดโดยรวม 2 เท่า |
| Withholding Tax 30% | ภาษีหัก ณ ที่จ่าย 30% |

---

## 🎯 6. หลักการวิเคราะห์ Sentiment

### Gold / War Logic (สำคัญมาก!)

**สงครามทั่วไป** (Russia-Ukraine, เหตุการณ์ไม่เกี่ยวน้ำมัน):
- Gold: 🟢 positive (Safe Haven)
- USD: 🟢 positive
- Stocks: 🔴 negative

**สงครามที่เกี่ยวน้ำมัน** (Iran 2026, Middle East):
- Oil (USO, XLE): 🟢 positive (Supply Shock)
- **Gold: 🔴 NEGATIVE** (ไม่ใช่ safe haven)
- USD: 🟢 positive (ดอกเบี้ยสูง)
- Stocks: 🔴 negative

**เหตุผล:** น้ำมันแพง → เงินเฟ้อสูง → Fed ลดดอกเบี้ยไม่ได้ → ดอลลาร์แข็ง + ดอกเบี้ยสูง → **ทองไม่ดึงดูด** (ไม่มี yield)

**หลักฐาน:** ทองลด 8% นับจาก Iran war เริ่ม 28 ก.พ. 2026

### Earnings Beat

เช่น UNH Q1 Beat 10% → **สังเกตบริบท sector**:
- Beat + Raise guidance = ทั้ง sector 🟢 (halo effect)
- Beat แต่ margin ลด = 🟡 neutral
- Miss + Cut guidance = 🔴 negative

### Fed Policy

- Rate Cut Expected: Bond 🟢, Gold 🟢, Stocks 🟢
- Rate Hold Longer: Bond 🔴, Gold 🔴, USD 🟢
- Rate Hike Surprise: ทุกอย่าง 🔴 ยกเว้น USD

### Thai Stocks Correlation

| Event | PTT | AOT | KBANK | DELTA |
|-------|-----|-----|-------|-------|
| Oil spike | 🟢 | 🔴 | ⚪ | ⚪ |
| Tourism rebound | ⚪ | 🟢 | 🟢 | ⚪ |
| Fed rate cut | ⚪ | 🟢 | 🔴 | 🟢 |
| AI demand | ⚪ | ⚪ | ⚪ | 🟢 |

---

## 🔄 7. Workflow การอัพเดทข่าว (Step-by-Step)

### Step 1: Pull Latest + ตรวจสถานะ

```bash
cd /home/claude/pages
git pull origin main
ls news/2026-04-21*.md       # ดู batches ของวันนั้น
```

### Step 2: ค้นข่าว

- ใช้ `web_search` tool — ค้นข่าวจริงที่ update
- อ่าน 3-5 แหล่ง เพื่อ cross-check
- เน้นแหล่งน่าเชื่อถือ: CNBC, Reuters, Bloomberg, CNN, Yahoo Finance, WSJ

### Step 3: สร้างไฟล์ Batch ใหม่

```python
# ใช้ create_file tool
path = f"/home/claude/pages/news/2026-04-21-HHMM.md"
file_text = """---
date: 2026-04-21THH:MM:00Z
date_display: 21 เม.ย. 2026 · HH:MM
tickers: [TICKER1, TICKER2, ...]
sources: [Source1, Source2, ...]
---

## หัวข้อข่าวที่ 1

[เนื้อหา Bank-Style 3-layer]

---

## หัวข้อข่าวที่ 2

[...]

---

*สรุปโดย JP Trust Learning · 21 เม.ย. 2026 · HH:MM*
"""
```

### Step 4: Validate ไฟล์

```python
import re
with open('news/2026-04-21-HHMM.md','r',encoding='utf-8') as f:
    content = f.read()

headlines = re.findall(r'^## (.+)$', content, re.M)
thai_inv = content.count('ผลกระทบต่อนักลงทุนไทย') + content.count('สำหรับนักลงทุนไทย')
follow = content.count('ปัจจัยที่ต้องติดตาม')

# ตรวจศัพท์ English-heavy ที่ไม่ควรเจอ
bad_phrases = [
    'Safe Haven Premium', 'Sector Rotation', 'Premarket พุ่ง',
    'Bull-Bear Spread', 'ทำไมถึงสำคัญ', 'พุ่งทะลุ', 'ดิ่งเหว'
]
bad_count = sum(1 for p in bad_phrases if p in content)

assert len(headlines) > 0, "ต้องมีอย่างน้อย 1 headline"
assert bad_count == 0, f"เจอศัพท์ที่ไม่ควรใช้ {bad_count} จุด"
assert thai_inv >= len(headlines), "ทุกหัวข้อต้องมีส่วน 'สำหรับนักลงทุนไทย'"
assert follow >= len(headlines), "ทุกหัวข้อต้องมีส่วน 'ปัจจัยที่ต้องติดตาม'"
```

### Step 5: Backup + Update news-index.json

```python
import json, shutil

# Backup index ก่อนแก้
shutil.copy('news/news-index.json', 'news/news-index-backup-TIMESTAMP.json')

with open('news/news-index.json','r',encoding='utf-8') as f:
    data = json.load(f)

new_batch = {
    "file": "2026-04-21-HHMM.md",
    "date": "2026-04-21THH:MM:00Z",
    "date_display": "21 เม.ย. 2026 · HH:MM",
    "summary": "[สรุปสั้นๆ 1 บรรทัด]",
    "tickers": [...],
    "headlines": [
        {
            "title": "[หัวข้อเต็ม]",
            "tickers": [
                {"symbol": "XXX", "sentiment": "positive|negative|neutral"}
            ],
            "source": "[Source1, Source2, ...]",
            "published": "21 เม.ย. 2026"
        }
    ]
}

# ใส่ข้างบนสุด (newest first)
data['batches'].insert(0, new_batch)
data['lastUpdated'] = "2026-04-21THH:MM:00Z"

with open('news/news-index.json','w',encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
```

### Step 6: Commit + Push

```bash
cd /home/claude/pages
git add -A
git commit -m "feat(news): [short description]

[detailed description]

Total batches: NN, Total headlines: NN"

git pull --rebase origin main    # safety
git push origin main
```

### Step 7: ยืนยันกับ User

- บอก commit hash
- สรุปประเด็นสำคัญในรูปแบบที่อ่านง่าย
- บอกให้ user รีเฟรชแอพดูผล

---

## 📏 8. ข้อกำหนดขนาดและจำนวน

### Per Batch

| Item | Minimum | Typical | Maximum |
|------|---------|---------|---------|
| Headlines | 1 | 3-6 | 10 |
| Size (chars) | 8,000 | 20,000-30,000 | 40,000 |
| Tickers | 3 | 5-10 | 20 |
| Sources | 2 | 3-5 | 8 |

### Per Headline

| Section | จำนวน |
|---------|-------|
| ตัวเลขสำคัญ | 3-8 bullet points |
| ปัจจัยที่ขับเคลื่อน | 2-4 ประเด็น |
| ผลกระทบ | 2-4 ประเด็น |
| สำหรับนักลงทุนไทย | 5-10 bullet points |
| ปัจจัยที่ต้องติดตาม | 5-12 bullet points |

---

## 🎯 9.5 Tone Override Workflow (เพิ่ม 2 พ.ค. 2026)

### ปัญหาที่แก้

`member-dashboard.html → deriveTone()` คำนวณ tone (Bullish/Bearish/Mixed) จาก ratio ของ ticker sentiments:
- ต้องมี positive หรือ negative ≥ 70% ของ `(positive+negative)` ถึงจะตัดสิน → ไม่งั้น MIXED
- **ปฏิบัติทุก ticker เท่ากัน** — ไม่มี concept ของ "subject ticker" vs "peripheral ticker"

ผลคือบางข่าวที่ subject หลักเป็น neutral แต่มี peripheral tickers เอียงไปทางใดทางหนึ่ง → ระบบขึ้นป้ายผิด tone จากใจความข่าวจริง

**ตัวอย่างเคสที่เจอ:** ข่าว Berkshire under-perform (BRK.B=neutral, AAPL=neutral) แต่ peripheral GOOGL/UNH/NYT=positive, KHC=negative → rule คืน BULLISH ทั้งที่ใจความข่าวเป็น cautious/bearish

### Solution: `tone_override` field

ใส่ใน headline object ของ `news-index.json`:

```json
{
  "title": "...",
  "tickers": [...],
  "tone_override": "bearish",   // ← optional
  "source": "...",
  "published": "..."
}
```

**Allowed values:** `"bullish"` | `"bearish"` | `"mixed"` | `"neutral"`

**Default behavior:** ถ้าไม่ใส่ field นี้ → JS จะใช้ `deriveTone(tickers)` แบบเดิม ดังนั้น batch เก่าทั้งหมดยังทำงานได้ปกติ

### 📋 Workflow สำหรับ Claude (ทุก batch ใหม่)

หลัง tag sentiment ของ ticker เสร็จแล้ว ก่อน commit:

1. **Mental simulation ของ `deriveTone`**
   - นับ positive, negative (ตัด neutral ทิ้ง)
   - คิด ratio: positive / (pos+neg) — ถ้า ≥70% → BULLISH, ถ้า negative ≥70% → BEARISH, else → MIXED
   - บันทึกผลลัพธ์ที่ rule จะคืน

2. **เทียบกับ tone ที่ใจความข่าวสื่อจริง**
   - อ่าน headline + lead paragraph + ผลกระทบเชิงโครงสร้าง
   - ลูกค้า Private Banking อ่านแล้วควรรู้สึกยังไง?
   - **Subject ticker เป็นอะไร** (positive/negative/neutral) — ตัวนี้สำคัญกว่า peripheral

3. **ตัดสิน:**
   - ถ้า rule output ตรงกับใจความข่าว → **ไม่ต้องใส่** `tone_override`
   - ถ้าไม่ตรง → **ใส่ `tone_override` ทันที** ตามที่ตัวเองตัดสิน

4. **แจ้งใน chat** ทุกครั้งที่ใส่ override:
   ```
   ⚠️ Override tone: [headline title สั้นๆ]
   Rule จะคืน [X] (positive:Y, negative:Z) แต่ใจความข่าวเป็น [Y]
   ใส่ tone_override = "bearish/bullish/mixed/neutral"
   ```
   → ไม่ต้องรอคำตอบ commit ได้เลย — ลูกค้าจะมาบอกทีหลังถ้าไม่โอเค

### Heuristics — เมื่อไหร่ควร override

| สถานการณ์ | แนะนำ |
|---|---|
| Subject = neutral แต่ peripheral 3:1 หรือมากกว่า | Override ตามใจความข่าวจริง |
| Subject = negative ชัด แต่ rule คืน MIXED เพราะ peripheral แย่งสัดส่วน | Override = `bearish` |
| ข่าวสร้างทั้งผู้ชนะ-ผู้แพ้ในตลาดใหญ่ (เช่น TrumpIRA) | ปล่อยให้เป็น `mixed` (ตรงตามข้อเท็จจริง) |
| Macro/Policy news ที่ tone โดยรวมเอนเอียงชัด แต่ ticker mix แบ่งครึ่งๆ | Override ตาม macro implication |
| Earnings beat + raise guidance ของ subject แต่มี ticker คู่แข่งติดมา | Override = `bullish` ถ้า subject เด่น |

### ❌ ห้าม Override โดย:

- เปลี่ยน sentiment ของ ticker เพื่อให้ rule คืนค่าที่อยาก (= ทำลายความถูกต้องของ ticker tag)
- Override ตาม "ความรู้สึก" — ต้องมีเหตุผลผูกกับใจความข่าว
- Override เป็น `bullish/bearish` ทั้งที่ใจความข่าวเป็น mixed จริง (เช่น TrumpIRA — มีผู้แพ้ผู้ชนะชัด ปล่อยเป็น mixed ดีกว่า)

### Code reference

`member-dashboard.html:1245` — `function deriveTone(tickers, override)` รับ override เป็น optional argument
`member-dashboard.html:1368` — call site ส่ง `h.tone_override` เข้าไป

---

## ⏰ 9.6 Timestamp Convention — HHMM ต้องเป็นเวลา BKK ก่อน push (เพิ่ม 2 พ.ค. 2026)

### ปัญหาที่แก้

`member-dashboard.html → parseBatchDate()` แปลง `Z` (UTC) เป็น `+07:00` (BKK) — ดังนั้นทุก timestamp `2026-MM-DDTHH:MM:00Z` ในระบบถูกอ่านเป็น **เวลา BKK ตามตัวอักษร** (ไม่ใช่ UTC)

`member-dashboard.html → timeAgo()` มี guard บรรทัดแรก:
```javascript
if(diffMs<0)return shortDate(d);  // future timestamp → fallback
```

ผลคือ ถ้า batch มี timestamp อยู่ใน "อนาคต" เทียบกับเวลาปัจจุบัน → card จะแสดงแค่ **"2 พ.ค."** (shortDate) แทนที่จะเป็น `"Xh ago"` / `"Xm ago"` ตามที่ควรเป็น

**ตัวอย่างเคสที่เจอ (2 พ.ค. 2026):** Claude session push 3 batches ที่เวลา BKK 12:25, 13:23, 21:21 แต่ใส่ timestamp 22:30, 23:45, 23:55 (ตามเวลาเหตุการณ์ข่าวสหรัฐฯ ปลาย session) → ทุก batch อยู่ในอนาคตของเวลา BKK ที่ user เปิดดู → ทุก card แสดง "2 พ.ค." แทน "Xh ago"

### กฎการตั้ง Timestamp

**HHMM ของ batch = เวลา BKK ที่จะ push จริง** ไม่ใช่:
- ❌ เวลาเหตุการณ์ข่าวเกิด (US after-hours = 03:00-04:00 BKK วันถัดไป → อนาคตของเวลา BKK ขณะ publish)
- ❌ เวลาประมาณการ "ให้ดูสมจริง" (เช่น "ใส่ 22:00 ให้ดูเหมือน prime time")
- ❌ เวลา UTC (ระบบอ่าน Z เป็น BKK ไม่ใช่ UTC)

**ที่ถูก:**
- ✅ เช็คเวลา BKK ปัจจุบันก่อนตั้ง HHMM: `TZ=Asia/Bangkok date`
- ✅ ใช้เวลา **5-15 นาทีก่อนเวลาจริง** เผื่อ rebase + push delay
- ✅ ถ้าข่าวจริงเกิดในอเมริกาช่วงดึก BKK → publish batch ตอนเช้า BKK ก็ได้ (ใช้ HHMM เช้า) เนื้อข่าวยังคงสะท้อนเหตุการณ์ก่อนหน้าได้ตามปกติ

### Workflow บังคับก่อน Step 3 (สร้างไฟล์ Batch)

```bash
# Step 2.5: เช็คเวลา BKK ปัจจุบันก่อนเลือก HHMM
TZ=Asia/Bangkok date
# ตัวอย่าง output: Sat May  2 23:02:00 +07 2026
# → เลือก HHMM ≤ 22:55 (เผื่อ buffer 7 นาที)
```

จากนั้นใช้ HHMM ที่ปลอดภัย (≤ ปัจจุบัน) ทั้งใน:
1. ชื่อไฟล์: `news/2026-MM-DD-HHMM.md`
2. Frontmatter: `date: 2026-MM-DDTHH:MM:00Z` + `date_display: D MMM 2026 · HH:MM`
3. Footer: `*สรุปโดย JP Trust Learning · D MMM 2026 · HH:MM*`
4. news-index.json: `date`, `date_display`, `file`

### Validation Script (เพิ่มใน Step 4)

```python
from datetime import datetime, timedelta

# Parse HHMM from filename
import re
m = re.search(r'(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.md', filepath)
y, mo, d, hh, mm = map(int, m.groups())
batch_bkk = datetime(y, mo, d, hh, mm)

# Current BKK time
now_utc = datetime.utcnow()
now_bkk = now_utc + timedelta(hours=7)

assert batch_bkk <= now_bkk, \
    f"❌ Batch timestamp {batch_bkk} อยู่ในอนาคต (now BKK: {now_bkk}) — timeAgo จะ fallback เป็น '2 พ.ค.'"
print(f"✓ Timestamp OK — {(now_bkk - batch_bkk).total_seconds()/60:.0f} นาทีในอดีต")
```

### Recovery — แก้ batch ที่ใส่ timestamp อนาคต

ถ้าเผลอ push batch ที่อยู่ในอนาคตไปแล้ว (user รายงานว่า card ขึ้น "2 พ.ค." ไม่มีเวลา):

1. Backup `news-index.json` ก่อน
2. Rename ไฟล์ `.md` ให้ HHMM ใหม่ตรงกับเวลา BKK ที่ push จริง (ดูจาก `git log --pretty=format:"%h | %ai | %s"`)
3. แก้ frontmatter: `date`, `date_display`
4. แก้ footer: `*สรุปโดย JP Trust Learning · D MMM YYYY · HH:MM*`
5. แก้ index entry: `file`, `date`, `date_display` — แล้ว re-sort batches by date desc
6. Commit message ใช้ prefix `fix(news):` ไม่ใช่ `feat(news):`

### Code reference

`member-dashboard.html:1222` — `function parseBatchDate(iso)` — แปลง Z → +07:00
`member-dashboard.html:1231` — `function timeAgo(iso)` — มี guard `if(diffMs<0)return shortDate(d)`

---

## ⚠️ 9. ข้อห้ามเด็ดขาด

### ห้ามแก้ไข
- ❌ `member-dashboard.html` — frontend — ห้ามแก้ถ้าไม่ได้รับคำสั่งชัดเจน
- ❌ `news-detail.html` — frontend — เหมือนกัน
- ❌ ไฟล์ backup เดิม — เก็บไว้เป็นหลักฐาน

### ห้ามลบ
- ❌ Batch files เก่า — แม้เก่าแล้วก็เก็บไว้
- ❌ Backup index files — เก็บไว้เผื่อ rollback

### ห้ามข้าม
- ❌ การ `git pull` ก่อนเริ่มทำงาน
- ❌ การ validate ไฟล์ก่อน commit
- ❌ การ backup index ก่อนแก้

---

## 🗞️ 10. รายชื่อหัวข้อที่ใช้แล้ว (ห้ามซ้ำในวันเดียวกัน)

**หลักการ:** เช็คเฉพาะ **วันเดียวกัน** เท่านั้น — ไม่ต้องเช็คย้อนหลังหลายวัน เพราะข่าวแต่ละวันเปลี่ยนเร็ว และหัวข้อเก่า 3-4 วันที่แล้ว ไม่ทับกับข่าววันนี้โดยธรรมชาติอยู่แล้ว

**ก่อนเขียนหัวข้อใหม่** เช็คจาก `news-index.json` ว่าไม่ซ้ำกับ batches ของวันเดียวกัน:

```python
import json
from datetime import datetime

with open('news/news-index.json','r',encoding='utf-8') as f:
    data = json.load(f)

# กำหนดวันที่กำลังทำ (ใช้ YYYY-MM-DD)
today = "2026-04-21"

# รวบรวมหัวข้อของวันเดียวกันเท่านั้น
today_titles = []
for b in data['batches']:
    if b['date'].startswith(today):
        for h in b['headlines']:
            today_titles.append(h['title'])

print(f"หัวข้อที่ใช้แล้วในวันนี้ ({today}): {len(today_titles)} เรื่อง")
for i, t in enumerate(today_titles, 1):
    print(f"  {i}. {t[:70]}...")

# ตอนเขียนหัวข้อใหม่ เช็คว่าไม่ซ้ำใน today_titles
# ถ้าซ้ำแนวคิดคล้ายกัน ต้องเปลี่ยนมุมมองหรือ angle ให้ต่าง
```

**ตัวอย่าง:** ถ้าวันนี้เคยมีข่าว "RTX Q1 Earnings" แล้ว — รอบถัดไปจะเขียน "RTX" ซ้ำได้ แต่ต้อง angle ต่าง เช่น "RTX พุ่ง 5% หลังประกาศผลประกอบการ" (หลัง market close) หรือพูดถึงในบริบทของ Defense Sector รวม ไม่ใช่เขียนบทวิเคราะห์ซ้ำเดิม

---

## 🛠️ 11. Tools ที่ใช้บ่อย

### Python Validation Script

```python
# /home/claude/pages/scripts/validate_batch.py
import sys, re

def validate(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Check frontmatter
    if not content.startswith('---'):
        return False, "ไม่มี frontmatter"

    # Check headlines
    headlines = re.findall(r'^## (.+)$', content, re.M)
    if not headlines:
        return False, "ไม่มี headline"

    # Check footer
    if 'สรุปโดย JP Trust Learning' not in content:
        return False, "ไม่มี footer"

    # Check bad phrases
    bad = ['Safe Haven Premium', 'Sector Rotation', 'ทำไมถึงสำคัญ',
           'พุ่งทะลุ', 'ดิ่งเหว', 'Premarket พุ่ง']
    found = [p for p in bad if p in content]
    if found:
        return False, f"เจอวลีที่ไม่ควรใช้: {found}"

    # Check thai-investor section
    thai_inv = content.count('นักลงทุนไทย')
    if thai_inv < len(headlines):
        return False, f"ต้องมี 'นักลงทุนไทย' ในทุกหัวข้อ (มี {thai_inv}, ต้องการ {len(headlines)})"

    return True, f"PASS — {len(headlines)} headlines"

if __name__ == '__main__':
    ok, msg = validate(sys.argv[1])
    print(f"{'✅' if ok else '❌'} {msg}")
```

### Quick Check Index

```bash
cd /home/claude/pages
python3 -c "
import json
with open('news/news-index.json','r',encoding='utf-8') as f:
    data = json.load(f)
print(f'Latest: {data[\"lastUpdated\"]}')
print(f'Batches: {len(data[\"batches\"])}')
print(f'Total headlines: {sum(len(b[\"headlines\"]) for b in data[\"batches\"])}')
print('---')
for b in data['batches'][:5]:
    print(f'{b[\"date_display\"]} — {len(b[\"headlines\"])} headlines')
"
```

---

## 📞 12. Quick Reference — Prompt Templates

### สำหรับเรียกอัพเดทข่าว

```
อัพเดทข่าววันที่ [DATE] [X] ข่าวด้วยค่ะ
[optional: ให้มีข่าวนึงเกี่ยวกับ [TOPIC]]
```

### สำหรับข่าวด่วน

```
ขออัพเดทข่าวนี้ด้วย [TOPIC] สดๆ ร้อนๆ เลย
[optional: screenshot/URL]
```

### สำหรับปรับโทน

```
ปรับข่าว batch [FILE] เป็นโทนไทยเข้าใจง่ายหน่อย
ศัพท์เทคนิคใส่วงเล็บไทยได้ แต่ไม่ต้องตัดทิ้ง
```

### สำหรับ rewrite ไฟล์

```
เขียน batch [FILE] ใหม่ด้วยโทนไทยเข้าใจง่าย
```

---

## 📌 13. Checklist ก่อน Push

- [ ] Pull latest จาก origin/main แล้ว
- [ ] ข่าวเป็นข่าวจริง (จาก web search ที่เชื่อถือได้)
- [ ] **HHMM ของ batch ≤ เวลา BKK ปัจจุบัน** (ดู §9.6 — เช็คด้วย `TZ=Asia/Bangkok date`)
- [ ] Validate ไฟล์ .md ผ่าน (headlines, footer, no bad phrases)
- [ ] Update news-index.json (backup ก่อนแก้)
- [ ] Sentiment ถูกต้องตาม context (ดู §6)
- [ ] Tone simulation ตรงกับใจความข่าว (ดู §9.5 — ใส่ `tone_override` ถ้าไม่ตรง)
- [ ] ไม่ซ้ำหัวข้อเก่า
- [ ] Footer มี `*สรุปโดย JP Trust Learning · DD ...*`
- [ ] Commit message ชัดเจน
- [ ] Push สำเร็จ
- [ ] แจ้ง user commit hash + สรุปสั้น

---

## 🔗 14. Links

| Item | URL |
|------|-----|
| Repo | https://github.com/jptrustlearning/pages |
| Main App | https://jptrustlearning.github.io/pages/member-dashboard.html |
| News Detail | https://jptrustlearning.github.io/pages/news-detail.html |
| News Index (live, frontend) | https://app.jptrustlearning.com/news/news-index.json |
| Batch Example (live, frontend) | https://app.jptrustlearning.com/news/2026-04-21-2240.md |
| News Index Raw (verify push only) | https://raw.githubusercontent.com/jptrustlearning/pages/main/news/news-index.json |

---

## 📝 15. Version History

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 21 เม.ย. 2026 | เวอร์ชันแรก ครบทุกด้าน |
| — | — | หลัง bug fix GLD sentiment logic (energy war) |
| — | — | หลัง rewrite 22:30 batch เป็น plain Thai |
| 1.1 | 21 เม.ย. 2026 | เพิ่ม §0 ปรัชญาพื้นฐาน — สังเคราะห์ ไม่ใช่แปล (Cross-reference, Value-add analysis, Thai investor angle, Checklist) |
| 1.2 | 2 พ.ค. 2026 | เพิ่ม §9.5 Tone Override Workflow — `tone_override` field สำหรับกรณี deriveTone rule ไม่ตรงกับใจความข่าว |
| 1.3 | 2 พ.ค. 2026 | เพิ่ม §9.6 Timestamp Convention — HHMM ต้อง ≤ เวลา BKK ปัจจุบัน, แก้ปัญหา card แสดง "2 พ.ค." แทน "Xh ago"; อัพเดท §13 checklist |

---

*เอกสารนี้จัดทำโดย JP Trust Learning · Updated: 21 เม.ย. 2026*
