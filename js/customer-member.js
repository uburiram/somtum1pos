/**
 * Somtum1POS — member / points / coupons
 * Auto-split from customer.js (lines 1841-2328)
 */
/* global C, db, shopRef, esc, money, toast, uid, showErr, sha256, calcPaymentCover, fileToDataUrl, PP, checkConfig, migrateAndSeed, checkOrderRateLimit */
(function () {
  'use strict';
  window.C = window.C || {};
  Object.assign(window.C, {
  member:null,
  memDiscount:{ pointsUsed:0, couponCode:'', couponDisc:0, pointsDisc:0, totalDisc:0 },
  normPhone(p){
    let s=String(p||'').replace(/\D/g,'');
    if(s.length===11 && s.startsWith('66')) s='0'+s.slice(2);
    return s;
  },
  /** รหัสคูปอง: ตัวพิมพ์ใหญ่ + เฉพาะ A-Z0-9 (ตรงกับฝั่งร้าน) */
  normCoupon(c){
    return String(c||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  },
  onMemberPhoneInput(){
    const el=document.getElementById('memPhone');
    if(!el) return;
    el.value=this.normPhone(el.value).slice(0,10);
  },
  async lookupMember(){
    if(this.memberSystemEnabled===false){
      toast('ระบบสมาชิกปิดอยู่');
      return;
    }
    const phone=this.normPhone((document.getElementById('memPhone')||{}).value);
    const st=document.getElementById('memStatus');
    const box=document.getElementById('memBox');
    this.member=null;
    this.memDiscount={ pointsUsed:0, couponCode:'', couponDisc:0, pointsDisc:0, totalDisc:0 };
    if(phone.length<9){
      if(st) st.innerHTML='<span style="color:#E65100">กรอกเบอร์ให้ครบ</span>';
      if(box) box.style.display='none';
      const regBtn=document.getElementById('btnMemberReg');
      if(regBtn) regBtn.style.display='block';
      this.recalcPayTotal();
      return;
    }
    if(st) st.textContent='กำลังค้นหา…';
    try{
      const snap=await shopRef.collection('members').doc(phone).get();
      if(!snap.exists){
        if(st) st.innerHTML='<span style="color:#E65100">ไม่พบสมาชิก · สั่งได้ปกติ</span>'+
          '<div style="font-size:11px;color:#888;margin-top:4px">เบอร์นี้เก็บเป็นเบอร์ติดต่อเมื่ออาหารพร้อม · สมัครได้ที่ปุ่มด้านล่าง</div>';
        if(box) box.style.display='none';
        // จำเบอร์ไว้หน้าสมัคร
        try{
          const rp=document.getElementById('regPhone');
          if(rp) rp.value=phone;
        }catch(e){}
        const regBtn=document.getElementById('btnMemberReg');
        if(regBtn) regBtn.style.display='block';
        this.recalcPayTotal();
        return
      }
      const md={phone, ...snap.data()};
      if(md.status==='cancelled' || md.active===false || md.isActive===false || md.disabled===true){
        if(st) st.innerHTML='<span style="color:#E65100">เบอร์นี้ถูกยกเลิกสิทธิ์สมาชิก</span><div style="font-size:11px;color:#888">สั่งได้ปกติแต่ไม่มีแต้ม/คูปอง</div>';
        if(box) box.style.display='none';
        this.member=null;
        const regBtn=document.getElementById('btnMemberReg');
        if(regBtn) regBtn.style.display='none';
        this.recalcPayTotal();
        return;
      }
      this.member=md;
      if(st) st.innerHTML='<span style="color:#2E7D32">✓ สมาชิก: '+esc(this.escName(this.member))+'</span>';
      if(box) box.style.display='block';
      const info=document.getElementById('memInfo');
      if(info) info.innerHTML='<strong>'+esc(this.escName(this.member))+'</strong><br>แต้มคงเหลือ <strong style="color:var(--p)">'+Number(this.member.points||0)+'</strong> แต้ม';
      const ph=document.getElementById('memPointsHint');
      if(ph) ph.textContent='ใช้ได้สูงสุดตามยอดออเดอร์ · 1 แต้ม = ส่วนลด 1 บาท';
      const up=document.getElementById('memPointsUse'); if(up) up.value='0';
      const cp=document.getElementById('memCoupon'); if(cp) cp.value='';
      this.selectedPersonalCouponId='';
      this.renderPersonalCoupons();
      const regBtn=document.getElementById('btnMemberReg');
      if(regBtn) regBtn.style.display='none';
      this.recalcPayTotal();
    }catch(e){
      console.warn(e);
      if(st) st.textContent='ค้นหาไม่สำเร็จ · สั่งได้ตามปกติ';
      if(box) box.style.display='none';
      this.member=null;
      this.selectedPersonalCouponId='';
      try{ this.recalcPayTotal(); }catch(e2){}
    }
  },
  /** ชื่อสมาชิกดิบ (ไม่ escape) — ใช้เก็บลง Firestore เป็น memberName; หน้าจอที่แสดงผลต้องครอบด้วย esc() เอง */
  escName(m){
    if(!m) return '';
    const n=(String(m.firstName||'')+' '+String(m.lastName||'')).trim();
    if(n) return n;
    return String(m.phone||m.id||'').trim();
  },
  cartSubtotal(){
    return (this.cart||[]).reduce((s,i)=>s+Number(i.total||0),0);
  },

  renderPersonalCoupons(){
    const el=document.getElementById('memPersonalCoupons');
    if(!el) return;
    const list=(this.member && this.member.personalCoupons) || [];
    const now=Date.now();
    const avail=list.filter(c=>c && !c.used && (!c.expiresAt || Number(c.expiresAt)>now));
    if(!avail.length){ el.style.display='none'; el.innerHTML=''; return; }
    el.style.display='block';
    let html='<div style="font-size:12px;font-weight:600;color:#6A1B9A;margin-bottom:6px">🎟 คูปองส่วนตัวของคุณ</div>';
    avail.forEach(c=>{
      const lab=c.type==='percent' ? (c.value+'%') : ('฿'+c.value);
      const sel=String(this.selectedPersonalCouponId||'')===String(c.id||'');
      const label=esc(c.note||lab)+' ('+lab+')'+(sel?' ✓':'');
      html+='<button type="button" data-pcid="'+esc(c.id)+'" class="btn '+(sel?'btn-p':'btn-o')+' btn-sm" style="width:auto;margin:0 6px 6px 0" onclick="C.selectPersonalCoupon(this.getAttribute(\'data-pcid\'))">'+label+'</button>';
    });
    html+='<div style="font-size:11px;color:#888">เลือกได้ 1 ใบ (ใช้แทนคูปองรวม) · ใช้คู่กับแต้มได้</div>';
    el.innerHTML=html;
  },
  selectPersonalCoupon(id){
    id=String(id||'');
    if(String(this.selectedPersonalCouponId||'')===id) this.selectedPersonalCouponId='';
    else this.selectedPersonalCouponId=id;
    if(this.selectedPersonalCouponId){
      const cp=document.getElementById('memCoupon');
      if(cp) cp.value='';
    }
    this.renderPersonalCoupons();
    try{ this.recalcPayTotal(); }catch(e){ console.warn(e); }
  },

  onPointsUseInput(){
    const el=document.getElementById('memPointsUse');
    if(!el) return;
    let v=Math.floor(Number(el.value||0));
    if(isNaN(v) || v<0) v=0;
    el.value=String(v);
    this.recalcPayTotal();
  },
  useAllPoints(){
    if(!this.member){ toast('ตรวจเบอร์สมาชิกก่อน'); return; }
    const el=document.getElementById('memPointsUse');
    if(!el) return;
    // ใส่ค่าสูง แล้วให้ recalc ตัดตาม max จริง
    el.value=String(Number(this.member.points||0));
    this.recalcPayTotal();
  },
  clearPointsUse(){
    const el=document.getElementById('memPointsUse');
    if(el) el.value='0';
    this.recalcPayTotal();
  },
  /** debounce คูปองรวม — กัน race ตอนพิมพ์ทีละตัวแล้ว response เก่าทับใหม่ */
  onCouponInput(){
    // พิมพ์คูปองรวม → ยกเลิกคูปองส่วนตัว (ใช้ร่วมกันไม่ได้)
    const raw=String((document.getElementById('memCoupon')||{}).value||'').trim();
    if(raw && this.selectedPersonalCouponId){
      this.selectedPersonalCouponId='';
      try{ this.renderPersonalCoupons(); }catch(e){}
    }
    clearTimeout(this._couponDebounce);
    this._couponDebounce=setTimeout(()=>{ try{ this.recalcPayTotal(); }catch(e){} }, 280);
  },
  async recalcPayTotal(){
    try{
      if(this.memberSystemEnabled===false){
        this.selectedPersonalCouponId='';
        this.memDiscount={ pointsUsed:0, couponCode:'', couponDisc:0, pointsDisc:0, totalDisc:0, payable:this.cartSubtotal(), subtotal:this.cartSubtotal() };
        const pt=document.getElementById('payTotal');
        if(pt) pt.textContent=money(this.cartSubtotal());
        const hint=document.getElementById('paySubHint'); if(hint) hint.textContent='';
        const line=document.getElementById('memDiscountLine'); if(line) line.textContent='';
        return this.cartSubtotal();
      }
      const reqId=(this._recalcSeq=(this._recalcSeq||0)+1);
      const sub=Math.max(0, Number(this.cartSubtotal()||0));
      let pointsDisc=0, couponDisc=0, couponCode='', personalCouponId='';
      const ptsEl=document.getElementById('memPointsUse');
      const couponEl=document.getElementById('memCoupon');
      const line=document.getElementById('memDiscountLine');
      const now=Date.now();

      // 1) คูปองส่วนตัว (ข้ามถ้ามีรหัสคูปองรวมในช่อง — ใช้ร่วมกันไม่ได้)
      const typedPublic=String((couponEl&&couponEl.value)||'').trim();
      const selId=typedPublic ? '' : String(this.selectedPersonalCouponId||'');
      if(typedPublic && this.selectedPersonalCouponId){
        this.selectedPersonalCouponId='';
        try{ this.renderPersonalCoupons(); }catch(e){}
      }
      if(this.member && selId){
        const list=this.member.personalCoupons||[];
        const pc=list.find(c=>c && String(c.id)===selId && !c.used);
        if(pc && (!pc.expiresAt || Number(pc.expiresAt)>now)){
          if(pc.minOrder!=null && sub<Number(pc.minOrder)){
            if(line) line.innerHTML='<span style="color:#C62828">คูปองส่วนตัวยอดขั้นต่ำ ฿'+pc.minOrder+'</span>';
          } else {
            personalCouponId=String(pc.id);
            if(pc.type==='percent') couponDisc=Math.floor(sub*Number(pc.value||0)/100);
            else couponDisc=Math.floor(Number(pc.value||0));
            couponDisc=Math.min(Math.max(0,couponDisc), Math.floor(sub));
            couponCode='PERSONAL:'+personalCouponId;
          }
        }
      }

      // 2) คูปองรวม (เมื่อไม่ได้ใช้ส่วนตัว)
      const code=(typeof this.normCoupon==='function'
        ? this.normCoupon((couponEl&&couponEl.value)||'')
        : String((couponEl&&couponEl.value)||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,''));
      if(!personalCouponId && code){
        try{
          if(!shopRef){ throw new Error('ยังไม่เชื่อมต่อร้าน'); }
          const snap=await shopRef.collection('coupons').doc(code).get();
          if(!snap.exists){
            if(line) line.innerHTML='<span style="color:#C62828">ไม่พบคูปอง '+code+'</span>';
          } else {
            const c=snap.data()||{};
            if(c.active===false || c.isActive===false || c.disabled===true){ if(line) line.innerHTML='<span style="color:#C62828">คูปองปิดใช้งาน</span>'; }
            else if(c.expiresAt && Number(c.expiresAt)<now){ if(line) line.innerHTML='<span style="color:#C62828">คูปองหมดอายุ</span>'; }
            else if(c.maxUses!=null && Number(c.usedCount||0)>=Number(c.maxUses)){ if(line) line.innerHTML='<span style="color:#C62828">คูปองใช้ครบแล้ว</span>'; }
            else if(c.minOrder!=null && sub<Number(c.minOrder)){ if(line) line.innerHTML='<span style="color:#C62828">ยอดขั้นต่ำ ฿'+c.minOrder+'</span>'; }
            else {
              couponCode=code;
              if(c.type==='percent') couponDisc=Math.floor(sub*Number(c.value||0)/100);
              else couponDisc=Math.floor(Number(c.value||0));
              couponDisc=Math.min(Math.max(0,couponDisc), Math.floor(sub));
            }
          }
        }catch(e){ console.warn('coupon', e); }
      }

      // 3) แต้ม
      let afterCoupon=Math.max(0, sub-couponDisc);
      const maxPts=this.member ? Math.min(Math.max(0,Math.floor(Number(this.member.points||0))), Math.floor(afterCoupon)) : 0;
      let wantPts=ptsEl ? Math.floor(Number(ptsEl.value||0)) : 0;
      if(isNaN(wantPts) || wantPts<0) wantPts=0;
      if(wantPts>maxPts) wantPts=maxPts;
      pointsDisc=wantPts;
      if(ptsEl){
        ptsEl.max=String(maxPts);
        // อัปเดตค่าที่แสดงเมื่อเกิน max (ไม่บังคับตอนกำลังพิมพ์)
        if(document.activeElement!==ptsEl && Number(ptsEl.value||0)!==wantPts) ptsEl.value=String(wantPts);
      }
      const ph=document.getElementById('memPointsHint');
      if(ph && this.member){
        ph.textContent='ใช้ได้สูงสุด '+maxPts+' แต้ม (คงเหลือ '+Number(this.member.points||0)+' · 1 แต้ม = 1 บาท)';
      }

      // ถ้ามี recalc ใหม่ค้างอยู่ อย่าเอาผลเก่าทับ
      if(reqId!==this._recalcSeq) return this.memDiscount && this.memDiscount.payable;
      const totalDisc=Math.max(0, couponDisc+pointsDisc);
      const payable=Math.max(0, Math.round((sub-totalDisc)*100)/100);
      this.memDiscount={
        pointsUsed: pointsDisc,
        couponCode: couponCode||'',
        couponDisc: couponDisc,
        pointsDisc: pointsDisc,
        totalDisc: totalDisc,
        personalCouponId: personalCouponId||'',
        subtotal: sub,
        payable: payable
      };

      // อัปเดตยอดบนจอ
      const pt=document.getElementById('payTotal');
      if(pt){
        if(totalDisc>0){
          pt.innerHTML='<span style="text-decoration:line-through;color:#999;font-size:1rem;font-weight:500">฿'+sub+'</span> ฿'+payable;
        } else {
          pt.textContent='฿'+payable;
        }
      }
      const hint=document.getElementById('paySubHint');
      if(hint){
        if(payable<=0 && totalDisc>0){
          hint.innerHTML='<span style="color:#2E7D32;font-weight:600">ใช้ส่วนลด/แต้มครบ · กดยืนยันแล้วชำระทันที</span>';
        } else if(totalDisc>0){
          let parts=[];
          if(couponDisc){
            if(personalCouponId) parts.push('คูปองส่วนตัว -฿'+couponDisc);
            else if(couponCode) parts.push('คูปองรวม '+couponCode+' -฿'+couponDisc);
            else parts.push('คูปอง -฿'+couponDisc);
          }
          if(pointsDisc) parts.push('แต้ม -฿'+pointsDisc);
          hint.textContent='ยอดก่อนลด ฿'+sub+' · '+parts.join(' · ')+' · เหลือ ฿'+payable;
        } else {
          hint.textContent=sub>0?('ยอดตะกร้า ฿'+sub):'';
        }
      }
      if(line && totalDisc>0){
        let detail=[];
        if(couponDisc) detail.push(personalCouponId?'คูปองส่วนตัว':'คูปองรวม '+ (couponCode||''));
        if(pointsDisc) detail.push('แต้ม '+pointsDisc);
        line.innerHTML='ส่วนลดรวม <strong>-฿'+totalDisc+'</strong>'+(detail.length?' ('+detail.join(' + ')+')':'')+' · ยอดชำระ <strong>฿'+payable+'</strong>';
      } else if(line && !code && !personalCouponId){
        line.textContent='';
      }

      // ไม่สร้าง QR ที่หน้ายืนยัน — QR แสดงบนตั๋วคิวหลังยืนยันเท่านั้น
      return payable;
    }catch(e){
      console.error('recalcPayTotal', e);
      const sub=this.cartSubtotal();
      const pt=document.getElementById('payTotal');
      if(pt) pt.textContent='฿'+sub;
      return sub;
    }
  },
  refreshPayQR(payable){
    // ตัด QR ออกจากหน้ายืนยันออเดอร์ทั้งหมด — แสดงเฉพาะหน้าตั๋วคิวผ่าน renderPayQRInto
    const z=document.getElementById('ppZone');
    if(z) z.style.display='none';
    const qr=document.getElementById('ppQR');
    if(qr) qr.innerHTML='';
    // ไม่ cache จากหน้ายืนยัน เพื่อไม่ให้ตั๋วใช้ QR ยอดเก่าผิด
    return;
  },

  async registerMember(){
    const first=(document.getElementById('regFirst')||{}).value||'';
    const last=(document.getElementById('regLast')||{}).value||'';
    const phone=this.normPhone((document.getElementById('regPhone')||{}).value);
    if(!String(first).trim()){ toast('กรอกชื่อ'); return; }
    if(phone.length<9){ toast('กรอกเบอร์โทรให้ครบ'); return; }
    try{
      const ref=shopRef.collection('members').doc(phone);
      const snap=await ref.get();
      if(snap.exists){ toast('เบอร์นี้เป็นสมาชิกแล้ว'); return; }
      await ref.set({
        phone, firstName:String(first).trim(), lastName:String(last).trim(),
        points:10, totalSpent:0, orderCount:0,
        status:'active', active:true, isActive:true, disabled:false,
        createdAt:Date.now(), updatedAt:Date.now()
      });
      toast('สมัครสมาชิกสำเร็จ · รับ 10 แต้มต้อนรับ');
      this.hide('mMemberReg');
      try{ const rp=document.getElementById('regPhone'); if(rp) rp.readOnly=false; }catch(e){}
      const mp=document.getElementById('memPhone'); if(mp) mp.value=phone;
      await this.lookupMember();
    }catch(e){ toast('สมัครไม่สำเร็จ: '+(e.message||e)); }
  },
  
  
  async refundMemberBenefits(o){
    if(!o) return;
    const phone=this.normPhone(o.memberPhone||'');
    const pts=Number(o.pointsUsed!=null?o.pointsUsed:(o.pointsDisc||0));
    const pcid=o.personalCouponId||'';
    const pubCode=String(o.couponCode||'').trim().toUpperCase();
    const isPub=pubCode && !pubCode.startsWith('PERSONAL:');
    if(!phone && !isPub) return;
    if(pts<=0 && !pcid && !isPub) return;
    try{
      await db.runTransaction(async tx=>{
        if(phone){
          const ref=shopRef.collection('members').doc(phone);
          const s=await tx.get(ref);
          if(s.exists){
            const md=s.data()||{};
            const patch={ updatedAt:Date.now() };
            if(pts>0) patch.points=Number(md.points||0)+pts;
            if(pcid && Array.isArray(md.personalCoupons)){
              patch.personalCoupons=md.personalCoupons.map(c=>{
                if(c && c.id===pcid && c.used) return Object.assign({}, c, {used:false, usedAt:null});
                return c;
              });
            }
            tx.update(ref, patch);
          }
        }
        // คืน usedCount คูปองรวม
        if(isPub){
          const cref=shopRef.collection('coupons').doc(pubCode);
          const cs=await tx.get(cref);
          if(cs.exists){
            const c=cs.data()||{};
            const used=Math.max(0, Number(c.usedCount||0)-1);
            tx.update(cref,{ usedCount:used, updatedAt:Date.now() });
          }
        }
      });
    }catch(e){ console.warn('refundMemberBenefits', e); }
  },

  async awardMemberPoints(order){
    if(!order || order.pointsAwarded) return;
    // ใช้ memberPhone หรือ contactPhone (กรณีบันทึกเป็นเบอร์ติดต่อแต่เป็นสมาชิก)
    const phone=this.normPhone(order.memberPhone||order.contactPhone||'');
    if(!phone || phone.length<9) return;
    // สะสมแต้มจากยอดขายจริง (total หลังส่วนลด) — ครบ 100 บาท = 1 แต้ม
    const sale=Math.max(0, Number(order.total!=null ? order.total : 0));
    const earn=Math.floor(sale/100);
    try{
      await db.runTransaction(async tx=>{
        const oref=shopRef.collection('orders').doc(order.id);
        const os=await tx.get(oref);
        if(!os.exists) return;
        const od=os.data()||{};
        if(od.pointsAwarded) return;
        // ยืนยันว่าเป็นสมาชิกจริง
        const mref=shopRef.collection('members').doc(phone);
        const ms=await tx.get(mref);
        if(!ms.exists){
          // ไม่ใช่สมาชิก — ทำเครื่องหมายแล้วจบ (ไม่แอดแต้ม)
          tx.update(oref,{ pointsAwarded:true, pointsEarned:0 });
          return;
        }
        const md=ms.data()||{};
        if(md.status==='cancelled' || md.active===false || md.isActive===false || md.disabled===true){
          tx.update(oref,{ pointsAwarded:true, pointsEarned:0, memberPhone: phone });
          return;
        }
        // แอดแต้ม (แม้ earn=0 ก็ mark แล้วเพื่อไม่ให้รันซ้ำ)
        tx.update(mref,{
          points: Number(md.points||0)+earn,
          totalSpent: Number(md.totalSpent||0)+sale,
          orderCount: Number(md.orderCount||0)+1,
          updatedAt: Date.now()
        });
        tx.update(oref,{
          pointsAwarded:true,
          pointsEarned:earn,
          memberPhone: od.memberPhone||phone,
          memberName: od.memberName || (String(md.firstName||'')+' '+String(md.lastName||'')).trim() || phone
        });
      });
      // sync local
      if(this.lastOrder && this.lastOrder.id===order.id){
        this.lastOrder.pointsAwarded=true;
        this.lastOrder.pointsEarned=earn;
        if(!this.lastOrder.memberPhone) this.lastOrder.memberPhone=phone;
      }
    }catch(e){ console.warn('awardMemberPoints', e); }
  },

  /** ใบเสร็จหลังเสร็จสมบูรณ์: ชื่อ-นามสกุล เบอร์ / ใช้แต้ม ได้แต้ม เหลือ / คูปองที่มี */
  async fillReceiptMemberBenefits(order){
    const el=document.getElementById('receiptMemberBenefits');
    if(!el || !order) return;
    const phone=this.normPhone(order.memberPhone||order.contactPhone||'');
    if(!phone){ el.style.display='none'; return; }
    const cacheKey=String(order.id||'')+'|'+(order.pointsEarned||0)+'|'+(order.pointsUsed||0);
    if(this._receiptBenefitsKey===cacheKey && el.dataset.filled==='1' && el.innerHTML.length>40){
      el.style.display='block';
      return;
    }
    if(this._receiptBenefitsLoading===cacheKey) return;
    this._receiptBenefitsLoading=cacheKey;
    el.style.display='block';
    if(el.dataset.filled!=='1'){
      el.innerHTML='<div style="margin-top:10px;padding:8px;background:#F3E5F5;border-radius:8px;font-size:12px;color:#6A1B9A;text-align:center">กำลังโหลดสิทธิ์สมาชิก…</div>';
    }
    try{
      const snap=await shopRef.collection('members').doc(phone).get();
      let pts=0, coupons=[];
      let name=String(order.memberName||'').trim();
      if(snap.exists){
        const md=snap.data()||{};
        pts=Math.max(0, Math.floor(Number(md.points||0)));
        if(!name) name=(String(md.firstName||'')+' '+String(md.lastName||'')).trim();
        const now=Date.now();
        coupons=(Array.isArray(md.personalCoupons)?md.personalCoupons:[]).filter(c=>c&&!c.used&&(!c.expiresAt||Number(c.expiresAt)>now));
      }
      const usedPts=Math.max(0, Number(order.pointsUsed||order.pointsDisc||0));
      const earned=Math.max(0, Number(order.pointsEarned||0));
      let html='<div style="margin-top:10px;padding:10px;background:#F3E5F5;border-radius:8px;font-size:12px;color:#6A1B9A;text-align:left;line-height:1.55">';
      html+='<div style="font-weight:700;margin-bottom:6px;text-align:center">👤 ข้อมูลสมาชิก</div>';
      html+='<div>ชื่อ-นามสกุล: <strong>'+esc(name||'-')+'</strong></div>';
      html+='<div>เบอร์โทร: <strong>'+esc(phone)+'</strong></div>';
      html+='<div>ใช้แต้ม: <strong>'+usedPts+'</strong> แต้ม · ได้แต้ม: <strong>+'+earned+'</strong> แต้ม · เหลือ: <strong style="font-size:1.05rem">'+pts+'</strong> แต้ม</div>';
      if(coupons.length){
        html+='<div style="margin-top:6px;border-top:1px dashed #CE93D8;padding-top:6px">คูปองที่ลูกค้ามี:</div>';
        coupons.forEach(c=>{
          const lab=c.type==='percent'?(c.value+'%'):('฿'+c.value);
          html+='<div style="margin-top:2px;margin-left:4px">• '+esc(c.note||lab)+' ('+lab+')</div>';
        });
      }
      html+='</div>';
      el.innerHTML=html;
      el.dataset.filled='1';
      this._receiptBenefitsKey=cacheKey;
      this._receiptBenefitsHtml=html;
      this._receiptBenefitsOrderId=String(order.id||'');
    }catch(e){
      console.warn(e);
      if(el.dataset.filled!=='1'){
        el.innerHTML='';
        el.style.display='none';
      }
    }finally{
      if(this._receiptBenefitsLoading===cacheKey) this._receiptBenefitsLoading=null;
    }
  },
  });
})();
