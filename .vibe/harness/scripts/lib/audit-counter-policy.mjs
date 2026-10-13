// Only the historical, mechanically generated counter reminder is advisory in
// Astra. A similarly named audit finding or a record with extra evidence is not.
export function isCounterOnlyAuditRisk(risk) {
  if (!risk || risk.raisedBy !== 'vibe-sprint-complete' || risk.targetSprint !== '*') return false;
  if (typeof risk.id !== 'string' || !/^audit-after-.+$/u.test(risk.id)) return false;
  const fields = new Set(['id', 'raisedBy', 'targetSprint', 'text', 'status', 'createdAt']);
  if (Object.keys(risk).some((key) => !fields.has(key))) return false;
  return typeof risk.text === 'string'
    && /^Evaluator audit due \(sprintsSinceLastAudit=\d+, everyN=\d+\)\.$/u.test(risk.text);
}

// Astra reads pendingRisks only for open `audit-*` records; of those, every record but a
// counter reminder is a finding that still needs resolution (preflight audit.overdue, statusline).
export function classifyAstraAuditRisks(pendingRisks) {
  const open = (Array.isArray(pendingRisks) ? pendingRisks : [])
    .filter((risk) => risk?.status === 'open' && typeof risk?.id === 'string' && risk.id.startsWith('audit-'));
  const findings = open.filter((risk) => !isCounterOnlyAuditRisk(risk));
  return { reminders: open.length - findings.length, findings };
}
