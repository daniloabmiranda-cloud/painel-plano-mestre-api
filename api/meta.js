const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const BASE = 'https://graph.facebook.com/v19.0';

const FIELDS = [
  'campaign_name',
  'adset_name',
  'impressions',
  'clicks',
  'reach',
  'spend',
  'cpm',
  'cpc',
  'ctr',
  'frequency',
  'actions',
  'cost_per_action_type',
  'date_start',
  'date_stop'
].join(',');

async function fetchInsights(accountId, token, dateRange) {
  const params = new URLSearchParams({
    level: 'campaign',
    fields: FIELDS,
    date_preset: dateRange || 'last_30d',
    access_token: token,
    limit: 100
  });

  const url = `${BASE}/act_${accountId}/insights?${params}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.error) throw new Error(data.error.message);
  return data.data || [];
}

function processInsights(raw) {
  return raw.map(row => {
    const leads = row.actions?.find(a =>
      a.action_type === 'onsite_conversion.messaging_conversation_started_7d'
    )?.value || 0;

    const purchases = row.actions?.find(a =>
      a.action_type === 'offsite_conversion.fb_pixel_purchase'
    )?.value || 0;

    const addToCart = row.actions?.find(a =>
      a.action_type === 'offsite_conversion.fb_pixel_add_to_cart'
    )?.value || 0;

    const profileVisits = row.actions?.find(a =>
      a.action_type === 'profile_visit_view'
    )?.value || 0;

    const totalResults = parseInt(leads) + parseInt(purchases) + parseInt(addToCart) + parseInt(profileVisits);
    const cpr = totalResults > 0 ? (parseFloat(row.spend) / totalResults).toFixed(2) : null;

    return {
      campaign: row.campaign_name,
      impressions: parseInt(row.impressions || 0),
      clicks: parseInt(row.clicks || 0),
      reach: parseInt(row.reach || 0),
      spend: parseFloat(row.spend || 0),
      cpm: parseFloat(row.cpm || 0),
      cpc: parseFloat(row.cpc || 0),
      ctr: parseFloat(row.ctr || 0),
      frequency: parseFloat(row.frequency || 0),
      leads: parseInt(leads),
      purchases: parseInt(purchases),
      addToCart: parseInt(addToCart),
      profileVisits: parseInt(profileVisits),
      totalResults,
      cpr: cpr ? parseFloat(cpr) : null,
      period: `${row.date_start} a ${row.date_stop}`
    };
  });
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.META_ACCESS_TOKEN;
  const { dateRange } = req.query;

  if (!token) {
    return res.status(500).json({ error: 'META_ACCESS_TOKEN não configurado' });
  }

  // IDs das contas de cada cliente
  const accounts = {
    planeta_energia: process.env.ACCOUNT_PLANETA_ENERGIA,
    masterplan_marcenaria: process.env.ACCOUNT_MASTERPLAN_MARCENARIA,
    usaflex: process.env.ACCOUNT_USAFLEX,
    havaianas: process.env.ACCOUNT_HAVAIANAS
  };

  try {
    const results = {};

    for (const [client, accountId] of Object.entries(accounts)) {
      if (!accountId) continue;
      try {
        const raw = await fetchInsights(accountId, token, dateRange);
        const processed = processInsights(raw);

        const totals = processed.reduce((acc, row) => ({
          impressions: acc.impressions + row.impressions,
          clicks: acc.clicks + row.clicks,
          reach: acc.reach + row.reach,
          spend: acc.spend + row.spend,
          leads: acc.leads + row.leads,
          purchases: acc.purchases + row.purchases,
          addToCart: acc.addToCart + row.addToCart,
          totalResults: acc.totalResults + row.totalResults
        }), { impressions:0, clicks:0, reach:0, spend:0, leads:0, purchases:0, addToCart:0, totalResults:0 });

        totals.cpm = totals.impressions > 0 ? (totals.spend / totals.impressions * 1000) : 0;
        totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions * 100) : 0;
        totals.cpl = totals.leads > 0 ? (totals.spend / totals.leads) : 0;
        totals.spend = parseFloat(totals.spend.toFixed(2));
        totals.cpm = parseFloat(totals.cpm.toFixed(2));
        totals.ctr = parseFloat(totals.ctr.toFixed(2));
        totals.cpl = parseFloat(totals.cpl.toFixed(2));

        results[client] = { campaigns: processed, totals };
      } catch (err) {
        results[client] = { error: err.message };
      }
    }

    // Totais gerais
    const overall = Object.values(results)
      .filter(r => !r.error && r.totals)
      .reduce((acc, { totals }) => ({
        impressions: acc.impressions + totals.impressions,
        clicks: acc.clicks + totals.clicks,
        reach: acc.reach + totals.reach,
        spend: parseFloat((acc.spend + totals.spend).toFixed(2)),
        leads: acc.leads + totals.leads,
        totalResults: acc.totalResults + totals.totalResults
      }), { impressions:0, clicks:0, reach:0, spend:0, leads:0, totalResults:0 });

    res.status(200).json({
      updatedAt: new Date().toISOString(),
      period: dateRange || 'last_30d',
      overall,
      clients: results
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
