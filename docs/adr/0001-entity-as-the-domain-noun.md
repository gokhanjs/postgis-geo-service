# 1. `entity` is the domain noun

## Context

The service began as a restaurant delivery component, with tables named for
restaurants. Serving a second product meant choosing a noun that spans
restaurants, warehouses, couriers, charging stations and whatever comes next.

Candidates considered: `feature`, `place`, `asset`, `resource`, `entity`.

## Decision

`entity`, with a caller-defined `entity_type` discriminator.

## Reasoning

The service does not store restaurants. It stores that _something_ the caller
owns, whose meaning it never learns, sits at a coordinate. The correct noun for
"an object with an identity and a type whose contents are opaque to me" is
precisely a domain entity, so the word carries the model rather than papering
over it.

The alternatives each fail on a case the service must handle:

- **`place`** implies a fixed location, which excludes couriers and vehicles.
- **`asset`** reads as inventory; "a restaurant is an asset" is a stretch.
- **`feature`** is the GeoJSON and OGC term and was the strongest contender.
  It fails on precision: in GeoJSON a polygon is also a Feature, so naming only
  the point table `features` would be wrong by the standard it borrows from.
  It is also heavily overloaded in software generally.

## Consequences

`entity` is a vague word in isolation, and a reader meeting `entity_locations`
without context has to look it up once. That cost is paid in documentation.
The benefit is that no future domain has to be squeezed into a noun that was
chosen for a different one.
