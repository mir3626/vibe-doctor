# `.vibe/agent/` — Agent orchestration layer

이 서브트리는 **Orchestrator(Claude) ↔ Generator(Codex/기타 CLI)** 사이의 런타임 계약,
프롬프트 공용 조각, 상태 추적 스키마를 담는다. 사람 사용자가 읽는 docs가 아니라
**에이전트가 파싱/include/주입해서 쓰는 머신 친화 자산**이다.

## 왜 분리되어 있는가

`docs/context/*`와 `docs/orchestration/*`는 설계 의도와 규칙을 사람이 읽기 위한
문서인 반면, `.vibe/agent/*`는 다음 세 가지 문제를 해결한다:

1. **Sprint 프롬프트 보일러플레이트 중복** — 6개 Sprint가 같은 "Rules / Verification /
   Final report" 섹션을 복붙. 공용 조각을 `_common-rules.md`로 추출하고 Planner가
   Sprint 프롬프트 생성 시 참조 링크 또는 inline include로 재사용.

2. **샌드박스 × Orchestrator 경계 모호성** — Codex `workspace-write` sandbox는 네트워크/
   파일 접근이 제한돼 `npm install` 같은 사전 작업을 Generator가 수행할 수 없다.
   누가 뭘 하는지 `sandbox-contract.md`에 공식화.

3. **Sprint 간 상태 유실** — Sprint N이 만든 스모크 스크립트가 Sprint N+1에서 "still
   pass"해야 하지만, Orchestrator가 수작업으로 매번 상기해야 한다. `sprint-status.json`
   스키마로 누적 검증 명령을 구조화하고 Planner가 자동 주입.

## 파일

| 파일 | 용도 |
|---|---|
| `_common-rules.md` | Sprint 프롬프트 공용 rules/verification 조각. Planner는 Sprint별 고유 체크리스트 앞에 이 파일을 `>` include 형태로 붙인다. |
| `sandbox-contract.md` | Codex/기타 샌드박스형 Generator와 Orchestrator의 역할 분담 공식 계약. preflight(의존성 설치)부터 post-verify까지. |
| `sprint-status.schema.json` | Sprint 누적 상태(통과한 검증 명령, Sprint별 결과)의 JSON Schema. 실제 파일은 런타임에 `.vibe/agent/sprint-status.json`으로 생성·갱신. |
| `preflight.md` | 새 Sprint 시작 전 Orchestrator가 돌릴 체크 목록 (네트워크 선행 작업, git 상태, provider health). |

## 버전

`schemaVersion: 0.1` — 실험적. 한 번 더 dogfood한 뒤 안정화 여부 결정.
