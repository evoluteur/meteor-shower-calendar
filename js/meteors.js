// Meteor Shower Calendar -- the page: the next shower, the year of showers
// as a timeline and cards, and for each one, from a chosen place, the night
// of the peak, the Moon, the best time and where to look.
// https://github.com/evoluteur/meteor-shower-calendar
// (c) 2026 Olivier Giulieri

const $m = (id) => document.getElementById(id);
const MIN_YEAR = 1900, MAX_YEAR = 2100;
const SKIES = {
  city: { name: "City", lm: 4.2, text: "a city sky, where only the brightest stars show" },
  suburbs: { name: "Suburbs", lm: 5.2, text: "a suburban sky, with the Milky Way hidden" },
  country: { name: "Countryside", lm: 6.0, text: "a country sky, with the Milky Way faint but there" },
  dark: { name: "Dark site", lm: 6.5, text: "a truly dark sky, far from any lights" },
};
let year = new Date().getFullYear();
let place = null;
let sky = "suburbs";

// ---------------------------------------------------------------- time zones

// minutes ahead of UT of the time zone tz at the instant t (ms)
const fmtParts = {};
function tzOffset(t, tz) {
  const f =
    fmtParts[tz] ||
    (fmtParts[tz] = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }));
  const p = {};
  for (const x of f.formatToParts(new Date(t))) p[x.type] = +x.value;
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - t) / 60000);
}
// the local date and hour in tz of the instant t
function localParts(t, tz) {
  const d = new Date(t + tzOffset(t, tz) * 60000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours() + d.getUTCMinutes() / 60 };
}
// the instant (ms) of a local date and hour in tz
function localToUT(y, m, d, h, tz) {
  const t = Date.UTC(y, m - 1, d) + h * 3600000;
  const t1 = t - tzOffset(t, tz) * 60000;
  return t - tzOffset(t1, tz) * 60000;
}

// ---------------------------------------------------------------- formatting

const fmtDay = (t, tz, opts = {}) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: tz, ...opts });
const fmtTime = (t, tz) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz });
const fmtHour = (t, tz) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", timeZone: tz });
const tzName = (t, tz) => {
  try {
    return new Date(t).toLocaleTimeString(undefined, { timeZone: tz, timeZoneName: "short" }).split(" ").pop();
  } catch (e) {
    return tz;
  }
};
const msFromJd = (jd) => (jd - 2440587.5) * 86400000;
const jdFromMs = (t) => t / 86400000 + 2440587.5;
const DIRS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
const dirName = (az) => DIRS[Math.round(az / 45) % 8];
const round = (x) => (x >= 10 ? Math.round(x) : x >= 1 ? Math.round(x) : x >= 0.5 ? 1 : 0);

// "Aug 12 to 13", or "Aug 31 to Sep 1"
function nightName(ev, tz) {
  const a = new Date(Date.UTC(ev.y, ev.m - 1, ev.d, 12));
  const b = new Date(a.getTime() + 864e5);
  const o = { timeZone: "UTC" };
  const m1 = a.toLocaleDateString(undefined, { month: "short", ...o });
  const m2 = b.toLocaleDateString(undefined, { month: "short", ...o });
  return m1 === m2 ? `${m1} ${a.getUTCDate()} to ${b.getUTCDate()}` : `${m1} ${a.getUTCDate()} to ${m2} ${b.getUTCDate()}`;
}

// ---------------------------------------------------------------- the showers

// the peak of a shower in a year (Julian day, UT)
function peakOf(s, y) {
  const jd0 = jdFromDate(new Date(Date.UTC(y, 2, 20))) + s.sl / 0.9856;
  let jd = solarLongitudeDate(s.sl, jd0);
  if (dateFromJd(jd).getUTCFullYear() > y) jd = solarLongitudeDate(s.sl, jd - 365.25);
  return jd;
}

// the days the shower is active around a peak (ms)
function activeRange(s, peakJd) {
  const py = dateFromJd(peakJd).getUTCFullYear();
  const pm = dateFromJd(peakJd).getUTCMonth() + 1;
  // the start month is after the peak month when the shower spans the new year
  const fy = s.from[0] > pm ? py - 1 : py;
  const ty = s.to[0] < pm ? py + 1 : py;
  return [Date.UTC(fy, s.from[0] - 1, s.from[1]), Date.UTC(ty, s.to[0] - 1, s.to[1], 23, 59)];
}

