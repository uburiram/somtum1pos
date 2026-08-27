/**
 * Somtum1POS — table mode / shop open UI
 * Auto-split from customer.js (lines 1413-1840)
 */
/* global C, db, shopRef, esc, money, toast, uid, showErr, sha256, calcPaymentCover, fileToDataUrl, PP, checkConfig, migrateAndSeed, checkOrderRateLimit */
(function () {
  'use strict';
  window.C = window.C || {};
  Object.assign(window.C, {
  setShopOpenState(isOpen){
    this.isOpen = isOpen!==false;
    const b=document.getElementById('shopClosedBanner');
    if(b) b.style.display = this.isOpen ? 'none' : 'block';
    // ปุ่ม FAB / สั่ง
    const fab=document.getElementById('fab');
    if(fab && !this.isOpen){
      fab.style.opacity='0.55';
    } else if(fab){
      fab.style.opacity='1';
    }
  },
  /** เปิด/ปิดระบบสมาชิก+คูปองบนหน้าลูกค้า (ควบคุมจากแอดมิน) */
  applyMemberSystemState(enabled){
    this.memberSystemEnabled = enabled!==false;
    const on = this.memberSystemEnabled;
    const show=(id, yes)=>{ const el=document.getElementById(id); if(el) el.style.display=yes?'':'none'; };
    // ปุ่มตรวจ / คูปองรวม / สมัครสมาชิก
    show('btnLookupMember', on);
    show('publicCouponBox', on);
    show('btnMemberReg', on);
    if(!on){
      const box=document.getElementById('memBox'); if(box) box.style.display='none';
      this.member=null;
      this.selectedPersonalCouponId='';
      this.memDiscount={ pointsUsed:0, couponCode:'', couponDisc:0, pointsDisc:0, totalDisc:0 };
      const pts=document.getElementById('memPointsUse'); if(pts) pts.value='0';
      const cp=document.getElementById('memCoupon'); if(cp) cp.value='';
      const st=document.getElementById('memStatus');
      if(st) st.textContent='เบอร์ติดต่อเมื่ออาหารพร้อม (ไม่บังคับ)';
      try{ this.recalcPayTotal(); }catch(e){}
    } else {
      const st=document.getElementById('memStatus');
      if(st && !this.member) st.textContent='ใส่เบอร์แล้วกดตรวจ — ไม่เป็นสมาชิกก็สั่งได้';
    }
    const title=document.getElementById('memPanelTitle');
    if(title){
      if(on){
        title.innerHTML='👤 สมาชิก / เบอร์ติดต่อ <span id="memPanelTitleHint" style="font-weight:500;font-size:11px;color:#888">(ใส่ก่อนเพื่อคำนวณส่วนลด)</span>';
      } else {
        title.innerHTML='📞 เบอร์ติดต่อ <span id="memPanelTitleHint" style="font-weight:500;font-size:11px;color:#888">(ไม่บังคับ)</span>';
      }
    }
    const lab=document.getElementById('memPhoneLabel');
    if(lab) lab.textContent = on ? 'เบอร์โทรศัพท์' : 'เบอร์ติดต่อ (ไม่บังคับ)';
    // หัวข้อยอดชำระ
    try{
      const payCap=document.querySelector('#mPay .huge') && document.getElementById('payTotal');
      const capEl=payCap && payCap.parentElement && payCap.parentElement.querySelector('div');
      // first child div above payTotal
      const cap=document.getElementById('payTotalCaption');
      if(cap) cap.textContent = on ? 'ยอดที่ต้องชำระ' : 'ยอดที่ต้องชำระ';
      else {
        const wrap=document.getElementById('payTotal') && document.getElementById('payTotal').previousElementSibling;
        if(wrap && wrap.tagName==='DIV') wrap.textContent = 'ยอดที่ต้องชำระ';
      }
    }catch(e){}
  },

  parseTableFromUrl(){
    try{
      const u=new URL(location.href);
      let t=u.searchParams.get('table')||u.searchParams.get('t');
      if(!t && location.hash){
        const m=String(location.hash).match(/table[=:_-]?(\d+)/i);
        if(m) t=m[1];
      }
      if(t!=null && t!==''){
        const n=Math.floor(Number(t));
        if(n>=1 && n<=500) return n;
      }
    }catch(e){}
    return null;
  },
  /** โต๊ะใครโต๊ะมัน — สแกนโต๊ะอื่นบนเครื่องเดียวกันต้องโชว์เฉพาะตั๋วโต๊ะนั้น */
  bindTableSession(tableNo){
    const n = tableNo!=null ? Math.floor(Number(tableNo)) : null;
    let prevSession=null;
    try{ prevSession=sessionStorage.getItem('somtum_tableNo'); }catch(e){}
    const prevSess = prevSession!=null && prevSession!=='' ? Math.floor(Number(prevSession)) : null;
    const prevMem = this.tableNo!=null ? Math.floor(Number(this.tableNo)) : null;
    const switched = !!(n && ((prevSess && prevSess!==n) || (prevMem && prevMem!==n)));
    if(switched){
      // เปลี่ยนโต๊ะ → ตัด session ออเดอร์โต๊ะเก่าออกทั้งหมด
      try{ if(this.unsub){ this.unsub(); this.unsub=null; } }catch(e){}
      try{ this.hide('mTicket'); }catch(e){}
      try{ this.hide('mPay'); }catch(e){}
      this.orderId=null;
      this.lastOrder=null;
      this.slipData='';
      this._pendingRestoreOrderId=null;
      // ไม่ล้างตะกร้า — ลูกค้าอาจพกเมนูไปโต๊ะอื่นได้ แต่ตั๋วต้องเป็นโต๊ะที่สแกน
      try{ sessionStorage.removeItem('somtum_orderId'); sessionStorage.removeItem('somtum_orderTable'); }catch(e){}
      toast('โต๊ะ '+n);
    }
    this.tableNo = n||null;
    try{
      if(n) sessionStorage.setItem('somtum_tableNo', String(n));
      else sessionStorage.removeItem('somtum_tableNo');
    }catch(e){}
    // คิว restore เฉพาะ orderId ที่ผูกโต๊ะนี้
    try{
      if(n){
        const savedT=sessionStorage.getItem('somtum_orderTable');
        const savedId=sessionStorage.getItem('somtum_orderId');
        if(savedT && String(savedT)===String(n) && savedId){
          this._pendingRestoreOrderId=savedId;
        } else if(savedT && String(savedT)!==String(n)){
          sessionStorage.removeItem('somtum_orderId');
          sessionStorage.removeItem('somtum_orderTable');
          this._pendingRestoreOrderId=null;
        }
      }
    }catch(e){}
  },
  async restoreTableOrderIfAny(){
    if(!shopRef || !this.tableNo) return;
    let id=this._pendingRestoreOrderId;
    this._pendingRestoreOrderId=null;
    // แหล่งจริงของโต๊ะ = tables/{tableNo}.activeOrderId (ไม่พึ่ง localStorage โต๊ะอื่น)
    try{
      const ts=await shopRef.collection('tables').doc(String(this.tableNo)).get();
      if(ts.exists){
        const activeId=(ts.data()||{}).activeOrderId||null;
        if(activeId) id=activeId;
        else id=null; // โต๊ะว่าง — ไม่กู้ตั๋วเก่า
      }
    }catch(e){ console.warn('table activeOrder', e); }
    if(!id){
      // โต๊ะว่าง → เคลียร์ state ถ้ายังค้างออเดอร์โต๊ะอื่น
      if(this.lastOrder && Number(this.lastOrder.tableNo)!==Number(this.tableNo)){
        this.orderId=null; this.lastOrder=null;
      }
      return;
    }
    try{
      const snap=await shopRef.collection('orders').doc(id).get();
      if(!snap.exists) return;
      const o=snap.data()||{};
      if(o.status==='Cancelled' || o.status==='Completed') return;
      if(Number(o.tableNo)!==Number(this.tableNo)) return;
      this.orderId=id;
      this.lastOrder={id, ...o};
      try{ this.rememberTableOrder(this.lastOrder); }catch(e){}
      try{ this.watchOrder(id); }catch(e){}
      // เปิดตั๋วโต๊ะนี้ให้เจ้ามือดูยอดได้ทันที
      try{
        this.renderTicket(this.lastOrder);
        if(!(this.cart && this.cart.length)){
          this.show('mTicket');
        }
      }catch(e){}
    }catch(e){ console.warn('restore table order', e); }
  },
  rememberTableOrder(order){
    try{
      if(order && order.id && order.tableNo){
        sessionStorage.setItem('somtum_orderId', String(order.id));
        sessionStorage.setItem('somtum_orderTable', String(order.tableNo));
      }
    }catch(e){}
  },
  applyOrderModeCustomerUI(){
    const bar=document.getElementById('tableModeBar');
    const tableNo=this.parseTableFromUrl() || this.tableNo;
    this.bindTableSession(tableNo);
    const useTable = this.orderMode==='table' && this.tableNo;
    try{ this.restoreTableOrderIfAny(); }catch(e){}
    if(bar){
      if(this.orderMode==='table'){
        bar.style.display='block';
        try{ document.body.style.paddingTop='44px'; }catch(e){}
      } else {
        bar.style.display='none';
        try{ document.body.style.paddingTop=''; }catch(e){}
      }
    }
    // โหมดโต๊ะ: ตัดช่องเช็คคิว/ใบเสร็จออก (ระบบคิวยังแสดงตามเดิม)
    try{
      const trackBar=document.querySelector('.track-bar');
      if(trackBar) trackBar.style.display = (this.orderMode==='table') ? 'none' : 'flex';
    }catch(e){}
    const lab=document.getElementById('tableModeLabel');
    const btn=document.getElementById('btnCallStaff');
    if(lab){
      if(useTable) lab.textContent='🪑 สั่งอาหาร · โต๊ะ '+this.tableNo;
      else if(this.orderMode==='table') lab.textContent='🪑 โหมดโต๊ะ · กรุณาสแกน QR บนโต๊ะก่อนสั่ง';
    }
    if(btn) btn.style.display = useTable ? 'inline-block' : 'none';
    if(useTable){
      try{ this.listenTableDoc(this.tableNo); }catch(e){}
    }
  },
  listenTableDoc(tableNo){
    const id=String(tableNo);
    try{ if(this._unsubTable) this._unsubTable(); }catch(e){}
    if(!shopRef) return;
    this._unsubTable=shopRef.collection('tables').doc(id).onSnapshot(snap=>{
      if(!snap.exists) return;
      const d=snap.data()||{};
      // พนักงานรับทราบ → แจ้งลูกค้า
      if(d.callAckAt && this._lastCallAt && d.callAckAt>=this._lastCallAt && !d.callStaff){
        if(this._lastAckShown!==d.callAckAt){
          this._lastAckShown=d.callAckAt;
          try{ this.show('staffAckModal'); }catch(e){}
          toast('พนักงานรับทราบแล้ว · กำลังมา');
        }
      }
      // โต๊ะถูกเคลียร์ขณะดูออเดอร์เดิม
      if(!d.activeOrderId && this.orderId && this.lastOrder && this.lastOrder.tableNo==tableNo){
        // โต๊ะว่างแล้ว — ไม่ล้างทันทีถ้ายังเปิดตั๋ว
      }
    }, e=>console.warn('table listen', e));
  },
  async callStaff(){
    if(this.orderMode!=='table' || !this.tableNo){
      toast('ใช้ได้เฉพาะเมื่อสแกน QR โต๊ะ');
      return;
    }
    try{
      const now=Date.now();
      this._lastCallAt=now;
      await shopRef.collection('tables').doc(String(this.tableNo)).set({
        callStaff:true,
        callAt:now,
        callAckAt:0,
        updatedAt:now
      },{merge:true});
      toast('เรียกพนักงานแล้ว · รอสักครู่');
    }catch(e){ toast('เรียกพนักงานไม่สำเร็จ: '+(e.message||e)); }
  },

  openMemberReg(){
    if(this.memberSystemEnabled===false){ toast('ระบบสมาชิกปิดอยู่'); return; }
    try{
      const rp=document.getElementById('regPhone');
      const mp=document.getElementById('memPhone');
      if(rp && mp && mp.value) rp.value=this.normPhone(mp.value);
    }catch(e){}
    this.show('mMemberReg');
  },
  assertShopOpen(){
    if(this.isOpen==null){
      toast('กำลังโหลดสถานะร้าน… กรุณารอสักครู่');
      return false;
    }
    if(this.isOpen===false){
      toast('อยู่นอกเวลาทำการ · ขออภัยในความไม่สะดวก');
      return false;
    }
    return true;
  },
  async restoreLastOrder(){
    // โหมดโต๊ะ: ไม่กู้จาก localStorage ทั้งเครื่อง — ใช้ tables/{n}.activeOrderId ผ่าน restoreTableOrderIfAny แล้ว
    if(this.orderMode==='table' && this.tableNo){
      // ถ้ามี lastOrder ของโต๊ะอื่นค้างอยู่ → เคลียร์
      if(this.lastOrder && Number(this.lastOrder.tableNo)!==Number(this.tableNo)){
        try{ if(this.unsub){ this.unsub(); this.unsub=null; } }catch(e){}
        this.orderId=null;
        this.lastOrder=null;
      }
      // ถ้ายังไม่มีออเดอร์ของโต๊ะนี้ → โหลดจาก Firestore โต๊ะอีกครั้ง
      if(!this.orderId || !this.lastOrder){
        try{ await this.restoreTableOrderIfAny(); }catch(e){}
      }
      return;
    }
    let saved=null;
    try{ saved=JSON.parse(localStorage.getItem('somtum_last_order')||'null'); }catch(e){ saved=null; }
    if(!saved || !saved.id) return;
    // ไม่กู้คิวที่ยกเลิก/เสร็จสมบูรณ์แล้ว
    if(saved.status==='Cancelled' || saved.status==='Completed'){
      try{ localStorage.removeItem('somtum_last_order'); }catch(e){}
      return;
    }
    // กัน localStorage จากโหมดโต๊ะทับโหมดคิวผิดโต๊ะ
    if(saved.orderMode==='table' || saved.tableNo!=null){
      // โหมดคิวปัจจุบันแต่ saved เป็นโต๊ะ → ไม่กู้
      if(this.orderMode!=='table'){
        try{ localStorage.removeItem('somtum_last_order'); }catch(e){}
        return;
      }
    }
    try{
      const snap=await shopRef.collection('orders').doc(saved.id).get();
      if(!snap.exists){
        try{ localStorage.removeItem('somtum_last_order'); }catch(e){}
        return;
      }
      const o={id:snap.id, ...snap.data()};
      if(o.status==='Cancelled' || o.status==='Completed'){
        try{ localStorage.removeItem('somtum_last_order'); }catch(e){}
        return;
      }
      this.orderId=o.id;
      this.lastOrder=o;
      try{ localStorage.setItem('somtum_last_order', JSON.stringify(o)); }catch(e){}
      try{ this.attachOrderWatcher(o.id); }catch(e){}
      // แสดงตั๋วคิวหลังรีเฟรช (ถ้าตะกร้าว่าง — ไม่รบกวนตอนกำลังเลือกเมนู)
      try{
        this.renderTicket(o);
        if(!(this.cart && this.cart.length)){
          this.show('mTicket');
          toast('กู้คิว '+ (o.queue||'') +' แล้ว');
        } else {
          toast('มีคิวค้าง '+ (o.queue||'') +' · กดตะกร้าเพื่อดูตั๋ว');
        }
        try{ this.updFab(); }catch(e){}
      }catch(e){}
    }catch(e){
      console.warn('restoreLastOrder', e);
    }
  },
  clearOrderState(){
    try{ this.stopOrderWatchers && this.stopOrderWatchers(); }catch(e){}
    try{
      if(this.unsub){ this.unsub(); this.unsub=null; }
    }catch(e){}
    this.orderId=null;
    this.lastOrder=null;
    this.slipData='';
    this._creatingOrder=false;
    this._lastKnownStatus=null;
    try{ localStorage.removeItem('somtum_last_order'); }catch(e){}
    try{
      const sp=document.getElementById('slipPreview');
      if(sp){ sp.style.display='none'; sp.innerHTML=''; }
      const sm=document.getElementById('slipAutoMsg');
      if(sm) sm.innerHTML='';
      const sf=document.getElementById('slipFile');
      if(sf) sf.value='';
    }catch(e){}
    try{ this.updFab(); }catch(e){}
  },
  startNewOrder(){
    const live=this.lastOrder && this.lastOrder.status!=='Cancelled' && this.lastOrder.status!=='Completed';
    if(live){
      const q=this.lastOrder.queue||'';
      if(this.orderMode==='table'){
        toast('โต๊ะนี้มีออเดอร์ '+q+' ค้างอยู่ · สั่งเพิ่มจากตะกร้าได้ หรือให้ร้านเคลียร์โต๊ะ');
        try{ this.renderTicket(this.lastOrder); this.show('mTicket'); }catch(e){}
        return;
      }
      if(!confirm('คิว '+q+' ยังอยู่ในครัว\nกดตกลงเพื่อเริ่มเลือกเมนูใหม่ (คิวเดิมยังอยู่ จำเลขคิวไว้)\nกดยกเลิกเพื่อกลับไปดูตั๋ว')){
        try{ this.renderTicket(this.lastOrder); this.show('mTicket'); }catch(e){}
        return;
      }
    }
    this.clearOrderState();
    this.hide('mTicket');
    this.hide('mPay');
    try{ this.renderCart(); }catch(e){ try{ this.updFab(); }catch(e2){} }
    toast('พร้อมสั่งออเดอร์ใหม่');
  },
  async cancelMyOrder(){
    const o=this.lastOrder;
    if(!o || !o.id){ toast('ไม่พบออเดอร์'); return; }
    if(o.paymentStatus==='PAID'){
      toast('ชำระเงินแล้ว ยกเลิกไม่ได้ · ติดต่อร้านโดยตรง');
      return;
    }
    // เคยชำระบางส่วน / สั่งเพิ่มค้างส่วนต่าง → ห้ามลูกค้ายกเลิกเอง (ป้องกันยกเลิกทั้งบิลที่จ่ายแล้ว)
    const alreadyPaid=Number(o.paidAmount||0);
    if(o.needsRepay || alreadyPaid>0){
      toast('ออเดอร์นี้มีการชำระเงินแล้วบางส่วน · ยกเลิกไม่ได้ ติดต่อร้านโดยตรง');
      return;
    }
    if(o.status!=='Pending' && o.status!=='AwaitingPayment'){
      toast('คิวนี้ไม่ได้อยู่ขั้นรอคิวทำแล้ว · ยกเลิกไม่ได้ กรุณาติดต่อร้านโดยตรง');
      return;
    }
    if(!confirm('ยืนยันยกเลิกออเดอร์คิว '+(o.queue||'')+' ?')) return;
    try{
      // ยกเลิก + คืนแต้ม/คูปองใน transaction เดียวกัน เพื่อกันกรณีคืนสิทธิ์สำเร็จแต่ยกเลิกออเดอร์ไม่สำเร็จ
      const result = await db.runTransaction(async tx=>{
        const oref=shopRef.collection('orders').doc(o.id);
        const os=await tx.get(oref);
        if(!os.exists) throw new Error('ไม่พบออเดอร์');
        const cur=os.data()||{};
        if(cur.status==='Cancelled') return {o:cur};
        if(cur.status==='Completed' || cur.paymentStatus==='PAID' || Number(cur.paidAmount||0)>0 || cur.needsRepay){
          throw new Error('ออเดอร์มีการชำระเงินแล้วหรือปิดงานแล้ว · ยกเลิกไม่ได้');
        }
        if(cur.orderMode==='table' || this.orderMode==='table') throw new Error('ออเดอร์โต๊ะเป็นออเดอร์ร่วม · ให้ร้านดำเนินการยกเลิก');
        const phone=this.normPhone(cur.memberPhone||'');
        const pts=Math.max(0,Number(cur.pointsUsed||cur.pointsDisc||0));
        const pcid=String(cur.personalCouponId||'');
        const pubCode=String(cur.couponCode||'').trim().toUpperCase();
        const isPub=!!pubCode && !pubCode.startsWith('PERSONAL:');
        const mref=phone?shopRef.collection('members').doc(phone):null;
        const cref=isPub?shopRef.collection('coupons').doc(pubCode):null;
        let ms=null, cs=null;
        if(mref && (pts>0 || pcid)) ms=await tx.get(mref);
        if(cref) cs=await tx.get(cref);
        if(ms && ms.exists && (pts>0 || pcid)){
          const md=ms.data()||{};
          const patch={updatedAt:Date.now()};
          if(pts>0) patch.points=Number(md.points||0)+pts;
          if(pcid && Array.isArray(md.personalCoupons)) patch.personalCoupons=md.personalCoupons.map(c=>c&&String(c.id)===pcid&&c.used?Object.assign({},c,{used:false,usedAt:null}):c);
          tx.update(mref,patch);
        }
        if(cs && cs.exists && isPub){
          const cd=cs.data()||{};
          tx.update(cref,{usedCount:Math.max(0,Number(cd.usedCount||0)-1),updatedAt:Date.now()});
        }
        tx.update(oref,{
          status:'Cancelled', cancelledAt:Date.now(), cancelledBy:'customer',
          cancelReason:'ลูกค้ายกเลิกตอนรอคิวทำ', benefitsRefunded:true, updatedAt:Date.now()
        });
        return {o:Object.assign({},cur,{status:'Cancelled',cancelledBy:'customer',benefitsRefunded:true})};
      });
      this.lastOrder=Object.assign({}, result.o, {id:o.id});
      this.renderTicket(this.lastOrder);
      toast('ยกเลิกโดยลูกค้าแล้ว');
      // เคลียร์ state หลังโชว์ตั๋วยกเลิกสั้น ๆ — ให้สั่งคิวใหม่ได้ทันที
      setTimeout(()=>{
        try{
          this.clearOrderState();
          this.hide('mTicket');
          toast('สามารถสั่งออเดอร์ใหม่ได้แล้ว');
        }catch(e){}
      }, 1800);
    }catch(e){
      toast('ยกเลิกไม่สำเร็จ: '+(e.message||e));
    }
  },
  
  // ========== สมาชิก / แต้ม / คูปอง ==========
  });
})();
