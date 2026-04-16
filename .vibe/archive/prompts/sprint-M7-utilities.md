# Sprint M7 — Phase 0 seal + Universal README + bundle-size + browser-smoke

## Prior

M1–M6 완료 (100 pass / 1 skip). M6 에서 `.claude/skills/test-patterns/**` 와
`.claude/skills/lint-patterns/**` shard 디렉토리, glob 지원 manifest, 그리고
`tech_stack.normalized_slugs[]` 를 통한 conventions.md shard 링크 주입까지
확정. **M6 risk**: `typescript-playwright.md` shard 가 patterns 문서로만
존재할 뿐 실제 smoke runner 가 없어, 본 Sprint 의 `vibe-browser-smoke.mjs`
가 shard 와 drift 없이 동기화되어야 한다 — 본문은 **shard 를 contract source
of truth 로 읽어** 설정 contradiction 발생 시 WARN 하도록 설계.

직전 Sprint 요약: M6 에서 stack/lint shard + manifest glob + conventions.md
링크 주입 자동화. Playwright shard 는 pattern reference 만 제공하고 runner
구현은 본 Sprint 로 이월.

## Goal

Phase 0 산출물 자동 commit, 범프로젝트 README skeleton, 번들 사이즈 게이트,
브라우저 smoke runner 4 가지 유틸리티를 **모두 opt-in** 으로 도입한다.
non-web/non-bundled 프로젝트(데이터·CLI·하드웨어)에 dead weight 를
주지 않으면서, web/frontend 프로젝트는 인터뷰 dimension 을 통해 자동
활성화. Playwright 는 **peer dependency** 로 다루고 vibe-doctor 자체는
설치하지 않는다.

비-goal: statusline / permission preset (M9), `/vibe-review` skill (M8),
번들 사이즈 history tracking, Playwright 외 다른 e2e 프레임워크 지원.

## Scope

1. **`scripts/vibe-phase0-seal.mjs`** (NEW) — Phase 0 산출물 auto-stage + commit.
   - vibe-init Phase 4 Step 4-0 직후 자동 호출 (vibe-preflight 와 별개 스크립트).
   - 대상 파일 (존재 시): `docs/context/product.md`, `docs/context/architecture.md`,
     `docs/context/conventions.md`, `docs/plans/sprint-roadmap.md`, `README.md`,
     `.vibe/interview-log/*.json`.
   - 커밋 메시지: `chore(phase0): vibe-init Phase 0 seal — {project-name}`
     (project-name 은 product.md `# {name}` 헤더에서 추출, 없으면 `package.json.name`,
     그것도 없으면 `unknown-project`).
   - **Idempotent**: 이미 staged/committed 되어 변경 없음 → exit 0 with
     `[phase0-seal] already sealed (no changes)`.
2. **Universal `README.md` skeleton** — `.claude/skills/vibe-init/templates/readme-skeleton.md`.
   - Project-agnostic. Placeholder: `{{project_name}}`, `{{one_liner}}`, `{{status}}`.
   - Status 기본값: `WIP (Phase 0 complete)`.
   - 섹션: About / Status / Development (vibe-doctor flow 짧은 참조 + npm scripts
     하이라이트) / Docs (links to `docs/context/*.md`).
   - vibe-init Phase 3 末尾 (또는 Phase 4 Step 4-0 직전) 에 Orchestrator 가
     `seedForProductMd` 의 one-liner + product.md 첫 헤더를 주입하여 프로젝트
     루트에 `README.md` 생성. **이미 존재하면 skip** (사용자 작성물 보호).
3. **`src/commands/bundle-size.ts`** (NEW) + `vibe:bundle-size` script.
   - Zero-dep: `node:zlib` `gzipSync` 만 사용. 새 runtime dep 추가 금지.
   - 설정 schema (`.vibe/config.json.bundle`):
     ```json
     {
       "bundle": {
         "enabled": false,
         "dir": "dist",
         "limitGzipKB": 80,
         "excludeExt": [".map"]
       }
     }
     ```
   - 동작: `enabled=false` → `[bundle-size] disabled (opt-in via .vibe/config.json)` 로
     exit 0 즉시 반환. `enabled=true` → `dir` 재귀 스캔 → `excludeExt` 외 파일
     gzip 합산 → KB 환산 → table 출력 → 한도 초과 시 exit 1.
   - 출력 예 (pretty table, ASCII; emoji 금지):
     ```
     file              raw KB  gz KB
     index.js           120.4    34.1
     app.css             18.2     5.6
     ----------------------------------
     total              138.6    39.7   limit=80.0  status=PASS
     ```
