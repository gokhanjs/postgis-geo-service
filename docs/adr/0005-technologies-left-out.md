# 5. Technologies deliberately left out

## Context

A portfolio project invites adding recognisable technologies. Each addition is
also a claim that the problem it solves exists here.

## Decision

Not included: tRPC, GraphQL, XML content negotiation, idempotency keys, an IoC
container, an ORM.

## Reasoning

- **tRPC** binds a TypeScript client to a TypeScript server for end-to-end
  types. This is a language-agnostic infrastructure API whose callers are other
  services. tRPC would constrain them to one language for no gain.
- **GraphQL** earns its complexity when clients need to select fields across a
  graph of related objects. There are nine endpoints returning flat arrays of
  two to four fields. There is no graph.
- **XML content negotiation** costs a serialisation layer and doubles the
  response test surface. The domain's actual media type question is GeoJSON,
  which the API already speaks.
- **Idempotency keys** would guarantee something the semantics already give:
  the write endpoints are `PUT` upserts, so repeating one is already a no-op.
- **An IoC container** would add indirection to a dependency graph of nine
  objects that is currently written out in one readable file.
- **An ORM** would sit between the code and the PostGIS functions that are the
  point of the service, and every non-trivial query would drop to raw SQL
  anyway.

## Consequences

The repository looks smaller than a maximal one. That is the intent: a
technology present without a problem to solve is evidence about the author, and
not the kind wanted.

Depth went into the axis the domain actually has: row-level security, generated
OpenAPI, RFC 9457 errors, cursor pagination, and index behaviour verified with
`EXPLAIN` rather than assumed.
