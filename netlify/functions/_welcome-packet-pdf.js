"use strict";
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fs = require("fs");
const path = require("path");

const green = rgb(0.026, 0.275, 0.212);
const deep = rgb(0.027, 0.153, 0.133);
const coral = rgb(0.87, 0.31, 0.28);
const ink = rgb(0.13, 0.20, 0.17);
const secondary = rgb(0.39, 0.46, 0.42);
const pale = rgb(0.94, 0.97, 0.95);
const white = rgb(1, 1, 1);
const rule = rgb(0.84, 0.89, 0.86);
const W = 612, H = 792, M = 44;

function safe(input, maxLength) {
  return String(input || "").replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018-\u201B]/g, "'")
    .replace(/[\u201C-\u201F]/g, '"')
    .replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim()
    .slice(0, maxLength || 500);
}

function linesFor(value, font, size, maxWidth) {
  const words = safe(value).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      if (line) { lines.push(line); line = ""; }
      let remaining = word;
      while (remaining && font.widthOfTextAtSize(remaining, size) > maxWidth) {
        let cut = 1;
        while (cut < remaining.length && font.widthOfTextAtSize(remaining.slice(0, cut + 1), size) <= maxWidth) cut++;
        lines.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut);
      }
      line = remaining;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function paragraph(page, text, font, size, x, y, width, leading, color) {
  const ls = linesFor(text, font, size, width);
  ls.forEach((s, i) => page.drawText(s, { x, y: y - i * leading, size, font, color: color || ink }));
  return y - ls.length * leading;
}

