# dogfood6 개선 검토 — dogfood5 회고 기반

**작성**: 2026-04-14 (dogfood5 완료 직후)
**목적**: dogfood5에서 발생한 하네싱 위반 두 건을 근본 수정하여 dogfood6를 올바른 vibe-doctor 프로토콜로 진행하기 위한 검토
**승인 전제**: 사용자 확정 후 vibe-doctor 템플릿 파일 수정 + 새 minor 버전(v1.1.0) 태깅 후 dogfood6 시작

---

## 1. 근본 오류 분석

### 1.1 Ouroboros 인터뷰를 스킵한 판단

**내가 한 것**
- Phase 3 (Ouroboros `ouroboros_interview` MCP 호출)을 건너뛰고 Orchestrator가 직접 product.md / architecture.md / conventions.md 를 작성
- 근거: "사용자가 모든 결정 위임했으니 답변자가 없어 인터뷰가 의미 없음"

**왜 잘못인가**
1. Ouroboros는 단순 Q&A가 아니라 **숨겨진 가정을 드러내는 구조적 탐색**이다. Orchestrator가 product 문서를 한 번에 쓰면 "내가 이미 아는 답" 만 쓴다 — 인터뷰 flow는 **모르는 질문이 반드시 제기되도록 강제**한다.
2. 답변자가 Orchestrator 자신이더라도 "질문 받음 → 판단 → 답변 → 다음 질문" 루프와 모호성 점수 ≤ 0.2 수렴 메트릭이 **외부 검증 장치**로 작동한다. 이 장치가 빠지면 단일 context 안에서 모든 게 섞이고 재현성 사라진다.
3. 하네싱 존재 이유 = **단계별 follow-up 용이성 + context isolation**. 인터뷰 스킵은 두 가지 모두 훼손.

**왜 내가 그렇게 판단했나 (변명 아닌 원인 분석)**
- 사용자 "자율 진행" 지시를 "인터뷰 flow 자체도 생략 가능" 으로 확장 해석
- SKILL.md가 "설치 실패 시 수동 Q&A fallback"을 허용하는 구절을 "skip 옵션"으로 오독
- **템플릿 자체가 "자율 진행 모드에서 Ouroboros를 어떻게 다루는가"를 명시 안 함** → 내가 추정으로 메움

**올바른 해석**
- 사용자 "자율 진행" = 사용자가 **일일이 답하지 않아도 진행되게 하라** 는 뜻
- 인터뷰 스킵이 아니라 **Orchestrator가 PO 대행으로 답변하며 완주**
- 각 답변의 rationale을 session-log에 남겨서 판단 근거 추적 가능

### 1.2 Planner 소환 단위의 오독

**내가 한 것**
- Planner 1회 소환 (Must 트리거 "새 프로젝트 첫 Sprint 분할")
- Planner가 5개 Sprint 로드맵 + Sprint 1 프롬프트를 모두 출력
- Sprint 2~5 프롬프트는 Orchestrator가 직접 작성 (Planner 재소환 없음)

**왜 잘못인가**
1. **전체 Sprint 로드맵은 Orchestrator가 가장 잘 쓴다**. 왜? 방금 Ouroboros 인터뷰를 마친 Orchestrator는 product 맥락을 가장 풍부하게 보유. 이 맥락을 Planner에 이양하면 정보 손실.
2. **Planner의 진짜 가치는 Sprint 내부 fresh context 공급**. Sprint가 진행될수록 Orchestrator context는 누적·오염된다. 매 Sprint 앞에 Planner를 소환해야 **해당 Sprint의 타입·시그니처·구조만** fresh하게 설계되어 이전 Sprint의 구현 세부가 무의식적으로 침투하지 않는다.
3. 내가 한 방식의 역설: **최악의 조합**
   - 전체 로드맵 = Planner (context 부족) → 로드맵 품질 ↓
   - Sprint 2~5 프롬프트 = Orchestrator (context 누적/오염) → Sprint간 일관성 ↓
   - 두 단계 모두 **올바른 context 소유자가 작업하지 않음**

