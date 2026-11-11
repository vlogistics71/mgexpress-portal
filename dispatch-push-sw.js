'use strict';
self.addEventListener('push',event=>{
  let data={};try{data=event.data.json();}catch(_){}
  event.waitUntil(self.registration.showNotification(data.title||'MG Express',{
    body:data.body||'New dispatch activity. Open the portal to review.',
    tag:data.tag||'mg-dispatch',renotify:true,
    data:{url:data.url||'/dashboard.html'},vibrate:[200,100,200]
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=new URL(event.notification.data?.url||'/dashboard.html',self.location.origin);
  if(url.origin!==self.location.origin)return;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){if('focus' in client){await client.navigate(url.href);return client.focus();}}
    return self.clients.openWindow(url.href);
  })());
});
