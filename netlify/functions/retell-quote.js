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

function extractArguments(body) {
  const root = parseObject(body);
  const nested = [root.args, root.arguments, root.payload, root.data]
    .map(parseObject)
    .find((candidate) => Object.keys(candidate).length > 0);
  return nested || root;
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
    const input = extractArguments(event.body || "{}");
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
