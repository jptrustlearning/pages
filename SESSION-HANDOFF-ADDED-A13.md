# SESSION-HANDOFF-ADDED-A13

**Date:** 2026-05-02 (Sat)
**Scope:** 6M Momentum lookback bug fix → calendar-based redesign → Details PDF feature
**Next session focus:** Apply same patterns to Rolling 6M (lookback + PDF) and Weekly (PDF only)

---

## 🎯 What was completed this session

### 1. Beta feedback patches (early session)

| Commit | What |
|---|---|
| `8ca8dcd` | jp-compare.js: %Return support for Weekly (was reading non-existent `#kpi-cagr`) + definitions box |
| `e4ca09c` | jp-compare.js: shorter definitions + `%Max DD` column header |
| `587115c` | sp500-combined: Weekly PENDING shows NEXT ENTRY date + dynamic day name (handles MLK/Memorial/Presidents Day rolls) |
| `a166e11` | sp500-pro + rolling-6m: PENDING shows NEXT REBALANCE/NEXT ENTRY date |

### 2. 6M Momentum: discovered + fixed major lookback bug

**The bug:** `CONFIG.lookbackWeeks: 26` was used as `signalIdx - 26` directly on daily `state.sortedDates` array → only 26 **trading days** lookback ≈ 5 weeks ≈ 1 month, NOT 6 months as UI/About modal claimed.

Comment in Rolling 6M was the smoking gun: `lookbackWeeks: 26, // 6 months (~130 trading days) — same as 6M Momentum` — implementation contradicted intent.

**Fix sequence:**

| Commit | What |
|---|---|
| `2a7de53` | Backup v25 |
| `96532a4` | Initial fix: introduced `const lookbackDays = CONFIG.lookbackWeeks * 5` (26→130 days) |
| `f1fcf26` | Backup v26 |
| `7983255` | **Final: replaced with calendar-based lookback** per Joon's spec |

**Joon's calendar-based spec (final design):**
- For **Feb rebal**: lookback = **2nd biz day of Aug (prev year)** → **last biz day of Jan (current year)**
- For **Aug rebal**: lookback = **2nd biz day of Feb (current year)** → **last biz day of Jul (current year)**
- = "ผลตอบแทนระหว่างที่เพิ่งถือพอร์ตเก่า" (the period the previous portfolio was held)

**Why "2nd biz day" not "1st":**
- 1st biz day = transaction day (buy at close) — not actual holding
- 2nd biz day onward = market exposure of prior portfolio

### 3. Details PDF feature for 6M (verification tool)

Joon: "ให้แต่ละ trade log มีปุ่ม print pdf...โดยให้ปริ๊น หุ้นที่ติดอันดับ XX ตัว...ปริ๊นมา 3 ช่วงเวลา"

| Commit | What |
|---|---|
| `0441dd3` | Initial: Recheck PDF button (gold/cream) + window.open print HTML |
| `5faf9e8` | ❌ Tried html2pdf.js for auto-download — **white page on some setups, reverted** |
| `6ad8776` | Reverted to window.open pattern + renamed to "Details PDF" red button + filename change |
| `c429ec4` | Added cosmic "ย้อนกลับเข้าแอป" button (left-aligned actions) |
| `a943955` | Added **Close column** (was OHLV → now OHLCV) + mobile responsive (viewport meta + @media) + table-wrap horizontal scroll |
| `223aa92` | Mobile viewport bug fix: Blob URL replaces document.write |
| `52496e0` | **Final: iframe modal overlay** (no URL bar visible — hides github.io URL) |

**Final Details PDF architecture (iframe modal):**

```
document.body (within sp500-strategy-pro context)
  └── #_jpt_details_overlay (position:fixed, inset:0, z:999999, animated fade-in)
       ├── topBar (สีดำ #0a0a0a)
       │    ├── [← ย้อนกลับเข้าแอป] cosmic gradient → overlay.remove()
       │    └── [บันทึกเป็น PDF / พิมพ์] maroon → iframe.contentWindow.print()
       └── iframe srcdoc=html (เนื้อหา PDF preview, fills remaining space)
```

