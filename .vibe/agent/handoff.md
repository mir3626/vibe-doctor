# Orchestrator Handoff — self_evolution

> 이 파일은 Orchestrator 재인스턴스화(re-incarnation)의 **연료**다.
> 컨텍스트 압축/세션 종료 후 새 Orchestrator가 부팅될 때, CLAUDE.md → memory/* → sprint-status.json → **이 파일** 순으로 읽어 직전 상태를 무손실 복원한다.
> 작업 체크포인트마다 이 파일을 갱신한다. 스키마는 `.vibe/agent/sprint-status.schema.json`의 `handoff` 필드와 1:1 대응.

---

## 1. Identity

- **branch**: `self_evolution` (origin 푸시 완료)
- **base**: `main` @ `dbc6f89` (dogfood P0 패치 반영본, origin 푸시 완료)
- **working dir**: `C:\Users\Tony\Workspace\vibe-doctor`
- **today**: 2026-04-09
- **language/tone**: 한국어 반말 (memory: `feedback_language_tone.md`)

## 2. Mission (왜 이 브랜치가 존재하는가)

dogfood 1(Bookshelf) + dogfood 2(Lingua Lens Chrome ext)에서 측정한 vibe-doctor 템플릿 마찰을 바탕으로 **self-evolution**. 핵심 재프레임:

- **subagent는 specialization이 아니라 context checkpoint 메커니즘**이다.
- 무한 context window가 있다면 Orchestrator 하나로 충분. 제약된 환경에서 퀄리티를 끌어올리려는 게 목적.
- `sprint-status.json`은 regression guard가 아니라 **Orchestrator 재인스턴스화의 연료**다.
- 기본값 "lean"은 tiny project에서만 유효. 실제 프로젝트는 context pressure로 subagent가 불가피.

증거: 이 세션 중 여러 차례 자동 압축이 발생하면서 한국어↔영어, 반말↔존댓말 전환이 반복됨. 사용자가 "MD 선언이 없으면 compaction 이후 초기화되는 증거"로 관찰.

## 3. 역할 제약 + Trigger Matrix

### 역할 제약 (상수, 트리거 아님)
- Orchestrator는 소스코드 직접 편집 금지. 문서/설정만 직접.
- **모든 코드 작성/수정은 Generator(Codex CLI) 위임**: `Bash("... | ./scripts/run-codex.sh -")`.

### Planner 소환 트리거
- 🟥 **Must**: 전체 로드맵 분할 / Orchestrator context 압축 이력 발생 / 독립 병렬 Sprint
- 🟨 **Should**: 분할 방식 트레이드오프 / 아키텍처 선택 비자명

### Evaluator 소환 트리거
- 🟥 **Must**: Orchestrator 1차 검증 실패(Tribunal) / context pressure 높음 / 비-executable AC 존재
- 🟨 **Should**: >5 파일 또는 >500 LOC / 작성자=평가자 충돌

## 4. P0 Task List (self_evolution)

| # | ID | 제목 | 상태 |
|---|----|-----|-----|
| A | P0-A | `.vibe/agent/handoff.md` 박제 (이 파일) | **done** |
| B | P0-B | `CLAUDE.md`의 3-role 섹션을 trigger matrix로 재작성 | **done** |
| C | P0-C | `sprint-status.schema.json`에 `handoff` 필드 추가 + vibe-doctor 자체 실 인스턴스 생성 | **done** |
| D | P0-D | `scripts/vibe-preflight.mjs` 실행 스크립트화 + `preflight.md`/`sandbox-contract.md`를 `_common-rules.md`에 흡수 후 삭제 | **done** |
| E | P0-E | `.vibe/agent/re-incarnation.md` fresh Orchestrator 부팅 프로토콜 문서 | **done** |

### P1 (이월)
- Sprint 프롬프트 template/slot
- `run-codex.sh` final report 추출 + heartbeat
- `.gitattributes` 자동화
- Partial shard read (section anchors)
- 파일 재읽기 방지 self-rule

### P2 (이월)
- 병렬 Sprint 지침 원인 조사 (`docs/orchestration/sprint.md` 확인)
- Tribunal 모드 Evaluator

## 5. Handoff field schema (P0-C에서 정식화 예정)

```jsonc
{
  "currentSprintId": "self-evolution-0",
  "lastActionSummary": "짧은 한 줄 — 직전에 뭘 했는지",
  "openIssues": ["미해결 블로커 또는 사용자 대기 질문"],
  "orchestratorContextBudget": "low | medium | high — 현재 압박 수준 자가진단",
  "preferencesActive": ["ko-informal", "autonomous-until-artifact", "..."]
}
```

## 6. Last action summary

P0 review 후속 purification pass 완료. 삭제: `docs/orchestration/roles.md`, `docs/orchestration/escalation.md`, `docs/prompts/master-prompt.md` (dead weight/구 파이프라인 잔재). 재작성: `CLAUDE.md` 전면(heading 평행화 + Generator를 "역할 제약"으로 분리 + 중복 제거 + 실패 에스컬레이션 섹션 통합). 참조 정리: `README.md`, `docs/context/product.md`, `docs/context/qa.md`, `.claude/agents/planner.md`, `.claude/skills/vibe-init/SKILL.md`, `docs/orchestration/providers.md`. 강화: schema `handoff.required`에 `preferencesActive` 추가, `sprint-status.json`에 `vibe-preflight` verificationCommand 등록, `scripts/vibe-preflight.mjs`에 `.vibe/config.json` 기반 dynamic provider health + 첫 커밋 repo 구분, `re-incarnation.md` auto-memory 지시 명확화, `.vibe/agent/README.md` 정의 문장 재작성.

## 7. Next action (재부팅 시 여기부터)

self-evolution sprint-0 **완료 상태** + P0 리뷰 findings 전부 해결. 다음 선택지:
1. 추가 리뷰 반복 (사용자 요청 시)
2. P1 항목 착수 (Sprint 프롬프트 template/slot, run-codex.sh heartbeat, .gitattributes 자동화 등)
3. 3차 dogfood로 self-evolution 변경사항 실전 검증

## 8. 사용자 합의 상태

- dogfood 퀄리티 만족 — "거의 100점"
- 산출물까지 자율 권한 유지
- 한국어 반말 유지
- 작업은 `self_evolution` 브랜치에서. main은 dogfood P0 반영본까지 푸시 완료.
