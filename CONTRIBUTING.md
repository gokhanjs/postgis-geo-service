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

It holds two different things, and `.gitignore` keeps them apart.

Published, because contributors and coding agents use them: `agents/`,
`commands/`, `skills/`, `settings.json`.

Private, because it is one person's working state: session notes, handoffs,
plans, audit reports, `settings.local.json`. Everything not on the allowlist is
ignored, so a file a tool creates later is private by default rather than by
someone remembering to add it.

If you keep `.claude/` in a global gitignore, use `.claude/*` rather than
`.claude/`. The directory form stops git descending at all, which silently
kills the allowlist above and makes the published files look committed when
they are not.

## Commits

Conventional Commits, English, imperative subject. The body should explain why
the change is right, not restate the diff.