**Key technical points:**
- `iframe.contentWindow.print()` (NOT `window.print()` — that prints parent page)
- iframe `srcdoc` = no URL bar, no separate window
- Esc key closes overlay
- `document.title = 'JPT-6M-Details-{date}'` → becomes default save filename

---

## 📍 Current file state

```
sp500-strategy-pro.html         → backup v26 latest, +6 commits since (next backup = v27)
sp500-rolling-6m-momentum.html  → backup v14 latest (next = v15) — UNTOUCHED IN THIS SESSION
sp500-combined-strategy.html    → backup v24 latest (next = v25) — UNTOUCHED IN THIS SESSION
jp-compare.js                   → backup v3 latest (next = v4)
member-dashboard.html           → backup v138+ (cache-busted multiple times this session)
```

**Latest cache-bust value:** `1777718240` (commit `52496e0`)

---

## 🎯 Pending work for next session

### Task 1: Rolling 6M — lookback fix ⚠️ NEEDS DECISION FIRST

**File:** `sp500-rolling-6m-momentum.html`

Rolling 6M has the SAME bug as 6M Momentum (uses `signalIdx - 26` directly on daily array). But there's a **semantic question** to resolve before just porting the calendar-based pattern:

**Rolling 6M rebalances MONTHLY** (not semi-annually like 6M Momentum). So if we apply the same "lookback = previous holding period" pattern:
- Previous rebalance = previous calendar month
- Lookback would be **~1 month**, not 6 months
- This contradicts the strategy name "Rolling **6M**"

**Three options to ask Joon BEFORE coding:**

| Option | Lookback | Notes |
|---|---|---|
| **A** | "Previous holding period" = ~1 month | Consistent with 6M Momentum design pattern · breaks "Rolling 6M" name semantic |
| **B** | "Always 6 months back" via fixed 130 trading days | Matches strategy name · loses self-consistency benefit · keeps magic number |
| **C** | "6 monthly holding periods back" = 6 months back, anchored on previous monthly rebal dates | Combines both: rolling but covering 6-month window. Complex implementation. |

**Recommendation to discuss with Joon:** Option B is probably right for Rolling 6M because the **point** of Rolling 6M (vs 6M Momentum) is that you're refreshing rankings every month using the same "look back 6 months" criterion — that's literally what "rolling" means.

### Task 2: Rolling 6M — add Details PDF

**File:** `sp500-rolling-6m-momentum.html`

Same pattern as 6M Momentum Details PDF. Steps:

1. Modify `processData()` to store OHLCV (was just CV) — add `o`, `h`, `l` fields
2. Add helpers (copy from sp500-strategy-pro.html lines ~3580-3618):
   - `_getRecheckDatesForEntry(entryDate)` — finds 3 dates for trade entry
   - `_getRecheckDatesForPending()` — finds 2 dates for pending signal
   - `_buildOhlvTable(date, tickers)` — OHLCV table builder
   - `_fmtNum(n, decimals)`, `_fmtVol(v)` — number formatters
   - `downloadDetailsPdf(event, entryDate, isPending)` — main function with iframe modal
3. Add CSS `.trade-details-btn` (copy from sp500-strategy-pro.html lines ~1347-1370)
4. Add button HTML to historical trade card render
5. Add button HTML to PENDING card render
6. Title prefix: change `JPT-6M-Details` → `JPT-Rolling6M-Details`

⚠️ **IMPORTANT for Rolling 6M:** the "holding end" date = next monthly rebalance (1 month later, not 6 months). Adjust `_getRecheckDatesForEntry` accordingly — the function uses `state.tradeLog.findIndex` which works regardless of strategy interval, so SHOULD be portable as-is, but verify.

### Task 3: Weekly Strategy — add Details PDF

**File:** `sp500-combined-strategy.html`

Weekly already has correct lookback (Friday-to-Friday using `state.fridayDates`). Just needs Details PDF.

