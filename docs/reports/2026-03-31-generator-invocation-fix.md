# Sub-agent Provider 호출 규칙 정립

## Summary
비-Claude provider(codex 등)가 Agent 도구로 호출되어 사용자 선택 모델 대신 Claude가 실행되는 버그의 근본 원인을 진단하고, provider 종류에 따른 범용 호출 규칙을 문서화했다.

## 근본 원인
- Claude Code의 Agent 도구는 `model` 파라미터가 Claude 전용(sonnet/opus/haiku)
- "위임 = Agent 도구"라는 패턴이 고착되어, 비-Claude provider도 Agent 도구로 호출
- 결과적으로 사용자가 선택한 모델 대신 Claude가 코드를 작성함

## 해결책 (범용 규칙)
- **Claude 계열** provider → Agent 도구 사용
- **비-Claude 계열** provider → Bash 도구로 CLI/API 명령 실행
- `.vibe/config.json` → `providers` 섹션의 command/args를 참조
- 역할(Planner/Generator/Evaluator)에 무관하게 provider 종류로 호출 방법 결정

## Changed
- `CLAUDE.md` — CRITICAL 블록을 provider 종류별 범용 호출 규칙으로 재작성
- `docs/orchestration/roles.md` — sub-agent 호출 방법 주의사항을 범용 규칙으로 수정
- `docs/orchestration/providers.md` — 역할 고정 테이블을 provider별 호출 방법 테이블로 변경

## QA
- `npm run typecheck` — pass
- `npm test` — 7/7 pass
- `npm run build` — pass

## Risks
- 없음 (문서 변경만, 코드 변경 없음)
