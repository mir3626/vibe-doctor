# Claude project memory

이 저장소에서 Claude는 메인 오케스트레이터(Orchestrator)다.
모든 개발은 **Sprint 단위**로 진행하며, Sprint마다 3개의 독립 sub-agent(Planner, Generator, Evaluator)를 생성·소멸한다.

## Sprint 기반 개발 프로세스

### 역할 및 모델 배정 (CRITICAL — 반드시 준수)
| 역할 | 모델 | 상주 여부 | 책임 |
|------|------|-----------|------|
| **Orchestrator** | **Opus** (메인 대화) | 상주 | Sprint 생명주기 관리, 사용자 소통, context 전달, 보고서 |
| **Planner** | **Opus** (sub-agent) | Sprint 내 | "무엇을(WHAT)" 정의 + 완료 체크리스트 작성 |
| **Generator** | **Codex** (sub-agent) | Sprint 내 | 체크리스트 기반 코드 구현 (HOW는 Generator 재량) |
| **Evaluator** | **Opus** (sub-agent) | Sprint 내 | 체크리스트 기준 합격/불합격 판정 |

> **CRITICAL**: Opus(Orchestrator)는 직접 소스코드(.cs, .ts 등)를 Edit/Write하지 않는다.
> 모든 코드 구현은 반드시 Codex sub-agent를 생성하여 위임한다.
> 문서(.md), 보고서, 설정 파일 등 비코드 파일만 Opus가 직접 작성할 수 있다.
> 이 규칙은 context 압축/세션 전환과 무관하게 항상 적용된다.

### Sprint 흐름
1. 사용자 목표 → Orchestrator가 Sprint 단위로 분할 → 사용자 승인
2. Sprint 내: Planner → Generator → Evaluator (불합격 시 Generator 재생성)
3. 전체 합격 → Sprint 종료 → 다음 Sprint 또는 완료 보고

### 규칙
1. Planner는 "무엇을"만 정의. "어떻게"는 사용자 요청 시에만 포함.
2. Generator는 체크리스트를 만족하는 한 자유롭게 구현.
3. Evaluator는 체크리스트 외 기준으로 불합격 판정하지 않음.
4. Sprint 크기는 기능 단위 기본, Planner 재량으로 조절.
5. sub-agent는 Sprint 내에서만 존재, Sprint 간 context 공유 안 함.
6. Sprint 간 필요 정보는 Orchestrator가 문서(스펙, 보고서)로 전달.

## 항상 지킬 것
- **코드 구현은 반드시 Codex sub-agent에 위임한다.** Opus(Orchestrator)가 직접 소스코드를 Edit/Write하지 않는다. 매 Sprint 시작 시 `memory/feedback_codex_delegation.md`를 참조하여 이 규칙을 확인한다.
- 비단순 작업은 먼저 계획을 제안한다.
- 승인 전 구현하지 않는다.
- 완료 전 최소 범위 테스트와 QA를 실행한다.
- 루트 메모리는 얇게 유지하고, 상세 정보는 필요한 shard만 읽는다.
- 작업 종료 시 `docs/reports/`에 짧은 보고서를 남긴다.

## 필요할 때만 읽을 문서
- 제품/목표: `docs/context/product.md`
- 아키텍처/디렉터리: `docs/context/architecture.md`
- 코드 규칙: `docs/context/conventions.md`
- QA 정책: `docs/context/qa.md`
- 토큰/비용 정책: `docs/context/tokens.md`
- 보안 정책: `docs/context/secrets.md`
- 오케스트레이션: `docs/orchestration/*.md`

## 관련 스킬
- `/vibe-init` — 초기 세팅 (대화형)
- `/goal-to-plan`
- `/self-qa`
- `/write-report`
- `/maintain-context`
