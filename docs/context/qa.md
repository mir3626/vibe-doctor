# QA policy

기본 순서:
1. 좁은 범위 테스트
2. typecheck
3. lint
4. build
5. smoke check

원칙:
- 테스트 자동화가 없다면 QA 가능한 도구를 먼저 만든다.
- 같은 작업에서 테스트가 2회 연속 실패하면 challenger / reviewer 에스컬레이션을 고려한다.
- 완료 선언 전에는 최소 1회 이상의 검증 로그를 남긴다.
