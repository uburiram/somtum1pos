/**
 * Somtum1POS — payment / QR / slip / watchers
 * Auto-split from customer.js (lines 733-1412)
 */
/* global C, db, shopRef, esc, money, toast, uid, showErr, sha256, calcPaymentCover, fileToDataUrl, PP, checkConfig, migrateAndSeed, checkOrderRateLimit */
(function () {
  'use strict';
  window.C = window.C || {};
  Object.assign(window.C, {
  renderPayReview(){
    const el=document.getElementById('payReviewList');
    if(!el) return;
    const cart=this.cart||[];
    if(!cart.length){
      el.innerHTML='<div style="text-align:center;color:#999;padding:12px">ตะกร้าว่าง</div>';
      return;
    }
    el.innerHTML=cart.map(i=>{
      const tops=(i.toppings||[]).map(t=>esc(t.name)+(t.qty>1?(' x'+t.qty):'')).join(', ');
      const meta=[i.spiceName, i.plara, tops, i.note?('หมายเหตุ: '+esc(i.note)):''].filter(Boolean).join(' · ');
      return '<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px dashed #eee">'+
        '<div style="text-align:left"><div style="font-weight:600">'+esc(i.name)+' × '+i.qty+'</div>'+
        (meta?'<div style="font-size:12px;color:#777;margin-top:2px">'+meta+'</div>':'')+
        '</div><div style="font-weight:600;white-space:nowrap">'+money(i.total)+'</div></div>';
    }).join('');
  },
  payMethod(m){
    this.payM='PROMPTPAY';
    const btn=document.getElementById('btnOrder');
    if(btn){
      if(this.orderId){ btn.disabled=true; btn.textContent='ยืนยันแล้ว · ดูตั๋วคิวเพื่อชำระ'; }
      else { btn.disabled=false; btn.textContent='ยืนยันออเดอร์'; }
    }
    // หน้ายืนยัน: คำนวณยอดอย่างเดียว ไม่สร้าง QR ที่นี่
    try{
      const p=this.recalcPayTotal();
      if(p && typeof p.then==='function') p.then(function(){});
    }catch(e){ console.warn(e); }
  },

  isLineBrowser(){
    return /Line\//i.test(navigator.userAgent||'');
  },
  getPayQRDataUrl(){
    if(this._payQRDataUrl) return this._payQRDataUrl;
    const box=document.getElementById('ppQR');
    if(box){
      const img=box.querySelector('img');
      if(img && img.src && String(img.src).indexOf('data:')===0) return img.src;
      const canvas=box.querySelector('canvas');
      if(canvas){
        try{ return canvas.toDataURL('image/png'); }catch(e){}
      }
    }
    const tbox=document.getElementById('ticketPayQrBox');
    if(tbox){
      const img=tbox.querySelector('img');
      if(img && img.src) return img.src;
    }
    return '';
  },
  buildPayPayload(amount){
    const total=Math.max(0, Math.round(Number(amount||0)*100)/100);
    try{
      if(this.payType==='kshop' || this.payType==='merchant'){
        const kshopPayload=this.kshopPayload||window.KSHOP_QR_PAYLOAD||'';
        let p=null;
        try{ p=PP.genKShop(total, kshopPayload); }catch(e){}
        if(!p){ try{ p=PP.genMerchant(this.merchantId||window.KSHOP_REF||'EMPKB000002198793001', total); }catch(e){} }
        if(p) return p;
      }
      return PP.gen(this.promptpay||'', total);
    }catch(e){
      console.warn('buildPayPayload', e);
      try{ return PP.gen(this.promptpay||'', total); }catch(e2){ return null; }
    }
  },
  /** สร้าง QR ลง element บนตั๋ว — ไม่พึ่งหน้าชำระเงิน */
  renderPayQRInto(el, amount){
    if(!el) return '';
    const total=Number(amount||0);
    const payload=this.buildPayPayload(total);
    if(!payload){
      el.innerHTML='<div style="color:#C62828;font-size:13px;padding:8px">ตั้งค่า PromptPay/QR ร้านไม่ครบ</div>';
      return '';
    }
    if(typeof QRCode==='undefined'){
      el.innerHTML='<div style="color:#999;font-size:13px">กำลังโหลด QR…</div>';
      return '';
    }
    try{
      el.innerHTML='';
      // qrcodejs ต้องการ element ว่างแล้วสร้าง canvas ภายใน
      const holder=document.createElement('div');
      holder.style.cssText='display:inline-block;padding:6px;background:#fff;border-radius:12px';
      el.appendChild(holder);
      new QRCode(holder, { text: String(payload), width: 200, height: 200 });
      let dataUrl='';
      const canvas=holder.querySelector('canvas');
      const img0=holder.querySelector('img');
      if(canvas){
        try{ dataUrl=canvas.toDataURL('image/png'); }catch(e){}
      }
      if(!dataUrl && img0 && img0.src) dataUrl=img0.src;
      if(dataUrl){
        this._payQRDataUrl=dataUrl;
        this._payQRAmount=total;
        const img=document.createElement('img');
        img.setAttribute('data-payqr','1');
        img.src=dataUrl;
        img.alt='QR ชำระเงิน';
        img.style.cssText='width:220px;max-width:100%;height:auto;background:#fff;border-radius:12px;-webkit-touch-callout:default;pointer-events:auto';
        el.innerHTML='';
        el.appendChild(img);
        return dataUrl;
      }
      // เหลือ canvas ไว้ก็ยังสแกนได้
      return '';
    }catch(e){
      console.warn('renderPayQRInto', e);
      el.innerHTML='<div style="color:#C62828;font-size:13px">สร้าง QR ไม่สำเร็จ: '+(e.message||e)+'</div>';
      return '';
    }
  },
  ensurePayQRAsImage(){
    const box=document.getElementById('ppQR');
    if(!box) return '';
    let dataUrl=this.getPayQRDataUrl();
    const canvas=box.querySelector('canvas');
    if(canvas && !box.querySelector('img[data-payqr]')){
      try{
        dataUrl=canvas.toDataURL('image/png');
        const img=document.createElement('img');
        img.setAttribute('data-payqr','1');
        img.src=dataUrl;
        img.alt='QR ชำระเงิน';
        img.style.cssText='width:100%;max-width:220px;height:auto;background:#fff;border-radius:8px;-webkit-touch-callout:default;pointer-events:auto';
        box.innerHTML='';
        box.appendChild(img);
      }catch(e){ console.warn(e); }
    }
    this._payQRDataUrl=dataUrl||this._payQRDataUrl||'';
    return this._payQRDataUrl;
  },
  openPayQRFull(){
    const dataUrl=this.ensurePayQRAsImage()||this.getPayQRDataUrl();
    if(!dataUrl){ toast('ยังไม่มี QR'); return; }
    const im=document.getElementById('qrFullImg');
    if(im) im.src=dataUrl;
    this.show('mQRFull');
    if(this.isLineBrowser()) toast('กดค้างที่รูป QR แล้วเลือกบันทึกรูปภาพ');
  },
  async savePayQR(){
    const dataUrl=this.ensurePayQRAsImage()||this.getPayQRDataUrl();
    if(!dataUrl){ toast('ยังไม่มี QR'); return; }
    // 1) Web Share Level 2 (Android Chrome / บาง WebView)
    try{
      const res=await fetch(dataUrl);
      const blob=await res.blob();
      const file=new File([blob], 'promptpay-qr.png', {type:'image/png'});
      if(navigator.canShare && navigator.canShare({files:[file]})){
        await navigator.share({ files:[file], title:'QR ชำระเงิน', text:'QR พร้อมเพย์' });
        toast('แชร์รูป QR แล้ว');
        return;
      }
    }catch(e){ /* fall through */ }
    // 2) ดาวน์โหลดปกติ
    try{
      const a=document.createElement('a');
      a.href=dataUrl;
      a.download='promptpay-qr-'+Date.now()+'.png';
      a.target='_blank';
      a.rel='noopener';
      document.body.appendChild(a); a.click(); a.remove();
    }catch(e){}
    // 3) LINE / WebView ที่บล็อกดาวน์โหลด
    if(this.isLineBrowser()){
      this.openPayQRFull();
      toast('ใน LINE: กดค้างที่รูป QR → บันทึกรูปภาพ');
    } else {
      toast('ถ้าไม่เจอไฟล์: กดค้างที่รูป QR เพื่อบันทึก');
    }
  },
  async onSlipSelected(ev){
    const file=ev && ev.target && ev.target.files && ev.target.files[0];
    if(!file) return;
    const sp=document.getElementById('slipPreview');
    const sm=document.getElementById('slipAutoMsg');
    try{
      let dataUrl=await fileToDataUrl(file,640,.5);
      // กฎ Firestore: slipData <= 200000 ตัวอักษร
      if(dataUrl && dataUrl.length > 200000){
        dataUrl=await fileToDataUrl(file,480,.4);
      }
      if(dataUrl && dataUrl.length > 200000){
        dataUrl=await fileToDataUrl(file,360,.35);
      }
      if(dataUrl && dataUrl.length > 200000){
        toast('รูปสลิปใหญ่เกินไป ลองถ่ายใหม่หรือครอปรูป');
        return;
      }
      this.slipData=dataUrl;
      if(sp){ sp.style.display='block'; sp.innerHTML='<img src="'+dataUrl+'" style="max-width:220px;border-radius:8px;border:1px solid #ddd">'; }
      if(sm) sm.innerHTML='<span style="color:#1565C0">แนบสลิปแล้ว — กดยืนยันออเดอร์เพื่อส่งให้ร้านตรวจ</span>';
      // ถ้ามีออเดอร์แล้ว ให้อัปโหลดทันที
      if(this.orderId){
        await this.uploadSlipToOrder(this.orderId, dataUrl);
      }
    }catch(e){
      toast(e.message||'อ่านสลิปไม่สำเร็จ');
    }
  },
  /** แปลงวันเวลาจากสลิป/API เป็น timestamp (ms) — รองรับหลายฟอร์แมต */
  parseSlipDateTime(raw){
    if(raw==null || raw==='') return null;
    if(typeof raw==='number' && isFinite(raw)){
      // วินาที vs มิลลิวินาที
      return raw < 1e12 ? raw*1000 : raw;
    }
    const s=String(raw).trim();
    if(!s) return null;
    // ISO / EasySlip เช่น 2024-01-15T14:30:00+07:00
    let t=Date.parse(s);
    if(!isNaN(t)) return t;
    // 15/01/2024 14:30 หรือ 15-01-2024 14:30:00
    let m=s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\s+|T)(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if(m){
      let dd=+m[1], mo=+m[2], yy=+m[3];
      if(yy<100) yy+=2000;
      // ถ้า mo>12 แปลว่าเป็น US format MM/DD
      if(mo>12 && dd<=12){ const tmp=dd; dd=mo; mo=tmp; }
      const hh=+m[4], mi=+m[5], ss=m[6]?+m[6]:0;
      // ใช้เวลาท้องถิ่นไทยโดยประมาณ (เครื่องลูกค้ามักเป็น +7)
      const d=new Date(yy, mo-1, dd, hh, mi, ss);
      if(!isNaN(d.getTime())) return d.getTime();
    }
    // 2024-01-15 14:30
    m=s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if(m){
      const d=new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], m[6]?+m[6]:0);
      if(!isNaN(d.getTime())) return d.getTime();
    }
    return null;
  },
  /** วันเดียวกัน (ตามปฏิทินท้องถิ่นเครื่อง) */
  isSameLocalDay(tsA, tsB){
    if(tsA==null || tsB==null) return false;
    const a=new Date(tsA), b=new Date(tsB);
    return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
  },
  /**
   * ตรวจวัน-เวลาสลิปเทียบออเดอร์
   * - ต้องวันเดียวกัน
   * - เวลาในสลิปต้องไม่ก่อนเวลาสั่ง (ยอมให้คลาดเคลื่อน 60 วินาที)
   */
  validateSlipVsOrderTime(slipTs, orderCreatedAt){
    const orderTs=Number(orderCreatedAt||0);
    if(!orderTs) return {ok:true, msg:'ไม่มีเวลาออเดอร์ — ข้ามตรวจเวลา'};
    if(slipTs==null) return {ok:false, needManual:true, msg:'อ่านวันเวลาจากสลิปไม่ได้ · รอร้านตรวจ'};
    if(!this.isSameLocalDay(slipTs, orderTs)){
      return {ok:false, needManual:true, msg:'วันในสลิปไม่ตรงกับวันสั่งออเดอร์'};
    }
    // กรอบ 5 นาที: ถ้าเวลาในสลิปอยู่ก่อนเวลาสั่ง >= 5 นาที → ไม่ผ่าน
    // (ยอมคลาดเคลื่อนนาฬิกาธนาคารได้ไม่เกิน 5 นาที)
    const FIVE_MIN=5*60*1000;
    if(slipTs < orderTs - FIVE_MIN){
      return {ok:false, needManual:true, msg:'เวลาในสลิปอยู่ก่อนเวลาสั่งออเดอร์เกิน 5 นาที'};
    }
    // เวลาในสลิปอยู่ก่อนสั่งเล็กน้อย (<5 นาที) ยังผ่านได้ — กันนาฬิกาธนาคารคลาด
    // เวลาในสลิปหลังสั่ง → ผ่านตามปกติ
    return {ok:true, msg:'วันเวลาสลิปผ่าน (≥ เกณฑ์ 5 นาที)'};
  },
  extractSlipDateFromEasy(j){
    if(!j || typeof j!=='object') return null;
    const cands=[
      j?.data?.date, j?.data?.transDate, j?.date,
      j?.data?.rawSlip?.date, j?.data?.transactionDate,
      j?.data?.dateTime, j?.data?.transferDate
    ];
    for(const c of cands){
      const ts=this.parseSlipDateTime(c);
      if(ts!=null) return ts;
    }
    return null;
  },
  async uploadSlipToOrder(orderId, dataUrl){
    const sm=document.getElementById('slipAutoMsg');
    const tsm=document.getElementById('ticketSlipMsg');
    const setMsg=(html)=>{ if(sm) sm.innerHTML=html; if(tsm) tsm.innerHTML=html; };
    // ข้อความสั้น — ไม่โชว์ขั้นตอนตรวจเบื้องหลังให้ลูกค้า
    setMsg('กำลังบันทึกสลิป…');
    const orderSnap=await shopRef.collection('orders').doc(orderId).get();
    const order=orderSnap.exists?{id:orderId,...orderSnap.data()}: (this.lastOrder||{});
    // ยอดที่ต้องตรวจในสลิป = ส่วนต่างที่คำนวณใหม่ (ซ่อม paidAmount เก่าที่รวมทอน)
    const cvSlip=calcPaymentCover(order);
    const alreadyPaid=cvSlip.covered;
    const amount=cvSlip.due>0 ? cvSlip.due : cvSlip.billTotal;

    // 1) Cloud Function (ถ้าตั้ง FUNCTIONS_BASE)
    const base=(window.FUNCTIONS_BASE||'').replace(/\/$/,'');
    if(base && /^https?:\/\//i.test(base)){
      try{
        const r=await fetch(base+'/verifySlip',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ shopId: window.SHOP_ID||'main', orderId, slipData: dataUrl })
        });
        const j=await r.json().catch(()=>({}));
        if(j.ok && (j.autoPaid||j.alreadyPaid)){
          setMsg('<span style="color:#2E7D32">✓ บันทึกสลิปแล้ว</span>');
          return;
        }
        if(j.ok===false && (j.needManual || j.pendingManual)){
          await shopRef.collection('orders').doc(orderId).update({
            slipData:(dataUrl||'').slice(0,200000), slipStatus:'PENDING_REVIEW',
            slipVerifyNote:j.msg||'ยอดไม่ตรงหรือสลิปไม่ผ่าน · รอร้านตรวจ'
          });
          setMsg('<span style="color:#E65100">'+(j.msg||'สลิปต้องให้ร้านตรวจสอบ')+'</span>');
          toast(j.msg||'ส่งสลิปแล้ว รอร้านตรวจ');
          this._applyLocalSlip(orderId, dataUrl, 'PENDING_REVIEW');
          return;
        }
      }catch(e){ console.warn('verifySlip CF', e); }
    }

    // 2) EasySlip API (ถ้ามี key)
    if(window.EASYSLIP_API_KEY){
      const easy=await this.verifySlipEasy(dataUrl, amount);
      if(easy.ok){
        await this.autoMarkPaidFromSlip(orderId, dataUrl, easy);
        setMsg('<span style="color:#2E7D32">✓ บันทึกสลิปแล้ว</span>');
        return;
      }
      // ไม่ผ่าน → รอร้าน
      await shopRef.collection('orders').doc(orderId).update({
        slipData:(dataUrl||'').slice(0,200000), slipStatus:'PENDING_REVIEW',
        slipVerifyNote:easy.msg||'ตรวจอัตโนมัติไม่ผ่าน'
      });
      setMsg('<span style="color:#E65100">'+(easy.msg||'รอร้านตรวจสอบสลิป')+'</span>');
      toast(easy.msg||'ส่งสลิปแล้ว รอร้านตรวจ');
      this._applyLocalSlip(orderId, dataUrl, 'PENDING_REVIEW');
      return;
    }

    // 3) ถอด QR จากรูปสลิป — ใช้เป็นข้อมูลช่วยร้าน ไม่ auto-PAID จากเบราว์เซอร์
    try{
      const qrInfo=await this.readAmountFromSlipImage(dataUrl);
      if(qrInfo && qrInfo.amount!=null){
        const paid=Number(qrInfo.amount);
        const note = Math.abs(paid-amount)<=1
          ? ('QR ในสลิปยอด ฿'+paid+' ตรงออเดอร์ · รอร้านยืนยัน')
          : ('ยอดในสลิป ฿'+paid+' ไม่ตรงออเดอร์ ฿'+amount+' · รอร้านตรวจ');
        await shopRef.collection('orders').doc(orderId).update({
          slipData:(dataUrl||'').slice(0,200000), slipStatus:'PENDING_REVIEW',
          slipVerifyNote:note
        });
        setMsg('<span style="color:#E65100">'+note+'</span>');
        this._applyLocalSlip(orderId, dataUrl, 'PENDING_REVIEW');
        toast('ส่งสลิปแล้ว รอร้านตรวจ');
        return;
      }
    }catch(e){ console.warn('slip QR', e); }

    // 3b) OCR เป็นข้อมูลช่วยร้านเท่านั้น — ไม่ auto-PAID (กันปลอมสลิป/อ่านผิด)
    try{
      const ocr=await this.readAmountByOCR(dataUrl, amount);
      if(ocr && ocr.amount!=null){
        const note = Math.abs(Number(ocr.amount)-amount)<=1
          ? ('OCR อ่านยอด ฿'+ocr.amount+' ตรงออเดอร์ · รอร้านยืนยัน')
          : ('OCR อ่านยอด ฿'+ocr.amount+' · รอร้านตรวจ');
        await shopRef.collection('orders').doc(orderId).update({
          slipData:(dataUrl||'').slice(0,200000), slipStatus:'PENDING_REVIEW',
          slipVerifyNote:note
        });
        setMsg('<span style="color:#E65100">'+note+'</span>');
        this._applyLocalSlip(orderId, dataUrl, 'PENDING_REVIEW');
        toast('ส่งสลิปแล้ว รอร้านตรวจ');
        return;
      }
    }catch(e){ console.warn('slip OCR', e); }

    // 4) fallback: รอร้านตรวจมือ
    await shopRef.collection('orders').doc(orderId).update({
      slipData:(dataUrl||'').slice(0,200000), slipStatus:'PENDING_REVIEW'
    });
    setMsg('<span style="color:#2E7D32">✓ บันทึกสลิปแล้ว</span>');
    this._applyLocalSlip(orderId, dataUrl, 'PENDING_REVIEW');
  },
  _applyLocalSlip(orderId, dataUrl, status){
    try{
      if(this.lastOrder && this.lastOrder.id===orderId){
        this.lastOrder.slipData=dataUrl;
        this.lastOrder.slipStatus=status;
        this.renderTicket(this.lastOrder);
      }
    }catch(e){}
  },
  async autoMarkPaidFromSlip(orderId, dataUrl, meta){
    meta=meta||{};
    let order={};
    try{
      const snap=await shopRef.collection('orders').doc(orderId).get();
      order=snap.exists?snap.data():{};
    }catch(e){}
    const orderTs=Number(order.createdAt||0);
    // ดึงวันเวลาจาก meta / EasySlip raw
    let slipTs=meta.slipTs!=null?Number(meta.slipTs):null;
    if(slipTs==null && meta.raw) slipTs=this.extractSlipDateFromEasy(meta.raw);
    if(slipTs==null && meta.date) slipTs=this.parseSlipDateTime(meta.date);

    const timeCheck=this.validateSlipVsOrderTime(slipTs, orderTs);
    if(!timeCheck.ok){
      const note=timeCheck.msg||'วันเวลาสลิปไม่ผ่าน';
      try{
        await shopRef.collection('orders').doc(orderId).update({
          slipData:dataUrl,
          slipStatus:'PENDING_REVIEW',
          slipVerifyNote:note,
          slipCheckedAt:Date.now()
        });
      }catch(e){ console.warn(e); }
      this._applyLocalSlip(orderId, dataUrl, 'PENDING_REVIEW');
      try{
        const sm=document.getElementById('slipAutoMsg');
        const tsm=document.getElementById('ticketSlipMsg');
        const html='<span style="color:#E65100">'+note+' · รอร้านตรวจ</span>';
        if(sm) sm.innerHTML=html; if(tsm) tsm.innerHTML=html;
      }catch(e){}
      return {ok:false, needManual:true, msg:note};
    }

    const already=Number(order.paidAmount||0);
    const billTotal=Number(order.total||0);
    const due=order.needsRepay
      ? Math.max(0, Number(order.repayAmount!=null?order.repayAmount:billTotal-already))
      : billTotal;
    const slipPaid=meta.amount!=null?Number(meta.amount):due;
    // เมื่อตรวจสลิปผ่าน (ยอดตรง due) → บิลชำระครบ
    // paidAmount ต้อง = ยอดบิลที่ครอบคลุม (billTotal) ไม่ใช่เงินที่ยื่น/ยอดสลิปดิบ
    // กันปัญหา: รับเงินสด 100 ทอน 10 แล้ว paidAmount กลายเป็น 100 → สั่งเพิ่มส่วนต่างผิด
    const patch={
      slipData:(dataUrl||'').slice(0,200000),
      slipStatus:'AUTO_APPROVED',
      paymentStatus:'PAID',
      paymentMethod:'PROMPTPAY',
      paidAt:Date.now(),
      paidAmount: billTotal,
      slipVerifyNote: (meta.msg||'ตรวจอัตโนมัติผ่าน')+' · '+timeCheck.msg,
      autoPaid:true,
      slipCheckedAt:Date.now(),
      needsRepay:false,
      repayAmount:0
    };
    if(slipTs) patch.slipTransAt=slipTs;
    if(isNaN(patch.paidAmount) || patch.paidAmount<0) patch.paidAmount=billTotal;
    await shopRef.collection('orders').doc(orderId).update(patch);
    try{
      const snap=await shopRef.collection('orders').doc(orderId).get();
      let full={id:orderId, ...(snap.data()||{})};
      try{ await this.awardMemberPoints(full); }catch(e){}
      try{
        const s2=await shopRef.collection('orders').doc(orderId).get();
        if(s2.exists) full={id:orderId, ...s2.data()};
      }catch(e){}
      this.lastOrder=full;
      this.writeReceipt(full);
      this.renderTicket(full);
    }catch(e){}
    return {ok:true};
  },
  async readAmountFromSlipImage(dataUrl){
    // โหลด jsQR
    if(typeof jsQR!=='function'){
      await new Promise((resolve,reject)=>{
        const s=document.createElement('script');
        s.src='https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
        s.onload=resolve; s.onerror=reject;
        document.head.appendChild(s);
      }).catch(()=>null);
    }
    if(typeof jsQR!=='function') return null;

    const img=await new Promise((resolve,reject)=>{
      const im=new Image();
      im.onload=()=>resolve(im);
      im.onerror=reject;
      im.crossOrigin='anonymous';
      im.src=dataUrl;
    });

    const parseEmvAmount=(raw)=>{
      if(!raw) return null;
      const s=String(raw);
      // EMVCo tag 54 amount
      const m=s.match(/54(\d{2})([0-9.]+)/);
      if(m){
        const len=parseInt(m[1],10);
        const val=m[2].slice(0,len);
        const n=parseFloat(val);
        if(!isNaN(n) && n>0) return n;
      }
      // tag 54 with other formats
      const m3=s.match(/54\d{2}(\d+\.\d{2})/);
      if(m3){ const n=parseFloat(m3[1]); if(!isNaN(n)&&n>0) return n; }
      const m2=s.match(/(?:amount|AMT|ยอด)[=:]?\s*([0-9]+(?:\.[0-9]+)?)/i);
      if(m2){ const n=parseFloat(m2[1]); if(!isNaN(n)&&n>0) return n; }
      // number with 2 decimals in payload
      const m4=s.match(/\b(\d{1,7}\.\d{2})\b/);
      if(m4){ const n=parseFloat(m4[1]); if(!isNaN(n)&&n>0&&n<1000000) return n; }
      return null;
    };

    const tryScan=(canvas)=>{
      try{
        const ctx=canvas.getContext('2d');
        const imageData=ctx.getImageData(0,0,canvas.width,canvas.height);
        const code=jsQR(imageData.data, imageData.width, imageData.height, {inversionAttempts:'attemptBoth'});
        if(code && code.data) return String(code.data);
      }catch(e){}
      return null;
    };

    const scales=[1, 0.75, 0.5, 1.25];
    const crops=[
      [0,0,1,1],
      [0.05,0.05,0.9,0.9],
      [0.15,0.15,0.7,0.7],
      [0,0.3,1,0.7], // ครึ่งล่างมักมี QR
      [0.2,0.4,0.6,0.55]
    ];

    for(const scale of scales){
      for(const [cx,cy,cw,ch] of crops){
        const sw=Math.max(50, Math.floor(img.width*cw*scale));
        const sh=Math.max(50, Math.floor(img.height*ch*scale));
        const canvas=document.createElement('canvas');
        canvas.width=sw; canvas.height=sh;
        const ctx=canvas.getContext('2d');
        ctx.imageSmoothingEnabled=true;
        ctx.drawImage(
          img,
          img.width*cx, img.height*cy, img.width*cw, img.height*ch,
          0,0,sw,sh
        );
        let raw=tryScan(canvas);
        if(!raw){
          // grayscale boost
          const id=ctx.getImageData(0,0,sw,sh);
          const d=id.data;
          for(let p=0;p<d.length;p+=4){
            const g=d[p]*0.3+d[p+1]*0.59+d[p+2]*0.11;
            const v=g>140?255:g<90?0:g;
            d[p]=d[p+1]=d[p+2]=v;
          }
          ctx.putImageData(id,0,0);
          raw=tryScan(canvas);
        }
        if(raw){
          const amount=parseEmvAmount(raw);
          return { amount, raw: raw.slice(0,160) };
        }
      }
    }
    return null;
  },
  /** OCR ยอดเงินจากข้อความในสลิป (fallback เมื่อไม่มี QR) */
  async readAmountByOCR(dataUrl, expectedAmount){
    try{
      if(typeof Tesseract==='undefined'){
        await new Promise((resolve,reject)=>{
          const s=document.createElement('script');
          s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
          s.onload=resolve; s.onerror=reject;
          document.head.appendChild(s);
        });
      }
      if(typeof Tesseract==='undefined') return null;
      const result=await Tesseract.recognize(dataUrl, 'eng', { logger:()=>{} });
      const text=(result && result.data && result.data.text)||'';
      // หาตัวเลขเงิน เช่น 120.00, 1,250.00, 89
      const candidates=[];
      const re=/(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2}|\d{2,6})/g;
      let m;
      while((m=re.exec(text))){
        const n=parseFloat(m[1].replace(/,/g,''));
        if(!isNaN(n) && n>=1 && n<100000) candidates.push(n);
      }
      if(!candidates.length) return null;
      // ถ้ามียอดตรง expected (±1) เลือกอันนั้น
      const exp=Number(expectedAmount||0);
      const hit=candidates.find(n=>Math.abs(n-exp)<=1);
      if(hit!=null){
        const slipTs=this.parseSlipDateTime(
          (text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?)/)||[])[1]
          || (text.match(/(\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2})/)||[])[1]
        );
        return { amount: hit, slipTs, raw: 'ocr:'+text.slice(0,80) };
      }
      // ไม่มีตัวตรง → ไม่ auto
      return { amount: null, candidates, raw: 'ocr:'+text.slice(0,80) };
    }catch(e){
      console.warn('ocr', e);
      return null;
    }
  },


  attachTicketQR(){
    try{ this.ensurePayQRAsImage(); }catch(e){}
  },
  async autoSubmitQROrder(){
    if(this.payM!=='PROMPTPAY') return;
    if(this.orderId) return;
    if(!this.cart || !this.cart.length) return;
    if(!this.assertShopOpen()) return;
    const btn=document.getElementById('btnOrder');
    if(btn){ btn.disabled=true; btn.textContent='กำลังสร้างออเดอร์…'; }
    try{
      await this.createOrderInternal({
        status:'Pending',
        paymentStatus:'UNPAID'
      });
      if(btn){ btn.disabled=true; btn.textContent='ยืนยันแล้ว · รอโอนเงิน / แนบสลิป'; }
    }catch(e){
      console.error(e);
      toast(this._orderErrMsg(e));
      if(btn){ btn.disabled=false; btn.textContent='ยืนยันออเดอร์'; }
    }
  },
  startPayWatch(id){
    if(this._payWatchTimer){ clearInterval(this._payWatchTimer); this._payWatchTimer=null; }
    if(!id) return;
    this._payWatchId=id;
    let ticks=0;
    this._payWatchTimer=setInterval(async()=>{
      ticks++;
      if(ticks>180){ clearInterval(this._payWatchTimer); this._payWatchTimer=null; return; }
      // ถ้าผู้ใช้กำลังดูคิวอื่นอยู่ อย่าเขียนทับ
      if(this.orderId && this.orderId!==id) return;
      if(this._payWatchId!==id) return;
      try{
        const snap=await shopRef.collection('orders').doc(id).get();
        if(!snap.exists) return;
        const o=snap.data()||{};
        const prev=(this.lastOrder&&this.lastOrder.paymentStatus)||'';
        this.lastOrder={id:snap.id,...o};
        this.renderTicket(this.lastOrder);
        if(prev!=='PAID' && o.paymentStatus==='PAID'){
          toast('ชำระเงินสำเร็จ');
          try{ this.writeReceipt({id:snap.id,...o}); }catch(e){}
          clearInterval(this._payWatchTimer); this._payWatchTimer=null;
        }
      }catch(e){}
    }, 4000);
  },
  stopOrderWatchers(){
    if(this._payWatchTimer){ clearInterval(this._payWatchTimer); this._payWatchTimer=null; }
    this._payWatchId=null;
    if(this.unsub){ try{ this.unsub(); }catch(e){} this.unsub=null; }
    if(this.trackUnsub){ try{ this.trackUnsub(); }catch(e){} this.trackUnsub=null; }
    // kitchen watch เป็นตัวรวมคิวร้าน — ห้ามปิดตอนเช็กคิว/เคลียร์ตั๋ว
  },
  /** ฟังออเดอร์ใบเดียวแบบ realtime (กู้หลังรีเฟรช / โต๊ะ / เช็กคิว) */
  attachOrderWatcher(id){
    if(!id || !shopRef) return;
    try{ if(this.unsub){ this.unsub(); this.unsub=null; } }catch(e){}
    this.orderId=id;
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
      try{ this.renderTicket(this.lastOrder); }catch(e){}
      try{ this.updFab(); }catch(e){}
      if(prevPay!=='PAID' && o.paymentStatus==='PAID'){
        toast('ชำระเงินสำเร็จ');
        try{ this.writeReceipt({id:snap.id,...o}); }catch(e3){}
      }
      if(prevSt && prevSt!=='Ready' && prevSt!=='Completed' && o.status==='Ready'){
        this.notifyOrderReady({id:snap.id,...o});
      }
    }, err=>console.warn('order watch', err));
  },
  watchOrder(id){ this.attachOrderWatcher(id); },
  });
})();