// ZHR at the time jd: falls off exponentially with the distance to the peak
function zhrAt(s, jd, peakJd, range) {
  const t = msFromJd(jd);
  if (t < range[0] || t > range[1]) return 0;
  const days = Math.abs(jd - peakJd) * 0.9856;
  return s.zhr * Math.exp(-days / s.b);
}

// the faintest stars seen with the Moon up: moonlight brightens the sky, more
// when the Moon is fuller and higher (a rough rule of thumb)
const limitingMag = (lm, moonAlt, k) => lm - 1.9 * k * Math.max(0, Math.min(1, (moonAlt + 2) / 25)) * Math.max(0.3, (lm - 3) / 3.5);

// a night, from the afternoon of the local date (y, m, d) to the next morning,
// every 10 minutes: the Sun, the Moon, the radiant and the meteors per hour
function nightOf(s, ev, peakJd, range) {
  const [, lat, lon, tz] = place;
  const lm = SKIES[sky].lm;
  const t0 = localToUT(ev.y, ev.m, ev.d, 17, tz);
  const pts = [];
  for (let i = 0; i <= 90; i++) {
    const t = t0 + i * 600000;
    const jd = jdFromMs(t);
    const sun = altitude("sun", jd, lat, lon);
    const moon = altitude("moon", jd, lat, lon);
    const { k } = moonIllum(jd);
    const rad = altAz(s.ra, s.dec, jd, lat, lon);
    const zhr = zhrAt(s, jd, peakJd, range);
    // twilight: no meteors with the Sun above -6 degrees, all of them below -16
    const dark = Math.max(0, Math.min(1, (-6 - sun) / 10));
    const sinh = Math.max(0, Math.sin(rad.alt * D2R));
    const lmMoon = limitingMag(lm, moon, k);
    const rate = zhr * sinh * dark * Math.pow(s.r, lmMoon - 6.5);
    const rateNoMoon = zhr * sinh * dark * Math.pow(s.r, lm - 6.5);
    pts.push({ t, sun, moon, k, rad, rate, rateNoMoon });
  }
  const best = pts.reduce((a, b) => (b.rate > a.rate ? b : a), pts[0]);
  const bestNoMoon = pts.reduce((a, b) => (b.rateNoMoon > a.rateNoMoon ? b : a), pts[0]);
  const total = pts.reduce((a, p) => a + p.rate / 6, 0);
  // events: dark, moonrise and moonset, radiant rising
  const cross = (key, lvl) => {
    const out = [];
    for (let i = 1; i < pts.length; i++) {
      const a = key(pts[i - 1]) - lvl, b = key(pts[i]) - lvl;
      if ((a < 0) !== (b < 0)) out.push({ t: pts[i - 1].t + (600000 * a) / (a - b), up: b > a });
    }
    return out;
  };
  const moonX = cross((p) => p.moon, 0);
  const darkX = cross((p) => -p.sun, 12);
  const radX = cross((p) => p.rad.alt, 0);
  const radMax = pts.reduce((a, b) => (b.rad.alt > a.rad.alt ? b : a), pts[0]);
  return { pts, best, bestNoMoon, total, moonX, darkX, radX, radMax };
}

// the night of the peak: of the two nights around it, the one with more
// meteors (a peak in the morning can be better seen the evening after)
function peakNight(s, peakJd, range) {
  const tz = place[3];
  const t = msFromJd(peakJd);
  const lp = localParts(t, tz);
  const before = localParts(localToUT(lp.y, lp.m, lp.d, 12, tz) - 864e5, tz);
  const nights = [before, lp].map((d) => {
    const ev = { y: d.y, m: d.m, d: d.d };
    return { ev, night: nightOf(s, ev, peakJd, range) };
  });
  const [a, b] = nights;
  return b.night.bestNoMoon.rateNoMoon > a.night.bestNoMoon.rateNoMoon * 1.05 ? b : a;
}

