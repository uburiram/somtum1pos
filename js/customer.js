const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'฿'+Number(n||0).toLocaleString('en-US',{maximumFractionDigits:0});
const toast=msg=>{const t=document.getElementById('toast');t.textContent=msg;t.style.display='block';clearTimeout(t._x);t._x=setTimeout(()=>t.style.display='none',2800)};
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const showErr=msg=>{const e=document.getElementById('errBanner');e.textContent=msg;e.classList.add('on')};
async function sha256(text){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(text)));return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}

/**
 * คำนวณยอดที่ครอบคลุมแล้ว + ส่วนต่าง (ซ่อมข้อมูลเก่าที่ paidAmount รวมทอน)
 * ใช้ addRound: รวมรายการก่อนรอบล่าสุด = ยอดที่ควรชำระแล้ว
 */
function calcPaymentCover(order){
  const o=order||{};
  const billTotal=Math.max(0, Number(o.total||0));
  const rawPaid=Math.max(0, Number(o.paidAmount||0));
  const items=Array.isArray(o.items)?o.items:[];
  const rounds=items.map(i=>Math.max(0, Math.floor(Number(i.addRound||0))));
  const maxRound=rounds.length?Math.max.apply(null, rounds):0;
  let covered=rawPaid;
  if(String(o.paymentStatus||'')==='PAID' && !o.needsRepay){
    covered=billTotal;
  } else if(o.needsRepay || (String(o.paymentStatus||'')!=='PAID' && rawPaid>0)){
    if(maxRound>0){
      const prevSum=items
        .filter(i=>Math.max(0, Math.floor(Number(i.addRound||0))) < maxRound)
        .reduce((s,i)=>s+Number(i.total||0), 0);
      if(prevSum>0){
        const itemsSum=items.reduce((s,i)=>s+Number(i.total||0), 0);
        const disc=Math.max(0, Number(o.discountAmount||0));
        if(itemsSum>0 && disc>0 && billTotal<=itemsSum){
          covered=Math.max(0, Math.round((prevSum - disc*(prevSum/itemsSum))*100)/100);
        } else {
          covered=prevSum;
        }
      } else {
        covered=Math.min(rawPaid, billTotal);
      }
    } else {
      covered=Math.min(rawPaid, billTotal);
    }
  }
  covered=Math.max(0, Math.min(covered, billTotal));
  const due=Math.max(0, Math.round((billTotal - covered)*100)/100);
  return { covered, due, billTotal, rawPaid, maxRound };
}

