# Token / cost policy

- 루트 memory에 장문 규칙을 넣지 않는다.
- 상세 규칙은 skills / context shard로 이동한다.
- 큰 로그는 hook 또는 CLI 전처리로 요약한다.
- 가능한 범위에서 provider output의 usage 메타데이터를 `.vibe/runs/`에 저장한다.
- 보고서에는 집계된 사용량을 짧게 요약한다.
