/**
 * Somtum1POS — catalog / cart / init
 * Auto-split from customer.js (lines 196-732)
 */
/* global C, db, shopRef, esc, money, toast, uid, showErr, sha256, calcPaymentCover, fileToDataUrl, PP, checkConfig, migrateAndSeed, checkOrderRateLimit */
(function () {
  'use strict';
  window.C = window.C || {};
  Object.assign(window.C, {
  shopName:'ร้าน',promptpay:'',accountName:'',payType:'kshop',merchantId:'EMPKB000002198793001',kshopPayload:'',memberSystemEnabled:true,orderMode:'queue',tableNo:null,tableCount:0,optionConfig:{spiceMode:'single',toppingMode:'multi',toppingAllowQty:true},cats:[],menus:[],spice:[],tops:[],
  cat:'all',q:'',cart:[],modal:null,orderId:null,unsub:null,payM:'PROMPTPAY',slipData:'',lastOrder:null,kitchenOrders:[],bestSellerIds:[],bestSellerRank:{},
  isOpen:null,

  async init(){
    const setConn=(t)=>{ try{ document.getElementById('conn').textContent=t; }catch(e){} };
    if(!checkConfig()){ setConn('ยังไม่ตั้งค่า'); return; }
    setConn('กำลังเชื่อมต่อ…');
    try{
      if(typeof firebase==='undefined'){
        setConn('โหลด Firebase ไม่สำเร็จ');
        showErr('โหลดไลบรารี Firebase ไม่ได้ — ตรวจเน็ตแล้วรีเฟรช');
        return;
      }
      // กัน initialize ซ้ำ (PWA / เปิดซ้ำ)
      if(!firebase.apps || !firebase.apps.length){
        firebase.initializeApp(window.FIREBASE_CONFIG);
      }
      try{
        const host=String(location.hostname||'');
        const appCheckOk=/github\.io$/i.test(host);
        if(appCheckOk && window.FIREBASE_APPCHECK_SITE_KEY && firebase.appCheck){
          const appCheck=firebase.appCheck();
          // รองรับทั้ง string key (compat) และ ReCaptchaV3Provider
          if(firebase.appCheck.ReCaptchaV3Provider){
            appCheck.activate(new firebase.appCheck.ReCaptchaV3Provider(window.FIREBASE_APPCHECK_SITE_KEY), true);
          }else{
            appCheck.activate(window.FIREBASE_APPCHECK_SITE_KEY, true);
          }
        }
      }catch(e){ console.warn('AppCheck', e); }
      db=firebase.firestore();
      // อย่า await persistence — บนมือถือมักค้าง ทำให้หน้าค้างที่กำลังเชื่อมต่อ
      try{ db.enablePersistence({synchronizeTabs:true}).catch(function(){}); }catch(e){}
      shopRef=db.collection('shops').doc(window.SHOP_ID||'main');
      setConn('เชื่อมต่อแล้ว');
      try{
        this.tableNo=this.parseTableFromUrl();
        if(this.tableNo) this.applyOrderModeCustomerUI();
      }catch(e){}
      // seed คิว + แก้สะกดบัญชี — ไม่ seed แคตตาล็อกจากหน้าลูกค้า (กันเขียนทับร้าน)
      try{ await Promise.race([migrateAndSeed(), new Promise(function(r){setTimeout(r,5000);})]); }catch(e){ console.warn('seed',e); }
      shopRef.collection('settings').doc('public').onSnapshot(s=>{
        const d=s.data()||{};
        this.shopName=d.shopName||'ส้มตำนายหนึ่ง';
        this.promptpay=d.promptpay||'1319900156353';
        this.accountName=d.accountName||'';
        this.payType=d.payType||'kshop';
        this.merchantId=d.merchantId||'EMPKB000002198793001';
        this.kshopPayload=d.kshopPayload||window.KSHOP_QR_PAYLOAD||'';
        if(d.optionConfig) this.optionConfig=Object.assign({spiceMode:'single',toppingMode:'multi',toppingAllowQty:true}, d.optionConfig);
        const sn=document.getElementById('shopName'); if(sn) sn.textContent=this.shopName;
        document.title=this.shopName+' | สั่งอาหาร';
        this.setShopOpenState(d.isOpen!==false);
        // ระบบสมาชิกบนหน้าลูกค้า (default เปิด เพื่อไม่พังร้านเดิม)
        this.applyMemberSystemState(d.memberSystemEnabled!==false);
        const configuredMode = (d.orderMode==='table' || d.orderMode==='auto') ? d.orderMode : 'queue';
        // Auto: QR โต๊ะ (?table=N) => โต๊ะ, QR คิว (URL ปกติ) => คิว
        this.orderMode = configuredMode==='auto' ? (this.parseTableFromUrl() ? 'table' : 'queue') : configuredMode;
        this.configuredOrderMode = configuredMode;
        this.tableCount = Number(d.tableCount||0);
        try{ this.applyOrderModeCustomerUI(); }catch(e){}
      });
      const bindCol=(name, assign)=>{
        shopRef.collection(name).onSnapshot(s=>{
          assign(s.docs.map(d=>({id:d.id,...d.data()})));
        }, err=>{
          console.error(name, err);
          showErr('โหลด '+name+' ไม่สำเร็จ: '+(err.message||err));
        });
      };
      bindCol('categories', list=>{ this.cats=list; this.renderCats(); });
      bindCol('menus', list=>{ this.menus=list; this.renderMenus(); });
      this.loadBestSellers();
      bindCol('spiceLevels', list=>{ this.spice=list.slice().sort((a,b)=>(a.order||0)-(b.order||0)); });
      bindCol('toppings', list=>{ this.tops=list.slice().sort((a,b)=>(a.order||0)-(b.order||0)); });
      // ถ้า 4 วินาทียังไม่มีเมนู ลอง get ตรง ๆ ครั้งเดียว
      setTimeout(async()=>{
        try{
          if((this.menus||[]).length) return;
          const ms=await shopRef.collection('menus').get();
          this.menus=ms.docs.map(d=>({id:d.id,...d.data()}));
          const cs=await shopRef.collection('categories').get();
          this.cats=cs.docs.map(d=>({id:d.id,...d.data()}));
          this.renderCats(); this.renderMenus();
          if(!this.menus.length){
            const el=document.getElementById('menus');
            if(el) el.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:40px;color:#999">ยังไม่มีเมนู — ร้านเข้า POS เพื่อเพิ่มเมนู หรือรีเฟรชหน้านี้</div>';
          }
        }catch(e){ console.warn('fallback get', e); }
      }, 4000);
      this.startKitchenWatch();
      // กู้ตั๋วคิวหลังรีเฟรช (ถ้ายังไม่จบ)
      try{ await this.restoreLastOrder(); }catch(e){ console.warn('restore', e); }
      const u=new URL(location.href); const q=u.searchParams.get('queue');
      if(q){
        const tq=document.getElementById('trackQ');
        if(tq) tq.value=q;
        this.trackQueue();
      }
    }catch(e){console.error(e);try{showErr('เริ่มระบบไม่สำเร็จ: '+(e.message||e));}catch(x){} try{const c=document.getElementById('conn'); if(c) c.textContent='ผิดพลาด';}catch(x){}}
  },
  installApp(){
    var p=window.deferredPwaPrompt;
    if(!p){ toast('Chrome: เมนู ⋮ → ติดตั้งแอป (เปิดผ่านลิงก์ GitHub Pages)'); return; }
    p.prompt();
    p.userChoice.then(function(){ window.deferredPwaPrompt=null; var b=document.getElementById('btnInstallApp'); if(b) b.style.display='none'; });
  },
  show(id){const el=document.getElementById(id); if(el) el.classList.add('on');},
  hide(id){const el=document.getElementById(id); if(el) el.classList.remove('on');},
  search(v){this.q=(v||'').trim().toLowerCase();this.renderMenus()},
  renderCats(){
    let h=`<button class="chip ${this.cat==='all'?'on':''}" onclick="C.setCat('all')">ทั้งหมด</button>`;
    this.cats.filter(c=>c.isActive!==false).sort((a,b)=>(a.order||0)-(b.order||0)).forEach(c=>{
      h+=`<button class="chip ${this.cat===c.id?'on':''}" onclick="C.setCat('${esc(c.id)}')">${esc(c.name)}</button>`;
    });
    document.getElementById('cats').innerHTML=h;
  },
  setCat(id){this.cat=id;this.renderCats();this.renderMenus()},
  menuImg(m){return m.imageData||m.imageUrl||''},
  async loadBestSellers(){
    try{
      let snap;
      try{ snap=await shopRef.collection('orders').orderBy('createdAt','desc').limit(300).get(); }
      catch(e){ snap=await shopRef.collection('orders').limit(300).get(); }
      const count={};
      snap.docs.forEach(d=>{
        const o=d.data()||{};
        if(o.status==='Cancelled') return;
        if(o.paymentStatus!=='PAID') return;
        (o.items||[]).forEach(it=>{
          const n=it.name||'';
          if(!n) return;
          count[n]=(count[n]||0)+Number(it.qty||1);
        });
      });
      const ranked=Object.entries(count).sort((a,b)=>b[1]-a[1]).slice(0,3);
      this.bestSellerIds=ranked.map(([name])=>name);
      this.bestSellerRank={};
      ranked.forEach(([name],i)=>{ this.bestSellerRank[name]=i+1; });
      this.renderMenus();
    }catch(e){ console.warn('best sellers', e); }
  },
  renderMenus(){
    let list=this.menus.filter(m=>m.isActive!==false&&(this.cat==='all'||m.catId===this.cat));
    if(this.q)list=list.filter(m=>(m.name||'').toLowerCase().includes(this.q));
    // เรียง: ขายดีอันดับ 1-3 ก่อน แล้วตาม order ที่ร้านตั้ง
    list=list.slice().sort((a,b)=>{
      const ra=this.bestSellerRank[a.name]||99, rb=this.bestSellerRank[b.name]||99;
      if(ra!==rb) return ra-rb;
      return (Number(a.order)||0)-(Number(b.order)||0);
    });
    const el=document.getElementById('menus');
    if(!list.length){el.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:40px;color:#999"><div style="font-size:2rem;margin-bottom:8px">📋</div><div>ยังไม่มีเมนู</div><div style="font-size:13px;margin-top:8px">รีเฟรชหน้า หรือให้ร้านเข้า POS แล้วเพิ่มเมนู</div></div>';return}
    el.innerHTML=list.map(m=>{
      const src=this.menuImg(m);
      const img=src?`<img src="${esc(src)}" alt="">`:`<i class="fa-solid fa-utensils"></i>`;
      const rank=this.bestSellerRank[m.name];
      const badge=rank?`<div class="oosb" style="background:linear-gradient(135deg,#FF9800,#FF5722);left:6px;right:auto">🔥 ขายดี #${rank}</div>`:'';
      return `<div class="card ${m.isOut?'oos':''}" onclick="${m.isOut?'':`C.openProduct('${esc(m.id)}')`}">
        ${m.isOut?'<div class="oosb">หมด</div>':''}${badge}<div class="ph">${img}</div>
        <div class="info"><div class="name">${esc(m.name)}</div><div class="price">${money(m.price)}</div></div></div>`;
    }).join('');
  },
  openProduct(id){
    if(this.isOpen===false){ toast('อยู่นอกเวลาทำการ · ขออภัยในความไม่สะดวก'); return; }
    const m=this.menus.find(x=>x.id===id); if(!m||m.isOut)return;
    // หมวด "กินคู่" = ไม่มีตัวเลือกเพิ่ม แค่จำนวน
    const cat=(this.cats||[]).find(c=>c.id===m.catId);
    const catName=(cat&&cat.name)||'';
    const isSimple=/กินคู่|คู่ส้มตำ/.test(catName);
    // tops: {id: qty} · ค่าเริ่มต้นความเผ็ด = เผ็ดกลาง
    const defaultSpiceId=this.getDefaultSpiceId();
    this.modal={menu:m,qty:1,spice:defaultSpiceId,topQty:{},note:'',plara:null,isSimple};
    const pn=document.getElementById('pNote'); if(pn) pn.value='';
    // รองรับ boolean / string / number จาก Firestore
    const enablePlara = (function(v){
      if(v===true || v===1) return true;
      if(typeof v==='string'){ const s=v.trim().toLowerCase(); return s==='true'||s==='1'||s==='yes'||s==='y'; }
      return false;
    })(m.allowPlara);
    const pb=document.getElementById('plaraBox');
    const pl=document.getElementById('plaraList');
    if(pb && pl){
      if(enablePlara){
        pb.style.display='block';
        this.modal.plara='with';
        pl.innerHTML=
          '<label class="rl on" onclick="C.pickPlara(\'with\',this)"><span>ใส่ปลาร้า</span>'+
          '<input type="radio" name="plara" checked style="width:18px;height:18px;accent-color:var(--p)"></label>'+
          '<label class="rl" onclick="C.pickPlara(\'without\',this)"><span>ไม่ใส่ปลาร้า</span>'+
          '<input type="radio" name="plara" style="width:18px;height:18px;accent-color:var(--p)"></label>';
      } else {
        pb.style.display='none';
        pl.innerHTML='';
        this.modal.plara=null;
      }
    }
    document.getElementById('pTitle').textContent=m.name;
    if(isSimple){
      const pb=document.getElementById('plaraBox'); if(pb) pb.style.display='none';
      const sb=document.getElementById('spiceBox'); if(sb) sb.style.display='none';
      const tb=document.getElementById('topBox'); if(tb) tb.style.display='none';
      this.modal.spice=null; this.modal.spiceSet={}; this.modal.topQty={}; this.modal.plara=null;
    }

    const src=this.menuImg(m); const imgBox=document.getElementById('pImg');
    if(src){imgBox.style.display='flex';imgBox.innerHTML=`<img src="${esc(src)}" style="width:100%;height:100%;object-fit:cover">`}
    else{imgBox.style.display='none';imgBox.innerHTML=''}
    const activeSp=this.spice.filter(s=>s.isActive!==false);
    const spiceMulti=(this.optionConfig.spiceMode==='multi');
    if(spiceMulti){
      this.modal.spiceSet={};
      // multi: ติ๊กเผ็ดกลางเป็นค่าเริ่มต้นถ้ามี
      const defId=this.getDefaultSpiceId();
      if(defId) this.modal.spiceSet[defId]=true;
      document.getElementById('spiceList').innerHTML=activeSp.map(s=>{
        const on=!!(defId && String(s.id)===String(defId));
        return `<label class="cl ${on?'on':''}" id="spRow_${esc(s.id)}"><span>${esc(s.name)}</span>
         <input type="checkbox" ${on?'checked':''} style="width:18px;height:18px;accent-color:var(--p)" onchange="C.toggleSpice('${esc(s.id)}',this)"></label>`;
      }).join('');
      this.modal.spice=null;
    } else {
      const defId=this.modal.spice || this.getDefaultSpiceId();
      if(defId) this.modal.spice=defId;
      document.getElementById('spiceList').innerHTML=activeSp.map(s=>{
        const on=String(s.id)===String(defId);
        return `<label class="rl ${on?'on':''}" onclick="C.pickSpice('${esc(s.id)}',this)"><span>${esc(s.name)}</span>
         <input type="radio" name="sp" ${on?'checked':''} style="width:18px;height:18px;accent-color:var(--p)"></label>`;
      }).join('');
    }
    document.getElementById('spiceBox').style.display=(isSimple||!activeSp.length)?'none':(activeSp.length?'block':'none');
    const ot=document.querySelector('#spiceBox .ot');
    if(ot) ot.textContent=spiceMulti?'ระดับความเผ็ด (เลือกได้หลายอย่าง)':'ระดับความเผ็ด *';
    const tops=this.tops.filter(t=>t.isActive!==false);
    const topMulti=(this.optionConfig.toppingMode!=='single');
    const allowQty=this.optionConfig.toppingAllowQty!==false && topMulti;
    const topOt=document.querySelector('#topBox .ot');
    if(topOt) topOt.textContent=topMulti?(allowQty?'ท็อปปิ้ง (หลายอย่าง · กำหนดจำนวนได้)':'ท็อปปิ้ง (เลือกได้หลายอย่าง)'):'ท็อปปิ้ง (เลือกได้ 1 อย่าง)';
    if(!topMulti){
      document.getElementById('topList').innerHTML=tops.map(t=>
        `<label class="rl" onclick="C.pickTopSingle('${esc(t.id)}',this)"><span>${esc(t.name)} <small style="color:#777">(+${money(t.price)})</small></span>
         <input type="radio" name="top1" style="width:18px;height:18px;accent-color:var(--p)"></label>`).join('');
    } else if(allowQty){
      document.getElementById('topList').innerHTML=tops.map(t=>`
      <div class="cl" id="topRow_${esc(t.id)}">
        <div class="top-row">
          <div><strong>${esc(t.name)}</strong><div style="font-size:12px;color:#777">+${money(t.price)} / ชิ้น</div></div>
          <div class="top-qty">
            <button class="qb" style="width:28px;height:28px;font-size:14px" onclick="event.preventDefault();C.topQty('${esc(t.id)}',-1)">−</button>
            <span id="tq_${esc(t.id)}" style="min-width:20px;text-align:center;font-weight:700">0</span>
            <button class="qb" style="width:28px;height:28px;font-size:14px" onclick="event.preventDefault();C.topQty('${esc(t.id)}',1)">+</button>
          </div>
        </div>
      </div>`).join('');
    } else {
      document.getElementById('topList').innerHTML=tops.map(t=>
        `<label class="cl" id="topRow_${esc(t.id)}"><span>${esc(t.name)} <small style="color:#777">(+${money(t.price)})</small></span>
         <input type="checkbox" style="width:18px;height:18px;accent-color:var(--p)" onchange="C.toggleTopChk('${esc(t.id)}',this)"></label>`).join('');
    }
    document.getElementById('topBox').style.display=(isSimple||!tops.length)?'none':'block';
    this.updPrice(); this.show('mProduct');
    // ทุกครั้งที่เปิดเมนูใหม่: เลื่อนไปส่วนเลือกระดับความเผ็ดก่อน
    try{ this.scrollProductToSpice(); }catch(e){}
  },
  /** ค่าเริ่มต้นความเผ็ด = เผ็ดกลาง (ชื่อ/ id s3 / order 3) */
  getDefaultSpiceId(){
    const active=(this.spice||[]).filter(s=>s && s.isActive!==false);
    if(!active.length) return null;
    const byName=active.find(s=>/เผ็ดกลาง|กลาง/.test(String(s.name||'')));
    if(byName) return byName.id;
    const byId=active.find(s=>String(s.id)==='s3' || String(s.id).toLowerCase()==='medium');
    if(byId) return byId.id;
    const byOrder=active.find(s=>Number(s.order)===3);
    if(byOrder) return byOrder.id;
    // fallback: ตัวกลางของรายการ
    return active[Math.min(Math.floor(active.length/2), active.length-1)].id;
  },
  /** เลื่อน modal เมนูไปที่กล่องระดับความเผ็ด */
  scrollProductToSpice(){
    const modal=document.querySelector('#mProduct .md');
    const spice=document.getElementById('spiceBox');
    if(modal){
      try{ modal.scrollTop=0; }catch(e){}
    }
    // รอ paint แล้วเลื่อนให้เห็นตัวเลือกระดับเผ็ดชัดเจน
    const go=()=>{
      try{
        if(spice && spice.style.display!=='none'){
          spice.scrollIntoView({behavior:'smooth', block:'start', inline:'nearest'});
        } else if(modal){
          modal.scrollTop=0;
        }
      }catch(e){
        try{ if(modal) modal.scrollTop=0; }catch(e2){}
      }
    };
    setTimeout(go, 50);
    setTimeout(go, 200);
  },
  pickPlara(v,el){
    this.modal.plara=v;
    document.querySelectorAll('#plaraList .rl').forEach(x=>x.classList.remove('on'));
    el.classList.add('on');
  },
  pickSpice(id,el){this.modal.spice=id;document.querySelectorAll('#spiceList .rl').forEach(x=>x.classList.remove('on'));el.classList.add('on')},
  toggleSpice(id,el){
    if(!this.modal.spiceSet) this.modal.spiceSet={};
    if(el.checked) this.modal.spiceSet[id]=true; else delete this.modal.spiceSet[id];
    el.closest('.cl').classList.toggle('on', el.checked);
  },
  pickTopSingle(id,el){
    this.modal.topQty={}; this.modal.topQty[id]=1;
    document.querySelectorAll('#topList .rl').forEach(x=>x.classList.remove('on'));
    el.classList.add('on'); this.updPrice();
  },
  toggleTopChk(id,el){
    if(el.checked) this.modal.topQty[id]=1; else delete this.modal.topQty[id];
    el.closest('.cl').classList.toggle('on', el.checked); this.updPrice();
  },
  topQty(id,d){
    const cur=this.modal.topQty[id]||0;
    const n=Math.min(20,Math.max(0,cur+d));
    if(n===0) delete this.modal.topQty[id]; else this.modal.topQty[id]=n;
    document.getElementById('tq_'+id).textContent=n;
    document.getElementById('topRow_'+id).classList.toggle('on',n>0);
    this.updPrice();
  },
  qty(d){this.modal.qty=Math.min(99,Math.max(1,this.modal.qty+d));this.updPrice()},
  calcUnit(){
    const p=this.modal; let tp=0;
    Object.entries(p.topQty||{}).forEach(([id,q])=>{
      const t=this.tops.find(x=>x.id===id); if(t) tp+=Number(t.price)*Number(q);
    });
    return Number(p.menu.price)+tp;
  },
  updPrice(){
    const p=this.modal; document.getElementById('pQty').textContent=p.qty;
    const u=this.calcUnit();
    document.getElementById('pPrice').textContent=money(u);
    document.getElementById('pTotal').textContent=money(u*p.qty);
  },
  addCart(){
    if(!this.assertShopOpen()) return;
    const p=this.modal;
    let spiceName='';
    if(p.isSimple){
      spiceName='';
    } else if(this.optionConfig.spiceMode==='multi'){
      spiceName=Object.keys(p.spiceSet||{}).map(id=>(this.spice.find(s=>s.id===id)||{}).name).filter(Boolean).join(', ');
      if(this.spice.filter(s=>s.isActive!==false).length && !spiceName){toast('เลือกระดับความเผ็ด');return}
    } else {
      if(this.spice.filter(s=>s.isActive!==false).length && !p.spice){toast('เลือกระดับความเผ็ด');return}
      spiceName=(this.spice.find(s=>s.id===p.spice)||{}).name||'';
    }
    const toppings=[];
    if(!p.isSimple){
      Object.entries(p.topQty||{}).forEach(([id,q])=>{
        const t=this.tops.find(x=>x.id===id);
        if(t&&q>0) toppings.push({id:t.id,name:t.name,price:Number(t.price),qty:Number(q),total:Number(t.price)*Number(q)});
      });
    }
    const unit=this.calcUnit();
    const note=(document.getElementById('pNote')?.value||'').trim();
    const needPlara=!p.isSimple && (function(v){
      if(v===true || v===1) return true;
      if(typeof v==='string'){ const s=v.trim().toLowerCase(); return s==='true'||s==='1'||s==='yes'||s==='y'; }
      return false;
    })(p.menu.allowPlara);
    if(needPlara && !p.plara){ toast('เลือกใส่หรือไม่ใส่ปลาร้า'); return; }
    const plaraLabel=needPlara?(p.plara==='with'?'ใส่ปลาร้า':'ไม่ใส่ปลาร้า'):'';
    const cat=(this.cats||[]).find(c=>c.id===p.menu.catId);
    this.cart.push({
      name:p.menu.name, qty:p.qty, spiceName,
      toppings, note, plara:plaraLabel, unitPrice:unit, total:unit*p.qty,
      catId:p.menu.catId||'', catName:(cat&&cat.name)||''
    });
    this.hide('mProduct'); this.updFab(); toast('เพิ่มลงตะกร้าแล้ว');
    try{
      window.scrollTo({top:0,behavior:'smooth'});
      const topEl=document.getElementById('menuSearch')||document.getElementById('catTabs')||document.querySelector('header')||document.body;
      if(topEl && topEl.scrollIntoView) topEl.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(e){}
  },
  updFab(){
    const c=(this.cart||[]).reduce((s,i)=>s+Number(i.qty||0),0);
    const t=(this.cart||[]).reduce((s,i)=>s+Number(i.total||0),0);
    const fab=document.getElementById('fab');
    if(!fab) return;
    const hasActive=!!(this.orderId && this.lastOrder &&
      this.lastOrder.status!=='Cancelled' && this.lastOrder.status!=='Completed' &&
      (this.orderMode!=='table' || Number(this.lastOrder.tableNo)===Number(this.tableNo)));
    if(c){
      fab.style.display='flex';
      const fc=document.getElementById('fabCount'); if(fc) fc.textContent=c+' รายการ';
      const ft=document.getElementById('fabTotal'); if(ft) ft.textContent=money(t);
    } else if(hasActive){
      // ตะกร้าว่างแต่มีคิวยังไม่จบ → ปุ่มลัดดูตั๋ว
      fab.style.display='flex';
      const fc=document.getElementById('fabCount'); if(fc) fc.textContent='คิว '+(this.lastOrder.queue||'');
      const ft=document.getElementById('fabTotal'); if(ft) ft.textContent='ดูตั๋ว';
    } else {
      fab.style.display='none';
    }
  },
  renderCart(){
    try{
      this.cart = this.cart || [];
      this.updFab();
      const el=document.getElementById('cartList');
      if(!el) return;
      if(!this.cart.length){
        el.innerHTML='<div style="text-align:center;color:#999;padding:20px">ตะกร้าว่าง</div>';
        const sum=document.getElementById('cartSum'); if(sum) sum.textContent=money(0);
        return;
      }
      el.innerHTML=this.cart.map((i,idx)=>{
        const tops=(i.toppings||[]).map(t=>`${esc(t.name)} x${t.qty} (${money(t.total)})`).join(', ');
        const meta=[i.spiceName, i.plara, tops, i.note?('หมายเหตุ: '+esc(i.note)):''].filter(Boolean).join(' · ');
        return `<div class="ci"><div><div style="font-weight:600">${esc(i.name)} × ${i.qty}</div>
          ${meta?`<div style="font-size:13px;color:#777">${meta}</div>`:''}
          <button style="color:var(--d);font-size:13px;margin-top:4px" onclick="C.rmCart(${idx})">ลบ</button></div>
          <div style="font-weight:600">${money(i.total)}</div></div>`;
      }).join('');
      const sum=document.getElementById('cartSum');
      if(sum) sum.textContent=money(this.cart.reduce((s,i)=>s+Number(i.total||0),0));
    }catch(e){ console.warn('renderCart', e); }
  },
  openCart(){
    const el=document.getElementById('cartList');
    if(!el) return;
    // มีคิวยังไม่จบ + ตะกร้าว่าง → เปิดตั๋ว (เฉพาะโต๊ะที่สแกนหรือโหมดคิว)
    if((!this.cart || !this.cart.length) && this.orderId && this.lastOrder &&
        this.lastOrder.status!=='Cancelled' && this.lastOrder.status!=='Completed'){
      if(this.orderMode==='table'){
        if(Number(this.lastOrder.tableNo)!==Number(this.tableNo)){
          try{ this.clearOrderState(); }catch(e){}
          // โหลดตั๋วของโต๊ะที่สแกนอยู่
          this.restoreTableOrderIfAny().then(()=>{
            if(this.lastOrder && Number(this.lastOrder.tableNo)===Number(this.tableNo)){
              this.renderTicket(this.lastOrder);
              this.show('mTicket');
            } else {
              toast('โต๊ะ '+(this.tableNo||'')+' ยังไม่มีออเดอร์');
            }
          }).catch(()=>{});
          return;
        } else {
          this.renderTicket(this.lastOrder);
          this.show('mTicket');
          return;
        }
      } else {
        this.renderTicket(this.lastOrder);
        this.show('mTicket');
        return;
      }
    }
    // โหมดโต๊ะ + ตะกร้าว่าง + ยังไม่มี order ใน memory → ลองโหลดจากโต๊ะ
    if((!this.cart || !this.cart.length) && this.orderMode==='table' && this.tableNo && !this.orderId){
      this.restoreTableOrderIfAny().then(()=>{
        if(this.lastOrder && Number(this.lastOrder.tableNo)===Number(this.tableNo)
            && this.lastOrder.status!=='Cancelled' && this.lastOrder.status!=='Completed'){
          this.renderTicket(this.lastOrder);
          this.show('mTicket');
        } else {
          el.innerHTML='<div style="text-align:center;color:#999;padding:20px">ตะกร้าว่าง</div>';
          document.getElementById('cartSum').textContent=money(0);
          this.show('mCart');
        }
      }).catch(()=>{
        el.innerHTML='<div style="text-align:center;color:#999;padding:20px">ตะกร้าว่าง</div>';
        this.show('mCart');
      });
      return;
    }
    if(!this.cart.length) el.innerHTML='<div style="text-align:center;color:#999;padding:20px">ตะกร้าว่าง</div>';
    else el.innerHTML=this.cart.map((i,idx)=>{
      const tops=(i.toppings||[]).map(t=>`${esc(t.name)} x${t.qty} (${money(t.total)})`).join(', ');
      const meta=[i.spiceName, i.plara, tops, i.note?('หมายเหตุ: '+esc(i.note)):''].filter(Boolean).join(' · ');
      return `<div class="ci"><div><div style="font-weight:600">${esc(i.name)} × ${i.qty}</div>
        ${meta?`<div style="font-size:13px;color:#777">${meta}</div>`:''}
        <button style="color:var(--d);font-size:13px;margin-top:4px" onclick="C.rmCart(${idx})">ลบ</button></div>
        <div style="font-weight:600">${money(i.total)}</div></div>`;
    }).join('');
    document.getElementById('cartSum').textContent=money(this.cart.reduce((s,i)=>s+i.total,0));
    this.show('mCart');
  },
  rmCart(i){
    this.cart.splice(i,1);
    this.updFab();
    this.openCart();
    // ถ้าอยู่หน้าชำระเงิน ให้คำนวณส่วนลด/QR ใหม่ตามตะกร้า
    try{
      const pay=document.getElementById('mPay');
      if(pay && pay.classList.contains('on')) this.recalcPayTotal();
    }catch(e){}
  },
  checkout(){
    if(!this.cart.length)return;
    try{ this.recalcPayTotal(); }catch(e){}
    // ถ้ามีคิวยังไม่จบ อย่าเคลียร์ — เปิดตั๋วเดิม (โต๊ะต้องตรงกัน)
    if(this.orderId && this.lastOrder && this.lastOrder.status!=='Cancelled' && this.lastOrder.status!=='Completed'){
      if(this.orderMode==='table' && Number(this.lastOrder.tableNo)!==Number(this.tableNo)){
        try{ this.clearOrderState(); }catch(e){}
      } else if(this.orderMode==='table' && this.cart && this.cart.length){
        // โต๊ะเดิม + มีของในตะกร้า → ไปหน้ายืนยันเพื่อสั่งเพิ่ม
      } else {
        this.renderTicket(this.lastOrder);
        this.hide('mCart'); this.show('mTicket');
        toast(this.orderMode==='table'
          ? ('โต๊ะ '+(this.tableNo||'')+' · '+(this.lastOrder.queue||''))
          : ('มีคิวค้างอยู่: '+(this.lastOrder.queue||'')));
        return;
      }
    }
    const keepTableOrder = this.orderMode==='table' && this.tableNo && this.cart && this.cart.length
      && this.orderId && this.lastOrder
      && this.lastOrder.status!=='Cancelled' && this.lastOrder.status!=='Completed'
      && Number(this.lastOrder.tableNo)===Number(this.tableNo);
    if(!keepTableOrder) this.clearOrderState();
    const pt=document.getElementById('payTotal');
    if(pt) pt.textContent=money(this.cart.reduce((s,i)=>s+i.total,0));
    this.slipData='';
    const sf=document.getElementById('slipFile'); if(sf) sf.value='';
    const sp=document.getElementById('slipPreview'); if(sp){ sp.innerHTML=''; sp.style.display='none'; }
    const sm=document.getElementById('slipAutoMsg'); if(sm) sm.textContent='';
    const btn=document.getElementById('btnOrder');
    if(btn){ btn.disabled=false; btn.textContent='ยืนยันออเดอร์'; }
    if(!this.assertShopOpen()) return;
    this.payM='PROMPTPAY';
    this.payMethod('PROMPTPAY');
    this.hide('mCart'); this.show('mPay');
    try{ this.renderPayReview(); }catch(e){}
    try{ this.recalcPayTotal(); }catch(e){}
  },
  /** สรุปรายการในหน้ายืนยันออเดอร์ (ไม่โชว์ QR) */
  });
})();
