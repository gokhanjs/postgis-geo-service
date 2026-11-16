# Reference datasets

Two packages, rebuilt monthly from OpenStreetMap and OurAirports and published
only when they pass a gate. [ADR 0007](adr/0007-global-reference-datasets.md)
explains why they are files rather than tables.

| Package     | Files                                                                            |
| ----------- | -------------------------------------------------------------------------------- |
| `tr-admin`  | `provinces.geojson`, `tr-{plate}-districts.geojson` (one per province), `NOTICE` |
| `tr-places` | `places.geojson`, `NOTICE`                                                       |

```bash
curl -H 'x-api-key: gsk_...' http://localhost:3000/api/v1/datasets
curl -H 'x-api-key: gsk_...' http://localhost:3000/api/v1/datasets/tr-admin/latest/manifest
curl -H 'x-api-key: gsk_...' -O \
  http://localhost:3000/api/v1/datasets/tr-admin/20261117T040000Z/files/tr-34-districts.geojson
```

The manifest lists every file with its `sha256`, `bytes` and feature count, the
licence, and each source with its download time and, for OpenStreetMap, the
extract's replication timestamp. A file's `ETag` is its sha256. Paths with a
version are immutable; `latest` resolves to the newest version and is
revalidated. Only files the manifest lists are served.

## Codes

Codes are what a consumer stores, so they are derived from source identifiers
and checked between releases.

| Feature  | Code                                           | Example             |
| -------- | ---------------------------------------------- | ------------------- |
| Province | licence plate number, from `ISO3166-2` `TR-34` | `34`                |
| District | `{plate}-{ASCII slug of the OSM name}`         | `34-beyoglu`        |
| Airport  | `airport:{OurAirports ident}`, the ICAO code   | `airport:LTFM`      |
| Port     | `port:{n\|w\|r}{OSM id}`                       | `port:w343046405`   |
| Station  | `station:{n\|w\|r}{OSM id}`                    | `station:w52530393` |

The slug lowercases, maps Turkish letters to ASCII (`ç ğ ı İ ö ş ü â î û`)
and joins words with hyphens: `Eyüpsultan` is `eyupsultan`, `Iğdır Merkez` is
`igdir-merkez`. The plate prefix is required because names such as "Merkez"
repeat across provinces.

## Properties

- Provinces: `code`, `name`, `iso3166_2`.
- Districts: `code`, `name`, `province_code`, `wikidata`, `osm_relation`.
- Places: `code`, `type` (`airport`, `port`, `station`), `name`, `iata`,
  `icao`, `lat`, `lng`, `province_code`.

Geometry is WGS 84 with `[lng, lat]` order, at 1e-5 degrees (about a metre):
`MultiPolygon` for areas, `Point` for places.

## Selection

**Provinces and districts.** `boundary=administrative` relations: provinces are
`admin_level=4` with `ISO3166-2` `TR-01` to `TR-81`, districts `admin_level=6`.

- Only relations count. Closed ways at level 6 are coastline islets.
- A level-6 relation lying entirely inside another is dropped: it is an island
  mapped within its district (Kara Ada inside Bodrum). Gökçeada and Bozcaada
  are real districts and are kept.
- A district's province comes from geometry. The `network` tag disagrees with it.

**Geometry rules**, computed in EPSG:3035:

1. Each district grows by 200 m over the sea. The growth is clipped to the
   district's own province area and keeps only what no district covers, so
   borders with another district, province or country do not move.
2. Where two buffers meet over narrow water, the smaller code keeps the overlap.
3. `ST_CoverageClean`, then `ST_CoverageSimplify` at 50 m, which simplifies each
   shared border once, so neighbours keep identical edges.
4. A province's published shape is the union of its districts. The OSM province
   polygon runs out to territorial waters (more than half of İstanbul's is sea),
   so using it would make the two files describe different coverages.

Places take their province from the OSM province polygon, which does include
territorial waters, so a pier head beyond the 200 m buffer still has one.

**Airports.** OurAirports rows with `iso_country=TR` and `scheduled_service=yes`.
The data is fetched from the `davidmegginson.github.io/ourairports-data` mirror.

**Bus stations.** `amenity=bus_station` alone also tags city stops, minibus
ranks and metro interchanges. A station is kept when its name, folded to ASCII,
matches `otogar`, `terminal` or `şehirlerarası`, and does not contain `turizm`,
which marks a bus operator's office.

**Ports.** No OpenStreetMap tag separates a cruise or passenger port from a
ferry pier: `cruise=*` is unused in Turkey, `amenity=ferry_terminal` covers
every city ferry pier, and known ports appear under five different tags. The
ports are therefore a curated list of OSM ids in
[`scripts/datasets/ports.json`](../scripts/datasets/ports.json): cruise ports and
ports with international passenger service. Domestic ferry piers and marinas are
left out. The list's names are published, since OSM often names only the pier.

## Gate

A release is published only if:

- it has exactly the 81 provinces `TR-01` to `TR-81`;
- district codes are unique, match `{plate}-{slug}` and name their own province;
- İstanbul's district codes equal the pinned set in
  [`scripts/datasets/istanbul-district-codes.json`](../scripts/datasets/istanbul-district-codes.json);
- every geometry is valid and the districts form a clean coverage;
- `IST` and `SAW` are present, every airport falls inside a province, and each
  airport's OurAirports region agrees with that province;
- every id in `ports.json` still exists in the extract;
- compared with the release serving now, no code has disappeared, and no
  district's area has changed by more than 5%.

A missing code blocks the release until it is published with `--accept-removed`,
and an area change until it is published with `--accept-area-change`. The pinned
İstanbul set has no flag: changing it is a code change. The difference report is
written for every run, passing or not.

## Licences

| Source                                          | Used for                                       | Licence                              | Attribution                              |
| ----------------------------------------------- | ---------------------------------------------- | ------------------------------------ | ---------------------------------------- |
| OpenStreetMap (Geofabrik extract)               | administrative boundaries, ports, bus stations | ODbL 1.0                             | "© OpenStreetMap contributors", required |
| OurAirports (`davidmegginson/ourairports-data`) | airports                                       | Unlicense (public domain dedication) | not required, given in NOTICE            |

The GeoJSON files carry OpenStreetMap data itself, so a package is a Derivative
Database under ODbL 1.0 (section 4.4, share-alike): it is published under ODbL
1.0, with the notice in `NOTICE` and in `manifest.json`. Airport records are
public domain and are shipped under the same package licence without
restriction.