// all a shower's numbers for the chosen year and place
const cache = new Map();
function showerYear(s, y) {
  const key = [s.id, y, place[0], place[1], place[2], sky].join("|");
  if (cache.has(key)) return cache.get(key);
  const peakJd = peakOf(s, y);
  const range = activeRange(s, peakJd);
  const { ev, night } = peakNight(s, peakJd, range);
  const moonAtPeak = moonIllum(peakJd);
  const ratio = night.bestNoMoon.rateNoMoon > 0 ? night.best.rate / night.bestNoMoon.rateNoMoon : 1;
  const radUp = night.pts.some((p) => p.sun < -12 && p.rad.alt > 5);
  const quality = !radUp ? "none" : night.bestNoMoon.rateNoMoon < 0.5 ? "low" : ratio > 0.75 ? "good" : ratio > 0.45 ? "fair" : "poor";
  const r = { s, peakJd, peak: msFromJd(peakJd), range, ev, night, moonAtPeak, ratio, quality };
  cache.set(key, r);
  return r;
}

const QUALITY = {
  good: "Moon out of the way",
  fair: "Some moonlight",
  poor: "The Moon spoils it",
  low: "Too few meteors from here",
  none: "Not seen from here",
};

// ---------------------------------------------------------------- drawings

// the Moon with its lit part k (0 to 1), waxing (lit on the right) or not
function moonSvg(k, waxing, size = 22, cls = "") {
  const r = 9;
  const rx = Math.abs(1 - 2 * k) * r;
  const sweepLimb = waxing ? 1 : 0; // the bright limb: right when waxing
  const sweepTerm = k < 0.5 ? (waxing ? 0 : 1) : waxing ? 1 : 0;
  const path =
    k < 0.01
      ? ""
      : k > 0.99
        ? `<circle cx="10" cy="10" r="${r}" class="moon-lit" />`
        : `<path class="moon-lit" d="M10 1 A${r} ${r} 0 0 ${sweepLimb} 10 19 A${rx.toFixed(2)} ${r} 0 0 ${sweepTerm} 10 1 Z" />`;
  return `<svg class="plain moon-ico ${cls}" viewBox="0 0 20 20" width="${size}" height="${size}" style="width:${size}px;height:${size}px" aria-hidden="true"><circle cx="10" cy="10" r="${r}" class="moon-dark" />${path}</svg>`;
}

// the year: moon phases on top, then each shower's activity
function yearStrip(list) {
  const W = 1000, top = 34, lane = 30;
  const y0 = Date.UTC(year, 0, 1), y1 = Date.UTC(year + 1, 0, 1);
  const x = (t) => ((t - y0) / (y1 - y0)) * W;
  // lanes: the showers in order of start, each in the first lane free
  const ends = [];
  const placed = list
    .slice()
    .sort((a, b) => a.range[0] - b.range[0])
    .map((r) => {
      const a = Math.max(r.range[0], y0), b = Math.min(r.range[1], y1);
      const labelEnd = x(r.peak) + 8 + r.s.name.length * 7.2;
      let l = ends.findIndex((e) => e < x(a) - 4);
      if (l < 0) l = ends.length;
      ends[l] = Math.max(x(b), labelEnd);
      return { r, l, a, b };
    });
  const H = top + ends.length * lane + 22;
  let s = `<svg class="plain strip" viewBox="0 0 ${W} ${H}" role="img" aria-label="The meteor showers of ${year}">`;
  // months
  for (let m = 0; m < 12; m++) {
    const xm = x(Date.UTC(year, m, 1));
    const xn = x(Date.UTC(year, m + 1, 1));
    if (m % 2 === 0) s += `<rect x="${xm}" y="0" width="${xn - xm}" height="${H}" class="month-band" />`;
    s += `<text x="${(xm + xn) / 2}" y="${H - 6}" class="month">${new Date(Date.UTC(year, m, 15)).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })}</text>`;
  }
  // moon phases
  const jdA = jdFromMs(y0), jdB = jdFromMs(y1);
  for (const ph of moonPhases(jdA, jdB)) {
    if (ph.q % 2) continue;
    const xp = x(msFromJd(ph.jd));
    s += `<g transform="translate(${xp - 7} 6)">${moonSvg(ph.q === 2 ? 1 : 0, true, 14)}</g>`;
    if (ph.q === 2) s += `<rect x="${xp - 13}" y="${top - 6}" width="26" height="${H - top - 16}" class="full-glow" />`;
  }
  // today
  const now = Date.now();
  if (now > y0 && now < y1) s += `<line x1="${x(now)}" x2="${x(now)}" y1="${top - 8}" y2="${H - 20}" class="today" />`;
  // showers
  for (const { r, l, a, b } of placed) {
    const yb = top + l * lane + lane - 6;
    const hMax = (lane - 8) * Math.min(1, 0.35 + Math.sqrt(r.s.zhr / 150) * 0.65);
    let d = `M${x(a).toFixed(1)} ${yb}`;
    for (let t = a; t <= b; t += 864e5 / 4) {
      const z = zhrAt(r.s, jdFromMs(t), r.peakJd, r.range) / r.s.zhr;
      d += ` L${x(t).toFixed(1)} ${(yb - z * hMax).toFixed(1)}`;
    }
    d += ` L${x(b).toFixed(1)} ${yb} Z`;
    s += `<a href="#sh-${r.s.id}" class="sh-link"><title>${r.s.name}: peak ${fmtDay(r.peak, place[3])}, ZHR ${r.s.zhr}</title>`;
    s += `<line x1="${x(a)}" x2="${x(b)}" y1="${yb}" y2="${yb}" class="active-line" />`;
    s += `<path d="${d}" class="hump q-${r.quality}" />`;
    s += `<circle cx="${x(r.peak)}" cy="${yb - hMax}" r="3.2" class="peak-dot q-${r.quality}" />`;
    s += `<text x="${x(r.peak) + 7}" y="${yb - 5}" class="sh-name">${r.s.name}</text></a>`;
  }
  return s + "</svg>";
}

