# Secrets policy

- `.env`, `.env.*`, `secrets/**`, `config/credentials.json`은 repo에 저장하지 않는다.
- 단순 base64 인코딩은 보안 대책이 아니다.
- 자격증명은 OS 키체인, provider CLI 로그인 캐시, gitignored local config를 우선 사용한다.
- 민감 파일 접근은 필요 시 최소 범위만 허용한다.