4. **`scripts/vibe-browser-smoke.mjs`** (NEW) + `vibe:browser-smoke` script.
   - Playwright headless. **vibe-doctor 는 설치하지 않음** — peer dep.
   - 사전 검사: `node_modules/playwright/package.json` 또는
     `node_modules/@playwright/test/package.json` 둘 중 하나라도 존재하면 OK.
     없으면 stderr 에 다음 안내 후 exit **2**:
     ```
     [vibe-browser-smoke] Playwright not installed in this project.
     Install:
       npm install -D playwright @playwright/test
       npx playwright install --with-deps chromium
     Then re-run: npm run vibe:browser-smoke
     ```
   - 설정 파일: 프로젝트 루트 `.vibe/smoke.config.js` (ESM):
     ```js
     export default {
       url: 'http://localhost:5173',
       viewport: { width: 375, height: 812 },
       expectDom: ['#stage'],
       expectConsoleFree: true,
       canvasAssertions: []
     };
     ```
   - **Contract sync (M6 risk 대응)**: 실행 전에
     `.claude/skills/test-patterns/typescript-playwright.md` 를 읽어 다음 contradiction
     검사를 수행. shard 와 충돌 시 stderr 로 `[vibe-browser-smoke] WARN: ...` 출력
     (실패는 아님, 계속 진행):
     - shard 가 권장하는 기본 `baseURL` 컨벤션 (예: `http://127.0.0.1:3000` 형식)
       과 `smoke.config.js.url` 의 host/port shape 가 명백히 다르면 WARN.
     - shard 가 role-based locator 를 권장하는데 `expectDom` 항목이 모두 ID/class
       selector (`#`, `.`) 로만 되어 있으면 WARN.
     - shard 가 fixed sleep 회피를 권장하므로 config 에 `sleep` / `delayMs` 키가
       있으면 WARN.
   - 실행: chromium headless 1회 launch → `goto(url)` → viewport 적용 →
     `expectDom[]` 각 selector locator visible 검증 → `expectConsoleFree=true` 일
     때 console error/warning 캡처 → 모두 통과 시 exit 0, 하나라도 실패 시 exit 1.
   - `.vibe/config.json.browserSmoke.enabled=false` → `[vibe-browser-smoke] disabled`
     exit 0 즉시 반환.
5. **`.vibe/config.json` 확장** — 기본 disabled 두 섹션 추가:
   ```json
   "bundle": { "enabled": false, "dir": "dist", "limitGzipKB": 80, "excludeExt": [".map"] },
   "browserSmoke": { "enabled": false, "configPath": ".vibe/smoke.config.js" }
   ```
   `src/lib/config.ts` 의 `VibeConfig` 인터페이스에 `bundle?` / `browserSmoke?`
   optional 필드 추가.
6. **vibe-init Phase 3 dimension 확장**:
   - 인터뷰 종료 후 (Step 3-2 직전) Orchestrator 가 `inferred_domain` +
     `dimensions.platform` + `tech_stack.normalized_slugs[]` 를 inspect.
   - 다음 중 하나라도 매칭되면 web/frontend 후보로 분기:
     - `normalized_slugs` 가 `ts-` prefix 를 포함하고 `web` / `mobile` / `browser`
       관련 slug (`ts-react`, `ts-vue`, `ts-svelte`, `ts-vite`, `ts-next`, etc.)
     - `platform` 이 `web` / `mobile` / `browser` 키워드 포함
   - PO-proxy 모드 (사용자 응답 없음): platform/domain 기반 자동 추론으로
     `bundle.enabled` / `browserSmoke.enabled` 결정. 수동 모드: 다음 두 질문:
     ```
     1) 번들 크기 제약이 있나요? (예: 모바일 웹, 첫 페인트 budget) [y/N]
     2) 브라우저 UI 가 있어 smoke 검증을 활성화할까요? [y/N]
     ```
   - 답변 → `.vibe/config.json` 의 `bundle.enabled` / `browserSmoke.enabled`
     업데이트. 결정 사유는 session-log 에 `[decision][phase3-utility-opt-in]` 로
     기록.
