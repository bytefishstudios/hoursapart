/**
 * A curated city list rather than the full IANA set.
 *
 * The tz database has ~600 identifiers, most of which nobody searches for and
 * several of which are aliases that would show up as duplicates. People type a
 * city name, so the index is keyed that way.
 *
 * Latitude is stored per city, not per zone. `America/New_York` covers both
 * Miami and Boston, which sit 16 degrees apart — enough to put an hour and a
 * half between their winter sunsets. Sharing a clock does not mean sharing a
 * sky.
 */
export interface City {
  name: string;
  country: string;
  timeZone: string;
  /** Degrees north, negative for south. Used for the day/night indicator. */
  lat: number;
  /** Extra search terms: former names, airport codes, common abbreviations. */
  aliases?: string[];
  /** URL segment, e.g. `new-york`. Derived from the name, unique by assertion. */
  slug: string;
  /**
   * Whether this city gets pairwise comparison pages.
   *
   * Every city earns its own page, but pairs grow as the square, so generating
   * all of them would produce thousands of near-identical pages competing with
   * each other for the same queries. Restricting pairs to the cities people
   * actually compare keeps each page worth landing on.
   */
  isHub: boolean;
}

type Row = [name: string, country: string, timeZone: string, lat: number, aliases?: string[]];

const ROWS: Row[] = [
  // Oceania
  ['Sydney', 'Australia', 'Australia/Sydney', -33.87, ['SYD', 'AEST', 'AEDT']],
  ['Melbourne', 'Australia', 'Australia/Melbourne', -37.81, ['MEL']],
  ['Brisbane', 'Australia', 'Australia/Brisbane', -27.47, ['BNE']],
  ['Perth', 'Australia', 'Australia/Perth', -31.95, ['PER', 'AWST']],
  ['Adelaide', 'Australia', 'Australia/Adelaide', -34.93, ['ADL']],
  ['Canberra', 'Australia', 'Australia/Sydney', -35.28],
  ['Hobart', 'Australia', 'Australia/Hobart', -42.88],
  ['Darwin', 'Australia', 'Australia/Darwin', -12.46],
  ['Auckland', 'New Zealand', 'Pacific/Auckland', -36.85, ['AKL', 'NZST']],
  ['Wellington', 'New Zealand', 'Pacific/Auckland', -41.29],
  ['Suva', 'Fiji', 'Pacific/Fiji', -18.14, ['Fiji']],
  ['Honolulu', 'United States', 'Pacific/Honolulu', 21.31, ['Hawaii', 'HNL']],

  // Asia
  ['Tokyo', 'Japan', 'Asia/Tokyo', 35.68, ['JST', 'NRT']],
  ['Osaka', 'Japan', 'Asia/Tokyo', 34.69],
  ['Seoul', 'South Korea', 'Asia/Seoul', 37.57, ['KST', 'ICN']],
  ['Shanghai', 'China', 'Asia/Shanghai', 31.23, ['PVG']],
  ['Beijing', 'China', 'Asia/Shanghai', 39.9, ['PEK']],
  ['Shenzhen', 'China', 'Asia/Shanghai', 22.54],
  ['Hong Kong', 'Hong Kong', 'Asia/Hong_Kong', 22.32, ['HKG']],
  ['Taipei', 'Taiwan', 'Asia/Taipei', 25.03, ['TPE']],
  ['Singapore', 'Singapore', 'Asia/Singapore', 1.35, ['SGT', 'SIN']],
  ['Kuala Lumpur', 'Malaysia', 'Asia/Kuala_Lumpur', 3.14, ['KUL']],
  ['Jakarta', 'Indonesia', 'Asia/Jakarta', -6.21, ['CGK']],
  ['Manila', 'Philippines', 'Asia/Manila', 14.6, ['MNL']],
  ['Bangkok', 'Thailand', 'Asia/Bangkok', 13.76, ['BKK']],
  ['Ho Chi Minh City', 'Vietnam', 'Asia/Ho_Chi_Minh', 10.82, ['Saigon', 'SGN']],
  ['Hanoi', 'Vietnam', 'Asia/Ho_Chi_Minh', 21.03],
  ['Mumbai', 'India', 'Asia/Kolkata', 19.08, ['Bombay', 'IST', 'BOM']],
  ['Bengaluru', 'India', 'Asia/Kolkata', 12.97, ['Bangalore', 'BLR']],
  ['Delhi', 'India', 'Asia/Kolkata', 28.61, ['New Delhi', 'DEL']],
  ['Hyderabad', 'India', 'Asia/Kolkata', 17.39, ['HYD']],
  ['Chennai', 'India', 'Asia/Kolkata', 13.08, ['Madras', 'MAA']],
  ['Pune', 'India', 'Asia/Kolkata', 18.52],
  ['Colombo', 'Sri Lanka', 'Asia/Colombo', 6.93],
  ['Kathmandu', 'Nepal', 'Asia/Kathmandu', 27.72],
  ['Dhaka', 'Bangladesh', 'Asia/Dhaka', 23.81],
  ['Karachi', 'Pakistan', 'Asia/Karachi', 24.86],
  ['Lahore', 'Pakistan', 'Asia/Karachi', 31.55],
  ['Dubai', 'United Arab Emirates', 'Asia/Dubai', 25.2, ['DXB', 'GST']],
  ['Abu Dhabi', 'United Arab Emirates', 'Asia/Dubai', 24.45],
  ['Riyadh', 'Saudi Arabia', 'Asia/Riyadh', 24.71],
  ['Doha', 'Qatar', 'Asia/Qatar', 25.29],
  ['Tel Aviv', 'Israel', 'Asia/Jerusalem', 32.09, ['TLV']],
  ['Jerusalem', 'Israel', 'Asia/Jerusalem', 31.78],
  ['Istanbul', 'Türkiye', 'Europe/Istanbul', 41.01, ['IST']],
  ['Tashkent', 'Uzbekistan', 'Asia/Tashkent', 41.3],
  ['Almaty', 'Kazakhstan', 'Asia/Almaty', 43.24],

  // Europe
  ['London', 'United Kingdom', 'Europe/London', 51.51, ['GMT', 'BST', 'LHR']],
  ['Manchester', 'United Kingdom', 'Europe/London', 53.48],
  ['Edinburgh', 'United Kingdom', 'Europe/London', 55.95],
  ['Dublin', 'Ireland', 'Europe/Dublin', 53.35, ['DUB']],
  ['Lisbon', 'Portugal', 'Europe/Lisbon', 38.72, ['LIS']],
  ['Madrid', 'Spain', 'Europe/Madrid', 40.42, ['MAD']],
  ['Barcelona', 'Spain', 'Europe/Madrid', 41.39, ['BCN']],
  ['Paris', 'France', 'Europe/Paris', 48.86, ['CET', 'CEST', 'CDG']],
  ['Amsterdam', 'Netherlands', 'Europe/Amsterdam', 52.37, ['AMS']],
  ['Brussels', 'Belgium', 'Europe/Brussels', 50.85, ['BRU']],
  ['Berlin', 'Germany', 'Europe/Berlin', 52.52, ['BER']],
  ['Munich', 'Germany', 'Europe/Berlin', 48.14, ['MUC']],
  ['Frankfurt', 'Germany', 'Europe/Berlin', 50.11, ['FRA']],
  ['Zurich', 'Switzerland', 'Europe/Zurich', 47.38, ['ZRH']],
  ['Geneva', 'Switzerland', 'Europe/Zurich', 46.2],
  ['Vienna', 'Austria', 'Europe/Vienna', 48.21, ['VIE']],
  ['Milan', 'Italy', 'Europe/Rome', 45.46, ['MXP']],
  ['Rome', 'Italy', 'Europe/Rome', 41.9, ['FCO']],
  ['Copenhagen', 'Denmark', 'Europe/Copenhagen', 55.68, ['CPH']],
  ['Stockholm', 'Sweden', 'Europe/Stockholm', 59.33, ['ARN']],
  ['Oslo', 'Norway', 'Europe/Oslo', 59.91, ['OSL']],
  ['Helsinki', 'Finland', 'Europe/Helsinki', 60.17, ['HEL', 'EET']],
  ['Warsaw', 'Poland', 'Europe/Warsaw', 52.23, ['WAW']],
  ['Prague', 'Czechia', 'Europe/Prague', 50.08, ['PRG']],
  ['Budapest', 'Hungary', 'Europe/Budapest', 47.5, ['BUD']],
  ['Bucharest', 'Romania', 'Europe/Bucharest', 44.43],
  ['Athens', 'Greece', 'Europe/Athens', 37.98, ['ATH']],
  ['Kyiv', 'Ukraine', 'Europe/Kyiv', 50.45, ['Kiev']],
  ['Reykjavik', 'Iceland', 'Atlantic/Reykjavik', 64.15],

  // Africa
  ['Cairo', 'Egypt', 'Africa/Cairo', 30.04, ['CAI']],
  ['Lagos', 'Nigeria', 'Africa/Lagos', 6.52, ['LOS']],
  ['Accra', 'Ghana', 'Africa/Accra', 5.6],
  ['Nairobi', 'Kenya', 'Africa/Nairobi', -1.29, ['NBO']],
  ['Johannesburg', 'South Africa', 'Africa/Johannesburg', -26.2, ['JNB', 'SAST']],
  ['Cape Town', 'South Africa', 'Africa/Johannesburg', -33.92, ['CPT']],
  ['Casablanca', 'Morocco', 'Africa/Casablanca', 33.57],
  ['Addis Ababa', 'Ethiopia', 'Africa/Addis_Ababa', 9.03],

  // Americas
  ['New York', 'United States', 'America/New_York', 40.71, ['NYC', 'EST', 'EDT', 'JFK']],
  ['Boston', 'United States', 'America/New_York', 42.36, ['BOS']],
  ['Washington DC', 'United States', 'America/New_York', 38.91, ['DCA']],
  ['Atlanta', 'United States', 'America/New_York', 33.75, ['ATL']],
  ['Miami', 'United States', 'America/New_York', 25.76, ['MIA']],
  ['Toronto', 'Canada', 'America/Toronto', 43.65, ['YYZ']],
  ['Montreal', 'Canada', 'America/Toronto', 45.5, ['YUL']],
  ['Chicago', 'United States', 'America/Chicago', 41.88, ['CST', 'CDT', 'ORD']],
  ['Austin', 'United States', 'America/Chicago', 30.27, ['AUS']],
  ['Dallas', 'United States', 'America/Chicago', 32.78, ['DFW']],
  ['Houston', 'United States', 'America/Chicago', 29.76, ['IAH']],
  ['Mexico City', 'Mexico', 'America/Mexico_City', 19.43, ['MEX']],
  ['Denver', 'United States', 'America/Denver', 39.74, ['MST', 'MDT', 'DEN']],
  ['Phoenix', 'United States', 'America/Phoenix', 33.45, ['PHX']],
  ['Los Angeles', 'United States', 'America/Los_Angeles', 34.05, ['LA', 'PST', 'PDT', 'LAX']],
  ['San Francisco', 'United States', 'America/Los_Angeles', 37.77, ['SF', 'SFO', 'Bay Area']],
  ['Seattle', 'United States', 'America/Los_Angeles', 47.61, ['SEA']],
  ['Vancouver', 'Canada', 'America/Vancouver', 49.28, ['YVR']],
  ['Anchorage', 'United States', 'America/Anchorage', 61.22],
  ['São Paulo', 'Brazil', 'America/Sao_Paulo', -23.55, ['Sao Paulo', 'GRU', 'BRT']],
  ['Rio de Janeiro', 'Brazil', 'America/Sao_Paulo', -22.91, ['Rio', 'GIG']],
  ['Buenos Aires', 'Argentina', 'America/Argentina/Buenos_Aires', -34.6, ['EZE']],
  ['Santiago', 'Chile', 'America/Santiago', -33.45, ['SCL']],
  ['Lima', 'Peru', 'America/Lima', -12.05],
  ['Bogotá', 'Colombia', 'America/Bogota', 4.71, ['Bogota', 'BOG']],
  ['Panama City', 'Panama', 'America/Panama', 8.98],
  ['San José', 'Costa Rica', 'America/Costa_Rica', 9.93, ['San Jose']],

  // Reference
  ['UTC', 'Coordinated Universal Time', 'UTC', 0, ['GMT', 'Zulu']],
];