async function embedLogo(pdf) {
  try {
    let svg = "";
    try {
      svg = fs.readFileSync(path.join(__dirname, "..", "..", "assets", "images", "mg-express-logo-2026.svg"), "utf8");
    } catch (_) {
      const res = await fetch("https://portal.migenteexpress.com/assets/images/mg-express-logo-2026.svg", { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw Error("Image unavailable");
      svg = await res.text();
    }
    const match = svg.match(/(?:href|xlink:href)=["']data:image\/jpeg;base64,([^"']+)["']/i);
    if (!match) return null;
    return await pdf.embedJpg(Buffer.from(match[1].replace(/\s+/g, ""), "base64"));
  } catch (error) {
    console.warn("Welcome packet logo image could not load", { message: error.message });
    return null;
  }
}

function header(page, fonts, logo, label, subtitle) {
  page.drawRectangle({ x: 0, y: H - 116, width: W, height: 116, color: deep });
  page.drawRectangle({ x: 0, y: H - 121, width: W, height: 5, color: coral });
  if (logo) {
    const scaled = logo.scaleToFit(79, 79);
    page.drawRectangle({ x: M - 8, y: H - 106, width: 93, height: 89, color: white });
    page.drawImage(logo, { x: M - 8 + (93-scaled.width)/2, y: H - 106 + (89-scaled.height)/2,
      width: scaled.width, height: scaled.height });
  } else {
    page.drawText("MG", { x: M + 4, y: H - 71, font: fonts.bold, size: 30, color: white });
  }
  const titleX = 154;
  page.drawText("MI GENTE EXPRESS", { x: titleX, y: H - 48, font: fonts.bold, size: 19, color: white });
  page.drawText(safe(label, 60), { x: titleX, y: H - 75, font: fonts.bold, size: 12, color: white });
  page.drawText(safe(subtitle, 68), { x: titleX, y: H - 95, font: fonts.regular, size: 9, color: white });
}

function footer(page, fonts, pageNumber) {
  page.drawLine({ start: { x: M, y: 54 }, end: { x: W-M, y: 54 }, color: rule, thickness: 1 });
  page.drawText("Mi Gente Express  |  www.migenteexpress.com", {
    x: M, y: 37, size: 8, font: fonts.regular, color: secondary
  });
  page.drawText(String(pageNumber) + " / 2", {
    x: W-M-23, y: 37, size: 8, font: fonts.bold, color: secondary
  });
}

function serviceTile(page, fonts, x, y, title, description) {
  const width = 250, height = 69;
  page.drawRectangle({ x, y, width, height, color: pale, borderColor: rule, borderWidth: 0.8 });
  page.drawRectangle({ x, y, width: 4, height, color: coral });
  page.drawText(title, { x: x+15, y: y+42, font: fonts.bold, size: 11, color: deep });
  paragraph(page, description, fonts.regular, 9, x+15, y+26, 221, 12, secondary);
}

function step(page, fonts, number, top, title, description) {
  page.drawRectangle({ x: M, y: top-72, width: W-M*2, height: 72, color: pale, borderColor: rule, borderWidth: 0.8 });
  page.drawRectangle({ x: M+13, y: top-49, width: 33, height: 33, color: green });
  page.drawText(String(number), { x: M+24, y: top-39, size: 15, font: fonts.bold, color: white });
  page.drawText(title, { x: M+60, y: top-26, font: fonts.bold, size: 11.5, color: deep });
  paragraph(page, description, fonts.regular, 9.2, M+60, top-43, 445, 13, secondary);
}

async function buildWelcomePacket(lead) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Mi Gente Express - Customer Welcome Packet");
  pdf.setAuthor("Mi Gente Express");
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold)
  };
  const logo = await embedLogo(pdf);
  const p1 = pdf.addPage([W, H]);
  const p2 = pdf.addPage([W, H]);
  header(p1, fonts, logo, "WELCOME TO MG EXPRESS", "Local courier solutions for your business");
  header(p2, fonts, logo, "YOUR FIRST DELIVERY", "Simple booking, clear approvals and dependable updates");

  const business = safe(lead.business, 80) || "Your Business";
  const contact = safe(lead.contact, 65);
  p1.drawText("THANK YOU FOR GIVING US A TRY", { x: M, y: 639, font: fonts.bold, size: 18, color: deep });
  p1.drawText("Prepared for:", { x: M, y: 606, font: fonts.bold, size: 10, color: secondary });
  paragraph(p1, business, fonts.bold, 14, M+79, 606, 445, 18, ink);
  if (contact) paragraph(p1, "Attention: " + contact, fonts.regular, 10, M, 581, W-M*2, 14, secondary);
  paragraph(p1,
    "We appreciate the opportunity to earn your business. Our dispatch team helps companies coordinate local deliveries with practical scheduling, clear communication, and competitive quotes.",
    fonts.regular, 10.3, M, 559, W-M*2, 16, ink);

  p1.drawText("COURIER SERVICES", { x: M, y: 491, size: 13, font: fonts.bold, color: deep });
  serviceTile(p1, fonts, M, 397, "AUTO PARTS", "Parts runs, repair-shop transfers and overflow orders.");
  serviceTile(p1, fonts, M+274, 397, "LEGAL DOCUMENTS", "Time-sensitive filings, documents and service requests.");
  serviceTile(p1, fonts, M, 316, "PRINT SHOP DELIVERIES", "Finished orders, packages, printed materials and banners.");
  serviceTile(p1, fonts, M+274, 316, "GENERAL BUSINESS", "Same-day requests and planned local delivery routes.");

  p1.drawText("LOCAL SERVICE, PERSONAL ATTENTION", {
    x: M, y: 278, size: 12.5, font: fonts.bold, color: deep
  });
  paragraph(p1,
    "We primarily serve Denver, Aurora and surrounding communities. Service availability, delivery windows, special handling and final pricing are confirmed by dispatch for each request.",
    fonts.regular, 10, M, 257, W-M*2, 15, ink);

  p1.drawRectangle({ x: M, y: 102, width: W-2*M, height: 94, color: deep });
  p1.drawText("READY FOR YOUR FIRST DELIVERY?", { x: M+18, y: 165, size: 14, font: fonts.bold, color: white });
  paragraph(p1,
    "Visit www.migenteexpress.com to request a quote, or reply to your welcome email with your delivery details. A dispatcher will review your request.",
    fonts.regular, 10, M+18, 142, W-M*2-36, 15, white);
  footer(p1, fonts, 1);

  p2.drawText("FOUR EASY STEPS", { x: M, y: 636, font: fonts.bold, size: 18, color: deep });
  step(p2, fonts, 1, 607, "SEND DELIVERY DETAILS",
    "Provide pickup and drop-off addresses, item count, approximate weight and your requested pickup and delivery times.");
  step(p2, fonts, 2, 519, "DISPATCH REVIEWS THE REQUEST",
    "Our team confirms service availability, the right vehicle and your final quote before the order is accepted.");
  step(p2, fonts, 3, 431, "CONFIRM YOUR FIRST ORDER",
    "Once dispatch approves, follow the provided payment instructions and receive a confirmed delivery plan.");
  step(p2, fonts, 4, 343, "WE KEEP YOU INFORMED",
    "Receive delivery updates and applicable proof of delivery or shipping documents once the job is completed.");

  p2.drawRectangle({ x: M, y: 123, width: W-M*2, height: 125, color: pale, borderColor: rule, borderWidth: 1 });
  p2.drawText("PAYMENT AND FUTURE BUSINESS ACCOUNTS", {
    x: M+15, y: 223, font: fonts.bold, size: 11.2, color: deep
  });
  paragraph(p2,
    "For an initial delivery, payment instructions are provided after dispatch approves your quote. Qualified repeat customers may apply for an approved business account with biweekly billing. Terms are not automatic and require MG Express approval.",
    fonts.regular, 9.6, M+15, 201, W-M*2-30, 14, ink);
  p2.drawText("QUESTIONS?  www.migenteexpress.com", {
    x: M, y: 91, font: fonts.bold, size: 11, color: deep
  });
  footer(p2, fonts, 2);
  return Buffer.from(await pdf.save());
}

module.exports = { buildWelcomePacket, linesFor, safe };
