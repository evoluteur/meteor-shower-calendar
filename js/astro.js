// Meteor Shower Calendar -- the astronomy, computed in the browser.
//
// The Sun and the Moon: the low-precision Sun of Jean Meeus's "Astronomical
// Algorithms" (chapter 25) and the main terms of the Moon (chapter 47), the
// same as in Eclipse Calendar. A shower peaks when the Earth reaches the same
// point of its orbit, the same solar longitude, every year: the date of the
// peak is found from the Sun.
// https://github.com/evoluteur/meteor-shower-calendar
// (c) 2026 Olivier Giulieri

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const sind = (d) => Math.sin(d * D2R);
const cosd = (d) => Math.cos(d * D2R);
const norm360 = (d) => ((d % 360) + 360) % 360;

// ---------------------------------------------------------------- time

const jdFromDate = (date) => date.getTime() / 86400000 + 2440587.5;
const dateFromJd = (jd) => new Date(Math.round((jd - 2440587.5) * 86400000));

// Delta T (TT - UT, seconds): Espenak & Meeus polynomials, 1900 to 2150
function deltaT(year) {
  let t;
  if (year < 1920) {
    t = year - 1900;
    return -2.79 + 1.494119 * t - 0.0598939 * t * t + 0.0061966 * t ** 3 - 0.000197 * t ** 4;
  }
  if (year < 1941) {
    t = year - 1920;
    return 21.2 + 0.84493 * t - 0.0761 * t * t + 0.0020936 * t ** 3;
  }
  if (year < 1961) {
    t = year - 1950;
    return 29.07 + 0.407 * t - (t * t) / 233 + t ** 3 / 2547;
  }
  if (year < 1986) {
    t = year - 1975;
    return 45.45 + 1.067 * t - (t * t) / 260 - t ** 3 / 718;
  }
  if (year < 2005) {
    t = year - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t * t + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5;
  }
  if (year < 2050) {
    t = year - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t * t;
  }
  const u = (year - 1820) / 100;
  return -20 + 32 * u * u - 0.5628 * (2150 - year);
}

// ---------------------------------------------------------------- Sun and Moon

// apparent geocentric ecliptic longitude and distance of the Sun (Meeus 25)
function sunPos(jde) {
  const T = (jde - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const e = 0.016708634 - 0.000042037 * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sind(M) + (0.019993 - 0.000101 * T) * sind(2 * M) + 0.000289 * sind(3 * M);
  const v = M + C;
  const R = (1.000001018 * (1 - e * e)) / (1 + e * cosd(v));
  const om = 125.04 - 1934.136 * T;
  const lon = norm360(L0 + C - 0.00569 - 0.00478 * sind(om));
  return { lon, lat: 0, dist: R * 149597870.7 };
}

// the main periodic terms of the Moon (Meeus table 47.A and 47.B):
// [D, M, M', F, coefficient] -- longitude and distance, then latitude
const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003], [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884], [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0], [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958], [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258], [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354], [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0], [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739], [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421], [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0], [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0], [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];
const MOON_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463], [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
];

// apparent geocentric ecliptic position of the Moon (Meeus 47)
function moonPos(jde) {
  const T = (jde - 2451545) / 36525;
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + (T * T * T) / 538841;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + (T * T * T) / 545868;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + (T * T * T) / 69699;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T * T - (T * T * T) / 3526000;
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.29 * T, A3 = 313.45 + 481266.484 * T;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, cl, cr] of MOON_LR) {
    const a = d * D + m * M + mp * Mp + f * F;
    const k = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sl += cl * k * sind(a);
    sr += cr * k * cosd(a);
  }
  for (const [d, m, mp, f, cb] of MOON_B) {
    const k = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sb += cb * k * sind(d * D + m * M + mp * Mp + f * F);
  }
  sl += 3958 * sind(A1) + 1962 * sind(Lp - F) + 318 * sind(A2);
  sb += -2235 * sind(Lp) + 382 * sind(A3) + 175 * sind(A1 - F) + 175 * sind(A1 + F) + 127 * sind(Lp - Mp) - 115 * sind(Lp + Mp);
  const om = 125.04 - 1934.136 * T;
  return {
    lon: norm360(Lp + sl / 1e6 - 0.00478 * sind(om)), // + nutation in longitude
    lat: sb / 1e6,
    dist: 385000.56 + sr / 1000,
  };
}

const obliquity = (jde) => {
  const T = (jde - 2451545) / 36525;
  return 23.4392911 - 0.0130042 * T + 0.00256 * cosd(125.04 - 1934.136 * T);
};

// Greenwich mean sidereal time (degrees) for a UT Julian day
const gmst = (jdUT) => {
  const T = (jdUT - 2451545) / 36525;
  return norm360(280.46061837 + 360.98564736629 * (jdUT - 2451545) + 0.000387933 * T * T);
};

