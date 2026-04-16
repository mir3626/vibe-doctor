# Sprint M3 — Sprint flow automation

> 공용 규칙은 `.vibe/agent/_common-rules.md` 준수. Sprint 고유 규칙만 아래에 기술.
>
> **상위 컨텍스트**: `docs/plans/sprint-roadmap.md` → §Sprint M3 slot.
> **직전 Sprint 결과 요약 (M2 passed)**: `scripts/run-codex.{sh,cmd}` platform wrapper + `--health` / `--version` / retry 가시화 + `_common-rules.md §13 Sandbox-bound Generator invariants` + `run-claude.{sh,cmd}` stub. 57 pass / 1 skip (cmd health output on Git Bash — TODO M10). **M1 Planner 경고 재언급**: `lastSprintScope` / `lastSprintScopeGlob` 는 M1 이 `--scope` 입력을 verbatim 저장하고 있어, M3 는 이 필드를 **read-and-extend** 해야 하며 **rewrite 금지**.
> **단일 커밋 원칙 (v1.1.1+)**: Generator 산출 파일 + state 파일 3종을 한 커밋에 묶는다 (별도 `docs(sprint): close ...` 커밋 생성 금지). 본 Sprint 는 그 원칙을 **스크립트 레벨로 강제** 하는 wrapper 를 도입한다.

---

## Goal

Sprint 종결 시 인간 실수 지점(commit 누락, session-log 순서 drift, prompts 클러터)을 스크립트 게이트로 제거한다. 구체적으로:

1. `scripts/vibe-sprint-commit.mjs` 신규 — `vibe-sprint-complete` 위임 + dynamic scope 수집 + 자동 stage/commit (pendingRisks 가드 포함, idempotent).
2. `scripts/vibe-session-log-sync.mjs` 신규 — session-log entries 타임스탬프 정규화 + descending sort + dedup + 파일락. `vibe-sprint-complete` 말미에 자동 호출.
3. `docs/plans/sprint-roadmap.md` 의 `<!-- BEGIN:VIBE:CURRENT-SPRINT -->` 마커 블록 자동 유지 (`vibe-sprint-complete` 확장).
4. 완료된 Sprint prompt 아카이브 이동: `docs/prompts/sprint-<id>-*.md` → `.vibe/archive/prompts/sprint-<id>-*.md`.
5. `src/lib/sprint-status.ts` 에 `extendLastSprintScope()` 추가 — M1 flagged risk 이행 (read-and-extend).
6. `.vibe/agent/project-decisions.jsonl` append-only ledger + `src/lib/decisions.ts` (append / read / filter-by-scope).
7. sync-manifest 갱신 (새 harness 스크립트/lib/test + 새 project-tier 파일: `.vibe/archive/**`, `.vibe/agent/project-decisions.jsonl`).

본 Sprint 가 끝나면 Orchestrator 가 `vibe-sprint-commit <id> passed` 한 번으로 state 갱신 + archive + commit 까지 기계화되어, v1.1.1 단일 커밋 원칙의 마지막 수작업 구멍(session-log sort, current pointer 갱신, prompt archive)이 닫힌다.

### Non-goals (defer)

이번 Sprint 에서 **하지 않는** 작업 — 후속 Sprint slot 확보:

- AST 기반 project-map 자동 갱신 → **M10 또는 deferred**. M3 는 `extendLastSprintScope` 까지만.
- Cross-sprint pendingRisk 를 Planner prompt 에 자동 주입하는 wrapper → **M4** (거기서 decisions + risks 를 함께 주입).
- `commit-msg` git hook 강제 → future.
- `sync-manifest` directory glob 지원 (`.vibe/archive/**` 를 glob 로 기술하려면 M6 필요). 따라서 M3 는 glob 대신 **상수 경로 하나** (`.vibe/archive` 디렉토리 prefix) 를 project-tier 에 **literal string** 으로 등록하고, manifest 소비측은 기존 방식 (파일 단위) 로 처리. 실제 archive 안의 개별 파일 등록은 Orchestrator 가 수작업으로 하지 않는다 — `.vibe/archive` prefix 매칭만으로 downstream sync 가 배제되도록 `src/lib/sync.ts` 변경은 **금지** (glob 은 M6). 대신 `.vibe/archive/` 디렉토리 자체를 `.gitignore` 에 **추가하지 않는다** (업스트림 원본 프로젝트는 archive 를 git 에 보존). 다만 `.vibe/sync-manifest.json.files.project` 에 `.vibe/archive/README.md` sentinel 하나만 등록하여 downstream 수집 경로를 열어두되, 실제 prompt 파일들은 sync 대상 외 (manifest 미등록) — 이 전제를 final report 에 명시.
- `vibe-sprint-commit.mjs` 가 `git push` 자동 수행 → **금지**. commit 까지만. push 는 Orchestrator 수동.
- Pre-commit lint/test 실행 → **금지**. 본 Sprint 는 오로지 기계적 포장 (state 파일 + scope 파일 + state 3종) 만. tsc/test 는 이미 preflight / stop-gate 가 담당.
- Generator 재호출 / Evaluator 소환 자동화 → 범위 외.

