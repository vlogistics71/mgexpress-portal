(() => {
  'use strict';

  const MARKER = '[DRIVER_APPLICATION]';
  const LEGACY_CUTOFF = new Date('2026-08-21T18:00:00Z').getTime();

  function text(value) {
    return String(value || '').trim();
  }

  function unpack(value, key) {
    const part = text(value).split('||').find(item => item.startsWith(key + '='));
    if (!part) return '';
    try {
      return decodeURIComponent(part.slice(key.length + 1));
    } catch (_error) {
      return part.slice(key.length + 1);
    }
  }

  function isHired(row) {
    return unpack(row.service_area, 'H').toLowerCase() === 'hired';
  }

  function hasPortalAccount(row) {
    return Boolean(unpack(row.service_area, 'AU'));
  }

  function isMarked(row) {
    return [
      row.vehicle_make_model,
      row.service_area,
      row.notes,
      row.internal_notes,
      row.dispatch_notes,
      row.status
    ].some(value => text(value).includes(MARKER)) || text(row.status).toLowerCase() === 'applicant';
  }

  function isLegacyWebsiteApplicant(row) {
    const created = new Date(row.created_at || 0).getTime();
    const inactive = row.active === false || row.is_active === false || row.enabled === false;
    return Boolean(
      created >= LEGACY_CUTOFF &&
      inactive &&
      text(row.email) &&
      (text(row.phone) || text(row.mobile_phone)) &&
      text(row.vehicle_make_model)
    );
  }

  function applicantName(row) {
    return text(row.full_name || row.display_name || row.name).toLowerCase();
  }

  function hideApplicantCards(applicants) {
    const names = new Set(applicants.map(applicantName).filter(Boolean));
    document.querySelectorAll('#driversGrid > *').forEach(card => {
      const heading = card.querySelector('h2, h3, strong');
      const name = text(heading?.textContent).toLowerCase();
      card.style.display = name && names.has(name) ? 'none' : '';
    });

    const visibleCards = [...document.querySelectorAll('#driversGrid > *')]
      .filter(card => card.style.display !== 'none' && !card.classList.contains('empty'));

    const meta = document.getElementById('visibleDriversMeta');
    if (meta) meta.textContent = `${visibleCards.length} driver${visibleCards.length === 1 ? '' : 's'}`;

    const totals = { available: 0, busy: 0, offline: 0 };
    visibleCards.forEach(card => {
      const value = text(card.textContent).toLowerCase();
      if (value.includes('available')) totals.available += 1;
      else if (value.includes('busy')) totals.busy += 1;
      else if (value.includes('offline')) totals.offline += 1;
    });

    const totalEl = document.getElementById('summaryTotal');
    const availableEl = document.getElementById('summaryAvailable');
    const busyEl = document.getElementById('summaryBusy');
    const offlineEl = document.getElementById('summaryOffline');
    if (totalEl) totalEl.textContent = String(visibleCards.length);
    if (availableEl) availableEl.textContent = String(totals.available);
    if (busyEl) busyEl.textContent = String(totals.busy);
    if (offlineEl) offlineEl.textContent = String(totals.offline);
  }

  async function run() {
    const client = window.mgDispatchClient;
    if (!client) return;

    const { data, error } = await client.from('drivers').select('*');
    if (error) return;

    const applicants = (data || []).filter(row => {
      const marked = isMarked(row) || isLegacyWebsiteApplicant(row);
      if (!marked) return false;

      // A hired application is shown as a driver until portal access is created.
      // Once AU is present, the real portal-enabled driver record is a separate row,
      // so the original application/history row should stay hidden here.
      if (isHired(row) && !hasPortalAccount(row)) return false;
      return true;
    });

    hideApplicantCards(applicants);
  }

  const observer = new MutationObserver(() => run());
  const grid = document.getElementById('driversGrid');
  if (grid) observer.observe(grid, { childList: true, subtree: true });

  window.addEventListener('load', () => setTimeout(run, 350));
  document.getElementById('refreshDriversBtn')?.addEventListener('click', () => setTimeout(run, 500));
})();
