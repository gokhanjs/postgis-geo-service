import { describe, expect, it } from 'vitest';
import istanbulCodes from '../../scripts/datasets/istanbul-district-codes.json' with { type: 'json' };
import { validateRelease, type ReleaseSummary } from '../../scripts/datasets/gate.ts';

const plates = Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));

/** The smallest release the gate accepts: every province, İstanbul exact, both city airports. */
function release(): ReleaseSummary {
  return {
    provinces: plates.map((code) => ({ code, iso3166_2: `TR-${code}` })),
    districts: [
      ...istanbulCodes.map((code) => ({ code, province_code: '34', area_m2: 50_000_000 })),
      ...plates
        .filter((plate) => plate !== '34')
        .map((plate) => ({ code: `${plate}-merkez`, province_code: plate, area_m2: 900_000_000 })),
    ],
    places: [
      { code: 'airport:LTFM', type: 'airport', iata: 'IST' },
      { code: 'airport:LTFJ', type: 'airport', iata: 'SAW' },
      { code: 'port:galataport', type: 'port', iata: null },
    ],
  };
}

function failuresOf(next: ReleaseSummary, previous: ReleaseSummary | null = null): string {
  return validateRelease(next, previous).failures.join('\n');
}

describe('validateRelease on its own', () => {
  it('accepts a complete first release', () => {
    expect(validateRelease(release(), null)).toMatchObject({ ok: true, failures: [] });
  });

  it('requires all 81 provinces', () => {
    const next = release();
    next.provinces.pop();
    expect(failuresOf(next)).toContain('TR-81');
  });

  it('requires the province codes to be exactly TR-01 to TR-81', () => {
    const next = release();
    next.provinces[80] = { code: '82', iso3166_2: 'TR-82' };
    expect(validateRelease(next, null).ok).toBe(false);
  });

  it('rejects a duplicate district code', () => {
    const next = release();
    next.districts.push({ code: '34-fatih', province_code: '34', area_m2: 1 });
    expect(failuresOf(next)).toContain('34-fatih');
  });

  it.each(['34-Beşiktaş', '34_besiktas', '3-besiktas', '34-', '34-besiktas-'])(
    'rejects the malformed district code %s',
    (code) => {
      const next = release();
      next.districts.push({ code, province_code: '34', area_m2: 1 });
      expect(failuresOf(next)).toContain(code);
    },
  );

  it('rejects a district whose code names another province', () => {
    const next = release();
    next.districts.push({ code: '06-cankaya', province_code: '34', area_m2: 1 });
    expect(failuresOf(next)).toContain('06-cankaya');
  });

  it('holds İstanbul to its pinned code set, in both directions', () => {
    const missing = release();
    missing.districts = missing.districts.filter((d) => d.code !== '34-adalar');
    expect(failuresOf(missing)).toContain('34-adalar');

    const extra = release();
    extra.districts.push({ code: '34-yenikent', province_code: '34', area_m2: 1 });
    expect(failuresOf(extra)).toContain('34-yenikent');
  });

  it.each(['IST', 'SAW'])('requires the %s airport by its IATA code', (iata) => {
    const next = release();
    next.places = next.places.filter((p) => p.iata !== iata);
    expect(failuresOf(next)).toContain(iata);
  });
});

describe('validateRelease against the previous release', () => {
  it('passes an unchanged release and reports no difference', () => {
    expect(validateRelease(release(), release())).toEqual({
      ok: true,
      failures: [],
      removed: [],
      added: [],
      areaChanged: [],
    });
  });

  it('blocks a release that loses a district code', () => {
    const previous = release();
    previous.districts.push({ code: '06-cankaya', province_code: '06', area_m2: 1 });

    const result = validateRelease(release(), previous);

    expect(result.ok).toBe(false);
    expect(result.removed).toEqual(['06-cankaya']);
    expect(result.failures.join('\n')).toContain('06-cankaya');
  });

  it('blocks a release that loses a place code', () => {
    const next = release();
    next.places = next.places.filter((p) => p.code !== 'port:galataport');

    const result = validateRelease(next, release());

    expect(result.ok).toBe(false);
    expect(result.removed).toEqual(['port:galataport']);
  });

  it('publishes a removal only when told to, and still reports it', () => {
    const previous = release();
    previous.districts.push({ code: '06-cankaya', province_code: '06', area_m2: 1 });

    const result = validateRelease(release(), previous, { acceptRemoved: true });

    expect(result).toMatchObject({ ok: true, removed: ['06-cankaya'] });
  });

  it('allows new codes and reports them', () => {
    const next = release();
    next.districts.push({ code: '06-cankaya', province_code: '06', area_m2: 1 });
    next.places.push({ code: 'station:ankara-asti', type: 'station', iata: null });

    expect(validateRelease(next, release())).toMatchObject({
      ok: true,
      added: ['06-cankaya', 'station:ankara-asti'],
    });
  });

  it('blocks a district whose area moves by more than 5%', () => {
    const grown = release();
    const fatih = grown.districts.find((d) => d.code === '34-fatih');
    if (fatih === undefined) throw new Error('fixture lacks 34-fatih');

    fatih.area_m2 = 50_000_000 * 1.04;
    expect(validateRelease(grown, release()).ok).toBe(true);

    fatih.area_m2 = 50_000_000 * 1.06;
    expect(failuresOf(grown, release())).toContain('34-fatih');

    fatih.area_m2 = 50_000_000 * 0.94;
    expect(failuresOf(grown, release())).toContain('34-fatih');
  });

  it('publishes an area change only when told to, and still reports it', () => {
    const grown = release();
    const fatih = grown.districts.find((d) => d.code === '34-fatih');
    if (fatih === undefined) throw new Error('fixture lacks 34-fatih');
    fatih.area_m2 = 50_000_000 * 1.2;

    expect(validateRelease(grown, release(), { acceptAreaChange: true })).toMatchObject({
      ok: true,
      areaChanged: ['34-fatih'],
    });
  });
});
