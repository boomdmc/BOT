# Battle of Talingchan — เล่นกับ AI (เว็บ)

โหมดเดียว: ผู้เล่น vs AI · กติกาอ้างอิง Rule Book Ver. 3.2 (สรุปไว้ใน `RULES_SPEC.md`)

## เปิดเล่นในเครื่อง
```
python -m http.server 8765
```
แล้วเปิด http://localhost:8765/index.html (ต้องเปิดผ่านเซิร์ฟเวอร์ ไม่ใช่ดับเบิลคลิกไฟล์ เพราะโหลด JSON ด้วย fetch)

## อัปขึ้น GitHub Pages
1. สร้าง repo แล้ว push โฟลเดอร์นี้ทั้งหมด (รวม `data/`, `img/`, `js/`, `css/`, `index.html`, `.nojekyll`)
2. Settings → Pages → Branch: `main` / root
3. เปิด `https://<user>.github.io/<repo>/`

## ทดสอบกติกา
```
node tools/rules_test.js        # ตรวจกติกาหลัก (จ่าย GEM, Phase, LIFE, การต่อสู้ ฯลฯ)
node tools/sim.js 3000          # AI สู้กับ AI ด้วยเด็คจริง
node tools/sim.js 8000 --random # เด็คสุ่ม เพื่อหาข้อผิดพลาดของความสามารถการ์ด
node tools/coverage.js          # ดูว่าฟีเจอร์ไหนยังไม่รองรับ
```

## ข้อจำกัดที่ทราบ
- ความสามารถของการ์ดอ่านจาก `data/abilities.json` + `ability_patches.json` (ข้อมูลชุดเดียวกับเกมเดิม) engine ฝั่งเว็บเขียนใหม่ จึงรองรับ 1,222 จาก 1,433 ใบ
- การ์ดที่ยังไม่รองรับจะถูกแทนที่ในเด็คอัตโนมัติด้วยการ์ดชนิด/สี/Cost ใกล้เคียง
- รูปการ์ดมีลายน้ำ SAMPLE ติดมาจากไฟล์ต้นฉบับ
