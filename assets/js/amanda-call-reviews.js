(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  let client=null, calls=[];
  const esc = text => String(text || "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  })[c]);
  const display = value => esc(value || "Not provided");
  function notice(message, warn=false) {
    $("notice").textContent=message;
    $("notice").className="notice"+(warn?" warn":"");
  }
  async function load() {
    $("refresh").disabled=true;
    try {
      const response=await client.from("sales_ai_call_events")
        .select("id,event_at,phone_e164,provider_call_id,lead_id,details")
        .eq("event_kind","amanda_call_analyzed")
        .order("event_at",{ascending:false}).limit(100);
      if(response.error)throw response.error;
      calls=response.data||[];
      notice(calls.length?
        calls.length+" analyzed sales conversation(s) loaded for dispatch review.":
        "No Amanda call analyses saved yet. The webhook must be configured and a valid call_analyzed event received.");
      render();
    } catch(err) {
      notice("Could not load Amanda's call reviews. Confirm your dispatch login and database access.",true);
      console.error("Amanda call review read failed",{message:err.message});
    } finally {$("refresh").disabled=false;}
  }
  function render() {
    const query=$("search").value.trim().toLowerCase();
    const filtered=calls.filter(x=>[x.details?.business,x.details?.contact,x.phone_e164,x.details?.outcome,
      x.details?.delivery_need,x.details?.summary].join(" ").toLowerCase().includes(query));
    $("results").innerHTML=filtered.length?filtered.map(x=>{
      const d=x.details||{};
      return '<article class="box item">' +
        '<section><div class="name">'+display(d.business||"Unnamed business")+'</div>'+
        '<div class="small">Contact: '+display(d.contact)+'</div>'+
        '<div class="small">Phone: '+display(x.phone_e164)+'</div>'+
        '<div class="small">Email (needs staff confirmation): '+display(d.email)+'</div></section>'+
        '<section><div><strong>Outcome:</strong> '+display(d.outcome)+'</div>'+
        '<div class="small">Time: '+display(new Date(x.event_at).toLocaleString())+'</div>'+
        '<div class="small">Callback: '+display(d.callback_time)+'</div>'+
        (d.trial_delivery_interest?'<span class="chip">Trial interest</span>':'')+
        (d.email_permission_claimed?'<span class="chip">Email permission claimed—verify</span>':'')+
        (d.do_not_call?'<span class="chip warn">Do not call</span>':'')+
        (x.lead_id?'<span class="chip">Linked to lead</span>':'<span class="chip">Needs matching</span>')+
        (d.tested_in_browser?'<span class="chip">Browser test</span>':'')+
        '</section><section><strong>Delivery needs</strong><p>'+display(d.delivery_need)+'</p>'+
        '<strong>Summary</strong><p>'+display(d.summary)+'</p>'+
        (d.notes_for_dispatch?'<strong>Notes</strong><p>'+display(d.notes_for_dispatch)+'</p>':'')+
        '<a class="button" href="/leads.html">Review in Leads</a></section></article>';
    }).join(""):'<div class="box">No matching results.</div>';
  }
  async function init() {
    try {
      const auth=await window.MG_AUTH.requireDispatch();
      if(!auth)return;
      client=window.mgSupabase;
      $("refresh").onclick=load;
      $("search").oninput=render;
      await load();
    } catch(_) {location.replace("/index.html?error=access");}
  }
  init();
})();