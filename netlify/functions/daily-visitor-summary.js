const { sendResendEmail, supabaseRequest, toJsonResponse } = require("./_shared");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ranked(values, fallback) {
  const counts = new Map();
  values.filter(Boolean).forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return rows.length ? rows : [[fallback, 0]];
}

exports.handler = async () => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rows = await supabaseRequest(
      `website_page_views?select=viewed_at,path,referrer_host,session_hash&viewed_at=gte.${encodeURIComponent(since)}&order=viewed_at.desc&limit=10000`
    );
    const views = Array.isArray(rows) ? rows : [];
    const visitors = new Set(views.map(row => row.session_hash)).size;
    const pages = ranked(views.map(row => row.path), "No page views");
    const referrers = ranked(
      views.map(row => row.referrer_host).filter(host => host && !/^(www\.)?migenteexpress\.com$/i.test(host)),
      "Direct / none"
    );
    const reportDate = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Denver",
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(new Date());

    const pageHtml = pages.map(([name, count]) => `<li>${escapeHtml(name)} — ${count}</li>`).join("");
    const referrerHtml = referrers.map(([name, count]) => `<li>${escapeHtml(name)} — ${count}</li>`).join("");
    const text = [
      `MG Express website activity for ${reportDate}`,
      `Visitors: ${visitors}`,
      `Page views: ${views.length}`,
      "",
      "Top pages:",
      ...pages.map(([name, count]) => `- ${name}: ${count}`),
      "",
      "Referrals:",
      ...referrers.map(([name, count]) => `- ${name}: ${count}`),
      "",
      "Counts are privacy-conscious estimates. Raw IP addresses are not stored."
    ].join("\n");

    const email = await sendResendEmail({
      to: process.env.SECURITY_ALERT_EMAIL || "vlogistics71@gmail.com",
      subject: `MG Express Website Activity — ${reportDate}`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#17221e">
        <h2>MG Express Website Activity</h2>
        <p>${escapeHtml(reportDate)}</p>
        <p><strong>Visitors:</strong> ${visitors}<br><strong>Page views:</strong> ${views.length}</p>
        <h3>Top pages</h3><ul>${pageHtml}</ul>
        <h3>Referrals</h3><ul>${referrerHtml}</ul>
        <p style="color:#666">Privacy note: raw IP addresses are not stored.</p>
      </div>`,
      text
    });

    if (!email.configured) throw new Error("RESEND_API_KEY is not configured");

    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    await supabaseRequest(`website_page_views?viewed_at=lt.${encodeURIComponent(cutoff)}`, {
      method: "DELETE"
    });

    return toJsonResponse(200, { sent: true, visitors, page_views: views.length });
  } catch (error) {
    console.error("Daily visitor summary failed", error);
    return toJsonResponse(500, { error: "Unable to send website activity summary" });
  }
};
