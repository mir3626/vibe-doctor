#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const KEYWORDS = ['MUST NOT', 'MUST', 'NEVER', '반드시', '절대', '금지', '필수'];

function parseArgs(argv) {
  const options = {
    format: 'text',
    claudeMd: './CLAUDE.md',
    gaps: './docs/context/harness-gaps.md',
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--format=')) {
      const format = arg.slice('--format='.length);
      options.format = format === 'json' ? 'json' : 'text';
      continue;
    }
    if (arg.startsWith('--claude-md=')) {
      options.claudeMd = arg.slice('--claude-md='.length);
      continue;
    }
    if (arg.startsWith('--gaps=')) {
      options.gaps = arg.slice('--gaps='.length);
    }
  }

  return options;
}

function findKind(line) {
  const upper = line.toUpperCase();
  for (const keyword of KEYWORDS) {
    if (/^[A-Z ]+$/.test(keyword)) {
      if (upper.includes(keyword)) {
        return keyword;
      }
      continue;
    }

    if (line.includes(keyword)) {
      return keyword;
    }
  }

  return null;
}

function extractRules(content) {
  const rules = [];
  let inFence = false;

  content.split(/\r?\n/).forEach((line, index) => {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      return;
    }

    const text = line.trim();
    if (inFence || text.length === 0) {
      return;
    }

    const kind = findKind(text);
    if (kind) {
      rules.push({ line: index + 1, text, kind });
    }
  });

  return rules;
}

function splitMarkdownRow(line) {
  const cells = [];
  let current = '';

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const previous = index > 0 ? line[index - 1] : '';
    if (char === '|' && previous !== '\\') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells.filter((cell, index, array) => !(index === 0 && cell === '') && !(index === array.length - 1 && cell === ''));
}

function extractCoveredGaps(content) {
  const covered = new Set();

  for (const line of content.split(/\r?\n/)) {
    if (!/^\|\s*gap-[\w-]+\s*\|/.test(line)) {
      continue;
    }

    const cells = splitMarkdownRow(line);
    const id = cells[0];
    const scriptGate = cells[4];
    if (typeof id === 'string' && scriptGate === 'covered') {
      covered.add(id);
    }
  }

  return covered;
}

function buildAudit(claudeContent, gapsContent) {
  const coveredGaps = extractCoveredGaps(gapsContent);
  const rules = extractRules(claudeContent).map((rule) => {
    const ids = Array.from(rule.text.matchAll(/\bgap-[\w-]+\b/g), (match) => match[0]);
    const coveredBy = ids.find((id) => coveredGaps.has(id)) ?? null;
    return {
      ...rule,
      covered: coveredBy !== null,
      coveredBy,
    };
  });

  const coveredCount = rules.filter((rule) => rule.covered).length;
  return {
    summary: {
      total: rules.length,
      covered: coveredCount,
      uncovered: rules.length - coveredCount,
    },
    rules,
  };
}

function readOptional(filePath) {
  try {
    return readFileSync(resolve(filePath), 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[vibe-rule-audit] warning: ${message}\n`);
    return '';
  }
}

function renderSection(title, rules, emptyText, renderDetail) {
  const lines = [`## ${title}`];
  if (rules.length === 0) {
    lines.push(emptyText);
    return lines;
  }

  for (const rule of rules) {
    lines.push(`- CLAUDE.md:${rule.line} [${rule.kind}] ${rule.text}`);
    lines.push(`  ${renderDetail(rule)}`);
  }

  return lines;
}

function renderText(audit) {
  const uncovered = audit.rules.filter((rule) => !rule.covered);
  const covered = audit.rules.filter((rule) => rule.covered);
  const lines = [
    `# CLAUDE.md rule audit (${audit.summary.total} rules found; ${audit.summary.uncovered} uncovered)`,
    '',
    ...renderSection(
      'Uncovered (candidates for next Sprint)',
      uncovered,
      '(none)',
      () => 'hint: no matching gap-* id with script-gate=covered',
    ),
    '',
    ...renderSection('Covered', covered, '(none)', (rule) => `covered-by: ${rule.coveredBy}`),
  ];

  return `${lines.join('\n')}\n`;
}

const options = parseArgs(process.argv);
const audit = buildAudit(readOptional(options.claudeMd), readOptional(options.gaps));
if (options.format === 'json') {
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
} else {
  process.stdout.write(renderText(audit));
}
