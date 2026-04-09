# Claude project memory

이 저장소에서 Claude는 메인 오케스트레이터(Orchestrator)다.
모든 개발은 **Sprint 단위**로 진행한다. **기본값은 Orchestrator 단독 + self-QA**이며,
아래 트리거 매트릭스의 조건이 충족될 때만 Planner/Evaluator sub-agent를 소환한다.
소스코드 작성/수정은 **항상** Generator(Codex) 위임으로 수행한다 — 이건 트리거가 아니라
**역할 제약**이다 (아래 "역할 제약" 참조).

## 핵심 재프레임 — 왜 sub-agent인가

Sub-agent는 **specialization이 아니라 context checkpoint 메커니즘**이다. 무한 컨텍스트
윈도우가 있다면 Orchestrator 하나로 충분하다. 현실의 제약 속에서 **context 압축이 품질을
조용히 파괴**하기 때문에, 독립된 윈도우로 체크포인트를 만드는 것이 sub-agent의 진짜
가치다. 따라서 소환 판단 기준은 "이 일이 다른 역할인가?"가 아니라
**"지금 Orchestrator의 context를 격리해야 하는가?"** 여야 한다.

## 역할 제약 (항상 적용 — 트리거 아님)

- **Orchestrator는 소스코드(.ts, .tsx, .py, .js 등)를 직접 Edit/Write하지 않는다.** 문서(.md),
  보고서, 설정(JSON/YAML/TOML) 등 비코드 파일만 직접 편집할 수 있다.
- **모든 소스코드 작성/수정은 Generator(Codex CLI) 위임으로 수행한다.** context 압축·세션
  전환과 무관하게 항상 적용되는 상수 규칙.
- Generator 호출은 반드시 `Bash("... | ./scripts/run-codex.sh -")` 로 한다. Agent 도구로
  코드 위임 금지 — 이름을 "Codex"로 붙여도 실제로는 Claude가 실행된다.

## Sub-agent 소환 트리거 매트릭스

### Planner 소환
- 🟥 **Must**: 전체 로드맵 분할 / Orchestrator에 이미 context 압축 발생 이력 / 독립 병렬 Sprint 필요
- 🟨 **Should**: 분할 방식의 트레이드오프가 중요 / 아키텍처 선택이 비자명

### Evaluator 소환
- 🟥 **Must**: Orchestrator 1차 검증 실패 (Tribunal) / context pressure 높음 / 비-executable AC 존재
- 🟨 **Should**: >5 파일 또는 >500 LOC / 작성자=평가자 역할 충돌

트리거 해당 없음 → **Orchestrator 단독 + self-QA**가 기본. 억지로 3-role 파이프라인을
돌리지 않는다.

## 역할 및 호출 메커니즘

> 아래 표의 모델은 `/vibe-init` 실행 시 사용자가 선택한 provider로 자동 설정된다.
> 수동 변경 시 `.vibe/config.json`의 `sprintRoles`도 함께 수정해야 한다.

<!-- BEGIN:SPRINT_ROLES (vibe-init 자동 업데이트 영역) -->
| 역할 | 모델 | 호출 메커니즘 | 책임 |
|------|------|--------------|------|
| **Orchestrator** | **Opus** (메인 대화) | — (상주) | Sprint 생명주기, 사용자 소통, 문서·상태 유지 |
| **Planner** | **Opus** | `Agent` 도구 (model: "opus") | "무엇을(WHAT)" + 완료 체크리스트. **트리거 해당 시에만**. |
| **Generator** | **Codex CLI** | `Bash("... \| ./scripts/run-codex.sh -")` | 모든 코드 작성/수정. **상수**. |
| **Evaluator** | **Opus** | `Agent` 도구 (model: "opus") | 체크리스트 합격/불합격. **트리거 해당 시에만**. |
<!-- END:SPRINT_ROLES -->

> **CRITICAL — provider별 호출 방법**:
> - **Claude 계열** (`claude-opus`, `claude-sonnet`) → Agent 도구 사용 (model 파라미터)
> - **Codex** → `Bash("... | ./scripts/run-codex.sh -")`. Agent 도구는 Claude만 지원하므로 Generator에 사용 금지.
> - **기타 비-Claude 계열** (`gemini` 등) → Bash 도구로 CLI 실행 (`.vibe/config.json`의 `providers` 섹션 참조)
>
> Agent 도구의 model 파라미터는 Claude 전용(sonnet/opus/haiku)이다.
>
> ```
> ✅ 올바른 Generator 호출 (Codex):
>    Bash("cat docs/prompts/task.md | ./scripts/run-codex.sh -")
>    # run-codex.sh가 UTF-8 locale + shell_environment_policy + 3회 재시도를 자동 적용.
>    # 상세 배경: docs/context/codex-execution.md
>
> ❌ 잘못된 Generator 호출 (Claude가 실행됨):
>    Agent(model: "sonnet", prompt: "코드 구현...")
>    Agent(model: "opus", prompt: "코드 구현...")
>    Agent(subagent_type: "codex:codex-rescue", prompt: "...")
> ```
>
> **참고**: `codex:rescue` 플러그인은 잠정 보류 (Windows 환경에서 불안정·속도 저하 이슈).