**Differences for Weekly:**
- Lookback start = **previous Friday** (or 1st trading day of week if previous Friday holiday)
- Lookback end = **current Friday** (signal day)
- Holding end = **next Friday** (or 1st trading day of next week)
- Rebalance interval = **weekly** (not 6M or monthly)

`processData()` for Weekly might already store more data — verify before changing. The `state.fridayDates` array is the index space, not `state.sortedDates`. Helper functions need to use `state.sortedDates` for OHLCV lookup, but compute date boundaries using `state.fridayDates` if needed.

Title prefix: `JPT-Weekly-Details-{date}`

---

## 🔧 Reusable code patterns (copy from 6M to Rolling/Weekly)

### Pattern 1: Calendar-based lookback (use for Rolling 6M if Option A chosen)

**Helper functions** (place above `rankStocks` in target file):

```js
function firstDayIdxInMonth(year, monthIdx) {
  // Returns index of first sortedDates entry whose Date is in (year, monthIdx).
  // monthIdx is 0-indexed (Jan=0, Feb=1, Aug=7).
  // Returns -1 if data doesn't reach that month.
  for (let k = 0; k < state.sortedDates.length; k++) {
    const d = new Date(state.sortedDates[k]);
    const y = d.getFullYear(), m = d.getMonth();
    if (y === year && m === monthIdx) return k;
    if (y > year || (y === year && m > monthIdx)) return -1;
  }
  return -1;
}

function getPrevRebalAnchor(currentYear, currentMonth) {
  const sortedRebalMonths = [...CONFIG.rebalanceMonths].sort((a,b) => a-b);
  const idx = sortedRebalMonths.indexOf(currentMonth);
  if (idx === -1) return null;
  const prevIdx = (idx - 1 + sortedRebalMonths.length) % sortedRebalMonths.length;
  const prevMonth = sortedRebalMonths[prevIdx];
  const prevYear = (prevIdx >= idx) ? currentYear - 1 : currentYear;
  return { year: prevYear, month: prevMonth };
}
```

**Rebalance logic in `runBacktest()` and `simulateStrategy()`:**

```js
if (isRebalanceMonth && isFirstWeek && notAlreadyRebalanced) {
  const signalIdx = i - 1;
  const prevAnchor = getPrevRebalAnchor(dateObj.getFullYear(), dateObj.getMonth());
  if (!prevAnchor) continue;
  const prevRebalFirstIdx = firstDayIdxInMonth(prevAnchor.year, prevAnchor.month);
  if (prevRebalFirstIdx < 0) continue;        // data doesn't reach prev rebal month → skip
  const startIdx = prevRebalFirstIdx + 1;     // 2nd biz day of prev rebal month
  if (startIdx >= signalIdx) continue;         // window too small → skip
  const candidates = rankStocks(signalIdx, startIdx);
  // ... rest unchanged
}
```

For Rolling 6M with monthly rebalance, `CONFIG.rebalanceMonths = [0,1,2,...,11]` (all months) — `getPrevRebalAnchor` would return previous calendar month, giving ~1 month lookback. **This is why Option A is risky for Rolling 6M.**

### Pattern 2: Details PDF feature (full implementation)

Source: sp500-strategy-pro.html lines ~3577-3829

**Step A:** Modify `processData()` to store OHLCV:
```js
// Was: state.marketData[date][ticker] = { c: close, v: volume };
// Now:
const open = parseFloat(row[2]);
const high = parseFloat(row[3]);
const low = parseFloat(row[4]);
state.marketData[date][ticker] = { o: open, h: high, l: low, c: close, v: volume };
```

