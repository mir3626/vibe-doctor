# Sprint: N1 — rule audit diet (iter-3 dominant outcome)

> 공용 규칙은 `.vibe/agent/_common-rules.md` 준수 (§1 샌드박스 우회 금지 / §2 의존성
> 설치 금지 / §5 범위 준수 / §9 Final report 형식 / §14 Wiring Integration Checklist).
> 본 프롬프트는 그 위에 **iter-3 제약** 과 **N1 고유 스펙** 을 얹는다.

## 직전 Sprint 결과 요약 (2~3 lines — Orchestrator 첨부)

- iter-2 closure (commit `4d9a002`, tag `v1.4.0`) 에서 `vibe-rule-audit.mjs` 가 28 uncovered MUST/반드시/금지 rules 를 보고. 사용자 자각: "하네스를 위한 하네스" self-expansion pattern 확인.
- iter-3 kickoff commit (현재 HEAD) — interview 7 rounds 종료 + sprint-roadmap.md 에 `# Iteration 3` 섹션 append + `.vibe/agent/iteration-history.json.currentIteration = "iter-3"` 설정 완료.
- Tests pass / 0 fail (Orchestrator sandbox-free verify 기준). `scripts/vibe-rule-audit.mjs` ~186 lines. CLAUDE.md baseline line count 는 `wc -l CLAUDE.md` 실행 시점 확인 (`wc -l` 기준 사용, PowerShell Measure-Object 와 값이 다를 수 있음).

---

## Context & why

**Iter-3 전체 priority 는 a > b > c > d** 이며, 본 Sprint N1 이 `a` (rule audit diet) = **dominant outcome** 이다. 28 rules 전수를 semantic cluster 단위로 재정의하여 **dogfood6~7 session-log 의 retrospective evidence** 를 근거로 S/A/B/C tier 를 부여하고, B/C tier 는 삭제, Should 조건은 Must 로 격상 (격상 실패 시 삭제) 한다. 결과물은 CLAUDE.md trim + `.vibe/audit/iter-3/` iteration-scoped artifacts.

**Meta 원칙** (interview round 2 attribution):
- Rule unit = **semantic cluster** (line/섹션 단위 아님).
- Rule relation = **Should → Must 단일방향 격상**. 격상 실패 rule 은 **무조건 삭제**.
- Must Not 은 **rule-level prohibition (행동 금지)** 에만 허용. trigger matrix 에서는 사용 금지 (negative trigger 무의미).
- Tier (S/A/B/C, incident frequency 기반) 와 Should→Must 격상은 **orthogonal 두 축**. N1 이 둘 다 처리.
- Agent 가 Should 조건을 실제로 준수한 적 없으므로 Should 제거가 agent-first 설계의 핵심.

**Evidence source 확대** (interview round 1):
- `C:\Users\Tony\Workspace\vibe-doctor\.vibe\agent\session-log.md` (self)
- `C:\Users\Tony\Workspace\dogfood6\.vibe\agent\session-log.md` (dogfood6 retrospective)
- `C:\Users\Tony\Workspace\dogfood7\.vibe\agent\session-log.md` (dogfood7 retrospective)
- `C:\Users\Tony\Workspace\dogfood6\docs\reports\` + `C:\Users\Tony\Workspace\dogfood7\docs\reports\` (review 산출물, 보조 참조)

**iter-3 핵심 가치 (절대 보존 — line-level 삭제 금지)**:
- `scripts/vibe-interview.mjs` + `.claude/skills/vibe-init` / `vibe-interview` 관련 rule (socratic interview core)
- sprint-planner agent 소환 메커니즘 + `vibe-sprint-complete` / `vibe-sprint-commit` 관련 rule
- `run-codex.sh` / `run-codex.cmd` wrapper 관련 rule (Windows/UTF-8)
- Generator(Codex) 위임 원칙 / 소스코드 직접 편집 금지
- Sub-agent context isolation principle (= sub-agent 재프레임 블록)

**N1 scope 바운더리**:
- Charter/Extensions 재구조화는 **N3 scope** — N1 에서는 pure content trim 만. 줄 순서 재배치 금지.
- 버그 수정은 **N2 scope** — N1 에서는 script behavior 변경 외 버그 패치 금지.
- mode flag (`"human"|"agent"`) 정의는 **N3 scope** — N1 에서 언급 금지.
- dogfood6/7 프로젝트는 **read-only** — transcript 만 읽고 파일/git 수정 금지.

---

## Prerequisites (already installed / ready)

- Zod v3 runtime dep (iter-2 M-audit).
- `scripts/vibe-audit-lightweight.mjs` + `scripts/vibe-audit-clear.mjs` + `scripts/vibe-audit-skip-set.mjs` (iter-2 audit gates).
- `.claude/agents/sprint-planner.md` (iter-2 M-process-discipline rename).
- `.vibe/agent/_common-rules.md §14 Wiring Integration Checklist` (본 Sprint 의 Final report 형식 강제).
- `scripts/vibe-rule-audit.mjs` (**확장 대상 — 신규 파일 금지**, 본 Sprint 에서 수정).
- `test/rule-audit.test.ts` (확장 대상 — 신규 테스트 추가).
- iter-3 handoff 제약 = **0 new scripts + net ≤ +150 LOC / iter**. N1 예상 delta: add 80~130 / delete 300~600 = net negative 또는 very small positive.

---

## Deliverables (D1~D6)

### D1 — `scripts/vibe-rule-audit.mjs` 확장

**기존 파일 수정, 신규 .mjs 파일 금지** (iter-3 0 new scripts 제약).

**새 CLI 옵션**:
- `--scan-transcripts <comma-separated-abs-paths>`
  - 각 path 는 **repo root 디렉토리 절대경로** (예: `C:\Users\Tony\Workspace\dogfood6`).
  - 각 path 에 대해 `<path>/.vibe/agent/session-log.md` 를 읽는다.
  - 존재하지 않거나 읽기 실패 시 **graceful skip** (stderr 에 `[vibe-rule-audit] warning: scan target missing: <path>` 1줄 출력, 해당 source 는 empty evidence set 으로 처리, 전체 실행은 계속).
  - 구분자 = `,`. trailing/whitespace trim.
- `--format=json` (기존 유지) — JSON 출력에 아래 확장 필드 포함.

**Incident extraction 규칙**:
- 각 transcript line 에서 태그 패턴 `^- \S+ \[(failure|drift-observed|decision|audit-clear)\]` (대괄호 태그 임의 위치 허용) 감지.
- tag count 는 source path 별로 집계. 통합 incident count = sum across sources.
- 각 rule cluster 와의 **키워드 매칭** (아래 Rule unit 참조) 시 해당 rule 의 evidence 에 incident 를 귀속.

**Rule unit = semantic cluster** 정의:
- CLAUDE.md 를 heading 기준으로 cluster 경계 감지:
  - `^## ` 또는 `^### ` 로 시작하는 line 이 cluster 시작.
  - cluster 끝 = 다음 `^##`/`^###` 직전까지 또는 파일 끝.
  - HTML comment marker (`<!-- BEGIN:... -->` / `<!-- END:... -->`) 는 무시.
