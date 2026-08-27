/**
 * Somtum1POS — boot / orders / kitchen / cancel
 * Split from pos.js (lines 84-1047)
 */
/* global M, db, shopRef, esc, money, toast, uid, sha256, calcPaymentCover, fileToDataUrl, PP */
(function () {
  'use strict';
  window.M = window.M || {};
  Object.assign(window.M, {

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
          queueCounter:1,
          mustChangePin: true
        },{merge:true});
      } else {
        // ถ้ายังเป็น PIN เริ่มต้น 1234 → บังคับเปลี่ยน
        try{
          const h = (sec.data()||{}).pinHash || '';
          if(h && h === await sha256('1234') && (sec.data()||{}).mustChangePin !== false){
            await shopRef.collection('settings').doc('secure').set({ mustChangePin: true }, {merge:true});
          }
        }catch(e){}
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
        const must = !!(s.exists && (s.data()||{}).mustChangePin);
        const isDefault = (inputHash === await sha256('1234'));
        this.enter();
        if(must || isDefault){
          toast('กรุณาเปลี่ยน PIN เริ่มต้นทันที เพื่อความปลอดภัย');
          try{
            this.tab('settings');
            const el=document.getElementById('setPinOld');
            if(el){ el.value=input; el.scrollIntoView({behavior:'smooth',block:'center'}); }
          }catch(e){}
        } else {
          toast('เข้าสู่ระบบแล้ว');
        }
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
    this.audio=new (window.AudioContext||window.webkitAudioContext)();
    this.audio.resume().then(()=>{
      this.audioOn=true;
      const bar=document.getElementById('audioBar');
      if(bar) bar.classList.add('hide');
      toast('เปิดเสียงแจ้งเตือนแล้ว');
      this.beep();
    });
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
    if(!this.audioOn||!this.audio)return;
    try{const o=this.audio.createOscillator(),g=this.audio.createGain();o.connect(g);g.connect(this.audio.destination);o.frequency.value=880;g.gain.value=.12;o.start();o.stop(this.audio.currentTime+.2);if(navigator.vibrate)navigator.vibrate([200,60,200])}catch(e){}
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
  });
})();
