"use strict";
const {supabaseRequest}=require('./_shared');
const {flushEvent}=require('./_dispatch-push');
exports.handler=async()=>{
  // Expired alerts should not ring hours later. Retain dedup records for 24 hours.
  const cutoff=new Date(Date.now()-5*60000).toISOString();
  const events=await supabaseRequest('dispatch_push_events?select=*&created_at=gte.'+encodeURIComponent(cutoff)+'&order=created_at.desc&limit=50');
  for(const event of events)await flushEvent(event);
  await supabaseRequest('dispatch_push_events?created_at=lt.'+encodeURIComponent(new Date(Date.now()-86400000).toISOString()),{method:'DELETE'});
  return {statusCode:204};
};