이 목록 바깥의 "개선"/"리팩터" 수행 금지 (§공용 규칙 5).

---

## Scope — files

### 생성 (ADD)

1. `scripts/vibe-sprint-commit.mjs` — single-commit wrapper (§Technical spec 1).
2. `scripts/vibe-session-log-sync.mjs` — session-log 정규화기 (§Technical spec 2).
3. `src/lib/decisions.ts` — decisions ledger API (§Technical spec 6).
4. `.vibe/agent/project-decisions.jsonl` — 빈 파일 (0 bytes). vibe-doctor 자체 인스턴스용.
5. `.vibe/archive/prompts/.gitkeep` — directory sentinel, empty file. Prompt archive 디렉토리 뿌리.
6. `.vibe/archive/README.md` — 1줄 설명 ("Completed-sprint artifacts archived by vibe-sprint-complete. Not synced downstream except this README."). sentinel.
7. `test/sprint-commit.test.ts` — 커밋 wrapper 단위 테스트.
8. `test/session-log-sync.test.ts` — session-log 정규화 단위 테스트.
9. `test/decisions.test.ts` — decisions ledger 단위 테스트.

### 수정 (MODIFY)

10. `scripts/vibe-sprint-complete.mjs` — (a) 완료 후 `session-log-sync` 자동 호출, (b) current-pointer 마커 블록 갱신, (c) prompts archive 이동, (d) `extendLastSprintScope` 호출 (단, `--scope` 입력이 있을 때만; 기존 verbatim 저장 경로 유지하면서 확장 형태만 더함).
11. `src/lib/sprint-status.ts` — `extendLastSprintScope(scopePaths, globs?, root?)` 추가.
12. `.vibe/sync-manifest.json` — harness 에 `scripts/vibe-sprint-commit.mjs`, `scripts/vibe-session-log-sync.mjs`, `src/lib/decisions.ts`, `test/sprint-commit.test.ts`, `test/session-log-sync.test.ts`, `test/decisions.test.ts` 추가. project 에 `.vibe/agent/project-decisions.jsonl`, `.vibe/archive/README.md` 추가.
13. `test/sync.test.ts` — manifest assertion 1~2 개 추가 (새 harness + project 파일 등록 확인).
14. `test/sprint-status.test.ts` — `extendLastSprintScope` 케이스 2개 추가 (merge + dedup).

### Do NOT modify

- `CLAUDE.md` — 본 Sprint 는 script/lib/test 만.
- `.vibe/agent/_common-rules.md` — M2 가 §13 까지 추가했으니 여기선 건드리지 않음.
- `.vibe/agent/sprint-status.schema.json` — 스키마는 M1 에서 완결. 새 필드 추가 금지.
- `.vibe/agent/handoff.md` 본문 — script 가 자동 관리.
- `.vibe/agent/session-log.md` 본문 — script 가 자동 관리 (M3 의 sync 스크립트가 in-place 정규화).
- `src/lib/sync.ts` — glob 지원은 M6.
- `scripts/run-codex.{sh,cmd}` / `scripts/vibe-preflight.mjs` / `scripts/vibe-stop-qa-gate.mjs` — M2 범위 완결, 본 Sprint 미터치.
- `.vibe/config.json` — audit / qa / providers 섹션 미터치.
- Legacy completed prompts (`docs/prompts/sprint-M1-*.md`, `sprint-M2-*.md`) — archive 이동은 **이후 Sprint 완료 시점에만** 발생. M3 생성 시 자체는 이동하지 않는다 (자기 자신을 이동하는 self-archive 는 M3 종결 커밋 후 Orchestrator 가 `vibe-sprint-commit sprint-M3-sprint-flow-automation passed` 실행 시 스크립트가 수행).
- `migrations/**` — 본 Sprint 는 schema 변경 없음.

---

## Technical spec

### 1. `scripts/vibe-sprint-commit.mjs` — single-commit wrapper

**CLI**:
```
node scripts/vibe-sprint-commit.mjs <sprintId> <passed|failed> [--scope <glob,glob,...>] [--message <extra>] [--no-verify-gpg] [--dry-run]
```

**절차 (순서 고정, 각 단계 실패 시 이후 단계 skip + stderr 기록 + exit 1)**:

1. **Preconditions**:
   - cwd 가 git repo 인지 확인 (`git rev-parse --show-toplevel`). 아니면 "not a git repo" 로 exit 1.
   - `sprintId` 와 `status` 가 위치 인자 0~1 에 정확히 있는지. 없으면 usage print + exit 1.

2. **Delegate to `vibe-sprint-complete`**:
   - `import('./vibe-sprint-complete.mjs')` 가 side-effect-on-import 이므로 **child_process** 사용: `spawnSync(process.execPath, ['scripts/vibe-sprint-complete.mjs', sprintId, status, ...(scope ? ['--scope', scope.join(',')] : [])], { stdio: 'inherit' })`. non-zero exit → propagate + exit 1.

