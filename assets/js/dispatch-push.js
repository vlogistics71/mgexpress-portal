(()=>{
  'use strict';
  const box=document.createElement('section');
  box.id='dispatch-push-panel';
  box.hidden=true;
  box.style.cssText='background:#fff;border:1px solid #dce3da;border-radius:18px;padding:16px;margin:0 0 18px;color:#1c2821;font:inherit';
  box.innerHTML='<strong>Phone notifications</strong><p style="margin:6px 0 12px">Get alerts for incoming calls and new online quotes.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" data-enable>Enable notifications</button><button type="button" data-test hidden>Send test</button><button type="button" data-disable hidden>Turn off on this device</button></div><p data-status role="status" style="font-size:14px;margin:10px 0 0">Notifications are off on this device.</p>';
  document.querySelector('main')?.prepend(box);
  const enable=box.querySelector('[data-enable]'),test=box.querySelector('[data-test]'),disable=box.querySelector('[data-disable]'),status=box.querySelector('[data-status]');
  box.querySelectorAll('button').forEach(b=>b.style.cssText='border:1px solid #c8d2c3;border-radius:12px;padding:10px 14px;background:#e3f3a6;color:#18251b;font:inherit;cursor:pointer');
  let registration,subscription;
  async function api(method,body){
    const result=await window.mgSupabase.auth.getSession();
    const token=result.data?.session?.access_token;
    if(!token)throw Error('Sign in to dispatch first.');
    const response=await fetch('/.netlify/functions/dispatch-push',{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to set up notifications.');return data;
  }
  function buttons(on){test.hidden=disable.hidden=!on;enable.hidden=on;}
  async function busy(action){enable.disabled=test.disabled=disable.disabled=true;try{await action();}catch(e){status.textContent=e.message;}finally{enable.disabled=test.disabled=disable.disabled=false;}}
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)) {status.textContent='Open this dashboard in Chrome on Android to enable phone notifications.';enable.disabled=true;return;}
  function keyBytes(key){const raw=atob(key.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
  enable.addEventListener('click',()=>{
    // Request permission directly from the tap, before awaiting network requests.
    const permission=Notification.requestPermission();
    busy(async()=>{
      if(await permission!=='granted')throw Error('Notifications are blocked. In Chrome, open site settings → Notifications → Allow, then try again.');
      const config=await api('GET');
      registration=await navigator.serviceWorker.register('/dispatch-push-sw.js');
      await navigator.serviceWorker.ready;
      subscription=await registration.pushManager.getSubscription();
      if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(config.publicKey)});
      await api('POST',{action:'enable',subscription:subscription.toJSON()});
      buttons(true);status.textContent='Enabled on this device. Tap Send test and check your Android notifications.';
    });
  });
  test.addEventListener('click',()=>busy(async()=>{await api('POST',{action:'test',subscription:subscription.toJSON()});status.textContent='Test sent to your push service. Check your Android notifications.';}));
  disable.addEventListener('click',()=>busy(async()=>{await api('POST',{action:'disable',subscription:subscription.toJSON()});await subscription.unsubscribe();subscription=null;buttons(false);status.textContent='Notifications are off on this device.';}));
  (async()=>{
    registration=await navigator.serviceWorker.getRegistration('/dispatch-push-sw.js');
    subscription=await registration?.pushManager.getSubscription();
    // The enable button also refreshes server enrollment after account changes.
    if(subscription&&Notification.permission==='granted'){buttons(true);status.textContent='Notifications are enabled in this browser. Send a test to confirm delivery.';}
  })().catch(()=>{});
})();
