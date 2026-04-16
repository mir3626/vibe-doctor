#!/usr/bin/env bash

node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";

try {
  const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  const readJsonOptional = (filePath) => {
    try {
      return readJson(filePath);
    } catch {
      return undefined;
    }
  };
  const getString = (value) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined);
  const normalizeVersion = (version) => version.trim().replace(/^v/i, "");
  const toVersionParts = (version) => {
    const normalized = normalizeVersion(version);
    if (!/^\d+(?:\.\d+)*$/.test(normalized)) {
      return undefined;
    }

    return normalized.split(".").map((part) => Number.parseInt(part, 10));
  };
  const compareVersions = (left, right) => {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const leftPart = left[index] ?? 0;
      const rightPart = right[index] ?? 0;
      if (leftPart !== rightPart) {
        return leftPart > rightPart ? 1 : -1;
      }
    }

    return 0;
  };
  const getVersionSuffix = () => {
    const config = readJsonOptional(path.join(root, ".vibe", "config.json"));
    const installedRaw = getString(config?.harnessVersionInstalled) ?? getString(config?.harnessVersion);
    const installedParts = installedRaw ? toVersionParts(installedRaw) : undefined;
    if (!installedRaw || !installedParts) {
      return undefined;
    }

    const installedVersion = normalizeVersion(installedRaw);
    const syncCache = readJsonOptional(path.join(root, ".vibe", "sync-cache.json"));
    const latestRaw = getString(syncCache?.latestVersion);
    const latestParts = latestRaw ? toVersionParts(latestRaw) : undefined;
    if (latestRaw && latestParts && compareVersions(installedParts, latestParts) < 0) {
      return `v${installedVersion} \u26A0 v${normalizeVersion(latestRaw)} (/vibe-sync)`;
    }

    return `v${installedVersion}`;
  };
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
  const versionSuffix = getVersionSuffix();
  if (versionSuffix) {
    parts.push(versionSuffix);
  }
  process.stdout.write(parts.join(" | "));
} catch {
  process.exit(0);
}
' 2>/dev/null || true
