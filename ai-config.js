// AI links for the CRM. Classic script, loaded before the provider scripts.
// The CRM sends the signed-in person's session token to these two links, so they live in code and NOT in the CRM settings, where any team login could change them.
// After deploying each Cloudflare Worker (ask-ai and contract-ai), the owner or Claude fills in the https links below, for example
//   askUrl: 'https://crm-ask.your-name.workers.dev'
// Only https links on workers.dev are accepted (or http://localhost while testing). An empty value keeps that assistant switched off and hidden.
window.BS_AI = { askUrl: 'https://crm-ask.baselinestudiofl.workers.dev', contractUrl: 'https://contract-ai.baselinestudiofl.workers.dev' };
