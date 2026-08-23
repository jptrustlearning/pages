import pandas as pd, numpy as np, json, sys
D='/home/claude/sp500/'
cols=['Ticker','Date','Close','Volume']
s=pd.concat([pd.read_csv(D+'input_sp500_daily_since2001.csv',usecols=cols), pd.read_csv(D+'input_sp500_daily.csv',usecols=cols)]).drop_duplicates(['Ticker','Date'])
dl=pd.read_csv(D+'input_sp500_delisted_hist.csv',usecols=cols)
dl=dl[dl.Date>='2001-01-01']
# keep survivors' rows when both present (2 overlaps); otherwise union
dl=dl[~dl.Ticker.isin(set(s.Ticker))]
px=pd.concat([s,dl]).drop_duplicates(['Ticker','Date'])
spy=pd.read_csv(D+'input_benchmark_daily.csv',usecols=cols); spy=spy[spy.Ticker=='SPY'].set_index('Date').Close
close=px.pivot(index='Date',columns='Ticker',values='Close').sort_index()
vol=px.pivot(index='Date',columns='Ticker',values='Volume').sort_index().fillna(0)
dates=list(close.index); didx={d:i for i,d in enumerate(dates)}
REBAL=[1,7]  # Feb, Aug (0-based months)
W_RET=0.5; TOPN=10

def first_idx_in_month(y,m):
    for i,d in enumerate(dates):
        if int(d[:4])==y and int(d[5:7])-1==m: return i
    return -1
def prev_anchor(y,m):
    # previous rebal month
    if m==1: return (y-1,7)
    return (y,1)
def rank(end_i,start_i):
    pe=close.iloc[end_i]; ps=close.iloc[start_i]
    ok=pe.notna()&ps.notna()
    ret=(pe[ok]-ps[ok])/ps[ok]
    v=vol.iloc[start_i:end_i+1][ok[ok].index].sum()
    df=pd.DataFrame({'ret':ret,'vol':v})
    df['rr']=df.ret.rank(ascending=False,method='first')-1
    df['rv']=df.vol.rank(ascending=False,method='first')-1
    df['score']=df.rr*W_RET+df.rv*(1-W_RET)
    return df.sort_values('score')

def run(start_date,end_date,capital=10000.0):
    si=didx[start_date]; ei=didx[end_date]
    cash=capital; hold={}; last_px={}; curve=[]; last_month=None; rebals=[]
    for i in range(si,ei+1):
        d=dates[i]; y=int(d[:4]); m=int(d[5:7])-1; day=int(d[8:10])
        row=close.iloc[i]
        val=cash
        for t,sh in hold.items():
            p=row.get(t)
            if pd.notna(p): last_px[t]=p
            val+=sh*last_px.get(t,0)
        key=y*12+m
        if m in REBAL and day<=7 and key!=last_month:
            sig=i-1; py,pm=prev_anchor(y,m); pf=first_idx_in_month(py,pm)
            if pf>=0 and pf+1<sig:
                r=rank(sig,pf+1); sel=list(r.index[:TOPN])
                cash=val; hold={}; alloc=cash/TOPN
                for t in sel:
                    p=row.get(t)
                    if pd.notna(p): hold[t]=alloc/p; cash-=alloc; last_px[t]=p
                last_month=key; rebals.append({'date':d,'tickers':sel})
        curve.append((d,val))
    return curve,rebals

def month_ends(curve):
    out={}; 
    for d,v in curve: out[d[:7]]=(d,v)
    return out

scen={
 'gfc':  {'name':'วิกฤตการเงินโลก 2008','start':'2007-08-01','end':'2010-08-02','entry_hint':'เข้าระบบ ส.ค. 2007 — 2 เดือนก่อนจุดสูงสุดของตลาด'},
 'covid':{'name':'COVID-19 2020','start':'2020-02-03','end':'2022-02-01','entry_hint':'เข้าระบบ ก.พ. 2020 — 2 สัปดาห์ก่อนตลาดเริ่มดิ่ง'},
 'hike': {'name':'ปีดอกเบี้ยขึ้น 2022','start':'2022-02-01','end':'2024-02-01','entry_hint':'เข้าระบบ ก.พ. 2022 — ก่อน Fed เริ่มขึ้นดอกเบี้ยรอบใหญ่'},
}
out={}
for k,sc in scen.items():
    # snap start/end to trading days present
    sd=next(d for d in dates if d>=sc['start']); ed=max(d for d in dates if d<=sc['end'])
    curve,rebals=run(sd,ed)
    me=month_ends(curve)
    spy_me={}
    for d in spy.index:
        if sd<=d<=ed: spy_me[d[:7]]=(d,spy[d])
    months=sorted(me.keys())
    base=me[months[0]][1]; sbase=spy[sd]
    # use entry-day values as base (first curve point)
    base=curve[0][1]
    rows=[]; peak=base
    for mth in months:
        d,v=me[mth]; sp=spy_me.get(mth,(d,np.nan))[1]
        peak=max(peak,v)
        rows.append({'m':mth,'d':d,'s':round(v/base*100,2),'spy':round(sp/sbase*100,2),'dd':round((v-peak)/peak*100,1)})
    # rebal holdings within window
    out[k]={'name':sc['name'],'entry':sd,'hint':sc['entry_hint'],'rows':rows,'rebals':rebals}
    fin=rows[-1]; mn=min(rows,key=lambda r:r['s'])
    print(k, sd, ed, 'final',fin['s'],'spy',fin['spy'],'worst',mn['m'],mn['s'],'maxdd',min(r['dd'] for r in rows), 'rebals',[r['date'] for r in rebals])
json.dump(out,open('/home/claude/drill_data.json','w'),ensure_ascii=False)
