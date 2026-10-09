"use strict";
const { requireDispatchAccess, supabaseRequest, sendResendEmail, toJsonResponse } = require("./_shared");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCES = new Set(["phone", "email", "in_person", "website", "other"]);
const COMPLETE = new Set(["completed", "delivered"]);
const DONE_THRESHOLD = 10;
const FROM = "MG Express Team <documents@notify.migenteexpress.com>";
const escapeHTML = x => String(x || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = x => String(x || "").trim().toLowerCase();

function delivered(job) {
  const status = norm(job.status);
  if (["cancelled","canceled","void","refunded","failed"].includes(status)) return false;
  return COMPLETE.has(status) || norm(job.driver_workflow_status) === "delivered" ||
    (status === "closed" && Boolean(job.completed_at));
}
function localDate(value) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone:"America/Denver", year:"numeric", month:"2-digit", day:"2-digit" });
  const pieces = Object.fromEntries(fmt.formatToParts(new Date(value)).filter(p => p.type !== "literal").map(p => [p.type,p.value]));
  return pieces.year+"-"+pieces.month+"-"+pieces.day;
}
function nextBusinessDate(value) {
  const date = localDate(value);
  if (!date) return null;
  const d = new Date(date+"T12:00:00Z");
  do { d.setUTCDate(d.getUTCDate()+1); } while ([0,6].includes(d.getUTCDay()));
  return d.toISOString().slice(0,10);
}

