---
description: Prepare a working development environment for this repository
---

Get this repository running for someone who just cloned it. `pnpm setup` does
the mechanical part; your job is to check the environment first and ask about
the choices that script cannot make.

1. **Check the environment.** Node version against `.nvmrc`, whether Docker is
   running, and whether the ports in `.env.example` (3000, 5432, 5000) are
   already taken. Report what you find before changing anything.

2. **Ask what the script cannot decide**, in one round:
   - Routing needed? It costs an OSM extract download and preprocessing. If
     yes, which region (default Monaco, seconds; a country needs several GB).
   - Any port conflicts to resolve, and to what.

3. **Run the setup**, then verify rather than assume:
   - `curl localhost:3000/health/ready` returns `status: ok`
   - `pnpm test` passes
   - `/docs` serves the API reference

4. **Report** the admin token from `pnpm generate:token` and the first API key,
   and tell them to store the token now since only its digest is kept.

If a step fails, diagnose it rather than retrying. The two failures seen most
often are a stale volume from an older schema (`docker compose down -v`) and
a `geo_app` authentication error, which means migrations have not run.