7. **`package.json` scripts** 추가:
   - `"vibe:bundle-size": "npx tsx src/commands/bundle-size.ts"`
   - `"vibe:browser-smoke": "node scripts/vibe-browser-smoke.mjs"`
8. **테스트** (`test/`):
   - `test/bundle-size.test.ts`: (a) `enabled=false` → exit 0 + skip 메시지,
     (b) tmp dir 에 known 사이즈 파일 작성 + `enabled=true` → gzip 합 = 예상치
     ±5%, (c) limit 초과 시 exit code 1.
   - `test/phase0-seal.test.ts`: tmp git repo 시뮬레이션 — Phase 0 파일 생성 →
     스크립트 실행 → 1 commit 추가 + 메시지 prefix 검증; 재실행 시 idempotent
     (no new commit).
   - `test/browser-smoke-contract.test.ts`: smoke.config.js 가 shard convention 과
     contradict (예: `sleep` 키 포함, ID-only selectors, 다른 baseURL host) →
     warn 함수 호출 (Playwright 실제 실행은 mock; runner 는 함수 분리하여
     contract-check 만 unit-testable).
9. **Manifest 업데이트** — `.vibe/sync-manifest.json` 의 `harness[]` 에 신규 파일
   8 종 추가:
   - `scripts/vibe-phase0-seal.mjs`
   - `scripts/vibe-browser-smoke.mjs`
   - `src/commands/bundle-size.ts`
   - `.claude/skills/vibe-init/templates/readme-skeleton.md`
   - `test/bundle-size.test.ts`
   - `test/phase0-seal.test.ts`
   - `test/browser-smoke-contract.test.ts`
   - (`.vibe/smoke.config.js` 는 project-side 산출물이므로 manifest `project`
     가 아닌 어디에도 등록하지 않음 — 사용자 프로젝트가 직접 작성)

## Out of scope

- Statusline / permission preset / agent-delegation 모드 (M9)
- `/vibe-review` skill, harness-gaps ledger (M8)
- 번들 사이즈 트렌드 history / 시각화
- Playwright 외 e2e (Cypress, WebdriverIO)
- bundle-size 의 source-map-explorer 식 dependency 분해

## Technical spec

### 1. `vibe-phase0-seal.mjs`

```
#!/usr/bin/env node
// Usage: node scripts/vibe-phase0-seal.mjs [--dry-run]

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DRY = process.argv.includes('--dry-run');
const CANDIDATES = [
  'docs/context/product.md',
  'docs/context/architecture.md',
  'docs/context/conventions.md',
  'docs/plans/sprint-roadmap.md',
  'README.md',
];

function sh(cmd) { return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim(); }
function trySh(cmd) { try { return sh(cmd); } catch { return null; } }

function deriveProjectName() {
  const productPath = resolve('docs/context/product.md');
  if (existsSync(productPath)) {
    const first = readFileSync(productPath, 'utf8').split(/\r?\n/).find(l => /^#\s+\S/.test(l));
    if (first) return first.replace(/^#\s+/, '').trim();
  }
  const pkgPath = resolve('package.json');
  if (existsSync(pkgPath)) {
    try { return JSON.parse(readFileSync(pkgPath, 'utf8')).name ?? 'unknown-project'; } catch {}
  }
  return 'unknown-project';
}

function collectInterviewLogs() {
  const dir = resolve('.vibe/interview-log');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => `.vibe/interview-log/${f}`);
}

// Idempotency: stage candidates, ask git if anything is actually pending.
const targets = [...CANDIDATES, ...collectInterviewLogs()].filter(p => existsSync(resolve(p)));
if (targets.length === 0) {
  process.stdout.write('[phase0-seal] no candidate files present\n');
  process.exit(0);
}

if (DRY) {
  process.stdout.write(`[phase0-seal] would stage: ${targets.join(', ')}\n`);
  process.exit(0);
}

for (const t of targets) sh(`git add -- ${JSON.stringify(t)}`);

const staged = trySh('git diff --cached --name-only');
if (!staged) {
  process.stdout.write('[phase0-seal] already sealed (no changes)\n');
  process.exit(0);
}

const projectName = deriveProjectName();
const message = `chore(phase0): vibe-init Phase 0 seal — ${projectName}`;
sh(`git -c commit.gpgsign=false commit -m ${JSON.stringify(message)}`);
process.stdout.write(`[phase0-seal] committed: ${message}\n`);
```

