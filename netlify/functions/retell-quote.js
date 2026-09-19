"use strict";

const publicQuote = require("./public-quote");

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed." })
    };
  }

  try {
    const input = JSON.parse(event.body || "{}");
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
