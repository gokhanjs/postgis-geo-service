# Architecture decision records

Each file records one decision, the reasoning available at the time, and what
was given up. They are not updated when a decision is revisited; a new record
supersedes an old one, so the sequence stays readable as history.

| #                                                | Decision                                   |
| ------------------------------------------------ | ------------------------------------------ |
| [0001](0001-entity-as-the-domain-noun.md)        | `entity` is the domain noun                |
| [0002](0002-tenant-isolation-in-the-database.md) | Tenant isolation lives in the database     |
| [0003](0003-geography-over-geometry.md)          | Geography columns, not geometry with casts |
| [0004](0004-hand-written-migration-runner.md)    | The migration runner stays hand-written    |
| [0005](0005-technologies-left-out.md)            | Technologies deliberately left out         |
