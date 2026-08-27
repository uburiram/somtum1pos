/**
 * Somtum1POS — members / coupons / points
 * Split from pos.js (lines 1665-2089)
 */
/* global M, db, shopRef, esc, money, toast, uid, sha256, calcPaymentCover, fileToDataUrl, PP */
(function () {
  'use strict';
  window.M = window.M || {};
  Object.assign(window.M, {
  membersCache:[],
  normPhone(p){
    let s=String(p||'').replace(/\D/g,'');
    if(s.length===11 && s.startsWith('66')) s='0'+s.slice(2);
    return s;
  },
  memSubTab(name){
    const panels={list:'memPanelList',coupon:'memPanelCoupon',add:'memPanelAdd'};
    Object.keys(panels).forEach(n=>{
      const el=document.getElementById(panels[n]);
      if(el) el.classList.toggle('hide', n!==name);
    });
    const tabs={list:'memTabList',coupon:'memTabCoupon',add:'memTabAdd'};
    Object.keys(tabs).forEach(n=>{
      const el=document.getElementById(tabs[n]);
      if(el) el.classList.toggle('on', n===name);
    });
    if(name==='list') this.loadMembersPanel();
    if(name==='coupon') this.loadCoupons();
  },
  async loadMembersPanel(){
    const box=document.getElementById('memList');
    if(!box) return;
    box.innerHTML='<div style="color:#888;padding:12px;text-align:center">กำลังโหลดสมาชิก…</div>';
    try{
      let snap;
      try{ snap=await shopRef.collection('members').orderBy('createdAt','desc').limit(300).get(); }
      catch(e){ snap=await shopRef.collection('members').limit(300).get(); }
      this.membersCache=snap.docs.map(d=>({id:d.id, phone:d.id, ...d.data()}));
      this.filterMembers();
    }catch(e){
      console.error(e);
      box.innerHTML='<div style="color:#C62828;padding:12px">โหลดสมาชิกไม่สำเร็จ: '+(e.message||e)+'<br><span style="font-size:12px">ตรวจ Firestore rules ว่า members อนุญาต read แล้ว</span></div>';
    }
  },
  filterMembers(){
    const q=String((document.getElementById('memSearch')||{}).value||'').trim().toLowerCase();
    let list=this.membersCache||[];
    if(q){
      list=list.filter(m=>{
        const blob=((m.firstName||'')+' '+(m.lastName||'')+' '+(m.phone||m.id||'')).toLowerCase();
        return blob.indexOf(q)>=0;
      });
    }
    const box=document.getElementById('memList');
    if(!box) return;
    if(!list.length){
      box.innerHTML='<div style="color:#888;padding:20px;text-align:center">ยังไม่มีสมาชิกในระบบ</div>';
      return;
    }
    box.innerHTML=list.map(m=>{
      const phone=esc(m.phone||m.id||'');
      const active=m.status!=='cancelled' && m.active!==false && m.isActive!==false && m.disabled!==true;
      const pts=Number(m.points||0);
      const pc=(m.personalCoupons||[]).filter(c=>c&&!c.used).length;
      return '<div class="form-card" style="padding:10px;margin:0;cursor:pointer;opacity:'+(active?'1':'0.65')+'" onclick="M.openMemberDetail(\''+phone+'\')">'
        +'<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">'
        +'<div><div style="font-weight:700">'+esc(m.firstName||'')+' '+esc(m.lastName||'')
        +(active?'':' <span style="color:#C62828;font-size:11px">(ยกเลิกสิทธิ์)</span>')+'</div>'
        +'<div style="font-size:13px;color:#555">'+phone+'</div>'
        +'<div style="font-size:12px;margin-top:4px">แต้ม: <strong style="color:var(--p)">'+pts
        +'</strong> · ยอดสะสม ฿'+Number(m.totalSpent||0)+' · '+Number(m.orderCount||0)+' ออเดอร์'
        +(pc?(' · คูปองส่วนตัว '+pc+' ใบ'):'')
        +'</div></div>'
        +'<div style="font-size:12px;color:var(--p);font-weight:600">จัดการ ›</div>'
        +'</div></div>';
    }).join('');
  },
  openMemberDetail(phone){
    phone=this.normPhone(phone);
    const m=(this.membersCache||[]).find(x=>this.normPhone(x.phone||x.id)===phone);
    if(!m){ toast('ไม่พบสมาชิก'); return; }
    this._editingMember=m;
    const panel=document.getElementById('panelMemberDetail');
    const list=document.getElementById('panelMembers');
    if(list) list.classList.add('hide');
    if(panel) panel.classList.remove('hide');
    this.renderMemberDetail(m);
  },
  /** กลับจากหน้ารายละเอียดสมาชิก → รายชื่อ (ปุ่ม «กลับรายชื่อ») */
  closeMemberDetail(){
    const panel=document.getElementById('panelMemberDetail');
    const list=document.getElementById('panelMembers');
    if(panel) panel.classList.add('hide');
    if(list) list.classList.remove('hide');
    this._editingMember=null;
    try{ this.loadMembersPanel(); }catch(e){}
  },
  renderMemberDetail(m){
    const box=document.getElementById('memDetailBody');
    if(!box||!m) return;
    const phone=esc(m.phone||m.id||'');
    const active=m.status!=='cancelled' && m.active!==false && m.isActive!==false && m.disabled!==true;
    const created=m.createdAt?new Date(m.createdAt).toLocaleString('th-TH'):'-';
    const cancelled=m.cancelledAt?new Date(m.cancelledAt).toLocaleString('th-TH'):'-';
    const pcs=Array.isArray(m.personalCoupons)?m.personalCoupons:[];
    let pcHtml='';
    if(!pcs.length) pcHtml='<div style="color:#888;font-size:13px">ยังไม่มีคูปองส่วนตัว</div>';
    else {
      pcHtml=pcs.map(c=>{
        const lab=c.type==='percent'?(c.value+'%'):('฿'+c.value);
        const st=c.used?'<span style="color:#888">ใช้แล้ว</span>':'<span style="color:#2E7D32">ยังใช้ได้</span>';
        return '<div style="padding:6px 0;border-bottom:1px solid #eee;font-size:13px;display:flex;justify-content:space-between;gap:6px">'
          +'<span>'+esc(c.note||lab)+' ('+lab+') · '+st+'</span>'
          +(c.used?'':'<button type="button" class="btn btn-o btn-sm" style="width:auto;margin:0" onclick="M.removePersonalCoupon(\''+phone+'\',\''+esc(c.id)+'\')">ลบ</button>')
          +'</div>';
      }).join('');
    }
    box.innerHTML=
      '<div style="margin-bottom:10px;padding:8px;background:'+(active?'#E8F5E9':'#FFEBEE')+';border-radius:8px;font-size:13px">'
      +(active?'✓ สิทธิ์สมาชิกใช้งานได้':'✗ ยกเลิกสิทธิ์แล้ว')
      +'<div style="font-size:12px;color:#555;margin-top:4px">สมัครเมื่อ: '+created
      +(m.cancelledAt?(' · ยกเลิกเมื่อ: '+cancelled):'')
      +(m.cancelReason?(' · เหตุผล: '+esc(m.cancelReason)):'')
      +'</div></div>'
      +'<label class="lbl">ชื่อ</label><input id="mdFirst" value="'+esc(m.firstName||'')+'">'
      +'<label class="lbl">นามสกุล</label><input id="mdLast" value="'+esc(m.lastName||'')+'">'
      +'<label class="lbl">เบอร์โทร (แก้ไม่ได้)</label><input id="mdPhone" value="'+phone+'" disabled>'
      +'<label class="lbl">แต้ม</label><input id="mdPoints" type="number" min="0" value="'+Number(m.points||0)+'">'
      +'<button type="button" class="btn btn-p" style="margin-top:10px" onclick="M.saveMemberDetail()">บันทึกข้อมูล / แต้ม</button>'
      +'<div style="margin-top:16px;font-weight:600">🎟 คูปองส่วนตัว</div>'
      +'<div style="margin:8px 0">'+pcHtml+'</div>'
      +'<button type="button" class="btn btn-o" style="margin-top:6px" onclick="M.assignPersonalCoupon(\''+phone+'\')">+ มอบคูปองส่วนตัว</button>'
      +(active
        ? ('<button type="button" class="btn btn-o" style="margin-top:12px;color:var(--d);border-color:#ef9a9a" onclick="M.cancelMembership(\''+phone+'\')">ยกเลิกสิทธิ์สมาชิก</button>'
           +'<div style="font-size:11px;color:#888;margin-top:4px">ไม่ลบประวัติ · เก็บวันสมัคร/วันยกเลิกไว้ตรวจสอบย้อนหลัง</div>')
        : ('<button type="button" class="btn btn-o" style="margin-top:12px" onclick="M.reactivateMembership(\''+phone+'\')">เปิดสิทธิ์สมาชิกอีกครั้ง</button>'));
  },
  async adjustPoints(phone){
    phone=this.normPhone(phone);
    const m=(this.membersCache||[]).find(x=>this.normPhone(x.phone||x.id)===phone);
    const cur=Number(m&&m.points||0);
    const raw=prompt('ปรับแต้มสมาชิก '+phone+'\nแต้มปัจจุบัน: '+cur+'\nใส่จำนวนที่ต้องการตั้งค่า', String(cur));
    if(raw==null) return;
    const n=parseInt(raw,10);
    if(isNaN(n)||n<0){ toast('จำนวนไม่ถูกต้อง'); return; }
    try{
      await shopRef.collection('members').doc(phone).set({ points:n, updatedAt:Date.now() }, {merge:true});
      toast('อัปเดตแต้มเป็น '+n);
      this.loadMembersPanel();
    }catch(e){ toast('ไม่สำเร็จ: '+(e.message||e)); }
  },
  async deleteMember(phone){
    phone=this.normPhone(phone);
    if(!confirm('ลบสมาชิก '+phone+' ?')) return;
    try{
      await shopRef.collection('members').doc(phone).update({ isActive:false, active:false, disabled:true, status:'cancelled', updatedAt:Date.now() });
      toast('ปิดสมาชิกแล้ว (ไม่ลบถาวร)');
      this.loadMembersPanel();
    }catch(e){ toast('ลบไม่สำเร็จ: '+(e.message||e)); }
  },
  async adminAddMember(){
    const first=String((document.getElementById('admMemFirst')||{}).value||'').trim();
    const last=String((document.getElementById('admMemLast')||{}).value||'').trim();
    const phone=this.normPhone((document.getElementById('admMemPhone')||{}).value);
    // สมัครใหม่รับ 10 แต้มอัตโนมัติ (บังคับ ไม่ว่าร้านกรอกเท่าไร)
    const pts=10;
    if(!first){ toast('กรอกชื่อ'); return; }
    if(phone.length<9){ toast('กรอกเบอร์โทร 9–10 หลัก'); return; }
    try{
      const ref=shopRef.collection('members').doc(phone);
      if((await ref.get()).exists){ toast('เบอร์นี้เป็นสมาชิกแล้ว'); return; }
      await ref.set({
        phone, firstName:first, lastName:last, points:pts,
        totalSpent:0, orderCount:0, status:'active', active:true, isActive:true, disabled:false,
        createdAt:Date.now(), updatedAt:Date.now()
      });
      toast('เพิ่มสมาชิกสำเร็จ · รับ 10 แต้มต้อนรับ');
      try{ document.getElementById('admMemFirst').value=''; document.getElementById('admMemLast').value=''; document.getElementById('admMemPhone').value=''; }catch(e){}
      this.memSubTab('list');
    }catch(e){ toast('ไม่สำเร็จ: '+(e.message||e)); }
  },
  async loadCoupons(){
    const box=document.getElementById('cpList');
    if(!box) return;
    try{
      const snap=await shopRef.collection('coupons').limit(100).get();
      const list=snap.docs.map(d=>({id:d.id, ...d.data()}));
      if(!list.length){ box.innerHTML='<div style="color:#888;padding:8px">ยังไม่มีคูปอง</div>'; return; }
      box.innerHTML='<div style="font-weight:600;margin:8px 0">คูปองรวม (ลูกค้ากรอกรหัส)</div>'+list.map(c=>{
        const t=c.type==='percent'?(c.value+'%'):('฿'+c.value);
        const used=Number(c.usedCount||0)+'/'+(c.maxUses!=null?c.maxUses:'∞');
        const code=esc(c.code||c.id);
        const active=c.active!==false && c.isActive!==false && c.disabled!==true;
        const q="'"+code+"'";
        return '<div class="form-card" style="padding:10px;margin:0 0 8px">'
          +'<div style="font-weight:700">'+code+(active?'':' <span style="color:#C62828">ปิด</span>')+'</div>'
          +'<div style="font-size:13px;color:#555;margin:4px 0">'+t+' · ใช้แล้ว '+used
          +(c.minOrder?(' · ขั้นต่ำ ฿'+c.minOrder):'')
          +(c.expiresAt?(' · หมดอายุ '+new Date(c.expiresAt).toLocaleDateString('th-TH')):'')
          +'</div>'
          +'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">'
          +'<button type="button" class="btn btn-o btn-sm" style="width:auto;margin:0" onclick="M.editCoupon('+q+')">แก้ไข</button>'
          +'<button type="button" class="btn btn-o btn-sm" style="width:auto;margin:0" onclick="M.toggleCoupon('+q+','+(active?'false':'true')+')">'+(active?'ปิด':'เปิด')+'</button>'
          +'<button type="button" class="btn btn-o btn-sm" style="width:auto;margin:0;color:var(--d)" onclick="M.deleteCoupon('+q+')">ลบ</button>'
          +'</div></div>';
      }).join('');
    }catch(e){ box.innerHTML='<div style="color:#C62828">โหลดคูปองไม่สำเร็จ</div>'; }
  },
  async editCoupon(code){
    code=String(code||'').toUpperCase();
    try{
      const snap=await shopRef.collection('coupons').doc(code).get();
      if(!snap.exists){ toast('ไม่พบคูปอง'); return; }
      const c=snap.data()||{};
      document.getElementById('cpCode').value=code;
      document.getElementById('cpCode').readOnly=true;
      document.getElementById('cpType').value=c.type||'fixed';
      document.getElementById('cpValue').value=c.value||'';
      document.getElementById('cpMin').value=c.minOrder||'';
      document.getElementById('cpMax').value=c.maxUses!=null?c.maxUses:'';
      if(c.expiresAt){
        const d=new Date(c.expiresAt);
        document.getElementById('cpExp').value=d.toISOString().slice(0,10);
      } else document.getElementById('cpExp').value='';
      toast('แก้ไขคูปอง '+code+' · กดบันทึกเมื่อแก้เสร็จ');
      document.getElementById('cpCode').scrollIntoView({behavior:'smooth',block:'center'});
    }catch(e){ toast('โหลดคูปองไม่สำเร็จ'); }
  },
  async deleteCoupon(code){
    code=String(code||'').toUpperCase();
    if(!confirm('ลบคูปองรวม '+code+' ถาวร?')) return;
    try{
      await shopRef.collection('coupons').doc(code).update({ active:false, isActive:false, disabled:true, updatedAt:Date.now() });
      toast('ปิดคูปองแล้ว (ไม่ลบถาวร)');
      this.loadCoupons();
      try{ document.getElementById('cpCode').readOnly=false; document.getElementById('cpCode').value=''; }catch(e){}
    }catch(e){ toast('ลบไม่สำเร็จ: '+(e.message||e)); }
  },

  async createCoupon(){
    const code=String((document.getElementById('cpCode')||{}).value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
    const type=(document.getElementById('cpType')||{}).value||'fixed';
    const value=Number((document.getElementById('cpValue')||{}).value||0);
    const minOrder=Number((document.getElementById('cpMin')||{}).value||0)||0;
    const maxRaw=String((document.getElementById('cpMax')||{}).value||'').trim();
    const maxUses=maxRaw===''?null:Number(maxRaw);
    const expRaw=String((document.getElementById('cpExp')||{}).value||'').trim();
    const expiresAt=expRaw?new Date(expRaw+'T23:59:59').getTime():null;
    if(!code||code.length<3){ toast('รหัสคูปองอย่างน้อย 3 ตัว'); return; }
    if(!(value>0)){ toast('ใส่มูลค่าคูปอง'); return; }
    if(type==='percent'&&value>100){ toast('% ไม่เกิน 100'); return; }
    try{
      const cref=shopRef.collection('coupons').doc(code);
      const prevSnap=await cref.get();
      const prev=prevSnap.exists?(prevSnap.data()||{}):{};
      await cref.set({
        code, type, value, minOrder, maxUses,
        usedCount: Number(prev.usedCount||0),
        expiresAt, active:true, isActive:true, disabled:false,
        createdAt: prev.createdAt||Date.now(), updatedAt:Date.now()
      }, {merge:true});
      toast('บันทึกคูปอง '+code);
      try{ document.getElementById('cpCode').readOnly=false; document.getElementById('cpCode').value=''; }catch(e){}
      this.loadCoupons();
    }catch(e){ toast('ไม่สำเร็จ: '+(e.message||e)); }
  },
  async toggleCoupon(code, turnOn){
    try{
      await shopRef.collection('coupons').doc(code).update({ active:!!turnOn, isActive:!!turnOn, disabled:!turnOn, updatedAt:Date.now() });
      this.loadCoupons();
    }catch(e){ toast('ปรับสถานะไม่สำเร็จ'); }
  },
  
  assignPersonalCoupon(phone){
    phone=this.normPhone(phone);
    if(!phone){ toast('ไม่มีเบอร์'); return; }
    const el=document.getElementById('mPersonalCoupon');
    if(!el){ toast('ไม่พบฟอร์มคูปอง'); return; }
    document.getElementById('pcPhone').value=phone;
    document.getElementById('pcPhoneLabel').textContent=phone;
    document.getElementById('pcNote').value='';
    document.getElementById('pcType').value='fixed';
    document.getElementById('pcValue').value='';
    document.getElementById('pcMin').value='0';
    document.getElementById('pcExp').value='';
    el.classList.add('on');
  },
  hidePersonalCouponModal(){
    const el=document.getElementById('mPersonalCoupon');
    if(el) el.classList.remove('on');
  },
  async submitPersonalCoupon(){
    const phone=this.normPhone((document.getElementById('pcPhone')||{}).value);
    if(!phone){ toast('ไม่มีเบอร์'); return; }
    const t=(document.getElementById('pcType')||{}).value||'fixed';
    const value=Number((document.getElementById('pcValue')||{}).value||0);
    const minOrder=Math.max(0, Number((document.getElementById('pcMin')||{}).value||0)||0);
    const note=String((document.getElementById('pcNote')||{}).value||'').trim() || (t==='percent'?(value+'%'):('฿'+value));
    const expRaw=String((document.getElementById('pcExp')||{}).value||'').trim();
    let expiresAt=null;
    if(expRaw) expiresAt=new Date(expRaw+'T23:59:59').getTime();
    if(!(value>0)){ toast('ใส่มูลค่าคูปอง'); return; }
    if(t==='percent'&&value>100){ toast('% ไม่เกิน 100'); return; }
    const id='PC'+Date.now().toString(36).toUpperCase()+Math.floor(Math.random()*900);
    try{
      await db.runTransaction(async tx=>{
        const ref=shopRef.collection('members').doc(phone);
        const snap=await tx.get(ref);
        if(!snap.exists) throw new Error('ไม่พบสมาชิก');
        const md=snap.data()||{};
        const list=Array.isArray(md.personalCoupons)?md.personalCoupons.slice():[];
        list.push({ id, type:t, value, minOrder, note, expiresAt, used:false, assignedAt:Date.now() });
        tx.update(ref,{ personalCoupons:list, updatedAt:Date.now() });
      });
      toast('มอบคูปองส่วนตัวแล้ว');
      this.hidePersonalCouponModal();
      await this.loadMembersPanel();
      if(this._editingMember){
        const p=this.normPhone(this._editingMember.phone||this._editingMember.id);
        const updated=(this.membersCache||[]).find(x=>this.normPhone(x.phone||x.id)===p);
        if(updated){ this._editingMember=updated; this.renderMemberDetail(updated); }
      }
    }catch(e){ toast('ไม่สำเร็จ: '+(e.message||e)); }
  },

  async awardMemberPoints(order){
    if(!order || order.pointsAwarded) return;
    const phone=this.normPhone(order.memberPhone||order.contactPhone||'');
    if(!phone || phone.length<9) return;
    // สะสมแต้มจากยอดขายจริง (total หลังส่วนลด) — ครบ 100 บาท = 1 แต้ม
    const sale=Math.max(0, Number(order.total!=null?order.total:0));
    const earn=Math.floor(sale/100);
    try{
      await db.runTransaction(async tx=>{
        const oref=shopRef.collection('orders').doc(order.id);
        const os=await tx.get(oref);
        if(!os.exists) return;
        const od=os.data()||{};
        if(od.pointsAwarded) return;
        const mref=shopRef.collection('members').doc(phone);
        const ms=await tx.get(mref);
        if(!ms.exists){
          tx.update(oref,{ pointsAwarded:true, pointsEarned:0 });
          return;
        }
        const md=ms.data()||{};
        if(md.status==='cancelled' || md.active===false){
          tx.update(oref,{ pointsAwarded:true, pointsEarned:0, memberPhone:phone });
          return;
        }
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
    }catch(e){ console.warn('awardMemberPoints', e); }
  },

  async saveMemberDetail(){
    const m=this._editingMember; if(!m) return;
    const phone=this.normPhone(m.phone||m.id);
    const first=String((document.getElementById('mdFirst')||{}).value||'').trim();
    const last=String((document.getElementById('mdLast')||{}).value||'').trim();
    const pts=Math.max(0, Math.floor(Number((document.getElementById('mdPoints')||{}).value||0)));
    if(!first){ toast('กรอกชื่อ'); return; }
    try{
      await shopRef.collection('members').doc(phone).set({
        firstName:first, lastName:last, points:pts, updatedAt:Date.now()
      }, {merge:true});
      toast('บันทึกแล้ว');
      await this.loadMembersPanel();
      const updated=(this.membersCache||[]).find(x=>this.normPhone(x.phone||x.id)===phone);
      if(updated){ this._editingMember=updated; this.renderMemberDetail(updated); }
    }catch(e){ toast('บันทึกไม่สำเร็จ: '+(e.message||e)); }
  },
  async cancelMembership(phone){
    phone=this.normPhone(phone);
    const reason=prompt('เหตุผลการยกเลิกสิทธิ์สมาชิก (จำเป็น)', '');
    if(reason==null) return;
    if(!String(reason).trim()){ toast('ต้องใส่เหตุผล'); return; }
    if(!confirm('ยืนยันยกเลิกสิทธิ์สมาชิก '+phone+'?\nข้อมูลจะถูกเก็บไว้ตรวจสอบย้อนหลัง')) return;
    try{
      await shopRef.collection('members').doc(phone).set({
        status:'cancelled', active:false, isActive:false, disabled:true,
        cancelledAt:Date.now(), cancelReason:String(reason).trim(),
        updatedAt:Date.now()
      }, {merge:true});
      toast('ยกเลิกสิทธิ์สมาชิกแล้ว');
      await this.loadMembersPanel();
      const updated=(this.membersCache||[]).find(x=>this.normPhone(x.phone||x.id)===phone);
      if(updated){ this._editingMember=updated; this.renderMemberDetail(updated); }
    }catch(e){ toast('ไม่สำเร็จ: '+(e.message||e)); }
  },
  async reactivateMembership(phone){
    phone=this.normPhone(phone);
    if(!confirm('เปิดสิทธิ์สมาชิก '+phone+' อีกครั้ง?')) return;
    try{
      await shopRef.collection('members').doc(phone).set({
        status:'active', active:true, isActive:true, disabled:false,
        reactivatedAt:Date.now(), updatedAt:Date.now()
      }, {merge:true});
      toast('เปิดสิทธิ์แล้ว');
      await this.loadMembersPanel();
      const updated=(this.membersCache||[]).find(x=>this.normPhone(x.phone||x.id)===phone);
      if(updated){ this._editingMember=updated; this.renderMemberDetail(updated); }
    }catch(e){ toast('ไม่สำเร็จ: '+(e.message||e)); }
  },
  async removePersonalCoupon(phone, couponId){
    phone=this.normPhone(phone);
    if(!confirm('ลบคูปองส่วนตัวนี้?')) return;
    try{
      await db.runTransaction(async tx=>{
        const ref=shopRef.collection('members').doc(phone);
        const snap=await tx.get(ref);
        if(!snap.exists) throw new Error('ไม่พบสมาชิก');
        const md=snap.data()||{};
        const list=(md.personalCoupons||[]).filter(c=>c && c.id!==couponId);
        tx.update(ref,{ personalCoupons:list, updatedAt:Date.now() });
      });
      toast('ลบคูปองแล้ว');
      await this.loadMembersPanel();
      const updated=(this.membersCache||[]).find(x=>this.normPhone(x.phone||x.id)===phone);
      if(updated){ this._editingMember=updated; this.renderMemberDetail(updated); }
    }catch(e){ toast('ลบไม่สำเร็จ: '+(e.message||e)); }
  },
  });
})();
