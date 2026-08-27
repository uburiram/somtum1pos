/**
 * Somtum1POS — create order / ticket / kitchen
 * Auto-split from customer.js (lines 2329-3360)
 */
/* global C, db, shopRef, esc, money, toast, uid, showErr, sha256, calcPaymentCover, fileToDataUrl, PP, checkConfig, migrateAndSeed, checkOrderRateLimit */
(function () {
  'use strict';
  window.C = window.C || {};
  Object.assign(window.C, {
  async confirmOrder(){
    this.payM='PROMPTPAY';
    if(!this.assertShopOpen()) return;
    // มีออเดอร์แล้ว: โหมดคิว → เปิดตั๋ว / โหมดโต๊ะ+มีของในตะกร้า → เพิ่มเข้าออเดอร์เดิม
    if(this.orderId && this.lastOrder){
      const st=this.lastOrder.status;
      if(st==='Cancelled' || st==='Completed'){
        this.clearOrderState();
      } else if(this.orderMode==='table' && this.tableNo && this.cart && this.cart.length){
        // อนุญาตเพิ่มเมนูเข้าโต๊ะเดิม
      } else {
        this.renderTicket(this.lastOrder);
        this.hide('mPay'); this.hide('mCart'); this.show('mTicket');
        toast(this.orderMode==='table' ? ('โต๊ะ '+(this.tableNo||'')+' · '+(this.lastOrder.queue||'')) : ('คิวของคุณ: '+(this.lastOrder.queue||'')));
        return;
      }
    }
    if(!this.cart || !this.cart.length){
      toast('ตะกร้าว่าง · เลือกเมนูก่อนยืนยัน');
      return;
    }
    const btn=document.getElementById('btnOrder');
    if(btn){ btn.disabled=true; btn.textContent='กำลังส่ง…'; }
    try{
      await this.createOrderInternal({
        status: 'Pending',
        paymentStatus: 'UNPAID'
      });
      // createOrderInternal เปิดตั๋วคิวแล้ว — รีเซ็ตปุ่มเผื่อเปิด mPay อีก
      if(btn){ btn.disabled=false; btn.textContent='ยืนยันออเดอร์'; }
    }catch(e){
      console.error(e);
      toast(this._orderErrMsg(e));
      if(btn){ btn.disabled=false; btn.textContent='ยืนยันออเดอร์'; }
    }
  },

  _orderErrMsg(e){
    const m=String((e&&e.message)||e||'');
    if(/permission|PERMISSION|insufficient/i.test(m)) return 'ไม่มีสิทธิ์บันทึกออเดอร์ (Firestore rules) — แจ้งร้านตรวจ rules';
    if(/อยู่นอกเวลาทำการ/.test(m)) return m;
    if(/ตะกร้าว่าง/.test(m)) return m;
    if(/โหมดโต๊ะ/.test(m)) return m;
    if(/กำลังสร้างออเดอร์/.test(m)) return m;
    return 'สร้างออเดอร์ไม่สำเร็จ: '+m;
  },
  async createOrderInternal(opts){
    if(this.isOpen===false){
      throw new Error('อยู่นอกเวลาทำการ · ขออภัยในความไม่สะดวก');
    }
    // กันกดซ้ำ / race สร้างออเดอร์คู่
    if(this._creatingOrder){
      throw new Error('กำลังสร้างออเดอร์ กรุณารอสักครู่');
    }
    if(this.orderId && this.lastOrder){
      const st=this.lastOrder.status;
      if(st==='Cancelled' || st==='Completed'){
        this.clearOrderState();
      } else if(this.orderMode==='table' && this.tableNo && (this.cart||[]).length){
        // โหมดโต๊ะ: ไม่ return — ไปรวมรายการเข้าออเดอร์โต๊ะเดิม
      } else {
        // โหมดคิว: มีคิวยังไม่จบ — ไม่สร้างซ้ำ
        return this.lastOrder;
      }
    }
    const items=(this.cart||[]).map(i=>({
      name:i.name,qty:i.qty,spiceName:i.spiceName,
      toppings:(i.toppings||[]).map(t=>({name:t.name,price:t.price,qty:t.qty,total:t.total})),
      note:i.note||'', plara:i.plara||'', unitPrice:i.unitPrice,total:i.total,
      catId:i.catId||'', catName:i.catName||''
    })).filter(i=>i && i.name && Number(i.qty)>0);
    // เช็คว่างก่อนจองคิว — กันเลขคิวรั่ว
    if(!items.length){
      throw new Error('ตะกร้าว่าง ไม่สามารถสร้างออเดอร์ได้');
    }
    const subtotal=items.reduce((s,i)=>s+Number(i.total||0),0);
    // sync UI ส่วนลด แล้วใช้เฉพาะ "ความตั้งใจ" (จำนวนแต้ม/รหัสคูปอง) — ยอดส่วนลดคำนวณใหม่จาก Firestore ใน transaction
    try{ await this.recalcPayTotal(); }catch(e){}
    const md=this.memDiscount||{};
    const contactPhone=this.normPhone((document.getElementById('memPhone')||{}).value||'');
    // ถ้าใส่เบอร์แล้ว — ตรวจสมาชิกอัตโนมัติทุกครั้งก่อนสร้างออเดอร์ (ไม่ต้องกดค้นหา)
    if(contactPhone.length>=9 && this.memberSystemEnabled!==false){
      try{
        // ถ้ายังไม่มี this.member หรือเบอร์ไม่ตรง — lookup ใหม่
        if(!(this.member&&this.normPhone(this.member.phone)===contactPhone)){
          const snap=await shopRef.collection('members').doc(contactPhone).get();
          if(snap.exists){
            const md={phone:contactPhone, ...snap.data()};
            if(md.status!=='cancelled' && md.active!==false && md.isActive!==false && md.disabled!==true){
              this.member=md;
            } else {
              this.member=null;
            }
          } else {
            this.member=null;
          }
        }
      }catch(e){ console.warn('auto member lookup', e); }
    }
    // ถ้าแอดมินปิดระบบสมาชิก — ไม่ใช้แต้ม/คูปอง (เก็บแค่เบอร์ติดต่อ)
    const memOn=this.memberSystemEnabled!==false;
    // บังคับ: ถ้าเป็นสมาชิก ต้องมี memberPhone + จะได้ memberName ตอนบันทึกออเดอร์
    let memberPhone='';
    if(memOn && this.member && this.member.phone){
      memberPhone=this.normPhone(this.member.phone)||contactPhone;
    } else if(memOn && contactPhone.length>=9 && this.member){
      memberPhone=contactPhone;
    }
    const wantPts=(memOn && memberPhone)?Math.max(0, Math.floor(Number(md.pointsUsed||0))):0;
    let wantPersonalId=(memOn && memberPhone)?(md.personalCouponId||''):'';
    // คูปองรวมใช้ได้เมื่อระบบสมาชิกเปิด (แม้ไม่เป็นสมาชิก) — ปิดระบบแล้วไม่รับคูปอง
    let wantCouponCode=memOn?String(md.couponCode||''):'';
    if(String(wantCouponCode).startsWith('PERSONAL:')) wantCouponCode='';
    if(wantPersonalId) wantCouponCode=''; // ส่วนตัวมาก่อน
    const isPublicIntent=!!(wantCouponCode && !String(wantCouponCode).startsWith('PERSONAL:'));

    let pointsUsed=0, couponDisc=0, pointsDisc=0, couponCode='', personalCouponId='';
    let discountAmount=0;
    let total=subtotal;
    if(!(total>=0) || total>=200000){
      throw new Error('ยอดออเดอร์ไม่ถูกต้อง');
    }

    this._creatingOrder=true;
    this._pendingBenefits={ memberPhone, pointsUsed:0, personalCouponId:'', couponCode:'' };
    try{
    // ตัดแต้ม/คูปองส่วนตัว (ต้องเป็นสมาชิก) + คูปองรวม (ใช้ได้ทุกคน) — คำนวณส่วนลดจาก Firestore
    if(wantPts>0 || isPublicIntent || wantPersonalId){
      const benefit=await db.runTransaction(async tx=>{
        const now=Date.now();
        let pts=0;
        let personalCoupons=[];
        let mref=null;
        let md0={};
        if(memberPhone && (wantPts>0 || wantPersonalId)){
          mref=shopRef.collection('members').doc(memberPhone);
          const ms=await tx.get(mref);
          if(!ms.exists) throw new Error('ไม่พบสมาชิก');
          md0=ms.data()||{};
          if(md0.status==='cancelled' || md0.active===false || md0.isActive===false || md0.disabled===true) throw new Error('สมาชิกถูกระงับสิทธิ์');
          pts=Number(md0.points||0);
          personalCoupons=Array.isArray(md0.personalCoupons)?md0.personalCoupons.slice():[];
        }
        let cDisc=0, cCode='', pcId='';

        if(wantPersonalId){
          if(!memberPhone) throw new Error('คูปองส่วนตัวต้องเป็นสมาชิก');
          const ix=personalCoupons.findIndex(c=>c && String(c.id)===String(wantPersonalId));
          if(ix<0) throw new Error('ไม่พบคูปองส่วนตัว');
          const pc=personalCoupons[ix];
          if(pc.used) throw new Error('คูปองส่วนตัวถูกใช้แล้ว');
          if(pc.expiresAt && Number(pc.expiresAt)<now) throw new Error('คูปองส่วนตัวหมดอายุ');
          if(pc.minOrder!=null && subtotal<Number(pc.minOrder)) throw new Error('ยอดไม่ถึงขั้นต่ำคูปองส่วนตัว ฿'+pc.minOrder);
          if(pc.type==='percent') cDisc=Math.floor(subtotal*Number(pc.value||0)/100);
          else cDisc=Math.floor(Number(pc.value||0));
          cDisc=Math.min(Math.max(0,cDisc), Math.floor(subtotal));
          pcId=String(pc.id);
          cCode='PERSONAL:'+pcId;
          personalCoupons[ix]=Object.assign({}, pc, {used:true, usedAt:now});
        } else if(isPublicIntent){
          const code=String(wantCouponCode).trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
          const cref=shopRef.collection('coupons').doc(code);
          const cs=await tx.get(cref);
          if(!cs.exists) throw new Error('ไม่พบคูปอง');
          const c=cs.data()||{};
          if(c.active===false || c.isActive===false || c.disabled===true) throw new Error('คูปองปิดใช้งาน');
          if(c.expiresAt && Number(c.expiresAt)<now) throw new Error('คูปองหมดอายุ');
          const used=Number(c.usedCount||0), max=c.maxUses!=null?Number(c.maxUses):null;
          if(max!=null && used>=max) throw new Error('คูปองใช้ครบแล้ว');
          if(c.minOrder!=null && subtotal<Number(c.minOrder)) throw new Error('ยอดไม่ถึงขั้นต่ำคูปอง ฿'+c.minOrder);
          if(c.type==='percent') cDisc=Math.floor(subtotal*Number(c.value||0)/100);
          else cDisc=Math.floor(Number(c.value||0));
          cDisc=Math.min(Math.max(0,cDisc), Math.floor(subtotal));
          cCode=code;
          tx.update(cref,{ usedCount:used+1, updatedAt:now });
        }

        const afterCoupon=Math.max(0, subtotal-cDisc);
        let pUsed=0;
        if(memberPhone && wantPts>0){
          pUsed=Math.min(Math.max(0,wantPts), Math.floor(pts), Math.floor(afterCoupon));
          if(pUsed>0){
            if(pts<pUsed) throw new Error('แต้มไม่พอ');
            pts=pts-pUsed;
          }
        }
        // อัปเดตสมาชิกเฉพาะเมื่อมีการตัดแต้มหรือใช้คูปองส่วนตัว
        if(mref && (pUsed>0 || pcId)){
          tx.update(mref,{ points:pts, personalCoupons, updatedAt:now });
        }
        return { pointsUsed:pUsed, couponDisc:cDisc, pointsDisc:pUsed, couponCode:cCode, personalCouponId:pcId };
      });
      pointsUsed=Number(benefit.pointsUsed||0);
      couponDisc=Number(benefit.couponDisc||0);
      pointsDisc=Number(benefit.pointsDisc||0);
      couponCode=benefit.couponCode||'';
      personalCouponId=benefit.personalCouponId||'';
      const isPublicCoupon=couponCode && !String(couponCode).startsWith('PERSONAL:');
      this._pendingBenefits={ memberPhone, pointsUsed, personalCouponId, couponCode: isPublicCoupon ? couponCode : '' };
    }
    discountAmount=Math.min(Math.max(0, couponDisc+pointsDisc), subtotal);
    total=Math.max(0, Math.round((subtotal-discountAmount)*100)/100);
    if(!(total>=0) || total>=200000){
      throw new Error('ยอดออเดอร์ไม่ถูกต้อง');
    }
    const fullyCovered=total<=0 && (discountAmount>0 || pointsUsed>0);
    const useTable = this.orderMode==='table' && this.tableNo;
    if(this.orderMode==='table' && !this.tableNo){
      throw new Error('โหมดโต๊ะ: กรุณาสแกน QR โต๊ะก่อนสั่ง');
    }

    let id, queue, order;

    if(useTable){
      // ===== โหมดโต๊ะ: 1 โต๊ะ = 1 ออเดอร์ · เพิ่มเมนูรวมออเดอร์เดิมจนกว่าจะเคลียร์ =====
      const tableId=String(this.tableNo);
      const tref=shopRef.collection('tables').doc(tableId);
      const result=await db.runTransaction(async tx=>{
        const ts=await tx.get(tref);
        const td=ts.exists? (ts.data()||{}) : {};
        let activeId=td.activeOrderId||null;
        let existing=null;
        if(activeId){
          const oref=shopRef.collection('orders').doc(activeId);
          const os=await tx.get(oref);
          if(os.exists){
            const od=os.data()||{};
            if(od.status==='Cancelled' || od.status==='Completed'){
              activeId=null;
            } else {
              existing={ id:activeId, ...od };
            }
          } else {
            activeId=null;
          }
        }
        if(existing){
          // เพิ่มรายการเข้าออเดอร์เดิม + ติดป้ายสั่งเพิ่มครั้งที่ N
          const prevRound=Math.max(0, Math.floor(Number(existing.addRoundCount||0)));
          const addRound=prevRound+1;
          const tagged=items.map(it=>Object.assign({}, it, {
            addRound: addRound,
            addLabel: 'สั่งเพิ่มครั้งที่ '+addRound,
            addedAt: Date.now()
          }));
          const mergedItems=(existing.items||[]).concat(tagged);
          const newSub=mergedItems.reduce((s,i)=>s+Number(i.total||0),0);
          // ส่วนลดรอบนี้คิดเฉพาะรายการใหม่ (subtotal) แล้วบวกเข้า discount เดิม
          const addDisc=Math.min(discountAmount, subtotal);
          const newDisc=Number(existing.discountAmount||0)+addDisc;
          const newTotal=Math.max(0, newSub-newDisc);
          // Ready (ออกจากครัวแล้ว) → กลับครัว + ไปท้ายคิว
          // Cooking/Pending (ยังค้างครัว) → อยู่คิวเดิม ไม่เลื่อน kitchenSortAt
          const prevSt=String(existing.status||'Pending');
          const wasFinished = (prevSt==='Ready');
          const stillInKitchen = (prevSt==='Pending' || prevSt==='Cooking' || prevSt==='AwaitingPayment');
          const patch={
            items:mergedItems,
            subtotal:newSub,
            total:newTotal,
            discountAmount:newDisc,
            pointsUsed:Number(existing.pointsUsed||0)+(pointsUsed||0),
            couponDisc:Number(existing.couponDisc||0)+Number(couponDisc||0),
            pointsDisc:Number(existing.pointsDisc||0)+Number(pointsDisc||0),
            updatedAt:Date.now(),
            hasNewItems:true,
            lastAddAt:Date.now(),
            etaAnchorAt:Date.now(), // เริ่มจับเวลาใหม่เมื่อมีเมนูเข้า
            addRoundCount:addRound,
            lastAddRound:addRound,
            returnedToKitchen: !!wasFinished,
            returnedToKitchenAt: wasFinished ? Date.now() : (existing.returnedToKitchenAt||0)
          };
          if(wasFinished){
            patch.status='Pending';
            patch.kitchenSortAt=Date.now(); // ท้ายคิว
          } else if(stillInKitchen){
            // คง kitchenSortAt เดิม (หรือใช้ createdAt ถ้ายังไม่มี)
            if(existing.kitchenSortAt==null) patch.kitchenSortAt=Number(existing.createdAt||Date.now());
          }
          // สั่งเพิ่มทับออเดอร์ที่ชำระแล้ว → เปิดค้างชำระเฉพาะส่วนต่าง
          // สำคัญ: ยอดที่ครอบคลุมแล้ว = total ตอนชำระครบ (existing.total)
          // ห้ามใช้ paidAmount โดยตรง เพราะระบบเก่าอาจเก็บ paidAmount = เงินที่ยื่น (รวมทอน)
          // ตัวอย่าง: บิล 90 รับเงินสด 100 ทอน 10 → paidAmount เก่าอาจเป็น 100
          // สั่งเพิ่ม 100 → total ใหม่ 190 · ส่วนต่างต้องเป็น 100 ไม่ใช่ 90
          if(String(existing.paymentStatus||'')==='PAID' && !fullyCovered){
            const coveredAtPay = Number(existing.total||0);
            const rawPaid = Number(existing.paidAmount!=null ? existing.paidAmount : coveredAtPay);
            // ใช้ยอดที่ครอบคลุมจริง (ไม่เกิน total ตอนชำระ) — กันข้อมูลทอนปน
            const alreadyPaid = Math.min(Math.max(0, rawPaid), coveredAtPay) || coveredAtPay;
            const due = Math.max(0, Math.round((newTotal - alreadyPaid)*100)/100);
            patch.paymentStatus = due>0 ? 'UNPAID' : 'PAID';
            patch.paidAmount = alreadyPaid;
            patch.changeAmount = 0;
            patch.autoPaid = false;
            patch.paidByDiscount = false;
            if(due>0){
              patch.slipStatus = 'NONE';
              patch.slipData = '';
              patch.paymentMethod = 'PROMPTPAY';
              patch.needsRepay = true;
              patch.repayAmount = due;
              patch.reopenPayAt = Date.now();
            }
          }
          if(contactPhone && !existing.contactPhone) patch.contactPhone=contactPhone;
          if(memberPhone && !existing.memberPhone){
            patch.memberPhone=memberPhone;
            patch.memberName=this.member?this.escName(this.member):'';
          }
          tx.update(shopRef.collection('orders').doc(existing.id), patch);
          tx.set(tref,{
            tableNo:Number(this.tableNo),
            activeOrderId:existing.id,
            status:'occupied',
            updatedAt:Date.now()
          },{merge:true});
          return { id:existing.id, queue:existing.queue||('T'+String(this.tableNo).padStart(2,'0')), appended:true, order:{...existing, ...patch, id:existing.id} };
        }
        // สร้างออเดอร์ใหม่ผูกโต๊ะ
        const newId=uid();
        const q='T'+String(this.tableNo).padStart(2,'0');
        const baseItems=items.map(it=>Object.assign({}, it, { addRound:0, addLabel:'' }));
        const ord={
          id:newId, queue:q, items:baseItems, total, subtotal,
          discountAmount, pointsUsed: pointsUsed||0, couponCode: couponCode||'',
          personalCouponId: personalCouponId||'',
          couponDisc: Number(couponDisc||0), pointsDisc: Number(pointsDisc||0),
          memberPhone: memberPhone||'', contactPhone: contactPhone||memberPhone||'',
          memberName: (this.member?this.escName(this.member):'')||'',
          pointsAwarded:0, pointsEarned:0,
          status: opts.status||'Pending',
          paymentMethod: fullyCovered ? (pointsUsed>=discountAmount?'POINTS':'COUPON') : 'PROMPTPAY',
          paymentStatus: fullyCovered ? 'PAID' : (opts.paymentStatus||'UNPAID'),
          paidAmount: fullyCovered ? 0 : 0,
          changeAmount:0,
          paidAt: fullyCovered ? Date.now() : 0,
          autoPaid: !!fullyCovered,
          paidByDiscount: !!fullyCovered,
          slipData:'', slipStatus:'NONE',
          payRef: newId,
          createdAt: Date.now(),
          kitchenSortAt: Date.now(),
          etaAnchorAt: Date.now(),
          orderMode:'table',
          tableNo:Number(this.tableNo)
        };
        tx.set(shopRef.collection('orders').doc(newId), ord);
        tx.set(tref,{
          tableNo:Number(this.tableNo),
          activeOrderId:newId,
          status:'occupied',
          updatedAt:Date.now()
        },{merge:true});
        return { id:newId, queue:q, appended:false, order:ord };
      });
      id=result.id;
      queue=result.queue;
      order=result.order;
      this.orderId=id;
      this.lastOrder={id, ...order};
      try{ this.rememberTableOrder(this.lastOrder); }catch(e){}
      this.cart=[];
      try{ this.updFab(); }catch(e){}
      // ข้าม set order ด้านล่าง — ไป sync/ticket ต่อ
    } else {
    // ===== โหมดคิว (เดิม) =====
    const queueRef=shopRef.collection('settings').doc('queue');
    const today=new Date();
    const dayKey=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
    queue=await db.runTransaction(async tx=>{
      const snap=await tx.get(queueRef);
      const data=snap.exists?snap.data():{};
      let qNum=1;
      if(data.queueDate===dayKey) qNum=Number(data.queueCounter)||1;
      else qNum=1;
      if(qNum>999) qNum=1;
      const q='A'+String(qNum).padStart(3,'0');
      tx.set(queueRef,{ queueCounter:qNum+1, queueDate:dayKey },{merge:true});
      return q;
    });
    id=uid();
    order={
      id, queue, items, total, subtotal,
      discountAmount, pointsUsed: pointsUsed||0, couponCode: couponCode||'',
      personalCouponId: personalCouponId||'',
      couponDisc: Number(couponDisc||0), pointsDisc: Number(pointsDisc||0),
      memberPhone: memberPhone||'', contactPhone: contactPhone||memberPhone||'',
      memberName: (this.member?this.escName(this.member):'')||'',
      pointsAwarded:0, pointsEarned:0,
      status: opts.status||'Pending',
      paymentMethod: fullyCovered ? (pointsUsed>=discountAmount?'POINTS':'COUPON') : 'PROMPTPAY',
      paymentStatus: fullyCovered ? 'PAID' : (opts.paymentStatus||'UNPAID'),
      paidAmount: fullyCovered ? 0 : 0,
      changeAmount:0,
      paidAt: fullyCovered ? Date.now() : 0,
      autoPaid: !!fullyCovered,
      paidByDiscount: !!fullyCovered,
      slipData:'', slipStatus:'NONE',
      payRef: id,
      createdAt: Date.now(),
      kitchenSortAt: Date.now(),
      etaAnchorAt: Date.now(),
      orderMode:'queue'
    };
    await shopRef.collection('orders').doc(id).set(order);
    }
    // sync สิทธิ์บน client หลังตัดจริงแล้ว (กันสั่งซ้ำด้วยยอดแต้ม/คูปองเก่า)
    try{
      if(this.member && memberPhone){
        if(pointsUsed>0) this.member.points=Math.max(0, Number(this.member.points||0)-pointsUsed);
        if(personalCouponId && Array.isArray(this.member.personalCoupons)){
          this.member.personalCoupons=this.member.personalCoupons.map(c=>{
            if(c && String(c.id)===String(personalCouponId)) return Object.assign({}, c, {used:true, usedAt:Date.now()});
            return c;
          });
        }
      }
      this.selectedPersonalCouponId='';
      const ptsEl=document.getElementById('memPointsUse'); if(ptsEl) ptsEl.value='0';
      const cpEl=document.getElementById('memCoupon'); if(cpEl) cpEl.value='';
      this.memDiscount={ pointsUsed:0, couponCode:'', couponDisc:0, pointsDisc:0, totalDisc:0 };
    }catch(e){ console.warn('sync member local', e); }
    if(fullyCovered){
      try{ await this.awardMemberPoints(order); }catch(e){ console.warn(e); }
    }
    this.orderId=id;
    this.lastOrder={id,...order};
    // เติมชื่อสมาชิกทันทีถ้ายังว่าง (กันตั๋วไม่โชว์ชื่อ)
    try{
      if(this.lastOrder && this.member){
        const nm=this.escName(this.member);
        if(nm) this.lastOrder.memberName=nm;
        const ph=this.normPhone(this.member.phone||'');
        if(ph) this.lastOrder.memberPhone=ph;
      }
      // ถ้ายังไม่มีชื่อแต่มีเบอร์ — ดึงจาก Firestore ทันทีแล้วอัปเดตตั๋ว
      if(this.lastOrder && !this.lastOrder.memberName && (this.lastOrder.memberPhone||this.lastOrder.contactPhone)){
        const ph=this.normPhone(this.lastOrder.memberPhone||this.lastOrder.contactPhone);
        shopRef.collection('members').doc(ph).get().then(snap=>{
          if(!snap.exists || !this.lastOrder || this.lastOrder.id!==id) return;
          const md=snap.data()||{};
          const nm=(String(md.firstName||'')+' '+String(md.lastName||'')).trim();
          if(nm){
            this.lastOrder.memberName=nm;
            this.lastOrder.memberPhone=ph;
            // เขียนชื่อกลับออเดอร์ (ไม่บล็อก UI)
            shopRef.collection('orders').doc(id).update({ memberName:nm, memberPhone:ph }).catch(()=>{});
            try{ this.renderTicket(this.lastOrder); }catch(e){}
          }
        }).catch(()=>{});
      }
    }catch(e){}
    // แสดงคิวก่อนทันที — ทุกขั้นตอน UI หุ้ม try กันพังกลางทาง
    try{ this.cart=[]; }catch(e){}
    try{ this.renderCart(); }catch(e){ try{ this.updFab(); }catch(e2){} }
    try{ localStorage.setItem('somtum_last_order', JSON.stringify(this.lastOrder)); }catch(e){}
    try{ this.ensurePayQRAsImage(); }catch(e){}
    try{ this.renderTicket(this.lastOrder); }catch(e){ console.warn('renderTicket', e); }
    try{ this.hide('mPay'); }catch(e){}
    try{ this.hide('mCart'); }catch(e){}
    try{ this.show('mTicket'); }catch(e){}
    try{ this.attachTicketQR(); }catch(e){}
    try{ toast(useTable ? ('โต๊ะ '+this.tableNo+' · ออเดอร์ '+queue) : ('คิวของคุณ: '+queue)); }catch(e){}
    // แนบสลิป/ตรวจเงิน — เบื้องหลัง ไม่บล็อกหน้าคิว
    if(this.slipData){
      const slip=this.slipData;
      this.slipData='';
      setTimeout(()=>{ try{ this.uploadSlipToOrder(id, slip).catch(e=>console.warn('bg slip',e)); }catch(e){} }, 150);
    }
    try{ this.attachOrderWatcher(id); }catch(e){
      try{ if(this.unsub) this.unsub(); }catch(e2){}
      this.unsub=shopRef.collection('orders').doc(id).onSnapshot(snap=>{
        if(!snap.exists) return;
        if(this.orderId && this.orderId!==snap.id) return;
        const o=snap.data(); if(!o) return;
        if(this.orderMode==='table' && this.tableNo!=null && o.tableNo!=null
            && Number(o.tableNo)!==Number(this.tableNo)) return;
        const prevPay=this.lastOrder && this.lastOrder.paymentStatus;
        const prevSt=this.lastOrder && this.lastOrder.status;
        this.lastOrder={id:snap.id,...o};
        this._lastKnownStatus=o.status;
        this.renderTicket(this.lastOrder);
        if(prevPay!=='PAID' && o.paymentStatus==='PAID'){
          toast('ชำระเงินสำเร็จ');
          try{ C.writeReceipt({id:snap.id,...o}); }catch(e3){}
        }
        if(prevSt && prevSt!=='Ready' && prevSt!=='Completed' && o.status==='Ready'){
          this.notifyOrderReady({id:snap.id,...o});
        }
      });
    }
    this.startPayWatch(id);
    try{ this.ensureNotifyPermission(); }catch(e){}
    this._pendingBenefits=null;
    return order;
    } catch(err){
      try{
        const pb=this._pendingBenefits||{};
        if(pb.pointsUsed>0 || pb.personalCouponId || pb.couponCode){
          await this.refundMemberBenefits(pb);
        }
      }catch(e2){ console.warn(e2); }
      this._pendingBenefits=null;
      throw err;
    } finally {
      this._creatingOrder=false;
      this._pendingBenefits=null;
    }
  },

  async verifySlipEasy(dataUrl, amount){
    try{
      // EasySlip รับ binary — ส่งเป็น blob จาก dataUrl
      const res=await fetch(dataUrl); const blob=await res.blob();
      const fd=new FormData();
      fd.append('file', blob, 'slip.jpg');
      // บางผู้ให้บริการใช้ JSON base64 — ลอง endpoint มาตรฐาน
      const r=await fetch('https://developer.easyslip.com/api/v1/verify',{
        method:'POST',
        headers:{ Authorization: 'Bearer '+window.EASYSLIP_API_KEY },
        body: fd
      });
      if(!r.ok){
        const t=await r.text();
        return {ok:false,msg:'ตรวจสลิปอัตโนมัติไม่สำเร็จ ('+r.status+') — รอร้านตรวจมือ', raw:t};
      }
      const j=await r.json();
      const paid=Number(j?.data?.amount?.amount || j?.data?.amount || j?.amount || 0);
      if(paid && Math.abs(paid-amount)>1){
        return {ok:false,msg:'ยอดในสลิปไม่ตรง ฿'+paid, amount:paid, raw:j};
      }
      const slipTs=this.extractSlipDateFromEasy(j);
      return {ok:true,msg:'✓ ตรวจสลิปอัตโนมัติผ่าน', amount:paid||amount, slipTs, raw:j};
    }catch(e){
      return {ok:false,msg:'ตรวจอัตโนมัติไม่ได้ (อาจติด CORS) — รอร้านตรวจมือ', error:String(e.message||e)};
    }
  },
  async writeReceipt(order){
    if(!order||order.paymentStatus!=='PAID') return;
    const receipt={
      id: order.id,
      orderId: order.id,
      queue: order.queue,
      shopName: this.shopName,
      accountName: this.accountName,
      items: order.items||[],
      total: order.total,
      paymentMethod: order.paymentMethod,
      paidAmount: order.paidAmount||order.total,
      changeAmount: order.changeAmount||0,
      paidAt: order.paidAt||Date.now(),
      createdAt: order.createdAt||Date.now()
    };
    try{ await shopRef.collection('receipts').doc(order.id).set(receipt,{merge:true}); }catch(e){}
    try{
      const key='receipts';
      const arr=JSON.parse(localStorage.getItem(key)||'[]');
      const next=[receipt,...arr.filter(x=>x.id!==receipt.id)].slice(0,50);
      localStorage.setItem(key, JSON.stringify(next));
    }catch(e){}
  },

  isKitchenStatus(st){
    return ['Pending','Cooking','AwaitingPayment'].includes(st);
  },
  isSomtumItem(item){
    // ใช้เฉพาะหมวด "เมนูส้มตำ" ในการคำนวณเวลารอ — หมวดอื่นไม่นับ
    const cat=String(item.catName||item.categoryName||item.cat||'').trim();
    if(/เมนูส้มตำ/i.test(cat)) return true;
    if(/^ส้มตำ$/i.test(cat) || /หมวด.?ส้มตำ/i.test(cat)) return true;
    // ออเดอร์เก่าที่ไม่มี catName: ชื่อขึ้นต้น/มีคำว่าส้มตำ หรือ ตำ... แต่ไม่ใช่กินคู่/เครื่องดื่ม
    if(cat) return false; // มีหมวดชัดเจนแล้วแต่ไม่ใช่ส้มตำ → ไม่นับ
    const n=String(item.name||'');
    return /(ส้มตำ|^ตำ)/.test(n) && !/ยำ|ทอด|เครื่องดื่ม|ของทาน|กินคู่|ไข่เจียว|น้ำ/.test(n);
  },
  countSomtumQty(order){
    return (order.items||[]).reduce((s,it)=>{
      if(!this.isSomtumItem(it)) return s;
      return s+Number(it.qty||0);
    },0);
  },
  calcQueueEta(myOrder, kitchenOrders){
    if(!myOrder || !this.isKitchenStatus(myOrder.status)){
      return {ahead:0, minutes:0, inKitchen:false};
    }
    const sortKey=o=>Number(o.kitchenSortAt!=null?o.kitchenSortAt:(o.createdAt||0));
    const myT=sortKey(myOrder);
    const myId=myOrder.id;
    const kitchen=(kitchenOrders||[]).filter(o=>this.isKitchenStatus(o.status));
    const ahead=kitchen.filter(o=>{
      if(o.id===myId) return false;
      const t=sortKey(o);
      if(t<myT) return true;
      if(t===myT && String(o.id)<String(myId)) return true;
      return false;
    });
    const somtumAhead=ahead.reduce((s,o)=>s+this.countSomtumQty(o),0);
    // เมนูที่ยังต้องทำ: ถ้ากลับครัวหลังทำเสร็จแล้วสั่งเพิ่ม → นับเฉพาะรอบใหม่
    let somtumMine=0;
    if(myOrder.hasNewItems && myOrder.returnedToKitchen && Number(myOrder.lastAddRound)>0){
      somtumMine=(myOrder.items||[]).reduce((s,it)=>{
        if(Number(it.addRound)!==Number(myOrder.lastAddRound)) return s;
        if(!this.isSomtumItem(it)) return s;
        return s+Number(it.qty||0);
      },0);
      if(somtumMine<=0){
        somtumMine=(myOrder.items||[]).reduce((s,it)=>s+(Number(it.addRound)===Number(myOrder.lastAddRound)?Number(it.qty||0):0),0);
      }
    } else {
      somtumMine=this.countSomtumQty(myOrder);
    }
    const minutes=(somtumAhead+somtumMine)*2;
    return {ahead:ahead.length, minutes, inKitchen:true, somtumAhead, somtumMine};
  },
  startKitchenWatch(){
    if(this._kitchenUnsub){ try{this._kitchenUnsub()}catch(e){} this._kitchenUnsub=null; }
    if(!shopRef) return;
    const apply=(all)=>{
      this.kitchenOrders=all.filter(o=>this.isKitchenStatus(o.status));
      this.updateKitchenHeaderBadge();
      if(this.orderId){
        const mine=all.find(o=>o.id===this.orderId);
        if(mine){
          const prevStatus=(this.lastOrder&&this.lastOrder.status)||this._lastKnownStatus||'';
          this.lastOrder={id:mine.id,...mine};
          this._lastKnownStatus=mine.status;
          if(prevStatus && prevStatus!=='Ready' && prevStatus!=='Completed' && mine.status==='Ready'){
            this.notifyOrderReady(mine);
          }
          if(document.getElementById('mTicket') && document.getElementById('mTicket').classList.contains('on')){
            this.renderTicket(this.lastOrder);
          }
        }
      }
    };
    const attach=(q, fallback)=>{
      this._kitchenUnsub=q.onSnapshot(snap=>{
        apply(snap.docs.map(d=>({id:d.id,...d.data()})));
      }, err=>{
        console.warn('kitchen watch', err);
        if(fallback) fallback();
      });
    };
    attach(shopRef.collection('orders').orderBy('createdAt','desc').limit(300), ()=>{
      try{ if(this._kitchenUnsub) this._kitchenUnsub(); }catch(e){}
      attach(shopRef.collection('orders').limit(300), null);
    });
  },
  updateKitchenHeaderBadge(){
    const n=(this.kitchenOrders||[]).length;
    const badge=document.getElementById('kitchenQueueBadge');
    const num=document.getElementById('kitchenQueueCount');
    if(num) num.textContent=String(n);
    if(badge){
      if(n>0){ badge.style.display='inline-flex'; }
      else { badge.style.display='none'; }
    }
  },
  async ensureNotifyPermission(){
    try{
      if(!('Notification' in window)) return false;
      if(Notification.permission==='granted') return true;
      if(Notification.permission==='denied') return false;
      const p=await Notification.requestPermission();
      return p==='granted';
    }catch(e){ return false; }
  },
  async notifyOrderReady(order){
    const q=order&&order.queue?order.queue:'';
    // กันแจ้งซ้ำคิวเดียวกัน
    const tag='ready:'+q+':'+(order&&order.id||'');
    if(this._notifiedReady===tag) return;
    this._notifiedReady=tag;
    // แบนเนอร์ในแอป
    try{
      const b=document.getElementById('readyBanner');
      if(b){
        b.style.display='block';
        b.innerHTML='';
        const wrap=document.createElement('span');
        wrap.innerHTML='🔔 คิว <strong style="font-size:1.2rem">'+esc(q)+'</strong> พร้อมแล้ว · มารับอาหารได้เลย ';
        const btn=document.createElement('button');
        btn.type='button';
        btn.textContent='ปิด';
        btn.style.cssText='margin-left:10px;background:rgba(255,255,255,.25);color:#fff;border:none;border-radius:8px;padding:4px 10px;font-weight:600';
        btn.onclick=function(){ b.style.display='none'; };
        b.appendChild(wrap);
        b.appendChild(btn);
      }
    }catch(e){}
    toast('🔔 คิว '+q+' พร้อมแล้ว · มารับได้เลย');
    try{ if(navigator.vibrate) navigator.vibrate([200,80,200,80,400]); }catch(e){}
    try{
      const Ctx=window.AudioContext||window.webkitAudioContext;
      if(Ctx){
        const ctx=this._readyAudio||(this._readyAudio=new Ctx());
        await ctx.resume();
        const beep=(freq, when, dur)=>{
          const o=ctx.createOscillator(), g=ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.frequency.value=freq; g.gain.value=0.12;
          o.start(ctx.currentTime+when); o.stop(ctx.currentTime+when+dur);
        };
        beep(880,0,0.22); beep(1175,0.28,0.28);
      }
    }catch(e){}
    try{
      const ok=await this.ensureNotifyPermission();
      if(ok){
        const title='คิว '+q+' พร้อมแล้ว';
        const body=(this.shopName||'ร้าน')+' · มารับอาหารได้เลย';
        const reg=navigator.serviceWorker && await navigator.serviceWorker.ready.catch(function(){return null});
        if(reg && reg.showNotification){
          await reg.showNotification(title,{ body:body, icon:'./icon/icon-192.png', badge:'./icon/favicon-32.png', tag:'order-ready-'+q, renotify:true, requireInteraction:true });
        } else {
          new Notification(title,{ body:body, icon:'./icon/icon-192.png', tag:'order-ready-'+q });
        }
      }
    }catch(e){ console.warn('notify', e); }
  },
  stopKitchenWatch(){
    if(this._kitchenUnsub){ try{this._kitchenUnsub()}catch(e){} this._kitchenUnsub=null; }
  },

  renderTicket(o){
    const paid=(o.paymentStatus==='PAID');
    const cancelled=(o.status==='Cancelled');
    const hasSlip=!!(o.slipData) || (o.slipStatus && o.slipStatus!=='NONE');
    // แสดง QR ตลอดจนกว่าร้านยืนยันรับเงินแล้วเท่านั้น (รีเฟรช/ค้นคิว/แนบสลิปแล้วยังโชว์)
    const waitPay=!paid && !cancelled;
    const map={
      Pending: paid ? ['bw','🟡 รอครัวรับออเดอร์'] : ['bw','🟡 รอชำระเงิน / รอรับออเดอร์'],
      AwaitingPayment: paid ? ['bw','🟡 รอครัวรับออเดอร์'] : ['bw','🟡 รอชำระเงิน / รอรับออเดอร์'],
      Cooking:['bi','🔵 กำลังทำ'],
      Ready:['bg','🟢 พร้อมรับ'],
      Completed:['bg','⚫ เสร็จสิ้น'],
      Cancelled:['bd', o.cancelledBy==='customer'?'❌ ยกเลิกโดยลูกค้า':(o.cancelledBy==='shop'?'❌ ยกเลิกโดยร้าน':'❌ ยกเลิก')]
    };
    const st=cancelled?map.Cancelled:(map[o.status]||map.Pending);
    const lines=(o.items||[]).map(i=>{
      const tops=(i.toppings||[]).map(t=>`${esc(t.name)} x${t.qty}`).join(', ');
      const spice=i.spiceName?`<div style="font-size:12px;color:#BF360C">🌶️ เผ็ด: ${esc(i.spiceName)}</div>`:'';
      const pl=i.plara?`<div style="font-size:12px;color:#555">🐟 ${esc(i.plara)}</div>`:'';
      const note=i.note?`<div style="font-size:12px;color:#E65100">📝 ${esc(i.note)}</div>`:'';
      return `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px"><span>${esc(i.name)} × ${i.qty}${spice}${pl}${tops?`<div style="font-size:12px;color:#777">+ ${tops}</div>`:''}${note}</span><span>${money(i.total)}</span></div>`;
    }).join('');
    const orderCode=String(o.id||'').slice(0,12);
    // ชื่อสมาชิก: จากออเดอร์ หรือจาก this.member ที่โหลดไว้
    let memberName=String(o.memberName||'').trim();
    const mPhone=String(o.memberPhone||o.contactPhone||'').trim();
    if(!memberName && this.member && mPhone && this.normPhone(this.member.phone||'')===this.normPhone(mPhone)){
      memberName=this.escName(this.member);
    }
    // ถ้ายังไม่มีชื่อแต่มีเบอร์สมาชิก — ดึงชื่อแล้วอัปเดตตั๋ว (ครั้งเดียวต่อออเดอร์)
    if(!memberName && mPhone && this._nameFetchId!==o.id){
      this._nameFetchId=o.id;
      const oid=o.id;
      shopRef.collection('members').doc(this.normPhone(mPhone)).get().then(snap=>{
        if(!snap.exists) return;
        const md=snap.data()||{};
        const nm=(String(md.firstName||'')+' '+String(md.lastName||'')).trim();
        if(!nm) return;
        if(this.lastOrder && this.lastOrder.id===oid){
          this.lastOrder.memberName=nm;
          this.lastOrder.memberPhone=this.normPhone(mPhone);
          try{ this.renderTicket(this.lastOrder); }catch(e){}
        }
        shopRef.collection('orders').doc(oid).update({ memberName:nm, memberPhone:this.normPhone(mPhone) }).catch(()=>{});
      }).catch(()=>{});
    }
    // รูปแบบ: คิวของคุณ + ชื่อสมาชิก แล้วตามด้วยเลขคิวด้านล่าง
    const queueTitle=memberName
      ? ('คิวของคุณ <span style="color:#6A1B9A;font-weight:700">'+esc(memberName)+'</span>')
      : (mPhone ? ('คิวของคุณ <span style="color:#6A1B9A;font-weight:700">สมาชิก</span>') : 'คิวของคุณ');
    document.getElementById('ticketBody').innerHTML=`
      <h2 style="color:${cancelled?'var(--d)':paid?'var(--g)':'var(--p)'};margin-bottom:8px">${cancelled?'<i class="fa-solid fa-xmark"></i> ยกเลิกแล้ว':paid?'<i class="fa-solid fa-circle-check"></i> ชำระแล้ว':'<i class="fa-solid fa-clock"></i> รอชำระเงิน / รอรับออเดอร์'}</h2>
      <div style="font-size:1.05rem;font-weight:600">${queueTitle}</div>
      <div class="huge">${esc(o.queue)}</div>
      <div class="badge ${st[0]}" style="margin:8px 0">${st[1]}</div>
      <div id="custCancelBox" style="margin:8px 0"></div>
      <div id="queueEtaBox" style="display:none;margin:10px 0;padding:12px;background:#FFF3E0;border-radius:12px;border:1px solid #FFE0B2;text-align:center"></div>
      <div class="receipt" id="receiptBox">
        <h3>${esc(this.shopName)}</h3><div style="text-align:center;font-size:13px;font-weight:600;color:${paid?'var(--g)':'var(--p)'}">${paid?'ใบเสร็จรับเงิน':'ใบสั่งอาหาร (ยังไม่ชำระ)'}</div>
        <div style="text-align:center;font-size:12px;color:#888">รหัสการสั่งซื้อ: <strong>${esc(orderCode)}</strong></div>
        <div style="text-align:center;font-size:13px;color:#666;margin-bottom:8px">${new Date(o.createdAt||Date.now()).toLocaleString('th-TH')}</div>
        ${lines}
        ${(function(){
          const itemsSub = (Number(o.subtotal)!=null && !isNaN(Number(o.subtotal)) && Number(o.subtotal)>0)
            ? Number(o.subtotal)
            : (o.items||[]).reduce((s,i)=>s+Number(i.total||0),0);
          const ptsU = Math.max(0, Number(o.pointsUsed||o.pointsDisc||0));
          const cDisc = Math.max(0, Number(o.couponDisc||0));
          const cCode = String(o.couponCode||'').trim();
          const grand = Number(o.total!=null ? o.total : Math.max(0, itemsSub - ptsU - cDisc));
          let h = '';
          if(ptsU>0 || cDisc>0){
            h += '<div style="border-top:1px dashed #ccc;margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;font-size:14px"><span>รวม</span><span>'+money(itemsSub)+'</span></div>';
            if(cDisc>0){
              const lab = cCode && !cCode.startsWith('PERSONAL:') ? ('คูปอง '+esc(cCode)) : (cCode.startsWith('PERSONAL:')?'คูปองส่วนตัว':'คูปอง');
              h += '<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:13px;color:#C62828"><span>- '+lab+'</span><span>-'+money(cDisc)+'</span></div>';
            }
            if(ptsU>0){
              h += '<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:13px;color:#C62828"><span>- แต้มลูกค้า '+ptsU+' แต้ม</span><span>-'+money(ptsU)+'</span></div>';
            }
            h += '<div style="display:flex;justify-content:space-between;font-weight:700;margin-top:4px;font-size:1.05rem"><span>รวมทั้งสิ้น</span><span style="color:var(--p)">'+money(grand)+'</span></div>';
          } else {
            h += '<div style="border-top:1px dashed #ccc;margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;font-weight:700"><span>รวม</span><span style="color:var(--p)">'+money(grand)+'</span></div>';
          }
          return h;
        })()}
        <div style="margin-top:6px;font-size:13px">ชำระ: ${paid?(o.paymentMethod==='CASH'?'เงินสด (ที่ร้าน)':'พร้อมเพย์'):(function(){const cv=calcPaymentCover(o);return cv.due>0?('มีรายการเพิ่ม · รอชำระส่วนต่าง ฿'+cv.due):'รอชำระ (QR / เงินสดที่ร้าน)';})()} · ${paid?'ชำระแล้ว':'ยังไม่ชำระ'}</div>
        ${paid && o.paymentMethod==='CASH' && Number(o.changeAmount||0)>0 ? `<div style="font-size:13px;color:#1565C0">เงินทอน: ${money(o.changeAmount)}</div>` : ''}
        ${o.slipStatus&&o.slipStatus!=='NONE'?`<div style="font-size:12px;color:#555">สลิป: ${esc(o.slipStatus)}</div>`:''}
        <div id="receiptMemberBenefits" style="display:none"></div>
      </div>
      <p style="font-size:13px;color:#777">บันทึกใบเสร็จในเครื่องอัตโนมัติเมื่อชำระแล้ว · ค้นจากเลขคิวได้</p>`;
    document.getElementById('btnPrintReceipt').style.display = paid ? 'inline-flex' : 'none';
    // ใบเสร็จ: แสดงข้อมูลสมาชิกเมื่อชำระแล้ว (และเมื่อ Completed)
    try{
      if(paid && (o.memberPhone||o.contactPhone)){
        const el=document.getElementById('receiptMemberBenefits');
        // ถ้ามี cache HTML แล้ว ใส่ทันที (ไม่กระพริบ)
        if(el && this._receiptBenefitsHtml && this._receiptBenefitsOrderId===String(o.id||'')){
          el.style.display='block';
          el.innerHTML=this._receiptBenefitsHtml;
          el.dataset.filled='1';
        }
        this.fillReceiptMemberBenefits(o);
      }
    }catch(e){ console.warn('fillReceiptMemberBenefits', e); }
    // ปุ่มยกเลิกฝั่งลูกค้า — ได้เฉพาะรอคิวทำ
    try{
      const cbox=document.getElementById('custCancelBox');
      if(cbox){
        const canCancel = !cancelled && o.orderMode!=='table' && this.orderMode!=='table' && !paid && !o.needsRepay && !(Number(o.paidAmount||0)>0) && (o.status==='Pending' || o.status==='AwaitingPayment');
        const isSharedTable = !cancelled && (o.orderMode==='table' || this.orderMode==='table');
        if(cancelled){
          const by=o.cancelledBy==='customer'?'ลูกค้า':(o.cancelledBy==='shop'?'ร้าน':'—');
          cbox.innerHTML='<div style="font-size:13px;color:#C62828;text-align:center;padding:8px;background:#FFEBEE;border-radius:8px;font-weight:600">ยกเลิกโดย'+by+'</div>';
        } else if(canCancel){
          cbox.innerHTML='<button type="button" class="btn btn-d btn-block" style="margin-top:4px" onclick="C.cancelMyOrder()">ยกเลิกออเดอร์</button><div style="font-size:11px;color:#888;margin-top:4px;text-align:center">ยกเลิกได้เฉพาะตอนรอคิวทำ</div>';
        } else if(isSharedTable && o.status!=='Completed'){
          cbox.innerHTML='<div style="font-size:12px;color:#6A1B9A;text-align:center;padding:7px;background:#F3E5F5;border-radius:8px">ออเดอร์โต๊ะเป็นออเดอร์ร่วม · การยกเลิกต้องให้ร้านดำเนินการ</div>';
        } else if(o.status!=='Completed'){
          cbox.innerHTML='<div style="font-size:12px;color:#888;text-align:center;padding:6px;background:#f5f5f5;border-radius:8px">ไม่สามารถยกเลิกได้แล้ว (ครัวรับออเดอร์แล้ว)<br>หากต้องการยกเลิก กรุณาติดต่อร้านโดยตรง</div>';
        } else {
          cbox.innerHTML='';
        }
      }
    }catch(e){}

    // แจ้งคิวที่เหลือ + เวลารอโดยประมาณ (นับเฉพาะคิวในครัว)
    try{
      const etaBox=document.getElementById('queueEtaBox');
      if(etaBox){
        if(cancelled || o.status==='Completed' || o.status==='Ready'){
          etaBox.style.display='none';
          if(o.status==='Ready'){
            etaBox.style.display='block';
            etaBox.style.background='#E8F5E9';
            etaBox.style.borderColor='#A5D6A7';
            etaBox.innerHTML='<div style="font-weight:700;color:#2E7D32;font-size:15px">อาหารพร้อมแล้ว · มารับได้เลย</div>';
          }
        } else if(this.isKitchenStatus(o.status)){
          if(!this._kitchenUnsub) this.startKitchenWatch();
          const eta=this.calcQueueEta(o, this.kitchenOrders||[]);
          etaBox.style.display='block';
          etaBox.style.background='#FFF3E0';
          etaBox.style.borderColor='#FFE0B2';
          let queueText='';
          if(eta.ahead<=0){
            queueText='<div style="font-weight:700;color:#E65100;font-size:15px">ถึงคิวคุณแล้ว · ครัวกำลังจัดทำ</div>';
          } else {
            queueText='<div style="font-weight:700;color:#E65100;font-size:15px">เหลืออีก <span style="font-size:1.35rem">'+eta.ahead+'</span> คิว จะถึงคิวคุณ</div>';
          }
          const minText=eta.minutes>0
            ? ('<div style="margin-top:6px;font-size:14px;color:#555">รอประมาณ <strong style="color:var(--p)">'+eta.minutes+' นาที</strong><div style="font-size:11px;color:#999;margin-top:2px">คำนวณจากเมนูหมวดส้มตำเท่านั้น (ประมาณ 2 นาที/รายการ)</div></div>')
            : ('<div style="margin-top:6px;font-size:13px;color:#777">ยังไม่มีรายการในหมวดเมนูส้มตำในคิวก่อนหน้า · รอไม่นาน</div>');
          const hint='<div style="margin-top:6px;font-size:11px;color:#999">คำนวณจากเมนูส้มตำในคิวที่ยังอยู่ในครัว · รายการละ ~2 นาที</div>';
          etaBox.innerHTML=queueText+minText+hint;
        } else {
          etaBox.style.display='none';
        }
      }
    }catch(e){ console.warn('eta', e); }

    // แสดง QR บนตั๋วถ้ายังไม่ชำระ (รวม LINE)
    let qz=document.getElementById('ticketQRZone');
    if(!qz){
      qz=document.createElement('div'); qz.id='ticketQRZone'; qz.style.cssText='text-align:center;margin-top:12px';
      const tb=document.getElementById('ticketBody'); if(tb) tb.appendChild(qz);
    }
        if(waitPay){
      qz.style.display='block';
      // ยอดบน QR = ส่วนต่างที่คำนวณใหม่ (ซ่อมข้อมูลเก่าที่ paidAmount รวมทอน)
      const cv=calcPaymentCover(o);
      const alreadyPaid=cv.covered;
      const amount=cv.due>0 ? cv.due : Number(o.total||0);
      const needNew=!this._payQRDataUrl || this._payQRAmount!==amount;
      const payHint=cv.due>0
        ? ('<div style="margin-bottom:6px;padding:8px;background:#FFF8E1;border-radius:8px;color:#E65100;font-size:12px">มีรายการเพิ่ม · โอนเฉพาะส่วนต่าง <strong>฿'+amount+'</strong><div style="color:#888;margin-top:2px">จ่ายแล้ว ฿'+alreadyPaid+' / รวมบิล ฿'+cv.billTotal+'</div></div>')
        : '';
      qz.innerHTML=payHint+'<div style="margin:8px 0;padding:10px;background:#E8F5E9;border-radius:10px;font-size:13px;color:#1B5E20;text-align:left;line-height:1.5">'+
        '<div style="font-weight:700;margin-bottom:4px">ชำระได้ 2 แบบ</div>'+
        '<div>① โอนผ่าน QR ด้านล่าง</div>'+
        '<div>② จ่ายเงินสดที่ร้าน (แจ้งพนักงาน)</div>'+
        '</div>'+
        '<div id="ticketPayQrBox" style="margin:8px auto"></div>'+
        '<div style="font-size:13px;font-weight:700;color:var(--p);margin-top:4px">สแกน QR เพื่อโอน ฿'+amount+'</div>'+
        '<div style="font-size:12px;color:#E65100;margin-top:6px">'+(this.isLineBrowser()?'ใน LINE: กดค้างที่รูป → บันทึกรูป':'กดค้างที่รูปเพื่อบันทึก')+'</div>'+
        '<div style="font-size:12px;color:#555;margin-top:4px">ไม่บังคับโอนทันที · จ่ายเงินสดที่ร้านก็ได้</div>'+
        (hasSlip?'<div style="font-size:12px;color:#E65100;margin-top:4px">ส่งสลิปแล้ว · รอร้านตรวจ — QR ยังใช้ได้จนกว่าร้านยืนยันรับเงิน</div>':'')+
        '<button type="button" class="btn btn-o btn-sm" style="margin-top:8px;width:auto" onclick="C.openPayQRFull()">เปิดรูป QR เต็มจอ</button>'+
        '<button type="button" class="btn btn-o btn-sm" style="margin-top:8px;width:auto" onclick="C.savePayQR()">บันทึก / แชร์ QR</button>'+
        '<div style="margin-top:10px"><button type="button" class="btn btn-p btn-sm" style="width:auto" onclick="document.getElementById(\'slipFile\').click()">📎 อัปโหลดสลิปโอนเงิน</button></div>'+
        '<div id="ticketSlipMsg" style="font-size:12px;margin-top:6px;color:#666"></div>';
      const box=document.getElementById('ticketPayQrBox');
      const draw=()=>{
        try{
          if(!box) return false;
          // บังคับสร้างใหม่เสมอเมื่อยังไม่ชำระ — กัน cache ว่าง
          this.renderPayQRInto(box, amount);
          return !!(box.querySelector('img,canvas'));
        }catch(e){
          console.warn('ticketQR', e);
          if(box) box.innerHTML='<div style="color:#C62828;font-size:13px">สร้าง QR ไม่สำเร็จ: '+(e.message||e)+'</div>';
          return false;
        }
      };
      if(!draw()){
        setTimeout(()=>{ if(!draw()) setTimeout(draw, 800); }, 400);
      }
    } else {
      qz.style.display='none'; qz.innerHTML='';
    }
  },
  saveReceipt(){
    const o=this.lastOrder; if(!o){ toast('ไม่มีใบเสร็จ'); return; }
    if(o.paymentStatus!=='PAID'){ toast('บันทึกได้เมื่อชำระเงินแล้ว'); return; }
    const box=document.getElementById('receiptBox');
    if(!box){ toast('ไม่พบใบเสร็จ'); return; }
    toast('กำลังสร้างรูปใบเสร็จ…');
    const doDownload=(dataUrl)=>{
      const a=document.createElement('a');
      a.href=dataUrl;
      a.download='receipt-'+(o.queue||'order')+'.png';
      document.body.appendChild(a); a.click(); a.remove();
      toast('บันทึกรูปใบเสร็จแล้ว');
    };
    // ใช้ html2canvas ถ้ามี ไม่งั้นวาดด้วย canvas เอง
    if(window.html2canvas){
      window.html2canvas(box,{backgroundColor:'#ffffff',scale:2,useCORS:true}).then(canvas=>{
        doDownload(canvas.toDataURL('image/png'));
      }).catch(err=>{
        console.error(err); this.saveReceiptFallback(o, box);
      });
    } else {
      this.saveReceiptFallback(o, box);
    }
  },
  saveReceiptFallback(o, box){
    try{
      const w=Math.max(360, box.offsetWidth||360), h=Math.max(box.offsetHeight||400, 200);
      const c=document.createElement('canvas'); c.width=w*2; c.height=h*2;
      const ctx=c.getContext('2d'); ctx.scale(2,2);
      ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h);
      ctx.fillStyle='#FF5722'; ctx.font='bold 18px sans-serif'; ctx.textAlign='center';
      ctx.fillText(this.shopName||'ใบเสร็จ', w/2, 28);
      ctx.fillStyle='#333'; ctx.font='14px sans-serif';
      ctx.fillText('คิว '+(o.queue||''), w/2, 52);
      ctx.fillText(new Date(o.paidAt||o.createdAt||Date.now()).toLocaleString('th-TH'), w/2, 72);
      let y=100; ctx.textAlign='left'; ctx.font='13px sans-serif';
      (o.items||[]).forEach(i=>{
        ctx.fillText((i.name||'')+' x'+i.qty, 16, y);
        ctx.textAlign='right'; ctx.fillText(String(i.total||0), w-16, y); ctx.textAlign='left';
        y+=22;
      });
      y+=10; ctx.font='bold 16px sans-serif';
      ctx.fillText('รวม', 16, y); ctx.textAlign='right'; ctx.fillText(String(o.total||0), w-16, y);
      const a=document.createElement('a');
      a.href=c.toDataURL('image/png');
      a.download='receipt-'+(o.queue||'order')+'.png';
      document.body.appendChild(a); a.click(); a.remove();
      toast('บันทึกรูปใบเสร็จแล้ว');
    }catch(e){ console.error(e); toast('บันทึกรูปไม่สำเร็จ'); }
  },
  async trackQueue(){
    const q=document.getElementById('trackQ').value.trim().toUpperCase();
    if(!q){toast('ใส่เลขคิว');return}
    // หยุด watcher อื่นก่อน เพื่อไม่ให้เด้งไปคิวอื่น
    this.stopOrderWatchers();
    try{
      let docs=[];
      try{
        const snap=await shopRef.collection('orders').where('queue','==',q).get();
        docs=snap.docs.map(d=>({id:d.id,...d.data()}));
      }catch(e){ console.warn(e); }
      if(!docs.length){
        try{
          const arr=JSON.parse(localStorage.getItem('receipts')||'[]');
          const local=arr.find(x=>String(x.queue).toUpperCase()===q);
          if(local){
            const oid=local.id||local.orderId||null;
            this.orderId=oid;
            this.lastOrder={...local, id:oid, paymentStatus: local.paymentStatus||'UNPAID', status: local.status||'Pending'};
            this.renderTicket(this.lastOrder);
            this.show('mTicket');
            if(oid){
              this.trackUnsub=shopRef.collection('orders').doc(oid).onSnapshot(s=>{
                if(!s.exists) return;
                if(this.orderId!==s.id) return;
                this.lastOrder={id:s.id,...s.data()};
                this.renderTicket(this.lastOrder);
              });
            }
            return;
          }
        }catch(e){}
        toast('ไม่พบคิว '+q); return;
      }
      // ถ้าคิวซ้ำหลายวัน เลือกอันล่าสุดของคิวนั้น — แล้วล็อก orderId นี้ไว้
      docs.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
      const picked=docs[0];
      this.orderId=picked.id;
      this.lastOrder=picked;
      this.renderTicket(picked);
      this.show('mTicket');
      this.attachOrderWatcher(picked.id);
      if(!this._kitchenUnsub) this.startKitchenWatch();
    }catch(e){ toast('ค้นหาไม่สำเร็จ: '+(e.message||e)); }
  }
  });
})();
