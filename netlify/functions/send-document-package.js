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
  const margin = 42;

  try {
    const svg = fs.readFileSync(path.join(__dirname, "../../assets/images/mg-express-logo-2026.svg"), "utf8");
    const marker = "data:image/jpeg;base64,";
    const start = svg.indexOf(marker);
    const end = start >= 0 ? svg.indexOf('"', start) : -1;
    const match = start >= 0 && end > start ? svg.slice(start + marker.length, end) : "";
    if (match) {
      const logo = await pdf.embedJpg(Buffer.from(match, "base64"));
      const scaled = logo.scaleToFit(118, 72);
      page.drawImage(logo, { x: margin, y: height - 92, width: scaled.width, height: scaled.height });
    }
  } catch (error) { console.warn("PDF logo unavailable", error.message); }

  page.drawRectangle({ x: 0, y: height - 104, width, height: 104, color: GREEN });

  page.drawText(title, { x: width - margin - bold.widthOfTextAtSize(title, 22), y: height - 57, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText(clean(subtitle, ""), { x: width - margin - regular.widthOfTextAtSize(clean(subtitle, ""), 9), y: height - 77, size: 9, font: regular, color: rgb(1, 1, 1) });

  let y = height - 132;
  for (const section of sections) {
    const estimated = 32 + section.rows.reduce((sum, row) => sum + Math.max(23, wrap(row[1], regular, 10, width - 230).length * 13), 0);
    if (y - estimated < 42) break;
    page.drawRectangle({ x: margin, y: y - 22, width: width - margin * 2, height: 22, color: LIGHT });
    page.drawText(clean(section.title), { x: margin + 9, y: y - 15, size: 11, font: bold, color: GREEN });
    y -= 32;
    for (const [label, value] of section.rows) {
      const lines = wrap(value, regular, 10, width - 230);
      page.drawText(clean(label).toUpperCase(), { x: margin + 8, y, size: 9, font: bold, color: GRAY });
      lines.forEach((line, index) => page.drawText(line, { x: margin + 165, y: y - index * 13, size: 10, font: regular, color: GREEN }));
      y -= Math.max(23, lines.length * 13 + 7);
      page.drawLine({ start: { x: margin + 8, y: y + 7 }, end: { x: width - margin - 8, y: y + 7 }, thickness: 0.4, color: rgb(0.82, 0.83, 0.81) });
    }
    y -= 8;
  }

  page.drawText("MG Express | portal.migenteexpress.com", { x: margin, y: 22, size: 8, font: regular, color: GRAY });
  page.drawText("Page 1 of 1", { x: width - margin - 42, y: 22, size: 8, font: regular, color: GRAY });
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
  for (const label of labels) {
    const marker = label.toLowerCase() + ":";
    const lower = source.toLowerCase();
    const at = lower.indexOf(marker);
    if (at < 0) continue;
    const rest = source.slice(at + marker.length).trim();
    const next = rest.search(/\\s+[A-Z][A-Za-z /-]{2,30}\\s*:/);
    const value = (next >= 0 ? rest.slice(0, next) : rest).trim();
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
