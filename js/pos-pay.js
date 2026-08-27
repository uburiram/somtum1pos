/**
 * Somtum1POS — markPaid / receipt / print
 * Split from pos.js (lines 2090-2570)
 */
/* global M, db, shopRef, esc, money, toast, uid, sha256, calcPaymentCover, fileToDataUrl, PP */
(function () {
  'use strict';
  window.M = window.M || {};
  Object.assign(window.M, {
  async markPaid(id, patch){
    const paidAt=Date.now();
    const cur=this.orders.find(x=>x.id===id);
    const payload=Object.assign({
      paymentStatus:'PAID',
      paidAt,
      paidAmount: patch.paidAmount!=null ? Number(patch.paidAmount) : Number(cur&&cur.total||0),
      changeAmount: Number(patch.changeAmount||0),
      paymentMethod: patch.paymentMethod||'CASH',
      needsRepay:false,
      repayAmount:0
    }, patch);
    if(payload.paidAmount==null || isNaN(payload.paidAmount)) payload.paidAmount=Number(cur&&cur.total||0);
    // จ่ายเงินแล้ว — ไม่ย้อนสถานะครัว
    // ถ้ายังเป็น AwaitingPayment (ของเก่า) → เข้า Pending (รอคิวทำ)
    if(cur && cur.status==='AwaitingPayment'){
      payload.status='Pending';
    }
    // ถ้าครัวทำเสร็จแล้ว (Ready) + จ่ายแล้ว ร้านกดเสร็จสมบูรณ์เอง
    // ไม่ auto-complete เพื่อให้ร้านตรวจสลิป/ยืนยันก่อน
    // 1) Cloud Function + secret (ปลอดภัยกว่า) ถ้าตั้งค่าแล้ว
    const base=(window.FUNCTIONS_BASE||'').replace(/\/$/,'');
    const secret=window.SHOP_OPS_SECRET||'';
    let updatedViaFn=false;
    if(base && /^https?:\/\//i.test(base) && secret){
      try{
        const r=await fetch(base+'/markOrderPaid',{
          method:'POST',
          headers:{'Content-Type':'application/json','X-Shop-Secret':secret},
          body:JSON.stringify({ shopId: window.SHOP_ID||'main', orderId:id, patch:payload })
        });
        const j=await r.json().catch(()=>({}));
        if(r.ok && j.ok) updatedViaFn=true;
        else console.warn('markOrderPaid CF', j);
      }catch(e){ console.warn('markOrderPaid CF', e); }
    }
    if(!updatedViaFn){
      try{
        await shopRef.collection('orders').doc(id).update(payload);
      }catch(e){
        const m=String(e&&e.message||e);
        if(/permission|PERMISSION|insufficient/i.test(m)){
          toast('ยืนยันชำระไม่สำเร็จ (สิทธิ์ Firestore) — ตรวจ rules หรือตั้ง Cloud Function');
        } else {
          toast('ยืนยันชำระไม่สำเร็จ: '+m);
        }
        throw e;
      }
    }
    // รีโหลดจาก Firestore เป็นแหล่งจริง
    const snap=await shopRef.collection('orders').doc(id).get();
    const full={id, ...(snap.data()||{})};
    try{ await this.awardMemberPoints(full); }catch(e){ console.warn(e); }
    // reload after points
    try{
      const snap2=await shopRef.collection('orders').doc(id).get();
      if(snap2.exists) Object.assign(full, snap2.data());
    }catch(e){}
    await this.writeReceipt(full);
    // อัปเดต local list ให้ตรง
    const idx=this.orders.findIndex(x=>x.id===id);
    if(idx>=0) this.orders[idx]=full;
    this.renderOrders();
    const after=this.orders.find(x=>x.id===id);
    if(after && after.status==='Ready'){
      toast('ชำระแล้ว → อยู่ใน「พร้อมรับ」· กดเสร็จสมบูรณ์เมื่อลูกค้ารับของ');
    } else {
      toast('ชำระแล้ว · บันทึกใบเสร็จ');
    }
  },
  async writeReceipt(order){
    const pub=(await shopRef.collection('settings').doc('public').get()).data()||{};
    const items=order.items||[];
    const subtotal=Number(order.subtotal)!=null && !isNaN(Number(order.subtotal))
      ? Number(order.subtotal)
      : items.reduce((s,i)=>s+Number(i.total||0),0);
    const receipt={
      id:order.id, orderId:order.id, queue:order.queue,
      shopName:pub.shopName||'ร้าน', accountName:pub.accountName||'',
      items:items,
      subtotal:subtotal,
      total:order.total,
      discountAmount:Number(order.discountAmount||0),
      pointsUsed:Number(order.pointsUsed||order.pointsDisc||0),
      pointsDisc:Number(order.pointsDisc||order.pointsUsed||0),
      couponDisc:Number(order.couponDisc||0),
      couponCode:String(order.couponCode||''),
      personalCouponId:order.personalCouponId||'',
      pointsEarned:Number(order.pointsEarned||0),
      memberPhone:order.memberPhone||'',
      memberName:order.memberName||'',
      contactPhone:order.contactPhone||'',
      paymentMethod:order.paymentMethod, paidAmount:order.paidAmount||order.total,
      changeAmount:order.changeAmount||0, paidAt:order.paidAt||Date.now(), createdAt:order.createdAt||Date.now()
    };
    await shopRef.collection('receipts').doc(order.id).set(receipt,{merge:true});
  },
  /** โหลดแต้ม/คูปองของสมาชิกในหน้า detail ให่ร้านใช้แทนลูกค้า */
  async loadPosMemberPanel(order){
    const box=document.getElementById('posMemberBox');
    if(!box) return;
    const phone=this.normPhone(order.memberPhone||order.contactPhone||'');
    if(!phone){ box.style.display='none'; return; }
    box.style.display='block';
    box.innerHTML='<div style="padding:10px;background:#F3E5F5;border-radius:10px;margin:10px 0;font-size:13px;text-align:center;color:#666">กำลังโหลดข้อมูลสมาชิก…</div>';
    try{
      const snap=await shopRef.collection('members').doc(phone).get();
      if(!snap.exists){
        box.innerHTML='<div style="padding:10px;background:#FFF8E1;border-radius:10px;margin:10px 0;font-size:13px;text-align:center">เบอร์ '+esc(phone)+' ยังไม่ใช่สมาชิก</div>';
        return;
      }
      const m={phone, ...snap.data()};
      if(m.status==='cancelled' || m.active===false || m.isActive===false || m.disabled===true){
        box.innerHTML='<div style="padding:10px;background:#FFEBEE;border-radius:10px;margin:10px 0;font-size:13px;text-align:center">สมาชิกถูกยกเลิกสิทธิ์</div>';
        return;
      }
      const pts=Math.max(0, Math.floor(Number(m.points||0)));
      const pcs=Array.isArray(m.personalCoupons)?m.personalCoupons.filter(c=>c&&!c.used):[];
      const alreadyPts=Math.max(0, Number(order.pointsUsed||0));
      const alreadyCp=String(order.couponCode||'');
      let cpOpts=pcs.map(c=>{
        const lab=(c.type==='percent'?(c.value+'%'):('฿'+c.value))+(c.note?(' · '+c.note):'');
        return '<option value="'+esc(c.id)+'">'+esc(lab)+'</option>';
      }).join('');
      box.innerHTML=`
        <div style="padding:12px;background:#F3E5F5;border:1px solid #CE93D8;border-radius:12px;margin:10px 0">
          <div style="font-weight:700;color:#6A1B9A;margin-bottom:6px">🎁 สิทธิ์สมาชิก (ร้านใช้แทนลูกค้า)</div>
          <div style="font-size:13px;margin-bottom:8px">แต้มคงเหลือ: <strong style="font-size:1.15rem;color:#6A1B9A">${pts}</strong> แต้ม (1 แต้ม = 1 บาท)</div>
          ${pcs.length?('<div style="font-size:12px;color:#555;margin-bottom:8px">คูปองส่วนตัวที่ยังใช้ได้: '+pcs.length+' ใบ</div>'):'<div style="font-size:12px;color:#888;margin-bottom:8px">ไม่มีคูปองส่วนตัว</div>'}
          <div style="font-size:12px;color:#C62828;margin-bottom:8px">⚠ ใช้แต้มหรือคูปองอย่างใดอย่างหนึ่งเท่านั้น (ใช้พร้อมกันไม่ได้)</div>
          <label class="lbl">ใช้แต้มลด (บาท)</label>
          <input type="number" id="posPtsUse" inputmode="numeric" min="0" max="${pts}" value="0" placeholder="0" style="margin-bottom:8px">
          <label class="lbl">หรือเลือกคูปองส่วนตัว</label>
          <select id="posCouponSel" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ccc;margin-bottom:8px">
            <option value="">— ไม่ใช้คูปอง —</option>
            ${cpOpts}
          </select>
          <button type="button" class="btn btn-p btn-block" onclick="M.applyPosMemberDiscount('${esc(order.id)}')">ใช้ส่วนลดสมาชิก</button>
          ${alreadyPts||alreadyCp?('<div style="margin-top:8px;font-size:12px;color:#2E7D32">ออเดอร์นี้ใช้แล้ว: '+(alreadyPts?('แต้ม '+alreadyPts):'')+(alreadyCp?((alreadyPts?' · ':'')+'คูปอง '+alreadyCp):'')+'</div>'):''}
        </div>`;
      // mutual exclusive UI
      const ptsEl=document.getElementById('posPtsUse');
      const cpEl=document.getElementById('posCouponSel');
      if(ptsEl && cpEl){
        ptsEl.addEventListener('input', function(){
          if(Number(ptsEl.value)>0) cpEl.value='';
        });
        cpEl.addEventListener('change', function(){
          if(cpEl.value) ptsEl.value='0';
        });
      }
    }catch(e){
      console.warn(e);
      box.innerHTML='<div style="padding:10px;color:#C62828;font-size:13px">โหลดสมาชิกไม่สำเร็จ</div>';
    }
  },

  /** ร้านใช้แต้มหรือคูปองแทนลูกค้า (ใช้พร้อมกันไม่ได้) */
  async applyPosMemberDiscount(orderId){
    const o=this.orders.find(x=>x.id===orderId);
    if(!o || o.paymentStatus==='PAID'){ toast('ออเดอร์นี้ชำระแล้ว'); return; }
    const phone=this.normPhone(o.memberPhone||o.contactPhone||'');
    if(!phone){ toast('ไม่มีเบอร์สมาชิก'); return; }
    if(Number(o.pointsUsed||0)>0 || Number(o.discountAmount||0)>0 || o.couponCode || o.personalCouponId){
      toast('ออเดอร์นี้ใช้ส่วนลดแล้ว · ไม่ซ้อนส่วนลดซ้ำ');
      return;
    }
    const wantPts=Math.max(0, Math.floor(Number((document.getElementById('posPtsUse')||{}).value||0)));
    const wantCpId=String((document.getElementById('posCouponSel')||{}).value||'').trim();
    if(wantPts>0 && wantCpId){
      toast('ใช้แต้มกับคูปองพร้อมกันไม่ได้ · เลือกอย่างใดอย่างหนึ่ง');
      return;
    }
    if(wantPts<=0 && !wantCpId){
      toast('ระบุแต้มหรือเลือกคูปอง');
      return;
    }
    try{
      await db.runTransaction(async tx=>{
        const oref=shopRef.collection('orders').doc(orderId);
        const os=await tx.get(oref);
        if(!os.exists) throw new Error('ไม่พบออเดอร์');
        const cur=os.data()||{};
        if(cur.paymentStatus==='PAID') throw new Error('ชำระแล้ว');
        if(Number(cur.pointsUsed||0)>0 || Number(cur.discountAmount||0)>0 || cur.couponCode || cur.personalCouponId){
          throw new Error('ออเดอร์นี้ใช้ส่วนลดแล้ว');
        }
        const mref=shopRef.collection('members').doc(phone);
        const ms=await tx.get(mref);
        if(!ms.exists) throw new Error('ไม่พบสมาชิก');
        const md=ms.data()||{};
        if(md.status==='cancelled' || md.active===false || md.isActive===false || md.disabled===true) throw new Error('สมาชิกถูกระงับสิทธิ์');
        const bal=Math.max(0, Math.floor(Number(md.points||0)));
        // คำนวณ subtotal จากรายการ (ก่อนส่วนลด)
        const itemsSum=(cur.items||[]).reduce((s,i)=>s+Number(i.total||0),0);
        const prevDisc=Math.max(0, Number(cur.discountAmount||0));
        const base=Math.max(0, itemsSum); // ใช้ยอดรายการเป็นฐาน
        let pointsUsed=0, couponDisc=0, couponCode='', personalCouponId='', pointsDisc=0;
        if(wantPts>0){
          pointsUsed=Math.min(wantPts, bal, Math.floor(base));
          pointsDisc=pointsUsed;
          // ตัดแต้ม
          tx.update(mref, { points: bal - pointsUsed, updatedAt: Date.now() });
        } else if(wantCpId){
          const pcs=Array.isArray(md.personalCoupons)?md.personalCoupons:[];
          const idx=pcs.findIndex(c=>c && String(c.id)===wantCpId && !c.used);
          if(idx<0) throw new Error('ไม่พบคูปองหรือใช้แล้ว');
          const c=pcs[idx];
          if(c.type==='percent'){
            couponDisc=Math.round(base * (Number(c.value||0)/100));
          } else {
            couponDisc=Math.min(base, Math.max(0, Number(c.value||0)));
          }
          couponCode=String(c.code||c.note||c.id||'PERSONAL');
          personalCouponId=String(c.id);
          const next=pcs.slice();
          next[idx]=Object.assign({}, c, {used:true, usedAt:Date.now(), usedOrderId:orderId});
          tx.update(mref, { personalCoupons: next, updatedAt: Date.now() });
        }
        const discountAmount=Math.min(base, pointsDisc + couponDisc);
        const newTotal=Math.max(0, base - discountAmount);
        tx.update(oref, {
          discountAmount,
          pointsUsed,
          pointsDisc,
          couponDisc,
          couponCode: couponCode || '',
          personalCouponId: personalCouponId || '',
          total: newTotal,
          memberPhone: phone,
          memberName: cur.memberName || ((md.firstName||'')+' '+(md.lastName||'')).trim(),
          updatedAt: Date.now()
        });
      });
      toast('ใช้ส่วนลดสมาชิกแล้ว');
      // refresh local + detail
      const snap=await shopRef.collection('orders').doc(orderId).get();
      if(snap.exists){
        const idx=this.orders.findIndex(x=>x.id===orderId);
        if(idx>=0) this.orders[idx]=Object.assign({}, this.orders[idx], snap.data());
      }
      this.openDetail(orderId);
    }catch(e){
      console.error(e);
      toast('ใช้ส่วนลดไม่สำเร็จ: '+(e.message||e));
    }
  },

  async payCash(id){
    const o=this.orders.find(x=>x.id===id); if(!o) return;
    const cashEl=document.getElementById('cashIn');
    // tendered = เงินสดที่ลูกค้ายื่น (อาจมากกว่ายอดบิล → มีทอน)
    const tendered=Number(cashEl && cashEl.value);
    const cov=calcPaymentCover(o);
    const billTotal=cov.billTotal;
    const isPartial=!!(o.needsRepay || (o.paymentStatus!=='PAID' && cov.covered>0) || cov.due>0);
    // ยอดที่ต้องเก็บรอบนี้: ใช้ calcPaymentCover (ซ่อมข้อมูลเก่าที่ paidAmount รวมทอน)
    const need = isPartial ? cov.due : billTotal;
    if(isNaN(tendered) || tendered < need){
      toast('เงินไม่พอ (ต้องอย่างน้อย ฿'+need+')');
      return;
    }
    // paidAmount = ยอดที่ครอบคลุมบิล (ไม่ใช่เงินที่ยื่น)
    // ตัวอย่าง: บิล 90 รับ 100 → paidAmount=90, change=10
    // สั่งเพิ่ม 100 → total=190, covered=90, due=100
    const newPaidAmount = billTotal;
    const changeAmount = Math.max(0, tendered - need);
    await this.markPaid(id,{
      paymentMethod:'CASH',
      paidAmount: newPaidAmount,
      changeAmount: changeAmount,
      needsRepay:false,
      repayAmount:0
    });
    if(changeAmount > 0){
      toast('รับเงินสด ฿'+tendered+' · เงินทอน ฿'+changeAmount);
    } else {
      toast('รับเงินสดครบ ฿'+tendered);
    }
    this.openDetail(id);
  },
  async payPP(id){
    const o=this.orders.find(x=>x.id===id); if(!o) return;
    // รับโอนแล้ว = ถือว่ายอดครบทั้งบิล
    await this.markPaid(id,{
      paymentMethod:'PROMPTPAY',
      paidAmount: Number(o.total||0),
      changeAmount:0,
      slipStatus: o.slipStatus==='PENDING_REVIEW'?'APPROVED':(o.slipStatus||'NONE'),
      needsRepay:false,
      repayAmount:0
    });
    this.openDetail(id);
  },
  async reviewSlip(id,status){
    if(status==='APPROVED'){
      const o=this.orders.find(x=>x.id===id);
      await this.markPaid(id,{paymentMethod:'PROMPTPAY',paidAmount:o?.total||0,changeAmount:0,slipStatus:'APPROVED'});
    } else {
      await shopRef.collection('orders').doc(id).update({slipStatus:'REJECTED'});
      toast('สลิปไม่ผ่าน');
    }
    this.openDetail(id);
  },
  async showReceipt(id){
    let r=(await shopRef.collection('receipts').doc(id).get()).data();
    const o=this.orders.find(x=>x.id===id);
    if(!r && o){ await this.writeReceipt({id, ...o}); r=(await shopRef.collection('receipts').doc(id).get()).data(); }
    if(!r && o){
      const items=o.items||[];
      const sub=Number(o.subtotal)!=null && !isNaN(Number(o.subtotal))?Number(o.subtotal):items.reduce((s,i)=>s+Number(i.total||0),0);
      r={ queue:o.queue, shopName:document.getElementById('shopTitle')?.textContent||'ร้าน', items:items, total:o.total,
          subtotal:sub, discountAmount:Number(o.discountAmount||0),
          pointsUsed:Number(o.pointsUsed||o.pointsDisc||0), couponDisc:Number(o.couponDisc||0),
          couponCode:String(o.couponCode||''), pointsEarned:Number(o.pointsEarned||0),
          memberPhone:o.memberPhone||'', memberName:o.memberName||'', contactPhone:o.contactPhone||'',
          paymentMethod:o.paymentMethod, paidAmount:o.paidAmount||o.total, changeAmount:o.changeAmount||0,
          paidAt:o.paidAt||o.createdAt, createdAt:o.createdAt };
    }
    if(!r){ toast('ยังไม่มีใบเสร็จ'); return; }
    // merge member fields จาก order ถ้า receipt เก่าไม่มี
    if(o){
      if(!r.memberPhone && o.memberPhone) r.memberPhone=o.memberPhone;
      if(!r.memberName && o.memberName) r.memberName=o.memberName;
      if(!r.contactPhone && o.contactPhone) r.contactPhone=o.contactPhone;
      if(r.pointsEarned==null && o.pointsEarned!=null) r.pointsEarned=o.pointsEarned;
      if(r.pointsUsed==null && (o.pointsUsed!=null||o.pointsDisc!=null)) r.pointsUsed=Number(o.pointsUsed||o.pointsDisc||0);
      if(r.couponDisc==null && o.couponDisc!=null) r.couponDisc=o.couponDisc;
      if(!r.couponCode && o.couponCode) r.couponCode=o.couponCode;
      if(r.subtotal==null && o.subtotal!=null) r.subtotal=o.subtotal;
    }
    const lines=(r.items||[]).map(i=>{
      const tops=(i.toppings||[]).map(t=>`${esc(t.name)} x${t.qty}`).join(', ');
      const spice=i.spiceName?`<div style="font-size:12px;color:#BF360C">🌶️ เผ็ด: ${esc(i.spiceName)}</div>`:'';
      const plara=i.plara?`<div style="font-size:12px;color:#555">🐟 ${esc(i.plara)}</div>`:'';
      const note=i.note?`<div style="font-size:12px;color:#E65100">📝 ${esc(i.note)}</div>`:'';
      return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #eee"><span>${esc(i.name)} x${i.qty}${spice}${plara}${tops?`<div style="font-size:12px;color:#777">+ ${tops}</div>`:''}${note}</span><span>${money(i.total)}</span></div>`;
    }).join('');
    const itemsSub = (Number(r.subtotal)!=null && !isNaN(Number(r.subtotal)) && Number(r.subtotal)>0)
      ? Number(r.subtotal)
      : (r.items||[]).reduce((s,i)=>s+Number(i.total||0),0);
    const ptsUsed = Math.max(0, Number(r.pointsUsed||r.pointsDisc||0));
    const cDisc = Math.max(0, Number(r.couponDisc||0));
    const cCode = String(r.couponCode||'').trim();
    const grand = Number(r.total!=null ? r.total : Math.max(0, itemsSub - ptsUsed - cDisc));
    let discLines = '';
    if(ptsUsed>0 || cDisc>0){
      discLines += `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px"><span>รวม</span><span>${money(itemsSub)}</span></div>`;
      if(cDisc>0){
        const lab = cCode && !cCode.startsWith('PERSONAL:') ? ('คูปอง '+esc(cCode)) : (cCode.startsWith('PERSONAL:')?'คูปองส่วนตัว':'คูปอง');
        discLines += `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:13px;color:#C62828"><span>- ${lab}</span><span>-${money(cDisc)}</span></div>`;
      }
      if(ptsUsed>0){
        discLines += `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:13px;color:#C62828"><span>- แต้มลูกค้า ${ptsUsed} แต้ม</span><span>-${money(ptsUsed)}</span></div>`;
      }
    }
    // สมาชิกท้ายใบเสร็จ (โหลดสดถ้ามีเบอร์)
    let memberFooter = '';
    const mPhone = this.normPhone(r.memberPhone||r.contactPhone||'');
    if(mPhone){
      let mName = String(r.memberName||'').trim();
      let remainPts = null;
      let couponsHtml = '';
      try{
        const ms = await shopRef.collection('members').doc(mPhone).get();
        if(ms.exists){
          const md = ms.data()||{};
          if(!mName) mName = (String(md.firstName||'')+' '+String(md.lastName||'')).trim();
          remainPts = Math.max(0, Math.floor(Number(md.points||0)));
          const now = Date.now();
          const cps = (Array.isArray(md.personalCoupons)?md.personalCoupons:[]).filter(c=>c&&!c.used&&(!c.expiresAt||Number(c.expiresAt)>now));
          if(cps.length){
            couponsHtml = '<div style="margin-top:4px">คูปองที่มี:</div>' + cps.map(c=>{
              const lab = c.type==='percent'?(c.value+'%'):('฿'+c.value);
              return '<div style="margin-left:6px">• '+esc(c.note||lab)+' ('+lab+')</div>';
            }).join('');
          }
        }
      }catch(e){ console.warn('receipt member', e); }
      const earned = Math.max(0, Number(r.pointsEarned||0));
      memberFooter = `<div style="margin-top:12px;padding:10px;background:#F3E5F5;border-radius:8px;font-size:12px;color:#6A1B9A;text-align:left;line-height:1.55">
        <div style="font-weight:700;text-align:center;margin-bottom:6px">👤 ข้อมูลสมาชิก</div>
        <div>ชื่อ-นามสกุล: <strong>${esc(mName||'-')}</strong></div>
        <div>เบอร์โทร: <strong>${esc(mPhone)}</strong></div>
        <div>ใช้แต้ม: <strong>${ptsUsed}</strong> แต้ม · ได้แต้ม: <strong>+${earned}</strong> แต้ม${remainPts!=null?(' · เหลือ: <strong>'+remainPts+'</strong> แต้ม'):''}</div>
        ${couponsHtml}
      </div>`;
    }
    const receiptHtml=`<div id="receiptPrintContent" style="font-family:Prompt,sans-serif;padding:16px;color:#000;background:#fff;max-width:400px;margin:0 auto">
        <h2 style="text-align:center;color:#FF5722;margin:0 0 6px">${esc(r.shopName||'ร้าน')}</h2>
        <div style="text-align:center;font-size:13px">ใบเสร็จรับเงิน</div>
        <div style="text-align:center;font-size:16px;font-weight:700;margin:4px 0">คิว ${esc(r.queue||'')}</div>
        <div style="text-align:center;font-size:12px;color:#555;margin-bottom:10px">${new Date(r.paidAt||r.createdAt||Date.now()).toLocaleString('th-TH')}</div>
        ${lines||'<div style="text-align:center;color:#999">ไม่มีรายการ</div>'}
        ${discLines || ''}
        <div style="border-top:2px solid #333;margin-top:10px;padding-top:8px;display:flex;justify-content:space-between;font-weight:700;font-size:1.15rem">
          <span>รวมทั้งสิ้น</span><span>${money(grand)}</span>
        </div>
        <div style="margin-top:8px;font-size:13px">ชำระ: ${r.paymentMethod==='CASH'?'เงินสด':'QR / พร้อมเพย์'} (ชำระแล้ว)</div>
        ${r.changeAmount?`<div style="font-size:13px">ทอน: ${money(r.changeAmount)}</div>`:''}
        ${memberFooter}
      </div>`;
    this._lastReceiptHtml = receiptHtml;
    try{document.getElementById('detailModal').classList.add('on');}catch(e){}
    (document.getElementById('detailBody')||{}).innerHTML=`
      <button class="btn btn-o btn-sm" onclick="(function(){var m=document.getElementById('detailModal'); if(m) m.classList.remove('on');})()">← ปิด</button>
      <div style="border:1px dashed #ccc;border-radius:12px;margin-top:12px;overflow:hidden">${receiptHtml}</div>
      <button class="btn btn-g btn-block" style="margin-top:12px" onclick="M.printReceiptNow()">🖨️ พิมพ์ใบเสร็จ</button>`;
  },
  printReceiptNow(){
    const html=this._lastReceiptHtml || document.getElementById('receiptPrintContent')?.outerHTML || '';
    if(!html){ toast('ไม่มีข้อมูลใบเสร็จ'); return; }
    this.printHtmlDocument(html, 'ใบเสร็จรับเงิน');
  },
  /** พิมพ์ผ่าน iframe — กันหน้าว่างบน Android Chrome */
  printHtmlDocument(html, title){
    try{
      let iframe=document.getElementById('_printFrame');
      if(iframe) iframe.remove();
      iframe=document.createElement('iframe');
      iframe.id='_printFrame';
      iframe.setAttribute('style','position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none');
      document.body.appendChild(iframe);
      const doc=iframe.contentWindow.document;
      doc.open();
      doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">');
      doc.write('<title>'+String(title||'พิมพ์')+'</title>');
      doc.write('<style>html,body{margin:0;padding:12px;background:#fff;color:#000;font-family:Prompt,Tahoma,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact} img{max-width:100%}</style>');
      doc.write('</head><body>');
      doc.write(html);
      doc.write('</body></html>');
      doc.close();
      const win=iframe.contentWindow;
      const doPrint=()=>{
        try{ win.focus(); win.print(); }catch(e){ console.warn(e); toast('พิมพ์ไม่สำเร็จ'); }
      };
      // รอโหลดรูป/layout
      setTimeout(doPrint, 400);
      setTimeout(()=>{ try{ iframe.remove(); }catch(e){} }, 60000);
    }catch(e){
      console.error(e);
      // fallback printArea
      let area=document.getElementById('printArea');
      if(!area){ area=document.createElement('div'); area.id='printArea'; document.body.appendChild(area); }
      area.classList.remove('hide');
      area.style.cssText='display:block!important;visibility:visible!important;position:fixed;left:0;top:0;width:100%;background:#fff;color:#000;z-index:99999;padding:16px';
      area.innerHTML=html;
      setTimeout(()=>{ window.print(); setTimeout(()=>{ area.classList.add('hide'); area.style.display='none'; area.innerHTML=''; }, 500); }, 250);
    }
  },


  scrollToForm(focusId){
    try{
      // เปิดแท็บจัดการร้านถ้ายังไม่เปิด
      const panelShop=document.getElementById('panelShop');
      if(panelShop && panelShop.classList.contains('hide')){
        this.tab('shop');
      }
      const el=document.getElementById(focusId);
      if(!el) return;
      // เลื่อนทันทีหลายรอบ เผื่อรายการเยอะ / layout ยังไม่เสร็จ
      const go=()=>{
        try{
          el.scrollIntoView({behavior:'smooth', block:'start', inline:'nearest'});
          // สำรอง: เลื่อน window โดยตรง
          const rect=el.getBoundingClientRect();
          const y=window.pageYOffset + rect.top - 80; // เว้น header sticky
          window.scrollTo({top: Math.max(0,y), behavior:'smooth'});
          try{ el.focus({preventScroll:true}); }catch(e){ try{ el.focus(); }catch(e2){} }
          el.classList.add('status-hl');
          setTimeout(()=>{ try{ el.classList.remove('status-hl'); }catch(e){} }, 1800);
        }catch(e){}
      };
      go();
      setTimeout(go, 50);
      setTimeout(go, 200);
      setTimeout(go, 450);
    }catch(e){}
  },
  });
})();
