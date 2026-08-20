(function(){
  // ลูกค้า: ลงทะเบียน SW เพื่อ offline ได้ แต่ไม่แสดงปุ่มติดตั้งแอป
  // การติดตั้งแอปทำได้เฉพาะหน้า POS ร้านค้าเท่านั้น
  if('serviceWorker' in navigator){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function(){});
    });
  }
})();