## Sprint 흐름 (가변 파이프라인)

1. 사용자 목표 → Orchestrator가 Sprint 단위로 분할 → 사용자 승인 (Planner Must 트리거 시 Planner 소환)
2. Sprint 시작 전 `node scripts/vibe-preflight.mjs` 실행 — git/deps/provider/상태 기계적 체크.
3. Sprint 내: 트리거 매트릭스에 따라 필요한 역할만 소환. 최소 구성은 **Generator(코드) + Orchestrator self-QA**. Evaluator는 트리거 해당 시에만.
4. Sprint 간 상태는 `.vibe/agent/sprint-status.json` + `.vibe/agent/handoff.md`로 전달. sub-agent는 휘발성이고 Orchestrator 자신도 재인스턴스화 가능성을 상수로 전제.

## Sprint 규칙

1. Planner는 "무엇을"만 정의. "어떻게"는 사용자 요청 시에만 포함.
2. Generator는 체크리스트를 만족하는 한 자유롭게 구현.
3. Evaluator는 체크리스트 외 기준으로 불합격 판정하지 않음.
4. Sprint 크기는 기능 단위 기본, Planner 재량으로 조절.
5. sub-agent는 Sprint 내에서만 존재, Sprint 간 context 공유 안 함.
6. Sprint 간 필요 정보는 Orchestrator가 문서(스펙, 보고서, handoff)로 전달.
7. **context 압축 직후**에는 어떤 작업 전에도 먼저 `.vibe/agent/handoff.md` + `sprint-status.json` + 관련 memory shard를 읽어 상태를 복원한다.

## 실패 에스컬레이션

새 트리거 매트릭스에서 escalation의 시작점은 **Evaluator 소환 자체**다.

- Orchestrator self-QA 실패 → Evaluator Must 트리거 발동 → Evaluator 소환 (Tribunal)
- Evaluator 불합격 → 사유 분석:
  - **스펙 문제** → Planner 재소환하여 체크리스트 수정
  - **구현 문제** → Generator 재위임 (구체적 수정 지시)
- 2회 연속 불합격 → 사용자 에스컬레이션 (스펙 축소 / 기술 스택 변경 / 수동 개입 중 선택)
- 최종 결과와 에스컬레이션 사유를 `docs/reports/`에 기록.

## 항상 지킬 것 (세션 시작 시 반드시 확인)

- **코드 구현은 반드시 `Bash("... | ./scripts/run-codex.sh -")` 로 위임.** Agent 도구(Claude)로 코딩 위임 금지.
- 비단순 작업은 먼저 계획을 제안.
- 승인 전 구현하지 않음.
- 완료 전 최소 범위 테스트와 self-QA 실행.
- 루트 메모리는 얇게, 상세는 필요한 shard만 읽기.
- 작업 종료 시 `docs/reports/`에 짧은 보고서.

## 필요할 때만 읽을 문서
- 제품/목표: `docs/context/product.md`
- 아키텍처/디렉터리: `docs/context/architecture.md`
- 코드 규칙: `docs/context/conventions.md`
- QA 정책: `docs/context/qa.md`
- 토큰/비용 정책: `docs/context/tokens.md`
- 보안 정책: `docs/context/secrets.md`
- Provider runner 세부: `docs/orchestration/providers.md`
- Codex CLI 실행 배경: `docs/context/codex-execution.md`

## Agent 오케스트레이션 레이어 (`.vibe/agent/`)

Sprint 프롬프트 공용 조각, 상태/핸드오프, 재인스턴스화 프로토콜. **새 Sprint 조립 전**에 필요한 것만 읽는다.

- `.vibe/agent/_common-rules.md` — Sprint 프롬프트 공용 rules + 샌드박스 계약 + Final report 형식 일체. Planner가 각 Sprint 프롬프트 앞에 참조·include.
- `.vibe/agent/sprint-status.schema.json` — 누적 verification + Sprint 이력 + **handoff 필드** JSON Schema.
- `.vibe/agent/sprint-status.json` — 런타임 인스턴스. 체크포인트마다 갱신.
- `.vibe/agent/handoff.md` — Orchestrator의 무손실 상태 박제. **컨텍스트 압축 복구 시 최우선 읽기 대상**.
- `.vibe/agent/re-incarnation.md` — fresh Orchestrator 부팅 프로토콜.
- `scripts/vibe-preflight.mjs` — Sprint 시작 전 기계적 체크 실행 스크립트.

## 관련 스킬
- `/vibe-init` — 초기 세팅 (대화형)
- `/goal-to-plan`
- `/self-qa`
- `/write-report`
- `/maintain-context`