/**
 * The cities that get pairwise comparison pages.
 *
 * Chosen as the ends of routes people actually schedule across: the big
 * financial centres, the outsourcing hubs, and the Australian and New Zealand
 * cities that make the hemisphere problem visible. Kept as a name list rather
 * than a flag on every row so the choice is reviewable in one place.
 */
const HUB_NAMES = new Set([
  // Oceania — the hemisphere problem is only visible with these in the set.
  'Sydney',
  'Melbourne',
  'Perth',
  'Brisbane',
  'Auckland',
  // Asia
  'Tokyo',
  'Singapore',
  'Hong Kong',
  'Shanghai',
  'Seoul',
  'Mumbai',
  'Bengaluru',
  'Dubai',
  'Manila',
  // Europe
  'London',
  'Dublin',
  'Paris',
  'Berlin',
  'Amsterdam',
  'Madrid',
  'Istanbul',
  // Americas
  'New York',
  'Chicago',
  'Denver',
  'Los Angeles',
  'San Francisco',
  'Toronto',
  'Vancouver',
  'Mexico City',
  'São Paulo',
  // Africa
  'Johannesburg',
  'Lagos',
  // Reference
  'UTC',
]);

export const CITIES: City[] = ROWS.map(([name, country, timeZone, lat, aliases]) => ({
  name,
  country,
  timeZone,
  lat,
  ...(aliases ? { aliases } : {}),
  slug: toSlug(name),
  isHub: HUB_NAMES.has(name),
}));

