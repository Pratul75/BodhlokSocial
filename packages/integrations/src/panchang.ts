/**
 * Daily Panchang for Indian cities: tithi, nakshatra, yoga, karana and vara at sunrise, with
 * the time each one ends, plus sunrise, sunset, Rahu Kaal, Yamaganda, Gulika and Abhijit.
 * Positions come from astronomy-engine (true ecliptic of date); sidereal longitudes use the
 * Lahiri ayanamsa. Times are IST. Accuracy is about a minute, so the pages say "about".
 */
import { Body, EclipticGeoMoon, Observer, SearchRiseSet, SunPosition } from "astronomy-engine";

export const TITHIS = [
  "Pratipada", "Dwitiya", "Tritiya", "Chaturthi", "Panchami", "Shashthi", "Saptami", "Ashtami", "Navami", "Dashami",
  "Ekadashi", "Dwadashi", "Trayodashi", "Chaturdashi", "Purnima",
  "Pratipada", "Dwitiya", "Tritiya", "Chaturthi", "Panchami", "Shashthi", "Saptami", "Ashtami", "Navami", "Dashami",
  "Ekadashi", "Dwadashi", "Trayodashi", "Chaturdashi", "Amavasya",
];
export const NAKSHATRAS = [
  "Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra", "Punarvasu", "Pushya", "Ashlesha",
  "Magha", "Purva Phalguni", "Uttara Phalguni", "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha", "Jyeshtha",
  "Mula", "Purva Ashadha", "Uttara Ashadha", "Shravana", "Dhanishta", "Shatabhisha", "Purva Bhadrapada", "Uttara Bhadrapada", "Revati",
];
export const YOGAS = [
  "Vishkambha", "Priti", "Ayushman", "Saubhagya", "Shobhana", "Atiganda", "Sukarma", "Dhriti", "Shula",
  "Ganda", "Vriddhi", "Dhruva", "Vyaghata", "Harshana", "Vajra", "Siddhi", "Vyatipata", "Variyana",
  "Parigha", "Shiva", "Siddha", "Sadhya", "Shubha", "Shukla", "Brahma", "Indra", "Vaidhriti",
];
const MOVABLE_KARANAS = ["Bava", "Balava", "Kaulava", "Taitila", "Garaja", "Vanija", "Vishti"];
export const RASHIS = ["Mesha", "Vrishabha", "Mithuna", "Karka", "Simha", "Kanya", "Tula", "Vrishchika", "Dhanu", "Makara", "Kumbha", "Meena"];
export const VARAS = ["Ravivara (Sunday)", "Somavara (Monday)", "Mangalavara (Tuesday)", "Budhavara (Wednesday)", "Guruvara (Thursday)", "Shukravara (Friday)", "Shanivara (Saturday)"];

/** Which eighth of the daytime each period takes, by weekday (Sunday first), 1-based. */
const RAHU_KAAL = [8, 2, 7, 5, 6, 4, 3];
const YAMAGANDA = [5, 4, 3, 2, 1, 7, 6];
const GULIKA = [7, 6, 5, 4, 3, 2, 1];

export interface City {
  slug: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
}

