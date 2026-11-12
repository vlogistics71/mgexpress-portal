exports.handler = async function () {
  const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
  if (!apiKey) {
    return { statusCode: 503, headers: { "Cache-Control": "no-store" }, body: JSON.stringify({ error: "Google Maps is not configured." }) };
  }
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify({ apiKey })
  };
};