// the night of the peak: twilight, the radiant and the Moon, the meteors
function nightSvg(r) {
  const { pts, best } = r.night;
  const tz = place[3];
  const W = 460, H = 170, L = 30, R = 8, T = 10, B = 24;
  const n = pts.length - 1;
  const x = (i) => L + (i / n) * (W - L - R);
  const y = (alt) => T + (1 - Math.max(0, alt) / 90) * (H - T - B);
  let s = `<svg class="plain night" viewBox="0 0 ${W} ${H}" role="img" aria-label="The night of the peak">`;
  // sky: daylight, twilight, night
  pts.forEach((p, i) => {
    if (i === n) return;
    const cls = p.sun > -0.8 ? "sky-day" : p.sun > -6 ? "sky-civil" : p.sun > -12 ? "sky-naut" : p.sun > -18 ? "sky-astro" : "sky-night";
    s += `<rect x="${x(i)}" y="${T}" width="${x(i + 1) - x(i) + 0.5}" height="${H - T - B}" class="${cls}" />`;
  });
  // altitude grid
  for (const a of [30, 60]) {
    s += `<line x1="${L}" x2="${W - R}" y1="${y(a)}" y2="${y(a)}" class="grid" /><text x="${L - 4}" y="${y(a) + 4}" class="axis end">${a}°</text>`;
  }
  s += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="horizon" />`;
  // the meteors per hour, as an area
  const maxRate = Math.max(1, ...pts.map((p) => p.rateNoMoon));
  const yr = (v) => y(0) - (v / maxRate) * (H - T - B) * 0.8;
  let dRate = `M${x(0)} ${y(0)}`;
  pts.forEach((p, i) => (dRate += ` L${x(i).toFixed(1)} ${yr(p.rate).toFixed(1)}`));
  s += `<path d="${dRate} L${x(n)} ${y(0)} Z" class="rate-area" />`;
  // the Moon and the radiant
  const line = (f) => {
    let d = "", pen = false;
    pts.forEach((p, i) => {
      const a = f(p);
      if (a < -1) return (pen = false);
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(a).toFixed(1)} `;
      pen = true;
    });
    return d;
  };
  const kMid = pts[Math.floor(n / 2)].k;
  s += `<path d="${line((p) => p.moon)}" class="moon-line" style="opacity:${(0.35 + kMid * 0.65).toFixed(2)}" />`;
  s += `<path d="${line((p) => p.rad.alt)}" class="rad-line" />`;
  // best time
  if (best.rate >= 0.5) {
    const i = pts.indexOf(best);
    s += `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${y(0)}" class="best-line" /><circle cx="${x(i)}" cy="${y(best.rad.alt)}" r="3.5" class="best-dot" />`;
  }
  // hours
  pts.forEach((p, i) => {
    const lp = localParts(p.t, tz);
    if (Math.abs(lp.h - Math.round(lp.h)) < 0.05 && Math.round(lp.h) % 3 === 0) {
      s += `<text x="${x(i)}" y="${H - 7}" class="axis">${fmtHour(p.t, tz)}</text>`;
    }
  });
  return s + "</svg>";
}