export const CITIES: City[] = [
  { slug: "delhi", name: "Delhi", state: "Delhi", lat: 28.6139, lon: 77.209 },
  { slug: "mumbai", name: "Mumbai", state: "Maharashtra", lat: 19.076, lon: 72.8777 },
  { slug: "bengaluru", name: "Bengaluru", state: "Karnataka", lat: 12.9716, lon: 77.5946 },
  { slug: "kolkata", name: "Kolkata", state: "West Bengal", lat: 22.5726, lon: 88.3639 },
  { slug: "chennai", name: "Chennai", state: "Tamil Nadu", lat: 13.0827, lon: 80.2707 },
  { slug: "hyderabad", name: "Hyderabad", state: "Telangana", lat: 17.385, lon: 78.4867 },
  { slug: "pune", name: "Pune", state: "Maharashtra", lat: 18.5204, lon: 73.8567 },
  { slug: "ahmedabad", name: "Ahmedabad", state: "Gujarat", lat: 23.0225, lon: 72.5714 },
  { slug: "jaipur", name: "Jaipur", state: "Rajasthan", lat: 26.9124, lon: 75.7873 },
  { slug: "lucknow", name: "Lucknow", state: "Uttar Pradesh", lat: 26.8467, lon: 80.9462 },
  { slug: "indore", name: "Indore", state: "Madhya Pradesh", lat: 22.7196, lon: 75.8577 },
  { slug: "bhopal", name: "Bhopal", state: "Madhya Pradesh", lat: 23.2599, lon: 77.4126 },
  { slug: "varanasi", name: "Varanasi", state: "Uttar Pradesh", lat: 25.3176, lon: 82.9739 },
  { slug: "patna", name: "Patna", state: "Bihar", lat: 25.5941, lon: 85.1376 },
  { slug: "chandigarh", name: "Chandigarh", state: "Chandigarh", lat: 30.7333, lon: 76.7794 },
  { slug: "surat", name: "Surat", state: "Gujarat", lat: 21.1702, lon: 72.8311 },
  { slug: "nagpur", name: "Nagpur", state: "Maharashtra", lat: 21.1458, lon: 79.0882 },
  { slug: "kochi", name: "Kochi", state: "Kerala", lat: 9.9312, lon: 76.2673 },
  { slug: "bhubaneswar", name: "Bhubaneswar", state: "Odisha", lat: 20.2961, lon: 85.8245 },
  { slug: "guwahati", name: "Guwahati", state: "Assam", lat: 26.1445, lon: 91.7362 },
  { slug: "ujjain", name: "Ujjain", state: "Madhya Pradesh", lat: 23.1765, lon: 75.7885 },
  { slug: "haridwar", name: "Haridwar", state: "Uttarakhand", lat: 29.9457, lon: 78.1642 },
  { slug: "dehradun", name: "Dehradun", state: "Uttarakhand", lat: 30.3165, lon: 78.0322 },
  { slug: "visakhapatnam", name: "Visakhapatnam", state: "Andhra Pradesh", lat: 17.6868, lon: 83.2185 },
  { slug: "coimbatore", name: "Coimbatore", state: "Tamil Nadu", lat: 11.0168, lon: 76.9558 },
];

const IST_MS = 330 * 60_000;
const norm = (d: number) => ((d % 360) + 360) % 360;

/** Lahiri (Chitrapaksha) ayanamsa in degrees: 23.857° at J2000, precessing about 50.29" a year. */
export function lahiriAyanamsa(t: Date): number {
  const years = (t.getTime() - Date.UTC(2000, 0, 1, 12)) / (365.25 * 86_400_000);
  return 23.857092 + (50.2910 * years + 0.000111 * years * years) / 3600;
}

export interface Positions {
  sunSidereal: number;
  moonSidereal: number;
  /** Moon minus Sun, 0 to 360: the basis of tithi and karana. */
  elongation: number;
}

export function positions(t: Date): Positions {
  const sun = SunPosition(t).elon;
  const moon = EclipticGeoMoon(t).lon;
  const ay = lahiriAyanamsa(t);
  return { sunSidereal: norm(sun - ay), moonSidereal: norm(moon - ay), elongation: norm(moon - sun) };
}

const SPAN = 360 / 27;
export const tithiIndex = (p: Positions) => Math.floor(p.elongation / 12);
export const nakshatraIndex = (p: Positions) => Math.floor(p.moonSidereal / SPAN);
export const yogaIndex = (p: Positions) => Math.floor(norm(p.sunSidereal + p.moonSidereal) / SPAN);
export const karanaIndex = (p: Positions) => Math.floor(p.elongation / 6);

export function karanaName(k: number): string {
  if (k === 0) return "Kimstughna";
  if (k >= 57) return ["Shakuni", "Chatushpada", "Naga"][k - 57]!;
  return MOVABLE_KARANAS[(k - 1) % 7]!;
}

