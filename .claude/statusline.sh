#!/usr/bin/env bash

node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";

try {
  const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  const root = process.cwd();
  const statusPath = path.join(root, ".vibe", "agent", "sprint-status.json");
  if (!fs.existsSync(statusPath)) {
    process.exit(0);
  }

  const status = readJson(statusPath);
  const sprints = Array.isArray(status.sprints) ? status.sprints : [];
  const pendingRisks = Array.isArray(status.pendingRisks) ? status.pendingRisks : [];
  const sprintsSinceLastAudit = Number.isInteger(status.sprintsSinceLastAudit)
    ? status.sprintsSinceLastAudit
    : 0;
  const currentSprintId =
    typeof status.handoff?.currentSprintId === "string" && status.handoff.currentSprintId.length > 0
      ? status.handoff.currentSprintId
      : "idle";
  const passedCount = sprints.filter((entry) => entry?.status === "passed").length;
  const totalCount = sprints.length;
  const openRisks = pendingRisks.filter((entry) => entry?.status === "open").length;
  const parts = [`S ${currentSprintId} (${passedCount}/${totalCount})`];
  void sprintsSinceLastAudit;

  const tokensPath = path.join(root, ".vibe", "agent", "tokens.json");
  if (fs.existsSync(tokensPath)) {
    const tokens = readJson(tokensPath);
    const elapsedSeconds = Number.isFinite(tokens.elapsedSeconds) ? tokens.elapsedSeconds : 0;
    const cumulativeTokens = Number.isFinite(tokens.cumulativeTokens) ? tokens.cumulativeTokens : 0;
    parts.push(`${Math.round(elapsedSeconds / 60)}m`);
    parts.push(`${Math.floor(cumulativeTokens / 1000)}K tok`);
  }

  parts.push(`${openRisks} risks`);
  process.stdout.write(parts.join(" | "));
} catch {
  process.exit(0);
}
' 2>/dev/null || true