- 각 cluster 는 **cluster_id** (stable slug, heading text 기반 kebab-case) + **cluster_label** (heading text) + **start_line** + **end_line** + **body_text** 를 가짐.
- rule **imperative keyword** (`MUST`, `MUST NOT`, `NEVER`, `반드시`, `절대`, `금지`, `필수`, `Must`, `Should`) 를 **cluster body** 에서 scan. 해당 keyword 가 최소 1회라도 등장하는 cluster 만 tier 판정 대상. 0 hit cluster 는 tier 판정 skip (non-rule descriptive section 으로 간주).
- fallback: heading 이 하나도 없는 경우 혹은 rule keyword 포함 cluster 수 < 5 인 경우에는 **5-line sliding window** 로 fallback cluster 생성 (기존 line-level extraction 호환성 유지).

**Rule ↔ evidence 매칭 (keyword rubric)**:
- 각 cluster 의 body_text 에서 **non-trivial keyword** 자동 추출 (min length 3, Korean/English 혼용). stopword 제외.
- dogfood transcript 의 각 tagged line 에 대해 해당 cluster 의 keyword 중 하나라도 line 에 substring 매치되면 evidence hit.
- 매칭된 evidence line snippet (최대 160 chars) 을 cluster 의 `evidence_examples` 에 push (dedup, 최대 3).

**Tier heuristic (결정적)**:

| tier | 조건 | 의미 |
|---|---|---|
| S | incident_count ≥ 3 across all transcripts | script gate 로 유지. 재현 불가 실패/데이터 손실/silently 틀린 산출물 signal. |
| A | 1 ≤ incident_count ≤ 2 | MD 에 유지 (agent 자연 학습 가능), script gate 필요 없음. |
| B | incident_count == 0 **AND** cluster 에 기존 `gap-*` link 존재 OR script 참조 존재 | MD 에서 삭제. script/gap 에 cover 되어 있거나 (중복), 혹은 단순 dead preventive expectation. |
| C | incident_count == 0 **AND** 위 조건 모두 미충족 | MD 에서 삭제 + 관련 dangling script/hook 도 grep 후 정리. |

**Should → Must 격상 candidate 판정**:
- cluster body 에서 `Should|권장|가능하면|가능한 경우|선택적으로|추천|원칙적으로` 등 soft verb regex 검출 → `should_to_must_candidate = true`.
- candidate 인 rule 에 대해 output 에 `tightening_suggestion` 텍스트 필드 포함 (heuristic: "trigger 조건을 `<keyword>` 포함 line 기준으로 tighten" 수준의 1-line 힌트, 구현 pseudocode 금지).

**Output schema (JSON when `--format=json`)**:
```json
{
  "summary": {
    "total": <int>,           // rule-keyword cluster 수
    "covered": <int>,          // 기존 gap-* covered link 매칭 수 (backward compat)
    "uncovered": <int>,
    "tiered": true,            // 본 Sprint 에서 확장된 tier 분류가 수행됨을 표시
    "bySource": {              // transcript source path -> tag counts
      "<absolute-path>": {
        "present": <boolean>,
        "failure": <int>,
        "drift-observed": <int>,
        "decision": <int>,
        "audit-clear": <int>
      }
    },
    "byTier": { "S": <int>, "A": <int>, "B": <int>, "C": <int>, "unclassified": <int> },
    "shouldToMustCandidates": <int>
  },
  "rules": [
    {
      "line": <int>,                 // backward compat (cluster start line)
      "text": "<cluster_label>",     // backward compat
      "kind": "<first-matched-keyword>",
      "covered": <boolean>,
      "coveredBy": "<gap-id or null>",
      "cluster": {
        "id": "<slug>",
        "label": "<heading text>",
        "startLine": <int>,
        "endLine": <int>,
        "keywords": ["..."],
        "evidenceCount": <int>,
        "evidenceExamples": ["snippet1", "snippet2"],
        "tier": "S" | "A" | "B" | "C" | "unclassified",
        "recommendedAction": "keep-script" | "keep-md-only" | "delete-md" | "delete-md-and-script",
        "shouldToMustCandidate": <boolean>,
        "tighteningSuggestion": "<string or null>"
      }
    }
  ]
}
```

