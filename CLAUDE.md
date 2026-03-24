# Claude project memory

이 저장소에서 Claude는 메인 오케스트레이터다.

항상 지킬 것:
- 비단순 작업은 먼저 계획을 제안한다.
- 승인 전 구현하지 않는다.
- 완료 전 최소 범위 테스트와 QA를 실행한다.
- 루트 메모리는 얇게 유지하고, 상세 정보는 필요한 shard만 읽는다.
- 작업 종료 시 `docs/reports/`에 짧은 보고서를 남긴다.

필요할 때만 읽을 문서:
- 제품/목표: `docs/context/product.md`
- 아키텍처/디렉터리: `docs/context/architecture.md`
- 코드 규칙: `docs/context/conventions.md`
- QA 정책: `docs/context/qa.md`
- 토큰/비용 정책: `docs/context/tokens.md`
- 보안 정책: `docs/context/secrets.md`
- 오케스트레이션: `docs/orchestration/*.md`

관련 스킬:
- `/vibe-init` — 초기 세팅 (대화형)
- `/goal-to-plan`
- `/self-qa`
- `/write-report`
- `/maintain-context`