**왜 내가 그렇게 판단했나**
- CLAUDE.md 트리거 매트릭스 `🟥 Must: 전체 로드맵 분할 / ... / 새 프로젝트 첫 Sprint 분할` 구절이 "Planner가 로드맵 전체 담당" 으로 읽힘
- "매 Sprint Planner 소환" 이라는 규칙이 트리거 매트릭스 어디에도 명시되지 않음 → 프로토콜의 공백을 내가 임의 해석으로 메움
- 한 번 Planner 호출로 로드맵 + Sprint 1 받은 후, 그 산출의 "기술 사양" 섹션을 Sprint 2~5에도 활용하면 충분하다고 착각

**올바른 분업**
| 산출물 | 담당 | 이유 |
|---|---|---|
| Ouroboros 인터뷰 (PO 역할) | Orchestrator | 상주 + 사용자 맥락 보유 |
| product / architecture / conventions .md | Orchestrator (인터뷰 seed 자동 변환) | 인터뷰 직후 가장 풍부한 맥락 |
| Sprint 로드맵 (N개 Sprint, 각 한 줄 목표) | **Orchestrator** | 인터뷰 맥락 + 프로젝트 전체 시야 |
| 각 Sprint 기술 사양 (타입, 시그니처, 파일) | **Planner (매 Sprint 소환)** | fresh context, 이전 Sprint 오염 차단 |
| Sprint 프롬프트 초안 | Planner | Generator 바로 받을 수 있는 자기 완결성 |
| 코드 (.ts/.tsx/.mjs/.css/.py 등) | Generator (Codex) | 역할 제약 |
| 완료 체크리스트 합격 판정 | Orchestrator self-QA → (트리거 시) Evaluator | 기존 규칙 유지 |

---

## 2. vibe-doctor 템플릿 수정 제안

### 2.1 `CLAUDE.md` — 트리거 매트릭스 재작성 (🔴 높은 우선)

**현재 (모호)**:
```markdown
### Planner 소환
- 🟥 **Must**: 전체 로드맵 분할 / Orchestrator에 이미 context 압축 발생 이력 / 독립 병렬 Sprint 필요 / **새 프로젝트 첫 Sprint 분할**
- 🟨 **Should**: 분할 방식의 트레이드오프가 중요 / 아키텍처 선택이 비자명 / 사용자 목표가 3문장 이하(모호성 높음)
```

**제안**:
```markdown
### Planner 소환 — **Sprint 단위** fresh context 공급

**원칙**: Planner는 **매 Sprint 시작 전 소환**한다. 이유는 Sprint가 진행될수록 Orchestrator context가 누적·오염되어 Sprint 내부 사양 재현성이 떨어지기 때문. Planner의 fresh context가 **해당 Sprint의 타입·시그니처·파일 구조·프롬프트 초안**을 독립적으로 도출한다.

- 🟥 **Must**: 매 Sprint 시작 전 (프로토타입 예외 아래 참조)
- 🟨 **Should**: 아키텍처 선택이 비자명 / 작성자=평가자 역할 충돌 우려 / Sprint 내 >5 파일 변경 예상
- 🟢 **예외 (프로토타입)**: 사용자가 "자율 진행 + 간소화" 명시 + Sprint가 trivial(<100 LOC, 단일 파일)일 때만 Planner 생략 가능. 생략 시 session-log에 근거 기록.

### Sprint 로드맵 분할은 **Orchestrator 책임**

Orchestrator가 Ouroboros 인터뷰로 product 맥락을 가장 풍부하게 보유한 상태에서 Sprint를 몇 개로 나눌지, 각 Sprint 한 줄 목표가 무엇인지 결정한다. 이 로드맵을 `docs/plans/sprint-roadmap.md`에 저장하고, 이후 각 Sprint 시작 시점에 해당 slot을 Planner에 전달한다.
```