const PP={
  /* EMV PromptPay ถูกต้อง: เบอร์มือถือ=tag01, บัตรประชาชน/TAX 13หลัก=tag02 */
  crc(p){let c=0xFFFF;for(let i=0;i<p.length;i++){c^=p.charCodeAt(i)<<8;for(let j=0;j<8;j++)c=c&0x8000?((c<<1)^0x1021)&0xFFFF:(c<<1)&0xFFFF}return c.toString(16).toUpperCase().padStart(4,'0')},
  tlv(id,v){const s=String(v);return id+String(s.length).padStart(2,'0')+s},
  gen(target,amount){
    let t=String(target||'').replace(/\D/g,'');
    let idTag='01';
    if(t.length===10 && t[0]==='0'){ t='0066'+t.slice(1); idTag='01'; }
    else if(t.length===13){ idTag='02'; }
    else if(t.length===15 && t.startsWith('0066')){ idTag='01'; }
    else return null;
    const mai=this.tlv('00','A000000677010111')+this.tlv(idTag,t);
    let p=this.tlv('00','01')+this.tlv('01', Number(amount)>0 ? '12' : '11')+this.tlv('29',mai)+this.tlv('53','764');
    if(Number(amount)>0){ const a=(Math.round(Number(amount)*100)/100).toFixed(2); p+=this.tlv('54', a); }
    p+=this.tlv('58','TH')+'6304';
    return p+this.crc(p);
  },
  /* Thai QR ร้านค้า / Bill Payment (K Shop ฯลฯ) — Tag 30 + AID A000000677010112 */
  genMerchant(merchantId, amount){
    let id=String(merchantId||'').trim();
    if(!id) return null;
    const digits=id.replace(/\D/g,'');
    let mai;
    if(digits.length>=10 && digits.length<=15 && digits===id.replace(/\s/g,'')){
      const biller=digits.padStart(15,'0');
      mai=this.tlv('00','A000000677010112')+this.tlv('01',biller);
    } else {
      // รหัสผสมตัวอักษร — ใส่ใน merchant account info 29/03
      const mid=id.slice(0,25);
      mai=this.tlv('00','A000000677010111')+this.tlv('03',mid);
    }
    const tag = (digits.length>=10 && digits.length<=15 && digits===id.replace(/\s/g,'')) ? '30' : '29';
    let p=this.tlv('00','01')+this.tlv('01', Number(amount)>0?'12':'11')+this.tlv(tag,mai)+this.tlv('53','764');
    if(Number(amount)>0){ const a=(Math.round(Number(amount)*100)/100).toFixed(2); p+=this.tlv('54', a); }
    p+=this.tlv('58','TH')+'6304';
    return p+this.crc(p);
  },/* ใส่ยอดเงินลง Thai QR payload เดิม (จาก K Shop) แล้วคำนวณ CRC ใหม่ */
  parseTlv(s){
    const out=[]; let i=0;
    while(i+4<=s.length){
      const tag=s.substr(i,2); const ln=parseInt(s.substr(i+2,2),10); i+=4;
      if(isNaN(ln)||i+ln>s.length) break;
      const val=s.substr(i,ln); i+=ln; out.push([tag,val]);
      if(tag==='63') break;
    }
    return out;
  },
  applyAmount(staticPayload, amount){
    if(!staticPayload) return null;
    let parts=this.parseTlv(String(staticPayload).trim());
    if(!parts.length) return null;
    parts=parts.filter(([t])=>t!=='63');
    const amt=Number(amount);
    const hasAmt=amt>0;
    let has54=false;
    const next=[];
    for(const [t,v] of parts){
      if(t==='01'){ next.push(['01', hasAmt?'12':'11']); }
      else if(t==='54'){ has54=true; if(hasAmt) next.push(['54', (Math.round(amt*100)/100).toFixed(2)]); }
      else next.push([t,v]);
    }
    let final=next;
    if(hasAmt && !has54){
      final=[];
      for(const [t,v] of next){
        if(t==='58') final.push(['54', (Math.round(amt*100)/100).toFixed(2)]);
        final.push([t,v]);
      }
    }
    let body='';
    for(const [t,v] of final) body+=this.tlv(t,v);
    body+='6304';
    return body+this.crc(body);
  },
  genKShop(amount, payload){
    const p=payload||window.KSHOP_QR_PAYLOAD||'';
    if(p) return this.applyAmount(p, amount);
    return null;
  }
};

let db,shopRef;

function checkConfig(){
  const c=window.FIREBASE_CONFIG||{};
  if(!c.apiKey||String(c.apiKey).includes('PASTE')){document.getElementById('cfgBanner').classList.add('on');return false}
  return true;
}

function fileToDataUrl(file,maxSide=480,quality=.55){
  // Thumbnail / สลิปบนมือถือ — จำกัดขนาดไม่ให้ document Firestore โตเกินจำเป็น
  return new Promise((resolve,reject)=>{
    if(!file)return resolve('');
    if(file.size>5*1024*1024)return reject(new Error('ไฟล์ใหญ่เกิน 5MB'));
    const img=new Image(); const url=URL.createObjectURL(file);
    img.onload=()=>{
      try{
        let w=img.width,h=img.height; const s=Math.min(1,maxSide/Math.max(w,h));
        w=Math.max(1,Math.round(w*s)); h=Math.max(1,Math.round(h*s));
        const c=document.createElement('canvas');c.width=w;c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h); URL.revokeObjectURL(url);
        let q=quality;
        let data=c.toDataURL('image/jpeg',q);
        const maxChars=140000; // ~100KB+ binary หลัง decode พอสำหรับสลิปอ่านได้
        let side=maxSide;
        while(data.length>maxChars && (q>0.35 || side>280)){
          if(q>0.35) q=Math.max(0.35, q-0.1);
          else {
            side=Math.max(280, Math.round(side*0.75));
            const s2=Math.min(1,side/Math.max(img.width,img.height));
            const w2=Math.max(1,Math.round(img.width*s2)), h2=Math.max(1,Math.round(img.height*s2));
            c.width=w2; c.height=h2; c.getContext('2d').drawImage(img,0,0,w2,h2);
          }
          data=c.toDataURL('image/jpeg',q);
        }
        resolve(data);
      }catch(e){ URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('อ่านรูปไม่สำเร็จ'))};
    img.src=url;
  });
}

