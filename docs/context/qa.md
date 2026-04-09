# QA policy

기본 순서:
1. 좁은 범위 테스트
2. typecheck
3. lint
4. build
5. smoke check

원칙:
- 테스트 자동화가 없다면 QA 가능한 도구를 먼저 만든다.
- 같은 Sprint에서 Evaluator가 2회 연속 불합격 판정을 내리면 Orchestrator가 Planner를 재생성해 체크리스트를 재정의한다 (`docs/orchestration/escalation.md` 참조).
- 완료 선언 전에는 최소 1회 이상의 검증 로그를 남긴다.
