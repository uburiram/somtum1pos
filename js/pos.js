const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'฿'+Number(n||0).toLocaleString('en-US',{maximumFractionDigits:0});
const toast=msg=>{const t=document.getElementById('toast');t.textContent=msg;t.style.display='block';clearTimeout(t._x);t._x=setTimeout(()=>t.style.display='none',2800)};
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
async function sha256(text){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(text)));return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}

/**
 * คำนวณยอดที่ครอบคลุมแล้ว + ส่วนต่างที่ต้องเก็บ
 * แก้ bug เก่า: paidAmount เคยถูกเซ็ตเป็นเงินที่ยื่น (รวมทอน) แทนยอดบิล
 * ซ่อมข้อมูลเก่าด้วย addRound: รวมรายการก่อนรอบล่าสุด = ยอดที่ควรชำระแล้ว
 * ตัวอย่าง T10: รอบก่อนหน้า 90 + สั่งเพิ่ม 100 → total 190, due = 100 (ไม่ใช่ 90)
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

function fileToDataUrl(file,maxSide=480,quality=.55){
  // Thumbnail สำหรับมือถือ — ลดขนาดเพื่อไม่ให้ document Firestore ใกล้ 1MB
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
        // ถ้ายังใหญ่เกิน ~120KB (base64) ลดคุณภาพ/ขนาดซ้ำ
        const maxChars=120000;
        let side=maxSide;
        while(data.length>maxChars && (q>0.35 || side>240)){
          if(q>0.35) q=Math.max(0.35, q-0.1);
          else { side=Math.max(240, Math.round(side*0.75));
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

let db,shopRef;

const M={
  filterKey:'kitchen', orders:[], menus:[], cats:[], tops:[], spice:[],
  audio:null, audioOn:false, lastActive:0, ready:false, unsub:null, catalogTab:'cat',
  pendingImageData:'',

  async boot(){
    const c=window.FIREBASE_CONFIG||{};
    if(!c.apiKey||String(c.apiKey).includes('PASTE')){document.getElementById('cfgBanner').classList.add('on');return}
    try{
      if(!firebase.apps || !firebase.apps.length) firebase.initializeApp(c);
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
      try{ db.enablePersistence({synchronizeTabs:true}).catch(function(){}); }catch(e){}
      shopRef=db.collection('shops').doc(window.SHOP_ID||'main');
      // queue doc
      try{
        const q=await shopRef.collection('settings').doc('queue').get();
        if(!q.exists) await shopRef.collection('settings').doc('queue').set({queueCounter:1,queueDate:''},{merge:true});
      }catch(e){}
      await this.ensureSecure();
      // session PIN ยังไม่หมดอายุ
      if(Number(sessionStorage.getItem('pinUntil')||0) > Date.now()){
        this.enter();
      }
    }catch(e){
      console.error(e);
      toast('เริ่มระบบไม่สำเร็จ: '+(e.message||e));
    }
  },
  async ensureSecure(){
    try{
      const pub=await shopRef.collection('settings').doc('public').get();
      if(!pub.exists){
        await shopRef.collection('settings').doc('public').set({
          shopName:'ส้มตำนายหนึ่ง',
          promptpay:'1319900156353',
          accountName:'นาย นรากร วงค์แก่นท้าว',
          payType:'kshop',
          merchantId:'EMPKB000002198793001',
          kshopPayload:window.KSHOP_QR_PAYLOAD||''
        },{merge:true});
      } else {
        // แก้ชื่อบัญชีที่สะกดผิดในข้อมูลเก่า (นราทร → นรากร) อัตโนมัติครั้งเดียว
        const pd = pub.data() || {};
        const an = String(pd.accountName || '');
        if (an.includes('นราทร')) {
          await shopRef.collection('settings').doc('public').set({
            accountName: an.replace(/นราทร/g, 'นรากร')
          }, {merge:true});
        }
      }
      const sec=await shopRef.collection('settings').doc('secure').get();
      if(!sec.exists){
        await shopRef.collection('settings').doc('secure').set({
          pinHash: await sha256('1234'),
          queueCounter:1
        },{merge:true});
      }
      // seed เมนูถ้ายังว่าง
      const catSnap=await shopRef.collection('categories').limit(1).get();
      if(catSnap.empty){
        const batch=db.batch();
        [['c1','เมนูส้มตำ',1],['c2','เมนูยำ',2],['c3','เมนูของทอด',3],['c4','เมนูกินคู่ส้มตำ',4],['c5','เครื่องดื่ม',5]]
          .forEach(([id,name,order])=>batch.set(shopRef.collection('categories').doc(id),{id,name,isActive:true,order}));
        const menus=[['m1','c1','ตำปูปลาร้า',40],['m2','c1','ตำไทย',40],['m3','c1','ตำป่า',45],['m4','c1','ตำแตง',40],['m5','c2','ยำวุ้นเส้น',50],['m6','c3','ไก่ทอด',50],['m7','c3','ปีกไก่ทอด',40],['m8','c4','ไข่ต้ม',10],['m9','c4','ไข่ดาว',15],['m10','c5','น้ำเปล่า',10],['m11','c5','น้ำอัดลม',15]];
        menus.forEach(([id,catId,name,price])=>batch.set(shopRef.collection('menus').doc(id),{id,catId,name,price,isActive:true,isOut:false,imageUrl:'',imageData:''}));
        [['s1','ไม่เผ็ด',1],['s2','เผ็ดน้อย',2],['s3','เผ็ดกลาง',3],['s4','เผ็ดมาก',4]].forEach(([id,name,order])=>batch.set(shopRef.collection('spiceLevels').doc(id),{id,name,isActive:true,order}));
        [['t1','ไข่ดาว',10],['t2','ไข่ต้ม',10],['t3','เพิ่มปู',20],['t4','หมูกรอบ',15]].forEach(([id,name,price],i)=>batch.set(shopRef.collection('toppings').doc(id),{id,name,price,isActive:true,order:i+1}));
        await batch.commit();
      }
    }catch(e){ console.warn('ensureSecure', e); }
  },
  async login(){
    const input=(document.getElementById('pinIn').value||'').trim();
    if(!/^\d{4,8}$/.test(input)){ toast('PIN ต้องเป็นตัวเลข 4–8 หลัก'); return; }
    try{
      await this.ensureSecure();
      const s=await shopRef.collection('settings').doc('secure').get();
      const hash=s.exists ? (s.data().pinHash||'') : '';
      const inputHash=await sha256(input);
      if(hash && inputHash===hash){
        sessionStorage.setItem('pinUntil', String(Date.now()+8*60*60*1000)); // 8 ชม.
        this.enter();
        toast('เข้าสู่ระบบแล้ว');
      } else {
        toast('PIN ไม่ถูกต้อง');
      }
    }catch(e){
      toast('เข้าสู่ระบบไม่สำเร็จ: '+(e.message||e));
    }
  },
  enter(){
    document.getElementById('loginView').classList.add('hide');
    document.getElementById('appView').classList.remove('hide');
    this.ready = false;
    this.lastActive = 0;
    this.listenOrders();
    try{ this.listenTables(); }catch(e){}
    this.loadSettingsUI();
    // โหลด cache สมาชิกเงียบ ๆ เพื่อแสดงชื่อบนออเดอร์ทันที
    try{ this.loadMembersPanel(); }catch(e){}
    // อัปเดตชื่อร้านแบบ realtime
    if (shopRef) {
      shopRef.collection('settings').doc('public').onSnapshot(s => {
        if (s.exists) {
          const d = s.data()||{};
          const el = document.getElementById('shopTitle');
          if (el) el.textContent = d.shopName || 'POS';
          try{ this.applyShopOpenUI(d.isOpen!==false); }catch(e){}
          try{ this.applyMemberSystemUI(d.memberSystemEnabled!==false); }catch(e){}
          try{
            this.applyOrderModeUI((d.orderMode==='table' || d.orderMode==='auto') ? d.orderMode : 'queue');
            this.tableCount=Number(d.tableCount||10);
            const tc=document.getElementById('setTableCount'); if(tc) tc.value=String(this.tableCount);
          }catch(e){}
        }
      });
    }
    // ลงทะเบียน FCM เพื่อแจ้งเตือนแม้หน้าจอดับ / ยุบแอพ
    try{ this.registerFCM(); }catch(e){ console.warn('FCM enter', e); }
  },
  logout(){
    sessionStorage.removeItem('pinUntil');
    location.reload();
  },
  enableAudio(){
    try{
      this.audio=new (window.AudioContext||window.webkitAudioContext)();
      const resume=()=>{
        this.audio.resume().then(()=>{
          this.audioOn=true;
          const bar=document.getElementById('audioBar');
          if(bar) bar.classList.add('hide');
          toast('เปิดเสียงแจ้งเตือนแล้ว');
          this.beep();
        }).catch(function(){ toast('เปิดเสียงไม่สำเร็จ — ลองกดอีกครั้ง'); });
      };
      resume();
      if(!this._audioUnlockBound){
        this._audioUnlockBound=true;
        const unlock=()=>{ try{ if(this.audio && this.audio.state==='suspended') this.audio.resume(); }catch(e){} };
        document.addEventListener('touchstart', unlock, {passive:true});
        document.addEventListener('click', unlock, {passive:true});
      }
    }catch(e){
      toast('เปิดเสียงไม่สำเร็จ: '+(e.message||e));
    }
    this.requestNotifyPermission();
    try{ this.registerFCM(); }catch(e){ console.warn('FCM enableAudio', e); }
  },
  _primeSpeech(){
    if(!window.speechSynthesis) return;
    try{
      // โหลดเสียงไทย + พูดสั้น ๆ เงียบ ๆ เพื่อปลดล็อกบนมือถือ
      const warm=new SpeechSynthesisUtterance(' ');
      warm.volume=0.01; warm.lang='th-TH';
      speechSynthesis.speak(warm);
      speechSynthesis.getVoices();
      if(speechSynthesis.onvoiceschanged!==undefined){
        speechSynthesis.onvoiceschanged=()=>{ this._thaiVoice=this._pickThaiVoice(); };
      }
      this._thaiVoice=this._pickThaiVoice();
    }catch(e){}
  },
  _pickThaiVoice(){
    try{
      const voices=speechSynthesis.getVoices()||[];
      return voices.find(v=>/th(-|_|$)/i.test(v.lang))
        || voices.find(v=>/thai/i.test(v.name))
        || null;
    }catch(e){ return null; }
  },
  speakNewOrderAlert(){
    // ปิดเสียงพูดแจ้งเตือน — ใช้ beep อย่างเดียว
    return;
  },

  beep(){
    try{
      if(!this.audio){
        this.audio=new (window.AudioContext||window.webkitAudioContext)();
      }
      if(this.audio.state==='suspended'){
        this.audio.resume().catch(function(){});
      }
      this.audioOn=true;
      const o=this.audio.createOscillator();
      const g=this.audio.createGain();
      o.connect(g); g.connect(this.audio.destination);
      o.frequency.value=880;
      g.gain.value=0.18;
      o.start();
      o.stop(this.audio.currentTime+0.25);
      setTimeout(()=>{
        try{
          const o2=this.audio.createOscillator();
          const g2=this.audio.createGain();
          o2.connect(g2); g2.connect(this.audio.destination);
          o2.frequency.value=988;
          g2.gain.value=0.16;
          o2.start();
          o2.stop(this.audio.currentTime+0.22);
        }catch(e){}
      }, 280);
      if(navigator.vibrate) navigator.vibrate([200,80,200,80,300]);
    }catch(e){ console.warn('beep', e); }
  },
  /** ขอสิทธิ์แจ้งเตือนบนมือถือ (Web Notification) */
  requestNotifyPermission(){
    try{
      if(typeof Notification==='undefined') return;
      if(Notification.permission==='granted' || Notification.permission==='denied') return;
      Notification.requestPermission().catch(function(){});
    }catch(e){}
  },
  /** แจ้งเตือนออเดอร์ใหม่ — ใช้เมื่อแท็บอยู่พื้นหลัง */
  pushNotify(title, body){
    try{
      if(typeof Notification==='undefined') return;
      if(Notification.permission!=='granted') return;
      const n=new Notification(title||'ออเดอร์ใหม่', {
        body: body||'มีออเดอร์เข้ามาในระบบ',
        icon: './icon/icon-192.png',
        badge: './icon/favicon-32.png',
        tag: 'somtum-order',
        renotify: true,
        requireInteraction: true
      });
      n.onclick=function(){ try{ window.focus(); n.close(); }catch(e){} };
    }catch(e){}
  },

  /**
   * ลงทะเบียน FCM Token → บันทึกลง Firestore
   * ทำให้ Cloud Function onOrderCreate ส่งแจ้งเตือนได้แม้หน้าจอดับ / ยุบแอพ
   */
  async registerFCM(){
    try{
      if(typeof firebase === 'undefined' || !firebase.messaging){
        console.warn('firebase.messaging ไม่พร้อม');
        return;
      }
      const vapid = (window.FIREBASE_VAPID_KEY || '').trim();
      if(!vapid || vapid.length < 20){
        console.warn('ยังไม่มี VAPID Key ใน firebase-config.js');
        return;
      }

      // ขอสิทธิ์แจ้งเตือน
      if(typeof Notification !== 'undefined'){
        if(Notification.permission === 'default'){
          await Notification.requestPermission();
        }
        if(Notification.permission !== 'granted'){
          toast('กรุณาอนุญาตการแจ้งเตือน เพื่อรับออเดอร์เมื่อหน้าจอดับ');
          return;
        }
      }

      const messaging = firebase.messaging();

      // ลงทะเบียน / ใช้ Service Worker สำหรับ FCM
      let reg = null;
      if('serviceWorker' in navigator){
        try{
          // ใช้ firebase-messaging-sw.js เป็นหลัก (อยู่ root)
          reg = await navigator.serviceWorker.register('./firebase-messaging-sw.js', { scope: './' });
          await navigator.serviceWorker.ready;
        }catch(swErr){
          console.warn('ลงทะเบียน firebase-messaging-sw ไม่สำเร็จ ลอง sw หลัก', swErr);
          try{
            reg = await navigator.serviceWorker.getRegistration() ||
                  await navigator.serviceWorker.register('./sw.js', { scope: './' });
          }catch(e2){}
        }
      }

      const token = await messaging.getToken({
        vapidKey: vapid,
        serviceWorkerRegistration: reg || undefined
      });

      if(!token){
        console.warn('ได้ FCM token ว่าง');
        return;
      }

      // บันทึก token ลง Firestore ให้ Cloud Function ใช้ส่ง
      const shopId = window.SHOP_ID || 'main';
      await db.collection('shops').doc(shopId).collection('fcmTokens').doc(token).set({
        token: token,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ua: (navigator.userAgent || '').slice(0, 300),
        platform: 'android-pwa'
      }, { merge: true });

      console.log('FCM token ลงทะเบียนสำเร็จ');
      toast('เปิดแจ้งเตือนพื้นหลังแล้ว ✓');

      // รับข้อความตอนแอพเปิดอยู่ (foreground) — ผูกครั้งเดียวกัน handler ซ้อน
      if(!this._fcmOnMessageBound){
        this._fcmOnMessageBound=true;
        messaging.onMessage(function(payload){
          const title = (payload.notification && payload.notification.title) || 'ออเดอร์ใหม่ — ส้มตำนายหนึ่ง';
          const body = (payload.notification && payload.notification.body) || 'มีออเดอร์เข้ามาในระบบ';
          try{ M.beep(); }catch(e){}
          try{ M.pushNotify(title, body); }catch(e){}
          try{ if(typeof M.startAlarm === 'function') M.startAlarm(); }catch(e){}
        });
      }
    }catch(e){
      console.error('registerFCM error', e);
      // ไม่ toast error ทุกครั้ง เพื่อไม่รบกวน
    }
  },

  filter(f,el){this.filterKey=f;document.querySelectorAll('.fc').forEach(x=>x.classList.remove('on'));el.classList.add('on');this.renderOrders()},
  listenOrders(){
    if(this.unsub) this.unsub();
    this.unviewed=this.unviewed||new Set();
    const handle=(docs)=>{
      this.orders=docs;
      const activeOrders=this.orders.filter(o=>o.status!=='Completed'&&o.status!=='Cancelled');
      const active=activeOrders.length;
      if(this.ready){
        this._prevAddAt=this._prevAddAt||{};
        this._blinkAdds=this._blinkAdds||new Set();
        let newOrderCount=0;
        let newAddCount=0;
        activeOrders.forEach(o=>{
          if(!this.seenIds.has(o.id)){
            this.seenIds.add(o.id);
            if(o.status==='Pending'||o.status==='AwaitingPayment'||o.status==='Cooking'){
              this.unviewed.add(o.id);
              this._blinkAdds.add(o.id);
              newOrderCount++;
            }
          }
          const la=Number(o.lastAddAt||0);
          const prev=this._prevAddAt[o.id];
          if(la>0 && prev!=null && la>Number(prev)){
            this._blinkAdds.add(o.id);
            this.unviewed.add(o.id);
            newAddCount++;
            const back=!!o.returnedToKitchen || o.status==='Pending' || o.status==='Cooking';
            toast('🔔 โต๊ะ '+(o.tableNo||o.queue||'')+' สั่งเพิ่มครั้งที่ '+(o.lastAddRound||'')+(back?' · เข้าครัว':''));
            try{
              this.filterKey='kitchen';
              document.querySelectorAll('.fc').forEach(x=>x.classList.remove('on'));
              document.querySelectorAll('.fc').forEach(btn=>{
                if((btn.getAttribute('onclick')||'').indexOf('kitchen')>=0) btn.classList.add('on');
              });
            }catch(e){}
          }
          if(la>0) this._prevAddAt[o.id]=la;
          else if(this._prevAddAt[o.id]==null) this._prevAddAt[o.id]=0;
        });
        if(newOrderCount>0 || newAddCount>0){
          try{ this.beep(); }catch(e){}
          try{ this.startAlarm(); }catch(e){}
          if(newOrderCount>0){
            toast('🔔 ออเดอร์ใหม่ '+newOrderCount+' รายการ');
            try{ this.pushNotify('ออเดอร์ใหม่ — ส้มตำนายหนึ่ง', 'มี '+newOrderCount+' ออเดอร์ใหม่'); }catch(e){}
          }
        }
      } else {
        this.seenIds=new Set(this.orders.map(o=>o.id));
        this.seenPaid=new Set(this.orders.filter(o=>o.paymentStatus==='PAID').map(o=>o.id));
        this.unviewed=new Set();
        this._blinkAdds=new Set();
        this._prevAddAt={};
        (this.orders||[]).forEach(o=>{
          this._prevAddAt[o.id]=Number(o.lastAddAt||0);
        });
        this.ready=true;
      }
      this.lastActive=active; this.renderOrders(); this.startEtaTicker();
      this.updateAlarmBadge();
    };
    const attach=(q, fallback)=>{
      this.unsub=q.onSnapshot(snap=>{
        const docs=snap.docs.map(d=>({id:d.id,...d.data()}));
        docs.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
        handle(docs);
      }, err=>{
        console.warn('orders snapshot', err);
        if(fallback) fallback();
        else toast('ฟังออเดอร์ไม่สำเร็จ: '+(err.message||err));
      });
    };
    attach(shopRef.collection('orders').orderBy('createdAt','desc').limit(300), ()=>{
      try{ if(this.unsub) this.unsub(); }catch(e){}
      attach(shopRef.collection('orders').limit(300), null);
    });
  },
  seenIds:new Set(),
  unviewed:new Set(),
  alarmTimer:null,
  startAlarm(){
    if(this.alarmTimer) return;
    this.beep();
    // เหลือเฉพาะเสียงบี๊บ — ไม่ใช้เสียงพูด
    this.alarmTimer=setInterval(()=>{
      if(this.unviewed.size===0){ this.stopAlarm(); return; }
      this.beep();
    }, 2500);
  },
  stopAlarm(){
    if(this.alarmTimer){ clearInterval(this.alarmTimer); this.alarmTimer=null; }
    if(this._voiceLoopTimer){ clearTimeout(this._voiceLoopTimer); this._voiceLoopTimer=null; }
  },
  markOrderViewed(id){
    if(!id) return;
    this.unviewed.delete(id);
    this.seenIds.add(id);
    const o=(this.orders||[]).find(x=>x.id===id);
    // ออเดอร์ใหม่ธรรมดา (ไม่มีเมนูเพิ่มค้าง) → เปิดดูแล้วหยุดกระพริบ
    // ถ้ามี hasNewItems ยังกระพริบต่อจนกดทำเสร็จแล้ว
    if(o && !o.hasNewItems){
      try{ if(this._blinkAdds) this._blinkAdds.delete(id); }catch(e){}
    }
    if(this.unviewed.size===0) this.stopAlarm();
    this.updateAlarmBadge();
    try{ this.renderOrders(); }catch(e){}
  },
  updateAlarmBadge(){
    const n=this.unviewed?this.unviewed.size:0;
    const badge=document.getElementById('orderBadge');
    // badge แสดง active อยู่แล้ว — เพิ่มแถบเตือนถ้ายังไม่ดู
    let bar=document.getElementById('alarmBar');
    if(!bar){
      bar=document.createElement('div');
      bar.id='alarmBar';
      bar.style.cssText='display:none;background:#C62828;color:#fff;text-align:center;padding:8px;font-weight:600;font-size:14px';
      const wrap=document.getElementById('panelOrders');
      if(wrap) wrap.insertBefore(bar, wrap.firstChild);
    }
    if(n>0){
      bar.style.display='block';
      bar.innerHTML='🔔 มีออเดอร์ใหม่ '+n+' รายการ ที่ยังไม่ได้เปิดดู — กดการ์ดออเดอร์เพื่อหยุดเสียง';
    } else {
      bar.style.display='none';
    }
  },
  isSomtumItem(item){
    const cat=String(item.catName||item.categoryName||item.cat||'').trim();
    if(/เมนูส้มตำ/i.test(cat)) return true;
    if(/^ส้มตำ$/i.test(cat) || /หมวด.?ส้มตำ/i.test(cat)) return true;
    if(cat) return false;
    const n=String(item.name||'');
    return /(ส้มตำ|^ตำ)/.test(n) && !/ยำ|ทอด|เครื่องดื่ม|ของทาน|กินคู่|ไข่เจียว|น้ำ/.test(n);
  },
  countSomtumQty(order){
    return (order.items||[]).reduce((s,it)=>{
      if(!this.isSomtumItem(it)) return s;
      return s+Number(it.qty||0);
    },0);
  },
  isKitchenStatus(st){
    return ['Pending','Cooking','AwaitingPayment'].includes(st);
  },
  /** นาทีครัว: คิวก่อนหน้า (ตาม kitchenSortAt) + เมนูที่ยังต้องทำของออเดอร์นี้ × 2 นาที/รายการส้มตำ */
  calcOrderEtaMinutes(order){
    if(!order || !this.isKitchenStatus(order.status)) return 0;
    const sortKey=o=>Number(o.kitchenSortAt!=null?o.kitchenSortAt:(o.createdAt||0));
    const myT=sortKey(order);
    const myId=order.id;
    const kitchen=(this.orders||[]).filter(o=>this.isKitchenStatus(o.status) && (o.items||[]).length>0);
    const ahead=kitchen.filter(o=>{
      if(o.id===myId) return false;
      const t=sortKey(o);
      if(t<myT) return true;
      if(t===myT && String(o.id)<String(myId)) return true;
      return false;
    });
    const somtumAhead=ahead.reduce((s,o)=>s+this.countSomtumQty(o),0);
    // เมนูที่ต้องทำของออเดอร์นี้:
    // - ถ้าเพิ่งสั่งเพิ่มหลังทำเสร็จ (returnedToKitchen + hasNewItems) → นับเฉพาะรอบใหม่
    // - ถ้ายังค้างครัวอยู่ → นับทั้งออเดอร์ (เมนูที่เหลือ+ที่เพิ่ม)
    let somtumMine=0;
    if(order.hasNewItems && order.returnedToKitchen && Number(order.lastAddRound)>0){
      somtumMine=(order.items||[]).reduce((s,it)=>{
        if(Number(it.addRound)!==Number(order.lastAddRound)) return s;
        if(!this.isSomtumItem(it)) return s;
        return s+Number(it.qty||0);
      },0);
      // ถ้าไม่มีส้มตำในรอบใหม่ อย่างน้อยนับรายการรอบใหม่ × 1 นาที/ชิ้น แทน
      if(somtumMine<=0){
        somtumMine=(order.items||[]).reduce((s,it)=>s+(Number(it.addRound)===Number(order.lastAddRound)?Number(it.qty||0):0),0);
      }
    } else if(order.hasNewItems && Number(order.lastAddRound)>0){
      // ยังอยู่ในครัวแล้วสั่งเพิ่ม → นับเมนูทั้งหมดที่ยังต้องทำ (ทั้งออเดอร์)
      somtumMine=this.countSomtumQty(order);
      if(somtumMine<=0) somtumMine=(order.items||[]).reduce((s,it)=>s+Number(it.qty||0),0);
    } else {
      somtumMine=this.countSomtumQty(order);
    }
    return (somtumAhead+somtumMine)*2;
  },
  formatEtaCountdown(order){
    if(!order || order.status==='Ready' || order.status==='Completed' || order.status==='Cancelled'){
      return '';
    }
    if(!this.isKitchenStatus(order.status)) return '';
    const mins=this.calcOrderEtaMinutes(order);
    if(mins<=0) return '<div class="eta-cd" style="margin-top:6px;font-size:12px;font-weight:700;color:#2E7D32">⏱ ถึงคิวแล้ว / ใกล้เสร็จ</div>';
    // นับถอยหลังจากจุดยึดเวลา (สั่งใหม่หรือสั่งเพิ่มล่าสุด) + นาทีจากเมนูที่เหลือ/คิวก่อนหน้า
    const anchor=Number(order.etaAnchorAt||order.lastAddAt||order.createdAt||Date.now());
    const endAt=anchor+mins*60000;
    const leftMs=endAt-Date.now();
    if(leftMs<=0) return '<div class="eta-cd" style="margin-top:6px;font-size:12px;font-weight:700;color:#C62828">⏱ เลยกำหนดแล้ว · เร่งทำ</div>';
    const leftMin=Math.ceil(leftMs/60000);
    const mm=Math.floor(leftMs/60000);
    const ss=Math.floor((leftMs%60000)/1000);
    const clock=String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0');
    return '<div class="eta-cd" data-end="'+endAt+'" style="margin-top:6px;font-size:12px;font-weight:700;color:#E65100">⏱ เหลือ ~'+leftMin+' นาที <span style="font-variant-numeric:tabular-nums">('+clock+')</span></div>';
  },
  startEtaTicker(){
    if(this._etaTicker) return;
    this._etaTicker=setInterval(()=>{
      try{
        // อัปเดตเฉพาะตัวเลขนับถอยหลังโดยไม่รีเรนเดอร์ทั้งกริด (เบา)
        document.querySelectorAll('.eta-cd[data-end]').forEach(el=>{
          const endAt=Number(el.getAttribute('data-end')||0);
          const leftMs=endAt-Date.now();
          if(leftMs<=0){
            el.style.color='#C62828';
            el.textContent='⏱ เลยกำหนดแล้ว · เร่งทำ';
            el.removeAttribute('data-end');
            return;
          }
          const leftMin=Math.ceil(leftMs/60000);
          const mm=Math.floor(leftMs/60000);
          const ss=Math.floor((leftMs%60000)/1000);
          const clock=String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0');
          el.textContent='⏱ เหลือ ~'+leftMin+' นาที ('+clock+')';
        });
      }catch(e){}
    }, 1000);
  },
  renderOrders(){
    const today=new Date(); today.setHours(0,0,0,0); const t0=today.getTime();
    // กรองออเดอร์ผีที่ไม่มีรายการเมนู (กันการ์ดค้างว่าง)
    let list=(this.orders||[]).filter(o=>o && (o.items||[]).length>0).slice();
    // เติมชื่อสมาชิกจาก cache ถ้าออเดอร์มีเบอร์แต่ยังไม่มีชื่อ (แสดงบนการ์ดทันที)
    try{
      const cache=this.membersCache||[];
      list.forEach(o=>{
        if(o.memberName) return;
        const ph=this.normPhone(o.memberPhone||o.contactPhone||'');
        if(!ph) return;
        const m=cache.find(x=>this.normPhone(x.phone||x.id)===ph);
        if(m){
          const nm=(String(m.firstName||'')+' '+String(m.lastName||'')).trim();
          if(nm) o.memberName=nm;
          if(!o.memberPhone) o.memberPhone=ph;
        }
      });
    }catch(e){}
    // กฎตามที่ร้านต้องการ:
    // kitchen = กำลังทำ (Pending/Cooking) — ส่งเข้าครัวทันทีทุกช่องทาง
    // unpaid = ยังไม่ชำระ (ทุกสถานะยกเว้น Completed/Cancelled)
    // paid = ชำระแล้ว (ยังไม่เสร็จ)
    // slip = พร้อมเพย์ + มีสลิปรอตรวจ
    // waitingPay = ทำเสร็จแล้ว (Ready) แต่ยังไม่จ่าย
    // ready = ทำเสร็จแล้ว + จ่ายแล้ว (พร้อมรับ)
    // โปรเซสร้าน: รอคิวทำ → กำลังทำ → ทำเสร็จแล้ว
    // จบสมบูรณ์ได้เฉพาะ ทำเสร็จแล้ว + จ่ายเงินแล้ว (status=Completed)
    // ข้อมูลเดิม: Pending/AwaitingPayment=รอคิว, Cooking=กำลังทำ, Ready=ทำเสร็จ, Completed=เสร็จสมบูรณ์
    const isQueue = o => ['Pending','AwaitingPayment'].includes(o.status);
    const isActive = o => o.status!=='Completed' && o.status!=='Cancelled';
    // ครัว = รอคิว + กำลังทำ เท่านั้น (ทำเสร็จแล้วออกจากครัว)
    // รอชำระเงิน = Ready + ยังไม่จ่าย
    // พร้อมรับ = Ready + จ่ายแล้ว
    // เสร็จสมบูรณ์ = Completed
    if(this.filterKey==='kitchen' || this.filterKey==='queue') list=list.filter(o=>['Pending','Cooking','AwaitingPayment'].includes(o.status) && (o.items||[]).length>0);
    else if(this.filterKey==='waitingPay') list=list.filter(o=>o.status==='Ready' && o.paymentStatus!=='PAID');
    else if(this.filterKey==='ready') list=list.filter(o=>o.status==='Ready' && o.paymentStatus==='PAID');
    else if(this.filterKey==='slip') list=list.filter(o=>o.status!=='Completed' && o.status!=='Cancelled' && (o.paymentMethod==='PROMPTPAY'||o.paymentMethod==='QR') && (o.slipStatus==='PENDING_REVIEW'||o.slipStatus==='AUTO_APPROVED'));
    else if(this.filterKey==='completed') list=list.filter(o=>o.status==='Completed');
    else if(this.filterKey==='cancelled') list=list.filter(o=>o.status==='Cancelled');
    else if(this.filterKey==='doneKitchen') list=list.filter(o=>o.status==='Ready');
    else if(this.filterKey==='allActive') list=list.filter(o=>o.status!=='Completed' && o.status!=='Cancelled');
    else if(this.filterKey==='unpaid') list=list.filter(o=>o.status!=='Completed' && o.status!=='Cancelled' && o.paymentStatus!=='PAID');
    else if(this.filterKey==='paid') list=list.filter(o=>o.status!=='Completed' && o.status!=='Cancelled' && o.paymentStatus==='PAID');
    // เรียงครัว: ใช้ kitchenSortAt (ออเดอร์กลับครัวหลังสั่งเพิ่มไปท้ายคิว)
    // ออเดอร์ที่ยังทำไม่เสร็จคงลำดับเดิม · ประวัติเรียงใหม่→เก่า
    if(this.filterKey==='completed'||this.filterKey==='cancelled'){
      list=list.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    } else {
      list=list.slice().sort((a,b)=>{
        const ka=Number(a.kitchenSortAt!=null?a.kitchenSortAt:(a.createdAt||0));
        const kb=Number(b.kitchenSortAt!=null?b.kitchenSortAt:(b.createdAt||0));
        if(ka!==kb) return ka-kb;
        return Number(a.createdAt||0)-Number(b.createdAt||0);
      });
    }
    const active=this.orders.filter(o=>o.status!=='Completed'&&o.status!=='Cancelled');
    const setTxt=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
    setTxt('sPending', active.filter(o=>['Pending','AwaitingPayment'].includes(o.status)).length);
    setTxt('sCooking', active.filter(o=>o.status==='Cooking').length);
    setTxt('sReady', active.filter(o=>o.status==='Ready').length);
    setTxt('sUnpaid', active.filter(o=>o.paymentStatus!=='PAID' && o.status==='Ready').length);
    const n=active.length;
    const badge=document.getElementById('orderBadge');
    if(badge){ if(n>0){badge.textContent=n;badge.classList.remove('hide')} else badge.classList.add('hide'); }
    const navB=document.getElementById('navOrderBadge');
    if(navB){ if(n>0){navB.textContent=n;navB.classList.remove('hide')} else navB.classList.add('hide'); }
    const g=document.getElementById('orderGrid');
    if(!list.length){g.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:40px;color:#888">ไม่มีออเดอร์</div>'; try{ this.renderTablesBoard(); }catch(e){} return}
    g.innerHTML=list.map(o=>{
      let prev=(o.items||[]).map(i=>i.name+' x'+i.qty).join(', '); if(prev.length>40) prev=prev.slice(0,40)+'…';
      const cov=calcPaymentCover(o);
      const alreadyPaid=cov.covered;
      const isPartial=o.paymentStatus!=='PAID' && (o.needsRepay || alreadyPaid>0 || cov.due>0);
      const due=isPartial?cov.due:0;
      const pay=o.paymentStatus==='PAID'?'<span style="background:#E8F5E9;color:#2E7D32;padding:2px 8px;border-radius:4px;font-size:12px">ชำระแล้ว</span>':(isPartial?('<span style="background:#FFF3E0;color:#E65100;padding:2px 8px;border-radius:4px;font-size:12px">ค้างส่วนต่าง ฿'+due+'</span>'):'<span style="background:#FFEBEE;color:#C62828;padding:2px 8px;border-radius:4px;font-size:12px">ยังไม่ชำระ</span>');
      const method = (o.paymentMethod==='CASH')
        ? '<span style="background:#E3F2FD;color:#1565C0;padding:2px 6px;border-radius:4px;font-size:11px">เงินสด</span>'
        : '<span style="background:#E8EAF6;color:#3949AB;padding:2px 6px;border-radius:4px;font-size:11px">พร้อมเพย์</span>';
      const slip=o.slipStatus==='PENDING_REVIEW'?' <span style="background:#FFF3E0;color:#E65100;padding:2px 6px;border-radius:4px;font-size:11px">รอตรวจสลิป</span>':(o.slipStatus==='APPROVED'||o.slipStatus==='AUTO_APPROVED'?' <span style="background:#E8F5E9;color:#2E7D32;padding:2px 6px;border-radius:4px;font-size:11px">สลิปผ่าน</span>':'');
      // กระพริบเฉพาะที่อยู่ใน _blinkAdds = ออเดอร์ใหม่ หรือเพิ่งมีเมนูเพิ่ม (ไม่กระพริบทุกใบ)
      const isAlert=!!(this._blinkAdds && this._blinkAdds.has(o.id));
      const tableTag=o.tableNo?(`<span style="background:#F3E5F5;color:#6A1B9A;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700">โต๊ะ ${o.tableNo}</span> `):'';
      const addTag=(isAlert && o.hasNewItems)?(' <span style="background:#FFEBEE;color:#C62828;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700">สั่งเพิ่ม!</span>'):(isAlert?' <span style="background:#FFEBEE;color:#C62828;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700">ใหม่</span>':'');
      return `<div class="oc ${esc(o.status||'')} ${isAlert?'oc-blink':''}" style="${isAlert?'box-shadow:0 0 0 3px #F44336;':''}" onclick="M.openDetail('${esc(o.id)}')">
        <div style="margin-bottom:4px">${tableTag}${addTag}</div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px"><div class="q">${esc(o.queue)}</div>
        <div style="text-align:right"><div style="color:#888;font-size:12px">${o.createdAt?new Date(o.createdAt).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}):''}</div>
        <div style="font-size:11px;font-weight:600;margin-top:2px;color:${o.status==='Cooking'?'#1565C0':o.status==='Ready'?'#2E7D32':'#E65100'}">${({Pending:'รอคิวทำ',AwaitingPayment:'รอคิวทำ',Cooking:'กำลังทำ',Ready:'ทำเสร็จแล้ว',Completed:'เสร็จสมบูรณ์',Cancelled:'ยกเลิก'})[o.status]||o.status}</div></div></div>
        <div style="margin:8px 0;color:#444">${esc(prev)}</div>
        ${o.memberPhone||o.memberName?`<div style="font-size:11px;color:#6A1B9A">👤 ${o.memberName?('สมาชิกคุณ '+esc(o.memberName)):esc(o.memberPhone||'')}${o.discountAmount?(' · ส่วนลด ฿'+o.discountAmount):''}</div>`: (o.contactPhone?`<div style="font-size:11px;color:#666">📞 ${esc(o.contactPhone)}</div>`:'')}
        ${this.formatEtaCountdown(o)}
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px"><strong style="color:var(--p);font-size:1.25rem">${money(o.total)}</strong><span style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">${method}${pay}${slip}</span></div></div>`;
    }).join('');
    // อัปเดตปุ่มเคลียร์โต๊ะเมื่อสถานะออเดอร์เปลี่ยน (เสร็จสมบูรณ์แล้วค่อยโชว์)
    try{ this.renderTablesBoard(); }catch(e){}
  },
  openDetail(id){
    this.markOrderViewed(id);
    const o=this.orders.find(x=>x.id===id); if(!o) return;
    // ซ่อมส่วนต่างจากข้อมูลเก่า (paidAmount รวมทอน) ด้วย addRound
    const cov=calcPaymentCover(o);
    if(o.needsRepay || (o.paymentStatus!=='PAID' && cov.due>0 && Number(o.paidAmount||0)>0)){
      if(Math.abs(Number(o.repayAmount||0) - cov.due) > 0.5 || Math.abs(Number(o.paidAmount||0) - cov.covered) > 0.5){
        // เขียนค่าที่ถูกต้องกลับ Firestore เงียบ ๆ (ลูกค้าจะอัปเดตตาม snapshot)
        shopRef.collection('orders').doc(id).update({
          paidAmount: cov.covered,
          repayAmount: cov.due,
          needsRepay: cov.due>0,
          paymentStatus: cov.due>0 ? 'UNPAID' : 'PAID'
        }).then(()=>{
          o.paidAmount=cov.covered; o.repayAmount=cov.due; o.needsRepay=cov.due>0;
          if(cov.due>0) o.paymentStatus='UNPAID';
        }).catch(function(){});
      }
    }
    const locked = o.status==='Completed' || o.status==='Cancelled';
    const items=(o.items||[]).map(i=>{
      const tops=(i.toppings||[]).map(t=>`${esc(t.name)} x${t.qty} (${money(t.total||t.price*t.qty)})`).join(', ');
      const spice=i.spiceName?esc(i.spiceName):'';
      const note=i.note?`<div style="font-size:12px;color:#E65100;margin-top:2px">📝 ${esc(i.note)}</div>`:'';
      const plara=i.plara?`<div style="font-size:12px;color:#555">🐟 ${esc(i.plara)}</div>`:'';
      const isAddLabel=(Number(i.addRound)>0);
      // ไฮไลท์เฉพาะรอบล่าสุดที่ยังไม่ทำเสร็จ (hasNewItems)
      const isNewAdd=!!o.hasNewItems && isAddLabel && Number(i.addRound)===Number(o.lastAddRound||0);
      const addL=isAddLabel?(`<div style="font-size:12px;font-weight:700;color:${isNewAdd?'#C62828':'#6A1B9A'};margin-top:2px">${isNewAdd?'🆕 ':''}${esc(i.addLabel||('สั่งเพิ่มครั้งที่ '+i.addRound))}</div>`):'';
      const meta=[spice,tops].filter(Boolean).join(' · ');
      const rowBg=isNewAdd?'background:#FFF3E0;border-left:4px solid #FF9800;padding-left:8px;border-radius:6px;':'';
      return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #eee;${rowBg}">
        <div><strong>${esc(i.name)} × ${i.qty}</strong>${addL}${meta?`<div style="font-size:12px;color:#777">${meta}</div>`:''}${plara||''}${note}</div>
        <div>${money(i.total)}</div></div>`;
    }).join('');
    const needSlip = o.slipStatus==='PENDING_REVIEW' || (o.slipData && o.paymentStatus!=='PAID');
    const slipBlock=o.slipData?`<div style="margin:12px 0;text-align:center">
      <div style="font-weight:600;margin-bottom:6px">สลิป (${esc(o.slipStatus||'')})</div>
      <img src="${o.slipData}" style="max-width:100%;border-radius:8px;border:1px solid #eee">
      ${needSlip && !locked?`<div style="margin-top:8px;padding:8px;background:#E3F2FD;border-radius:8px;font-size:13px;color:#1565C0;text-align:center">มีสลิปแนบแล้ว — กด「ยืนยันรับโอนแล้ว」ด้านล่างเมื่อตรวจยอดถูกต้อง</div>`:''}
    </div>`:(o.paymentStatus!=='PAID'&&!locked?`<div style="margin:10px 0;padding:10px;background:#FFF8E1;border-radius:8px;font-size:13px;text-align:center">ยังไม่มีสลิปจากลูกค้า</div>`:'');
    let statusBtns='';
    if(!locked){
      const paid=o.paymentStatus==='PAID';
      const canComplete=paid; // เสร็จสมบูรณ์ได้เฉพาะเมื่อจ่ายแล้ว
      statusBtns=`<div style="margin-top:12px;padding:10px;background:#FFF8F5;border-radius:10px;font-size:13px;color:#555">
        <strong style="color:var(--p)">ขั้นตอนครัว</strong>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:8px">
          <button class="btn btn-o ${o.status==='Pending'||o.status==='AwaitingPayment'?'status-hl':''}" onclick="M.setStatus('${esc(o.id)}','Pending')">⏳ รอคิวทำ</button>
          <button class="btn btn-i ${o.status==='Cooking'?'status-hl':''}" onclick="M.setStatus('${esc(o.id)}','Cooking')">🔵 กำลังทำ</button>
          <button class="btn btn-g ${o.status==='Ready'?'status-hl':''}" onclick="M.setStatus('${esc(o.id)}','Ready')">🟢 ทำเสร็จแล้ว</button>
        </div>
        <div style="margin-top:10px;padding-top:8px;border-top:1px dashed #ddd">
          <strong style="color:${paid?'#2E7D32':'#C62828'}">${paid?'✓ จ่ายเงินแล้ว':'ยังไม่จ่ายเงิน'}</strong>
          ${o.status==='Ready'&&!paid?'<div style="color:#E65100;margin-top:4px">ทำครัวเสร็จแล้ว — รอรับเงิน/ตรวจสลิป ก่อนปิดงาน</div>':''}
          ${canComplete?`<button class="btn btn-p btn-block" style="margin-top:8px" onclick="M.setStatus('${esc(o.id)}','Completed')">✅ เสร็จสมบูรณ์ (ทำเสร็จ+จ่ายแล้ว)</button>`:`<button class="btn btn-block" style="margin-top:8px;background:#eee;color:#999" disabled>✅ เสร็จสมบูรณ์ (ต้องจ่ายเงินก่อน)</button>`}
        </div>
      </div>`;
    } else {
      statusBtns=`<div style="margin-top:12px;padding:12px;background:#E8F5E9;border-radius:10px;text-align:center;font-weight:600;color:#2E7D32">ออเดอร์${o.status==='Completed'?'เสร็จสิ้น':'ถูกยกเลิก'}แล้ว — ไม่สามารถย้อนขั้นตอนได้</div>`;
    }
    const orderCode=String(o.id||'').slice(0,12);
    const changeAmt=Math.max(0, Number(o.changeAmount||0));
    const memberPhone=String(o.memberPhone||o.contactPhone||'').trim();
    let memberName=String(o.memberName||'').trim();
    // ถ้ามีเบอร์แต่ไม่มีชื่อ — ดึงจาก cache สมาชิกทันที
    if(!memberName && memberPhone){
      try{
        const m=(this.membersCache||[]).find(x=>this.normPhone(x.phone||x.id)===this.normPhone(memberPhone));
        if(m) memberName=(String(m.firstName||'')+' '+String(m.lastName||'')).trim();
      }catch(e){}
    }
    const changeBox=(o.paymentStatus==='PAID' && o.paymentMethod==='CASH' && changeAmt>0)
      ? `<div style="margin-top:12px;padding:14px;background:#E3F2FD;border:2px solid #1976D2;border-radius:12px;text-align:center">
          <div style="font-size:13px;color:#1565C0;font-weight:600">เงินทอน</div>
          <div style="font-size:2rem;font-weight:800;color:#0D47A1;letter-spacing:1px">${money(changeAmt)}</div>
          <div style="font-size:12px;color:#555;margin-top:4px">รับมา ${money(Number(o.paidAmount||0)+changeAmt)} · ยอดบิล ${money(o.total)}</div>
        </div>` : '';
    const memberHeader=memberPhone
      ? `<div style="margin:8px 0;padding:8px 10px;background:#F3E5F5;border-radius:8px;font-size:13px;text-align:center">
          <div style="font-weight:700;color:#6A1B9A">${memberName?('สมาชิกคุณ '+esc(memberName)):('สมาชิก '+esc(memberPhone))}</div>
          ${memberName?('<div style="font-size:12px;color:#888;margin-top:2px">'+esc(memberPhone)+'</div>'):''}
          ${Number(o.pointsUsed||0)>0||Number(o.couponDisc||0)>0||o.couponCode?`<div style="margin-top:4px;color:#555">ใช้แล้ว: ${Number(o.pointsUsed||0)>0?('แต้ม '+Number(o.pointsUsed)+' บาท'):''}${Number(o.couponDisc||0)>0||o.couponCode?(Number(o.pointsUsed||0)>0?' · ':'')+('คูปอง '+(o.couponCode||'')+' -฿'+Number(o.couponDisc||0)):''}</div>`:''}
        </div>` : '';
    (document.getElementById('detailBody')||{}).innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <button class="btn btn-o btn-sm" onclick="(function(){var m=document.getElementById('detailModal'); if(m) m.classList.remove('on');})()">← กลับ</button>
        <h2 style="color:var(--p)">คิว ${esc(o.queue)}</h2><div style="width:50px"></div>
      </div>
      <div style="text-align:center;font-size:12px;color:#888;margin-bottom:6px">รหัสการสั่งซื้อ: <strong style="color:#333;letter-spacing:0.5px">${esc(orderCode)}</strong></div>
      ${memberHeader}
      <div style="text-align:center;margin-bottom:12px"><div style="color:#777">ยอดรวม</div>
        <div style="font-size:2rem;font-weight:700;color:var(--p)">${money(o.total)}</div>
        <div style="margin-top:6px">${o.paymentMethod==='CASH'?'<span style="background:#E3F2FD;color:#1565C0;padding:2px 8px;border-radius:4px;font-size:12px;margin-right:6px">เงินสด</span>':'<span style="background:#FFF3E0;color:#E65100;padding:2px 8px;border-radius:4px;font-size:12px;margin-right:6px">พร้อมเพย์</span>'}${o.paymentStatus==='PAID'?'<span style="color:var(--g);font-weight:700">✓ ชำระแล้ว</span>':(cov.due>0?'<span style="color:#E65100;font-weight:700">ค้างส่วนต่าง ฿'+cov.due+'</span>':'<span style="color:var(--d);font-weight:700">ยังไม่ชำระ</span>')} · <span style="font-weight:600">${o.paymentMethod==='CASH'?'เงินสด':'พร้อมเพย์ / QR'}</span></div>
        ${changeBox}
        ${(o.paymentStatus!=='PAID' && cov.due>0)?`<div style="margin-top:10px;padding:12px;background:#FFF3E0;border:1px solid #FFB74D;border-radius:10px;text-align:center">
          <div style="font-size:13px;color:#E65100;font-weight:700">มีรายการเพิ่ม · เก็บส่วนต่าง <span style="font-size:1.25rem">฿${cov.due}</span></div>
          <div style="font-size:13px;color:#555;margin-top:6px">จ่ายแล้ว <strong style="color:#2E7D32">฿${cov.covered}</strong> · รวมบิล <strong>฿${cov.billTotal}</strong></div>
        </div>`:''}
      </div>
      ${items}${slipBlock}
      <div id="posMemberBox" style="display:none"></div>
      ${statusBtns}
      <div style="font-size:12px;color:#666;margin-top:6px;text-align:center">ขั้นตอนปัจจุบัน: <strong>${({AwaitingPayment:'รอคิวทำ',Pending:'รอคิวทำ',Cooking:'กำลังทำ',Ready:'ทำเสร็จแล้ว',Completed:'เสร็จสมบูรณ์',Cancelled:(o.cancelledBy==='customer'?'ยกเลิกโดยลูกค้า':(o.cancelledBy==='shop'?'ยกเลิกโดยร้าน':'ยกเลิก'))})[o.status]||o.status}</strong></div>
      ${!locked?`<button class="btn btn-d btn-block" style="margin-top:10px" onclick="M.cancelOrder('${esc(o.id)}')">ยกเลิกออเดอร์</button>`:''}
      ${!locked && o.paymentStatus!=='PAID'?`<div style="margin-top:12px">
        ${cov.due>0?`<div style="margin-bottom:8px;padding:10px;background:#FFF3E0;border:1px solid #FFB74D;border-radius:8px;font-size:13px;color:#E65100;text-align:center">เก็บส่วนต่าง <strong style="font-size:1.15rem">฿${cov.due}</strong><div style="font-size:12px;color:#555;margin-top:4px">จ่ายแล้ว ฿${cov.covered} / รวมบิล ฿${cov.billTotal}</div></div>`:''}
        <label class="lbl">รับเงินสด ${cov.due>0?'(ส่วนต่าง)':''}</label><input type="number" id="cashIn" placeholder="จำนวนที่รับ" inputmode="decimal" value="${cov.due>0?cov.due:''}">
        <button class="btn btn-g btn-block" style="margin-top:8px" onclick="M.payCash('${esc(o.id)}')">ยืนยันรับเงินสด</button>
        <button class="btn btn-i btn-block" style="margin-top:8px" onclick="M.payPP('${esc(o.id)}')">ยืนยันรับโอนแล้ว</button>
      </div>`:''}`;
    try{document.getElementById('detailModal').classList.add('on');}catch(e){}
    // ถ้ามีเบอร์แต่ยังไม่มีชื่อ — ดึงชื่อจาก members แล้วอัปเดตออเดอร์ + เปิด detail ใหม่ครั้งเดียว
    if(memberPhone && !memberName && this._posNameFetchId!==o.id){
      this._posNameFetchId=o.id;
      const oid=o.id;
      const ph=this.normPhone(memberPhone);
      shopRef.collection('members').doc(ph).get().then(snap=>{
        if(!snap.exists) return;
        const md=snap.data()||{};
        const nm=(String(md.firstName||'')+' '+String(md.lastName||'')).trim();
        if(!nm) return;
        const idx=this.orders.findIndex(x=>x.id===oid);
        if(idx>=0){ this.orders[idx].memberName=nm; this.orders[idx].memberPhone=ph; }
        // เติม cache ด้วย
        try{
          const c=this.membersCache||[];
          const ci=c.findIndex(x=>this.normPhone(x.phone||x.id)===ph);
          if(ci>=0){ c[ci].firstName=md.firstName; c[ci].lastName=md.lastName; }
          else { c.push({id:ph, phone:ph, ...md}); this.membersCache=c; }
        }catch(e){}
        shopRef.collection('orders').doc(oid).update({ memberName:nm, memberPhone:ph }).catch(()=>{});
        try{ this.renderOrders(); }catch(e){}
        // รีเฟรช detail เฉพาะเมื่อยังเปิดออเดอร์นี้อยู่ (ครั้งเดียว เพราะมีชื่อแล้วจะไม่ fetch ซ้ำ)
        try{
          const modal=document.getElementById('detailModal');
          if(modal && modal.classList.contains('on')){
            const cur=this.orders.find(x=>x.id===oid);
            if(cur && cur.memberName) this.openDetail(oid);
          }
        }catch(e){}
      }).catch(()=>{});
    }
    // โหลดข้อมูลสมาชิก (แต้ม/คูปอง) ให้ร้านใช้ส่วนลดแทนลูกค้า
    if(memberPhone && o.paymentStatus!=='PAID' && !locked){
      try{ this.loadPosMemberPanel(o); }catch(e){ console.warn('loadPosMemberPanel', e); }
    }
  },
  async setStatus(id,status){
    const cur=this.orders.find(x=>x.id===id);
    if(cur && (cur.status==='Completed' || cur.statusLocked)){
      toast('ออเดอร์นี้เสร็จสมบูรณ์แล้ว ย้อนขั้นตอนไม่ได้');
      return;
    }
    // โปรเซสครัว: Pending(รอคิว) → Cooking(กำลังทำ) → Ready(ทำเสร็จแล้ว)
    // Completed(เสร็จสมบูรณ์) ได้เฉพาะเมื่อ จ่ายเงินแล้ว + ครัวทำเสร็จแล้ว (หรือกำลังทำ/รอคิวแล้วแต่จ่ายแล้วก็ได้ถ้าต้องการปิด)
    if(status==='Completed'){
      if(!cur || cur.paymentStatus!=='PAID'){
        toast('ยังไม่จ่ายเงิน — ปิดออเดอร์เป็นเสร็จสมบูรณ์ไม่ได้');
        return;
      }
      // แนะนำให้ทำครัวเสร็จก่อน แต่ถ้าร้านกดปิดทั้งที่จ่ายแล้ว อนุญาตได้หลัง Ready
      if(cur.status!=='Ready' && cur.status!=='Cooking' && cur.status!=='Pending' && cur.status!=='AwaitingPayment'){
        toast('สถานะไม่อนุญาตให้ปิดงาน');
        return;
      }
      if(cur.status!=='Ready'){
        // บังคับเป็น Ready ก่อนบันทึก Completed เพื่อความสอดคล้องของข้อมูล
        await shopRef.collection('orders').doc(id).update({status:'Ready'});
      }
    }
    const patch={status};
    if(status==='Completed'){
      patch.completedAt=Date.now();
      patch.statusLocked=true;
    }
    if(status==='Ready'){
      // ทำเสร็จแล้วเท่านั้น → ยกเลิกไฮไลท์/กระพริบ (เหลือป้าย「สั่งเพิ่มครั้งที่ N」)
      // เปิดดูออเดอร์อย่างเดียวจะไม่เคลียร์ — เคลียร์ตรงนี้เท่านั้น
      patch.hasNewItems=false;
      patch.returnedToKitchen=false;
      patch.newItemsAckAt=Date.now();
      try{ if(this._blinkAdds) this._blinkAdds.delete(id); }catch(e){}
    }
    // เมื่อกด「กำลังทำ」→ หยุดกระพริบ/เสียงเตือนของออเดอร์ใหม่ทันที
    if(status==='Cooking'){
      try{ if(this._blinkAdds) this._blinkAdds.delete(id); }catch(e){}
      try{ if(this.unviewed) this.unviewed.delete(id); }catch(e){}
      try{ if(this.unviewed && this.unviewed.size===0) this.stopAlarm(); }catch(e){}
      try{ this.updateAlarmBadge(); }catch(e){}
    }
    await shopRef.collection('orders').doc(id).update(patch);
    // sync local
    const idx=this.orders.findIndex(x=>x.id===id);
    if(idx>=0) this.orders[idx]=Object.assign({}, this.orders[idx], patch);

    // เสร็จสมบูรณ์ + โหมดโต๊ะ → ปลดโต๊ะอัตโนมัติ (ร้านไม่ต้องกดเคลียร์เอง)
    if(status==='Completed'){
      try{
        const tNo = cur && cur.tableNo;
        if(tNo!=null && tNo!==''){
          const tref=shopRef.collection('tables').doc(String(tNo));
          const ts=await tref.get();
          const td=ts.exists?ts.data():{};
          if(!td.activeOrderId || td.activeOrderId===id){
            await tref.set({activeOrderId:null, status:'free', callStaff:false, updatedAt:Date.now()},{merge:true});
            toast('เสร็จสมบูรณ์ · ปลดโต๊ะ '+tNo+' แล้ว');
          }
        }
      }catch(e){ console.warn('auto free table on complete', e); }
    }

    if(status==='Ready'){
      // ทำเสร็จแล้ว → ปิดการ์ดทันที ออกจากครัว
      const paid = (cur && cur.paymentStatus==='PAID') || patch.paymentStatus==='PAID';
      (function(){var m=document.getElementById('detailModal'); if(m) m.classList.remove('on');})();
      this.renderOrders();
      toast(paid ? 'ทำเสร็จแล้ว → เก็บที่「พร้อมรับ」' : 'ทำเสร็จแล้ว → เก็บที่「รอชำระเงิน」');
      return;
    }
    if(status==='Completed'){
      (function(){var m=document.getElementById('detailModal'); if(m) m.classList.remove('on');})();
      this.renderOrders();
      toast('เสร็จสมบูรณ์ · บันทึกในประวัติ');
      return;
    }
    const labels={Pending:'รอคิวทำ',Cooking:'กำลังทำ',Ready:'ทำเสร็จแล้ว',Completed:'เสร็จสมบูรณ์'};
    toast('อัปเดต: '+(labels[status]||status));
    this.openDetail(id);
  },
  async cancelOrder(id){
    if(!confirm('ยืนยันยกเลิกออเดอร์นี้?')) return;
    const order=(this.orders||[]).find(o=>o.id===id) || null;
    if(order && (order.status==='Cancelled' || order.status==='Completed')){
      toast(order.status==='Completed'?'ออเดอร์เสร็จสมบูรณ์แล้ว ยกเลิกไม่ได้':'ออเดอร์นี้ยกเลิกไปแล้ว');
      return;
    }
    // ยกเลิก + คืนแต้ม/คูปอง + ปลดโต๊ะใน transaction เดียวกัน
    try{
      await db.runTransaction(async tx=>{
        const oref=shopRef.collection('orders').doc(id);
        const os=await tx.get(oref);
        if(!os.exists) throw new Error('ไม่พบออเดอร์');
        const cur=os.data()||{};
        if(cur.status==='Completed' || cur.status==='Cancelled') return;

        const phone=this.normPhone(cur.memberPhone||'');
        const ptsUsed=Math.max(0,Number(cur.pointsUsed||cur.pointsDisc||0));
        const earned=Math.max(0,Number(cur.pointsEarned||0));
        const publicCode=String(cur.couponCode||'').trim().toUpperCase();
        const isPublicCoupon=!!publicCode && !publicCode.startsWith('PERSONAL:');
        const personalId=String(cur.personalCouponId||'');
        const mref=phone?shopRef.collection('members').doc(phone):null;
        const cref=isPublicCoupon?shopRef.collection('coupons').doc(publicCode):null;
        const tNo=cur.tableNo;
        const tref=(tNo!=null && tNo!=='')?shopRef.collection('tables').doc(String(tNo)):null;
        let ms=null, cs=null, ts=null;
        if(mref && (ptsUsed>0 || personalId || (earned>0 && cur.pointsAwarded && !cur.pointsRefunded))) ms=await tx.get(mref);
        if(cref) cs=await tx.get(cref);
        if(tref) ts=await tx.get(tref);

        if(ms && ms.exists){
          const md=ms.data()||{};
          const patch={updatedAt:Date.now()};
          let p=Number(md.points||0);
          if(ptsUsed>0) p+=ptsUsed;
          if(earned>0 && cur.pointsAwarded && !cur.pointsRefunded) p=Math.max(0,p-earned);
          if(ptsUsed>0 || earned>0) patch.points=p;
          if(earned>0 && cur.pointsAwarded && !cur.pointsRefunded){
            patch.totalSpent=Math.max(0,Number(md.totalSpent||0)-Math.max(0,Number(cur.total||0)));
            patch.orderCount=Math.max(0,Number(md.orderCount||0)-1);
          }
          if(personalId && Array.isArray(md.personalCoupons)){
            patch.personalCoupons=md.personalCoupons.map(c=>c&&String(c.id)===personalId&&c.used?Object.assign({},c,{used:false,usedAt:null}):c);
          }
          tx.update(mref,patch);
        }
        if(cs && cs.exists && isPublicCoupon){
          const cd=cs.data()||{};
          tx.update(cref,{usedCount:Math.max(0,Number(cd.usedCount||0)-1),updatedAt:Date.now()});
        }
        const orderPatch={status:'Cancelled',cancelledAt:Date.now(),cancelledBy:'shop',benefitsRefunded:true,updatedAt:Date.now()};
        if(earned>0 && cur.pointsAwarded && !cur.pointsRefunded) orderPatch.pointsRefunded=true;
        tx.update(oref,orderPatch);
        if(tref && ts && ts.exists){
          const td=ts.data()||{};
          if(td.activeOrderId===id) tx.set(tref,{activeOrderId:null,status:'free',callStaff:false,updatedAt:Date.now()},{merge:true});
        }
      });
    }catch(e){ toast('ยกเลิกไม่สำเร็จ: '+(e.message||e)); return; }
    toast('ยกเลิกโดยร้านแล้ว');
    (function(){var m=document.getElementById('detailModal'); if(m) m.classList.remove('on');})();
  },
  async refundMemberBenefits(o){
    if(!o) return;
    const phone=this.normPhone(o.memberPhone||'');
    const pts=Number(o.pointsUsed||o.pointsDisc||0);
    const pcid=o.personalCouponId||'';
    const pubCode=String(o.couponCode||'').trim().toUpperCase();
    const isPub=pubCode && !String(pubCode).startsWith('PERSONAL:');
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
    const pts=Math.max(0, Math.floor(Number((document.getElementById('admMemPts')||{}).value||0)));
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
      toast('เพิ่มสมาชิกสำเร็จ');
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
    const receipt={
      id:order.id, orderId:order.id, queue:order.queue,
      shopName:pub.shopName||'ร้าน', accountName:pub.accountName||'',
      items:order.items||[], total:order.total,
      paymentMethod:order.paymentMethod, paidAmount:order.paidAmount||order.total,
      changeAmount:order.changeAmount||0, paidAt:order.paidAt||Date.now(), createdAt:order.createdAt||Date.now(),
      memberName: order.memberName||'',
      memberPhone: order.memberPhone||order.contactPhone||'',
      contactPhone: order.contactPhone||'',
      pointsEarned: Number(order.pointsEarned||0),
      pointsUsed: Number(order.pointsUsed||order.pointsDisc||0),
      pointsDisc: Number(order.pointsDisc||order.pointsUsed||0),
      couponCode: order.couponCode||'',
      couponDisc: Number(order.couponDisc||0),
      discountAmount: Number(order.discountAmount||0),
      personalCouponId: order.personalCouponId||'',
      orderCode: order.orderCode||order.id||'',
      tableNo: order.tableNo||null,
      orderMode: order.orderMode||''
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
    let o=this.orders.find(x=>x.id===id) || null;
    if(!o){
      try{
        const snap=await shopRef.collection('orders').doc(id).get();
        if(snap.exists) o={id, ...snap.data()};
      }catch(e){}
    }
    if(!r && o){ await this.writeReceipt({id, ...o}); r=(await shopRef.collection('receipts').doc(id).get()).data(); }
    if(!r && o){
      r={
        queue:o.queue, shopName:document.getElementById('shopTitle')?.textContent||'ร้าน',
        items:o.items||[], total:o.total, paymentMethod:o.paymentMethod,
        paidAmount:o.paidAmount||o.total, changeAmount:o.changeAmount||0,
        paidAt:o.paidAt||o.createdAt, createdAt:o.createdAt,
        memberName:o.memberName||'', memberPhone:o.memberPhone||o.contactPhone||'',
        orderCode:o.orderCode||o.id||'',
        pointsEarned:o.pointsEarned||0, pointsUsed:o.pointsUsed||o.pointsDisc||0,
        couponCode:o.couponCode||'', couponDisc:o.couponDisc||0, discountAmount:o.discountAmount||0
      };
    }
    if(!r){ toast('ยังไม่มีใบเสร็จ'); return; }

    // รวมข้อมูลสมาชิกจาก order ถ้า receipt เก่าไม่มี
    const memberPhone = this.normPhone(r.memberPhone || (o&&(o.memberPhone||o.contactPhone)) || '');
    let memberName = String(r.memberName || (o&&o.memberName) || '').trim();
    const pointsUsed = Math.max(0, Number(r.pointsUsed||r.pointsDisc||(o&&(o.pointsUsed||o.pointsDisc))||0));
    const pointsEarned = Math.max(0, Number(r.pointsEarned||(o&&o.pointsEarned)||0));
    const couponCode = String(r.couponCode||(o&&o.couponCode)||'').trim();
    const couponDisc = Math.max(0, Number(r.couponDisc||(o&&o.couponDisc)||0));
    const discountAmount = Math.max(0, Number(r.discountAmount||(o&&o.discountAmount)||0));

    const items = r.items || (o && o.items) || [];
    const lines = items.map(i=>{
      const tops=(i.toppings||[]).map(t=>`${esc(t.name)} x${t.qty}`).join(', ');
      const spice=i.spiceName?`<div class="meta">🌶️ เผ็ด: ${esc(i.spiceName)}</div>`:'';
      const plara=i.plara?`<div class="meta">🐟 ${esc(i.plara)}</div>`:'';
      const note=i.note?`<div class="meta note">📝 ${esc(i.note)}</div>`:'';
      const topLine=tops?`<div class="meta">+ ${esc(tops)}</div>`:'';
      return `<div class="rc-line">
        <div><strong>${esc(i.name)} × ${i.qty}</strong>${spice}${plara}${topLine}${note}</div>
        <div class="rc-amt">${money(i.total)}</div>
      </div>`;
    }).join('');

    const shopName = r.shopName || document.getElementById('shopTitle')?.textContent || 'ร้าน';
    const queue = r.queue || (o && o.queue) || '';
    const orderCode = r.orderCode || (o && (o.orderCode||o.id)) || id;
    const paidAt = r.paidAt || r.createdAt || Date.now();
    const payMethod = (r.paymentMethod==='CASH') ? 'เงินสด (ที่ร้าน)' : 'พร้อมเพย์ / QR';
    const changeLine = Number(r.changeAmount||0)>0
      ? `<div class="rc-pay pay-change">เงินทอน: ${money(r.changeAmount)}</div>` : '';

    // ส่วนลด / แต้มที่ใช้ในออเดอร์นี้
    let discountLines = '';
    if(pointsUsed>0 || couponDisc>0 || discountAmount>0 || couponCode){
      const parts=[];
      if(pointsUsed>0) parts.push('ใช้แต้ม '+pointsUsed+' บาท');
      if(couponCode || couponDisc>0) parts.push('คูปอง '+(couponCode||'')+(couponDisc>0?(' -฿'+couponDisc):''));
      if(discountAmount>0 && discountAmount!==(pointsUsed+couponDisc)) parts.push('ส่วนลดรวม ฿'+discountAmount);
      discountLines = `<div class="rc-pay rc-discount">ส่วนลด: ${esc(parts.join(' · '))}</div>`;
    }

    // บล็อกสมาชิก (โหลดแต้มคงเหลือจาก members)
    let memberBlock = '<div id="posReceiptMemberBenefits" class="rc-member-box">กำลังโหลดสิทธิ์สมาชิก…</div>';
    if(!memberPhone){
      memberBlock = '';
    }

    const memberLine = (memberName || memberPhone)
      ? `<div class="rc-meta">สมาชิก: ${esc(memberName||'')} ${memberPhone?'('+esc(memberPhone)+')':''}</div>`
      : '';

    const receiptHtml = `<div id="receiptPrintContent" class="receipt receipt-print">
      <h3>${esc(shopName)}</h3>
      <div class="rc-sub ok">ใบเสร็จรับเงิน</div>
      <div class="rc-queue">คิว ${esc(queue)}</div>
      <div class="rc-meta">รหัสการสั่งซื้อ: <strong>${esc(String(orderCode).slice(0,16))}</strong></div>
      <div class="rc-meta">${new Date(paidAt).toLocaleString('th-TH')}</div>
      ${memberLine}
      ${lines || '<div class="rc-empty">ไม่มีรายการ</div>'}
      <div class="rc-total">
        <span>รวมทั้งสิ้น</span><span class="rc-total-amt">${money(r.total)}</span>
      </div>
      <div class="rc-pay">ชำระ: ${payMethod} · ชำระแล้ว</div>
      ${changeLine}
      ${discountLines}
      ${memberBlock}
    </div>`;

    this._lastReceiptHtml = receiptHtml;
    this._lastReceiptOrderId = id;
    this._lastReceiptPhone = memberPhone;
    this._lastReceiptPoints = { used: pointsUsed, earned: pointsEarned, name: memberName };
    try{ document.getElementById('detailModal').classList.add('on'); }catch(e){}
    (document.getElementById('detailBody')||{}).innerHTML = `
      <button type="button" class="btn btn-o btn-sm" onclick="(function(){var m=document.getElementById('detailModal'); if(m) m.classList.remove('on');})()">← ปิด</button>
      <div class="receipt-wrap">${receiptHtml}</div>
      <button type="button" class="btn btn-g btn-block btn-mt" onclick="M.printReceiptNow()">🖨️ พิมพ์ใบเสร็จ</button>`;

    // โหลดแต้มคงเหลือ + คูปองส่วนตัวเหมือนฝั่งลูกค้า
    if(memberPhone){
      try{ await this.fillPosReceiptMemberBenefits(memberPhone, pointsUsed, pointsEarned, memberName); }catch(e){ console.warn(e); }
    }
  },
  async fillPosReceiptMemberBenefits(phone, pointsUsed, pointsEarned, memberName){
    const el=document.getElementById('posReceiptMemberBenefits');
    if(!el) return;
    phone=this.normPhone(phone);
    if(!phone){ el.style.display='none'; return; }
    try{
      const snap=await shopRef.collection('members').doc(phone).get();
      let pts=0, coupons=[], name=String(memberName||'').trim();
      if(snap.exists){
        const md=snap.data()||{};
        pts=Math.max(0, Math.floor(Number(md.points||0)));
        if(!name) name=(String(md.firstName||'')+' '+String(md.lastName||'')).trim();
        const now=Date.now();
        coupons=(Array.isArray(md.personalCoupons)?md.personalCoupons:[]).filter(c=>c&&!c.used&&(!c.expiresAt||Number(c.expiresAt)>now));
      }
      let html='<div class="rc-member-inner">';
      html+='<div class="rc-member-title">👤 สมาชิก'+(name?(' · '+esc(name)):'')+'</div>';
      html+='<div class="rc-member-row">แต้มคงเหลือ: <strong>'+pts+'</strong> แต้ม</div>';
      if(Number(pointsUsed)>0) html+='<div class="rc-member-row">ใช้ในออเดอร์นี้: <strong>'+Number(pointsUsed)+'</strong> แต้ม</div>';
      if(Number(pointsEarned)>0) html+='<div class="rc-member-row ok">ได้รับในออเดอร์นี้: <strong>+'+Number(pointsEarned)+'</strong> แต้ม</div>';
      if(coupons.length){
        html+='<div class="rc-member-row">คูปองส่วนตัวคงเหลือ: '+coupons.length+' ใบ</div>';
        html+='<ul class="rc-coupon-list">'+coupons.slice(0,5).map(c=>'<li>'+esc(c.code||c.id||'คูปอง')+(c.value?(' · '+(c.type==='percent'?c.value+'%':('฿'+c.value))):'')+'</li>').join('')+'</ul>';
      } else {
        html+='<div class="rc-member-muted">ไม่มีคูปองส่วนตัวคงเหลือ</div>';
      }
      html+='</div>';
      el.innerHTML=html;
      el.style.display='block';
      // อัปเดต HTML สำหรับพิมพ์
      try{
        const box=document.getElementById('receiptPrintContent');
        if(box) this._lastReceiptHtml = box.outerHTML;
      }catch(e){}
    }catch(e){
      console.warn('fillPosReceiptMemberBenefits', e);
      el.innerHTML='<div class="rc-member-muted">โหลดข้อมูลสมาชิกไม่สำเร็จ</div>';
    }
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
    const range=document.getElementById('reportRange').value;
    const now=Date.now(); let from=0;
    if(range==='today'){const t=new Date();t.setHours(0,0,0,0);from=t.getTime()}
    else if(range==='7d') from=now-7*864e5;
    else if(range==='30d') from=now-30*864e5;
    // ออเดอร์ในช่วงเวลา
    const list=this.orders.filter(o=>(o.createdAt||0)>=from);
    // ยอดขายจริง = ชำระเงินแล้วเท่านั้น (PAID) — ไม่นับออเดอร์ค้าง/ยกเลิก
    const paid=list.filter(o=>o.paymentStatus==='PAID');
    // เสร็จสมบูรณ์ = Completed + PAID (สำหรับสถิติปิดงาน)
    const completed=list.filter(o=>o.status==='Completed' && o.paymentStatus==='PAID');
    const cash=paid.filter(o=>o.paymentMethod==='CASH').reduce((s,o)=>s+Number(o.paidAmount!=null?o.paidAmount:o.total||0),0);
    const pp=paid.filter(o=>o.paymentMethod==='PROMPTPAY'||o.paymentMethod==='QR'||o.paymentMethod==='KSHOP').reduce((s,o)=>s+Number(o.paidAmount!=null?o.paidAmount:o.total||0),0);
    const pointsUsedTotal=paid.reduce((s,o)=>s+Number(o.pointsUsed||o.pointsDisc||0),0);
    const couponDiscTotal=paid.reduce((s,o)=>s+Number(o.couponDisc||0),0);
    const discountTotal=paid.reduce((s,o)=>s+Number(o.discountAmount||0),0);
    const salesPaid=paid.reduce((s,o)=>s+Number(o.paidAmount!=null?o.paidAmount:o.total||0),0);
    document.getElementById('reportBox').innerHTML=`
      <div class="rc"><div class="v">${money(salesPaid)}</div><div class="l">ยอดรับเงินจริง (ชำระแล้ว)</div></div>
      <div class="rc"><div class="v">${paid.length}</div><div class="l">ออเดอร์ชำระแล้ว</div></div>
      <div class="rc"><div class="v">${completed.length}</div><div class="l">เสร็จสมบูรณ์</div></div>
      <div class="rc"><div class="v">${list.length}</div><div class="l">ออเดอร์ทั้งหมด (รวมค้าง)</div></div>
      <div class="rc"><div class="v">${money(cash)}</div><div class="l">เงินสด</div></div>
      <div class="rc"><div class="v">${money(pp)}</div><div class="l">พร้อมเพย์ / QR</div></div>
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
    const sec=await shopRef.collection('settings').doc('secure').get();
    const hash=sec.exists?sec.data().pinHash:'';
    if(hash && await sha256(old)!==hash){toast('PIN ปัจจุบันไม่ถูกต้อง');return}
    await shopRef.collection('settings').doc('secure').set({pinHash:await sha256(p1)},{merge:true});
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
};

document.getElementById('pinIn').addEventListener('keydown',e=>{if(e.key==='Enter')M.login()});

M.boot().catch(function(e){ console.error(e); toast("เริ่มไม่สำเร็จ: "+(e.message||e)); });
