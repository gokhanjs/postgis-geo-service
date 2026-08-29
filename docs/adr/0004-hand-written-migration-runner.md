# 4. The migration runner stays hand-written

## Context

`scripts/migrate.ts` is roughly 160 lines: numbered `.do`/`.undo` SQL pairs, a
ledger table, one transaction per migration. Established alternatives exist
(node-pg-migrate, Umzug, Flyway).

## Decision

Keep it, and harden it, rather than adopt a library.

## Reasoning

A hand-rolled migrator is a liability when it reads as naive. The usual tell is
running DDL outside a transaction, or recording the ledger entry separately
from the migration it describes, so a crash leaves the two disagreeing. This
one applies each migration and its ledger insert in the same transaction, which
is the detail most hand-rolled runners get wrong.

It also does something the libraries do not: create the target database when it
is missing, which is what makes `docker compose up` work on a clean machine.
Adopting a library would not remove that code, it would leave the project with
two mechanisms.

## Consequences

Features a library would provide are absent and would have to be written:
advisory locking against concurrent runs, checksums to detect an applied file
being edited, a `status` command, multi-step rollback. Version ordering is
lexicographic, which is correct for zero-padded numbers and breaks at 1000 with
nothing enforcing the padding.

None of these matter at the current scale. All of them become worth writing the
first time this service is deployed by more than one person at once, and that
is the trigger to revisit this record.
