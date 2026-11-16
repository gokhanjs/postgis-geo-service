import istanbulCodes from './istanbul-district-codes.json' with { type: 'json' };

export interface ReleaseSummary {
  provinces: Array<{ code: string; iso3166_2: string }>;
  districts: Array<{ code: string; province_code: string; area_m2: number }>;
  places: Array<{ code: string; type: string; iata: string | null }>;
}

export interface GateResult {
  ok: boolean;
  failures: string[];
  removed: string[];
  added: string[];
  /** Districts whose area moved by more than MAX_AREA_CHANGE. */
  areaChanged: string[];
}

export interface GateOptions {
  acceptRemoved?: boolean;
  acceptAreaChange?: boolean;
}

const PROVINCES = Array.from({ length: 81 }, (_, i) => `TR-${String(i + 1).padStart(2, '0')}`);
const DISTRICT_CODE = /^([0-9]{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUIRED_IATA = ['IST', 'SAW'];
const MAX_AREA_CHANGE = 0.05;

/**
 * Decides whether a release may replace the previous one. Consumers store the
 * codes, so a code that disappears blocks publication until a person accepts it.
 */
export function validateRelease(
  next: ReleaseSummary,
  previous: ReleaseSummary | null,
  options: GateOptions = {},
): GateResult {
  const failures = [...checkProvinces(next), ...checkDistricts(next), ...checkAirports(next)];
  let removed: string[] = [];
  let added: string[] = [];
  let areaChanged: string[] = [];

  if (previous !== null) {
    const before = codesOf(previous);
    const after = codesOf(next);
    removed = [...before].filter((code) => !after.has(code)).sort();
    added = [...after].filter((code) => !before.has(code)).sort();
    if (removed.length > 0 && options.acceptRemoved !== true) {
      failures.push(`codes removed since the previous release: ${removed.join(', ')}`);
    }
    areaChanged = areasMoved(next, previous);
    if (areaChanged.length > 0 && options.acceptAreaChange !== true) {
      const percent = MAX_AREA_CHANGE * 100;
      failures.push(`district areas changed by more than ${percent}%: ${areaChanged.join(', ')}`);
    }
  }

  return { ok: failures.length === 0, failures, removed, added, areaChanged };
}

function codesOf(summary: ReleaseSummary): Set<string> {
  return new Set([...summary.districts, ...summary.places].map((item) => item.code));
}

function checkProvinces(next: ReleaseSummary): string[] {
  const failures: string[] = [];
  const iso = new Set(next.provinces.map((p) => p.iso3166_2));
  const missing = PROVINCES.filter((code) => !iso.has(code));
  const unexpected = [...iso].filter((code) => !PROVINCES.includes(code));

  if (missing.length > 0) failures.push(`provinces missing: ${missing.join(', ')}`);
  if (unexpected.length > 0) failures.push(`provinces unexpected: ${unexpected.join(', ')}`);
  if (next.provinces.length !== PROVINCES.length) {
    failures.push(`${next.provinces.length} provinces, expected ${PROVINCES.length}`);
  }
  const mislabelled = next.provinces.filter((p) => p.iso3166_2 !== `TR-${p.code}`);
  if (mislabelled.length > 0) {
    failures.push(
      `province codes not matching ISO 3166-2: ${mislabelled.map((p) => p.code).join(', ')}`,
    );
  }
  return failures;
}

function checkDistricts(next: ReleaseSummary): string[] {
  const failures: string[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const malformed: string[] = [];
  const misplaced: string[] = [];

  for (const district of next.districts) {
    if (seen.has(district.code)) duplicates.add(district.code);
    seen.add(district.code);

    const match = DISTRICT_CODE.exec(district.code);
    if (match === null) malformed.push(district.code);
    else if (match[1] !== district.province_code) misplaced.push(district.code);
  }

  if (duplicates.size > 0) failures.push(`duplicate district codes: ${[...duplicates].join(', ')}`);
  if (malformed.length > 0) failures.push(`malformed district codes: ${malformed.join(', ')}`);
  if (misplaced.length > 0) {
    failures.push(`district codes naming another province: ${misplaced.join(', ')}`);
  }

  const istanbul = new Set(
    next.districts.filter((d) => d.province_code === '34').map((d) => d.code),
  );
  const pinned = new Set<string>(istanbulCodes);
  const lost = [...pinned].filter((code) => !istanbul.has(code));
  const extra = [...istanbul].filter((code) => !pinned.has(code));
  if (lost.length > 0) failures.push(`İstanbul district codes missing: ${lost.join(', ')}`);
  if (extra.length > 0) failures.push(`İstanbul district codes not pinned: ${extra.join(', ')}`);

  return failures;
}

function checkAirports(next: ReleaseSummary): string[] {
  const iata = new Set(next.places.filter((p) => p.type === 'airport').map((p) => p.iata));
  const missing = REQUIRED_IATA.filter((code) => !iata.has(code));
  return missing.length > 0 ? [`airports missing: ${missing.join(', ')}`] : [];
}

/** A boundary that moves this much is more likely a mapping error than a real change. */
function areasMoved(next: ReleaseSummary, previous: ReleaseSummary): string[] {
  const before = new Map(previous.districts.map((d) => [d.code, d.area_m2]));
  return next.districts
    .filter((d) => {
      const area = before.get(d.code);
      return area !== undefined && Math.abs(d.area_m2 - area) / area > MAX_AREA_CHANGE;
    })
    .map((d) => d.code)
    .sort();
}