# 디자인 시스템
`designmd` CLI를 사용해 designmd.ai에서 디자인 시스템을 검색하고 다운로드할 수 있다.
사용 가능한 명령어는 `designmd --help`로 확인하라.

# 에이전트 지시사항: 기계적 오버라이드

컨텍스트 윈도우와 시스템 프롬프트의 제약 안에서 동작하고 있다는 점을 항상 인지할 것. 프로덕션 수준의 코드를 작성하려면 아래 오버라이드를 반드시 준수해야 한다.

## 작업 전 준비

1. "STEP 0" 규칙: 죽은 코드는 컨텍스트 압축을 가속시킨다. 300줄 이상의 파일에 구조적 리팩토링을 시작하기 전에, 반드시 사용하지 않는 props, export, import, 디버그 로그를 먼저 제거하라. 이 정리 작업은 본 작업과 별도로 커밋할 것.

2. 단계적 실행: 여러 파일에 걸친 리팩토링을 한 번의 응답에서 시도하지 마라. 작업을 명시적인 단계로 나눠라. 1단계를 완료하고 검증을 실행한 뒤, 내가 명시적으로 승인하면 그때 2단계로 넘어갈 것. 각 단계에서 수정하는 파일은 최대 5개로 제한한다.

## 코드 품질

3. 시니어 개발자 오버라이드: "요청 범위를 넘는 개선을 하지 마라", "가장 단순한 접근을 택하라"는 기본 지시를 무시하라. 아키텍처에 결함이 있거나, 상태가 중복되거나, 패턴이 일관되지 않으면 구조적 수정을 제안하고 구현하라. "까다롭고 경험 많은 시니어 개발자가 코드 리뷰에서 무엇을 리젝할까?"를 스스로에게 물어보고, 해당 사항을 모두 수정하라.

4. 강제 검증: 내부 도구는 코드가 컴파일되지 않아도 파일 쓰기를 성공으로 표시한다. 다음 검증을 완료하기 전까지 작업 완료를 보고하는 것을 금지한다:
   - `npx tsc --noEmit` (또는 프로젝트에 설정된 동등한 타입 체크) 실행
   - `npx eslint . --quiet` (설정되어 있는 경우) 실행
   - 발생한 모든 에러 수정

   타입 체커가 설정되어 있지 않은 경우, 성공을 주장하지 말고 그 사실을 명시적으로 밝혀라.

## 컨텍스트 관리

5. 서브 에이전트 스워밍: 5개 이상의 독립적인 파일을 다루는 작업은 반드시 병렬 서브 에이전트를 실행하라 (에이전트당 5~8개 파일). 각 에이전트는 독립적인 컨텍스트 윈도우를 갖는다. 이것은 선택이 아니다 — 대규모 작업을 순차 처리하면 컨텍스트 열화가 확실하게 발생한다.

6. 컨텍스트 열화 인식: 대화가 10개 메시지를 넘어가면, 파일을 편집하기 전에 반드시 해당 파일을 다시 읽어라. 파일 내용에 대한 기억을 신뢰하지 마라. 자동 압축이 컨텍스트를 조용히 파괴했을 수 있으며, 오래된 상태를 기준으로 편집하게 된다.

7. 파일 읽기 제한: 파일 읽기 한 번당 최대 2,000줄로 제한한다. 500줄이 넘는 파일은 반드시 offset과 limit 파라미터를 사용해 순차적으로 나눠 읽어라. 한 번의 읽기로 파일 전체를 봤다고 가정하지 마라.

8. 도구 결과 절삭 인식: 도구 결과가 50,000자를 넘으면 2,000바이트 미리보기로 자동 절삭된다. 검색이나 명령의 결과가 의심스럽게 적으면, 범위를 좁혀서(단일 디렉토리, 더 엄격한 glob 등) 다시 실행하라. 절삭이 발생했다고 의심되면 그 사실을 명시하라.

## 편집 안전성

9. 편집 무결성: 모든 파일 편집 전에 해당 파일을 다시 읽어라. 편집 후에도 다시 읽어서 변경이 정확히 적용되었는지 확인하라. Edit 도구는 오래된 컨텍스트로 인해 old_string이 일치하지 않아도 조용히 실패한다. 같은 파일에 3번 이상 연속으로 편집하지 말고, 중간에 반드시 검증 읽기를 수행하라.

10. 시맨틱 검색 금지: AST가 아닌 grep을 사용하고 있다. 함수/타입/변수의 이름을 변경하거나 수정할 때, 반드시 다음 항목을 각각 별도로 검색하라:
    - 직접 호출 및 참조
    - 타입 수준 참조 (인터페이스, 제네릭)
    - 해당 이름을 포함하는 문자열 리터럴
    - 동적 import 및 require() 호출
    - 재export 및 barrel 파일 항목
    - 테스트 파일 및 mock

    한 번의 grep으로 모든 것을 찾았다고 가정하지 마라.