async function getRows() {
  const [leads,links,outreach,welcome] = await Promise.all([
    supabaseRequest("sales_leads?select=id,business,email,status&limit=500"),
    supabaseRequest("sales_lead_orders?select=lead_id,quote_id&limit=2000"),
    supabaseRequest("sales_customer_outreach?select=lead_id,outreach_type,status,sent_at&limit=1000"),
    supabaseRequest("sales_welcome_packets?select=lead_id,status&limit=1000")
  ]);
  if (![leads,links,outreach,welcome].every(Array.isArray)) throw Error("Sales data unavailable");
  const quoteIds = [...new Set(links.map(l => l.quote_id).filter(x => UUID.test(x)))];
  // Avoid truncating linked-order counts. Ask staff to segment data once at scale.
  if (quoteIds.length > 1900 || leads.length >= 500 || links.length >= 2000) throw Error("Sales records exceed safe reporting limit");
  let jobs = [];
  for (let i=0; i<quoteIds.length; i+=100) {
    const subset = quoteIds.slice(i,i+100);
    const result = await supabaseRequest("quotes?select=id,job_number,status,driver_workflow_status,completed_at,closed_at&limit=100&id=in.("+subset.join(",")+")");
    if (!Array.isArray(result)) throw Error("Unable to verify completed deliveries");
    jobs.push(...result);
  }
  return {leads,links,outreach,welcome,jobs};
}
function summarize(rows) {
  const byJob = new Map(rows.jobs.map(x => [x.id,x]));
  const byLead = new Map();
  for (const lead of rows.leads) {
    const related = rows.links.filter(l => l.lead_id === lead.id).map(l => byJob.get(l.quote_id)).filter(Boolean);
    const finished = related.filter(delivered).sort((a,b) => Date.parse(a.completed_at || a.closed_at || 0)-Date.parse(b.completed_at || b.closed_at || 0));
    const thank = rows.outreach.find(o => o.lead_id === lead.id && o.outreach_type === "trial_thanks");
    const offer = rows.outreach.find(o => o.lead_id === lead.id && o.outreach_type === "account_offer");
    const packet = rows.welcome.find(w => w.lead_id === lead.id);
    const count = finished.length;
    const firstDate = finished[0]?.completed_at || finished[0]?.closed_at || null;
    byLead.set(lead.id, {
      orders_linked: related.length,
      completed_orders: count,
      account_eligible: count >= DONE_THRESHOLD,
      remaining_to_eligibility: Math.max(0,DONE_THRESHOLD-count),
      first_delivery_at: firstDate,
      followup_due: nextBusinessDate(firstDate),
      followup_due_now: !!nextBusinessDate(firstDate) && nextBusinessDate(firstDate) <= localDate(new Date().toISOString()),
      trial_thanks_status: thank?.status || null,
      account_offer_status: offer?.status || null,
      welcome_status: packet?.status || null
    });
  }
  return Object.fromEntries(byLead);
}
function metrics(summaries) {
  const values = Object.values(summaries);
  return {
    new_trials: values.filter(x => x.completed_orders >= 1).length,
    thank_yous_sent: values.filter(x => x.trial_thanks_status === "sent").length,
    followups_due: values.filter(x => x.completed_orders>=1 && x.followup_due && x.followup_due <= localDate(new Date().toISOString()) && !x.trial_thanks_status).length,
    account_eligible: values.filter(x => x.account_eligible && !x.account_offer_status).length,
    accounts_invited: values.filter(x => x.account_offer_status === "sent").length
  };
}
function emailFor(lead,type,count) {
  const person=String(lead.contact || "").trim().split(/\s+/)[0] || "there";
  const business=String(lead.business || "your business");
  const isOffer=type==="account_offer";
  const subject=isOffer?"MG Express - Invitation to Apply for a Business Account":"Thank You for Trying MG Express!";
  const description=isOffer ?
    "Thank you for completing at least 10 deliveries with MG Express. You're eligible to request a recurring business account. If you'd like to apply, simply reply to this email. Our dispatch team will review your request, confirm account details and terms, and explain the next steps. An account is not created automatically, and biweekly billing requires separate approval." :
    "Thanks for trusting MG Express with your delivery. We'd love to know how it went and if your team needs more local deliveries, scheduled routes, or a backup courier. Reply with feedback or your next delivery needs and dispatch will gladly help.";
  const text=["Hi "+person+",","",description,"","www.migenteexpress.com","","MG Express Team","If you prefer no further sales emails, reply 'no more emails'."].join("\n");
  const html='<div style="font:15px/1.6 Arial,sans-serif;max-width:620px;color:#173529"><div style="background:#073d30;color:#fff;padding:16px 22px;font-size:20px;font-weight:bold">MI GENTE EXPRESS</div><div style="padding:22px"><h2 style="color:#073d30">'+(isOffer?"Your Business Account Invitation":"Thank You for Your First Delivery")+'</h2><p>Hi '+escapeHTML(person)+',</p><p>'+escapeHTML(description)+'</p><p><a href="https://www.migenteexpress.com">www.migenteexpress.com</a></p><p>MG Express Team</p><small>If you prefer no further sales emails, reply "no more emails".</small></div></div>';
  return {to:lead.email,subject,text,html};
}
async function updateOutreach(id,values) {
  await supabaseRequest("sales_customer_outreach?id=eq."+encodeURIComponent(id),{
    method:"PATCH",headers:{"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify(values)
  });
}
exports.handler = async event => {
  if (!["GET","POST"].includes(event.httpMethod)) return toJsonResponse(405,{error:"Method not allowed"});
  let auth;
  try { auth=await requireDispatchAccess(event); }
  catch(err){return toJsonResponse(err.statusCode===403?403:401,{error:"Dispatch sign-in required"})}
  try {
    if (event.httpMethod==="GET") {
      const rows=await getRows(), journeys=summarize(rows);
      return toJsonResponse(200,{leads:rows.leads,journeys,metrics:metrics(journeys),threshold:DONE_THRESHOLD, automatic_account_creation:false});
    }
    let data;
    try {data=JSON.parse(event.body||"{}");}catch(_){return toJsonResponse(400,{error:"Invalid JSON"})}
    const leadId=String(data?.lead_id || ""), action=String(data?.action||"");
    if (!UUID.test(leadId) || !["link_order","send_trial_thanks","send_account_offer"].includes(action))
      return toJsonResponse(400,{error:"Valid lead and action required"});
    const leadRows=await supabaseRequest("sales_leads?select=id,business,contact,email,status&id=eq."+encodeURIComponent(leadId)+"&limit=1");
    const lead=leadRows[0];
    if (!lead) return toJsonResponse(404,{error:"Lead not found"});
    if (norm(lead.status)==="not interested") return toJsonResponse(409,{error:"Customer opted out; no outreach allowed"});
    if (action==="link_order") {
      const ref=String(data?.order_reference||"").trim().slice(0,100);
      if (!ref) return toJsonResponse(400,{error:"Enter a job number or job ID"});
      if (data?.verified_business_match!==true) return toJsonResponse(400,{error:"Dispatch must verify this order belongs to the business"});
      if (!lead.email) return toJsonResponse(409,{error:"Save the business contact email before linking an order"});
      const filter=UUID.test(ref)?"id=eq."+encodeURIComponent(ref):"job_number=eq."+encodeURIComponent(ref);
      const jobs=await supabaseRequest("quotes?select=id,job_number,customer_email,status,completed_at&"+filter+"&limit=2");
      if (jobs.length!==1) return toJsonResponse(409,{error:jobs.length?"Multiple jobs match. Use job ID.":"Delivery not found"});
      const job=jobs[0];
      if (!job.customer_email || norm(job.customer_email)!==norm(lead.email))
        return toJsonResponse(409,{error:"Customer email on the delivery does not match this lead. Verify and correct records before linking."});
      try {
        await supabaseRequest("sales_lead_orders",{
          method:"POST",headers:{"Content-Type":"application/json",Prefer:"return=minimal"},
          body:JSON.stringify({lead_id:leadId,quote_id:job.id,linked_by:auth.user.id})
        });
      } catch(err) {
        if(err.statusCode===409||err.data?.code==="23505") return toJsonResponse(409,{error:"This delivery is already linked to a lead"});
        throw err;
      }
      return toJsonResponse(200,{ok:true,job_number:job.job_number||job.id,completed_status:delivered(job)});
    }
    const email=String(lead.email||"").trim();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)||email.length>254)
      return toJsonResponse(409,{error:"A valid lead email is required"});
    if(data.confirmed_customer_requested_email!==true || !SOURCES.has(data.approval_source))
      return toJsonResponse(400,{error:"Customer email permission and source confirmation required"});
    const rows=await getRows();
    const j=summarize(rows)[leadId];
    if (!j) return toJsonResponse(404,{error:"Lead not found in journey records"});
    if (action==="send_trial_thanks" && j.completed_orders<1)
      return toJsonResponse(409,{error:"A completed linked delivery is required for a thank-you email"});
    if (action==="send_account_offer" && j.completed_orders<DONE_THRESHOLD)
      return toJsonResponse(409,{error:"Account invitation available only after 10 completed deliveries"});
    const kind=action==="send_trial_thanks"?"trial_thanks":"account_offer";
    if ((kind==="trial_thanks"?j.trial_thanks_status:j.account_offer_status))
      return toJsonResponse(409,{error:"An email was already attempted for this step. Review its status before retrying"});
    if (!String(process.env.RESEND_API_KEY||"").trim())
      return toJsonResponse(503,{error:"MG Express email service not configured"});
    let receiptId;
    try {
      const reserved=await supabaseRequest("sales_customer_outreach",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({lead_id:leadId,outreach_type:kind,status:"sending",recipient_email:email,permission_source:data.approval_source,approved_by:auth.user.id})
      });
      receiptId=reserved?.[0]?.id;
      if(!receiptId)throw Error("Email receipt not reserved");
    } catch(err) {
      if(err.statusCode===409||err.data?.code==="23505")return toJsonResponse(409,{error:"A prior send attempt exists; verify before re-sending"});
      throw err;
    }
    try {
      const msg=emailFor(lead,kind,j.completed_orders);
      const response=await sendResendEmail({...msg,from:FROM});
      if(!response.configured)throw Error("Resend not configured");
      await updateOutreach(receiptId,{status:"sent",sent_at:new Date().toISOString(),provider_message_id:String(response.data?.id||"").slice(0,250)||null});
      return toJsonResponse(200,{ok:true,recipient_email:email,type:kind,account_created:false});
    } catch(err) {
      console.error("Sales journey email uncertain",{message:err.message});
      try{await updateOutreach(receiptId,{status:"needs_review",error_message:String(err.message).slice(0,200)})}catch(_){}
      return toJsonResponse(503,{error:"Delivery status uncertain. Review Resend before any retry."});
    }
  } catch(err) {
    console.error("sales-journey", {message:err.message});
    return toJsonResponse(503,{error:"Sales follow-up unavailable. No customer account was created."});
  }
};
exports._test={delivered,nextBusinessDate,summarize,metrics};
