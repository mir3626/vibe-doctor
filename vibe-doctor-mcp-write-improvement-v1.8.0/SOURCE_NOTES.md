# Source Notes

## Reviewed repository evidence

- GitHub repository: `mir3626/vibe-doctor`
- Current release observed in GitHub Actions:
  - `v1.8.0`
  - commit `60511059e787301216b4ece7706c4c7b1328e6a7`
  - subject `Release v1.8.0 web pro bridge`
- User-provided current MCP tool catalog:
  - create/list/get/claim
  - begin/put/finalize result
  - result read/import acknowledgement/cancel

## Official OpenAI references

- Define tools:
  - https://developers.openai.com/apps-sdk/plan/tools
- Apps SDK reference:
  - https://developers.openai.com/apps-sdk/reference
- Test your integration:
  - https://developers.openai.com/apps-sdk/deploy/testing
- Authentication:
  - https://developers.openai.com/apps-sdk/build/auth
- Connect from ChatGPT / Refresh metadata:
  - https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
- Optimize metadata:
  - https://developers.openai.com/apps-sdk/guides/optimize-metadata

## Important official guidance applied

- One focused job per tool
- Exactly one clear tool for each direct prompt
- Descriptions should start with `Use this when...`
- Explicit read/destructive/open-world annotations
- Exact output schema for structured content
- Explicit model/app visibility
- MCP Inspector for raw tool debugging
- Per-tool OAuth metadata plus runtime auth challenge
- Refresh app metadata after tool-list or description changes
- Golden prompt direct/indirect/negative regression