// where the radiant is, on a compass, with the Moon
function compassSvg(p) {
  const c = 50, R = 40;
  const pos = (az, alt) => {
    const d = R * (1 - Math.max(0, alt) / 90);
    return [c + d * Math.sin(az * D2R), c - d * Math.cos(az * D2R)];
  };
  let s = `<svg class="plain compass" viewBox="0 0 100 100" role="img" aria-label="Where to look">`;
  s += `<circle cx="${c}" cy="${c}" r="${R}" class="dome" /><circle cx="${c}" cy="${c}" r="${R * 0.66}" class="ring" /><circle cx="${c}" cy="${c}" r="${R * 0.33}" class="ring" />`;
  for (const [t, az] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]]) {
    const [tx, ty] = [c + (R + 6) * Math.sin(az * D2R), c - (R + 6) * Math.cos(az * D2R) + 3];
    s += `<text x="${tx}" y="${ty}" class="cardinal">${t}</text>`;
  }
  if (p.moon > 0) {
    const [mx, my] = pos(moonAz(p), p.moon);
    s += `<circle cx="${mx}" cy="${my}" r="${3 + p.k * 2.5}" class="cmp-moon" />`;
  }
  if (p.rad.alt > 0) {
    const [rx, ry] = pos(p.rad.az, p.rad.alt);
    // meteors streak out of the radiant
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      const l0 = 5, l1 = 5 + (i % 2 ? 9 : 14);
      s += `<line x1="${rx + l0 * Math.cos(a)}" y1="${ry + l0 * Math.sin(a)}" x2="${rx + l1 * Math.cos(a)}" y2="${ry + l1 * Math.sin(a)}" class="streak" />`;
    }
    s += `<circle cx="${rx}" cy="${ry}" r="3" class="cmp-rad" />`;
  }
  return s + "</svg>";
}
// azimuth of the Moon (only for the compass)
function moonAz(p) {
  const { ra, dec } = bodyRaDec("moon", jdFromMs(p.t));
  return altAz(ra, dec, jdFromMs(p.t), place[1], place[2]).az;
}

// ---------------------------------------------------------------- the texts

function moonText(r) {
  const tz = place[3];
  const { best, moonX, pts } = r.night;
  const k = Math.round(best.k * 100);
  const up = pts.filter((p) => p.sun < -12 && p.moon > 0).length;
  const darkPts = pts.filter((p) => p.sun < -12).length || 1;
  const rise = moonX.find((e) => e.up && pts[0].t < e.t);
  const set = moonX.find((e) => !e.up);
  let when;
  if (k < 3) when = "New moon: a dark sky all night.";
  else if (up === 0) when = `The Moon, ${k}% lit, is down all night.`;
  else if (up >= darkPts * 0.95) when = `The Moon, ${k}% lit, is up all night.`;
  else if (set && (!rise || set.t < rise.t)) when = `The Moon, ${k}% lit, sets at ${fmtTime(set.t, tz)}.`;
  else if (rise) when = `The Moon, ${k}% lit, rises at ${fmtTime(rise.t, tz)}.`;
  else when = `The Moon is ${k}% lit.`;
  return when;
}

function lookText(r) {
  const tz = place[3];
  const { best, radMax, radX } = r.night;
  const s = r.s;
  if (radMax.rad.alt <= 0) {
    return `From ${place[0]}, the radiant in ${s.con} stays below the horizon all night: the ${s.name} are a shower for the other hemisphere.`;
  }
  if (best.rate < 0.5) {
    const rise = radX.find((e) => e.up);
    return `The radiant, in ${s.con}, ${rise ? `rises at ${fmtTime(rise.t, tz)}, too close to dawn` : "stays too low in the dark hours"}: from ${place[0]}, very few meteors.`;
  }
  const alt = Math.round(best.rad.alt);
  return `Around ${fmtTime(best.t, tz)}, the radiant, in ${s.con}, is ${alt}° up in the ${dirName(best.rad.az)}. Meteors streak out of it all over the sky: look about 40° away from it, ${alt > 50 ? "high up" : "a little higher"}, wherever the sky is darkest${best.moon > 0 ? ", with the Moon behind you" : ""}.`;
}

function rateText(rate) {
  const n = round(rate);
  if (n === 0) return "less than one";
  return `about ${n}`;
}

// ---------------------------------------------------------------- the page