**Step B:** Add CSS for button + modal (in main `<style>` block):
```css
.trade-details-btn {
  background: linear-gradient(135deg, #DC2626 0%, #B91C1C 100%);
  border: none; color: #FFFFFF;
  border-radius: 4px; padding: 5px 11px;
  font-family: 'Cinzel','Anuphan',serif; font-size: 0.62rem; font-weight: 700;
  letter-spacing: 1px; text-transform: uppercase;
  cursor: pointer; flex-shrink: 0; line-height: 1.4;
  box-shadow: 0 1px 2px rgba(185,28,28,0.3);
  transition: transform 0.15s, box-shadow 0.15s, opacity 0.2s;
}
.trade-details-btn:hover { background: linear-gradient(135deg, #B91C1C 0%, #991B1B 100%); }
.trade-details-btn:active { transform: translateY(1px); }
.trade-details-btn:disabled { cursor: wait; opacity: 0.65; }
.trade-details-btn svg { vertical-align: -2px; margin-right: 4px; }
```

**Step C:** Helper functions (copy from sp500-strategy-pro.html lines ~3577-3618):
- `_getRecheckDatesForEntry`, `_getRecheckDatesForPending`
- `_fmtNum`, `_fmtVol`, `_buildOhlvTable`

**Step D:** Main `downloadDetailsPdf` function (copy from sp500-strategy-pro.html lines ~3620-3800).

Key parts:
- Builds full HTML document as template literal
- Creates iframe modal overlay
- Uses `iframe.srcdoc = html` (NOT document.write or Blob URL)
- Print button calls `iframe.contentWindow.focus(); iframe.contentWindow.print();`
- Esc key closes overlay
- Cosmic gradient back button + maroon print button in top bar

**Step E:** Button HTML in historical trade card render:
```html
<button class="trade-details-btn" onclick="downloadDetailsPdf(event, '${r.date}', false)" title="ดาวน์โหลดรายละเอียดเป็น PDF">
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>Details PDF
</button>
```

**Step F:** Button HTML in PENDING card render (with `null` for entryDate, `true` for isPending).

---

## ⚠️ Critical reminders / gotchas

1. **`iframe.contentWindow.print()` NOT `window.print()`** — calling `window.print()` from inside iframe content prints the parent page. Must trigger from outside via contentWindow.

2. **`iframe.srcdoc` not `iframe.src + Blob URL`** — srcdoc has no URL, perfect for hiding github.io.

3. **Mobile viewport bug** — when using `window.open + document.write`, mobile browsers don't always re-evaluate viewport meta. Iframe srcdoc avoids this entirely.

4. **`document.title` = default save filename** — set this carefully (no special chars, browser will use it for "Save as PDF").

5. **CONFIG.lookbackWeeks now DEPRECATED in 6M** — kept for safety but not used. Same will apply to Rolling 6M after fix.

6. **Compare entries from before lookback fix** are STALE — they used 26-day lookback. Joon hasn't decided whether to bump `jpt_compare_list_v1` → `_v2` to clear them. Ask if needed.

---

## 📋 Step-by-step checklist for next session

### For Rolling 6M:

