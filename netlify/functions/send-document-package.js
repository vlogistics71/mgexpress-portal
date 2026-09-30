const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
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

  page.drawRectangle({ x: 0, y: height - 104, width, height: 104, color: GREEN });
  page.drawText("MG", { x: margin, y: height - 63, size: 28, font: bold, color: rgb(1, 1, 1) });
  page.drawText("EXPRESS", { x: margin + 54, y: height - 63, size: 28, font: bold, color: rgb(0.94, 0.18, 0.20) });
  page.drawText("WE DELIVER FOR YOU", { x: margin, y: height - 84, size: 9, font: bold, color: rgb(1, 1, 1) });
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

async function buildBol(q) {
  const instructions = [q.pickup_instructions && `Pickup: ${q.pickup_instructions}`, q.delivery_instructions && `Delivery: ${q.delivery_instructions}`, q.special_instructions].filter(Boolean).join(" | ");
  return createDocument("BILL OF LADING", `Job ${jobNumber(q)}`, [
    { title: "Pickup / Shipper", rows: [["Address", q.pickup_address], ["Contact", [q.pickup_contact_name, q.pickup_contact_phone].filter(Boolean).join(" - ")]] },
    { title: "Delivery / Consignee", rows: [["Address", q.delivery_address], ["Contact", [q.delivery_contact_name, q.delivery_contact_phone].filter(Boolean).join(" - ")]] },
    { title: "Service Information", rows: [["Pickup Date/Time", formatDate(q.pickup_at || q.scheduled_at || q.created_at)], ["Vehicle", q.vehicle_type], ["Service Level", q.service_level], ["Category", q.job_category]] },
    { title: "Package / Shipment", rows: [["Description", q.package_description || q.package_type], ["Pieces", q.piece_count], ["Approx. Weight", q.package_weight], ["Special Instructions", instructions || "None"]] }
  ]);
}

async function buildLabel(q) {
  const deliveryBy = q.deliver_by || q.delivery_at || q.scheduled_delivery_at || q.preferred_delivery_time;
  return createDocument("DELIVERY LABEL", `Job ${jobNumber(q)}`, [
    { title: "Delivery Identification", rows: [["Job Number", jobNumber(q)], ["Ready At", formatDate(q.pickup_at || q.scheduled_at || q.created_at)], ["Deliver By", formatDate(deliveryBy)]] },
    { title: "From", rows: [["Pickup", q.pickup_address], ["Contact", [q.pickup_contact_name, q.pickup_contact_phone].filter(Boolean).join(" - ")]] },
    { title: "To", rows: [["Delivery", q.delivery_address], ["Recipient", [q.delivery_contact_name, q.delivery_contact_phone].filter(Boolean).join(" - ")]] },
    { title: "Package", rows: [["Description", q.package_description || q.package_type], ["Pieces", q.piece_count], ["Handling", q.delivery_instructions || q.special_instructions || "Standard courier handling"]] }
  ], { landscape: true });
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
