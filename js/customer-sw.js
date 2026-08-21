(function(){
  // ลูกค้า: ลงทะเบียน SW เพื่อ offline ได้ แต่ไม่แสดงปุ่มติดตั้งแอป
  // การติดตั้งแอปทำได้เฉพาะหน้า POS ร้านค้าเท่านั้น
  // ใช้ getRegistration ก่อนเพื่อลดการชน scope กับ firebase-messaging-sw / pos
  if('serviceWorker' in navigator){
    window.addEventListener('load', function(){
      navigator.serviceWorker.getRegistration('./').then(function(existing){
        if(existing && existing.active) return existing;
        return navigator.serviceWorker.register('./sw.js', { scope: './' });
      }).catch(function(){});
    });
  }
})();