function card(r) {
  const tz = place[3];
  const s = r.s;
  const { best } = r.night;
  const now = Date.now();
  const days = Math.ceil((r.peak - now) / 864e5);
  const soon = days > 0 && days <= 60 ? ` <span class="soon">in ${days} day${days > 1 ? "s" : ""}</span>` : days <= 0 && now < r.range[1] ? ` <span class="soon now">active now</span>` : "";
  const bestTxt = best.rate >= 0.5 ? fmtTime(best.t, tz) : "—";
  return `<article class="sh-card q-${r.quality}" id="sh-${s.id}">
    <header>
      <h4>${s.name} <span class="code">${s.code}</span></h4>
      <p class="sh-night">Peak the night of <strong>${nightName(r.ev, tz)}</strong>${soon}</p>
      <p class="sh-active">Active ${fmtDay(r.range[0], "UTC")} to ${fmtDay(r.range[1], "UTC")}</p>
    </header>
    <p class="sh-moon">${moonSvg(r.night.best.k || r.moonAtPeak.k, r.moonAtPeak.waxing, 24)}<span><b class="q-txt">${QUALITY[r.quality]}.</b> ${moonText(r)}</span></p>
    <div class="sh-stats">
      <div class="stat"><div class="k">ZHR</div><div class="v">${s.zhr}</div></div>
      <div class="stat"><div class="k">Per hour here</div><div class="v">${round(best.rate) || "<1"}</div></div>
      <div class="stat"><div class="k">Best time</div><div class="v">${bestTxt}</div></div>
      <div class="stat"><div class="k">Speed</div><div class="v">${s.v} km/s</div></div>
    </div>
    <div class="sh-sky">
      ${nightSvg(r)}
      ${best.rate >= 0.5 ? compassSvg(best) : compassSvg(r.night.radMax)}
    </div>
    <p class="sh-look">${lookText(r)}</p>
    <p class="sh-about">${s.about}</p>
    <p class="sh-parent">Dust of ${s.parent}.</p>
  </article>`;
}

// the next peak of a major shower (ZHR 10 or more)
function renderNext() {
  const now = Date.now();
  const tz = place[3];
  let next = null;
  const thisYear = new Date().getUTCFullYear();
  for (let y = thisYear; y <= thisYear + 1 && !next; y++) {
    next = SHOWERS.filter((s) => s.zhr >= 10)
      .map((s) => showerYear(s, y))
      .filter((r) => r.night.pts[r.night.pts.length - 1].t > now)
      .sort((a, b) => a.peak - b.peak)[0];
  }
  // tonight: the showers active now, with their rates at their best time tonight
  const lp = localParts(now, tz);
  const ev = lp.h >= 9 ? lp : localParts(now - 864e5, tz);
  const tonight = SHOWERS.map((s) => {
    let r = showerYear(s, thisYear);
    if (now > r.range[1] + 864e5 * 30) r = showerYear(s, thisYear + 1);
    if (now < r.range[0] - 864e5 || now > r.range[1] + 864e5) return null;
    const n = nightOf(s, ev, r.peakJd, r.range);
    return { s, n };
  })
    .filter((x) => x && x.n.best.rate >= 0.5)
    .sort((a, b) => b.n.best.rate - a.n.best.rate);
  const tonightTxt = tonight.length
    ? `Tonight: ${tonight
        .map((x) => `<a href="#sh-${x.s.id}">${x.s.name}</a> (${rateText(x.n.best.rate)} an hour around ${fmtTime(x.n.best.t, tz)})`)
        .join(", ")}.`
    : `Tonight: no shower worth staying up for from ${place[0]}, only the few random meteors of every night.`;
  if (!next) return;
  const days = Math.ceil((next.peak - now) / 864e5);
  const best = next.night.best;
  const when = days <= 0 ? "now" : days === 1 ? "tomorrow" : `in ${days} days`;
  $m("next").innerHTML = `<div class="next-main">
      <p class="next-label">Next big shower, ${when}</p>
      <p class="next-name">${next.s.name}</p>
      <p class="next-date">The night of ${nightName(next.ev, tz)} · <a href="?year=${new Date(next.peak).getUTCFullYear()}${placeParam()}#sh-${next.s.id}">details</a></p>
      <p class="next-moon q-${next.quality}">${moonSvg(best.k, next.moonAtPeak.waxing, 22)}<span><b>${QUALITY[next.quality]}.</b> ${moonText(next)} ${
        best.rate >= 0.5 ? `Under ${SKIES[sky].text}, expect ${rateText(best.rate)} meteors an hour around ${fmtTime(best.t, tz)}.` : ""
      }</span></p>
    </div>
    <p class="tonight">${tonightTxt}</p>`;
}

