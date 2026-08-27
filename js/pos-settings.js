/**
 * Somtum1POS — tabs / catalog / settings / QR
 * Split from pos.js (lines 2571-3223)
 */
/* global M, db, shopRef, esc, money, toast, uid, sha256, calcPaymentCover, fileToDataUrl, PP */
(function () {
  'use strict';
  window.M = window.M || {};
  Object.assign(window.M, {
  tab(name){
    ['orders','tables','history','shop','report','members','settings'].forEach(n=>{
      const el=document.getElementById('panel'+n.charAt(0).toUpperCase()+n.slice(1));
      if(el) el.classList.toggle('hide', n!==name);
    });
    // panelMemberDetail อยู่นอก panelMembers — ต้องซ่อนทุกครั้งที่ไม่ได้อยู่แท็บสมาชิก
    // ไม่งั้นกดออเดอร์/โต๊ะ/อื่น แล้วยังค้างทับจอ
    try{
      const detail=document.getElementById('panelMemberDetail');
      if(detail){
        if(name!=='members') detail.classList.add('hide');
        else detail.classList.add('hide'); // เข้าแท็บสมาชิกเริ่มที่รายชื่อเสมอ
      }
      if(name==='members'){
        const list=document.getElementById('panelMembers');
        if(list) list.classList.remove('hide');
      }
    }catch(e){}
    document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('on'));
    const map={orders:'navOrders',tables:'navTables',history:'navHistory',shop:'navShop',report:'navReport',members:'navMembers',settings:'navSet'};
    if(map[name]) document.getElementById(map[name]).classList.add('on');
    if(name==='report') this.loadReport();
    if(name==='history') this.loadHistory();
    if(name==='shop') this.shopTab(this.shopTabName||'menu');
    if(name==='settings') this.loadSettingsUI();
    if(name==='members'){ this.loadMembersPanel(); }
  },
  histPreset(p){
    const from=document.getElementById('histFrom');
    const to=document.getElementById('histTo');
    const now=new Date();
    const iso=d=>{
      const y=d.getFullYear();
      const m=String(d.getMonth()+1).padStart(2,'0');
      const day=String(d.getDate()).padStart(2,'0');
      return y+'-'+m+'-'+day;
    };
    if(p==='today'){ from.value=iso(now); to.value=iso(now); }
    else if(p==='7d'){ const a=new Date(now.getTime()-6*864e5); from.value=iso(a); to.value=iso(now); }
    else if(p==='30d'){ const a=new Date(now.getTime()-29*864e5); from.value=iso(a); to.value=iso(now); }
    else { from.value=''; to.value=''; }
    this.loadHistory();
  },
  loadHistory(){
    const q=(document.getElementById('histQ')?.value||'').trim().toLowerCase();
    const fromV=document.getElementById('histFrom')?.value||'';
    const toV=document.getElementById('histTo')?.value||'';
    let fromTs=0, toTs=Date.now()+864e5;
    if(fromV){ const d=new Date(fromV+'T00:00:00'); fromTs=d.getTime(); }
    if(toV){ const d=new Date(toV+'T23:59:59'); toTs=d.getTime(); }
    // ประวัติเก็บเฉพาะออเดอร์เสร็จสมบูรณ์ (ทำเสร็จ + จ่ายเงินแล้ว)
    let list=this.orders.filter(o=>{
      if(o.status!=='Completed') return false;
      const t=o.createdAt||0;
      if(t<fromTs||t>toTs) return false;
      if(!q) return true;
      const queue=(o.queue||'').toLowerCase();
      const names=(o.items||[]).map(i=>i.name||'').join(' ').toLowerCase();
      return queue.includes(q)||names.includes(q)||String(o.id).includes(q);
    }).sort((a,b)=>(b.completedAt||b.createdAt||0)-(a.completedAt||a.createdAt||0));
    const el=document.getElementById('historyList');
    if(!el) return;
    if(!list.length){ el.innerHTML='<div style="text-align:center;color:#888;padding:24px">ไม่พบประวัติ</div>'; return; }
    el.innerHTML=list.map(o=>{
      const pay=o.paymentStatus==='PAID'?'<span style="color:#2E7D32">ชำระแล้ว</span>':'<span style="color:#C62828">ไม่ชำระ</span>';
      const st=({AwaitingPayment:'รอชำระ',Pending:'รอรับ',Cooking:'กำลังทำ',Ready:'พร้อมรับ',Completed:'เสร็จสิ้น',Cancelled:'ยกเลิก'})[o.status]||o.status;
      const when=o.createdAt?new Date(o.createdAt).toLocaleString('th-TH'):'';
      const prev=(o.items||[]).map(i=>i.name+'x'+i.qty).join(', ');
      return `<div class="list-item" style="flex-direction:column;align-items:stretch">
        <div style="display:flex;justify-content:space-between;width:100%"><strong>คิว ${esc(o.queue)}</strong><span>${money(o.total)}</span></div>
        <div style="font-size:12px;color:#666;margin:4px 0">${esc(when)} · ${esc(st)} · ${pay}</div>
        <div style="font-size:13px;color:#444">${esc(prev.slice(0,80))}${prev.length>80?'…':''}</div>
        <div class="row-actions" style="margin-top:8px">
          <button class="btn btn-o btn-sm" onclick="M.showReceipt('${esc(o.id)}')">ดูใบเสร็จ</button>
          <button class="btn btn-d btn-sm" onclick="M.deleteOrder('${esc(o.id)}')">ลบ</button>
        </div>
      </div>`;
    }).join('');
  },
  shopTabName:'menu',
  shopTab(name){
    this.shopTabName=name;
    ['menu','cat','top','spice','opt'].forEach(n=>{
      const el=document.getElementById('shopPane'+n.charAt(0).toUpperCase()+n.slice(1));
      if(el) el.classList.toggle('hide', n!==name);
    });
    document.querySelectorAll('#shopSubtabs button').forEach(b=>b.classList.remove('on'));
    const map={menu:'stMenu',cat:'stCat',top:'stTop',spice:'stSpice',opt:'stOpt'};
    if(map[name]) document.getElementById(map[name]).classList.add('on');
    if(name==='menu') this.loadCatalogMenus();
    if(name==='cat') this.renderCatAdmin();
    if(name==='top') this.renderTopAdmin();
    if(name==='spice') this.renderSpiceAdmin();
    if(name==='opt') this.loadOptionConfigUI();
  },

  loadReport(){
    const rangeEl=document.getElementById('reportRange');
    const range=rangeEl?rangeEl.value:'today';
    const now=Date.now(); let from=0;
    if(range==='today'){const t=new Date();t.setHours(0,0,0,0);from=t.getTime()}
    else if(range==='7d') from=now-7*864e5;
    else if(range==='30d') from=now-30*864e5;
    const list=(this.orders||[]).filter(o=>(o.createdAt||0)>=from);
    const paid=list.filter(o=>o.paymentStatus==='PAID');
    const completed=list.filter(o=>o.status==='Completed' && o.paymentStatus==='PAID');
    const unpaid=list.filter(o=>o.paymentStatus!=='PAID' && o.status!=='Cancelled');
    const cancelled=list.filter(o=>o.status==='Cancelled');
    const cash=paid.filter(o=>o.paymentMethod==='CASH').reduce((s,o)=>s+Number(o.paidAmount!=null?o.paidAmount:o.total||0),0);
    const pp=paid.filter(o=>o.paymentMethod==='PROMPTPAY'||o.paymentMethod==='QR'||o.paymentMethod==='KSHOP').reduce((s,o)=>s+Number(o.paidAmount!=null?o.paidAmount:o.total||0),0);
    const pointsUsedTotal=paid.reduce((s,o)=>s+Number(o.pointsUsed||o.pointsDisc||0),0);
    const couponDiscTotal=paid.reduce((s,o)=>s+Number(o.couponDisc||0),0);
    const discountTotal=paid.reduce((s,o)=>s+Number(o.discountAmount||0),0);
    const salesPaid=paid.reduce((s,o)=>s+Number(o.paidAmount!=null?o.paidAmount:o.total||0),0);
    const unpaidVal=unpaid.reduce((s,o)=>s+Number(o.total||0),0);
    const avgTicket=paid.length?Math.round(salesPaid/paid.length):0;
    // ชั่วโมงพีค (จากออเดอร์ที่ชำระแล้ว)
    const hourCnt={};
    paid.forEach(o=>{
      const h=new Date(o.paidAt||o.createdAt||0).getHours();
      if(!isNaN(h)) hourCnt[h]=(hourCnt[h]||0)+1;
    });
    let peakHour=null, peakN=0;
    Object.keys(hourCnt).forEach(h=>{ if(hourCnt[h]>peakN){ peakN=hourCnt[h]; peakHour=Number(h);} });
    const peakLabel=peakHour==null?'-':(String(peakHour).padStart(2,'0')+':00–'+String((peakHour+1)%24).padStart(2,'0')+':00');
    // insight สั้น ๆ
    const insights=[];
    if(unpaid.length) insights.push('ค้างชำระ '+unpaid.length+' บิล · ฿'+unpaidVal.toLocaleString('en-US'));
    if(paid.length) insights.push('บิลเฉลี่ย ฿'+avgTicket.toLocaleString('en-US'));
    if(peakHour!=null) insights.push('ชั่วโมงขายดี '+peakLabel+' ('+peakN+' บิล)');
    if(cancelled.length) insights.push('ยกเลิก '+cancelled.length+' รายการ');
    if(!insights.length) insights.push('ยังไม่มีข้อมูลในช่วงนี้');
    const box=document.getElementById('reportBox');
    if(!box) return;
    box.innerHTML=`
      <div class="smart-insight">${insights.map(t=>'<div class="si-line">💡 '+t+'</div>').join('')}</div>
      <div class="rc"><div class="v">${money(salesPaid)}</div><div class="l">ยอดรับเงินจริง (ชำระแล้ว)</div></div>
      <div class="rc"><div class="v">${paid.length}</div><div class="l">ออเดอร์ชำระแล้ว</div></div>
      <div class="rc"><div class="v">${money(avgTicket)}</div><div class="l">ยอดเฉลี่ย/บิล</div></div>
      <div class="rc"><div class="v">${unpaid.length}</div><div class="l">ค้างชำระ (฿${unpaidVal.toLocaleString('en-US')})</div></div>
      <div class="rc"><div class="v">${completed.length}</div><div class="l">เสร็จสมบูรณ์</div></div>
      <div class="rc"><div class="v">${list.length}</div><div class="l">ออเดอร์ทั้งหมด (รวมค้าง)</div></div>
      <div class="rc"><div class="v">${money(cash)}</div><div class="l">เงินสด</div></div>
      <div class="rc"><div class="v">${money(pp)}</div><div class="l">พร้อมเพย์ / QR</div></div>
      <div class="rc"><div class="v">${peakLabel}</div><div class="l">ชั่วโมงพีค</div></div>
      <div class="rc"><div class="v">${money(pointsUsedTotal)}</div><div class="l">ใช้แต้ม (฿)</div></div>
      <div class="rc"><div class="v">${money(couponDiscTotal)}</div><div class="l">ส่วนลดคูปอง</div></div>
      <div class="rc"><div class="v">${money(discountTotal)}</div><div class="l">ส่วนลดรวม (แต้ม+คูปอง)</div></div>`;
    // เมนูขายดีนับจากออเดอร์ที่ชำระแล้วเท่านั้น (ไม่นับออเดอร์ค้าง)
    const mc={}; paid.forEach(o=>(o.items||[]).forEach(i=>{mc[i.name]=(mc[i.name]||0)+Number(i.qty||0)}));
    const top=Object.entries(mc).sort((a,b)=>b[1]-a[1]).slice(0,8);
    document.getElementById('topMenus').innerHTML=top.length?top.map(([n,q],i)=>`<div class="list-item" style="justify-content:space-between"><div class="meta"><div class="name">${i+1}. ${esc(n)}</div></div><strong style="flex:0 0 auto;white-space:nowrap">${q}</strong></div>`).join(''):'<div style="color:#888">ยังไม่มี</div>';
  },

  async loadCatalogMenus(){
    const [ms,cs]=await Promise.all([shopRef.collection('menus').get(),shopRef.collection('categories').get()]);
    this.menus=ms.docs.map(d=>({id:d.id,...d.data()}));
    this.cats=cs.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.order||0)-(b.order||0));
    document.getElementById('menuCat').innerHTML=this.cats.filter(c=>c.isActive!==false).map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    document.getElementById('menuFile').onchange=async (e)=>{
      const f=e.target.files[0]; if(!f) return;
      try{
        this.pendingImageData=await fileToDataUrl(f,480,.55);
        document.getElementById('menuPreview').innerHTML=`<img src="${this.pendingImageData}" style="max-width:160px;border-radius:8px">`;
        toast('พร้อมบันทึกรูป');
      }catch(err){ toast(err.message); }
    };
    const menus=this.menus.slice().sort((a,b)=>((a.isActive===false)-(b.isActive===false))||((a.order||0)-(b.order||0)));
    document.getElementById('menuAdmin').innerHTML=`<p style="font-size:12px;color:#777;margin-bottom:8px">กด ↑↓ หรือลาก ⋮⋮ เพื่อจัดลำดับ</p>`+(menus.map(m=>{
      const src=m.imageData||m.imageUrl||'';
      const flags=[m.isOut?'หมด':'', m.isActive===false?'ปิดขาย':'', m.allowPlara?'ปลาร้า':''].filter(Boolean).join(' · ');
      return `<div class="list-item" draggable="true" data-id="${esc(m.id)}" data-col="menus" ondragstart="M.dragStart(event)" ondragover="M.dragOver(event)" ondrop="M.dropGeneric(event,'menus')" ondragend="M.dragEnd(event)">
        <span class="grip">⋮⋮</span>
        ${src?`<img class="thumb" src="${esc(src)}" alt="">`:`<div class="thumb"></div>`}
        <div class="meta"><div class="name">${esc(m.name)}</div><div class="sub">${money(m.price)}${flags?' · '+flags:''}</div></div>
        <div class="acts">
          <button class="btn btn-o btn-sm" onclick="event.stopPropagation();M.moveGeneric('menus','${esc(m.id)}',-1)">↑</button>
          <button class="btn btn-o btn-sm" onclick="event.stopPropagation();M.moveGeneric('menus','${esc(m.id)}',1)">↓</button>
          <button class="btn btn-o btn-sm" onclick="M.editMenu('${esc(m.id)}')">แก้</button>
          ${m.isActive===false
            ? `<button class="btn btn-g btn-sm" onclick="M.reopenMenu('${esc(m.id)}')">เปิด</button>`
            : `<button class="btn btn-o btn-sm" onclick="M.toggleOut('${esc(m.id)}',${!m.isOut})">${m.isOut?'มีของ':'หมด'}</button>
          <button class="btn btn-o btn-sm" onclick="M.closeMenu('${esc(m.id)}')">ปิด</button>`}
          <button class="btn btn-d btn-sm" onclick="M.deleteMenu('${esc(m.id)}')">ลบ</button>
        </div>
      </div>`;
    }).join('')||'<div style="color:#888">ยังไม่มีเมนู</div>');
  },
  editMenu(id){
    const m=this.menus.find(x=>x.id===id); if(!m) return;
    document.getElementById('menuEditId').value=m.id;
    document.getElementById('menuName').value=m.name||'';
    document.getElementById('menuPrice').value=m.price||0;
    document.getElementById('menuCat').value=m.catId||'';
    document.getElementById('menuImg').value=m.imageUrl||'';
    const mp=document.getElementById('menuPlara'); if(mp) mp.checked=!!(m.allowPlara===true||m.allowPlara===1||m.allowPlara==='true'||m.allowPlara==='1');
    this.pendingImageData=m.imageData||'';
    document.getElementById('menuPreview').innerHTML=this.pendingImageData?`<img src="${this.pendingImageData}" style="max-width:160px;border-radius:8px">`:'';
    this.shopTab('menu');
    // รอ layout แล้วเลื่อนทันที (รายการเยอะ)
    setTimeout(()=>this.scrollToForm('menuName'), 30);
    setTimeout(()=>this.scrollToForm('menuName'), 150);
  },
  resetMenuForm(){
    document.getElementById('menuEditId').value='';
    document.getElementById('menuName').value='';
    document.getElementById('menuPrice').value='';
    document.getElementById('menuImg').value='';
    const mp=document.getElementById('menuPlara'); if(mp) mp.checked=false;
    document.getElementById('menuFile').value='';
    document.getElementById('menuPreview').innerHTML='';
    this.pendingImageData='';
  },
  async saveMenu(){
    const id=document.getElementById('menuEditId').value||('m_'+uid());
    const name=document.getElementById('menuName').value.trim();
    const price=Number(document.getElementById('menuPrice').value);
    const catId=document.getElementById('menuCat').value;
    const imageUrl=document.getElementById('menuImg').value.trim();
    const plEl=document.getElementById('menuPlara');
    const allowPlara=plEl?!!plEl.checked:false;
    if(!name){toast('ใส่ชื่อเมนู');return}
    if(isNaN(price)||price<0){toast('ราคาไม่ถูกต้อง');return}
    if(!catId){toast('เลือกหมวด');return}
    const prev=this.menus.find(x=>x.id===id);
    const maxOrder=this.menus.reduce((m,x)=>Math.max(m,Number(x.order)||0),0);
    const data={id,name,price,catId,imageUrl,allowPlara,isActive:true,isOut:prev?!!prev.isOut:false, order: prev&&prev.order!=null?prev.order:maxOrder+1};
    if(this.pendingImageData) data.imageData=this.pendingImageData;
    await shopRef.collection('menus').doc(id).set(data,{merge:true});
    toast(allowPlara?'บันทึกเมนูแล้ว (มีตัวเลือกปลาร้า)':'บันทึกเมนูแล้ว'); this.resetMenuForm(); this.loadCatalogMenus();
  },
  async toggleOut(id,isOut){ await shopRef.collection('menus').doc(id).update({isOut:!!isOut}); toast('อัปเดตแล้ว'); this.loadCatalogMenus(); },
  async closeMenu(id){ if(!confirm('ปิดการขายเมนูนี้? (เปิดใหม่ได้ภายหลัง)'))return; await shopRef.collection('menus').doc(id).update({isActive:false}); toast('ปิดเมนูแล้ว'); this.loadCatalogMenus(); },
  async reopenMenu(id){ await shopRef.collection('menus').doc(id).update({isActive:true}); toast('เปิดขายเมนูแล้ว'); this.loadCatalogMenus(); },
  async deleteMenu(id){
    if(!confirm('ปิดการขายเมนูนี้? (ไม่ลบถาวร — เปิดใหม่ได้)')) return;
    await shopRef.collection('menus').doc(id).update({ isActive:false, updatedAt:Date.now() });
    toast('ปิดเมนูแล้ว'); this.loadCatalogMenus();
  },

  subCatalog(tab){ this.shopTab(tab==='cat'?'cat':tab==='top'?'top':'spice'); },
  async renderCatAdmin(){
    const snap=await shopRef.collection('categories').get();
    this.cats=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.order||0)-(b.order||0));
    document.getElementById('catalogFormCat').innerHTML=`
      <h3>หมวดหมู่เมนู</h3>
      <input type="hidden" id="catId">
      <label class="lbl">ชื่อหมวด</label><input id="catName">
      <label class="lbl">ลำดับ</label><input id="catOrder" type="number" value="1">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
        <button class="btn btn-p" onclick="M.saveCat()">บันทึก</button>
        <button class="btn btn-o" onclick="document.getElementById('catId').value='';document.getElementById('catName').value=''">ล้าง</button>
      </div>`;
    document.getElementById('catalogListCat').innerHTML=`<p style="font-size:12px;color:#777;margin-bottom:8px">↑↓ หรือลาก ⋮⋮ จัดลำดับ</p>`+(this.cats.map((c,idx)=>`
      <div class="list-item" draggable="true" data-id="${esc(c.id)}" data-col="categories" ondragstart="M.dragStart(event)" ondragover="M.dragOver(event)" ondrop="M.dropGeneric(event,'categories')" ondragend="M.dragEnd(event)">
        <span class="grip">⋮⋮</span>
        <div class="meta"><div class="name">${esc(c.name)}</div><div class="sub">ลำดับ #${c.order||0}${c.isActive===false?' · ปิด':''}</div></div>
        <div class="acts">
          <button class="btn btn-o btn-sm" onclick="event.stopPropagation();M.moveCat('${esc(c.id)}',-1)">↑</button>
          <button class="btn btn-o btn-sm" onclick="event.stopPropagation();M.moveCat('${esc(c.id)}',1)">↓</button>
          <button class="btn btn-o btn-sm" onclick="M.editCat('${esc(c.id)}')">แก้</button>
          ${c.isActive===false
            ? `<button class="btn btn-g btn-sm" onclick="M.reopenCat('${esc(c.id)}')">เปิด</button>`
            : `<button class="btn btn-o btn-sm" onclick="M.closeCat('${esc(c.id)}')">ปิด</button>`}
          <button class="btn btn-d btn-sm" onclick="M.deleteCat('${esc(c.id)}')">ลบ</button>
        </div>
      </div>`).join('')||'<div style="color:#888">ยังไม่มี</div>');
  },
  dragId:null,
  dragCol:null,
  dragStart(e){
    const el=e.currentTarget;
    this.dragId=el.getAttribute('data-id');
    this.dragCol=el.getAttribute('data-col')||'categories';
    el.classList.add('dragging');
    el.style.opacity='0.45';
    try{ e.dataTransfer.setData('text/plain', this.dragId); e.dataTransfer.effectAllowed='move'; }catch(err){}
  },
  dragOver(e){ e.preventDefault(); e.stopPropagation(); try{e.dataTransfer.dropEffect='move'}catch(err){} },
  dragEnd(e){ e.currentTarget.style.opacity='1'; e.currentTarget.classList.remove('dragging'); },
  getOrderedItems(collection){
    if(collection==='menus') return (this.menus||[]).filter(m=>m.isActive!==false).slice().sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0) || String(a.name).localeCompare(String(b.name)));
    if(collection==='toppings') return (this.tops||[]).filter(t=>t.isActive!==false).slice().sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));
    if(collection==='spiceLevels') return (this.spice||[]).filter(s=>s.isActive!==false).slice().sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));
    return (this.cats||[]).filter(c=>c.isActive!==false).slice().sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));
  },
  async saveOrder(collection, ids){
    try{
      // write sequentially to avoid batch permission edge cases
      for(let i=0;i<ids.length;i++){
        await shopRef.collection(collection).doc(ids[i]).set({ order: i+1 }, { merge:true });
      }
      // update local
      ids.forEach((id,i)=>{
        let arr = collection==='menus'?this.menus: collection==='toppings'?this.tops: collection==='spiceLevels'?this.spice: this.cats;
        const item=(arr||[]).find(x=>x.id===id); if(item) item.order=i+1;
      });
      toast('จัดลำดับแล้ว ('+ids.length+' รายการ)');
      if(collection==='menus') this.loadCatalogMenus();
      else if(collection==='toppings') this.renderTopAdmin();
      else if(collection==='spiceLevels') this.renderSpiceAdmin();
      else this.renderCatAdmin();
    }catch(err){ console.error(err); toast('จัดลำดับไม่สำเร็จ: '+(err.message||err)); }
  },
  async dropCat(e){ e.preventDefault(); await this.dropGeneric(e,'categories'); },
  async dropGeneric(e, collection){
    e.preventDefault(); e.stopPropagation();
    const toId=e.currentTarget.getAttribute('data-id');
    const col=collection || e.currentTarget.getAttribute('data-col') || this.dragCol || 'categories';
    let fromId=this.dragId;
    try{ fromId = fromId || e.dataTransfer.getData('text/plain'); }catch(err){}
    if(!fromId || fromId===toId) return;
    const items=this.getOrderedItems(col);
    const ids=items.map(x=>x.id);
    const from=ids.indexOf(fromId), to=ids.indexOf(toId);
    if(from<0||to<0){ toast('ไม่พบรายการ'); return; }
    const moved=ids.splice(from,1)[0]; ids.splice(to,0,moved);
    await this.saveOrder(col, ids);
  },
  async moveGeneric(collection, id, dir){
    try{
      const items=this.getOrderedItems(collection);
      const ids=items.map(x=>x.id);
      const i=ids.indexOf(id); const j=i+dir;
      if(i<0){ toast('ไม่พบรายการ'); return; }
      if(j<0||j>=ids.length){ toast('สุดรายการแล้ว'); return; }
      const t=ids[i]; ids[i]=ids[j]; ids[j]=t;
      await this.saveOrder(collection, ids);
    }catch(err){ console.error(err); toast('เลื่อนไม่สำเร็จ: '+(err.message||err)); }
  },
  async moveCat(id, dir){ await this.moveGeneric('categories', id, dir); },
  editCat(id){ const c=this.cats.find(x=>x.id===id); if(!c)return; document.getElementById('catId').value=c.id; document.getElementById('catName').value=c.name; document.getElementById('catOrder').value=c.order||1; this.shopTab('cat'); setTimeout(()=>this.scrollToForm('catName'),30); setTimeout(()=>this.scrollToForm('catName'),150); },
  async saveCat(){
    const id=document.getElementById('catId').value||('c_'+uid());
    const name=document.getElementById('catName').value.trim();
    const order=Number(document.getElementById('catOrder').value)||1;
    if(!name){toast('ใส่ชื่อหมวด');return}
    await shopRef.collection('categories').doc(id).set({id,name,order,isActive:true},{merge:true});
    toast('บันทึกหมวดแล้ว'); this.renderCatAdmin();
  },
  async closeCat(id){ if(!confirm('ปิดหมวดนี้? (เปิดใหม่ได้)'))return; await shopRef.collection('categories').doc(id).update({isActive:false}); toast('ปิดหมวดแล้ว'); this.renderCatAdmin(); },
  async reopenCat(id){ await shopRef.collection('categories').doc(id).update({isActive:true}); toast('เปิดหมวดแล้ว'); this.renderCatAdmin(); },
  async deleteCat(id){
    if(!confirm('ปิดหมวดนี้? (ไม่ลบถาวร)')) return;
    await shopRef.collection('categories').doc(id).update({ isActive:false, updatedAt:Date.now() });
    toast('ปิดหมวดแล้ว'); this.renderCatAdmin();
  },

  async renderTopAdmin(){
    const snap=await shopRef.collection('toppings').get();
    this.tops=snap.docs.map(d=>({id:d.id,...d.data()}));
    document.getElementById('catalogFormTop').innerHTML=`
      <h3>ท็อปปิ้ง</h3>
      <input type="hidden" id="topId">
      <label class="lbl">ชื่อ</label><input id="topName">
      <label class="lbl">ราคา / ชิ้น</label><input id="topPrice" type="number" min="0" value="10">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
        <button class="btn btn-p" onclick="M.saveTop()">บันทึก</button>
        <button class="btn btn-o" onclick="document.getElementById('topId').value='';document.getElementById('topName').value=''">ล้าง</button>
      </div>`;
    const tops=[...this.tops].sort((a,b)=>(a.order||0)-(b.order||0));
    document.getElementById('catalogListTop').innerHTML=`<p style="font-size:12px;color:#777;margin-bottom:8px">↑↓ หรือลาก ⋮⋮ จัดลำดับ</p>`+(tops.map(t=>`
      <div class="list-item" draggable="true" data-id="${esc(t.id)}" data-col="toppings" ondragstart="M.dragStart(event)" ondragover="M.dragOver(event)" ondrop="M.dropGeneric(event,'toppings')" ondragend="M.dragEnd(event)">
        <span class="grip">⋮⋮</span>
        <div class="meta"><div class="name">${esc(t.name)}</div><div class="sub">${money(t.price)}${t.isActive===false?' · ปิด':''}</div></div>
        <div class="acts">
          <button class="btn btn-o btn-sm" onclick="event.stopPropagation();M.moveGeneric('toppings','${esc(t.id)}',-1)">↑</button>
          <button class="btn btn-o btn-sm" onclick="event.stopPropagation();M.moveGeneric('toppings','${esc(t.id)}',1)">↓</button>
          <button class="btn btn-o btn-sm" onclick="M.editTop('${esc(t.id)}')">แก้</button>
          ${t.isActive===false
            ? `<button class="btn btn-g btn-sm" onclick="M.reopenTop('${esc(t.id)}')">เปิด</button>`
            : `<button class="btn btn-o btn-sm" onclick="M.closeTop('${esc(t.id)}')">ปิด</button>`}
          <button class="btn btn-d btn-sm" onclick="M.deleteTop('${esc(t.id)}')">ลบ</button>
        </div>
      </div>`).join('')||'<div style="color:#888">ยังไม่มี</div>');
  },
  editTop(id){ const t=this.tops.find(x=>x.id===id); if(!t)return; document.getElementById('topId').value=t.id; document.getElementById('topName').value=t.name; document.getElementById('topPrice').value=t.price; this.shopTab('top'); this.scrollToForm('topName'); },
  async saveTop(){
    const id=document.getElementById('topId').value||('t_'+uid());
    const name=document.getElementById('topName').value.trim();
    const price=Number(document.getElementById('topPrice').value);
    if(!name){toast('ใส่ชื่อ');return} if(isNaN(price)||price<0){toast('ราคาไม่ถูกต้อง');return}
    const prevT=this.tops.find(x=>x.id===id); const maxT=this.tops.reduce((m,x)=>Math.max(m,Number(x.order)||0),0);
    await shopRef.collection('toppings').doc(id).set({id,name,price,isActive:true,order:prevT&&prevT.order!=null?prevT.order:maxT+1},{merge:true});
    toast('บันทึกท็อปปิ้งแล้ว'); this.renderTopAdmin();
  },
  async closeTop(id){ if(!confirm('ปิดท็อปปิ้งนี้?'))return; await shopRef.collection('toppings').doc(id).update({isActive:false}); toast('ปิดแล้ว'); this.renderTopAdmin(); },
  async reopenTop(id){ await shopRef.collection('toppings').doc(id).update({isActive:true}); toast('เปิดแล้ว'); this.renderTopAdmin(); },
  async deleteTop(id){
    if(!confirm('ปิดท็อปปิ้งนี้? (ไม่ลบถาวร)')) return;
    await shopRef.collection('toppings').doc(id).update({ isActive:false, updatedAt:Date.now() });
    toast('ปิดท็อปปิ้งแล้ว'); this.renderTopAdmin();
  },

  async renderSpiceAdmin(){
    const snap=await shopRef.collection('spiceLevels').get();
    this.spice=snap.docs.map(d=>({id:d.id,...d.data()}));
    document.getElementById('catalogFormSpice').innerHTML=`
      <h3>ระดับความเผ็ด</h3>
      <input type="hidden" id="spiceId">
      <label class="lbl">ชื่อ</label><input id="spiceName">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
        <button class="btn btn-p" onclick="M.saveSpice()">บันทึก</button>
        <button class="btn btn-o" onclick="document.getElementById('spiceId').value='';document.getElementById('spiceName').value=''">ล้าง</button>
      </div>`;
    const spices=[...this.spice].sort((a,b)=>(a.order||0)-(b.order||0));
    document.getElementById('catalogListSpice').innerHTML=`<p style="font-size:12px;color:#777;margin-bottom:8px">↑↓ หรือลาก ⋮⋮ จัดลำดับ</p>`+(spices.map(s=>`
      <div class="list-item" draggable="true" data-id="${esc(s.id)}" data-col="spiceLevels" ondragstart="M.dragStart(event)" ondragover="M.dragOver(event)" ondrop="M.dropGeneric(event,'spiceLevels')" ondragend="M.dragEnd(event)">
        <span class="grip">⋮⋮</span>
        <div class="meta"><div class="name">${esc(s.name)}</div><div class="sub">${s.isActive===false?'ปิด':'ใช้งาน'}</div></div>
        <div class="acts">
          <button class="btn btn-o btn-sm" onclick="event.stopPropagation();M.moveGeneric('spiceLevels','${esc(s.id)}',-1)">↑</button>
          <button class="btn btn-o btn-sm" onclick="event.stopPropagation();M.moveGeneric('spiceLevels','${esc(s.id)}',1)">↓</button>
          <button class="btn btn-o btn-sm" onclick="M.editSpice('${esc(s.id)}')">แก้</button>
          ${s.isActive===false
            ? `<button class="btn btn-g btn-sm" onclick="M.reopenSpice('${esc(s.id)}')">เปิด</button>`
            : `<button class="btn btn-o btn-sm" onclick="M.closeSpice('${esc(s.id)}')">ปิด</button>`}
          <button class="btn btn-d btn-sm" onclick="M.deleteSpice('${esc(s.id)}')">ลบ</button>
        </div>
      </div>`).join('')||'<div style="color:#888">ยังไม่มี</div>');
  },
  editSpice(id){ const s=this.spice.find(x=>x.id===id); if(!s)return; document.getElementById('spiceId').value=s.id; document.getElementById('spiceName').value=s.name; this.shopTab('spice'); setTimeout(()=>this.scrollToForm('spiceName'),30); setTimeout(()=>this.scrollToForm('spiceName'),150); },
  async saveSpice(){
    const id=document.getElementById('spiceId').value||('s_'+uid());
    const name=document.getElementById('spiceName').value.trim();
    if(!name){toast('ใส่ชื่อ');return}
    const prevS=this.spice.find(x=>x.id===id); const maxS=this.spice.reduce((m,x)=>Math.max(m,Number(x.order)||0),0);
    await shopRef.collection('spiceLevels').doc(id).set({id,name,isActive:true,order:prevS&&prevS.order!=null?prevS.order:maxS+1},{merge:true});
    toast('บันทึกแล้ว'); this.renderSpiceAdmin();
  },
  async closeSpice(id){ if(!confirm('ปิดรายการนี้?'))return; await shopRef.collection('spiceLevels').doc(id).update({isActive:false}); toast('ปิดแล้ว'); this.renderSpiceAdmin(); },
  async reopenSpice(id){ await shopRef.collection('spiceLevels').doc(id).update({isActive:true}); toast('เปิดแล้ว'); this.renderSpiceAdmin(); },
  async deleteSpice(id){
    if(!confirm('ปิดระดับเผ็ดนี้? (ไม่ลบถาวร)')) return;
    await shopRef.collection('spiceLevels').doc(id).update({ isActive:false, updatedAt:Date.now() });
    toast('ปิดระดับเผ็ดแล้ว'); this.renderSpiceAdmin();
  },

  loadOptionConfigUI(){
    shopRef.collection('settings').doc('public').get().then(snap=>{
      const d=snap.exists?snap.data():{};
      const oc=d.optionConfig||{};
      const sm=document.getElementById('setSpiceMode'); if(sm) sm.value=oc.spiceMode||'single';
      const tm=document.getElementById('setTopMode'); if(tm) tm.value=oc.toppingMode||'multi';
      const tq=document.getElementById('setTopQty'); if(tq) tq.value=(oc.toppingAllowQty===false?'no':'yes');
    });
  },
  togglePayTypeUI(){
    const t=document.getElementById('setPayType')?.value||'kshop';
    document.getElementById('payPromptpayBox')?.classList.toggle('hide', t!=='promptpay');
    document.getElementById('payMerchantBox')?.classList.toggle('hide', t==='promptpay');
  },
  async loadSettingsUI(){
    const snap=await shopRef.collection('settings').doc('public').get();
    const d=snap.exists?snap.data():{};
    document.getElementById('setName').value=d.shopName||'';
    this.applyShopOpenUI(d.isOpen!==false);
    this.applyMemberSystemUI(d.memberSystemEnabled!==false);
    this.applyOrderModeUI((d.orderMode==='table' || d.orderMode==='auto') ? d.orderMode : 'queue');
    this.tableCount=Number(d.tableCount||10);
    const tc=document.getElementById('setTableCount'); if(tc) tc.value=String(this.tableCount);
    if(this.orderMode==='table' || this.orderMode==='auto'){ try{ this.renderTableQrList(); }catch(e){} }
    document.getElementById('setAccount').value=d.accountName||'นาย นรากร วงค์แก่นท้าว';
    document.getElementById('setPP').value=d.promptpay||'1319900156353';
    const payType=d.payType||'kshop';
    const pt=document.getElementById('setPayType'); if(pt) pt.value=payType;
    const mid=document.getElementById('setMerchantId'); if(mid) mid.value=d.merchantId||'EMPKB000002198793001';
    const kp=document.getElementById('setKshopPayload'); if(kp) kp.value=d.kshopPayload||'';
    this.togglePayTypeUI();
    const cu=new URL('index.html', location.href).href;
    document.getElementById('qrUrl').textContent=cu;
    const shopEl=document.getElementById('qrShopLabel');
    if(shopEl) shopEl.textContent=document.getElementById('shopTitle')?.textContent||this.shopName||'ร้าน';
    const box=document.getElementById('qrBox');
    if(box){ box.innerHTML=''; new QRCode(box,{text:cu,width:200,height:200}); }
  },
  async saveOptionConfig(){
    const optionConfig={
      spiceMode: document.getElementById('setSpiceMode').value,
      toppingMode: document.getElementById('setTopMode').value,
      toppingAllowQty: document.getElementById('setTopQty').value==='yes'
    };
    await shopRef.collection('settings').doc('public').set({ optionConfig },{merge:true});
    toast('บันทึกโหมดตัวเลือกแล้ว');
  },
  async saveSettings(){
    const name=document.getElementById('setName').value.trim();
    const accountName=document.getElementById('setAccount').value.trim();
    const payType=document.getElementById('setPayType')?.value||'kshop';
    const pp=(document.getElementById('setPP')?.value||'').replace(/\D/g,'');
    const merchantId=(document.getElementById('setMerchantId')?.value||'').trim();
    const kshopPayload=(document.getElementById('setKshopPayload')?.value||'').trim();
    if(!name){toast('ใส่ชื่อร้าน');return}
    if(payType==='promptpay' && pp && pp.length!==10 && pp.length!==13){toast('PromptPay ต้อง 10 หรือ 13 หลัก');return}
    if((payType==='merchant'||payType==='kshop') && !merchantId && !kshopPayload){toast('ใส่เลขอ้างอิง K Shop');return}
    const data={shopName:name, accountName, payType};
    if(pp) data.promptpay=pp;
    if(merchantId) data.merchantId=merchantId;
    if(kshopPayload) data.kshopPayload=kshopPayload;
    else if(payType==='kshop') data.kshopPayload=window.KSHOP_QR_PAYLOAD||'';
    await shopRef.collection('settings').doc('public').set(data,{merge:true});
    await shopRef.collection('settings').doc('config').set(data,{merge:true});
    toast('บันทึกแล้ว'); this.loadSettingsUI();
  },
  async changePin(){
    const old=document.getElementById('setPinOld').value.trim();
    const p1=document.getElementById('setPin1').value.trim();
    const p2=document.getElementById('setPin2').value.trim();
    if(!/^\d{4,8}$/.test(p1)){toast('PIN ใหม่ต้อง 4–8 ตัวเลข');return}
    if(p1!==p2){toast('PIN ใหม่ไม่ตรงกัน');return}
    if(p1==='1234'){toast('ห้ามใช้ PIN เริ่มต้น 1234 — ตั้งเลขอื่น');return}
    const sec=await shopRef.collection('settings').doc('secure').get();
    const hash=sec.exists?sec.data().pinHash:'';
    if(hash && await sha256(old)!==hash){toast('PIN ปัจจุบันไม่ถูกต้อง');return}
    await shopRef.collection('settings').doc('secure').set({
      pinHash: await sha256(p1),
      mustChangePin: false,
      pinChangedAt: Date.now()
    },{merge:true});
    document.getElementById('setPinOld').value=''; document.getElementById('setPin1').value=''; document.getElementById('setPin2').value='';
    toast('เปลี่ยน PIN แล้ว');
  },

  installApp(){
    var p=window.deferredPwaPrompt;
    if(!p){ toast('Chrome: เมนู ⋮ → ติดตั้งแอป / เพิ่มไปยังหน้าจอหลัก'); return; }
    p.prompt();
    p.userChoice.then(function(){ window.deferredPwaPrompt=null; var b=document.getElementById('btnInstallApp'); if(b) b.style.display='none'; });
  },

  /** ดึง dataURL ของ QR จาก #qrBox (canvas หรือ img) */
  getCustomerQRDataUrl(){
    const box=document.getElementById('qrBox');
    if(!box) return '';
    const canvas=box.querySelector('canvas');
    if(canvas) try{ return canvas.toDataURL('image/png'); }catch(e){}
    const img=box.querySelector('img');
    if(img && img.src) return img.src;
    return '';
  },
  /** วาดโปสเตอร์ QR สวย ๆ ลง canvas แล้วคืน dataURL */
  async buildCustomerQRPoster(){
    const cu=document.getElementById('qrUrl')?.textContent||new URL('index.html', location.href).href;
    const name=(document.getElementById('shopTitle')?.textContent||this.shopName||'ร้าน').trim();
    const title='QR สำหรับสแกนสั่งอาหาร';
    const footer1='หลังจากยืนยันสั่งอาหารแล้ว';
    const footer2='โปรดจำหรือจดหมายเลขคิวของท่านไว้';

    // รอ QR พร้อม
    let qrUrl=this.getCustomerQRDataUrl();
    if(!qrUrl){
      const box=document.getElementById('qrBox');
      if(box){ box.innerHTML=''; new QRCode(box,{text:cu,width:200,height:200}); }
      await new Promise(r=>setTimeout(r,200));
      qrUrl=this.getCustomerQRDataUrl();
    }
    const qrImg=await new Promise((resolve,reject)=>{
      if(!qrUrl) return reject(new Error('no qr'));
      const im=new Image();
      im.onload=()=>resolve(im);
      im.onerror=()=>reject(new Error('qr load'));
      im.src=qrUrl;
    });

    const W=720, H=960;
    const canvas=document.createElement('canvas');
    canvas.width=W; canvas.height=H;
    const ctx=canvas.getContext('2d');

    // พื้นหลัง
    const bg=ctx.createLinearGradient(0,0,0,H);
    bg.addColorStop(0,'#ffffff');
    bg.addColorStop(1,'#FFF5F0');
    ctx.fillStyle=bg;
    ctx.fillRect(0,0,W,H);

    // กรอบนอก
    ctx.strokeStyle='#FF5722';
    ctx.lineWidth=14;
    roundRect(ctx, 24, 24, W-48, H-48, 36);
    ctx.stroke();
    // กรอบในบาง
    ctx.strokeStyle='#FFCCBC';
    ctx.lineWidth=3;
    roundRect(ctx, 48, 48, W-96, H-96, 28);
    ctx.stroke();

    // หัวข้อ
    ctx.fillStyle='#FF5722';
    ctx.font='800 36px "Segoe UI", Tahoma, sans-serif';
    ctx.textAlign='center';
    ctx.fillText(title, W/2, 130);

    // ชื่อร้าน
    ctx.fillStyle='#222';
    ctx.font='800 44px "Segoe UI", Tahoma, sans-serif';
    fitText(ctx, name, W/2, 200, W-120, 44);

    // กล่อง QR
    const qSize=420;
    const qx=(W-qSize)/2, qy=250;
    ctx.fillStyle='#fff';
    roundRect(ctx, qx-16, qy-16, qSize+32, qSize+32, 20);
    ctx.fill();
    ctx.strokeStyle='#FFE0D6';
    ctx.lineWidth=4;
    roundRect(ctx, qx-16, qy-16, qSize+32, qSize+32, 20);
    ctx.stroke();
    ctx.drawImage(qrImg, qx, qy, qSize, qSize);

    // ข้อความท้าย
    ctx.fillStyle='#444';
    ctx.font='600 28px "Segoe UI", Tahoma, sans-serif';
    ctx.fillText(footer1, W/2, 740);
    ctx.fillText(footer2, W/2, 780);

    // เส้นคั่นเล็ก
    ctx.strokeStyle='#FFCCBC';
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(W/2-80, 800);
    ctx.lineTo(W/2+80, 800);
    ctx.stroke();

    ctx.fillStyle='#999';
    ctx.font='400 18px "Segoe UI", Tahoma, sans-serif';
    const short=cu.length>48?cu.slice(0,48)+'…':cu;
    ctx.fillText(short, W/2, 840);

    return canvas.toDataURL('image/png');

    function roundRect(ctx,x,y,w,h,r){
      ctx.beginPath();
      ctx.moveTo(x+r,y);
      ctx.arcTo(x+w,y,x+w,y+h,r);
      ctx.arcTo(x+w,y+h,x,y+h,r);
      ctx.arcTo(x,y+h,x,y,r);
      ctx.arcTo(x,y,x+w,y,r);
      ctx.closePath();
    }
    function fitText(ctx,text,x,y,maxW,size){
      let s=size;
      ctx.font='800 '+s+'px "Segoe UI", Tahoma, sans-serif';
      while(s>22 && ctx.measureText(text).width>maxW){
        s-=2;
        ctx.font='800 '+s+'px "Segoe UI", Tahoma, sans-serif';
      }
      ctx.fillText(text,x,y);
    }
  },
  async downloadCustomerQR(){
    try{
      toast('กำลังสร้างรูป…');
      const dataUrl=await this.buildCustomerQRPoster();
      const a=document.createElement('a');
      a.href=dataUrl;
      a.download='QR-สั่งอาหาร-'+(document.getElementById('shopTitle')?.textContent||'ร้าน').replace(/\s+/g,'')+'.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('บันทึกรูป QR แล้ว');
    }catch(e){
      console.error(e);
      toast('บันทึกรูปไม่สำเร็จ: '+(e.message||e));
    }
  },
  async printCustomerQR(){
    try{
      toast('กำลังเตรียมพิมพ์…');
      const dataUrl=await this.buildCustomerQRPoster();
      const html='<div style="text-align:center"><img src="'+dataUrl+'" style="width:100%;max-width:480px;margin:0 auto;display:block"></div>';
      this.printHtmlDocument(html, 'QR สั่งอาหาร');
    }catch(e){
      console.error(e);
      toast('พิมพ์ไม่สำเร็จ');
    }
  }
  });
})();
