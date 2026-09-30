const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const { loadQuoteById, requireDispatchAccess, sendResendEmail, toJsonResponse } = require("./_shared");

const GREEN = rgb(0.02, 0.20, 0.16);
const RED = rgb(0.72, 0.04, 0.08);
const GRAY = rgb(0.36, 0.39, 0.38);
const LIGHT = rgb(0.95, 0.94, 0.89);

function clean(value, fallback = "-") {
  const text = String(value ?? "").trim().replace(/[\u2010-\u2015]/g, "-").replace(/\u2192/g, "to");
  return text || fallback;
}

function money(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "$0.00";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? clean(value) : date.toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "medium", timeStyle: "short" });
}

function wrap(text, font, size, width) {
  const words = clean(text).split(/\s+/);
  const lines = [];
  let line = "";
  words.forEach(word => {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  });
  if (line) lines.push(line);
  return lines;
}

async function createDocument(title, subtitle, sections, options = {}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage(options.landscape ? [792, 612] : [612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const margin = 34;
  const contentWidth = width - margin * 2;

  // Match the dispatch portal print documents: white header, real logo, black rules.
  page.drawRectangle({ x: margin, y: height - 126, width: contentWidth, height: 96, borderColor: rgb(0.12,0.12,0.12), borderWidth: 1 });
  try {
    const logoResponse = await fetch("https://portal.migenteexpress.com/assets/images/mg-express-logo-2026.svg");
    if (!logoResponse.ok) throw new Error("Logo fetch failed: " + logoResponse.status);
    const svg = await logoResponse.text();
    const match = svg.match(/href=["']data:image\/jpeg;base64,([^"']+)["']/i);
    if (!match || !match[1]) throw new Error("Embedded JPEG not found in logo SVG");
    const logo = await pdf.embedJpg(Buffer.from(match[1].replace(/\\s+/g, ""), "base64"));
    const scaled = logo.scaleToFit(82, 64);
    page.drawImage(logo, { x: margin + 10, y: height - 110, width: scaled.width, height: scaled.height });
  } catch (error) { console.warn("PDF logo unavailable", error.message); }

  page.drawText(title, { x: margin + 112, y: height - 88, size: 21, font: bold, color: rgb(0.05,0.05,0.05) });
  if (subtitle) page.drawText(clean(subtitle), { x: width - margin - 12 - regular.widthOfTextAtSize(clean(subtitle), 9), y: height - 55, size: 9, font: regular, color: rgb(0.15,0.15,0.15) });

  let y = height - 146;
  for (const section of sections) {
    const estimated = 30 + section.rows.reduce((sum,row)=>sum + Math.max(21, wrap(row[1],regular,9,width-220).length*12),0);
    if (y - estimated < 35) break;
    page.drawRectangle({ x: margin, y: y - 20, width: contentWidth, height: 20, borderColor: rgb(0.18,0.18,0.18), borderWidth: 0.8 });
    page.drawText(clean(section.title).toUpperCase(), { x: margin + 8, y: y - 14, size: 10, font: bold, color: rgb(0.05,0.05,0.05) });
    y -= 29;
    for (const [label,value] of section.rows) {
      const lines = wrap(value,regular,9,width-220);
      page.drawText(clean(label).toUpperCase(), { x: margin + 8, y, size: 8, font: bold, color: rgb(0.15,0.15,0.15) });
      (lines.length?lines:["-"]).forEach((line,i)=>page.drawText(line,{x:margin+150,y:y-i*11,size:9,font:regular,color:rgb(0.08,0.08,0.08)}));
      const rowHeight=Math.max(20,(lines.length||1)*11+5);
      page.drawLine({start:{x:margin+6,y:y-rowHeight+7},end:{x:width-margin-6,y:y-rowHeight+7},thickness:0.35,color:rgb(0.72,0.72,0.72)});
      y-=rowHeight;
    }
    y-=8;
  }
  page.drawText("MG Express | portal.migenteexpress.com", { x: margin, y: 22, size: 7, font: regular, color: rgb(0.35,0.35,0.35) });
  page.drawText("Page 1 of 1", { x: width-margin-45, y: 22, size: 7, font: regular, color: rgb(0.35,0.35,0.35) });
  return Buffer.from(await pdf.save());
}

function jobNumber(q) { return clean(q.job_number || q.id, "MG-DELIVERY"); }
function customerAmount(q) { return q.customer_charge ?? q.approved_price ?? q.price ?? 0; }

async function buildInvoice(q) {
  return createDocument("INVOICE", `Invoice INV-${jobNumber(q)}`, [
    { title: "Customer", rows: [["Name", q.customer_name || q.company_name], ["Email", q.customer_email], ["Phone", q.customer_phone]] },
    { title: "Delivery / Service Summary", rows: [["Job Number", jobNumber(q)], ["Pickup", q.pickup_address], ["Delivery", q.delivery_address], ["Service", "Courier / Delivery Service"], ["Category", q.job_category]] },
    { title: "Invoice Line Item", rows: [["Description", `Courier Delivery Service - ${jobNumber(q)}`], ["Amount", money(customerAmount(q))], ["Payment", q.payment_status || "unpaid"]] },
    { title: "Service Classification", rows: [["Service", "Courier / Delivery Service"], ["Tax Notice", "Transportation service only. MG Express did not sell the transported goods."]] }
  ]);
}

function packedValue(q, labels) {
  const source = String(q.special_instructions || "");
  const knownLabels = ["Delivery instructions","Pickup instructions","Pickup contact","Delivery contact","Estimated total weight","Pieces / boxes","Pieces","Preferred pickup time","Deliver by time","Company","Pickup company","Delivery company"];
  for (const label of labels) {
    const marker = label + ":";
    const at = source.toLowerCase().indexOf(marker.toLowerCase());
    if (at < 0) continue;
    const valueStart = at + marker.length;
    let valueEnd = source.length;
    for (const nextLabel of knownLabels) {
      const pos = source.toLowerCase().indexOf((nextLabel + ":").toLowerCase(), valueStart);
      if (pos >= 0 && pos < valueEnd) valueEnd = pos;
    }
    const value = source.slice(valueStart, valueEnd).trim();
    if (value) return value;
  }
  return "";
}
function first(...values) { return values.find(v => v !== null && v !== undefined && String(v).trim()) || ""; }
function contactLine(q, p) { const n=first(q[p+"_contact_name"],packedValue(q,[p==="pickup"?"Pickup contact":"Delivery contact"])); const ph=first(q[p+"_contact_phone"],packedValue(q,[p==="pickup"?"Pickup contact phone":"Delivery contact phone"])); return [n,ph].filter(Boolean).join(" - "); }
function businessName(q,p) { return first(q[p+"_business_name"],q[p+"_company_name"],p==="pickup"?q.company_name:"",packedValue(q,[p==="pickup"?"Pickup company":"Delivery company",p==="pickup"?"Pickup business":"Delivery business"])); }
function pieces(q) { return first(q.piece_count,q.package_quantity,q.quantity,packedValue(q,["Pieces / boxes","Pieces","Package count"])); }
function weight(q) { return first(q.package_weight,q.estimated_weight,q.total_weight,packedValue(q,["Estimated total weight","Approx. weight","Weight"])); }
function pickupTime(q) { return first(q.preferred_pickup_time,q.pickup_time,q.pickup_scheduled_at,q.pickup_at,packedValue(q,["Preferred pickup time","Pickup time"])); }
function deliveryTime(q) { return first(q.preferred_delivery_time,q.delivery_time,q.delivery_scheduled_at,q.deliver_by,q.delivery_at,packedValue(q,["Deliver by time","Preferred delivery time","Delivery time"])); }

async function buildBol(q) {
  const pi=first(q.pickup_instructions,packedValue(q,["Pickup instructions"])); const di=first(q.delivery_instructions,packedValue(q,["Delivery instructions"]));
  return createDocument("BILL OF LADING", `Job ${jobNumber(q)}`, [
    {title:"Pickup / Shipper",rows:[["Company",businessName(q,"pickup")],["Address",q.pickup_address],["Suite / Floor",q.pickup_suite_floor],["City / State / ZIP",[q.pickup_city,q.pickup_state,q.pickup_zip].filter(Boolean).join(", ")],["Contact",contactLine(q,"pickup")],["Pickup Instructions",pi||"None"]]},
    {title:"Delivery / Consignee",rows:[["Company",businessName(q,"delivery")],["Address",q.delivery_address],["Suite / Floor",q.delivery_suite_floor],["City / State / ZIP",[q.delivery_city,q.delivery_state,q.delivery_zip].filter(Boolean).join(", ")],["Contact",contactLine(q,"delivery")],["Delivery Instructions",di||"None"]]},
    {title:"Service Information",rows:[["Job Number",jobNumber(q)],["Service Date",first(q.scheduled_date,q.service_date,formatDate(q.created_at))],["Pickup Time",pickupTime(q)],["Deliver By",deliveryTime(q)],["Estimated Miles",first(q.estimated_miles,q.miles)],["Vehicle",q.vehicle_type],["Category",q.job_category]]},
    {title:"Package / Shipment",rows:[["Description",first(q.package_description,q.package_type)],["Pieces",pieces(q)],["Approx. Weight",weight(q)],["Reference",first(q.reference_number,q.po_number)]]}
  ]);
}
async function buildLabel(q) {
  const pi=first(q.pickup_instructions,packedValue(q,["Pickup instructions"])); const di=first(q.delivery_instructions,packedValue(q,["Delivery instructions"]));
  return createDocument("DELIVERY LABEL", `Job ${jobNumber(q)}`, [
    {title:"Delivery Identification",rows:[["Job Number",jobNumber(q)],["Service Date",first(q.scheduled_date,q.service_date,formatDate(q.created_at))],["Ready At",pickupTime(q)],["Deliver By",deliveryTime(q)],["Pieces",pieces(q)],["Approx. Weight",weight(q)]]},
    {title:"From / Pickup",rows:[["Company",businessName(q,"pickup")],["Address",q.pickup_address],["Suite / Floor",q.pickup_suite_floor],["Contact",contactLine(q,"pickup")],["Instructions",pi||"None"]]},
    {title:"To / Delivery",rows:[["Company",businessName(q,"delivery")],["Address",q.delivery_address],["Suite / Floor",q.delivery_suite_floor],["Recipient",contactLine(q,"delivery")],["Instructions",di||"None"]]},
    {title:"Package",rows:[["Description",first(q.package_description,q.package_type)],["Pieces",pieces(q)],["Weight",weight(q)],["Reference",first(q.reference_number,q.po_number)]]}
  ], {landscape:true});
}

exports.handler = async event => {
  if (event.httpMethod !== "POST") return toJsonResponse(405, { error: "Method not allowed" });
  try {
    await requireDispatchAccess(event);
    const body = JSON.parse(event.body || "{}");
    const quoteId = String(body.quote_id || "").trim();
    if (!quoteId) return toJsonResponse(400, { error: "Missing quote_id" });
    const quote = await loadQuoteById(quoteId, "*");
    if (!quote) return toJsonResponse(404, { error: "Delivery not found" });
    const email = String(quote.customer_email || "").trim();
    if (!email) return toJsonResponse(409, { error: "This job does not have a customer email." });

    const [invoice, bol, label] = await Promise.all([buildInvoice(quote), buildBol(quote), buildLabel(quote)]);
    const job = jobNumber(quote);
    const result = await sendResendEmail({
      from: "MG Express Documents <documents@notify.migenteexpress.com>",
      to: email,
      subject: `MG Express delivery documents - ${job}`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#17221e"><h2>Your MG Express delivery documents</h2><p>Attached are the invoice, Bill of Lading, and printable delivery label for job <strong>${job}</strong>.</p><p>Please print the delivery label and attach it securely to the package before pickup.</p><p>Thank you for choosing MG Express.</p></div>`,
      text: `Attached are the invoice, Bill of Lading, and printable delivery label for job ${job}. Please print the delivery label and attach it securely to the package before pickup.`,
      attachments: [
        { filename: `MG-Express-Invoice-${job}.pdf`, content: invoice.toString("base64") },
        { filename: `MG-Express-BOL-${job}.pdf`, content: bol.toString("base64") },
        { filename: `MG-Express-Delivery-Label-${job}.pdf`, content: label.toString("base64") }
      ]
    });
    if (!result.configured) return toJsonResponse(503, { error: "Email service is not configured." });
    return toJsonResponse(200, { ok: true, sent_to: email, attachments: 3 });
  } catch (error) {
    console.error("send-document-package failed", error);
    return toJsonResponse(error.statusCode || 500, { error: error.message || "Unable to email documents" });
  }
};

exports._test = { buildInvoice, buildBol, buildLabel };