/**
 * URL-safe segment: strip diacritics, drop anything that is not a letter or
 * digit, collapse to single hyphens.
 */
export function toSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Two cities sharing a slug would silently fight over one URL, and whichever
// lost would 404 for real search traffic. Fail the build instead.
{
  const seen = new Map<string, string>();
  for (const city of CITIES) {
    const clash = seen.get(city.slug);
    if (clash) {
      throw new Error(`Duplicate city slug "${city.slug}": ${clash} and ${city.name}`);
    }
    seen.set(city.slug, city.name);
  }
  const missing = [...HUB_NAMES].filter((n) => !CITIES.some((c) => c.name === n));
  if (missing.length > 0) {
    throw new Error(`HUB_NAMES refers to unknown cities: ${missing.join(', ')}`);
  }

  // share.ts separates participant fields with hyphens, so a zone containing one
  // would not survive a round trip. No zone here has one, but the IANA database
  // does contain such ids (America/Port-au-Prince), and adding one later would
  // otherwise silently produce broken links from the generated city pages.
  const hyphenated = CITIES.filter((c) => c.timeZone.includes('-')).map((c) => c.timeZone);
  if (hyphenated.length > 0) {
    throw new Error(
      `Time zones containing a hyphen cannot be encoded in a share link: ${hyphenated.join(', ')}`,
    );
  }
}

