(function(){
  if('serviceWorker' in navigator){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function(){});
    });
  }
  window.deferredPwaPrompt = null;
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    window.deferredPwaPrompt = e;
    var b = document.getElementById('btnInstallApp');
    if(b) b.style.display = 'inline-flex';
  });
  window.addEventListener('appinstalled', function(){
    window.deferredPwaPrompt = null;
    var b = document.getElementById('btnInstallApp');
    if(b) b.style.display = 'none';
  });
})();