- [ ] **Ask Joon:** Option A/B/C for lookback semantics (default = B per recommendation)
- [ ] Backup v15: `cp sp500-rolling-6m-momentum.html sp500-rolling-6m-momentum-backup-v15.html` + commit + push
- [ ] If Option A: copy helpers + apply same pattern as 6M
- [ ] If Option B: simpler — just fix `lookbackDays = CONFIG.lookbackWeeks * 5` (already done in 6M's commit `96532a4` for reference)
- [ ] If Option C: design discussion needed
- [ ] Update About modal copy in Rolling 6M
- [ ] Update Compare display label
- [ ] Modify `processData()` to store OHLCV
- [ ] Add CSS `.trade-details-btn`
- [ ] Add `_getRecheckDatesForEntry`, `_getRecheckDatesForPending`, `_buildOhlvTable`, `_fmtNum`, `_fmtVol`, `downloadDetailsPdf` (with title prefix `JPT-Rolling6M-Details`)
- [ ] Add buttons to historical card + PENDING card
- [ ] Validate (div balance + JS syntax)
- [ ] Cache-bust member-dashboard refs to sp500-rolling-6m-momentum
- [ ] Commit + push

### For Weekly (sp500-combined-strategy.html):

- [ ] Backup v25: `cp sp500-combined-strategy.html sp500-combined-strategy-backup-v25.html` + commit + push
- [ ] Verify `processData()` stores OHLCV (or modify to)
- [ ] Verify Weekly's lookback uses `state.fridayDates` correctly (probably already correct)
- [ ] Add CSS `.trade-details-btn`
- [ ] Add Details PDF helpers — note Weekly has different date semantics:
  - `_getRecheckDatesForEntry` for Weekly: lookback start = previous Friday, end = current Friday, holding end = next Friday
  - May need to adapt date computation to use `state.fridayDates` indices
- [ ] Add `downloadDetailsPdf` with title prefix `JPT-Weekly-Details`
- [ ] Add buttons to historical card + PENDING card
- [ ] Validate + cache-bust + commit + push

### Final check:
- [ ] Test all 3 strategies on member-dashboard mobile + desktop
- [ ] Verify Details PDF works on all 3 with different rebalance intervals
- [ ] Decide compare list reset (if needed)

---

## 📚 Carryover from previous handoffs (still applicable)

- **News tone_override workflow** (NEWS-UPDATE-INSTRUCTION.md §9.5) — works as documented
- **Refactor member-dashboard to use jp-settings.js helper** — not done yet
- **CF Pages migration decision** — pending
- **Supabase Points field wire-up** — still hardcoded 100
- **Settings membership plan label wire-up** — still hardcoded "Gold — Beta"
- **Live Trades panel** (EA on VPS → CSV → dashboard) — pending
- **Email OTP deliverability** (Tier 1 — customize Supabase Magic Link template) — pending
- **4 alert() spots in OTP flow → branded modal** — pending
- **QR launch handler** (`launch.html`) — pending
- **iOS welcome modal on first PWA open** — pending

---

## 📝 Session commit chain (newest first)

```
52496e0 feat(sp500-strategy-pro): Details PDF — iframe modal overlay (no URL bar)        [FINAL]
223aa92 fix(sp500-strategy-pro): Details PDF — Blob URL replaces document.write
a943955 fix(sp500-strategy-pro): Details PDF — add Close column + mobile responsive
c429ec4 feat(sp500-strategy-pro): Details PDF window — left-align actions + cosmic Back to App
6ad8776 fix(sp500-strategy-pro): revert html2pdf, use window.open + window.print
5faf9e8 feat(sp500-strategy-pro): Details PDF button - red brand + auto-download           [BROKEN, reverted]
0441dd3 feat(sp500-strategy-pro): Recheck PDF button on every trade card + PENDING        [INITIAL]
7983255 feat(sp500-strategy-pro): calendar-based lookback                                 [FINAL LOOKBACK DESIGN]
f1fcf26 Backup v26
96532a4 fix(sp500-strategy-pro): lookbackWeeks=26 was using daily index                   [intermediate fix]
2a7de53 Backup v25
a166e11 feat(sp500-pro/rolling-6m): PENDING NEXT REBALANCE/ENTRY date
29c7bfe Backup v24/v14
587115c feat(sp500-combined): Weekly PENDING NEXT ENTRY date
e4ca09c fix(jp-compare): shorter definitions + %Max DD header
8ca8dcd feat(jp-compare): %Return + Weekly compare support + definitions box
ae93142 Backup pre-Weekly-compare-fix
```

---

## 🎁 Bonus context — key invariants preserved across all strategies

These should remain TRUE after Rolling/Weekly Details PDF work:

1. **Volume loop is `k++` (every day, no sampling)** — Joon's invariant from v5 handoff Rule 5 #2
2. **Decision uses `signalIdx = i - 1`, execution uses day `i` close** — no look-ahead bias
3. **All 3 strategies share identical rankStocks logic** between runBacktest and simulateStrategy
4. **state.marketData[date][ticker]** keys: `{o, h, l, c, v}` (only `o, h, l` are NEW — added in 6M, need to add to Rolling + Weekly too)
5. **Document.title pattern** for save filename: `JPT-{Strategy}-Details-{date}.pdf`

---

**END OF HANDOFF A13**