**Backward compatibility**:
- `rules[].line`, `rules[].text`, `rules[].kind`, `rules[].covered`, `rules[].coveredBy` 5 필드는 기존 `test/rule-audit.test.ts` 의 2개 테스트를 **그대로** 통과시킨다 (line 수, covered 매칭, fenced block 제외 3가지 불변).
- `--scan-transcripts` 미전달 시 `summary.bySource = {}`, `summary.byTier` 의 모든 값 = 0, `summary.tiered = false`. 기존 테스트 2개 (`emits JSON with covered and uncovered rule candidates`, `renders both text sections ...`) 는 변경 없이 통과.
- `--format` 기본값 = `text`. text output 에는 tier section 을 **추가로** append (기존 "Uncovered" / "Covered" 섹션 유지 + 새 "## By tier (S/A/B/C)" 섹션 추가). 기존 text regex 2건 (`## Uncovered ...`, `## Covered\n\(none\)`) 는 깨뜨리지 않는다.

### D2 — `.vibe/audit/iter-3/rule-audit-report.md` (신규 artifact, iteration-scoped)

**Location**: `C:\Users\Tony\Workspace\vibe-doctor\.vibe\audit\iter-3\rule-audit-report.md`.

**Content**:
- 헤더: `# iter-3 rule audit report` + timestamp (ISO8601 Z) + sources 목록 + tool version.
- 표 (cluster 당 1 row):

  | cluster_id | cluster_label | cluster_lines (start-end in CLAUDE.md) | evidence_count | evidence_examples (top 3, short) | tier | recommended_action | should_to_must_candidate | tightening_suggestion |

- 표 이후:
  - `## Summary` (byTier counts, total, sources scanned, missing sources).
  - `## Sources scanned` (각 source 의 tag counts, present/missing).
  - `## Restoration protocol` — 1~2 줄: "dogfood8 post-acceptance 시 본 report + `rules-deleted.md` 를 함께 리뷰, 복원 필요 cluster 는 CLAUDE.md 에 재삽입 후 `.vibe/audit/iter-3/` 를 `rm -rf` 한다."

**생성 방식**: `scripts/vibe-rule-audit.mjs` 의 기본 실행 결과 (JSON) 를 이 파일로 직렬화하는 별도 **CLI subcommand 추가 금지** (0 new scripts 원칙 + 복잡도 회피). 대신 **`--emit-report-md <path>`** 옵션을 `scripts/vibe-rule-audit.mjs` 에 추가 (0 new file, 기존 script 확장) → 이 파일을 생성. Generator 는 1회 실행:
```
node scripts/vibe-rule-audit.mjs \
  --scan-transcripts C:\Users\Tony\Workspace\dogfood6,C:\Users\Tony\Workspace\dogfood7 \
  --emit-report-md .vibe/audit/iter-3/rule-audit-report.md \
  --format=json > /dev/null
```
이 옵션이 전달되면 stdout JSON 과 **동시에** report MD 를 파일로 저장. 미전달 시 기존 동작 유지.

**Row count expectation**: `grep -c '^|' .vibe/audit/iter-3/rule-audit-report.md > 20` (heading row + 최소 20 cluster row 이상).

### D3 — `.vibe/audit/iter-3/rules-deleted.md` (신규 artifact, iteration-scoped)

**Location**: `C:\Users\Tony\Workspace\vibe-doctor\.vibe\audit\iter-3\rules-deleted.md`.

**Content**: 삭제된 각 cluster 의 **원문 전량** 보관 + 삭제 사유.

```markdown
# iter-3 rules-deleted ledger

> 복원 결정은 dogfood8 post-acceptance 시점 `/vibe-review` 훅이 자동 findings 에 append.

## <cluster_id> — <cluster_label>

- original_section_title: "<heading>"
- original_lines_in_CLAUDE_md: 123-145
- tier: B | C | should_to_must_failed
- reason: "incident_count=0, no gap-* coverage" | "should → must 격상 실패: trigger 조건을 tight 하게 정의 불가"
- restoration_decision: pending
- original_text: |
    <verbatim CLAUDE.md 내용 — heading 포함, trailing newline 보존>

---
```

**생성 방식**: Generator 가 D1 의 JSON output 을 기반으로 **직접 편집** (Codex 가 MD 파일은 편집 가능). cluster 수가 많으면 chunk 단위로. 각 entry 는 **verbatim** 원본 복원 가능한 정확도여야 함 (복원 = copy-paste 로 CLAUDE.md 에 재삽입 가능).

### D4 — `CLAUDE.md` trim

**Pure content trim only** — **줄 순서 재구조화 / heading 추가 / Charter 마커 신설 금지** (N3 scope).

삭제 규칙:
1. **B/C tier cluster 전량 삭제**. cluster 경계 기준으로 heading + body + trailing blank line 까지 제거. `<!-- BEGIN:HARNESS:* -->` / `<!-- END:HARNESS:* -->` 마커는 해당 block 이 비게 되어도 **유지** (N3 재구조화 의존). block 자체가 통째로 삭제되어야 할 경우에만 마커도 함께 삭제.
2. **Should 격상**:
   - tier S/A cluster 에 Should 조건이 있으면 trigger 조건을 tight 하게 재정의 (예: "Should: Sprint 내 >5 파일 변경 예상" → "Must: Sprint scope > 5 files changed (grep evidence 기반)") 후 `Should|권장|가능하면` soft verb 를 해당 cluster 에서 **전량 제거**.
   - 격상 실패 (= tight 하게 재정의할 trigger 가 없음) → 해당 cluster 를 **삭제** + `rules-deleted.md` 에 `tier: should_to_must_failed` 로 기록.
   - **예외 (보존 필수)**: **핵심 가치 cluster** (위 "iter-3 핵심 가치" 목록) 에서 Should 가 감지되면 무조건 Must 로 격상 (삭제 금지). 삭제 필요 시 Sprint 를 BLOCKED 로 리포트하고 최종 결정을 Orchestrator 에 위임.
