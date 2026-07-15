# VPB-005 — Result Package and Importer

## Objective

Install Pro review/design artifacts safely under `docs/plans/<folder>`.

## Deliverables

- result manifest validation
- allowed path policy
- atomic staging/rename
- conflict/no-op handling
- import/provenance receipt
- mandatory CLI prompt check

## DoD

No result can escape the result root or overwrite a different existing package.
