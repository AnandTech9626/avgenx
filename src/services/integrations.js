// Integration registry: every external capability the platform depends on, the interface it
// expects, and whether it is connected. Status is computed from settings; nothing here
// pretends a service works when it is not configured.
export const INTEGRATIONS = [
  { id: 'ai', name: 'AI provider', category: 'Learning', uses: 'Learning copilot, quiz generation, executive summaries', iface: 'POST /api/ai {messages} → text/event-stream {text}', creds: 'ANTHROPIC_API_KEY (server only)', sample: 'netlify/functions/ai.mjs' },
  { id: 'execution', name: 'Code execution service', category: 'Learning', uses: 'Running and judging C++, Java, Python (and server-side JavaScript)', iface: 'POST /api/execute {lang, code, problemId} → {status, results[]}', creds: 'Judge0 or container runner URL + token (server only)' },
  { id: 'payments', name: 'Payment gateway', category: 'Finance', uses: 'Online fee collection, refunds payout, receipts', iface: 'POST /api/payments/intents; webhook /api/payments/webhook (signature verified)', creds: 'Gateway key + webhook secret (server only)' },
  { id: 'email', name: 'Email delivery', category: 'Messaging', uses: 'Notification emails, receipts, certificates', iface: 'POST /api/notify/email', creds: 'SMTP or provider API key' },
  { id: 'sms', name: 'SMS', category: 'Messaging', uses: 'Class reminders, fee due alerts', iface: 'POST /api/notify/sms', creds: 'SMS provider key + DLT template IDs' },
  { id: 'push', name: 'Web push', category: 'Messaging', uses: 'Browser push notifications', iface: 'VAPID keys + POST /api/notify/push', creds: 'VAPID private key (server only)' },
  { id: 'video', name: 'Video conferencing', category: 'Classes', uses: 'Meeting links, recordings, attendance import', iface: 'POST /api/meetings; webhook for recordings', creds: 'Zoom / Google Meet / Teams app credentials' },
  { id: 'calendar', name: 'Calendar sync', category: 'Classes', uses: 'Session invites and reschedules', iface: 'CalDAV or Google/Microsoft calendar API', creds: 'OAuth client' },
  { id: 'github', name: 'GitHub', category: 'Developer workflow', uses: 'Repository linking, commits, PR reviews, CI status', iface: 'GitHub App (OAuth); webhooks for push, pull_request, check_suite', creds: 'GitHub App ID + private key (server only)' },
  { id: 'gitlab', name: 'GitLab', category: 'Developer workflow', uses: 'Same as GitHub for GitLab-hosted work', iface: 'OAuth app + webhooks', creds: 'OAuth client secret (server only)' },
  { id: 'pdf', name: 'PDF certificates', category: 'Credentials', uses: 'Signed, downloadable certificate PDFs', iface: 'GET /api/certificates/:id.pdf', creds: 'Signing key (server only)' },
  { id: 'plagiarism', name: 'Plagiarism detection', category: 'Academic integrity', uses: 'Similarity checks on code submissions', iface: 'POST /api/integrity/check {submissionId} → {similarity, matches[]}', creds: 'MOSS / provider key' },
  { id: 'sso', name: 'Single sign-on', category: 'Identity', uses: 'Staff and corporate client sign-in', iface: 'OIDC / SAML via the auth service', creds: 'IdP metadata + client secret' },
  { id: 'backup', name: 'Backups', category: 'Operations', uses: 'Point-in-time recovery for the database', iface: 'Managed database PITR + nightly export to object storage', creds: 'Cloud provider role' },
  { id: 'riskModel', name: 'Predictive risk model', category: 'Analytics', uses: 'Optional extra risk signal alongside explainable rules', iface: 'POST /api/risk/score {features} → {probability, factors[]}', creds: 'Model endpoint token' },
];

export function integrationStatus(settings, id, extra = {}) {
  if (id === 'ai' && extra.artifactAI) return { connected: true, label: 'Connected (Claude artifact viewer)' };
  if (id === 'execution' && extra.browserJS) return { connected: false, partial: true, label: 'Browser sandbox for JavaScript only' };
  const ep = settings.integrations?.[id]?.endpoint;
  return ep ? { connected: true, label: `Endpoint set: ${ep}` } : { connected: false, label: 'Not connected' };
}