// ecliptic (lon, lat, dist) -> geocentric vector in the Earth-fixed frame
// (x toward lon 0 on the equator, z toward the north pole), in km
function earthFixed(p, jde, jdUT) {
  const eps = obliquity(jde);
  const cl = cosd(p.lon), sl = sind(p.lon), cb = cosd(p.lat), sb = sind(p.lat);
  // ecliptic -> equatorial
  const x = cb * cl;
  const y = cb * sl * cosd(eps) - sb * sind(eps);
  const z = cb * sl * sind(eps) + sb * cosd(eps);
  // equatorial -> Earth-fixed: rotate by the sidereal time
  const g = gmst(jdUT);
  return [p.dist * (x * cosd(g) + y * sind(g)), p.dist * (-x * sind(g) + y * cosd(g)), p.dist * z];
}

const RE = 6378.137; // Earth radius (km)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const toLatLon = (v) => ({ lat: Math.asin(v[2] / len(v)) * R2D, lon: ((Math.atan2(v[1], v[0]) * R2D + 540) % 360) - 180 });
const fromLatLon = (lat, lon, r = RE) => [r * cosd(lat) * cosd(lon), r * cosd(lat) * sind(lon), r * sind(lat)];

// altitude (degrees) of a body at jd (UT) seen from lat, lon
function altitude(body, jdUT, lat, lon) {
  const jde = jdUT + deltaT(2000 + (jdUT - 2451545) / 365.25) / 86400;
  const v = earthFixed(body === "sun" ? sunPos(jde) : moonPos(jde), jde, jdUT);
  const obs = fromLatLon(lat, lon);
  const d = sub(v, obs);
  return Math.asin(dot(d, obs) / (len(d) * RE)) * R2D;
}


// ---------------------------------------------------------------- showers

// the date (UT) when the Sun reaches the ecliptic longitude lon, near jd0
function solarLongitudeDate(lon, jd0) {
  let jd = jd0;
  for (let i = 0; i < 6; i++) {
    const d = ((lon - sunPos(jd).lon + 540) % 360) - 180; // degrees to go
    jd += d / 0.98564736; // the Sun moves about 0.9856 degree a day
  }
  return jd - deltaT(2000 + (jd - 2451545) / 365.25) / 86400; // TT -> UT
}

// right ascension and declination (degrees) of a point of the ecliptic
function eclToEq(p, jde) {
  const eps = obliquity(jde);
  const cl = cosd(p.lon), sl = sind(p.lon), cb = cosd(p.lat), sb = sind(p.lat);
  const x = cb * cl;
  const y = cb * sl * cosd(eps) - sb * sind(eps);
  const z = cb * sl * sind(eps) + sb * cosd(eps);
  return { ra: norm360(Math.atan2(y, x) * R2D), dec: Math.asin(z) * R2D };
}

// altitude and azimuth (degrees, azimuth from north through east) of a point
// of the sky (ra, dec) at jd (UT), seen from lat, lon
function altAz(ra, dec, jdUT, lat, lon) {
  const H = gmst(jdUT) + lon - ra; // hour angle
  const sa = sind(lat) * sind(dec) + cosd(lat) * cosd(dec) * cosd(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sa))) * R2D;
  const az = Math.atan2(-cosd(dec) * sind(H), cosd(lat) * sind(dec) - sind(lat) * cosd(dec) * cosd(H)) * R2D;
  return { alt, az: norm360(az) };
}

// the lit part of the Moon (0 to 1), and whether it is waxing
function moonIllum(jdUT) {
  const jde = jdUT + deltaT(2000 + (jdUT - 2451545) / 365.25) / 86400;
  const s = sunPos(jde), m = moonPos(jde);
  const e = norm360(m.lon - s.lon); // elongation along the ecliptic
  const cosE = cosd(m.lat) * cosd(e);
  return { k: (1 - cosE) / 2, waxing: e < 180, elong: e };
}

// the phases of the Moon (new, first quarter, full, last quarter) between two
// dates: Meeus chapter 49, by refining the time the elongation crosses 0, 90...
function moonPhases(jdFrom, jdTo) {
  const out = [];
  const step = 0.5;
  let prev = moonIllum(jdFrom).elong;
  for (let jd = jdFrom + step; jd <= jdTo; jd += step) {
    const cur = moonIllum(jd).elong;
    for (let q = 0; q < 4; q++) {
      const a = q * 90;
      const d0 = ((prev - a + 540) % 360) - 180, d1 = ((cur - a + 540) % 360) - 180;
      if (d0 < 0 && d1 >= 0) {
        // refine by bisection
        let lo = jd - step, hi = jd;
        for (let i = 0; i < 25; i++) {
          const mid = (lo + hi) / 2;
          const dm = ((moonIllum(mid).elong - a + 540) % 360) - 180;
          if (dm < 0) lo = mid;
          else hi = mid;
        }
        out.push({ q, jd: (lo + hi) / 2 });
      }
    }
    prev = cur;
  }
  return out;
}

// right ascension and declination of the Moon and the Sun at jd (UT)
function bodyRaDec(body, jdUT) {
  const jde = jdUT + deltaT(2000 + (jdUT - 2451545) / 365.25) / 86400;
  return eclToEq(body === "sun" ? sunPos(jde) : moonPos(jde), jde);
}