### 2.2 `.claude/skills/vibe-init/SKILL.md` — Phase 3 명확화 (🔴 높은 우선)

**수정 골자**:

Phase 3 Ouroboros 인터뷰는 **스킵 가능한 단계가 아님**을 명시. 사용자가 "자율 진행" 지시한 경우에도 Orchestrator가 PO 대행으로 **인터뷰 flow 자체는 완주**하도록.

추가할 섹션:

```markdown
### Phase 3-0. "자율 진행" 지시 시의 PO 대행 모드

사용자가 "모두 위임", "자율 진행", "알아서 해" 등의 지시를 내렸을 때:
1. Ouroboros 인터뷰를 **스킵하지 않는다**.
2. Orchestrator가 ouroboros_interview 도구를 정상 호출.
3. 질문이 반환될 때마다 Orchestrator가 PO 관점에서 답변 결정.
4. **각 답변에 rationale 첨부** — 왜 이 방향을 택했는가 1-2문장.
5. rationale을 session-log에 `[decision]` 태그로 append.
6. 모호성 점수 0.2 이하 될 때까지 반복.
7. 인터뷰 종료 후 product.md의 맨 아래 `## Phase 3 답변 기록 (PO 대행)` 섹션에 Q/A/rationale 덤프.

**왜 스킵하면 안 되는가**: 인터뷰 flow 자체가 숨겨진 가정을 드러내는 강제 장치. PO 대행이어도 "질문에 답해야 한다"는 프로토콜이 Orchestrator의 임의 판단을 걸러냄.
```

현재 "설치 실패 3회 → 수동 Q&A" fallback 문구는 유지하되, "자율 진행" 과는 별도 경로임을 명확화.

### 2.3 `CLAUDE.md` — Sprint 흐름 섹션 재작성 (🔴 높은 우선)

**제안 흐름**:

```markdown
## Sprint 흐름

### 프로젝트 최초 1회 (Phase 0)

1. Ouroboros 인터뷰 (자율 시 PO 대행) → seed
2. seed → product.md / architecture.md / conventions.md
3. **Orchestrator가 Sprint 로드맵 작성** → `docs/plans/sprint-roadmap.md`
   - 각 Sprint: id, name, 한 줄 목표, 의존, 예상 LOC, 트리거 매트릭스 예상값
4. `vibe-preflight --bootstrap` → 0 exit

### 매 Sprint 반복

1. `vibe-preflight` → 0 exit
2. **Planner 소환** (fresh Claude subagent, model: opus)
   - 입력: product.md + architecture.md + sprint-roadmap.md (해당 slot) + 직전 Sprint 결과 2-3줄 요약
   - 출력: 해당 Sprint 기술 사양 + 프롬프트 초안 → `docs/prompts/sprint-NN-*.md`
3. Generator 위임: `cat docs/prompts/sprint-NN-*.md | ./scripts/run-codex.sh -`
4. Orchestrator 샌드박스 밖 재검증 (tsc/test/build)
5. Orchestrator self-QA (체크리스트 대조)
6. 필요 시 Evaluator 소환 (트리거 매트릭스)
7. `vibe-sprint-complete <id> passed` → sprint-status.json + handoff.md + session-log.md 자동 갱신
```

### 2.4 신규 shard: `docs/context/orchestration.md` (🟡 중간 우선)

역할 분리 매트릭스를 한 곳에 모아 중복 방지:

```markdown
# Orchestration — 역할 × Phase 매트릭스

