# approve-signup — อนุมัติ/ปฏิเสธการสมัครจากปุ่มในอีเมล (A129 · 20 ก.ย. 2026)

```
ลูกค้ากด submit (signup.html / ?renew=1)
  └─ signup-webhook  : CSV + สลิป → repo payment · สร้าง/ติดธงบัญชีแบบ HOLD (ไม่ grant)
                       · INSERT public.signup_requests (token สุ่ม เก็บเฉพาะ sha256)
                       · เมลลูกค้า "ได้รับใบสมัครแล้ว กำลังตรวจสอบ"
                       · เมล founder 2 คน + สลิปแนบ + ปุ่ม [อนุมัติ] [ปฏิเสธ]
founder กดปุ่มในเมล
  └─ app.jptrustlearning.com/approve.html?t=<token>   (เปิดเฉยๆ = อ่านอย่างเดียว)
       └─ กด "ยืนยันอนุมัติ" → POST approve-signup {token, action:"approve"}
            └─ SQL jpt_decide_request()  — atomic · นับวันครั้งเดียว ณ ตอนกด
                 = max(ตอนนี้, วันหมดอายุเดิม) + 30/365
            └─ เมลต้อนรับ/ต่ออายุสำเร็จ → ลูกค้า · เมลสรุป → founder · log → payment/member-decisions/
```

## ติดตั้งครั้งแรก (ทำตามลำดับ)
1. SQL Editor (ลบของเก่าในแท็บให้เกลี้ยงก่อน) → วางทั้งไฟล์ `supabase/migrations/jpt_signup_approval_v1.sql` → Run
2. PowerShell
   ```powershell
   cd C:\Users\PC\Documents\pages
   git pull origin main
   supabase functions deploy approve-signup
   supabase functions deploy signup-webhook
   ```
   ไม่ต้องตั้ง secret ใหม่ — ใช้ `GITHUB_PAT` / `RESEND_API_KEY` / `RESEND_FROM` ชุดเดิม (secret เป็นของทั้ง project)
3. ทดสอบด้วยอีเมลทดสอบ (เช่น joontest): สมัคร → ได้เมล "รออนุมัติ" → กดอนุมัติ → ลูกค้าได้เมลต้อนรับ → เข้าแอปได้

ถ้า deploy ฟังก์ชันก่อนรัน SQL: การสมัครยังสำเร็จและบัญชียังถูก hold (ไม่มีใครได้สิทธิ์ฟรี)
แต่อีเมล founder จะไม่มีปุ่ม มีแต่คำสั่ง `jpt_approve('email')` ให้ใช้แทน

## ทางสำรอง
`SELECT * FROM jpt_approve('email');` ใน SQL Editor ยังใช้ได้ — ถ้ามีคำขอในคิวจะอนุมัติคำขอนั้น (ตรรกะเดียวกับปุ่ม)

## Rollback
`signup-webhook/index-backup-v19.ts` = ตัวก่อน A129 (grant ทันทีแล้วให้ trigger ใน DB ดัก) — คัดลอกทับ `index.ts` แล้ว deploy