### 2. `bundle-size.ts` 핵심 알고리즘

```ts
import { gzipSync } from 'node:zlib';
import { readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

export interface BundleEntry { rel: string; rawBytes: number; gzBytes: number; }
export function summarize(files: string[], rootDir: string, excludeExt: string[]): BundleEntry[] {
  return files
    .filter(f => !excludeExt.includes(path.extname(f)))
    .map(f => ({
      rel: path.relative(rootDir, f).replace(/\\/g, '/'),
      rawBytes: statSync(f).size,
      gzBytes: gzipSync(readFileSync(f)).length,
    }));
}
```

`summarize` 와 출력 포맷 함수는 **export** 하여 unit-testable. CLI entry 는
config 로드 + walk + table render + exit code 결정만 담당.

### 3. `vibe-browser-smoke.mjs` contract checker

```js
// Pure function for unit testing.
export function checkContract(smokeConfig, shardText) {
  const warnings = [];
  // (a) sleep / delay key
  if (smokeConfig.sleep != null || smokeConfig.delayMs != null) {
    warnings.push('config has sleep/delayMs key; shard discourages fixed sleeps');
  }
  // (b) ID-only selectors
  if (Array.isArray(smokeConfig.expectDom) && smokeConfig.expectDom.length > 0
      && smokeConfig.expectDom.every(s => /^[#.]/.test(s))) {
    warnings.push('expectDom uses only ID/class selectors; shard prefers role-based locators');
  }
  // (c) baseURL host shape vs shard example
  const exampleMatch = shardText.match(/baseURL:\s*['"]([^'"]+)['"]/);
  if (exampleMatch && smokeConfig.url) {
    try {
      const a = new URL(exampleMatch[1]);
      const b = new URL(smokeConfig.url);
      if (a.hostname !== b.hostname && a.port !== b.port && b.hostname !== 'localhost' && b.hostname !== '127.0.0.1') {
        warnings.push(`url host ${b.host} unusual vs shard example ${a.host}`);
      }
    } catch {}
  }
  return warnings;
}
```

CLI entry 는 `checkContract` 결과를 stderr 로 출력 후 Playwright runner 호출.

### 4. README skeleton 템플릿

```md
# {{project_name}}

{{one_liner}}

## Status

{{status}}

## Development

이 프로젝트는 [vibe-doctor](https://github.com/) 하네스로 관리됩니다.

```bash
npm install
npm run vibe:qa        # 통합 QA (typecheck + test + build)
npm run vibe:doctor    # 환경 점검
```

Sprint 단위 흐름은 `CLAUDE.md` 와 `docs/context/orchestration.md` 참고.

## Docs

- [docs/context/product.md](docs/context/product.md) — 제품 정의
- [docs/context/architecture.md](docs/context/architecture.md) — 아키텍처
- [docs/context/conventions.md](docs/context/conventions.md) — 코드 규칙
```

vibe-init 가 placeholder 를 치환하여 프로젝트 루트에 `README.md` 작성. 기존
파일이 있으면 skip + `[vibe-init] README.md exists, skipping skeleton write`.

### 5. `.vibe/config.json` 추가 섹션

```json
{
  "bundle": {
    "enabled": false,
    "dir": "dist",
    "limitGzipKB": 80,
    "excludeExt": [".map"]
  },
  "browserSmoke": {
    "enabled": false,
    "configPath": ".vibe/smoke.config.js"
  }
}
```

`src/lib/config.ts` 의 `VibeConfig` 인터페이스 확장 + `mergeConfig` 의 nested
merge 대상에 두 섹션 추가 (기존 sprintRoles/sprint/providers/qa 와 동일 패턴).

### 6. vibe-init Phase 3 변경