async function migrateAndSeed(){
  // แก้ชื่อบัญชีสะกดผิดในข้อมูลเก่า (นราทร → นรากร)
  try{
    const pub=await shopRef.collection('settings').doc('public').get();
    if(pub.exists){
      const an=String((pub.data()||{}).accountName||'');
      if(an.includes('นราทร')){
        await shopRef.collection('settings').doc('public').set({accountName:an.replace(/นราทร/g,'นรากร')},{merge:true});
      }
    }
  }catch(e){ console.warn('fix accountName', e); }
  try{
    const q=await shopRef.collection('settings').doc('queue').get();
    if(!q.exists){
      await shopRef.collection('settings').doc('queue').set({queueCounter:1,queueDate:''},{merge:true});
    }
  }catch(e){ console.warn('queue seed', e); }
  try{
    const catSnap=await shopRef.collection('categories').limit(1).get();
    if(!catSnap.empty) return;
    const batch=db.batch();
    [['c1','เมนูส้มตำ',1],['c2','เมนูยำ',2],['c3','เมนูของทอด',3],['c4','เมนูกินคู่ส้มตำ',4],['c5','เครื่องดื่ม',5]]
      .forEach(([id,name,order])=>batch.set(shopRef.collection('categories').doc(id),{id,name,isActive:true,order}));
    const menus=[
      ['m1','c1','ตำปูปลาร้า',40],['m2','c1','ตำไทย',40],['m3','c1','ตำป่า',45],['m4','c1','ตำแตง',40],
      ['m5','c2','ยำวุ้นเส้น',50],['m6','c3','ไก่ทอด',50],['m7','c3','ปีกไก่ทอด',40],
      ['m8','c4','ไข่ต้ม',10],['m9','c4','ไข่ดาว',15],['m10','c5','น้ำเปล่า',10],['m11','c5','น้ำอัดลม',15]
    ];
    menus.forEach(([id,catId,name,price])=>batch.set(shopRef.collection('menus').doc(id),{id,catId,name,price,isActive:true,isOut:false,imageUrl:'',imageData:'',order:0}));
    [['s1','ไม่เผ็ด',1],['s2','เผ็ดน้อย',2],['s3','เผ็ดกลาง',3],['s4','เผ็ดมาก',4]].forEach(([id,name,order])=>batch.set(shopRef.collection('spiceLevels').doc(id),{id,name,isActive:true,order}));
    [['t1','ไข่ดาว',10],['t2','ไข่ต้ม',10],['t3','เพิ่มปู',20],['t4','หมูกรอบ',15]].forEach(([id,name,price],i)=>batch.set(shopRef.collection('toppings').doc(id),{id,name,price,isActive:true,order:i+1}));
    batch.set(shopRef.collection('settings').doc('public'),{
      shopName:'ส้มตำนายหนึ่ง', isOpen:true, memberSystemEnabled:true, promptpay:'1319900156353', accountName:'นาย นรากร วงค์แก่นท้าว',
      payType:'kshop', merchantId:'EMPKB000002198793001', kshopPayload:window.KSHOP_QR_PAYLOAD||''
    },{merge:true});
    await batch.commit();
  }catch(e){ console.warn('seed menus', e); }
}