3. **Detect changed files** (post-complete 재평가; complete 가 state 3종을 이미 수정했기 때문):
   - `git diff --name-only` (unstaged) + `git diff --cached --name-only` (staged) + `git ls-files --others --exclude-standard` (untracked) 합집합을 POSIX path 로 정규화.
   - **메타 제외 필터**: 다음 패턴은 전부 제외 (prefix/suffix 매칭; regex 아님):
     - `.vibe/archive/` prefix — archive 는 이미 별도 단계에서 이동됨
     - `tmp_` prefix (repo-root level), `*.log`, `*.tmp`, `node_modules/` prefix, `dist/` prefix, `.vibe/runs/` prefix, `.vibe/sync-cache.json`, `.vibe/sync-hashes.json`, `.vibe/sync-backup/` prefix, `.vibe/agent/session-log.lock`
   - 나머지를 `changedFiles: string[]` 로 보존.

4. **Derive scope + extend**:
   - `cliScope` = `--scope` 파싱 결과 (없으면 `[]`).
   - `detectedScope` = `changedFiles` 중 state 3종 (`.vibe/agent/sprint-status.json`, `.vibe/agent/handoff.md`, `.vibe/agent/session-log.md`) 과 archive 를 제외한 것.
   - `mergedScope` = unique union (순서 보존: cliScope 먼저).
   - `mergedGlobs` = `cliScope` (verbatim — M1 호환; 새 glob 추론 로직은 범위 외).
   - `extendLastSprintScope(mergedScope, mergedGlobs)` 호출 (tsx 동적 import 또는 **dynamic `import('../dist/lib/sprint-status.js')`** — `sprint-status.ts` 가 이미 빌드 산출물 필요. 대안으로 **inline replicate**: `.vibe/agent/sprint-status.json` 을 직접 읽어 `lastSprintScope` / `lastSprintScopeGlob` 배열에 merge+dedup 후 writeFileSync. .mjs 스크립트가 tsx 에 의존하지 않도록 **inline replicate 방식을 채택**. 동작은 `extendLastSprintScope` 와 동치여야 함 (§5 helper 참조).

5. **Resolve pending-risk block**:
   - sprint-status.json 의 `pendingRisks` 를 읽어 다음 조건을 만족하는 엔트리가 하나라도 있으면 commit 거부:
     - `status === 'open'` AND (`targetSprint === sprintId` OR `targetSprint === '*'` AND id prefix `audit-`)
   - 거부 시 stderr 출력: `Refusing to commit: <N> open pendingRisk(s) target this sprint. Resolve via resolvePendingRisk() or acknowledge first:` + id/text 나열. exit 1.
   - `--dry-run` 은 이 체크까지 수행하고 stdout 으로 "would commit:" 요약 후 exit 0.

6. **Stage files**:
   - Staged 목록 (state 파일 포함):
     - `.vibe/agent/sprint-status.json`
     - `.vibe/agent/handoff.md`
     - `.vibe/agent/session-log.md`
     - `.vibe/agent/project-map.json` (존재 + modified 일 때만)
     - `.vibe/agent/sprint-api-contracts.json` (존재 + modified)
     - `.vibe/agent/project-decisions.jsonl` (존재 + modified)
     - `docs/plans/sprint-roadmap.md` (current-pointer 갱신됐을 수 있음)
     - `.vibe/archive/prompts/sprint-<sprintId>-*.md` (archive 이동 결과 — `git add -A` 아닌 명시적 glob 매칭; `fs.readdir` 로 매칭)
     - `changedFiles` 의 non-meta 파일 전부
   - `execFileSync('git', ['add', '--', ...uniqueFiles])` 한 번으로 일괄. 빈 배열이면 skip.

7. **Idempotency check (already-committed)**:
   - `git diff --cached --quiet` 반환 0 (staged changes 0) → stdout "nothing to commit (already closed?)" + exit 0. 중복 수행 방어.

8. **Generate commit message**:
   - 템플릿:
     ```
     feat(<sprintId>): <auto-summary>

     Sprint <sprintId> close (status=<passed|failed>).
     LOC +<A>/-<D> (net <±N>) across <filesChanged> file(s).
     Verification: <verifiedAt or "pending">.
     [<userMessage>]

     Co-authored-by: vibe-sprint-commit <bot@vibe-doctor>
     ```
   - `<auto-summary>`: sprint-status.json 의 매칭 sprint entry 의 `name` — 없으면 `sprintId`.
   - LOC 수치: `git diff --cached --numstat` 을 파싱하되 **코드 파일만** 합계 (확장자 whitelist: `.vibe/config.json.loc.extensions` 배열; key 없으면 fallback `['.ts','.tsx','.js','.jsx','.mjs','.cjs','.py','.go','.rs']`). 비코드 파일(문서/설정)은 합계에서 제외하되 `filesChanged` 에는 포함. 추출 규칙을 final report 에 1줄 명시.
   - `<userMessage>`: `--message` 값 (없으면 섹션 전체 생략).

9. **Commit**:
   - `git commit -m "<msg>"` (standard). `--no-verify-gpg` 지정 시 `-c commit.gpgsign=false` prepend.
   - `--no-verify` 는 **절대 적용하지 않는다** (사용자 명시 금지 규칙 준수).
   - stdout 은 git 기본 출력 + 우리 쪽 final line: `[vibe-sprint-commit] committed <sha7> for <sprintId>`.

10. **Exit code**: 성공 0, 실패 1. `--dry-run` 은 시뮬레이션 후 항상 0 (가드 실패 제외).

**Error handling / edge**:
- `vibe-sprint-complete` 가 exit non-zero → 즉시 propagate. 우리 쪽 commit 로직 실행 안 함.
- gpg 설정 충돌 (사용자 환경 gpg 키 없음) → `--no-verify-gpg` 없이 실패 시 stderr 에 "gpg signing failed — re-run with --no-verify-gpg to override" 안내 후 exit 1. (git 원본 에러도 그대로 print.)
- 사용자가 이미 수동 `git add` 한 파일이 있어도 우리 쪽 stage 셋과 중복되는 것은 idempotent (`git add` 중복 안전).
- `--scope` 에 존재하지 않는 path 가 포함돼도 verbatim 저장 — filesystem 검증 안 함 (M1 호환).

### 2. `scripts/vibe-session-log-sync.mjs` — session-log 정규화기

**CLI**:
```
node scripts/vibe-session-log-sync.mjs [<logPath>]
```

기본 `logPath` = `.vibe/agent/session-log.md`. CLI 없이 인자 없이 호출 시 해당 파일 정규화.

**파일 락**:
- `<logPath>.lock` 이라는 sentinel 파일을 `fs.openSync(lockPath, 'wx')` (O_EXCL) 로 획득.
- 이미 존재 → 최대 5초 동안 100ms 간격 retry (busy wait with `setTimeout` in async). 5초 후에도 실패 → stderr `lock held by another process: <lockPath>` + exit 2 (lock-specific).
- 성공 시 finalize 단계 (try/finally) 에서 반드시 unlink.

**파싱 규칙**:
1. 파일 전체를 utf-8 으로 읽는다.
2. 섹션 추출:
   - Header = `^.*?^## Entries\s*$\n` (첫 `## Entries` 헤더까지 포함).
   - Entries body = `## Entries` 다음부터 다음 `^## ` (Archived 등) 직전 또는 EOF 까지.
   - Archived tail = 나머지 전체 (여러 `## Archived (...)` 섹션 전부).
3. Entries body 내부를 줄 단위로 쪼개 entry 매칭 regex:
   ```
   ^-\s+(?<ts>\S+)\s+\[(?<tag>[^\]]+)\]\s*(?<body>.*)$
   ```
   빈 줄은 skip. 매칭 실패한 비어있지 않은 줄은 `malformed[]` 배열에 보존하되 위치는 원래 순서 유지 (정렬 대상 아님, 단지 아래쪽에 재부착).

**타임스탬프 정규화**:
- 입력 ts 패턴별 처리 (우선순위):
  1. ISO8601 full (`YYYY-MM-DDTHH:mm:ss.sssZ` 또는 `...Z`): `new Date(ts).toISOString()` 결과로 정규화.
  2. ISO8601 no-ms (`YYYY-MM-DDTHH:mm:ssZ` 또는 `...+00:00` 등): 동일.
  3. ISO8601 no-seconds (`YYYY-MM-DDTHH:mm`): 초 보강 → `${ts}:00.000Z`. 타임존 표기 없으면 UTC 가정.
  4. Date only (`YYYY-MM-DD`): `${ts}T00:00:00.000Z`.
  5. 그 외: malformed 로 분류.
- 정규화 실패 → `malformed` 로 강등.

**Dedup**:
- key = `<normalizedTs>\u0000<tag>\u0000<body>`. 첫 출현만 유지.

**Sort**:
- 정규화 성공한 entries 를 `normalizedTs` descending 으로 안정 정렬 (동률 시 원본 등장 순서).

**재조립**:
- Header 부분 그대로.
- 정렬된 entries 를 `- <normalizedTs> [<tag>] <body>` 포맷으로 재직렬화 (줄바꿈 하나씩).
- `malformed[]` 는 정렬된 entries **뒤에** 별도 빈 줄 없이 원본 그대로 이어붙인다 (정보 손실 방지).
- Archived tail 은 **수정 없이** 그대로.
- 최종 파일 끝 trailing newline 1개 보장.

**Idempotency**:
- 재호출 시 이미 정렬/정규화된 상태라면 byte-identical 출력. 해시 비교 후 동일하면 write skip + stdout `session-log already normalized`.

**stdout 요약**:
- `normalized=<N> deduped=<M> malformed=<K> changed=<yes|no>`.

**vibe-sprint-complete 에서 호출**:
- `vibe-sprint-complete.mjs` 말미 (session-log append 바로 다음) 에서 `spawnSync(process.execPath, ['scripts/vibe-session-log-sync.mjs'], { stdio: 'inherit' })` 실행. exit 2 (lock) 발생 시 warn 만 찍고 complete 자체는 성공 유지 (lock 실패로 state 업데이트를 rollback 하지는 않음). 다른 non-zero → warn 으로 강등.

### 3. `sprint-roadmap.md` Current pointer 마커 유지 (vibe-sprint-complete 확장)

**마커 계약**:
- `<!-- BEGIN:VIBE:CURRENT-SPRINT -->` ... `<!-- END:VIBE:CURRENT-SPRINT -->` 블록.
- 블록 내부 포맷 (정확히 이 3줄, leading `> ` blockquote 유지):
  ```
  > **Current**: <activeSprintId> (<status>, started <dateIso>)
  > **Completed**: <id1>, <id2>, ...
  > **Pending**: <id3>, ...
  ```
- Fields:
  - `activeSprintId`: 직전 호출에서 완료한 sprint 의 **다음** sprint id (roadmap 순서). 없으면 literal `idle`. status 는 `idle` 이면 `not started`.
  - `Completed`: session-log entries 중 `[sprint-complete] <id> -> passed` 매칭 id 목록 (등장 순서 유지). 비면 `—`.
  - `Pending`: roadmap 내 `^## Sprint M\d+` heading 에서 추출한 전체 id set - completed - current. 쉼표 구분. 비면 `—`.

**roadmap sprint id 추출**:
- `## Sprint M<N>` 헤딩 다음 줄의 첫 항목에 `- **id**: \`sprint-M<N>-<slug>\`` 패턴이 있으므로 그걸 파싱.
- 매칭 실패 heading 은 skip (경고만 stderr).

**갱신 로직**:
- vibe-sprint-complete 끝에서 (session-log sync 전/후 순서 무관) `sprint-roadmap.md` 읽기 → BEGIN/END 사이 내용 regex 교체.
- 블록 미존재 시 **insert 하지 않는다** (silent no-op + stderr INFO). 업스트림은 이미 마커를 보유하므로 실무상 문제 없음.
- 계산된 블록이 기존과 동일하면 write skip.

**테스트 가능성**:
- 헬퍼 함수 `computeCurrentPointerBlock(roadmapMd, sessionLogMd, lastSprintId)` 를 순수 함수로 분리 (스크립트 내부 export or separate module). 순수 함수로 단위 테스트에서 호출.

### 4. Prompts archive 이동 (vibe-sprint-complete 확장)

- `status === 'passed'` 일 때만 수행.
- 소스: `docs/prompts/sprint-<sprintId>-*.md` (glob 을 `fs.readdir` 로 흉내; prefix + suffix 매칭).
- 대상 디렉토리: `.vibe/archive/prompts/`. 없으면 `mkdirSync({ recursive: true })`.
- 이동 방식: `fs.renameSync(src, dst)`. 타겟 이미 존재 → 덮어쓰기 (`fs.renameSync` 는 POSIX 에서 덮어쓰고, Windows 에서 실패 → 선행 `unlinkSync` 후 재시도).
- 실제로 움직인 파일 목록을 stdout 에 `archived: <path1>, <path2>` 로 보고.
- `status === 'failed'` 이면 이동하지 않는다 (다음 시도에서 원본이 필요).

### 5. `src/lib/sprint-status.ts` — `extendLastSprintScope`

```typescript
export async function extendLastSprintScope(
  scopePaths: string[],
  globs?: string[],
  root?: string,
): Promise<{ lastSprintScope: string[]; lastSprintScopeGlob: string[] }>;
```

**Semantics**:
- `loadSprintStatus(root)` → status.
- `status.lastSprintScope` 에 `scopePaths` 를 뒤에 **이어붙인 뒤 중복 제거** (순서: 기존 값 먼저, 이후 신규 추가분 등장 순). POSIX path 정규화 (`\\` → `/`).
- `globs` 제공 시 `status.lastSprintScopeGlob` 도 동일 방식 merge. 제공 안 되면 기존 값 유지.
- `saveSprintStatus(status, root)` 로 persist (touchStateUpdated 자동).
- Return 은 최종 배열 2개. 테스트 편의용.

**Invariants**:
- 기존 값 손실 없음 (M1 Planner 경고 이행).
- `scopePaths === []` 이고 globs 미전달 → no-op (persist 안 함). `stateUpdatedAt` 도 건드리지 않음.

**tsc 호환**: `strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` 통과.

### 6. `.vibe/agent/project-decisions.jsonl` + `src/lib/decisions.ts`

**파일 포맷** (JSON Lines, append-only):
```
{"sprintId":"sprint-M3-sprint-flow-automation","decision":"use inline scope replicate in vibe-sprint-commit to avoid tsx dep","affectedFiles":["scripts/vibe-sprint-commit.mjs"],"tag":"decision","text":"free-form elaboration","createdAt":"2026-04-15T22:30:00.000Z"}
```

**필수 필드**: `sprintId`, `decision` (1줄 요약), `affectedFiles[]`, `tag` (`decision` | `discovery` | `deviation` | `risk`), `text`, `createdAt` (ISO8601).

**API (`src/lib/decisions.ts`)**:

```typescript
export interface ProjectDecision {
  sprintId: string;
  decision: string;
  affectedFiles: string[];
  tag: 'decision' | 'discovery' | 'deviation' | 'risk';
  text: string;
  createdAt: string;
}

export function isProjectDecision(value: unknown): value is ProjectDecision;

export async function appendDecision(
  input: Omit<ProjectDecision, 'createdAt'> & { createdAt?: string },
  root?: string,
): Promise<ProjectDecision>;

export async function readDecisions(root?: string): Promise<ProjectDecision[]>;

export function filterDecisionsByScope(
  decisions: ProjectDecision[],
  scope: string[],
): ProjectDecision[];
```

**Behavioral contracts**:
- `appendDecision` — `createdAt` 미제공 시 `new Date().toISOString()`. 경로: `.vibe/agent/project-decisions.jsonl`. Append via `appendJsonl` from `src/lib/fs.ts`. 반환은 최종 기록된 record.
- `readDecisions` — 파일 없으면 `[]`. 각 줄 parse 시 `isProjectDecision` 실패 → skip (경고 stderr). BOM / trailing newline 허용.
- `filterDecisionsByScope` — `scope[i]` 는 glob 일 수도, literal path 일 수도 있음. **minimatch 미도입** 방침 (no new dep). 매칭 규칙:
  - `**` 포함 시 `*` 를 `.*` 로 교체, `**` 를 `.*` 로 교체, `/` 는 literal, `.` 는 escape 해서 regex 생성.
  - `**` 미포함 + `*` 포함 시 단일 segment 와일드카드.
  - 와일드카드 전무 → literal substring match (`affectedFiles` 중 일부와 exact equal OR startsWith).
- 한 decision 이 여러 scope 엔트리와 매칭돼도 한 번만 반환. 입력 순서 보존.

**파일 쓰기 경로**: `src/lib/fs.ts.appendJsonl` 재사용 (이미 존재). 새 fs API 추가 금지.

### 7. `.vibe/sync-manifest.json`

**harness** 끝에 추가 (순서 보존):
```
"scripts/vibe-sprint-commit.mjs",
"scripts/vibe-session-log-sync.mjs",
"src/lib/decisions.ts",
"test/sprint-commit.test.ts",
"test/session-log-sync.test.ts",
"test/decisions.test.ts"
```

**project** 끝에 추가:
```
".vibe/agent/project-decisions.jsonl",
".vibe/archive/README.md"
```

**migrations**: 변경 없음 (M3 는 schema 변경 없음).

**Rationale**:
- `project-decisions.jsonl` 은 프로젝트별로 내용이 다르므로 project-tier.
- `.vibe/archive/README.md` 는 단순 sentinel — downstream 이 디렉토리 구조를 알도록 보존. 개별 archive 파일들은 manifest 미등록이므로 downstream sync 대상 외 (원본 프로젝트에서는 git 추적만).
- glob 디렉토리 지원은 M6 의 몫. 그 전까지는 sentinel + literal 파일 등록 전략.

### 8. `scripts/vibe-sprint-complete.mjs` — 추가 로직 배치 순서

기존 로직 전부 보존. 마지막 `writeFileSync(sessionLogPath, ...)` 다음에 아래 4단계 **순서대로** 삽입:

1. (status==='passed' 시) **Prompts archive 이동** — §4.
2. **Current-pointer 마커 갱신** — §3. `sprint-roadmap.md` 가 없거나 마커 미존재 시 skip + stderr INFO.
3. (scope !== null 시) **extendLastSprintScope 호출** — inline replicate. 기존 verbatim 저장 코드 (`sprintStatus.lastSprintScope = [...scope]`) 는 **확장** 으로 교체:
   ```
   sprintStatus.lastSprintScope = unique([...prev, ...scope])
   sprintStatus.lastSprintScopeGlob = unique([...prevGlob, ...scope])
   ```
   `prev` 는 로드 시점 값. dedup 은 등장 순서 유지.
4. **session-log-sync 호출** — §2. 실패 시 warn 로 강등.

각 단계는 독립적으로 try/catch, 한 단계 실패가 다음 단계를 막지 않도록 한다. stderr 에는 단계별 성패를 `[vibe-sprint-complete] step=<name> status=<ok|warn|fail>` 로 한 줄씩 출력.

---

## Test strategy

모든 테스트는 기존 tmp-dir 패턴 (`test/sync.test.ts` 참고) 사용. `process.cwd()` 를 오염시키지 말 것 — 대부분 `root` argument 로 해결. 스크립트 단위 테스트는 `execFileSync(process.execPath, [scriptPath, ...args], { cwd: tmpDir })` 로 격리.

### `test/sprint-commit.test.ts` (최소 5 케이스)

1. **dry-run + scope detection**: tmp repo 초기화 (`git init -q`, 초기 commit 1회 생성), 스텁 `sprint-status.json` 저장, `src/foo.ts` 생성 + stage, `node scripts/vibe-sprint-commit.mjs test-sprint passed --scope src/foo.ts --dry-run` 실행 → exit 0, stdout 에 "would commit" 및 `src/foo.ts` 포함.
2. **idempotency**: 첫 호출 후 즉시 재호출 → 두 번째 exit 0 with "nothing to commit".
3. **pending-risk block**: sprint-status 에 `pendingRisks[0] = { targetSprint: 'test-sprint', status: 'open', ... }` 넣고 호출 → exit 1, stderr 에 risk id 포함. sprint-status.json state unchanged after failure.
4. **LOC filtering**: `.vibe/config.json.loc.extensions = ['.ts']` 로 두고, staged `docs/foo.md` (10줄) + `src/foo.ts` (5줄) → commit message LOC 수치는 5/0 만 반영 (문서 제외), `filesChanged` 는 2. (child_process 로 commit 실행한 뒤 `git log -1 --format=%B` 파싱.)
5. **scope extension**: 1회차에서 `--scope src/a.ts` 로 commit, 2회차에서 `--scope src/b.ts` → sprint-status.lastSprintScope 가 `['src/a.ts','src/b.ts']` (순서 보존 + dedup). 이 테스트는 pending-risk 미도입 + 별도 sprintId 로.

**Test isolation**: 각 케이스는 tmp 디렉토리를 `mkdtemp` 로 생성하고, 테스트 끝에 `rm -rf` 정리. `git config user.email`/`user.name` 을 테스트 repo local 로 설정 (global 오염 금지). `GIT_COMMITTER_DATE` / `GIT_AUTHOR_DATE` 를 명시하여 타임스탬프 결정성 확보.

### `test/session-log-sync.test.ts` (최소 4 케이스)

1. **partial timestamp normalization**: input `- 2026-04-10T08:30 [decision] foo` → 출력 `- 2026-04-10T08:30:00.000Z [decision] foo`.
2. **sort descending**: 세 개 엔트리 (out-of-order) → 출력은 newest-first. Archived 섹션은 손상되지 않음.
3. **dedup**: 동일 `(ts, tag, body)` 반복 3회 → 결과에 한 번만 존재.
4. **lock contention**: 먼저 `.vibe/agent/session-log.lock` 파일 수동 생성 후 호출 → exit 2, stderr `lock held`. 5초 timeout 은 테스트 환경에서 너무 길어, 스크립트에 **환경변수 override** `VIBE_LOCK_TIMEOUT_MS` (default 5000) 를 두어 테스트에서 `500` 으로 설정.

### `test/decisions.test.ts` (최소 3 케이스)

1. `appendDecision` → `readDecisions` 왕복 (createdAt auto-populated).
2. 손상된 줄이 섞여 있어도 `readDecisions` 가 valid 만 반환.
3. `filterDecisionsByScope`:
   - literal match: `scope=['src/lib/decisions.ts']`, decision.affectedFiles 에 해당 path → hit.
   - glob `**/*.ts`: `src/lib/foo.ts` 포함 → hit. `scripts/bar.mjs` → miss.
   - 다중 scope entry 일치 시 중복 반환 X.

### `test/sync.test.ts` 추가

- harness 에 `scripts/vibe-sprint-commit.mjs`, `scripts/vibe-session-log-sync.mjs`, `src/lib/decisions.ts` 포함 확인.
- project 에 `.vibe/agent/project-decisions.jsonl`, `.vibe/archive/README.md` 포함 확인.

### `test/sprint-status.test.ts` 추가 (2 케이스)

- `extendLastSprintScope([])` → state 미변경, `stateUpdatedAt` 동일.
- 이미 값이 있는 `lastSprintScope` 에 중복 + 신규 paths 넣어 호출 → merge 결과 확인 (순서/중복 규칙).

### Run command

`npm test` — 기존 57 pass + 신규 ≥ 14 케이스. `npx tsc --noEmit` 통과.

---

## Verification

| id | command | expect |
|---|---|---|
| tsc | `npx tsc --noEmit` | exit 0 |
| test | `npm test` | exit 0, all tests pass |
| preflight | `node scripts/vibe-preflight.mjs` | exit 0 |
| commit-dry | `node scripts/vibe-sprint-commit.mjs sprint-M3-sprint-flow-automation passed --scope scripts/vibe-sprint-commit.mjs --dry-run` | exit 0, stdout "would commit" |
| log-sync | `node scripts/vibe-session-log-sync.mjs` | exit 0, stdout `changed=yes|no` |
| log-sync-rerun | 위 명령 즉시 재실행 | exit 0, `changed=no` |

샌드박스 제약으로 `commit-dry` 가 실행 불가 시 (provider / git config 문제) Final report 의 "Sandbox-only failures" 에 기록하고 Orchestrator 가 밖에서 재현.

---

## Checklist

- [ ] `scripts/vibe-sprint-commit.mjs` 신규 — 9단계 절차 구현 (preconditions → delegate → detect → derive → risk-guard → stage → idempotent-check → message → commit). `--dry-run` / `--scope` / `--message` / `--no-verify-gpg` 지원.
- [ ] pending-risk 가드: open + (targetSprint==id OR audit-*) 존재 시 exit 1 + 메시지. 테스트 케이스 3 커버.
- [ ] LOC 계산: `.vibe/config.json.loc.extensions` 기반 코드 파일만 합산. 테스트 케이스 4 커버.
- [ ] `scripts/vibe-session-log-sync.mjs` 신규 — 정규화 + sort desc + dedup + 락 (env override `VIBE_LOCK_TIMEOUT_MS`). Idempotent 재호출 시 byte-identical.
- [ ] `src/lib/sprint-status.ts.extendLastSprintScope` 추가 — read-and-extend (M1 경고 이행). `saveSprintStatus` 재사용하여 `stateUpdatedAt` 자동 갱신.
- [ ] `src/lib/decisions.ts` — `ProjectDecision` 타입 + `appendDecision` / `readDecisions` / `filterDecisionsByScope` / `isProjectDecision`. `appendJsonl` 재사용.
- [ ] `.vibe/agent/project-decisions.jsonl` 생성 (0 bytes).
- [ ] `.vibe/archive/prompts/.gitkeep` + `.vibe/archive/README.md` sentinel 생성.
- [ ] `scripts/vibe-sprint-complete.mjs` 에 4 단계 추가 (archive → pointer → extendScope → session-log-sync). 각 단계 독립 try/catch. 기존 CLI 시그니처 변동 없음.
- [ ] `computeCurrentPointerBlock` 순수 함수로 추출 (스크립트 내부 or 별 헬퍼). 3줄 포맷 정확 일치. Completed / Pending / Current 계산 규칙 §3 준수. 마커 미존재 시 silent no-op.
- [ ] Prompts archive: status=passed 일 때만 이동. 소스/타깃 덮어쓰기 안전. 실제 이동된 파일 stdout 보고.
- [ ] `.vibe/sync-manifest.json` — harness 6개 + project 2개 추가. migrations 미변경.
- [ ] `test/sprint-commit.test.ts` (≥5 케이스) + `test/session-log-sync.test.ts` (≥4) + `test/decisions.test.ts` (≥3) + `test/sync.test.ts` (+1~2) + `test/sprint-status.test.ts` (+2) 모두 pass.
- [ ] `npm test` pass (기존 + 신규). `npx tsc --noEmit` exit 0.
- [ ] No new runtime deps (검증: `git diff package.json` 에서 `dependencies` / `devDependencies` 신규 엔트리 0).
- [ ] 모든 .ts 파일은 `src/lib/fs.ts` 경유로만 파일 I/O (grep: `fs.writeFile` / `writeFileSync` / `fs.readFile` 직접 호출이 신규 .ts 에 0).
- [ ] `.mjs` 스크립트는 plain JS (TypeScript 금지). logger 는 console.log/stderr 직접 사용 — 기존 `vibe-sprint-complete.mjs` 스타일 일관.
- [ ] Final report 에 Verification 표 + 아래 meta 포함.

---

## Out of scope (recap — do NOT do)

- AST 기반 project-map 자동 갱신 / scan.
- Cross-sprint risk 를 Planner prompt 에 자동 주입 (M4).
- `commit-msg` git hook / pre-commit 테스트 실행.
- `git push` 자동화.
- sync-manifest glob 디렉토리 지원 (M6).
- sprint-status.schema.json 의 스키마 추가 (M1 에서 완결).
- `.vibe/archive/prompts/**` 개별 파일들을 manifest 에 등록 (sentinel README 만 등록).
- CLAUDE.md / _common-rules.md / re-incarnation.md / orchestration.md 문구 변경.

---

## Final report format

§9 `_common-rules.md` 준수. 추가로 다음 4 항목 포함:

- **Single-commit enforcement strategy** (1 문장): `vibe-sprint-commit` 의 pending-risk 가드 + idempotent check + LOC 필터 로직이 어떻게 v1.1.1 단일 커밋 원칙을 스크립트 레벨로 강제하는지.
- **Partial-timestamp resolution** (1 문장): `session-log-sync` 가 `YYYY-MM-DDTHH:mm` / `YYYY-MM-DD` 를 UTC 보강으로 정규화하는 우선순위 규칙.
- **Archive sync strategy** (1 문장): `.vibe/archive/` 가 원본 프로젝트에서는 git 추적되지만 downstream 에는 sentinel README 만 전파되는 계약.
- **Flagged risk for M4**: `vibe-sprint-commit` 이 스크립트 내부에 `extendLastSprintScope` 를 inline replicate 하고 있으므로, M4 가 `sprint-status.ts` 에서 scope merge 규칙을 변경하면 **inline replicate 가 drift** 할 수 있다. M4 Planner 는 이 중복을 참조 한 곳으로 통합할지, inline 을 고정으로 둘지 결정해야 함.