`.claude/skills/vibe-init/SKILL.md` Phase 3 Step 3-2 와 Step 3-3 사이에 새 단계
**Step 3-4: Web/frontend utility opt-in 결정** 삽입. 본문은 위 Scope §6 의
분기 로직과 두 질문, PO-proxy 추론 규칙을 명시한다. 결과는
`.vibe/config.json` patch + session-log decision 기록 + (필요 시)
`.vibe/smoke.config.js` 스켈레톤 작성 (browserSmoke enabled 인 경우 only,
이미 존재 시 skip).

### 7. vibe-init Phase 4 Step 4-0 후속

Step 4-0 (git init) 직후 Step 4-0a 추가:
```
node scripts/vibe-phase0-seal.mjs
```
exit 0 (sealed or no-op) → 진행. exit ≠ 0 (git config 누락 등) → 사유 출력
후 사용자에게 1회 수동 실행 안내 + Phase 4 계속 (블록하지 않음).

## Test strategy

- **Unit tests**: pure function 분리 (`summarize`, `checkContract`,
  `deriveProjectName`) → Playwright/실제 git 없이 직접 호출.
- **Integration test (bundle-size)**: tmp dir 에 known content 작성, env 로
  config override (또는 `--config <path>` flag 지원) → exit code 와 stdout
  파싱.
- **Integration test (phase0-seal)**: `git init` 한 tmp repo 에 candidate 파일
  생성 → 스크립트 spawn → `git log --oneline` 결과 검증; 재실행 → log 변화
  없음 검증.
- **Skip 조건**: Playwright 실제 launch 테스트는 기본 `test:unit` 에서 제외.
  필요 시 `test:e2e` 별도 스크립트(본 Sprint 에선 추가 안 함).
- **검증 명령**:
  - `npx tsc --noEmit` 0 errors
  - `npm test` 신규 + 기존 모두 pass (skip 1 유지 허용)
  - `node scripts/vibe-preflight.mjs` green
  - `node scripts/vibe-phase0-seal.mjs --dry-run` (현 repo 에서) → 출력 확인
  - `npm run vibe:bundle-size` (`enabled=false` 기본) → exit 0 + skip 메시지

## Checklist

- [ ] `scripts/vibe-phase0-seal.mjs` 생성, `--dry-run` 지원, idempotent.
- [ ] `.claude/skills/vibe-init/templates/readme-skeleton.md` 생성, 3 placeholder.
- [ ] `src/commands/bundle-size.ts` 생성, `summarize` export, opt-in default.
- [ ] `scripts/vibe-browser-smoke.mjs` 생성, Playwright presence check (exit 2),
      `checkContract` export, opt-in default.
- [ ] `.vibe/config.json` 에 `bundle` + `browserSmoke` 섹션 추가 (둘 다 `enabled: false`).
- [ ] `src/lib/config.ts` `VibeConfig` 인터페이스 확장 + `mergeConfig` 분기 추가.
- [ ] `.claude/skills/vibe-init/SKILL.md` Phase 3 Step 3-4 + Phase 4 Step 4-0a 추가.
- [ ] `package.json.scripts` 에 `vibe:bundle-size`, `vibe:browser-smoke` 추가.
- [ ] `test/bundle-size.test.ts` (3 cases) 추가, 통과.
- [ ] `test/phase0-seal.test.ts` (commit + idempotent) 추가, 통과.
- [ ] `test/browser-smoke-contract.test.ts` (3 contradiction cases) 추가, 통과.
- [ ] `.vibe/sync-manifest.json` `harness[]` 에 신규 파일 8종 추가.
- [ ] `npx tsc --noEmit` 0 errors.
- [ ] `npm test` 전체 pass (이전 100 pass / 1 skip 기준 유지 또는 증가).
- [ ] `node scripts/vibe-preflight.mjs` exit 0.
- [ ] 새 runtime dependency 0 (devDependency 도 추가하지 않음 — Playwright 는
      peer dep, 사용자 측 install).

## Final report

Generator 가 작업 완료 시 다음을 stdout 마지막에 출력:

```
[sprint-M7] files changed: <N>
[sprint-M7] LOC added: <A>, removed: <D>, net: <N>
[sprint-M7] tests: <pass>/<fail>/<skip>
[sprint-M7] tsc: 0 errors
[sprint-M7] new harness manifest entries: 8
[sprint-M7] phase0-seal dry-run: <output snippet>
```
