const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const webpush=require('web-push');
const crypto=require('crypto');
const key=crypto.createECDH('prime256v1');key.generateKeys();
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:key.getPublicKey().toString('base64url'),auth:crypto.randomBytes(16).toString('base64url')}};
const events=new Map(),claims=new Set();let sent=0,expired=false;
const keys=webpush.generateVAPIDKeys();
const shared={requireDispatchAccess:async()=>({user:{id:'owner'}}),supabaseRequest:async(path,options={})=>{
  const u=new URL('https://example.test/'+path),table=u.pathname.slice(1),body=options.body?JSON.parse(options.body):{};
  if(table==='profiles')return [{id:'owner',role:'admin',team_disabled_at:null}];
  if(table==='dispatch_push_config')return [{public_key:keys.publicKey,private_key:keys.privateKey}];
  if(table==='dispatch_push_events'){
    if(options.method==='POST'){if(!events.has(body.event_key))events.set(body.event_key,{...body,created_at:new Date().toISOString()});return [];}
    return [events.get(u.searchParams.get('event_key').slice(3))];
  }
  if(table==='dispatch_push_subscriptions'){
    if(options.method==='DELETE'){expired=true;return [];}
    return expired?[]:[{id:'device',user_id:'owner',subscription,created_at:'2020-01-01T00:00:00Z'}];
  }
  if(table==='dispatch_push_deliveries'){
    const id=body.event_key+'|'+body.subscription_id;
    if(claims.has(id))return [];claims.add(id);return [body];
  }
  throw Error('Unexpected '+path);
}};
const load=Module._load;
Module._load=function(name,parent,...rest){
  if(parent?.filename.endsWith('_dispatch-push.js')&&name==='./_shared')return shared;
  if(parent?.filename.endsWith('_dispatch-push.js')&&name==='web-push')return {...webpush,sendNotification:async()=>{sent++;if(expired)throw Object.assign(Error('expired'),{statusCode:410});return {statusCode:201};}};
  return load.call(this,name,parent,...rest);
};
const push=require('../netlify/functions/_dispatch-push');Module._load=load;
test('accept Android subscriptions and reject arbitrary endpoints and malformed keys',()=>{
  assert.equal(push.validSubscription(subscription),true);
  for(const endpoint of ['http://fcm.googleapis.com/fcm/send/test','https://127.0.0.1/fcm/send/test','https://fcm.googleapis.com.evil.test/fcm/send/test','https://fcm.googleapis.com:444/fcm/send/test'])assert.equal(push.validSubscription({...subscription,endpoint}),false);
  assert.equal(push.validSubscription({...subscription,keys:{auth:'x',p256dh:'x'}}),false);
});
test('repeated and concurrent events send one notification per device',async()=>{
  const data={title:'Incoming MG Express call',body:'Test',url:'/inbound-calls.html',tag:'call-example'};
  await Promise.all([push.notifyDispatch('call-example',data),push.notifyDispatch('call-example',data)]);
  assert.equal(sent,1);assert.equal(events.size,1);
  await push.flushEvent(events.get('call-example'));assert.equal(sent,1);
});
test('generated payload is encryptable with web-push VAPID configuration',()=>{
  const result=webpush.generateRequestDetails(subscription,JSON.stringify({title:'Test'}),{vapidDetails:{subject:'mailto:info@migenteexpress.com',publicKey:keys.publicKey,privateKey:keys.privateKey}});
  assert.ok(result.headers.Authorization);assert.ok(result.body.length);
});