| Phase | Orchestrator | Planner | Generator | Evaluator |
|---|---|---|---|---|
| Phase 1 환경 점검 | ○ 실행 | — | — | — |
| Phase 2 provider 선택 | ○ 실행 | — | — | — |
| Phase 3 Ouroboros 인터뷰 | ○ 진행 (PO 대행 포함) | — | — | — |
| Phase 3' context .md 생성 | ○ (seed 자동 변환) | — | — | — |
| Phase 4 Sprint 로드맵 | ○ 작성 | — | — | — |
| Sprint N 기술 사양 | 위임 | ○ 소환 (매 Sprint) | — | — |
| Sprint N 구현 | 위임 | — | ○ | — |
| Sprint N 검증 | ○ self-QA | — | — | 트리거 시 ○ |
| Sprint N 마무리 | ○ (vibe-sprint-complete) | — | — | — |
```

### 2.5 `.vibe/agent/_common-rules.md` — 추가 규칙 (🟡 중간 우선)

```markdown
## N. Sprint 프롬프트 작성자

Sprint 프롬프트는 **Planner가 작성**한다. Orchestrator는 Planner 산출물에 메타데이터·포맷 수정만 허용(scope expansion 헤더, 의존성 이미 설치됨 안내 등). Sprint 사양 본문을 Orchestrator가 직접 쓴 경우, session-log에 이유를 명시하고 Evaluator 트리거로 자동 간주.
```

---

## 3. dogfood6 실행 절차 (올바른 하네싱)

### 스케치

```text
[Orchestrator 상주, Claude Code Opus]

Phase 0 ─ 환경 점검 (vibe-init Phase 1-2)
         │
Phase 1 ─ Ouroboros 인터뷰 (PO 대행 모드)
         │   ouroboros_interview MCP 루프
         │   각 답변 rationale → session-log
         │   모호성 0.2 이하 수렴
         │
Phase 2 ─ product.md / architecture.md / conventions.md 자동 생성
         │
Phase 3 ─ Orchestrator가 Sprint 로드맵 작성
         │   docs/plans/sprint-roadmap.md
         │   N개 Sprint × 한 줄 목표
         │
Phase 4 ─ vibe-preflight --bootstrap

─── Sprint 1 ──────────────────────────────
   ┌─ Planner 소환 (fresh opus subagent)
   │     입력: context .md 3종 + 로드맵 slot
   │     출력: docs/prompts/sprint-01-*.md
   │
   ├─ Generator 위임 (run-codex.sh)
   │
   ├─ Orchestrator self-QA
   │
   └─ vibe-sprint-complete

─── Sprint 2 ──────────────────────────────
   ┌─ Planner 재소환 (또다른 fresh opus subagent)
   │     입력: context .md + 로드맵 slot + Sprint 1 결과 2-3줄 요약
   │     출력: docs/prompts/sprint-02-*.md
   │
   ├─ Generator 위임
   ├─ Orchestrator self-QA
   └─ vibe-sprint-complete

─── Sprint 3, 4, 5 ... 동일 반복 ──────────

