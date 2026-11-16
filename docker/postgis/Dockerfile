# syntax=docker/dockerfile:1

# Current postgis/postgis tags are amd64 only; this is the same stack for any arch.
# Trixie, not bookworm: GEOS 3.11 there lacks the coverage functions.
FROM postgres:18-trixie

ARG POSTGIS_VERSION=3.7.0

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      "postgresql-${PG_MAJOR}-postgis-3=${POSTGIS_VERSION}+dfsg*" \
      "postgresql-${PG_MAJOR}-postgis-3-scripts=${POSTGIS_VERSION}+dfsg*" \
 && rm -rf /var/lib/apt/lists/*
