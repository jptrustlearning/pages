/* jp-compare.js — Strategy comparison module for JP Trust Learning (v2)
 *
 * v2 (table redesign):
 *   - Saved entries render as a 3-column TABLE (ชื่อ / CAGR / Max DD)
 *   - Click any column header to sort (toggle asc/desc)
 *   - Cells render data bars behind numbers (Excel-style, anchored right)
 *     with width proportional to the max in the visible set
 *   - Click any row to expand a detail panel beneath it (Excel-pivot style)
 *     with period summary, full CONFIG grid, saved-at, and delete button
 *   - Long names truncate with ellipsis
 *
 * Storage shape (each entry):
 *   { id, strategyKey, strategyLabel, listName, cagr, maxDD, summary, config, savedAt }
 *
 * Key (localStorage): jpt_compare_list_v1
 *
 * Usage in strategy page:
 *   JPCompare.init({
 *     strategyKey:    'sp500-strategy-pro',
 *     strategyLabel:  '6M Momentum',
 *     getCurrentResult: () => ({ cagr, maxDD, summary, config: {...} })
 *   });
 */
(function(){
  'use strict';

  if (window.JPCompare) return;

  const STORAGE_KEY = 'jpt_compare_list_v1';
  let _config = null;
  let _modalEl = null;
  let _backdrop = null;
  let _injected = false;

  // Sort state — column key + direction
  let _sortBy = 'cagr';        // 'name' | 'cagr' | 'dd'
  let _sortDesc = true;        // true = desc, false = asc
  let _filterKey = 'all';
  let _expandedId = null;

  // ─── PUBLIC ──────────────────────────────────────────────
  function init(opts){
    if(!opts || !opts.strategyKey || !opts.strategyLabel || typeof opts.getCurrentResult !== 'function'){
      console.warn('[jp-compare] init requires {strategyKey, strategyLabel, getCurrentResult}');
      return;
    }
    _config = opts;
    if(_injected) return;
    if(document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', _bootstrap);
    } else {
      _bootstrap();
    }
  }

  function _bootstrap(){
    if(_injected) return;
    _injectStyles();
    _injectFab();
    _injectModal();
    _injected = true;
  }

  // ─── STORAGE ─────────────────────────────────────────────
  function _read(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch(e){
      console.warn('[jp-compare] localStorage read failed:', e);
      return [];
    }
  }

  function _write(arr){
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
      return true;
    } catch(e){
      _toast('บันทึกไม่ได้ — พื้นที่เก็บเต็ม', 'err');
      return false;
    }
  }

  // ─── STYLE INJECTION ─────────────────────────────────────
  function _injectStyles(){
    if(document.getElementById('jpc-styles')) return;
    const css = `
.jpc-fab-tooltip{position:absolute;right:calc(100% + 14px);top:50%;transform:translateY(-50%);background:rgba(26,10,14,0.95);color:#F4E4BA;padding:8px 14px;border-radius:10px;font-size:0.78rem;font-weight:600;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 0.2s ease;border:1px solid rgba(212,175,55,0.4);letter-spacing:0.3px}
.jpc-fab-tooltip::after{content:'';position:absolute;left:100%;top:50%;transform:translateY(-50%);border:6px solid transparent;border-left-color:rgba(26,10,14,0.95)}
.fab:hover .jpc-fab-tooltip{opacity:1}
@media (max-width:600px){.jpc-fab-tooltip{display:none}}

.jpc-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:1500;backdrop-filter:blur(4px);opacity:0;pointer-events:none;transition:opacity 0.3s ease}
.jpc-backdrop.show{opacity:1;pointer-events:auto}

.jpc-modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(0.96);z-index:1600;width:min(580px,calc(100vw - 24px));max-height:calc(100vh - 60px);overflow:hidden;background:linear-gradient(180deg,#FFFEF8 0%,#FAF6ED 70%,#F5EDD8 100%);border:1.5px solid rgba(212,175,55,0.45);border-radius:18px;box-shadow:0 20px 60px rgba(114,47,55,0.25),0 4px 16px rgba(114,47,55,0.1);opacity:0;pointer-events:none;transition:opacity 0.25s ease, transform 0.25s ease;display:flex;flex-direction:column;font-family:'Anuphan',sans-serif;color:#3D3228}
.jpc-modal.show{opacity:1;transform:translate(-50%,-50%) scale(1);pointer-events:auto}

.jpc-modal-header{padding:18px 22px 14px;border-bottom:1px solid rgba(212,175,55,0.3);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;background:linear-gradient(180deg,rgba(255,254,248,0.9) 0%,rgba(250,246,237,0.7) 100%)}
.jpc-modal-title{font-family:'DM Serif Display',serif;font-size:1.35rem;color:#5A3D20;display:flex;align-items:center;gap:10px}
.jpc-modal-title svg{color:#8B6914;flex-shrink:0}
.jpc-modal-close{background:transparent;border:none;font-size:1.5rem;color:#7A6F62;cursor:pointer;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:background 0.2s;line-height:1}
.jpc-modal-close:hover{background:rgba(212,175,55,0.12)}

.jpc-modal-body{padding:18px 22px;overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch}

.jpc-section-label{font-family:'Cinzel',serif;font-size:0.72rem;font-weight:700;color:#8B6914;letter-spacing:1.4px;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:8px}
.jpc-section-label::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,rgba(212,175,55,0.4) 0%,transparent 100%)}
.jpc-section-label .jpc-count-tag{font-family:'Anuphan',sans-serif;font-weight:400;text-transform:none;letter-spacing:0;color:#7A6F62;font-size:0.78rem}

.jpc-current-card{background:linear-gradient(135deg,#FFFEF8 0%,#FAF6ED 60%,#F5EDD8 100%);border:1.5px solid rgba(212,175,55,0.45);border-radius:14px;padding:14px 16px}
.jpc-current-strategy{font-family:'Cinzel',serif;font-size:0.7rem;font-weight:700;color:#8B6914;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:8px;text-align:center}
.jpc-kpi-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.jpc-kpi-cell{background:#FFFEF8;border:1px solid rgba(212,175,55,0.3);border-radius:10px;padding:10px 12px;text-align:center}
.jpc-kpi-cell-label{font-family:'Cinzel',serif;font-size:0.65rem;font-weight:700;color:#8B6914;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px}
.jpc-kpi-cell-value{font-family:'DM Serif Display',serif;font-size:1.55rem;line-height:1}
.jpc-kpi-cell-value.pos{color:#1F7D49}
.jpc-kpi-cell-value.neg{color:#9C2B2B}
.jpc-current-summary{font-size:0.78rem;color:#7A6F62;line-height:1.5;text-align:center;padding:8px 0 0;border-top:1px dashed rgba(212,175,55,0.3);margin-top:10px}

.jpc-name-input-wrap{margin-top:14px}
.jpc-name-input-label{font-size:0.78rem;color:#5A3D20;margin-bottom:6px;font-weight:500}
.jpc-name-input-label .jpc-hint{color:#7A6F62;font-weight:400;font-size:0.72rem;margin-left:4px}
.jpc-name-input{width:100%;padding:10px 12px;border:1.5px solid rgba(212,175,55,0.4);border-radius:10px;background:#FFFEF8;font-family:'Anuphan',sans-serif;font-size:0.92rem;color:#3D3228;outline:none;transition:border-color 0.2s,box-shadow 0.2s;box-sizing:border-box}
.jpc-name-input:focus{border-color:#D4AF37;box-shadow:0 0 0 3px rgba(212,175,55,0.15)}

.jpc-add-btn{width:100%;margin-top:10px;padding:12px;background:linear-gradient(135deg,#722F37 0%,#8B2252 55%,#D4AF37 100%);color:#FFF5E1;border:none;border-radius:10px;font-family:'Cinzel','Anuphan',sans-serif;font-size:0.85rem;font-weight:700;letter-spacing:1.3px;cursor:pointer;transition:transform 0.15s,box-shadow 0.2s,opacity 0.2s;display:flex;align-items:center;justify-content:center;gap:8px;text-transform:uppercase}
.jpc-add-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 16px rgba(139,34,82,0.3)}
.jpc-add-btn:active:not(:disabled){transform:translateY(0)}
.jpc-add-btn:disabled{opacity:0.45;cursor:not-allowed}

/* ─── COLLAPSIBLE ADD PANEL (trigger button + slide-down form) ─── */
.jpc-add-trigger{width:100%;padding:13px 16px;background:linear-gradient(135deg,#722F37 0%,#8B2252 55%,#D4AF37 100%);color:#FFF5E1;border:none;border-radius:12px;font-family:'Cinzel','Anuphan',sans-serif;font-size:0.86rem;font-weight:700;letter-spacing:1.3px;cursor:pointer;transition:transform 0.15s,box-shadow 0.2s;display:flex;align-items:center;justify-content:center;gap:10px;text-transform:uppercase;position:relative;box-shadow:0 4px 12px rgba(139,34,82,0.18)}
.jpc-add-trigger:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(139,34,82,0.32)}
.jpc-add-trigger:active{transform:translateY(0)}
.jpc-add-trigger.expanded{box-shadow:0 4px 12px rgba(139,34,82,0.25),inset 0 2px 6px rgba(0,0,0,0.12)}
.jpc-trigger-icon{width:22px;height:22px;background:rgba(255,245,225,0.18);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;transition:transform 0.35s cubic-bezier(0.4,0,0.2,1);flex-shrink:0;color:#FFF5E1}
.jpc-add-trigger.expanded .jpc-trigger-icon{transform:rotate(135deg);background:rgba(255,245,225,0.28)}

.jpc-add-panel{max-height:0;overflow:hidden;opacity:0;margin-top:0;transition:max-height 0.4s cubic-bezier(0.25,0.46,0.45,0.94),opacity 0.25s ease 0.05s,margin-top 0.3s ease}
.jpc-add-panel.show{max-height:640px;opacity:1;margin-top:14px}
.jpc-add-panel-inner{padding:0}

.jpc-divider{height:1px;background:linear-gradient(90deg,transparent 0%,rgba(212,175,55,0.4) 50%,transparent 100%);margin:18px 0 14px}

.jpc-controls{display:flex;gap:8px;margin-bottom:12px}
.jpc-controls select{flex:1;min-width:0;padding:8px 12px;border:1px solid rgba(212,175,55,0.4);border-radius:8px;background:#FFFEF8;font-family:'Anuphan',sans-serif;font-size:0.8rem;color:#3D3228;cursor:pointer;outline:none;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238B6914' stroke-width='2.5' stroke-linecap='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:30px}
.jpc-controls select:focus{border-color:#D4AF37}

.jpc-empty{text-align:center;padding:32px 16px;color:#7A6F62;font-size:0.88rem;line-height:1.6;background:#FFFEF8;border:1px dashed rgba(212,175,55,0.4);border-radius:12px}
.jpc-empty-icon{font-size:1.8rem;color:#D4AF37;margin-bottom:8px;opacity:0.65;line-height:1}
.jpc-empty-sub{font-size:0.78rem;opacity:0.7;margin-top:4px;display:block}

/* ─── TABLE ───────────────────────────────────────────── */
.jpc-table-wrap{background:#FFFEF8;border:1.5px solid rgba(212,175,55,0.4);border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(114,47,55,0.04)}
.jpc-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;font-family:'Anuphan',sans-serif}

.jpc-thead{background:linear-gradient(180deg,#FFFEF8 0%,#F5EDD8 100%)}
.jpc-th{padding:12px 14px;font-family:'Cinzel',serif;font-size:0.66rem;font-weight:700;color:#8B6914;letter-spacing:1.3px;text-transform:uppercase;cursor:pointer;user-select:none;border-bottom:1.5px solid rgba(212,175,55,0.45);position:relative;transition:background 0.15s,color 0.15s;text-align:left;line-height:1.3}
.jpc-th:hover{background:rgba(212,175,55,0.12);color:#722F37}
.jpc-th.numeric{text-align:right;padding-right:26px}
.jpc-th:not(.numeric){padding-right:24px}
.jpc-th.active{color:#722F37;background:rgba(212,175,55,0.08)}
.jpc-arrow{position:absolute;top:50%;right:8px;transform:translateY(-50%);font-size:0.55rem;opacity:0;pointer-events:none;transition:opacity 0.2s;color:#722F37;line-height:1}
.jpc-th.active .jpc-arrow{opacity:1}
.jpc-th.active.desc .jpc-arrow::before{content:'\\25BC'}
.jpc-th.active.asc .jpc-arrow::before{content:'\\25B2'}

.jpc-tr-data{cursor:pointer}
.jpc-tr-data > .jpc-td{transition:background 0.15s}
.jpc-tr-data:hover > .jpc-td{background:rgba(212,175,55,0.06)}
.jpc-tr-data.expanded > .jpc-td{background:rgba(212,175,55,0.1)}
.jpc-tr-data.expanded > .jpc-td:first-child{box-shadow:inset 3px 0 0 0 #D4AF37}

.jpc-td{padding:12px 14px;border-bottom:1px solid rgba(212,175,55,0.18);position:relative;vertical-align:middle}

/* Name cell */
.jpc-td.name{display:flex;align-items:center;gap:8px;overflow:hidden}
.jpc-entry-badge{font-family:'Cinzel',serif;font-size:0.6rem;font-weight:700;letter-spacing:0.9px;padding:3px 7px;border-radius:6px;background:rgba(139,34,82,0.1);color:#722F37;text-transform:uppercase;flex-shrink:0;border:1px solid rgba(139,34,82,0.22);line-height:1}
.jpc-entry-badge[data-strategy="sp500-strategy-pro"]{background:rgba(46,159,95,0.13);color:#1F7D49;border-color:rgba(46,159,95,0.28)}
.jpc-entry-badge[data-strategy="sp500-rolling-6m-momentum"]{background:rgba(212,175,55,0.18);color:#8B6914;border-color:rgba(212,175,55,0.42)}
.jpc-name-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.92rem;color:#3D3228;font-weight:500}
.jpc-row-chevron{color:#8B6914;opacity:0.45;transition:transform 0.25s ease,opacity 0.2s;flex-shrink:0;width:13px;height:13px}
.jpc-tr-data:hover .jpc-row-chevron{opacity:0.8}
.jpc-tr-data.expanded .jpc-row-chevron{transform:rotate(180deg);opacity:1;color:#722F37}

/* Numeric cells with data bars */
.jpc-td.numeric{text-align:right;padding:12px 14px;font-family:'DM Serif Display',serif}
.jpc-bar{position:absolute;top:6px;bottom:6px;right:6px;border-radius:5px;z-index:0;pointer-events:none;transition:width 0.45s cubic-bezier(0.25,0.46,0.45,0.94)}
.jpc-bar.cagr-pos{background:linear-gradient(270deg,rgba(46,159,95,0.34) 0%,rgba(46,159,95,0.16) 100%)}
.jpc-bar.cagr-neg{background:linear-gradient(270deg,rgba(193,69,69,0.32) 0%,rgba(193,69,69,0.14) 100%)}
.jpc-bar.dd{background:linear-gradient(270deg,rgba(193,69,69,0.32) 0%,rgba(193,69,69,0.14) 100%)}
.jpc-val{position:relative;z-index:1;font-size:1rem;line-height:1;letter-spacing:0.3px;font-feature-settings:"tnum" 1}
.jpc-val.pos{color:#1F7D49}
.jpc-val.neg{color:#9C2B2B}

/* Detail (expanded) row */
.jpc-detail-row{display:none}
.jpc-detail-row.show{display:table-row}
.jpc-detail-row > td{padding:0;background:linear-gradient(180deg,rgba(245,237,216,0.5) 0%,rgba(255,254,248,0.7) 100%);border-bottom:1px solid rgba(212,175,55,0.25);box-shadow:inset 3px 0 0 0 #D4AF37}
.jpc-detail-inner{padding:14px 18px 16px}
.jpc-summary-line{font-size:0.8rem;color:#7A6F62;padding:0 0 10px;line-height:1.55;border-bottom:1px dashed rgba(212,175,55,0.28);margin-bottom:12px}
.jpc-config-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px}
.jpc-config-item{display:flex;flex-direction:column;gap:2px;min-width:0}
.jpc-config-key{font-family:'Cinzel',serif;font-size:0.6rem;font-weight:700;color:#8B6914;letter-spacing:0.8px;text-transform:uppercase}
.jpc-config-val{font-size:0.85rem;color:#3D3228;font-weight:500;word-break:break-word}
.jpc-saved-at{margin-top:12px;padding-top:9px;border-top:1px dashed rgba(212,175,55,0.25);font-size:0.72rem;color:#7A6F62;text-align:right}
.jpc-detail-actions{display:flex;justify-content:flex-end;margin-top:12px;padding-top:10px;border-top:1px dashed rgba(212,175,55,0.25)}
.jpc-row-delete{background:#FFFEF8;border:1px solid rgba(193,69,69,0.4);color:#9C2B2B;padding:7px 14px;border-radius:8px;font-family:'Anuphan',sans-serif;font-size:0.8rem;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:background 0.15s,border-color 0.15s,transform 0.1s}
.jpc-row-delete:hover{background:rgba(193,69,69,0.08);border-color:rgba(193,69,69,0.6)}
.jpc-row-delete:active{transform:scale(0.97)}

@media (max-width:600px){
  .jpc-modal{width:calc(100vw - 16px);max-height:calc(100vh - 32px)}
  .jpc-modal-body{padding:16px 16px}
  .jpc-modal-header{padding:16px 18px 12px}
  .jpc-modal-title{font-size:1.15rem}
  .jpc-config-grid{grid-template-columns:1fr;gap:10px}
  .jpc-kpi-cell-value{font-size:1.4rem}
  .jpc-th{padding:11px 10px;font-size:0.62rem;letter-spacing:1px}
  .jpc-th.numeric{padding-right:22px}
  .jpc-th:not(.numeric){padding-right:20px}
  .jpc-td{padding:11px 10px}
  .jpc-td.numeric{padding:11px 10px}
  .jpc-name-text{font-size:0.88rem}
  .jpc-val{font-size:0.95rem}
  .jpc-entry-badge{font-size:0.55rem;padding:3px 6px;letter-spacing:0.6px}
  .jpc-detail-inner{padding:12px 14px 14px}
}

/* Toast */
.jpc-toast{position:fixed;left:50%;top:24px;transform:translate(-50%,-100%);z-index:2000;padding:12px 18px;background:#FFFEF8;border:1.5px solid rgba(212,175,55,0.5);border-radius:10px;box-shadow:0 8px 24px rgba(114,47,55,0.2);font-family:'Anuphan',sans-serif;font-size:0.88rem;color:#3D3228;opacity:0;transition:opacity 0.25s, transform 0.25s;pointer-events:none;max-width:90vw;text-align:center}
.jpc-toast.show{opacity:1;transform:translate(-50%,0)}
.jpc-toast.ok{border-color:rgba(46,159,95,0.5);color:#1F7D49;background:#F4FBF6}
.jpc-toast.err{border-color:rgba(193,69,69,0.5);color:#9C2B2B;background:#FBF4F4}
`;
    const styleEl = document.createElement('style');
    styleEl.id = 'jpc-styles';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  // ─── FAB INJECTION ───────────────────────────────────────
  function _injectFab(){
    const stack = document.querySelector('.fab-stack');
    if(!stack){
      console.warn('[jp-compare] .fab-stack not found — FAB cannot be injected');
      return;
    }
    const btn = document.createElement('button');
    btn.className = 'fab fab-secondary';
    btn.id = 'jpc-fab';
    btn.setAttribute('aria-label', 'เปรียบเทียบกลยุทธ์');
    btn.innerHTML = `
      <svg width="32" height="22" viewBox="0 0 32 22" fill="none" stroke="#FFF5E1" stroke-width="2.6" stroke-linecap="round" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.3))">
        <line x1="3" y1="11" x2="11" y2="11"/>
        <line x1="7" y1="7" x2="7" y2="15"/>
        <line x1="18" y1="11" x2="29" y2="11"/>
        <line x1="23.5" y1="5.5" x2="23.5" y2="16.5"/>
      </svg>
      <span class="jpc-fab-tooltip">เปรียบเทียบกลยุทธ์</span>
    `;
    btn.addEventListener('click', _openModal);
    stack.insertBefore(btn, stack.firstChild);
  }

  // ─── MODAL INJECTION ─────────────────────────────────────
  function _injectModal(){
    _backdrop = document.createElement('div');
    _backdrop.className = 'jpc-backdrop';
    _backdrop.addEventListener('click', _closeModal);
    document.body.appendChild(_backdrop);

    _modalEl = document.createElement('div');
    _modalEl.className = 'jpc-modal';
    _modalEl.setAttribute('role', 'dialog');
    _modalEl.setAttribute('aria-labelledby', 'jpc-modal-title');
    _modalEl.innerHTML = `
      <div class="jpc-modal-header">
        <div class="jpc-modal-title" id="jpc-modal-title">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="6" x2="14" y2="6"/>
            <line x1="3" y1="12" x2="10" y2="12"/>
            <line x1="3" y1="18" x2="17" y2="18"/>
            <circle cx="20" cy="9" r="2"/>
            <line x1="20" y1="6.5" x2="20" y2="11.5"/>
            <line x1="17.5" y1="9" x2="22.5" y2="9"/>
          </svg>
          เปรียบเทียบกลยุทธ์
        </div>
        <button class="jpc-modal-close" aria-label="ปิด">✕</button>
      </div>
      <div class="jpc-modal-body">
        <button class="jpc-add-trigger" id="jpc-add-trigger" aria-expanded="false">
          <span class="jpc-trigger-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </span>
          เพิ่มรายการเปรียบเทียบ
        </button>
        <div class="jpc-add-panel" id="jpc-add-panel">
          <div class="jpc-add-panel-inner">
            <div class="jpc-section-label">ผลปัจจุบัน</div>
            <div class="jpc-current-card" id="jpc-current"></div>
            <div class="jpc-name-input-wrap">
              <div class="jpc-name-input-label">ตั้งชื่อสำหรับเปรียบเทียบ <span class="jpc-hint">(สูงสุด 40 ตัวอักษร)</span></div>
              <input type="text" class="jpc-name-input" id="jpc-name" placeholder="เช่น 6M Top 15 Default" maxlength="40">
              <button class="jpc-add-btn" id="jpc-add">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                บันทึกเข้ารายการเปรียบเทียบ
              </button>
            </div>
          </div>
        </div>
        <div class="jpc-divider"></div>
        <div class="jpc-section-label">รายการที่บันทึกไว้ <span id="jpc-count" class="jpc-count-tag"></span></div>
        <div class="jpc-controls">
          <select id="jpc-filter">
            <option value="all">ทุกกลยุทธ์</option>
            <option value="sp500-strategy-pro">6M Momentum</option>
            <option value="sp500-combined-strategy">Weekly Momentum</option>
            <option value="sp500-rolling-6m-momentum">Rolling 6M</option>
          </select>
        </div>
        <div id="jpc-list"></div>
      </div>
    `;
    document.body.appendChild(_modalEl);

    _modalEl.querySelector('.jpc-modal-close').addEventListener('click', _closeModal);
    _modalEl.querySelector('#jpc-add-trigger').addEventListener('click', () => _toggleAddPanel());
    _modalEl.querySelector('#jpc-add').addEventListener('click', _addEntry);
    _modalEl.querySelector('#jpc-name').addEventListener('keydown', e => {
      if(e.key === 'Enter') _addEntry();
    });
    _modalEl.querySelector('#jpc-filter').addEventListener('change', e => {
      _filterKey = e.target.value;
      _renderList();
    });
    document.addEventListener('keydown', e => {
      if(e.key === 'Escape' && _modalEl.classList.contains('show')) _closeModal();
    });
  }

  // ─── MODAL OPEN/CLOSE ────────────────────────────────────
  function _openModal(){
    _renderList();
    _modalEl.querySelector('#jpc-filter').value = _filterKey;
    _modalEl.querySelector('#jpc-name').value = '';
    _toggleAddPanel(false);  // ensure add-form starts collapsed
    _backdrop.classList.add('show');
    _modalEl.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function _toggleAddPanel(forceState){
    const trigger = _modalEl.querySelector('#jpc-add-trigger');
    const panel = _modalEl.querySelector('#jpc-add-panel');
    if(!trigger || !panel) return;
    const isOpen = panel.classList.contains('show');
    const targetOpen = (typeof forceState === 'boolean') ? forceState : !isOpen;

    if(targetOpen){
      _renderCurrent();  // refresh snapshot with live values from page
      panel.classList.add('show');
      trigger.classList.add('expanded');
      trigger.setAttribute('aria-expanded', 'true');
      // Focus name input once the panel is visible enough to receive caret
      setTimeout(() => {
        const inp = _modalEl.querySelector('#jpc-name');
        if(inp) inp.focus();
      }, 220);
    } else {
      panel.classList.remove('show');
      trigger.classList.remove('expanded');
      trigger.setAttribute('aria-expanded', 'false');
    }
  }

  function _closeModal(){
    _backdrop.classList.remove('show');
    _modalEl.classList.remove('show');
    document.body.style.overflow = '';
  }

  // ─── RENDER: CURRENT ─────────────────────────────────────
  function _renderCurrent(){
    const result = _config.getCurrentResult() || {};
    const cur = _modalEl.querySelector('#jpc-current');
    const cagr = Number(result.cagr) || 0;
    const maxDD = Number(result.maxDD) || 0;
    const cagrPos = cagr >= 0;
    const cagrSign = cagrPos ? '+' : '−';
    const cagrStr = cagrSign + Math.abs(cagr).toFixed(1) + '%';
    const ddStr = '−' + Math.abs(maxDD).toFixed(1) + '%';
    const summaryHtml = result.summary ? `<div class="jpc-current-summary">${_esc(result.summary)}</div>` : '';
    cur.innerHTML = `
      <div class="jpc-current-strategy">${_esc(_config.strategyLabel)}</div>
      <div class="jpc-kpi-row">
        <div class="jpc-kpi-cell">
          <div class="jpc-kpi-cell-label">CAGR</div>
          <div class="jpc-kpi-cell-value ${cagrPos ? 'pos' : 'neg'}">${cagrStr}</div>
        </div>
        <div class="jpc-kpi-cell">
          <div class="jpc-kpi-cell-label">Max DD</div>
          <div class="jpc-kpi-cell-value neg">${ddStr}</div>
        </div>
      </div>
      ${summaryHtml}
    `;
    const addBtn = _modalEl.querySelector('#jpc-add');
    const isStub = !cagr;
    addBtn.disabled = isStub;
    addBtn.title = isStub ? 'รอผลแบ็คเทสคำนวณเสร็จก่อน' : '';
  }

  // ─── RENDER: TABLE ───────────────────────────────────────
  function _renderList(){
    const list = _modalEl.querySelector('#jpc-list');
    const countEl = _modalEl.querySelector('#jpc-count');
    let arr = _read();
    const total = arr.length;

    if(_filterKey !== 'all'){
      arr = arr.filter(e => e.strategyKey === _filterKey);
    }

    arr.sort(_sortFn);

    countEl.textContent = arr.length === total ? `(${total})` : `(${arr.length} / ${total})`;

    if(arr.length === 0){
      const emptyMsg = total === 0
        ? `ยังไม่มีรายการที่บันทึก<span class="jpc-empty-sub">รันแบ็คเทสแล้วกดบันทึกด้านบนเพื่อเริ่ม</span>`
        : `ไม่พบรายการตามตัวกรอง<span class="jpc-empty-sub">ลองเปลี่ยนตัวกรองด้านบน</span>`;
      list.innerHTML = `<div class="jpc-empty"><div class="jpc-empty-icon">⚖</div>${emptyMsg}</div>`;
      return;
    }

    // Compute max for data bars
    const maxCagrAbs = Math.max.apply(null, arr.map(e => Math.abs(Number(e.cagr) || 0)).concat([0.01]));
    const maxDDAbs = Math.max.apply(null, arr.map(e => Math.abs(Number(e.maxDD) || 0)).concat([0.01]));

    // Header
    const cols = [
      { key: 'name', label: 'ชื่อ', cls: '' },
      { key: 'cagr', label: 'CAGR', cls: 'numeric' },
      { key: 'dd',   label: 'Max DD', cls: 'numeric' }
    ];
    const headerHtml = '<thead class="jpc-thead"><tr>' + cols.map(c => {
      const active = _sortBy === c.key;
      const cls = ['jpc-th', c.cls, active ? 'active' : '', active ? (_sortDesc ? 'desc' : 'asc') : ''].filter(Boolean).join(' ');
      return `<th class="${cls}" data-sort="${c.key}">${c.label}<span class="jpc-arrow"></span></th>`;
    }).join('') + '</tr></thead>';

    const bodyHtml = '<tbody>' + arr.map(e => _entryHtml(e, maxCagrAbs, maxDDAbs)).join('') + '</tbody>';

    list.innerHTML = `
      <div class="jpc-table-wrap">
        <table class="jpc-table">
          <colgroup><col><col style="width:96px"><col style="width:96px"></colgroup>
          ${headerHtml}
          ${bodyHtml}
        </table>
      </div>
    `;

    // Bind events
    list.querySelectorAll('.jpc-th[data-sort]').forEach(th => {
      th.addEventListener('click', () => _setSort(th.dataset.sort));
    });
    list.querySelectorAll('.jpc-tr-data').forEach(tr => {
      tr.addEventListener('click', ev => {
        if(ev.target.closest('.jpc-row-delete')) return;
        _toggleExpand(tr.dataset.id);
      });
    });
    list.querySelectorAll('.jpc-row-delete').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        _deleteEntry(btn.dataset.id);
      });
    });
  }

  function _entryHtml(e, maxCagrAbs, maxDDAbs){
    const cagr = Number(e.cagr) || 0;
    const maxDD = Number(e.maxDD) || 0;
    const cagrPos = cagr >= 0;
    const cagrSign = cagrPos ? '+' : '−';
    const cagrStr = cagrSign + Math.abs(cagr).toFixed(1) + '%';
    const ddStr = '−' + Math.abs(maxDD).toFixed(1) + '%';
    const expanded = _expandedId === e.id;
    const badgeShort = _shortLabel(e.strategyKey);

    // Bar widths — proportional to max in visible set; min 5%, max 100%
    const cagrPct = Math.min(100, Math.max(5, Math.abs(cagr) / maxCagrAbs * 100));
    const ddPct = Math.min(100, Math.max(5, Math.abs(maxDD) / maxDDAbs * 100));

    const cfg = e.config || {};
    const cfgItems = Object.keys(cfg).map(k =>
      `<div class="jpc-config-item"><div class="jpc-config-key">${_esc(k)}</div><div class="jpc-config-val">${_esc(String(cfg[k]))}</div></div>`
    ).join('');
    const summaryHtml = e.summary ? `<div class="jpc-summary-line">${_esc(e.summary)}</div>` : '';
    const savedDate = e.savedAt ? _fmtSavedAt(e.savedAt) : '';

    return `<tr class="jpc-tr-data${expanded ? ' expanded' : ''}" data-id="${_esc(e.id)}">
  <td class="jpc-td name">
    <span class="jpc-entry-badge" data-strategy="${_esc(e.strategyKey)}">${_esc(badgeShort)}</span>
    <span class="jpc-name-text" title="${_esc(e.listName)}">${_esc(e.listName)}</span>
    <svg class="jpc-row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
  </td>
  <td class="jpc-td numeric">
    <div class="jpc-bar ${cagrPos ? 'cagr-pos' : 'cagr-neg'}" style="width:${cagrPct.toFixed(1)}%"></div>
    <span class="jpc-val ${cagrPos ? 'pos' : 'neg'}">${cagrStr}</span>
  </td>
  <td class="jpc-td numeric">
    <div class="jpc-bar dd" style="width:${ddPct.toFixed(1)}%"></div>
    <span class="jpc-val neg">${ddStr}</span>
  </td>
</tr>
<tr class="jpc-detail-row${expanded ? ' show' : ''}" data-for="${_esc(e.id)}">
  <td colspan="3">
    <div class="jpc-detail-inner">
      ${summaryHtml}
      ${cfgItems ? `<div class="jpc-config-grid">${cfgItems}</div>` : ''}
      ${savedDate ? `<div class="jpc-saved-at">บันทึกเมื่อ ${savedDate}</div>` : ''}
      <div class="jpc-detail-actions">
        <button class="jpc-row-delete" data-id="${_esc(e.id)}" aria-label="ลบรายการนี้">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
          ลบรายการ
        </button>
      </div>
    </div>
  </td>
</tr>`;
  }

  function _toggleExpand(id){
    _expandedId = (_expandedId === id) ? null : id;
    _renderList();
  }

  // ─── SORT ────────────────────────────────────────────────
  function _setSort(by){
    if(_sortBy === by){
      _sortDesc = !_sortDesc;
    } else {
      _sortBy = by;
      // Sensible default per column on first click — show "best/most useful" first
      _sortDesc = (by === 'cagr');     // CAGR: high → low (best first)
      // Name: asc (ก→อ / A→Z), DD: asc by |DD| (smallest loss first = best)
    }
    _renderList();
  }

  function _sortFn(a, b){
    let cmp = 0;
    switch(_sortBy){
      case 'name':
        cmp = (a.listName || '').localeCompare(b.listName || '', 'th');
        break;
      case 'cagr':
        cmp = (Number(a.cagr) || 0) - (Number(b.cagr) || 0);
        break;
      case 'dd':
        cmp = Math.abs(Number(a.maxDD) || 0) - Math.abs(Number(b.maxDD) || 0);
        break;
    }
    if(cmp === 0) cmp = (a.savedAt || 0) - (b.savedAt || 0);
    return _sortDesc ? -cmp : cmp;
  }

  // ─── ACTIONS ─────────────────────────────────────────────
  function _addEntry(){
    const result = _config.getCurrentResult() || {};
    const cagr = Number(result.cagr) || 0;
    if(!cagr){
      _toast('กรุณารอให้ผลแบ็คเทสคำนวณเสร็จก่อน', 'err');
      return;
    }
    const nameInput = _modalEl.querySelector('#jpc-name');
    let name = (nameInput.value || '').trim();
    if(!name){
      const arr = _read();
      const sameStrategy = arr.filter(e => e.strategyKey === _config.strategyKey);
      name = `${_config.strategyLabel} ${sameStrategy.length + 1}`;
    }
    if(name.length > 40) name = name.slice(0, 40);

    const entry = {
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      strategyKey: _config.strategyKey,
      strategyLabel: _config.strategyLabel,
      listName: name,
      cagr: cagr,
      maxDD: Number(result.maxDD) || 0,
      summary: result.summary || '',
      config: result.config || {},
      savedAt: Date.now()
    };

    const arr = _read();
    arr.push(entry);
    if(_write(arr)){
      _toast(`บันทึก "${name}" แล้ว`, 'ok');
      nameInput.value = '';
      _expandedId = entry.id;
      _renderList();
      _toggleAddPanel(false);  // collapse the add form so only the trigger button remains
    }
  }

  function _deleteEntry(id){
    const arr = _read();
    const i = arr.findIndex(e => e.id === id);
    if(i < 0) return;
    const removed = arr[i];
    arr.splice(i, 1);
    if(_write(arr)){
      _toast(`ลบ "${removed.listName}" แล้ว`, 'ok');
      if(_expandedId === id) _expandedId = null;
      _renderList();
    }
  }

  // ─── HELPERS ─────────────────────────────────────────────
  function _shortLabel(strategyKey){
    switch(strategyKey){
      case 'sp500-strategy-pro':        return '6M';
      case 'sp500-combined-strategy':   return 'Weekly';
      case 'sp500-rolling-6m-momentum': return 'Rolling';
    }
    return (strategyKey || '?').slice(0, 8);
  }

  function _esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
    );
  }

  function _fmtSavedAt(ts){
    const d = new Date(ts);
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const day = d.getDate();
    const mo = months[d.getMonth()];
    const yr = d.getFullYear() + 543;
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    return `${day} ${mo} ${yr} · ${hh}:${mm}`;
  }

  function _toast(msg, kind){
    let t = document.querySelector('.jpc-toast');
    if(!t){
      t = document.createElement('div');
      t.className = 'jpc-toast';
      document.body.appendChild(t);
    }
    t.className = 'jpc-toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  window.JPCompare = { init };
})();