최종: Orchestrator 보고서 + git commit + (선택) Vercel 배포
```

**Planner 소환 횟수** = Sprint 수 (dogfood5는 5개였으므로 5회. dogfood6는 인터뷰 결과에 따라 달라짐).

### Orchestrator가 PO 대행으로 Ouroboros 답변 시 규율

- 답변 전 **3초 extended thinking** 강제 (내부 reasoning)
- 각 답변에 `**Why**:` 한 줄
- 답변의 반대 가능성을 1회는 고려했는가 self-check
- rationale이 session-log에 `[decision] 2026-XX-XX [phase3-ouroboros] Q: ... A: ... Why: ...` 형식으로 append

---

## 4. 부수 개선 (dogfood5 기타 발견)

| # | 이슈 | 제안 | 우선순위 |
|---|---|---|---|
| A | Windows에서 `.vibe/config.local.json` 수동 작성 필요 (codex.cmd native 경로) | vibe-init Phase 2가 OS 감지 후 자동 기입 | 🟡 중간 |
| B | Codex BLOCKED 케이스 (deps 미설치, scope 경계) 사전 예방 미흡 | Planner가 Sprint 프롬프트 작성 시 "이미 설치된 deps" / "허용 수정 파일 범위"를 체크리스트 형태로 계산 | 🟡 중간 |
| C | Vite 5 + TS strict exactOptionalPropertyTypes 호환 이슈 → skipLibCheck 필요 | Vite 6 업그레이드 또는 tsconfig 분리 전략 조사 | 🟢 낮음 |
| D | Codex sandbox 전용 실패(spawn EPERM) 잡음 | `run-codex.sh` 가 Codex 리포트의 "Sandbox-only failures" 섹션을 자동 필터/요약 | 🟢 낮음 |
| E | sprint-roadmap.md 실측 LOC 자동 기록 없음 | `vibe-sprint-complete` 가 git diff로 실측 LOC을 로드맵에 append | 🟢 낮음 |
| F | Sprint 5 aria-label scope 경계 문제 | Planner가 체크리스트 항목 분석 → 필연적 수정 파일을 허용 목록에 자동 포함 | 🟢 낮음 |

---

## 5. 우선순위 및 실행 순서

### 🔴 1단계 — 하네싱 보정 (dogfood6 실행 전 필수)

1. **`CLAUDE.md` 트리거 매트릭스 재작성** (§2.1)
2. **`SKILL.md` Phase 3 PO 대행 모드 명시** (§2.2)
3. **`CLAUDE.md` Sprint 흐름 재작성** (§2.3)
4. (Orchestrator가 .md 직접 편집 가능 → Codex 위임 불필요)

### 🟡 2단계 — 프로세스 강화 (dogfood6 실행 전 권장)

5. `docs/context/orchestration.md` 신규 생성 (§2.4)
6. `_common-rules.md` Sprint 프롬프트 작성자 규칙 추가 (§2.5)
7. Windows config.local.json 자동화 (부수 A — Codex 위임 필요 — vibe-init 로직 수정)

### 🟢 3단계 — 편의/품질 개선 (dogfood6 진행 중 또는 이후)

8. Planner 프롬프트 템플릿에 "deps 예상 목록", "수정 허용 범위 자동 산출" 추가 (부수 B)
9. Vite tsconfig 호환 조사 (부수 C)
10. run-codex.sh sandbox-only 필터 (부수 D)
11. sprint-complete LOC 기록 (부수 E)

### 릴리스 전략

- 1단계 완료 → **v1.1.0 minor 태깅** (프로세스 변경 = minor bump)
- 2단계 일부 완료 → v1.1.1 또는 v1.2.0
- 3단계 항목 개별 PR

---

## 6. dogfood6 시작 직전 체크리스트

- [ ] vibe-doctor v1.1.0 태그됨
- [ ] `CLAUDE.md` 트리거/Sprint 흐름 업데이트 확인
- [ ] `SKILL.md` Phase 3 PO 대행 모드 확인
- [ ] 새 프로젝트 폴더(`dogfood6/`) clone
- [ ] `.vibe/config.local.json` 자동 또는 수동 기입
- [ ] `vibe-preflight --bootstrap` green
- [ ] Orchestrator는 본 문서 §3 스케치대로 진행 준비

## 7. 열린 질문 (사용자 확인 요청)

1. §2.1 트리거 매트릭스에서 Planner "예외(프로토타입)" 조건을 얼마나 엄격히? 지금 제안은 "trivial Sprint(<100 LOC, 단일 파일)" — 너무 좁거나 너무 넓나?
2. §2.2 PO 대행 시 rationale session-log 기록은 **매 답변마다** vs **매 phase 종료 시 요약 1회**? 전자가 더 안전하지만 로그 폭발.
3. §2.4 `orchestration.md` 새 파일 vs `CLAUDE.md`에 섹션 추가? 새 파일이 깔끔하지만 startup footprint 증가.
4. dogfood6 주제는? (같은 프로젝트 반복 vs 새 도메인 — 예: 할 일 관리 앱, 간단한 CMS, 그래프 계산기 등)
