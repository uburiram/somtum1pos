/**
 * Somtum1POS — shop open / tables / reset
 * Split from pos.js (lines 1048-1664)
 */
/* global M, db, shopRef, esc, money, toast, uid, sha256, calcPaymentCover, fileToDataUrl, PP */
(function () {
  'use strict';
  window.M = window.M || {};
  Object.assign(window.M, {
  applyShopOpenUI(isOpen){
    this.isOpen = isOpen!==false;
    const st=document.getElementById('shopOpenStatus');
    if(st){
      st.textContent = this.isOpen ? 'สถานะปัจจุบัน: เปิดร้าน' : 'สถานะปัจจุบัน: ปิดร้าน';
      st.style.color = this.isOpen ? '#2E7D32' : '#C62828';
    }
    const bo=document.getElementById('btnShopOpen');
    const bc=document.getElementById('btnShopClose');
    if(bo) bo.style.outline = this.isOpen ? '3px solid #2E7D32' : 'none';
    if(bc) bc.style.outline = !this.isOpen ? '3px solid #C62828' : 'none';
    // หัว POS
    let badge=document.getElementById('posShopOpenBadge');
    if(!badge){
      const title=document.getElementById('shopTitle');
      if(title && title.parentElement){
        badge=document.createElement('span');
        badge.id='posShopOpenBadge';
        badge.style.cssText='margin-left:8px;font-size:12px;font-weight:700;padding:3px 8px;border-radius:10px';
        title.parentElement.appendChild(badge);
      }
    }
    if(badge){
      if(this.isOpen){
        badge.textContent='เปิดร้าน';
        badge.style.background='#E8F5E9';
        badge.style.color='#2E7D32';
      } else {
        badge.textContent='ปิดร้าน';
        badge.style.background='#FFEBEE';
        badge.style.color='#C62828';
      }
    }
  },
  async setShopOpen(isOpen){
    try{
      await shopRef.collection('settings').doc('public').set({ isOpen: !!isOpen, shopOpenUpdatedAt: Date.now() }, {merge:true});
      this.applyShopOpenUI(!!isOpen);
      toast(isOpen ? 'เปิดร้านแล้ว · ลูกค้าสั่งอาหารได้' : 'ปิดร้านแล้ว · ลูกค้าสั่งอาหารไม่ได้');
    }catch(e){
      toast('อัปเดตสถานะร้านไม่สำเร็จ: '+(e.message||e));
    }
  },
  applyMemberSystemUI(enabled){
    this.memberSystemEnabled = enabled!==false;
    const st=document.getElementById('memberSystemStatus');
    if(st){
      st.textContent = this.memberSystemEnabled
        ? 'สถานะ: เปิด (ลูกค้าเห็นแต้ม/คูปอง)'
        : 'สถานะ: ปิด (หน้าสั่งแบบย่อ · ไม่มีสมาชิก/คูปอง)';
      st.style.color = this.memberSystemEnabled ? '#2E7D32' : '#C62828';
    }
    const on=document.getElementById('btnMemSysOn');
    const off=document.getElementById('btnMemSysOff');
    if(on) on.style.outline = this.memberSystemEnabled ? '3px solid #2E7D32' : 'none';
    if(off) off.style.outline = !this.memberSystemEnabled ? '3px solid #C62828' : 'none';
  },
  async setMemberSystem(enabled){
    try{
      await shopRef.collection('settings').doc('public').set({
        memberSystemEnabled: !!enabled,
        memberSystemUpdatedAt: Date.now()
      }, {merge:true});
      this.applyMemberSystemUI(!!enabled);
      toast(enabled
        ? 'เปิดระบบสมาชิกแล้ว · ลูกค้าเห็นแต้ม/คูปอง'
        : 'ปิดระบบสมาชิกแล้ว · หน้าสั่งลูกค้าจะสั้นลง');
    }catch(e){
      toast('อัปเดตระบบสมาชิกไม่สำเร็จ: '+(e.message||e));
    }
  },
  applyOrderModeUI(mode){
    this.orderMode = (mode==='table' || mode==='auto') ? mode : 'queue';
    const st=document.getElementById('orderModeStatus');
    if(st){
      st.textContent = this.orderMode==='table' ? 'โหมดปัจจุบัน: โต๊ะ' : (this.orderMode==='auto' ? 'โหมดปัจจุบัน: Auto · QR กำหนด คิว/โต๊ะอัตโนมัติ' : 'โหมดปัจจุบัน: คิว');
      st.style.color = this.orderMode==='table' ? '#6A1B9A' : (this.orderMode==='auto' ? '#00838F' : '#1565C0');
    }
    const bq=document.getElementById('btnModeQueue');
    const bt=document.getElementById('btnModeTable');
    const ba=document.getElementById('btnModeAuto');
    if(bq) bq.style.outline = this.orderMode==='queue' ? '3px solid #2E7D32' : 'none';
    if(bt) bt.style.outline = this.orderMode==='table' ? '3px solid #6A1B9A' : 'none';
    if(ba) ba.style.outline = this.orderMode==='auto' ? '3px solid #00838F' : 'none';
    const box=document.getElementById('tableModeSettings');
    if(box) box.style.display = (this.orderMode==='table' || this.orderMode==='auto') ? 'block' : 'none';
    const nav=document.getElementById('navTables');
    if(nav) nav.classList.toggle('hide', this.orderMode==='queue');
  },
  async setOrderMode(mode){
    mode = (mode==='table' || mode==='auto') ? mode : 'queue';
    try{
      await shopRef.collection('settings').doc('public').set({
        orderMode: mode,
        orderModeUpdatedAt: Date.now()
      }, {merge:true});
      this.applyOrderModeUI(mode);
      if(mode==='table' || mode==='auto'){
        toast(mode==='auto' ? 'เปิดโหมด Auto · QR โต๊ะ = ทานที่ร้าน / QR คิว = คิวรับอาหาร' : 'เปิดโหมดโต๊ะ · ใช้แท็บ 「โต๊ะ」จัดการ');
        try{ await this.ensureTables(Number(document.getElementById('setTableCount')?.value||this.tableCount||10)); }catch(e){}
        try{ this.renderTableQrList(); }catch(e){}
      } else {
        toast('เปิดโหมดคิว · ลูกค้าสั่งแบบคิวเลข A001');
      }
    }catch(e){ toast('เปลี่ยนโหมดไม่สำเร็จ: '+(e.message||e)); }
  },
  async saveTableCount(){
    let n=Math.floor(Number(document.getElementById('setTableCount')?.value||0));
    if(!(n>=1 && n<=500)){ toast('จำนวนโต๊ะต้อง 1–500'); return; }
    try{
      await shopRef.collection('settings').doc('public').set({
        orderMode:this.orderMode==='auto' ? 'auto' : 'table',
        tableCount:n,
        tableCountUpdatedAt:Date.now()
      },{merge:true});
      this.tableCount=n;
      this.applyOrderModeUI(this.orderMode==='auto' ? 'auto' : 'table');
      await this.ensureTables(n);
      this.renderTableQrList();
      toast('บันทึก '+n+' โต๊ะ และสร้าง QR แล้ว');
    }catch(e){ toast('บันทึกจำนวนโต๊ะไม่สำเร็จ: '+(e.message||e)); }
  },
  async ensureTables(n){
    n=Math.max(1, Math.min(500, Math.floor(Number(n)||10)));
    this.tableCount=n;
    let existing=new Map();
    try{
      const snap=await shopRef.collection('tables').get();
      snap.docs.forEach(d=>existing.set(d.id, d.data()||{}));
    }catch(e){ console.warn('ensureTables read', e); }
    const batch=db.batch();
    for(let i=1;i<=n;i++){
      const id=String(i);
      const ref=shopRef.collection('tables').doc(id);
      const cur=existing.get(id);
      if(cur){
        // โต๊ะที่มีอยู่แล้ว — ห้ามทับ activeOrderId / สถานะ occupied
        if(cur.activeOrderId) continue;
        batch.set(ref,{
          tableNo:i,
          updatedAt:Date.now()
        },{merge:true});
      } else {
        batch.set(ref,{
          tableNo:i,
          activeOrderId:null,
          status:'free',
          callStaff:false,
          callAt:0,
          callAckAt:0,
          updatedAt:Date.now()
        },{merge:true});
      }
    }
    await batch.commit();
  },
  tableOrderUrl(tableNo){
    // URL ลูกค้าแบบ absolute — กันสแกนไม่ได้จาก path ผิด / file://
    try{
      const base = (location.origin && location.origin !== 'null')
        ? location.origin + location.pathname.replace(/[^/]*$/, '')
        : '';
      let path = base + 'index.html';
      // ถ้าเปิดจาก pos.html ในโฟลเดอร์เดียวกัน
      if(!base){
        const u=new URL('index.html', location.href);
        path = u.href.split('?')[0];
      }
      const u=new URL(path, location.href);
      u.searchParams.set('table', String(tableNo));
      // ลบ hash ที่อาจทำให้แอปงง
      u.hash = '';
      return u.href;
    }catch(e){
      const origin=(location&&location.origin&&location.origin!=='null')?location.origin:'';
      return origin+'/index.html?table='+tableNo;
    }
  },
  /** สร้างรูป QR มีกรอบ + ข้อความโต๊ะ (สำหรับพิมพ์/บันทึก) */
  buildTableQrCard(tableNo, size){
    size = size || 280;
    const pageUrl = this.tableOrderUrl(tableNo);
    const canvas = document.createElement('canvas');
    const pad = 24;
    const qrSize = size;
    const headerH = 72;
    const footerH = 56;
    canvas.width = qrSize + pad * 2;
    canvas.height = headerH + qrSize + footerH + pad;
    const ctx = canvas.getContext('2d');
    // พื้นหลัง
    ctx.fillStyle = '#FFF8F5';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // กรอบ
    ctx.strokeStyle = '#E65100';
    ctx.lineWidth = 6;
    const r = 18;
    const x = 8, y = 8, w = canvas.width - 16, h = canvas.height - 16;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.stroke();
    // หัวข้อ
    ctx.fillStyle = '#BF360C';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('โต๊ะ ' + tableNo, canvas.width / 2, 40);
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#555';
    ctx.fillText('สแกน QR Code เพื่อสั่งอาหาร', canvas.width / 2, 64);
    // วาด QR จาก element ชั่วคราว
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(tmp);
    try{
      if(typeof QRCode === 'undefined') throw new Error('no QRCode lib');
      new QRCode(tmp, { text: String(pageUrl), width: qrSize, height: qrSize, correctLevel: QRCode.CorrectLevel.M });
      const srcCanvas = tmp.querySelector('canvas');
      const srcImg = tmp.querySelector('img');
      let drawn = false;
      if(srcCanvas){
        ctx.drawImage(srcCanvas, pad, headerH, qrSize, qrSize);
        drawn = true;
      } else if(srcImg && srcImg.src){
        // sync path often has canvas; if only img, skip async
      }
      if(!drawn && srcCanvas){
        ctx.drawImage(srcCanvas, pad, headerH, qrSize, qrSize);
      }
    }catch(e){ console.warn('buildTableQrCard', e); }
    try{ tmp.remove(); }catch(e){}
    // เท้า
    ctx.fillStyle = '#666';
    ctx.font = '12px sans-serif';
    ctx.fillText('ร้าน: ' + (this.shopName || document.getElementById('shopTitle')?.textContent || ''), canvas.width / 2, headerH + qrSize + 28);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#999';
    const short = pageUrl.length > 42 ? pageUrl.slice(0, 40) + '…' : pageUrl;
    ctx.fillText(short, canvas.width / 2, headerH + qrSize + 46);
    return canvas.toDataURL('image/png');
  },
  renderTableQrList(){
    const box = document.getElementById('tableQrList');
    if(!box) return;
    const n = Math.max(1, Math.min(100, Number(this.tableCount || document.getElementById('setTableCount')?.value || 10)));
    box.innerHTML = '<div style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">'+
      '<button type="button" class="btn btn-p btn-sm" style="width:auto" onclick="M.printAllTableQr()">🖨️ พิมพ์ QR ทุกโต๊ะ</button>'+
      '<button type="button" class="btn btn-o btn-sm" style="width:auto" onclick="M.downloadAllTableQr()">💾 บันทึกรูป QR ทุกโต๊ะ</button>'+
      '</div>';
    for(let i = 1; i <= n; i++){
      const url = this.tableOrderUrl(i);
      const card = document.createElement('div');
      card.style.cssText = 'background:#fff;border:1px solid #ddd;border-radius:12px;padding:10px;text-align:center';
      card.innerHTML = '<div style="font-weight:700;margin-bottom:6px;color:#BF360C">โต๊ะ '+i+'</div>'+
        '<div id="tqr_'+i+'" style="display:flex;justify-content:center;min-height:140px;padding:8px;background:#FFF8F5;border:2px solid #FFCCBC;border-radius:12px"></div>'+
        '<div style="font-size:12px;color:#555;margin-top:6px">สแกนเพื่อสั่งอาหาร</div>'+
        '<div style="font-size:10px;color:#888;word-break:break-all;margin-top:4px">'+url+'</div>'+
        '<button type="button" class="btn btn-o btn-sm" style="margin-top:6px;width:100%" onclick="M.downloadTableQr('+i+')">💾 บันทึกรูป (มีชื่อโต๊ะ)</button>'+
        '<button type="button" class="btn btn-o btn-sm" style="margin-top:4px;width:100%" onclick="M.printTableQr('+i+')">🖨️ พิมพ์</button>';
      box.appendChild(card);
      try{
        const el = document.getElementById('tqr_'+i);
        if(el && typeof QRCode !== 'undefined'){
          el.innerHTML = '';
          new QRCode(el, { text: url, width: 140, height: 140, correctLevel: QRCode.CorrectLevel.M });
        }
      }catch(e){}
    }
  },
  _tableQrDataUrl(tableNo){
    // ใช้การ์ดมีกรอบ+ชื่อโต๊ะเป็นหลัก
    try{
      const data = this.buildTableQrCard(tableNo, 260);
      if(data && data.length > 100) return data;
    }catch(e){}
    const el = document.getElementById('tqr_'+tableNo);
    if(!el) return '';
    const c = el.querySelector('canvas');
    if(c){ try{ return c.toDataURL('image/png'); }catch(e){} }
    const img = el.querySelector('img');
    if(img && img.src) return img.src;
    return '';
  },
  downloadTableQr(tableNo){
    const url = this._tableQrDataUrl(tableNo);
    if(!url){ toast('สร้าง QR ไม่สำเร็จ · ตรวจว่าเปิดผ่าน HTTPS/โดเมนจริง'); return; }
    const a = document.createElement('a');
    a.href = url;
    a.download = 'โต๊ะ-'+tableNo+'-QR-สั่งอาหาร.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('บันทึก QR โต๊ะ '+tableNo+' แล้ว');
  },
  async downloadAllTableQr(){
    const n = Math.max(1, Math.min(100, Number(this.tableCount || 10)));
    toast('กำลังบันทึก '+n+' รูป…');
    for(let i = 1; i <= n; i++){
      try{ this.downloadTableQr(i); }catch(e){}
      await new Promise(r => setTimeout(r, 200));
    }
  },
  printTableQr(tableNo){
    const data = this._tableQrDataUrl(tableNo);
    const pageUrl = this.tableOrderUrl(tableNo);
    const w = window.open('', '_blank', 'width=420,height=560');
    if(!w){ toast('อนุญาตป๊อปอัปเพื่อพิมพ์ QR'); return; }
    w.document.write('<html><head><title>โต๊ะ '+tableNo+'</title></head><body style="text-align:center;font-family:sans-serif;padding:16px">'+
      (data ? '<img src="'+data+'" style="max-width:100%">' : '<h2>โต๊ะ '+tableNo+'</h2><div id="q"></div>')+
      '<p style="font-size:12px;word-break:break-all">'+pageUrl+'</p>'+
      '<script>setTimeout(function(){window.print()},400);<\/script></body></html>');
    w.document.close();
  },
  printAllTableQr(){
    const n = Math.max(1, Math.min(100, Number(this.tableCount || 10)));
    const w = window.open('', '_blank');
    if(!w){ toast('อนุญาตป๊อปอัปเพื่อพิมพ์'); return; }
    let html = '<html><head><title>QR ทุกโต๊ะ</title><style>'+
      'body{font-family:sans-serif} .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}'+
      '.card{border:1px solid #ccc;border-radius:12px;padding:8px;text-align:center;break-inside:avoid}'+
      '@media print{.card{break-inside:avoid}}'+
      '</style></head><body><h1 style="text-align:center">QR สั่งอาหารตามโต๊ะ</h1><div class="grid">';
    for(let i = 1; i <= n; i++){
      const data = this._tableQrDataUrl(i);
      html += '<div class="card">'+(data ? '<img src="'+data+'" style="width:100%;max-width:280px">' : '<h2>โต๊ะ '+i+'</h2>')+'</div>';
    }
    html += '</div><script>setTimeout(function(){window.print()},600);<\/script></body></html>';
    w.document.write(html);
    w.document.close();
  },
  listenTables(){
    try{ if(this._unsubTables) this._unsubTables(); }catch(e){}
    if(!shopRef) return;
    this._unsubTables=shopRef.collection('tables').onSnapshot(snap=>{
      const list=[];
      snap.forEach(d=>list.push({id:d.id, ...d.data()}));
      list.sort((a,b)=>(a.tableNo||0)-(b.tableNo||0));
      this.tables=list;
      this.renderTablesBoard();
      this.handleTableCalls(list);
    }, e=>console.warn('tables', e));
  },
  renderTablesBoard(){
    const box=document.getElementById('tablesBoard');
    if(!box) return;
    const list=this.tables||[];
    if(!list.length){
      box.innerHTML='<div style="color:#888">ยังไม่มีโต๊ะ · ไปที่ตั้งค่า → โหมดโต๊ะ → บันทึกจำนวนโต๊ะ</div>';
      return;
    }
    box.innerHTML=list.map(t=>{
      const busy=!!t.activeOrderId;
      const call=!!t.callStaff;
      const ord=busy ? (this.orders||[]).find(o=>o.id===t.activeOrderId) : null;
      const ordDone=ord && (ord.status==='Completed' || ord.status==='Cancelled');
      const stLabel=ord ? (({Pending:'รอคิวทำ',AwaitingPayment:'รอคิวทำ',Cooking:'กำลังทำ',Ready:'ทำเสร็จแล้ว',Completed:'เสร็จสมบูรณ์',Cancelled:'ยกเลิก'})[ord.status]||ord.status) : '';
      const bg=call?'#FFEBEE':(busy?'#FFF8E1':'#E8F5E9');
      const border=call?'#C62828':(busy?'#FFB300':'#81C784');
      return '<div style="background:'+bg+';border:2px solid '+border+';border-radius:12px;padding:12px">'+
        '<div style="font-weight:800;font-size:18px">โต๊ะ '+(t.tableNo||t.id)+'</div>'+
        '<div style="font-size:12px;margin-top:4px">'+(call?'🔔 เรียกพนักงาน':(busy?'🟢 มีออเดอร์':'ว่าง'))+'</div>'+
        (t.activeOrderId?('<div style="font-size:11px;color:#666;margin-top:2px">ออเดอร์: '+String(t.activeOrderId).slice(0,8)+'…'+(stLabel?' · '+stLabel:'')+'</div>'):'')+
        (call?('<button class="btn btn-p btn-sm" style="margin-top:8px;width:100%" onclick="M.ackTableCall(\''+t.id+'\')">รับทราบการเรียก</button>'):'')+
        (busy && ordDone ? ('<button class="btn btn-d btn-sm" style="margin-top:6px;width:100%" onclick="M.clearTable(\''+t.id+'\')">เคลียร์โต๊ะ</button>') : '')+
        (busy && !ordDone ? ('<div style="font-size:11px;color:#999;margin-top:6px;text-align:center">เคลียร์ได้เมื่อเสร็จสมบูรณ์</div>') : '')+
        '</div>';
    }).join('');
  },
  handleTableCalls(list){
    const calling=(list||[]).filter(t=>t.callStaff);
    const badge=document.getElementById('navTableBadge');
    if(badge){
      if(calling.length){ badge.textContent=String(calling.length); badge.classList.remove('hide'); }
      else badge.classList.add('hide');
    }
    const alert=document.getElementById('tableCallAlert');
    const callList=document.getElementById('tableCallList');
    if(alert){
      if(calling.length){
        alert.style.display='block';
        if(callList) callList.innerHTML=calling.map(t=>'โต๊ะ '+(t.tableNo||t.id)).join(' · ');
        this.startCallAlarm();
      } else {
        alert.style.display='none';
        this.stopCallAlarm();
      }
    } else if(calling.length){
      this.startCallAlarm();
    } else {
      this.stopCallAlarm();
    }
  },
  startCallAlarm(){
    if(this._callAlarmTimer) return;
    const beep=()=>{
      try{
        if(!this.audio) this.audio=new (window.AudioContext||window.webkitAudioContext)();
        const ctx=this.audio;
        if(ctx.state==='suspended') ctx.resume();
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.type='square'; o.frequency.value=880;
        g.gain.value=0.08;
        o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime+0.18);
      }catch(e){}
    };
    beep();
    this._callAlarmTimer=setInterval(beep, 1200);
  },
  stopCallAlarm(){
    if(this._callAlarmTimer){ clearInterval(this._callAlarmTimer); this._callAlarmTimer=null; }
  },
  async ackTableCall(tableId){
    try{
      await shopRef.collection('tables').doc(String(tableId)).set({
        callStaff:false,
        callAckAt:Date.now(),
        updatedAt:Date.now()
      },{merge:true});
      toast('รับทราบโต๊ะ '+tableId+' แล้ว');
    }catch(e){ toast('รับทราบไม่สำเร็จ: '+(e.message||e)); }
  },
  async clearTable(tableId){
    if(!confirm('เคลียร์โต๊ะ '+tableId+' ?\nจะเคลียร์ได้เฉพาะเมื่อออเดอร์เสร็จสมบูรณ์แล้วเท่านั้น')) return;
    try{
      const tref=shopRef.collection('tables').doc(String(tableId));
      const ts=await tref.get();
      const td=ts.exists?ts.data():{};
      const oid=td.activeOrderId;
      if(oid){
        const os=await shopRef.collection('orders').doc(oid).get();
        const od=os.exists? (os.data()||{}) : {};
        if(od.status!=='Completed' && od.status!=='Cancelled'){
          const stLabel=({Pending:'รอคิวทำ',AwaitingPayment:'รอคิวทำ',Cooking:'กำลังทำ',Ready:'ทำเสร็จแล้ว',Completed:'เสร็จสมบูรณ์',Cancelled:'ยกเลิก'})[od.status]||od.status||'-';
          toast('เคลียร์โต๊ะไม่ได้ — ออเดอร์ยังไม่เสร็จสมบูรณ์ (สถานะ: '+stLabel+')');
          return;
        }
        // ออเดอร์เสร็จแล้ว → อัปเดต clearedAt เฉย ๆ (ไม่บังคับสถานะซ้ำ)
        try{
          await shopRef.collection('orders').doc(oid).set({
            clearedAt: Date.now(),
            updatedAt: Date.now()
          },{merge:true});
        }catch(e){ console.warn('mark cleared', e); }
      }
      await tref.set({
        activeOrderId:null,
        status:'free',
        callStaff:false,
        callAt:0,
        callAckAt:0,
        updatedAt:Date.now()
      },{merge:true});
      toast('เคลียร์โต๊ะ '+tableId+' แล้ว');
    }catch(e){ toast('เคลียร์โต๊ะไม่สำเร็จ: '+(e.message||e)); }
  },
  async deleteOrder(id){
    if(!confirm('ลบประวัติออเดอร์นี้ถาวร?\n(ขั้นที่ 1/2)')) return;
    if(!confirm('ยืนยันอีกครั้ง ข้อมูลจะหายและกู้คืนไม่ได้\n(ขั้นที่ 2/2)')) return;
    const pin=prompt('ใส่ PIN ร้านเพื่อยืนยันการลบ');
    if(pin==null) return;
    const s=await shopRef.collection('settings').doc('secure').get();
    const hash=s.exists?s.data().pinHash:'';
    const inputHash=await sha256(String(pin).trim());
    if(!hash || inputHash!==hash){ toast('PIN ไม่ถูกต้อง — ยกเลิกการลบ'); return; }
    try{
      // ลบได้เฉพาะสถานะจบ — ถ้ายังไม่จบให้ยกเลิกก่อน
      const cur=this.orders.find(x=>x.id===id);
      if(cur && cur.status!=='Completed' && cur.status!=='Cancelled'){
        if(!cur.benefitsRefunded){
          try{ await this.refundMemberBenefits(cur); }catch(e){ console.warn(e); }
        }
        await shopRef.collection('orders').doc(id).update({
          status:'Cancelled', cancelledAt:Date.now(), cancelledBy:'shop',
          cancelReason:'ลบประวัติโดยร้าน', benefitsRefunded:true
        });
      }
      await shopRef.collection('orders').doc(id).delete();
      try{ await shopRef.collection('receipts').doc(id).delete(); }catch(e){}
      // อัปเดต UI ทันที ไม่ต้องรอ refresh / snapshot
      this.orders = (this.orders||[]).filter(o => o.id !== id);
      if(this.seenIds) this.seenIds.delete(id);
      if(this.unviewed) this.unviewed.delete(id);
      (function(){var m=document.getElementById('detailModal'); if(m) m.classList.remove('on');})();
      this.loadHistory();
      this.renderOrders();
      this.updateAlarmBadge && this.updateAlarmBadge();
      toast('ลบประวัติแล้ว');
    }catch(err){ toast('ลบไม่ได้: '+(err.message||err)); }
  },
  async verifyAdminPin(promptMsg){
    const pin=prompt(promptMsg||'ใส่ PIN ร้านเพื่อยืนยัน');
    if(pin==null) return false;
    const s=await shopRef.collection('settings').doc('secure').get();
    const hash=s.exists?s.data().pinHash:'';
    const inputHash=await sha256(String(pin).trim());
    if(!hash || inputHash!==hash){ toast('PIN ไม่ถูกต้อง'); return false; }
    return true;
  },
  async deleteCollectionInBatches(colRef, batchSize){
    // Firestore จำกัด 500 writes/batch — ใช้ 400 เผื่อปลอดภัย
    batchSize = Math.min(400, Math.max(1, batchSize || 400));
    let total=0;
    while(true){
      const snap=await colRef.limit(batchSize).get();
      if(snap.empty) break;
      const batch=db.batch();
      snap.docs.forEach(d=>batch.delete(d.ref));
      await batch.commit();
      total += snap.size;
      if(snap.size < batchSize) break;
    }
    return total;
  },
  /** ยกเลิกออเดอร์ที่ยังไม่จบทั้งหมด ทีละชุด (ไม่เกิน 400/batch) จนหมด */
  async cancelAllActiveOrdersInChunks(){
    const chunkSize=400;
    let cancelled=0;
    // วนจนกว่าจะไม่เหลือออเดอร์ที่ไม่ใช่ Completed/Cancelled
    for(let guard=0; guard<200; guard++){ // กัน infinite loop: สูงสุด ~80,000 รายการ
      const snap=await shopRef.collection('orders').limit(chunkSize).get();
      if(snap.empty) break;
      const pending=snap.docs.filter(d=>{
        const st=(d.data()||{}).status;
        return st!=='Completed' && st!=='Cancelled';
      });
      if(!pending.length){
        // หน้านี้ไม่มี active แล้ว แต่ยังอาจมีหน้าถัดไป — ลบ terminal ไปเรื่อย ๆ นอกฟังก์ชันนี้
        // ถ้าทั้งหน้าเป็น terminal หมด ออกได้ (delete จะเคลียร์ต่อ)
        const anyActiveLeft=await shopRef.collection('orders')
          .where('status','in',['Pending','Cooking','Ready','AwaitingPayment']).limit(1).get();
        if(anyActiveLeft.empty) break;
        // มี active นอกหน้านี้ — อัปเดตทีละ chunk จาก query
        const more=await shopRef.collection('orders')
          .where('status','in',['Pending','Cooking','Ready','AwaitingPayment']).limit(chunkSize).get();
        if(more.empty) break;
        const batch=db.batch();
        more.docs.forEach(d=>batch.update(d.ref,{
          status:'Cancelled', cancelledAt:Date.now(), cancelledBy:'shop',
          cancelReason:'รีเซ็ตประวัติโดยร้าน'
        }));
        await batch.commit();
        cancelled += more.size;
        continue;
      }
      // อัปเดตทีละไม่เกิน 400
      for(let i=0;i<pending.length;i+=chunkSize){
        const chunk=pending.slice(i, i+chunkSize);
        const batch=db.batch();
        chunk.forEach(d=>batch.update(d.ref,{
          status:'Cancelled', cancelledAt:Date.now(), cancelledBy:'shop',
          cancelReason:'รีเซ็ตประวัติโดยร้าน'
        }));
        await batch.commit();
        cancelled += chunk.length;
      }
    }
    return cancelled;
  },
  async resetAllHistoryAndQueue(){
    if(!confirm('รีเซ็ตประวัติทั้งหมดและเริ่มรันคิวใหม่จาก A001?\n\n• ลบออเดอร์ทั้งหมด (รวมที่ยังไม่เสร็จ)\n• ลบใบเสร็จทั้งหมด\n• เลขคิวเริ่มที่ 1 ใหม่\n\nกู้คืนไม่ได้')) return;
    if(!confirm('ยืนยันอีกครั้ง: ข้อมูลจะถูกลบถาวร')) return;
    if(!(await this.verifyAdminPin('ใส่ PIN ร้านเพื่อยืนยันการรีเซ็ต'))) return;
    try{
      toast('กำลังรีเซ็ต…');
      // กฎ Firestore: ลบ order ได้เฉพาะ Completed/Cancelled → ยกเลิกที่ยังไม่จบก่อน
      let nCancel=0;
      try{ nCancel=await this.cancelAllActiveOrdersInChunks(); }catch(e){ console.warn('pre-cancel', e); }
      let nOrders=0, nReceipts=0, errMsg='';
      try{ nOrders=await this.deleteCollectionInBatches(shopRef.collection('orders'), 400); }
      catch(e){ console.error('del orders', e); errMsg+=(e.message||e)+' '; }
      try{ nReceipts=await this.deleteCollectionInBatches(shopRef.collection('receipts'), 400); }
      catch(e){ console.error('del receipts', e); errMsg+=(e.message||e)+' '; }
      // เคลียร์โต๊ะที่ occupied
      try{
        const ts=await shopRef.collection('tables').get();
        const batch=db.batch();
        let n=0;
        ts.docs.forEach(d=>{
          const t=d.data()||{};
          if(t.status==='occupied' || t.activeOrderId){
            batch.set(d.ref,{ status:'free', activeOrderId:null, callStaff:false, updatedAt:Date.now() },{merge:true});
            n++;
          }
        });
        if(n) await batch.commit();
      }catch(e){ console.warn('clear tables', e); }
      const today=new Date();
      const dayKey=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
      await shopRef.collection('settings').doc('queue').set({
        queueCounter:1,
        queueDate: dayKey,
        resetAt: Date.now()
      }, {merge:true});
      this.orders = [];
      if(this.seenIds) this.seenIds.clear();
      if(this.unviewed) this.unviewed.clear();
      this.renderOrders();
      this.loadHistory();
      this.updateAlarmBadge && this.updateAlarmBadge();
      if(errMsg){
        toast('รีเซ็ตบางส่วน: ยกเลิก '+nCancel+' · ลบออเดอร์ '+nOrders+' · ใบเสร็จ '+nReceipts+' · คิว A001 (บางรายการอาจเหลือ: '+errMsg.trim()+')');
      } else {
        toast('รีเซ็ตแล้ว · ลบออเดอร์ '+nOrders+' รายการ, ใบเสร็จ '+nReceipts+' · คิวเริ่ม A001');
      }
    }catch(e){
      console.error(e);
      // แม้ error ยังรีเฟรช UI ให้เห็นสถานะจริง
      try{ this.orders=[]; this.renderOrders(); this.loadHistory(); }catch(x){}
      toast('รีเซ็ตไม่สำเร็จ: '+(e.message||e));
    }
  },
  });
})();