const C={
  shopName:'ร้าน',promptpay:'',accountName:'',payType:'kshop',merchantId:'EMPKB000002198793001',kshopPayload:'',memberSystemEnabled:true,orderMode:'queue',tableNo:null,tableCount:0,optionConfig:{spiceMode:'single',toppingMode:'multi',toppingAllowQty:true},cats:[],menus:[],spice:[],tops:[],
  cat:'all',q:'',cart:[],modal:null,orderId:null,unsub:null,payM:'PROMPTPAY',slipData:'',lastOrder:null,kitchenOrders:[],bestSellerIds:[],bestSellerRank:{},

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
        if(window.FIREBASE_APPCHECK_SITE_KEY && firebase.appCheck){
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
      // seed ไม่ควรบล็อกการแสดงผลนาน
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
    const needPlara=!p.isSimple && (p.menu.allowPlara===true||p.menu.allowPlara===1||p.menu.allowPlara==='true'||p.menu.allowPlara==='1');
    if(needPlara && !p.plara){ toast('เลือกใส่หรือไม่ใส่ปลาร้า'); return; }
    const plaraLabel=(!p.isSimple && p.menu.allowPlara)?(p.plara==='with'?'ใส่ปลาร้า':'ไม่ใส่ปลาร้า'):'';
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
    // ใช้หลังยืนยันออเดอร์ / เคลียร์ตะกร้า — ต้องมี method นี้เสมอ
    try{
      this.cart = this.cart || [];
      this.updFab();
      const el=document.getElementById('cartList');
      if(el && !this.cart.length){
        el.innerHTML='<div style="text-align:center;color:#999;padding:20px">ตะกร้าว่าง</div>';
      }
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
    this.clearOrderState();
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

    // 3) ถอด QR จากรูปสลิป (Thai QR มียอดใน payload) — multi-pass
    try{
      /* bg verify */
      const qrInfo=await this.readAmountFromSlipImage(dataUrl);
      if(qrInfo && qrInfo.amount!=null){
        const paid=Number(qrInfo.amount);
        if(Math.abs(paid-amount)<=1){
          await this.autoMarkPaidFromSlip(orderId, dataUrl, {msg:'QR ในสลิปยอดตรง', amount:paid});
          setMsg('<span style="color:#2E7D32">✓ บันทึกสลิปแล้ว</span>');
          /* auto-paid เงียบ ๆ */
          return;
        }
        await shopRef.collection('orders').doc(orderId).update({
          slipData:(dataUrl||'').slice(0,200000), slipStatus:'PENDING_REVIEW',
          slipVerifyNote:'ยอดในสลิป ฿'+paid+' ไม่ตรงออเดอร์ ฿'+amount
        });
        setMsg('<span style="color:#E65100">ยอดในสลิปไม่ตรง (฿'+paid+' / ออเดอร์ ฿'+amount+') · รอร้านตรวจ</span>');
        /* silent pending */
        this._applyLocalSlip(orderId, dataUrl, 'PENDING_REVIEW');
        return;
      }
    }catch(e){ console.warn('slip QR', e); }

    // 3b) OCR หาตัวเลขยอดในรูป — ถ้าตรงออเดอร์ 100% อนุมัติ
    try{
      /* bg ocr */
      const ocr=await this.readAmountByOCR(dataUrl, amount);
      if(ocr && ocr.amount!=null && Math.abs(Number(ocr.amount)-amount)<=1){
        await this.autoMarkPaidFromSlip(orderId, dataUrl, {msg:'OCR ยอดตรงออเดอร์', amount:Number(ocr.amount), slipTs:ocr.slipTs||null});
        setMsg('<span style="color:#2E7D32">✓ ยอดในสลิปตรงออเดอร์ · ยืนยันรับโอนอัตโนมัติ</span>');
        toast('ชำระเงินสำเร็จ (ตรวจอัตโนมัติ)');
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
    this.stopKitchenWatch();
  },
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
        if(n>=1 && n<=100) return n;
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
      if(!o.benefitsRefunded){
        try{ await this.refundMemberBenefits(o); }catch(e){ console.warn('refund', e); }
      }
      await shopRef.collection('orders').doc(o.id).update({
        status:'Cancelled',
        cancelledAt:Date.now(),
        cancelledBy:'customer',
        cancelReason:'ลูกค้ายกเลิกตอนรอคิวทำ',
        benefitsRefunded: true
      });
      // โหมดโต๊ะ: ปลด activeOrderId เพื่อให้สั่งใหม่/โต๊ะว่างทันที
      try{
        const tNo = o.tableNo!=null ? o.tableNo : this.tableNo;
        if((o.orderMode==='table' || this.orderMode==='table') && tNo){
          await shopRef.collection('tables').doc(String(tNo)).set({
            activeOrderId:null,
            status:'free',
            callStaff:false,
            updatedAt:Date.now()
          },{merge:true});
        }
      }catch(e){ console.warn('free table after cancel', e); }
      this.lastOrder=Object.assign({}, o, {status:'Cancelled', cancelledBy:'customer', benefitsRefunded:true});
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
      if(md.status==='cancelled' || md.active===false){
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
    return (String(m.firstName||'')+' '+String(m.lastName||'')).trim()||m.phone||'';
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
            if(c.active===false){ if(line) line.innerHTML='<span style="color:#C62828">คูปองปิดใช้งาน</span>'; }
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
        points:0, totalSpent:0, orderCount:0,
        createdAt:Date.now(), updatedAt:Date.now()
      });
      toast('สมัครสมาชิกสำเร็จ');
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
    if(!order || !order.memberPhone || order.pointsAwarded) return;
    // สะสมแต้มจากยอดขายจริง (total หลังส่วนลด) ไม่ใช่เงินสดที่รับเกิน
    const sale=Math.max(0, Number(order.total!=null ? order.total : 0));
    const earn=Math.floor(sale/100);
    const phone=this.normPhone(order.memberPhone);
    if(!phone) return;
    try{
      await db.runTransaction(async tx=>{
        const oref=shopRef.collection('orders').doc(order.id);
        const os=await tx.get(oref);
        if(!os.exists || (os.data()||{}).pointsAwarded) return;
        const mref=shopRef.collection('members').doc(phone);
        const ms=await tx.get(mref);
        if(!ms.exists){
          tx.update(oref,{ pointsAwarded:true, pointsEarned:0 });
          return;
        }
        const md=ms.data()||{};
        tx.update(mref,{
          points: Number(md.points||0)+earn,
          totalSpent: Number(md.totalSpent||0)+sale,
          orderCount: Number(md.orderCount||0)+1,
          updatedAt: Date.now()
        });
        tx.update(oref,{ pointsAwarded:true, pointsEarned:earn });
      });
    }catch(e){ console.warn('awardMemberPoints', e); }
  },

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
    // ถ้าแอดมินปิดระบบสมาชิก — ไม่ใช้แต้ม/คูปอง (เก็บแค่เบอร์ติดต่อ)
    const memOn=this.memberSystemEnabled!==false;
    const memberPhone=(memOn && this.member&&this.member.phone)||'';
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
          if(md0.status==='cancelled' || md0.active===false) throw new Error('สมาชิกถูกระงับสิทธิ์');
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
          if(c.active===false) throw new Error('คูปองปิดใช้งาน');
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
          memberName: this.member?this.escName(this.member):'',
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
      memberName: this.member?this.escName(this.member):'',
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
    // ดึงออเดอร์ล่าสุด — กรองครัวฝั่ง client + อัปเดตหัวข้อ + แจ้งเมื่อคิวพร้อม
    this._kitchenUnsub=shopRef.collection('orders').limit(120).onSnapshot(snap=>{
      const all=snap.docs.map(d=>({id:d.id,...d.data()}));
      this.kitchenOrders=all.filter(o=>this.isKitchenStatus(o.status));
      this.updateKitchenHeaderBadge();
      // ติดตามออเดอร์ของลูกค้า (ถ้ามี) เมื่อสถานะเปลี่ยนเป็น Ready
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
      } else if(this.lastOrder){
        this.renderTicket(this.lastOrder);
      }
    }, err=>console.warn('kitchen watch', err));
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
    document.getElementById('ticketBody').innerHTML=`
      <h2 style="color:${cancelled?'var(--d)':paid?'var(--g)':'var(--p)'};margin-bottom:8px">${cancelled?'<i class="fa-solid fa-xmark"></i> ยกเลิกแล้ว':paid?'<i class="fa-solid fa-circle-check"></i> ชำระแล้ว':'<i class="fa-solid fa-clock"></i> รอชำระเงิน / รอรับออเดอร์'}</h2>
      <div>คิวของคุณ</div>
      <div class="huge">${esc(o.queue)}</div>
      <div class="badge ${st[0]}" style="margin:8px 0">${st[1]}</div>
      <div id="custCancelBox" style="margin:8px 0"></div>
      <div id="queueEtaBox" style="display:none;margin:10px 0;padding:12px;background:#FFF3E0;border-radius:12px;border:1px solid #FFE0B2;text-align:center"></div>
      <div class="receipt" id="receiptBox">
        <h3>${esc(this.shopName)}</h3><div style="text-align:center;font-size:13px;font-weight:600;color:${paid?'var(--g)':'var(--p)'}">${paid?'ใบเสร็จรับเงิน':'ใบสั่งอาหาร (ยังไม่ชำระ)'}</div>
        <div style="text-align:center;font-size:13px;color:#666;margin-bottom:8px">${new Date(o.createdAt||Date.now()).toLocaleString('th-TH')}</div>
        ${lines}
        <div style="border-top:1px dashed #ccc;margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;font-weight:700">
          <span>รวม</span><span style="color:var(--p)">${money(o.total)}</span>
        </div>
        <div style="margin-top:6px;font-size:13px">ชำระ: ${paid?(o.paymentMethod==='CASH'?'เงินสด (ที่ร้าน)':'พร้อมเพย์'):(function(){const cv=calcPaymentCover(o);return cv.due>0?('มีรายการเพิ่ม · รอชำระส่วนต่าง ฿'+cv.due):'รอชำระ (QR / เงินสดที่ร้าน)';})()} · ${paid?'ชำระแล้ว':'ยังไม่ชำระ'}</div>
        ${o.slipStatus&&o.slipStatus!=='NONE'?`<div style="font-size:12px;color:#555">สลิป: ${esc(o.slipStatus)}</div>`:''}
      </div>
      <p style="font-size:13px;color:#777">บันทึกใบเสร็จในเครื่องอัตโนมัติเมื่อชำระแล้ว · ค้นจากเลขคิวได้</p>`;
    document.getElementById('btnPrintReceipt').style.display = paid ? 'inline-flex' : 'none';
    // ปุ่มยกเลิกฝั่งลูกค้า — ได้เฉพาะรอคิวทำ
    try{
      const cbox=document.getElementById('custCancelBox');
      if(cbox){
        const canCancel = !cancelled && !paid && !o.needsRepay && !(Number(o.paidAmount||0)>0) && (o.status==='Pending' || o.status==='AwaitingPayment');
        if(cancelled){
          const by=o.cancelledBy==='customer'?'ลูกค้า':(o.cancelledBy==='shop'?'ร้าน':'—');
          cbox.innerHTML='<div style="font-size:13px;color:#C62828;text-align:center;padding:8px;background:#FFEBEE;border-radius:8px;font-weight:600">ยกเลิกโดย'+by+'</div>';
        } else if(canCancel){
          cbox.innerHTML='<button type="button" class="btn btn-d btn-block" style="margin-top:4px" onclick="C.cancelMyOrder()">ยกเลิกออเดอร์</button><div style="font-size:11px;color:#888;margin-top:4px;text-align:center">ยกเลิกได้เฉพาะตอนรอคิวทำ</div>';
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
      this.trackUnsub=shopRef.collection('orders').doc(picked.id).onSnapshot(s=>{
        if(!s.exists) return;
        if(this.orderId!==s.id) return; // ห้ามสลับไปคิวอื่น
        this.lastOrder={id:s.id,...s.data()};
        this.renderTicket(this.lastOrder);
      });
    }catch(e){ toast('ค้นหาไม่สำเร็จ: '+(e.message||e)); }
  }
};
C.init();
try{ if(C.isLineBrowser && C.isLineBrowser()){ const h=document.getElementById('ppQRHint'); if(h) h.style.display='block'; } }catch(e){}
