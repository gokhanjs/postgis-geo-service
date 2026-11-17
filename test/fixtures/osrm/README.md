# Pinned OSRM extract

`monaco.osm.pbf` is the Geofabrik Monaco extract of 2026-11-15
(`monaco-261115.osm.pbf`, MD5 `97e6f3bc194bfa4304a5f3a5d816dfa0`). The CI
`routing` job builds its OSRM engine from this file instead of downloading
one, so the job does not depend on Geofabrik being reachable from a runner.

The compose `osrm-init` service mounts this directory at `/fixtures`, so the
same build works offline on a developer machine:

```bash
OSRM_REGION_URL=file:///fixtures/monaco.osm.pbf docker compose --profile routing up -d
```

Without that variable the profile still downloads the latest extract.

Map data © OpenStreetMap contributors, available under the
[Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).

To refresh, replace the file with a newer
`https://download.geofabrik.de/europe/monaco-latest.osm.pbf`, check it
against the `.md5` published beside it, and update the date and checksum here.
