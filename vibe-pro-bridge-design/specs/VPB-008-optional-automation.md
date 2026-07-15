# VPB-008 — Optional Automation Adapters

## Objective

Support future zero-click review without coupling core skills to one provider.

## Adapters

- Workspace Agent trigger
- Responses API frontier model

## Rules

- explicit opt-in;
- same request/result schemas;
- Bridge status is authoritative;
- unavailable/error is not result-ready;
- do not claim Web Pro review when API adapter was used.

## DoD

Transport can be swapped without changing Goal discovery or result import.
