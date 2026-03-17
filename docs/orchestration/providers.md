# Provider runners

각 provider는 `.vibe/config.local.json`에서 실행 명령을 교체할 수 있다.
이 베이스는 특정 CLI 버전에 강하게 결합되지 않도록 **템플릿형 인자 치환**을 사용한다.

치환 가능한 변수:
- `{prompt}`
- `{promptFile}`
- `{cwd}`
- `{role}`
- `{taskId}`
