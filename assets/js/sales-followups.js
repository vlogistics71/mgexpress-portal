(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  let session = null, data = null, active = null, pending = false;
  const esc = value => String(value == null ? "" : value)
    .replace(/[&<>"']/g, char => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[char]));
  const getEntry = id => data && data.leads.find(l => l.id === id);

  function notice(message, isError) {
    $("statusNotice").textContent = message;
    $("statusNotice").className = "notice" + (isError ? " error" : "");
  }
  async function api(action, values) {
    if (!session?.session?.access_token) throw Error("Dispatch login required");
    const options = {
      method: action ? "POST" : "GET",
      headers: { Authorization: "Bearer " + session.session.access_token }
    };
    if (action) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify({ action, ...values });
    }
    const response = await fetch("/.netlify/functions/sales-journey", options);
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(json.error || "Unable to load customer follow-ups");
    return json;
  }
  async function reload() {
    try {
      data = await api();
      for (const [dom,key] of [
        ["trialCount","new_trials"],["followupCount","followups_due"],
        ["eligibleCount","account_eligible"],["invitedCount","accounts_invited"]
      ]) $(dom).textContent = data.metrics?.[key] ?? "—";
      notice("Customer journeys are based on completed, staff-linked deliveries. Customers do not need portal accounts to order.", false);
      render();
    } catch (error) {
      notice("Could not load customer journeys: " + error.message, true);
    }
  }
  function render() {
    const text = $("filterLeads").value.trim().toLowerCase();
    const list = (data?.leads || []).filter(l =>
      (String(l.business || "")+" "+String(l.email || "")).toLowerCase().includes(text)
    );
    $("journeyList").innerHTML = list.length ? list.map(l => {
      const j=data.journeys?.[l.id] || {};
      const n=Number(j.completed_orders || 0), eligible=n>=10, optout=l.status==="Not Interested";
      const due=j.followup_due && j.followup_due <= new Date().toLocaleDateString("en-CA",{timeZone:"America/Denver"});
      const thankStatus=j.trial_thanks_status, offerStatus=j.account_offer_status;
      const progress=Math.min(100,n*10);
      return '<div class="panel lead" data-lead="'+esc(l.id)+'">'+
        '<div><div class="name">'+esc(l.business)+'</div><div class="detail">'+esc(l.email||"No customer email")+'</div><div class="detail">'+esc(l.status)+'</div></div>'+
        '<div><strong>'+n+' / 10 completed orders</strong><div class="progress"><span style="width:'+progress+'%"></span></div>'+
        (eligible?'<span class="chip">Account invitation eligible</span>':'<span class="detail">'+(10-n)+' more completed deliveries needed</span>')+
        '<div class="detail">'+(j.orders_linked||0)+' linked deliveries total</div>'+
        (j.followup_due?'<div class="detail">First-delivery follow-up: '+esc(j.followup_due)+'</div>':'')+
        (due&&!thankStatus?'<span class="chip warn">Follow-up due</span>':'')+
        (thankStatus?'<span class="chip">'+esc("Thank-you: "+thankStatus)+'</span>':'')+
        (offerStatus?'<span class="chip">'+esc("Account offer: "+offerStatus)+'</span>':'')+
        '</div><div class="actions">'+
        '<button class="btn" data-op="link_order" data-id="'+esc(l.id)+'" '+(optout?'disabled':'')+'>Link delivery</button>'+
        '<button class="btn" data-op="send_trial_thanks" data-id="'+esc(l.id)+'" '+(n<1||thankStatus||optout||!l.email?'disabled':'')+'>Send thank-you</button>'+
        '<button class="btn primary" data-op="send_account_offer" data-id="'+esc(l.id)+'" '+(!eligible||offerStatus||optout||!l.email?'disabled':'')+'>Offer account</button>'+
        '</div></div>';
    }).join("") : '<div class="panel">No sales leads to display. Add businesses from the Leads page first.</div>';
    $("journeyList").querySelectorAll("[data-op]").forEach(button => {
      button.addEventListener("click", () => openAction(button.dataset.op, button.dataset.id));
    });
  }

  function actionMessage(message,isError=false) {
    $("actionMessage").textContent=message;
    $("actionMessage").className="notice"+(isError?" error":"");
    $("actionMessage").hidden=!message;
  }
  function openAction(operation,leadId) {
    if(pending) return;
    const lead=getEntry(leadId);
    if (!lead) return;
    active={operation,leadId};
    const isLink=operation==="link_order";
    $("linkWrap").hidden=!isLink;
    $("emailWrap").hidden=isLink;
    $("jobReference").value="";
    $("permissionSource").value="";
    $("actionConfirmed").checked=false;
    $("actionHeading").textContent=isLink?"Link an existing delivery":operation==="send_trial_thanks"?"First-delivery thank-you":"Invite customer to apply for an account";
    $("actionRecipient").textContent=lead.email || "";
    $("actionDescription").textContent=isLink?
      "Enter the job number for this business. For safety, the delivery email must match the lead email. Only COMPLETED orders count toward the 10-order milestone.":
      operation==="send_trial_thanks"?
      "Send a personal thank-you and feedback request after the first completed linked delivery. No follow-up is sent automatically.":
      "This business has at least 10 completed linked orders. Offer an APPLICATION for a portal account. Do not create a login or activate billing automatically.";
    $("actionConfirmText").textContent=isLink?
      "I verified that the order belongs to this business and its delivery contact matches.":
      "The customer requested this email, I reviewed the recipient, and I authorize this one-time send.";
    actionMessage("");
    $("actionBackdrop").classList.add("open");
    $("actionBackdrop").setAttribute("aria-hidden","false");
  }
  function closeAction() {
    if(pending)return;
    $("actionBackdrop").classList.remove("open");
    $("actionBackdrop").setAttribute("aria-hidden","true");
    active=null;
  }
  async function confirmAction() {
    if(pending||!active)return;
    const lead=getEntry(active.leadId);
    if(!lead)return;
    const isLink=active.operation==="link_order";
    if(!$("actionConfirmed").checked){actionMessage("You must confirm this action before continuing.",true);return}
    const body={lead_id:active.leadId};
    if(isLink){
      body.order_reference=$("jobReference").value.trim();
      body.verified_business_match=true;
      if(!body.order_reference){actionMessage("Enter a valid delivery job number or ID.",true);return}
    } else {
      body.approval_source=$("permissionSource").value;
      body.confirmed_customer_requested_email=true;
      if(!body.approval_source){actionMessage("Choose how the customer requested this email.",true);return}
      if(!window.confirm("Send one MG Express email to "+lead.email+"? This action cannot be automatically reversed.")) return;
    }
    pending=true;
    $("confirmAction").disabled=true;
    actionMessage("Saving your action...");
    try {
      const result=await api(active.operation,body);
      actionMessage(isLink?"Delivery linked. It counts after completion.":"Email confirmed sent to "+result.recipient_email+".");
      await reload();
      closeAction();
      notice(isLink?"Delivery linked. Counts update when delivery completes.":"Follow-up email sent with dispatch approval.",false);
    } catch(error) {
      actionMessage(error.message,true);
      await reload();
    } finally {
      pending=false;
      $("confirmAction").disabled=false;
    }
  }
  async function init() {
    try {
      session=await window.MG_AUTH.requireDispatch();
      if(!session)return;
    }catch(_){location.replace("/index.html?error=access");return}
    $("refresh").onclick=reload;
    $("filterLeads").oninput=render;
    $("cancelAction").onclick=closeAction;
    $("actionBackdrop").onclick=e=>{if(e.target===$("actionBackdrop"))closeAction()};
    $("confirmAction").onclick=confirmAction;
    await reload();
  }
  init();
})();