/** Cities that get pairwise comparison pages, in dataset order. */
export const HUBS: City[] = CITIES.filter((c) => c.isHub);

/**
 * The cities every city page is compared against, in table form.
 *
 * A short fixed list rather than "all hubs", because a table of thirty rows is
 * a wall of numbers nobody reads. These are the ones a reader is most likely to
 * be converting to.
 */
export const COMPARISON_NAMES = [
  'London',
  'New York',
  'Los Angeles',
  'Chicago',
  'Toronto',
  'Paris',
  'Berlin',
  'Dubai',
  'Mumbai',
  'Singapore',
  'Hong Kong',
  'Tokyo',
  'Sydney',
  'Auckland',
  'São Paulo',
  'UTC',
] as const;

export const COMPARISON_CITIES: City[] = COMPARISON_NAMES.map((n) => {
  const city = CITIES.find((c) => c.name === n);
  if (!city) throw new Error(`COMPARISON_NAMES refers to unknown city: ${n}`);
  return city;
});

/**
 * Ordered hub pairs worth generating a page for.
 *
 * Pairs whose gap never changes and is always zero are skipped: "Berlin and
 * Paris are always the same time" is a true sentence but not a page, and a few
 * hundred of them would look exactly like the doorway pages search engines
 * discount.
 */