/** When the given index next changes after t (searching up to 40 hours), to within 30 seconds. */
export function nextChange(t: Date, index: (p: Positions) => number): Date | null {
  const start = index(positions(t));
  let lo = t.getTime();
  let hi = lo;
  for (let h = 1; h <= 40; h++) {
    hi = t.getTime() + h * 3_600_000;
    if (index(positions(new Date(hi))) !== start) break;
    lo = hi;
    if (h === 40) return null;
  }
  while (hi - lo > 30_000) {
    const mid = (lo + hi) / 2;
    if (index(positions(new Date(mid))) === start) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

export interface Element {
  name: string;
  /** When it ends, as an ISO time; null if it runs past the next sunrise search window. */
  endsAt: string | null;
}

export interface Panchang {
  date: string;
  city: City;
  vara: string;
  sunrise: string;
  sunset: string;
  tithi: Element & { paksha: "Shukla" | "Krishna"; number: number };
  nakshatra: Element;
  yoga: Element;
  karana: Element;
  moonRashi: string;
  sunRashi: string;
  rahuKaal: { start: string; end: string };
  yamaganda: { start: string; end: string };
  gulika: { start: string; end: string };
  abhijit: { start: string; end: string } | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** HH:MM in IST, for page copy. */
export const istTime = (isoTime: string | null) => (isoTime ? new Date(new Date(isoTime).getTime() + IST_MS).toISOString().slice(11, 16) : "—");

export function panchang(date: string, city: City): Panchang {
  const observer = new Observer(city.lat, city.lon, 0);
  const midnightIst = new Date(new Date(`${date}T00:00:00Z`).getTime() - IST_MS);
  const rise = SearchRiseSet(Body.Sun, observer, +1, midnightIst, 1);
  const set = SearchRiseSet(Body.Sun, observer, -1, midnightIst, 1);
  if (!rise || !set) throw new Error(`No sunrise or sunset for ${city.name} on ${date}`);
  const sunrise = rise.date;
  const sunset = set.date;
  const p = positions(sunrise);
  const t = tithiIndex(p);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();

  const day = sunset.getTime() - sunrise.getTime();
  const eighth = (n: number) => ({ start: new Date(sunrise.getTime() + ((n - 1) * day) / 8).toISOString(), end: new Date(sunrise.getTime() + (n * day) / 8).toISOString() });
  const muhurta = day / 15;
  // Abhijit is the eighth of fifteen daytime muhurtas; tradition skips it on Wednesdays.
  const abhijit = weekday === 3 ? null : { start: new Date(sunrise.getTime() + 7 * muhurta).toISOString(), end: new Date(sunrise.getTime() + 8 * muhurta).toISOString() };

  return {
    date,
    city,
    vara: VARAS[weekday]!,
    sunrise: sunrise.toISOString(),
    sunset: sunset.toISOString(),
    tithi: { name: TITHIS[t]!, number: t + 1, paksha: t < 15 ? "Shukla" : "Krishna", endsAt: iso(nextChange(sunrise, tithiIndex)) },
    nakshatra: { name: NAKSHATRAS[nakshatraIndex(p)]!, endsAt: iso(nextChange(sunrise, nakshatraIndex)) },
    yoga: { name: YOGAS[yogaIndex(p)]!, endsAt: iso(nextChange(sunrise, yogaIndex)) },
    karana: { name: karanaName(karanaIndex(p)), endsAt: iso(nextChange(sunrise, karanaIndex)) },
    moonRashi: RASHIS[Math.floor(p.moonSidereal / 30)]!,
    sunRashi: RASHIS[Math.floor(p.sunSidereal / 30)]!,
    rahuKaal: eighth(RAHU_KAAL[weekday]!),
    yamaganda: eighth(YAMAGANDA[weekday]!),
    gulika: eighth(GULIKA[weekday]!),
    abhijit,
  };
}

/** Today in India, as YYYY-MM-DD. */
export const istToday = (now = new Date()) => new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);