3. **Must Not trigger matrix 행 전량 삭제**:
   - trigger matrix section (`## Sub-agent 소환 트리거 매트릭스` cluster 내부) 에서 `Must Not` / `MUST NOT` 이 trigger 조건으로 쓰인 bullet 을 **삭제**.
   - rule-level prohibition (`...금지`, `... 하지 않는다`) 은 **유지** — 이 둘의 구분은 "trigger matrix section 안에 있는지" 로 결정적으로 판정.
4. **참조 cleanup (§14 W13 / D1 dead-ref 재발 방지)**:
   - 삭제 cluster 의 heading text 및 고유 명사 (예: `vibe-planner-skip-log`, `audit-skipped-mode` 등) 를 workspace 전역에서 grep → 발견된 참조를 각각 검토. 다른 script/test/skill 에서 살아있는 로직이 있으면 해당 로직은 **보존** (N1 에서 로직 삭제 금지, 오직 MD 만 정리). 하지만 참조된 대상이 완전히 사라진 dangling reference 만 정리.
   - Final report 의 `## Wiring Integration` 표 `D1 reference cleanup` 행에 grep 결과와 조치를 evidence 로 기록.
5. **Line count 목표**: CLAUDE.md 최종 line count = **baseline - 32 이하** (즉 `wc -l CLAUDE.md` 기준 실행 전 baseline 대비 최소 32 lines 감소). baseline 절대값 hardcode 하지 않음. 감소량 부족하면 Final report 에 추가 삭제 후보를 명시.

**보존 필수 cluster (삭제 절대 금지)**:
- `# Claude project memory` (core-framing block)
- `## 핵심 재프레임 — 왜 sub-agent인가`
- `## 역할 제약 (항상 적용 — 트리거 아님)`
- `## Sub-agent 소환 트리거 매트릭스` (Must Not trigger 행은 삭제하되 cluster 자체 보존)
- `## 역할 및 호출 메커니즘` 및 `### Planner 소환 — subagent_type 지정 필수`
- `## Sprint 흐름 — 2단 구조` (Phase 0 + 매 Sprint 반복)
- `## 훅 강제 메커니즘 — MD보다 스크립트` (table 내부 행 중 본 Sprint 에서 새로 wiring 되는 행은 유지)
- `# 에이전트 지시사항: 기계적 오버라이드` (Mechanical overrides — 사용자가 별도 제공하므로 보존)
- `<!-- BEGIN:PROJECT:custom-rules -->` 블록

### D5 — `docs/context/harness-gaps.md` 업데이트

**추가/수정 entries**:

1. 기존 `gap-rule-only-in-md` 행의 `covered_by` 문구를 보강:
   - 현재: `scripts/vibe-rule-audit.mjs` rule scanner (M-harness-gates)
   - 이후: `scripts/vibe-rule-audit.mjs` rule scanner (M-harness-gates) + **retrospective transcript scan via `--scan-transcripts` (iter-3 N1) → tier-based delete**
2. 새 entry 추가 (표 끝 append):

   | gap-harness-bloat-self-expansion | 하네스 rule 이 실제 incident signal 없이 preventive 목적만으로 누적되어 agent context 를 조용히 압박 | `scripts/vibe-rule-audit.mjs --scan-transcripts` + iter-3 rules-deleted ledger (iter-3 N1) | partial | partial | +3 sprints |

   **status=partial, script-gate=partial, migration-deadline="+3 sprints"** — N1 이 처음 diet 를 수행하지만 완전 covered 로 올리려면 dogfood8 post-acceptance 에서 복원 결정 사이클이 돌아야 함.

**삭제 금지**: 기존 gap 행 전량 유지 (`gap-rule-only-in-md` 포함).

### D6 — `test/rule-audit.test.ts` 확장 + checklist

**추가 테스트 (최소 3 개 신규 `it(...)` block)**:

1. `it('scans transcripts and aggregates failure/drift tag counts')`:
   - temp dir 안에 fake dogfood repo 2개 생성 (`<tmp>/dogfood-a/.vibe/agent/session-log.md` + `<tmp>/dogfood-b/.vibe/agent/session-log.md`).
   - 각 session-log 에 `- 2026-... [failure] X occurred`, `- 2026-... [drift-observed] Y`, `- 2026-... [decision] Z` 샘플 라인 작성.
   - `--scan-transcripts=<pathA>,<pathB> --format=json` 실행.
   - `summary.bySource[<pathA>].failure >= 1`, `summary.bySource[<pathA>].present === true`, `summary.tiered === true` assert.

2. `it('gracefully skips missing transcript sources')`:
   - 존재하지 않는 경로를 섞어 `--scan-transcripts=<real>,<nonexistent>`.
   - exit status 0, stderr 에 `warning: scan target missing` 포함, `summary.bySource[<nonexistent>].present === false` assert.

3. `it('classifies rule clusters into S/A/B/C tiers from evidence')`:
   - temp CLAUDE.md 에 3 cluster 구성 (high-incident keyword, low-incident keyword, no-incident keyword).
   - temp dogfood session-log 에 high-incident keyword 매칭 라인 3건.
   - `--scan-transcripts=...` 실행.
   - `summary.byTier.S >= 1`, `summary.byTier.C >= 1` assert.
   - 각 rule 의 `cluster.recommendedAction` 이 tier 와 정합하게 매핑되는지 (`S → keep-script`, `C → delete-md-and-script`) assert.

선택적 4번째 테스트 (권장, 필수 아님):

4. `it('writes report MD when --emit-report-md is provided')`:
   - `--emit-report-md=<tmp>/report.md` 전달 후 파일 존재 + `| tier |` 헤더 포함 확인.

**기존 2개 테스트는 변경하지 말 것** (backward compat 불변 유지).

---

## File-level spec