export function hubPairs(): Array<[City, City]> {
  const pairs: Array<[City, City]> = [];
  for (let i = 0; i < HUBS.length; i += 1) {
    for (let j = i + 1; j < HUBS.length; j += 1) {
      if (HUBS[i].timeZone === HUBS[j].timeZone) continue;
      pairs.push([HUBS[i], HUBS[j]]);
    }
  }
  return pairs;
}

const BY_SLUG = new Map(CITIES.map((c) => [c.slug, c]));

export function cityBySlug(slug: string): City | undefined {
  return BY_SLUG.get(slug);
}

/** Other cities on the same UTC offset right now, for "see also" links. */
export function citiesSharingZone(city: City): City[] {
  return CITIES.filter((c) => c.timeZone === city.timeZone && c.slug !== city.slug);
}

/** Case- and accent-insensitive search over names, aliases and countries. */
export function searchCities(query: string, limit = 8): City[] {
  const q = normalise(query);
  if (q.length === 0) return [];

  const scored: Array<{ city: City; score: number }> = [];

  for (const city of CITIES) {
    const name = normalise(city.name);
    const country = normalise(city.country);
    const aliases = (city.aliases ?? []).map(normalise);

    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (aliases.some((a) => a === q)) score = 1;
    else if (aliases.some((a) => a.startsWith(q))) score = 2;
    else if (name.includes(q)) score = 3;
    else if (country.startsWith(q)) score = 4;
    else if (country.includes(q)) score = 5;

    if (score >= 0) scored.push({ city, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.city.name.localeCompare(b.city.name))
    .slice(0, limit)
    .map((s) => s.city);
}

/** Strip diacritics so "sao paulo" finds "São Paulo". */
function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function cityForTimeZone(timeZone: string): City | undefined {
  return CITIES.find((c) => c.timeZone === timeZone);
}

export function cityByName(name: string): City | undefined {
  const n = normalise(name);
  return CITIES.find((c) => normalise(c.name) === n);
}

/** Fall back to the last path segment of the zone id, e.g. `Asia/Muscat` -> `Muscat`. */
export function labelForTimeZone(timeZone: string): string {
  return cityForTimeZone(timeZone)?.name ?? timeZone.split('/').pop()!.replace(/_/g, ' ');
}

/**
 * Best-effort latitude for a zone when we only know the label.
 *
 * Returns `undefined` rather than guessing zero, so callers can fall back to a
 * clock-hour heuristic instead of confidently drawing an equatorial sky over
 * Helsinki.
 */
export function latitudeFor(timeZone: string, label?: string): number | undefined {
  if (label) {
    const byName = cityByName(label);
    if (byName && byName.timeZone === timeZone) return byName.lat;
  }
  return cityForTimeZone(timeZone)?.lat;
}
