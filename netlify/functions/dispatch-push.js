"use strict";
const {supabaseRequest,toJsonResponse}=require('./_shared');
const {activeDispatch,validSubscription,config,deliver}=require('./_dispatch-push');
const q=encodeURIComponent;
exports.handler=async event=>{
  try {
    if(!['GET','POST'].includes(event.httpMethod))return toJsonResponse(405,{error:'Method not allowed'});
    const {user}=await activeDispatch(event);
    if(event.httpMethod==='GET') {
      const keys=await config();
      return toJsonResponse(200,{publicKey:keys.public_key});
    }
    if(Buffer.byteLength(event.body||'')>8192)return toJsonResponse(413,{error:'Request too large'});
    let input;try{input=JSON.parse(event.body||'{}');}catch(_){return toJsonResponse(400,{error:'Invalid request'});}
    const subscription=input.subscription;
    if(!validSubscription(subscription))return toJsonResponse(400,{error:'This browser push service is not supported. Try Chrome on Android.'});
    const endpoint=q(subscription.endpoint);
    if(input.action==='disable') {
      await supabaseRequest('dispatch_push_subscriptions?user_id=eq.'+q(user.id)+'&endpoint=eq.'+endpoint,{method:'DELETE'});
      return toJsonResponse(200,{ok:true});
    }
    if(input.action==='enable') {
      // Delete/reinsert on enrollment: do not replay events from before enrollment.
      const existing=await supabaseRequest('dispatch_push_subscriptions?select=user_id&endpoint=eq.'+endpoint+'&limit=1');
      if(existing[0]&&existing[0].user_id!==user.id)return toJsonResponse(409,{error:'Disable notifications for the previous account on this device first.'});
      await supabaseRequest('dispatch_push_subscriptions?on_conflict=endpoint',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({user_id:user.id,endpoint:subscription.endpoint,subscription:{endpoint:subscription.endpoint,keys:subscription.keys},created_at:new Date().toISOString()})});
      return toJsonResponse(200,{ok:true});
    }
    if(input.action==='test') {
      const rows=await supabaseRequest('dispatch_push_subscriptions?select=subscription&user_id=eq.'+q(user.id)+'&endpoint=eq.'+endpoint+'&limit=1');
      if(!rows[0])return toJsonResponse(404,{error:'Enable notifications on this device first.'});
      await deliver(rows[0].subscription,{title:'MG Express notifications ready',body:'This device can receive call and online quote alerts.',url:'/dashboard.html',tag:'mg-test-'+Date.now()},await config());
      return toJsonResponse(200,{ok:true});
    }
    return toJsonResponse(400,{error:'Unknown notification action'});
  } catch(error){console.error('Dispatch push request failed',{status:error.statusCode||500});return toJsonResponse(error.statusCode===401||error.statusCode===403?error.statusCode:503,{error:error.statusCode===401?'Sign in to dispatch first.':error.statusCode===403?'Dispatch access required.':'Notification setup is unavailable. Please try again.'});}
};