### `scripts/vibe-rule-audit.mjs` (확장)

**Entry point** = `parseArgs(process.argv)` → `buildAudit(...)` → (JSON or text emit) + (optional report MD emit).

**새 함수 (추가 허용, existing helper signature 변경 금지)**:

- `scanTranscripts(paths: string[]) → { bySource: Record<string, SourceResult>, incidents: Incident[] }`
  - `SourceResult = { present: boolean; failure: number; driftObserved: number; decision: number; auditClear: number }`
  - `Incident = { source: string; tag: 'failure' | 'drift-observed' | 'decision' | 'audit-clear'; line: number; text: string }`
  - 누락 경로는 stderr warning 후 `{ present: false, ...zeros }` 반환.

- `extractClusters(claudeContent: string) → Cluster[]`
  - Cluster = `{ id, label, startLine, endLine, body, hasRuleKeyword: boolean, softVerbDetected: boolean }`.
  - heading regex `^#{2,3}\s+(.+)$`. cluster_id = heading 텍스트를 kebab-case slug 로 (`/[^a-z0-9가-힣]+/g` → `-`, trim, lower).

- `extractKeywords(clusterBody: string) → string[]`
  - tokenize body → 길이 ≥ 3 token, 한국어 조사/영어 stopword 제거. 최대 12 keywords per cluster.

- `matchEvidence(clusters, incidents) → Map<clusterId, Evidence[]>`
  - `Evidence = { source, tag, snippet }`. snippet max 160 chars.

- `classifyTier(cluster, evidenceCount, hasGapCoverage) → Tier`
  - rule: S if ≥3, A if 1~2, B if 0 && (hasGapCoverage || hasScriptRef), C otherwise.
  - hasScriptRef = cluster body 에 `scripts/vibe-*.mjs` path 포함 여부.

- `recommendedAction(tier, softVerbDetected) → string`
  - S → 'keep-script'
  - A → 'keep-md-only'
  - B → 'delete-md'
  - C → 'delete-md-and-script'
  - softVerbDetected && tier ∈ {S,A} → append ' + should-to-must-tighten'

- `emitReportMd(auditResult, outputPath) → void`
  - 위 D2 포맷에 맞춰 markdown 생성. `writeFileSync(resolve(outputPath), ..., 'utf8')`.

**CLI 확장**:
- `--scan-transcripts=<csv>` / `--scan-transcripts <csv>` 둘 다 지원.
- `--emit-report-md=<path>` / `--emit-report-md <path>`.
- 기존 `--format`, `--claude-md`, `--gaps` 동작 불변.

**Helper 재사용**: 기존 `parseArgs`, `findKind`, `extractRules`, `splitMarkdownRow`, `extractCoveredGaps`, `buildAudit`, `readOptional`, `renderSection`, `renderText` **전부 보존**. 새 로직은 별도 함수로 추가. `buildAudit` 내부에서 `--scan-transcripts` 가 전달된 경우에만 `scanTranscripts` + `extractClusters` + `classifyTier` pipeline 을 호출.

### `.vibe/audit/iter-3/rule-audit-report.md`

- D2 스펙. Generator 가 script 를 1회 실행하여 생성.
- **Git 추적** — `.gitignore` 에 추가하지 않음 (interview round 7 constraint: public repo push 수용). 단 iter-3 종료 시점에 `git rm -r .vibe/audit/iter-3/` 로 정리 가능해야 함 → 파일은 모두 self-contained 로 작성 (외부 링크 의존 없이 내용 복원 가능).

### `.vibe/audit/iter-3/rules-deleted.md`

- D3 스펙. Generator 가 CLAUDE.md 삭제 cluster 를 추출하여 작성.
- verbatim 정확도 필수 — 복원 = copy-paste 로 CLAUDE.md 에 재삽입 가능.

### `CLAUDE.md`

- D4 스펙. pure content trim. 줄 순서 재배치 / heading 추가 / Charter 마커 신설 금지.
- 보존 cluster 목록 엄수.

### `docs/context/harness-gaps.md`

- D5 스펙. 기존 행 유지 + 1 row append + `gap-rule-only-in-md` covered_by 문구 보강.

### `test/rule-audit.test.ts`

- D6 스펙. 최소 3 신규 테스트 추가. 기존 2 테스트 불변.

### `docs/release/v1.4.0.md`

- 본 Sprint 에서 `## iter-3 N1 — rule audit diet` 소절 추가 (1~2 단락). v1.4.1 bump 는 N2 에서 수행되므로 본 Sprint 는 여전히 1.4.0 range 에 기록. 기존 내용 유지.

### 수정 금지 파일 (Do NOT modify)

- `scripts/vibe-interview.mjs`
- `scripts/vibe-sprint-complete.mjs`, `scripts/vibe-sprint-commit.mjs`, `scripts/vibe-preflight.mjs`
- `scripts/run-codex.sh`, `scripts/run-codex.cmd`
- `.claude/skills/vibe-init/SKILL.md`, `.claude/skills/vibe-interview/SKILL.md`, `.claude/skills/vibe-iterate/SKILL.md`
- `.claude/agents/sprint-planner.md`
- `.vibe/config.json`, `.vibe/sync-manifest.json`, `package.json` (본 Sprint 는 `vibe:rule-audit` alias 추가 선택 — 아래 Wiring 표 W9 참조)
- `C:\Users\Tony\Workspace\dogfood6\**` **전체 read-only**
- `C:\Users\Tony\Workspace\dogfood7\**` **전체 read-only**

---

## Acceptance criteria (testable)

**모두 기계 검증 가능**. 각 줄은 exit code 또는 grep 기준.

