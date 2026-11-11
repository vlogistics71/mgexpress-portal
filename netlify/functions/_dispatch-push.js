"use strict";
const crypto = require('crypto');
const webpush = require('web-push');
const {supabaseRequest, requireDispatchAccess} = require('./_shared');
const q = encodeURIComponent;
const jsonHeaders = {'Content-Type':'application/json'};
async function activeDispatch(event) {
  const access = await requireDispatchAccess(event);
  const rows = await supabaseRequest('profiles?select=id,team_disabled_at&id=eq.'+q(access.user.id)+'&limit=1');
  if (!rows[0] || rows[0].team_disabled_at) throw Object.assign(new Error('Active dispatch account required'),{statusCode:403});
  return access;
}
function validSubscription(value) {
  if (!value || typeof value.endpoint !== 'string' || value.endpoint.length > 2048) return false;
  try {
    const u = new URL(value.endpoint);
    // Android Chrome/Edge use FCM; Firefox uses Mozilla. Never fetch arbitrary URLs.
    if(u.protocol !== 'https:' || u.port || u.username || u.password || u.hash) return false;
    if(!(u.hostname === 'fcm.googleapis.com' && /^\/(fcm\/send|wp)\//.test(u.pathname)) &&
       !(u.hostname === 'updates.push.services.mozilla.com' && u.pathname.startsWith('/wpush/'))) return false;
    return /^[A-Za-z0-9_-]{86,88}={0,2}$/.test(value.keys?.p256dh || '') &&
      /^[A-Za-z0-9_-]{22,24}={0,2}$/.test(value.keys?.auth || '') &&
      Buffer.from(value.keys.p256dh,'base64url').length === 65 && Buffer.from(value.keys.auth,'base64url').length === 16;
  } catch (_) {return false;}
}
async function config() {
  let result=await supabaseRequest('dispatch_push_config?select=*&id=eq.default&limit=1');
  if(result[0]) return result[0];
  const keys=webpush.generateVAPIDKeys();
  await supabaseRequest('dispatch_push_config?on_conflict=id',{method:'POST',headers:{...jsonHeaders,Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({id:'default',public_key:keys.publicKey,private_key:keys.privateKey})});
  result=await supabaseRequest('dispatch_push_config?select=*&id=eq.default&limit=1');
  if(!result[0]) throw Error('Push setup unavailable');
  return result[0];
}
async function deliver(subscription,payload,keys) {
  if(!validSubscription(subscription)) throw Error('Unsupported push endpoint');
  return webpush.sendNotification(subscription,JSON.stringify(payload),{
    vapidDetails:{subject:'mailto:info@migenteexpress.com',publicKey:keys.public_key,privateKey:keys.private_key},
    TTL:300,urgency:'high',timeout:4000,
    topic:crypto.createHash('sha256').update(payload.tag).digest('base64url').slice(0,32)
  });
}
async function flushEvent(event) {
  const subscriptions=await supabaseRequest('dispatch_push_subscriptions?select=*&created_at=lte.'+q(event.created_at)+'&limit=100');
  if(!subscriptions.length)return;
  const profiles=await supabaseRequest('profiles?select=id,role,team_disabled_at&role=in.(admin,staff,dispatcher)&team_disabled_at=is.null');
  const allowed=new Set(profiles.map(p=>p.id));
  const keys=await config();
  await Promise.all(subscriptions.filter(s=>allowed.has(s.user_id)).map(async s=>{
    const claim=await supabaseRequest('dispatch_push_deliveries?on_conflict=event_key,subscription_id',{method:'POST',headers:{...jsonHeaders,Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({event_key:event.event_key,subscription_id:s.id})});
    if(!claim.length)return;
    try {await deliver(s.subscription,event.payload,keys);}
    catch(error){
      if(error.statusCode===404 || error.statusCode===410) {
        await supabaseRequest('dispatch_push_subscriptions?id=eq.'+q(s.id),{method:'DELETE'});
      } else {
        await supabaseRequest('dispatch_push_deliveries?event_key=eq.'+q(event.event_key)+'&subscription_id=eq.'+q(s.id),{method:'DELETE'});
        console.error('Dispatch push delivery pending retry',{status:error.statusCode||'network'});
      }
    }
  }));
}
async function notifyDispatch(eventKey,payload) {
  await supabaseRequest('dispatch_push_events?on_conflict=event_key',{method:'POST',headers:{...jsonHeaders,Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({event_key:eventKey,payload})});
  const events=await supabaseRequest('dispatch_push_events?event_key=eq.'+q(eventKey)+'&limit=1');
  if(events[0])await flushEvent(events[0]);
}
module.exports={activeDispatch,validSubscription,config,deliver,notifyDispatch,flushEvent};
