"use strict";

const publicQuote = require("./public-quote");

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

const QUOTE_KEYS = new Set([
  "customer_name", "name", "customer_phone", "phone", "pickup_address", "pickup",
  "delivery_address", "delivery", "vehicle_type", "delivery_speed", "piece_count"
]);

function argumentScore(candidate) {
  return Object.keys(candidate || {}).reduce((score, key) => score + (QUOTE_KEYS.has(key) ? 1 : 0), 0);
}

function extractArguments(body) {
  const root = parseObject(body);
  const candidates = [];
  const visit = (value, depth = 0) => {
    if (depth > 5) return;
    const object = parseObject(value);
    if (!Object.keys(object).length) return;
    candidates.push(object);
    Object.values(object).forEach((child) => {
      if ((child && typeof child === "object") || typeof child === "string") visit(child, depth + 1);
    });
  };
  visit(root);
  candidates.sort((a, b) => argumentScore(b) - argumentScore(a));
  return candidates[0] || root;
}

function words(value) {
  return String(value || "").trim().toLowerCase()
    .replace(/[–—-]/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeVehicle(value) {
  const text = words(value);
  if (!text) return "Car";
  if (text.includes("box")) return "Box Truck";
  if (text.includes("sprinter")) return "Sprinter Van";
  if (text.includes("cargo") || text.includes("van")) return "Cargo Van";
  if (text.includes("suv")) return "SUV";
  return "Car";
}

function normalizeWeight(value) {
  const text = words(value);
  const number = Number((text.match(/\d+(?:\.\d+)?/) || [])[0]);
  if (text.includes("over 75") || (Number.isFinite(number) && number > 75)) return "over_75_lbs";
  if (text.includes("50") && text.includes("75")) return "50_to_75_lbs";
  return "under_50_lbs";
}

function parseClock(value) {
  const text = words(value);
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3];
  if (hour > 23 || minute > 59) return null;
  if (meridiem) {
    hour %= 12;
    if (meridiem === "pm") hour += 12;
  }
  return hour * 60 + minute;
}

function normalizeSpeed(value, pickupTime, deliveryTime) {
  const text = words(value);
  const aliases = [
    [/next\s*day|tomorrow/, "next_day"],
    [/(^|\D)2\s*(hour|hr)|two\s*hour/, "2_hr"],
    [/(^|\D)3\s*(hour|hr)|three\s*hour/, "3_hr"],
    [/(^|\D)4\s*(hour|hr)|four\s*hour/, "4_hr"],
    [/(^|\D)5\s*(hour|hr)|five\s*hour/, "5_hr"],
    [/(^|\D)6\s*(hour|hr)|six\s*hour/, "6_hr"]
  ];
  const match = aliases.find(([pattern]) => pattern.test(text));
  if (match) return match[1];

  const start = parseClock(pickupTime);
  const finish = parseClock(deliveryTime);
  if (start != null && finish != null) {
    let minutes = finish - start;
    if (minutes <= 0) minutes += 24 * 60;
    const hours = Math.max(2, Math.min(6, Math.ceil(minutes / 60)));
    return `${hours}_hr`;
  }
  return "4_hr";
}

function normalizeInput(raw) {
  const input = { ...raw };
  const pickupTime = input.preferred_pickup_time || input.pickup_time || input.requested_pickup_time;
  const deliveryTime = input.preferred_delivery_time || input.delivery_by_time || input.deliver_by_time || input.requested_delivery_time;
  return {
    ...input,
    customer_name: input.customer_name || input.name,
    customer_email: input.customer_email || input.email,
    customer_phone: input.customer_phone || input.phone,
    pickup_address: input.pickup_address || input.pickup,
    delivery_address: input.delivery_address || input.delivery,
    preferred_pickup_time: pickupTime,
    preferred_delivery_time: deliveryTime,
    vehicle_type: normalizeVehicle(input.vehicle_type || input.vehicle),
    delivery_speed: normalizeSpeed(input.delivery_speed || input.speed || input.service_speed, pickupTime, deliveryTime),
    service_level: input.service_level || "on_demand",
    piece_count: Math.max(1, Math.min(100, Number.parseInt(input.piece_count || input.pieces || input.boxes || 1, 10) || 1)),
    package_weight: normalizeWeight(input.package_weight || input.estimated_weight || input.weight)
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed." })
    };
  }

  try {
    const input = normalizeInput(extractArguments(event.body || "{}"));
    return await publicQuote.handler({
      ...event,
      headers: {},
      body: JSON.stringify({
        ...input,
        request_source: "voice"
      })
    });
  } catch (error) {
    console.error("retell-quote error", { message: error?.message });
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Unable to process the phone quote." })
    };
  }
};
