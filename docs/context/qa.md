# QA policy

기본 순서:
1. 좁은 범위 테스트
2. typecheck
3. lint
4. build
5. smoke check

원칙:
- 테스트 자동화가 없다면 QA 가능한 도구를 먼저 만든다.
- Orchestrator self-QA가 실패하면 Evaluator Must 트리거가 발동해 Evaluator(Tribunal)를 소환한다. Evaluator가 2회 연속 불합격이면 Planner 재소환으로 체크리스트를 재정의한다 (`CLAUDE.md` 의 "Sub-agent 소환 트리거 매트릭스" 참조).
- 완료 선언 전에는 최소 1회 이상의 검증 로그를 남긴다.