| # | Check | Command / expectation |
|---|---|---|
| AC1 | TypeScript 타입 체크 0 errors | `npx tsc --noEmit` exit 0 |
| AC2 | 전체 테스트 0 fail | `npm test` exit 0, 기존 196 → **≥ 199 passing** (신규 3+ 테스트) |
| AC3 | 신규 rule-audit 테스트 개수 | `grep -c "^  it(" test/rule-audit.test.ts` ≥ 5 (기존 2 + 신규 ≥3) |
| AC4 | scan-transcripts JSON 출력 | `node scripts/vibe-rule-audit.mjs --scan-transcripts C:\Users\Tony\Workspace\dogfood6,C:\Users\Tony\Workspace\dogfood7 --format=json` → stdout JSON parse 가능 + `summary.total >= 20` + `summary.tiered === true` |
| AC5 | Tier 분류 결과 | 위 JSON 에서 `summary.byTier.S + summary.byTier.A + summary.byTier.B + summary.byTier.C + summary.byTier.unclassified === summary.total` |
| AC6 | rule-audit-report.md 생성 | `test -f .vibe/audit/iter-3/rule-audit-report.md` |
| AC7 | rule-audit-report.md row count | `grep -c '^|' .vibe/audit/iter-3/rule-audit-report.md` > 20 |
| AC8 | rules-deleted.md 존재 | `test -f .vibe/audit/iter-3/rules-deleted.md` (내용은 trim 결과에 따라 0 cluster 이어도 OK — 그 경우 `# iter-3 rules-deleted ledger\n\n(no deletions in this iteration)\n` 로 작성) |
| AC9 | CLAUDE.md 라인 수 | `wc -l CLAUDE.md` 의 라인 수 ≤ **260** |
| AC10 | Should 제거 (trigger matrix 범위) | `awk '/## Sub-agent 소환 트리거 매트릭스/,/## 추론 강도 정책/' CLAUDE.md \| grep -iE '(should|권장)' \| wc -l` == 0 (trigger matrix cluster 내부에 Should 0 hit — 격상 완료 또는 삭제) |
| AC11 | Must Not trigger 제거 | 위와 동일 awk 범위에서 `grep -iE 'must not\|must-not'` == 0 |
| AC12 | harness-gaps.md 새 행 | `grep -c '^\| gap-harness-bloat-self-expansion \|' docs/context/harness-gaps.md` == 1 |
| AC13 | gap-rule-only-in-md 유지 | `grep -c '^\| gap-rule-only-in-md \|' docs/context/harness-gaps.md` == 1 |
| AC14 | Core value cluster 보존 | `grep -c 'run-codex.sh' CLAUDE.md` ≥ 3 / `grep -c 'vibe-interview' CLAUDE.md` ≥ 2 / `grep -c 'sub-agent' CLAUDE.md` (case-insensitive) ≥ 3 |
| AC15 | Net LOC budget | `git diff --shortstat HEAD` 의 insertion ≤ **+150** (add 범위 한정). delete 무제한. |
| AC16 | 0 new scripts | `git diff --name-only --diff-filter=A HEAD -- 'scripts/*.mjs' 'scripts/*.sh' 'scripts/*.cmd'` 출력 empty |
| AC17 | Backward compat 기존 2 테스트 | `npm test -- --test-name-pattern="emits JSON with covered and uncovered"` exit 0 + `--test-name-pattern="renders both text sections"` exit 0 |
| AC18 | dogfood6/7 read-only | `git -C C:\Users\Tony\Workspace\dogfood6 status --porcelain` + `git -C C:\Users\Tony\Workspace\dogfood7 status --porcelain` 결과 empty (dogfood 프로젝트 git tree 건드리지 않음) |
| AC19 | Wiring report 포함 | Final report 에 `## Wiring Integration` 섹션 + 아래 W1~W13 + `D1 reference cleanup` + `Diet delta` 행 존재 |

**범위 가드** (Sprint incomplete 로 간주되는 조건):
- CLAUDE.md 에서 `scripts/vibe-interview.mjs` 언급이 사라짐.
- `## Sprint 흐름` section cluster 가 통째 삭제됨.
- `.claude/agents/sprint-planner.md` 언급이 사라짐.
- Generator 가 새 `.mjs` 파일을 생성함.
- `C:\Users\Tony\Workspace\dogfood{6,7}` 내부 파일 수정이 발생함.

위 중 하나라도 위반 시 Sprint BLOCKED → Final report 의 Deviations 에 명시하고 Orchestrator 재검토.

---

## Wiring Integration Checklist

Final report 에 **반드시** 아래 표 포함 (`.vibe/agent/_common-rules.md §14.4`). 상태는 `touched` / `n/a` / `skipped+reason` 중 하나.