const placeParam = () => (PLACES.includes(place) ? "&place=" + encodeURIComponent(place[0]) : "") + (sky !== "suburbs" ? "&sky=" + sky : "");

function defaultPlace() {
  const q = new URLSearchParams(location.search).get("place");
  const byName = PLACES.find((p) => p[0] === q);
  if (byName) return byName;
  let tz = "";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (e) {}
  return PLACES.find((p) => p[3] === tz) || PLACES.find((p) => p[0] === "London");
}

function fillPlaces() {
  const sel = $m("place");
  sel.innerHTML = Object.entries(PLACE_GROUPS)
    .map(([g, list]) => `<optgroup label="${g}">${list.map((p) => `<option value="${p[0]}">${p[0]}</option>`).join("")}</optgroup>`)
    .join("");
  if (place && !PLACES.includes(place)) sel.insertAdjacentHTML("afterbegin", `<option value="${place[0]}">${place[0]}</option>`);
  sel.value = place[0];
}

function fillSkies() {
  $m("sky-chips").innerHTML = Object.entries(SKIES)
    .map(([id, k]) => `<button type="button" data-sky="${id}" aria-pressed="${id === sky}">${k.name}</button>`)
    .join("");
}

function render() {
  const list = SHOWERS.map((s) => showerYear(s, year)).sort((a, b) => a.peak - b.peak);
  $m("year-label").textContent = year;
  $m("year-title").textContent = `Meteor showers of ${year}`;
  $m("year-prev").disabled = year <= MIN_YEAR;
  $m("year-next").disabled = year >= MAX_YEAR;
  const good = list.filter((r) => r.s.zhr >= 10 && r.quality === "good").map((r) => r.s.name);
  const t = list[0] ? list[0].peak : Date.now();
  $m("year-sum").textContent = `Times are for ${place[0]} (${tzName(t, place[3])}), under ${SKIES[sky].text}. ${
    good.length ? `Best of the year, with a dark Moon: ${good.join(", ")}.` : "No major shower gets a dark Moon this year."
  }`;
  $m("year-strip").innerHTML = yearStrip(list);
  $m("cards").innerHTML = list.map(card).join("");
  fillSkies();
  renderNext();
  const url = new URL(location.href);
  if (year === new Date().getFullYear()) url.searchParams.delete("year");
  else url.searchParams.set("year", year);
  if (PLACES.includes(place)) url.searchParams.set("place", place[0]);
  else url.searchParams.delete("place");
  if (sky !== "suburbs") url.searchParams.set("sky", sky);
  else url.searchParams.delete("sky");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}

function setYear(y) {
  year = Math.max(MIN_YEAR, Math.min(MAX_YEAR, y));
  render();
}

function initMeteors() {
  const qs = new URLSearchParams(location.search);
  const q = parseInt(qs.get("year"), 10);
  if (q >= MIN_YEAR && q <= MAX_YEAR) year = q;
  if (SKIES[qs.get("sky")]) sky = qs.get("sky");
  place = defaultPlace();
  fillPlaces();
  $m("place").addEventListener("change", (ev) => {
    place = PLACES.find((p) => p[0] === ev.target.value) || place;
    render();
  });
  $m("sky-chips").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    sky = b.dataset.sky;
    render();
  });
  $m("my-location").addEventListener("click", (ev) => {
    ev.preventDefault();
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      let tz = "UTC";
      try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch (x) {}
      place = ["your location", +pos.coords.latitude.toFixed(2), +pos.coords.longitude.toFixed(2), tz];
      fillPlaces();
      render();
    });
  });
  $m("year-prev").addEventListener("click", () => setYear(year - 1));
  $m("year-next").addEventListener("click", () => setYear(year + 1));
  $m("this-year").addEventListener("click", (ev) => {
    ev.preventDefault();
    setYear(new Date().getFullYear());
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.target.closest("input, select, textarea")) return;
    if (ev.key === "ArrowLeft") setYear(year - 1);
    if (ev.key === "ArrowRight") setYear(year + 1);
  });
  render();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
}
