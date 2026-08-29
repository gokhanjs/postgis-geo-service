# Contributing

## Getting set up

```bash
pnpm install
pnpm db:up
pnpm migrate
pnpm test
```

Tests run against a real PostGIS instance. There are no mocks for spatial
behaviour, because a mock would only assert that it agrees with the test.

## Before opening a pull request

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

CI runs exactly this against a PostGIS service container.

## Conventions the build enforces

- **SQL lives only in `src/repositories`.** ESLint rejects a `pg` import from
  routes or services. Route handlers map HTTP to a service call and nothing
  more.
- **Geometry columns are `geography`.** Do not cast per query; the cast is what
  stops the GiST index from being usable.
- **Every repository method takes a tenant id** and runs inside `withTenant`.
  Row-level security is the backstop, not the primary guard.
- **A new endpoint means a TypeBox schema and an integration test.** The schema
  is also the OpenAPI documentation, so an undocumented endpoint is one that
  skipped validation.

`AGENTS.md` states the same rules for coding agents.

## The `.claude/` directory

It holds one thing: agent tooling meant for contributors. `agents/`,
`commands/`, `skills/` and `settings.json` are published; `settings.local.json`
is personal and is not.

Anyone's own working state, if they keep any, belongs outside it. Nothing here
depends on that, so there is no rule for it in this repository.

If you keep `.claude/` in a global gitignore, write it as `.claude/*`. The bare
directory form stops git descending at all, which makes the re-includes above
do nothing and makes force-added files look tracked when they are not.

## Commits

Conventional Commits, English, imperative subject. The body should explain why
the change is right, not restate the diff.