| Checkpoint | Expected Status | Evidence 힌트 |
|---|---|---|
| W1 CLAUDE.md §훅 강제 메커니즘 테이블 | `touched` (가능) | `vibe-rule-audit` 행의 설명이 retrospective scan 포함으로 업데이트되었는지. 신규 행 추가는 없음 (0 new scripts). |
| W2 CLAUDE.md §관련 스킬 list | `n/a` | 신규 슬래시 커맨드 없음 |
| W3 CLAUDE.md §Sprint flow 번호 | `n/a` | Sprint 사이클 절차 변경 없음 |
| W4 .claude/settings.json hook 등록 | `n/a` | 이벤트 훅 신규 추가 없음 |
| W5 .claude/settings.json statusLine | `n/a` | statusline 변경 없음 |
| W6 sync-manifest.json harness[] | `n/a` | 신규 파일 없음 (rule-audit 확장만) |
| W7 sync-manifest.json hybrid harnessKeys | `n/a` | top-level key 추가 없음 |
| W8 README.md 사용자 가시 섹션 | `n/a` | 사용자 대면 변경 없음 (또는 optional: `vibe:rule-audit:scan` alias 추가 시 touched) |
| W9 package.json scripts.vibe:* | **optional `touched`** | `"vibe:rule-audit:scan": "node scripts/vibe-rule-audit.mjs --scan-transcripts ..."` alias 추가 여부 — 기본 skip 추천 (iter-3 0 new script 원칙 및 경로 하드코딩 회피). skip 선택 시 reason = "경로 하드코딩 회피, 수동 호출 허용". |
| W10 docs/release/v1.4.0.md | **`touched`** | iter-3 N1 entry 단락 추가 |
| W11 migrations/X.Y.Z.mjs | `n/a` | state schema 변경 없음 |
| W12 test/*.test.ts 회귀 방지 | **`touched`** | `test/rule-audit.test.ts` 최소 3 신규 it() |
| W13 harness-gaps.md 관련 gap 갱신 | **`touched`** | `gap-rule-only-in-md` covered_by 문구 보강 + `gap-harness-bloat-self-expansion` 1 행 추가 |
| W14 .gitignore runtime artifact | `n/a` | iter artifact 는 git-tracked 로 push 수용 (interview round 7 결정) |
| D1 reference cleanup | **`critical / touched`** | 삭제 cluster 의 heading/고유명사 grep 결과와 조치 — 0 dangling ref 기대. Evidence 에 grep 명령 + 결과 요약. |
| **Diet delta (iter-3 N1 only)** | **`touched`** | before/after CLAUDE.md line count + rules-deleted cluster count + should-to-must 격상 count + delete-md-only count + delete-md-and-script count. |

---

## Non-goals (N1 scope 밖 — 절대 손대지 않음)

1. **Charter/Extensions 재구조화** — `<!-- BEGIN:CHARTER -->` 마커 신설, `§0 Charter` 섹션 생성, Extensions pointer 체계화 등은 전부 **N3 scope**. N1 에서는 줄 순서 / heading 구조를 변경하지 않는다.
2. **Critical bug fixes** — `collectArchivedPromptFiles` suffix 버그, `run-codex.sh` auto status-tick hook, `vibe-preflight` planner.presence 보정, artificial `v1.4.1` bump 등은 **N2 scope**.
3. **mode flag 정의** — `.vibe/config.json.mode = "human" | "agent"` 및 calling convention 문서화는 **N3 scope**.
4. **외부 provider 정책 대응** — Anthropic/OpenAI/GitHub 정책 변동은 iter-3 out of scope (interview round 7 결정). harness-gaps 에 entry 추가 금지.
5. **dogfood 프로젝트 수정** — `C:\Users\Tony\Workspace\dogfood6` / `dogfood7` 는 read-only transcript 소스. git tree 건드리지 않음.
6. **`/vibe-review` rules-deleted hook** — `.claude/skills/vibe-review/SKILL.md` 에 복원 리마인드 hook 추가는 **N3 scope**.
7. **본인 workflow 개선** — harness 는 downstream user 의 산출물 창출 수단 (interview round 4). 유지보수자 본인 편의를 위한 개선은 target 아님.

---

## Estimated LOC

| 영역 | 추가 | 삭제 |
|---|---|---|
| `scripts/vibe-rule-audit.mjs` 확장 (scanTranscripts + extractClusters + classifyTier + emitReportMd + CLI 옵션) | +100~130 | 0 |
| `test/rule-audit.test.ts` 신규 테스트 3~4개 | +40~70 | 0 |
| `.vibe/audit/iter-3/rule-audit-report.md` | +30~80 (auto-generated) | 0 |
| `.vibe/audit/iter-3/rules-deleted.md` | +50~300 (삭제 cluster 수 의존) | 0 |
| `docs/context/harness-gaps.md` | +3 | 0 |
| `docs/release/v1.4.0.md` iter-3 N1 entry | +5~10 | 0 |
| `CLAUDE.md` trim | 0 | -32~80 (≥32 lines 필요, AC9) |
| **Net (add - delete, code/test/doc 범위, audit artifact 제외)** | +150 이내 | |

**Growth budget 주의**: AC15 는 `git diff --shortstat HEAD` 기준 insertion ≤ +150. `.vibe/audit/iter-3/*` artifacts 는 iteration-scoped 이고 iter 종료 시 제거 대상이나, 커밋 시점 insertion 에는 포함된다. Generator 는 두 ledger (`rule-audit-report.md`, `rules-deleted.md`) 를 **컴팩트** 하게 작성 (cluster 당 5~10 줄 이내, boilerplate 최소화) 하여 budget 을 지킨다. 불가피한 경우 Final report Deviations 에 `budget pressure: artifacts too large` 로 기록 후 Orchestrator 협상.

---

## Final report contract

Generator Final report 형식 — `.vibe/agent/_common-rules.md §9` 확장:

```markdown
## Files added
- .vibe/audit/iter-3/rule-audit-report.md — iter-3 rule tier report (auto-generated)
- .vibe/audit/iter-3/rules-deleted.md — verbatim backup of deleted clusters

## Files modified
- scripts/vibe-rule-audit.mjs — +N lines (scanTranscripts / extractClusters / classifyTier / emitReportMd + CLI)
- test/rule-audit.test.ts — +M lines (3~4 신규 it())
- CLAUDE.md — -D lines (B/C tier + should-failed cluster 삭제, Should 격상)
- docs/context/harness-gaps.md — +3 lines (1 new row + coverage 문구 보강)
- docs/release/v1.4.0.md — +K lines (iter-3 N1 단락)

## Verification
| command | exit |
|---|---|
| npx tsc --noEmit | 0 |
| npm test | 0 |
| node scripts/vibe-rule-audit.mjs --scan-transcripts C:\Users\Tony\Workspace\dogfood6,C:\Users\Tony\Workspace\dogfood7 --format=json --emit-report-md .vibe/audit/iter-3/rule-audit-report.md | 0 |
| wc -l CLAUDE.md | ≤ 260 |
| grep -c '^\| gap-harness-bloat-self-expansion \|' docs/context/harness-gaps.md | 1 |

## Sandbox-only failures
- (sandbox 제약으로 실행 못 한 검증만 여기 — `npm test` 가 sandbox 에서 spawn EPERM 시 그대로 기록하고 Orchestrator 가 밖에서 재검증)

## Wiring Integration
(위 §Wiring Integration Checklist 표 그대로 채워 제출)

## Diet delta
- CLAUDE.md before: <baseline_wc_l> lines (실행 전 `wc -l CLAUDE.md`)
- CLAUDE.md after: <N> lines (Δ = -<D>, 최소 32 감소)
- rules-deleted cluster count: <X>
  - tier B: <x1>
  - tier C: <x2>
  - should-to-must-failed: <x3>
- should-to-must 격상 성공 count: <Y>
- Must Not trigger 행 삭제 count: <Z>
- scan-transcripts incident totals: failure=<a>, drift-observed=<b>, decision=<c>, audit-clear=<d>
- sources scanned / missing: vibe-doctor / dogfood6 / dogfood7 (present=true/false 각각)

## Deviations
- (없으면 "none"; 있으면 이유와 함께 나열. 특히 "핵심 가치 cluster 에 Should 가 있어 Must 격상 실패 + 삭제 금지 → Orchestrator 협상 대기" 같은 항목)

verified-callers:
- scripts/vibe-rule-audit.mjs → CLAUDE.md:<hook table row> / package.json:scripts.<name> (optional) / test/rule-audit.test.ts
- .vibe/audit/iter-3/rule-audit-report.md → `--emit-report-md` CLI output (no other caller, iteration-scoped artifact)
- .vibe/audit/iter-3/rules-deleted.md → dogfood8 post-acceptance 복원 프로토콜 (`## Restoration protocol` in report)
```

---

## Style & safety rules (한 번 더 요약 — iter-3 특화)

1. **Intent-first**. 본 프롬프트의 CLI signature / JSON schema / 파일 경로는 **contract 수준**. Generator 는 구현 pseudocode 가 아닌 의도를 구현. 내부 변수명 / 정확한 regex / tokenizer 구현은 Generator fresh context.
2. **Every AC machine-checkable**. "잘 동작해야 함" 금지. exit code / grep count / JSON schema / wc -l 로만 판정.
3. **Absolute-in-repo paths**. `C:\Users\Tony\Workspace\vibe-doctor\...` 형태 또는 repo root 기준 relative. dogfood 경로는 **절대경로** (`C:\Users\Tony\Workspace\dogfood6`, `C:\Users\Tony\Workspace\dogfood7`).
4. **iter-3 핵심 가치 절대 보존**: `vibe-interview.mjs`, `vibe-init`/`vibe-interview` skill, sprint-planner agent, `vibe-sprint-complete`/`vibe-sprint-commit`, `run-codex.{sh,cmd}`, Generator 위임 원칙, Sub-agent context isolation — 이 7 항목 관련 cluster/line 을 건드리면 Sprint incomplete.
5. **dogfood6/7 read-only**. transcript 만 읽고 수정 금지. git status 가 dirty 로 뜨면 즉시 revert + Deviations 기록.
6. **Charter/Extensions 재구조화는 N3** — 줄 순서 재배치 / heading 신설 / `<!-- BEGIN:CHARTER -->` 마커 도입 전부 N1 에서 금지.
7. **삭제 cluster 의 참조 cleanup 이 핵심** (§14 W13 + D1 재발 방지). `rg <heading-or-unique-name>` 후 발견된 모든 참조를 명시적 조치 (update / remove / keep-as-living-code) — Final report 에 증거 첨부.
8. **0 new scripts**. 새 `.mjs` / `.sh` / `.cmd` 생성 금지. 기존 `vibe-rule-audit.mjs` 확장만.
9. **Net LOC ≤ +150**. artifact MD 는 컴팩트하게. 한 cluster entry 당 5~10 줄 가이드라인.
10. **Fail-fast on ambiguity**: Generator 가 "이 cluster 가 핵심 가치인지 불명확" 으로 판단되면 **삭제하지 않고** Final report Deviations 에 기록 후 Orchestrator 에 escalate.

---

## Execution preflight (Generator 시작 전 참고만 — sandbox 제약 수용)

1. `node scripts/vibe-rule-audit.mjs --format=json` 출력 기록 (현재 rules baseline, tier 분류 전).
2. `wc -l CLAUDE.md` 로 baseline line count 기록 (Windows CRLF + Git Bash `wc` 기준. PowerShell `Measure-Object` 와 결과가 다를 수 있으니 **`wc -l` 만 사용**). 이 baseline 을 "before" 로 Diet delta 섹션에 기록.
3. 이하 검증은 **Codex sandbox 제약으로 실패해도 무시**: `node scripts/vibe-preflight.mjs` (state.schema / provider.* / git.worktree / git.clean 등), `npx tsc --noEmit`, `npm test`. Orchestrator 가 sandbox 밖에서 이미 검증하므로 Codex 는 이 실패를 BLOCK 근거로 삼지 않음.
4. **baseline line count 가 특정 예상값 (예: 292) 과 일치하지 않아도 진행**. 실제 `wc -l CLAUDE.md` 결과가 곧 baseline — encoding / newline 차이로 숫자가 달라질 수 있음.

**작업을 중단하는 경우**: 프롬프트 자체 실행 오류 (파일 없음, 경로 오류 등) + 핵심 가치 cluster (섹션 §6 의 [preserve] 목록) 가 의심스럽게 제거될 위험 — 후자는 Deviations 에 기록 후 Orchestrator escalate (AC11 fail-fast on ambiguity).

---

끝.
