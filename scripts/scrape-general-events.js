#!/usr/bin/env node
/**
 * Scrape NYC General Events
 *
 * Sources (8):
 *   - doNYC              (concerts, nightlife, comedy) — cheerio, per-day URLs
 *   - The Skint           (free/cheap events) — cheerio, homepage + ongoing
 *   - Time Out NY         (curated picks) — cheerio
 *   - Secret NYC          (things to do) — cheerio
 *   - Brooklyn Paper      (Brooklyn events) — cheerio
 *   - NYC Parks           (free outdoor events) — cheerio
 *   - Eventbrite NYC      (community events) — Playwright (JS-rendered)
 *   - Playbill            (Broadway + Off-Broadway) — cheerio
 *
 * Uses cheerio (fetch+parse) by default, Playwright only where needed.
 *
 * Outputs JSON array to stdout. Pipe through validate-events.js:
 *   node scripts/scrape-general-events.js > /tmp/raw-events.json
 *   node scripts/validate-events.js /tmp/raw-events.json public/data/events.json
 */

const cheerio = require('cheerio');
const https = require('https');
const http = require('http');

const events = [];

// CI-aware wait multiplier — GitHub Actions VMs are slower and more likely to be flagged
const IS_CI = !!process.env.CI;
const WAIT_MULT = IS_CI ? 2.0 : 1.0;
function ciWait(ms) { return Math.round(ms * WAIT_MULT); }

// ---------------------------------------------------------------------------
// Date range — current month + next month
// ---------------------------------------------------------------------------

function monthRange() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 2, 0);
  return {
    start: process.env.MONTH_START || fmt(start),
    end:   process.env.MONTH_END   || fmt(end),
  };
}

const WEEK = monthRange(); // kept as WEEK for minimal code churn
const RANGE = `${WEEK.start} to ${WEEK.end}`;
console.error(`Date range: ${RANGE}`);

// ---------------------------------------------------------------------------
// Keyword-based category inference (shared across all scrapers)
// ---------------------------------------------------------------------------

const KEYWORD_CAT_RULES = [
  { cat: 'Opera', re: /\bopera\b|puccini|verdi|rossini|suor angelica|la traviata|tosca|rigoletto|carmen\b/i },
  { cat: 'Ballet', re: /\bballet\b/i },
  { cat: 'Film', re: /\bfilm\b|cinema|screening|movie|documentary|short films?\b|double.?feature/i },
  { cat: 'Comedy', re: /\bcomedy\b|comedian|stand-?up|improv\b|sketch comedy|laugh|standup|funny|humor|roast\b|cat cafe/i },
  { cat: 'Classical Music', re: /\bclassical\b|symphony|orchestra|chamber music|philharmonic/i },
  { cat: 'Jazz', re: /\bjazz\b/i },
  { cat: 'Dance', re: /\bdance show\b|\bdance party\b|\bdance performance|\bdance class/i },
  { cat: 'Theater', re: /\btheater\b|\btheatre\b|broadway|off-broadway|musical\b|playwright|cabaret|shadowcast|one-act|dramaturg/i },
  { cat: 'Art', re: /\bexhibition\b|\bgallery\b|\bmuseum\b|sculpture|painting|mural|retrospective|installation\b|curator|photograph/i },
  { cat: 'Music/Performing Arts', re: /\bmusic\b|\bconcert\b|\bband\b|singer|songwriter|indie music|rock\b|punk|hip-?hop|\bdj\b|karaoke|open mic|live.*music|music.*live|k-?pop|club night/i },
  { cat: 'Talk', re: /\breading series\b|book launch|storytelling|lecture|author\b|discussion|panel\b|\btalk\b|speaker|literary|poetry|reading\b/i },
  { cat: 'Food/Drink', re: /\bfood\b|restaurant week|tasting|chili|pancake|brunch|dinner\b|cook-?off|beer fest|wine\b|cocktail/i },
  { cat: 'Shopping/Markets', re: /\bmarket\b|flea\b|bazaar|warehouse sale|craft.*fair|vintage.*sale|zine\b|comics.*fest/i },
  { cat: 'Outdoor/Parks', re: /\bgarden\b|nature walk|botanic|ice.?skat/i },
  { cat: 'Family', re: /\bkids\b|children|family\b|puppet/i },
];

/** Infer category from title (and optionally description) using keyword rules */
function inferCategory(title, description) {
  const titleLower = (title || '').toLowerCase();
  for (const rule of KEYWORD_CAT_RULES) {
    if (rule.re.test(titleLower)) return rule.cat;
  }
  const descLower = (description || '').toLowerCase();
  for (const rule of KEYWORD_CAT_RULES) {
    if (rule.re.test(descLower)) return rule.cat;
  }
  return 'Other';
}

// ---------------------------------------------------------------------------
// HTTP fetch helper (Node 18 compatible — no global fetch)
// ---------------------------------------------------------------------------

function fetchHTML(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const timer = setTimeout(() => reject(new Error('Timeout after 20s')), 20000);
    mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        clearTimeout(timer);
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        return fetchHTML(next, maxRedirects - 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, html: data }); });
      res.on('error', e => { clearTimeout(timer); reject(e); });
    }).on('error', e => { clearTimeout(timer); reject(e); });
  });
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function parseHumanDate(str) {
  if (!str) return null;
  const s = str.trim().replace(/\s+/g, ' ');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})[T ]/);
  if (isoMatch) return isoMatch[1];

  const MONTHS = {
    jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,
    may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,
    oct:9,october:9,nov:10,november:10,dec:11,december:11
  };
  const year = new Date(WEEK.start).getFullYear();

  // "March 5, 2026" or "Mar 5"
  const m1 = s.match(/^([a-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i);
  if (m1) {
    const mon = MONTHS[m1[1].toLowerCase()];
    if (mon !== undefined) {
      const day = parseInt(m1[2], 10);
      const y = m1[3] ? parseInt(m1[3], 10) : year;
      return `${y}-${String(mon+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }

  // "5 March 2026"
  const m2 = s.match(/^(\d{1,2})\s+([a-z]+)(?:\s*,?\s*(\d{4}))?/i);
  if (m2) {
    const mon = MONTHS[m2[2].toLowerCase()];
    if (mon !== undefined) {
      const day = parseInt(m2[1], 10);
      const y = m2[3] ? parseInt(m2[3], 10) : year;
      return `${y}-${String(mon+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }

  // "Tue 3 Mar 2026" or "Mon 10 Mar"
  const m4 = s.match(/^(?:mon|tue|wed|thu|fri|sat|sun)\w*\s+(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/i);
  if (m4) {
    const mon = MONTHS[m4[2].toLowerCase()];
    if (mon !== undefined) {
      const day = parseInt(m4[1], 10);
      const y = m4[3] ? parseInt(m4[3], 10) : year;
      return `${y}-${String(mon+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }

  // "Tue Mar 10" or "Wed Mar 4" or "Thu, Mar 12, 2026"
  const m5 = s.match(/^(?:mon|tue|wed|thu|fri|sat|sun)\w*,?\s+([a-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i);
  if (m5) {
    const mon = MONTHS[m5[1].toLowerCase()];
    if (mon !== undefined) {
      const day = parseInt(m5[2], 10);
      const y = m5[3] ? parseInt(m5[3], 10) : year;
      return `${y}-${String(mon+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }

  // "Monday March 2, 2026" or "Monday, March 2, 2026"
  const m6 = s.match(/^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+([a-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i);
  if (m6) {
    const mon = MONTHS[m6[1].toLowerCase()];
    if (mon !== undefined) {
      const day = parseInt(m6[2], 10);
      const y = m6[3] ? parseInt(m6[3], 10) : year;
      return `${y}-${String(mon+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }

  // MM/DD/YYYY
  const m3 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m3) {
    return `${m3[3]}-${String(parseInt(m3[1],10)).padStart(2,'0')}-${String(parseInt(m3[2],10)).padStart(2,'0')}`;
  }

  // Unix timestamp (seconds) — e.g. from data-date attributes
  if (/^\d{9,11}$/.test(s)) {
    const d = new Date(parseInt(s, 10) * 1000);
    if (!isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
  }

  return null;
}

/**
 * Parse "Through {date}" / date ranges into "YYYY-MM-DD to YYYY-MM-DD" format.
 */
function parseThrough(str) {
  if (!str) return null;
  const s = str.trim().replace(/\s+/g, ' ');
  const year = new Date(WEEK.start).getFullYear();
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = fmt(new Date());

  const throughMatch = s.match(/(?:through|thru)\s+(.+)/i);
  if (throughMatch) {
    const endDate = parseHumanDate(throughMatch[1].trim());
    if (endDate) return `${today} to ${endDate}`;
    const MONTHS = {jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11};
    const monMatch = throughMatch[1].trim().match(/^([a-z]+)$/i);
    if (monMatch) {
      const mon = MONTHS[monMatch[1].toLowerCase()];
      if (mon !== undefined) {
        const lastDay = new Date(year, mon + 1, 0);
        return `${today} to ${fmt(lastDay)}`;
      }
    }
    return null;
  }

  const rangeParts = s.split(/\s*[–—]\s*|\s+to\s+/i);
  if (rangeParts.length === 2) {
    const startDate = parseHumanDate(rangeParts[0].trim());
    const endDate = parseHumanDate(rangeParts[1].trim());
    if (startDate && endDate) return `${startDate} to ${endDate}`;
    if (!startDate && endDate) return `${today} to ${endDate}`;
  }

  if (/^ongoing$/i.test(s)) return null;
  return null;
}

function push(items, venue, category, fallbackUrl) {
  items.forEach(item => {
    let date = item.date || null;
    if (date && /^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/.test(date)) {
      // Already a valid range — keep
    } else if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      // Already ISO — keep
    } else if (date && /^\d{4}-\d{2}-\d{2}[T ]/.test(date)) {
      date = date.slice(0, 10);
    } else if (date) {
      let parsed = parseThrough(date);
      if (!parsed) parsed = parseHumanDate(date);
      if (!parsed) {
        const parts = date.split(/\s*[-–—]\s*|\s+to\s+|\s+and\s+/i);
        if (parts.length >= 2) {
          const startD = parseHumanDate(parts[0].trim());
          const endD = parseHumanDate(parts[parts.length - 1].trim());
          if (startD && endD) parsed = `${startD} to ${endD}`;
          else if (startD) parsed = startD;
        }
      }
      date = parsed || null;
    }
    // Use item-level category if provided, otherwise use source default,
    // and if that's 'Other', try keyword inference from title/description
    let finalCategory = item.category || category;
    if (finalCategory === 'Other') {
      finalCategory = inferCategory(item.title, item.description);
    }
    events.push({
      title: (item.title || '').trim(),
      venue: item.venue || venue,
      date,
      category: finalCategory,
      url: item.link || item.url || fallbackUrl,
      ...(item.time ? { time: item.time } : {}),
      ...(item.description ? { description: item.description } : {}),
      ...(item.price ? { price: item.price } : {}),
    });
  });
}

// ---------------------------------------------------------------------------
// Sources — cheerio-based
// ---------------------------------------------------------------------------

async function scrapeDoNYC() {
  // Per-day URLs: /events/YYYY/M/D — scrape next 14 days from today
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Map DoNYC CSS category classes to our categories
  const DONYC_CAT_MAP = {
    'music': 'Music/Performing Arts',
    'comedy': 'Comedy',
    'theatre-performing-arts': 'Theater',
    'performing-arts': 'Music/Performing Arts',
    'dj-parties': 'Music/Performing Arts',
    'burlesque': 'Music/Performing Arts',
    'karaoke': 'Music/Performing Arts',
    'sports': 'Other',
    'pop-up': 'Other',
    'other-fun-deals': 'Other',
  };

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + dayOffset);
    const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const url = `https://donyc.com/events/${y}/${m}/${day}`;

    try {
      const { html } = await fetchHTML(url);
      const $ = cheerio.load(html);
      // Group items by category
      const byCategory = {};
      $('.ds-listing').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h3, .ds-listing-event-title').first().text().trim();
        const venue = $el.find('.ds-venue-name').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const fullLink = link.startsWith('/') ? `https://donyc.com${link}` : link;
        const time = $el.find('.ds-event-time').first().text().trim();
        // Extract category from CSS class like "ds-event-category-music"
        const classes = $el.attr('class') || '';
        const catMatch = classes.match(/ds-event-category-([a-z-]+)/);
        const catKey = catMatch ? catMatch[1] : '';
        const category = DONYC_CAT_MAP[catKey] || 'Other';
        if (title && title.length > 3) {
          if (!byCategory[category]) byCategory[category] = [];
          byCategory[category].push({ title, venue, link: fullLink, time, date: dateStr });
        }
      });
      // Push each category group separately
      let total = 0;
      for (const [cat, items] of Object.entries(byCategory)) {
        push(items, 'doNYC', cat, url);
        total += items.length;
      }
      console.error(`doNYC ${dateStr}: ${total}`);
    } catch (e) { console.error(`doNYC ${dateStr} error:`, e.message); }
  }
}

async function scrapeTheSkint() {
  const year = new Date(WEEK.start).getFullYear();

  // Keyword-based category detection for The Skint events.
  // Uses the shared inferCategory() function defined at the top of this file.
  // The Skint is plain-text blog style with no structured category data,
  // so we infer category from title + description keywords.

  // Junk filter for sponsored content fragments and non-event text
  const SKINT_JUNK_RE = /^(use code|use the individual|get tickets|fees apply|more info|promo code|CLB\d|MCP\w|book tickets)/i;

  function categorizeSkintEvent(title, description) {
    return inferCategory(title, description);
  }

  function isSkintJunk(title) {
    if (SKINT_JUNK_RE.test(title)) return true;
    // Skip single-word titles under 15 chars (likely fragments like "Carnegie Hall")
    if (title.length < 15 && !/\s/.test(title)) return true;
    return false;
  }

  // Homepage — daily picks (blog-post style)
  try {
    const { html } = await fetchHTML('https://theskint.com/');
    const $ = cheerio.load(html);
    const byCategory = {};
    // Track sponsored blocks — skip paragraphs between "sponsored" header and next day header
    let inSponsored = false;
    const DAY_RE = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|ongoing|stay safe)$/i;
    // Each event is a <p> inside .entry-content with a <b> bold title
    $('.entry-content p').each((_, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      const bold = $el.find('b').first().text().trim();
      const underline = $el.find('u').first().text().trim();
      // Detect sponsored section headers (bold + underlined "sponsored")
      if (/^sponsored$/i.test(underline) || /^sponsored$/i.test(bold)) { inSponsored = true; return; }
      // Day headers end sponsored blocks
      if (DAY_RE.test(bold) || DAY_RE.test(underline)) { inSponsored = false; return; }
      // Skip inline "sponsored:" prefix events (individual sponsored listings are fine to keep)
      if (inSponsored) return;

      const link = $el.find('a').last().attr('href') || '';
      if (!bold || bold.length < 4 || bold.length > 120) return;
      if (text.length < 15) return;
      if (isSkintJunk(bold)) return;
      // Skip "our roundup of..." meta-links
      if (/^our roundup/i.test(bold)) return;
      // Real Skint events always have a >> link; paragraphs without links are ad body text
      if (!link) return;
      // Skip news article links — we only want event/venue/ticket URLs
      try {
        const host = new URL(link).hostname.replace(/^www\./, '');
        const NEWS_DOMAINS = /^(abc7|nbc|cbs|fox|cnn|nytimes|nypost|gothamist|amny|pix11|ny1|dailynews|washingtonpost|bbc|reuters|apnews|usatoday|newsday)\b/i;
        if (NEWS_DOMAINS.test(host)) return;
      } catch (_) {}

      let dateText = '';
      const mmddMatch = text.match(/(\d{1,2})\/(\d{1,2})/);
      if (mmddMatch) {
        dateText = `${year}-${String(parseInt(mmddMatch[1],10)).padStart(2,'0')}-${String(parseInt(mmddMatch[2],10)).padStart(2,'0')}`;
      }
      // Check for date ranges: "thru 3/15" or "thru 4/18"
      const thruMatch = text.match(/thru\s+(\d{1,2})\/(\d{1,2})/i);
      if (thruMatch && mmddMatch) {
        const endDate = `${year}-${String(parseInt(thruMatch[1],10)).padStart(2,'0')}-${String(parseInt(thruMatch[2],10)).padStart(2,'0')}`;
        if (endDate !== dateText) {
          dateText = `${dateText} to ${endDate}`;
        }
      }

      const category = categorizeSkintEvent(bold, text);
      if (!byCategory[category]) byCategory[category] = [];
      byCategory[category].push({ title: bold, link, date: dateText, description: text.slice(0, 200) });
    });
    let total = 0;
    for (const [cat, items] of Object.entries(byCategory)) {
      push(items, 'The Skint', cat, 'https://theskint.com');
      total += items.length;
    }
    console.error(`The Skint (home): ${total} (${Object.keys(byCategory).join(', ')})`);
  } catch (e) { console.error('The Skint home error:', e.message); }

  // Ongoing events page — curated list of ongoing NYC events
  try {
    const { html } = await fetchHTML('https://theskint.com/ongoing-events/');
    const $ = cheerio.load(html);
    const byCategory = {};
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const today = fmt(new Date());
    // Events are in paragraphs with bold titles and ► markers
    $('.entry-content p').each((_, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      const bold = $el.find('b, strong').first().text().trim();
      const link = $el.find('a').last().attr('href') || '';
      if (!bold || bold.length < 4 || bold.length > 120) return;
      if (/^(ongoing|sponsored|stay safe|ice skating|film fests)/i.test(bold)) return;
      if (text.length < 15) return;
      if (isSkintJunk(bold)) return;
      if (/^our roundup/i.test(bold)) return;
      // Skip news article links
      if (link) {
        try {
          const host = new URL(link).hostname.replace(/^www\./, '');
          const NEWS_DOMAINS = /^(abc7|nbc|cbs|fox|cnn|nytimes|nypost|gothamist|amny|pix11|ny1|dailynews|washingtonpost|bbc|reuters|apnews|usatoday|newsday)\b/i;
          if (NEWS_DOMAINS.test(host)) return;
        } catch (_) {}
      }
      let dateText = '';
      const thruMatch = text.match(/thru\s+(\d{1,2})\/(\d{1,2})/i);
      if (thruMatch) {
        const endDate = `${year}-${String(parseInt(thruMatch[1],10)).padStart(2,'0')}-${String(parseInt(thruMatch[2],10)).padStart(2,'0')}`;
        dateText = `${today} to ${endDate}`;
      }

      const category = categorizeSkintEvent(bold, text);
      if (!byCategory[category]) byCategory[category] = [];
      byCategory[category].push({ title: bold, link, description: text.slice(0, 200), date: dateText });
    });
    let total = 0;
    for (const [cat, items] of Object.entries(byCategory)) {
      push(items, 'The Skint', cat, 'https://theskint.com/ongoing-events/');
      total += items.length;
    }
    console.error(`The Skint (ongoing): ${total} (${Object.keys(byCategory).join(', ')})`);
  } catch (e) { console.error('The Skint ongoing error:', e.message); }
}


// Time Out NY removed — their /things-to-do page is editorial content (listicles,
// neighborhood guides, reviews), not structured events. Our other sources cover
// actual events better.

async function scrapeSecretNYC() {
  try {
    const { html } = await fetchHTML('https://secretnyc.co/events/');
    const $ = cheerio.load(html);
    const items = [];
    $('article, .event, .post').each((_, el) => {
      const $el = $(el);
      const title = $el.find('h2, h3, .title').first().text().trim();
      const link = $el.find('a').first().attr('href') || '';
      const rawDate = $el.find('time[datetime]').first().attr('datetime') || '';
      if (title && title.length > 5 && title.length < 120) items.push({ title, link, date: rawDate });
    });
    push(items, 'Secret NYC', 'Other', 'https://secretnyc.co/events/');
    console.error(`Secret NYC: ${items.length}`);
  } catch (e) { console.error('Secret NYC error:', e.message); }
}

async function scrapeBrooklynPaper() {
  try {
    const { html } = await fetchHTML('https://events.brooklynpaper.com/event/');
    const $ = cheerio.load(html);
    const items = [];
    // Brooklyn Paper uses h2 date headers + h3 event titles
    let currentDate = '';
    $('h2, h3').each((_, el) => {
      const $el = $(el);
      const tag = $el.prop('tagName');
      const text = $el.text().trim();
      if (tag === 'H2') {
        // Date header like "Monday March 2, 2026"
        const parsed = parseHumanDate(text.replace(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+/i, ''));
        if (parsed) currentDate = parsed;
      } else if (tag === 'H3' && text.length > 3 && text.length < 120) {
        const link = $el.find('a').first().attr('href') || $el.closest('a').attr('href') || '';
        items.push({ title: text, link, date: currentDate || '' });
      }
    });
    push(items, 'Brooklyn Paper', 'Other', 'https://events.brooklynpaper.com');
    console.error(`Brooklyn Paper: ${items.length}`);
  } catch (e) { console.error('Brooklyn Paper error:', e.message); }
}

async function scrapeNYCParks() {
  try {
    const { html } = await fetchHTML('https://www.nycgovparks.org/events');
    const $ = cheerio.load(html);
    const items = [];
    // NYC Parks has itemprop="startDate" with ISO dates
    $('[itemtype*="Event"], .event_listing').each((_, el) => {
      const $el = $(el);
      const title = $el.find('[itemprop="name"], h3, h4').first().text().trim();
      const venue = $el.find('[itemprop="location"], [class*="location"]').first().text().trim();
      const link = $el.find('a').first().attr('href') || '';
      const fullLink = link.startsWith('/') ? `https://www.nycgovparks.org${link}` : link;
      const rawDate = $el.find('[itemprop="startDate"]').first().attr('content')
        || $el.find('meta[itemprop="startDate"]').first().attr('content') || '';
      if (title && title.length > 5 && title.length < 120) items.push({ title, venue, link: fullLink, date: rawDate });
    });
    // Fallback: generic event rows
    if (items.length === 0) {
      $('tr, [class*="event"]').each((_, el) => {
        const $el = $(el);
        const title = $el.find('a, h3, h4').first().text().trim();
        const rawDate = $el.find('[class*="date"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const fullLink = link.startsWith('/') ? `https://www.nycgovparks.org${link}` : link;
        if (title && title.length > 5 && title.length < 120) items.push({ title, link: fullLink, date: rawDate });
      });
    }
    push(items, 'NYC Parks', 'Outdoor/Parks', 'https://www.nycgovparks.org/events');
    console.error(`NYC Parks: ${items.length}`);
  } catch (e) { console.error('NYC Parks error:', e.message); }
}

async function scrapePlaybill() {
  try {
    const { html } = await fetchHTML('https://playbill.com/productions');
    const $ = cheerio.load(html);
    const items = [];
    const seen = new Set();
    // Playbill production cards — look for data-date attributes (Unix timestamps)
    $('[data-date], a[href*="/production/"]').each((_, el) => {
      const $el = $(el);
      const title = $el.text().trim() || $el.find('[class*="title"]').first().text().trim();
      const link = $el.attr('href') || $el.find('a').first().attr('href') || '';
      const fullLink = link.startsWith('/') ? `https://playbill.com${link}` : link;
      // data-date is a Unix timestamp in seconds
      const dataDate = $el.attr('data-date') || $el.closest('[data-date]').attr('data-date') || '';
      let dateText = '';
      if (dataDate && /^\d{9,11}$/.test(dataDate)) {
        dateText = dataDate; // parseHumanDate now handles Unix timestamps
      }
      if (title && title.length > 3 && title.length < 120
          && !seen.has(title.toLowerCase())
          && !/^(see all|view|more|production)/i.test(title)) {
        seen.add(title.toLowerCase());
        items.push({ title, link: fullLink, date: dateText });
      }
    });
    push(items, 'Broadway', 'Theater', 'https://playbill.com/productions');
    console.error(`Playbill: ${items.length}`);
  } catch (e) { console.error('Playbill error:', e.message); }
}

// ---------------------------------------------------------------------------
// Sources — Playwright (JS-rendered sites)
// ---------------------------------------------------------------------------

async function scrapeEventbrite(browser) {
  // Eventbrite search pages: each event is a container div with class containing
  // "map_experiment_event_card". Inside: .event-card-link <a> for URL, <h3> for title,
  // <p> tags for metadata like "Friday • 10:00 PM", "Brooklyn · Elsewhere", "From $29.41"
  const PAGES = [
    'https://www.eventbrite.com/d/ny--new-york/events--this-week/',
    'https://www.eventbrite.com/d/ny--new-york/events--next-week/',
    'https://www.eventbrite.com/d/ny--new-york/arts--events--this-week/',
    'https://www.eventbrite.com/d/ny--new-york/music--events--this-week/',
    'https://www.eventbrite.com/d/ny--new-york/food-and-drink--events--this-week/',
    'https://www.eventbrite.com/d/ny--new-york/arts--events--next-week/',
    'https://www.eventbrite.com/d/ny--new-york/music--events--next-week/',
    'https://www.eventbrite.com/d/ny--new-york/food-and-drink--events--next-week/',
    'https://www.eventbrite.com/d/ny--new-york/community--events--this-week/',
    'https://www.eventbrite.com/d/ny--new-york/community--events--next-week/',
    'https://www.eventbrite.com/d/ny--new-york/family--events--this-week/',
    'https://www.eventbrite.com/d/ny--new-york/family--events--next-week/',
  ];

  const allItems = [];
  const seenTitles = new Set();

  for (const url of PAGES) {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(ciWait(5000));

      // Scroll aggressively to load more cards
      for (let i = 0; i < 12; i++) {
        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(ciWait(1200));
      }

      const items = await page.evaluate(() => {
        const r = [];
        const now = new Date();
        const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
        const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

        // Use the parent card container — the <p> tags with date/venue/price
        // are siblings of .event-card-link, not children of it
        const containers = document.querySelectorAll('[class*="map_experiment_event_card"]');
        const seen = new Set();

        containers.forEach(container => {
          const link = container.querySelector('a.event-card-link');
          if (!link) return;
          const href = link.href;
          if (seen.has(href)) return;
          seen.add(href);

          const h3 = container.querySelector('h3');
          if (!h3) return;
          const title = h3.textContent?.trim();
          if (!title || title.length < 5 || title.length > 150) return;

          const ps = Array.from(container.querySelectorAll('p')).map(p => p.textContent?.trim() || '');

          let dateText = '', timeText = '', venue = '', price = '';

          for (const pText of ps) {
            // Date/time: "Friday • 10:00 PM" or "Sat, Mar 14 • 11:00 PM" or "Today • 9:00 AM"
            if (pText.includes('\u2022') && !dateText) {
              const parts = pText.split('\u2022');
              const dayPart = parts[0].trim();
              const timePart = (parts[1] || '').trim();
              if (timePart) timeText = timePart;

              const dayLower = dayPart.toLowerCase();
              if (dayLower === 'today') {
                dateText = fmt(now);
              } else if (dayLower === 'tomorrow') {
                const tom = new Date(now); tom.setDate(tom.getDate() + 1);
                dateText = fmt(tom);
              } else {
                // Try "Sat, Mar 14" or "Tue, Mar 10" format
                const fullMatch = dayPart.match(/(\w{3}),?\s+(\w{3})\s+(\d{1,2})/);
                if (fullMatch) {
                  const monthIdx = MONTHS.indexOf(fullMatch[2].toLowerCase().slice(0, 3));
                  if (monthIdx >= 0) {
                    const day = parseInt(fullMatch[3], 10);
                    const year = now.getFullYear();
                    dateText = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  }
                } else {
                  // Day-of-week only: "Friday", "Saturday"
                  const dayIdx = DAYS.indexOf(dayLower);
                  if (dayIdx >= 0) {
                    const today = now.getDay();
                    let diff = dayIdx - today;
                    if (diff <= 0) diff += 7;
                    const target = new Date(now); target.setDate(target.getDate() + diff);
                    dateText = fmt(target);
                  }
                }
              }
            }
            // Venue: "Brooklyn · MAMATACO" or "New York · Pioneer Works"
            if (pText.includes('\u00B7') && !venue) {
              const vParts = pText.split('\u00B7');
              venue = (vParts[1] || '').trim();
              if (!venue) venue = pText;
            }
            // Price: "From $0.00" or "$29.41"
            if (/^\$|^From \$/i.test(pText) && !price) {
              price = pText;
            }
          }

          r.push({ title, link: href, date: dateText, time: timeText, venue, price });
        });
        return r;
      });

      for (const item of items) {
        const key = item.title.toLowerCase().trim();
        if (seenTitles.has(key)) continue;
        seenTitles.add(key);
        allItems.push(item);
      }
      console.error(`Eventbrite (${url.split('/').slice(-2, -1)[0]}): ${items.length} cards`);
    } catch (e) {
      console.error(`Eventbrite error (${url}): ${e.message}`);
    } finally {
      await page.close();
    }
  }

  push(allItems, 'Eventbrite', 'Other', 'https://www.eventbrite.com');
  console.error(`Eventbrite total: ${allItems.length} unique events`);
}

// ---------------------------------------------------------------------------
// Source tracking & report
// ---------------------------------------------------------------------------

const sourceLog = [];

async function runSource(name, fn, browserOrNull) {
  const MAX_ATTEMPTS = IS_CI ? 2 : 1;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const before = events.length;
    const start = Date.now();
    let error = null;
    try {
      if (browserOrNull) await fn(browserOrNull);
      else await fn();
    } catch (e) {
      error = e.message;
    }
    const count = events.length - before;
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const datesExtracted = events.slice(before).filter(e => e.date && (/^\d{4}-\d{2}-\d{2}$/.test(e.date) || /^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/.test(e.date))).length;

    // Retry in CI if source errored or returned 0 results
    if (IS_CI && attempt < MAX_ATTEMPTS && (error || count === 0)) {
      // Remove any partial results from this failed attempt
      events.length = before;
      console.error(`⟳ ${name}: ${error ? 'error' : '0 results'}, retrying in 5s (attempt ${attempt}/${MAX_ATTEMPTS})...`);
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    sourceLog.push({ name, count, datesExtracted, elapsed, error });
    break;
  }
}

// ---------------------------------------------------------------------------
// PLAYWRIGHT SOURCE — Strand Bookstore
// ---------------------------------------------------------------------------

async function scrapeStrand(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto('https://www.strandbooks.com/events.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(ciWait(8000));

    const MONTHS_MAP = {
      january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
      july:'07',august:'08',september:'09',october:'10',november:'11',december:'12'
    };

    const items = await page.evaluate((monthsMap) => {
      const r = [];
      // Structure: ul.products > li.col-span-full (month sections)
      // Each col-span-full contains a month header ("March 2026") AND the event items
      // Event items are form.product-item with .event-date-day (day badge) and .product-item-link (title)
      const sections = document.querySelectorAll('ul.products > li.col-span-full');

      for (const section of sections) {
        const sectionText = section.textContent.replace(/\s+/g, ' ').trim();

        // Extract month/year from section header
        let currentMonth = '';
        let currentYear = '';
        const m = sectionText.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
        if (m) {
          currentMonth = m[1];
          currentYear = m[2];
        }

        // Find all event items within this month section
        const eventItems = section.querySelectorAll('form.product-item');
        for (const item of eventItems) {
          const nameEl = item.querySelector('.product-item-link');
          if (!nameEl) continue;
          const title = nameEl.textContent.trim();
          const link = nameEl.href || '';

          // Day badge: .event-date-day contains day-of-week + day number
          const dateBadge = item.querySelector('.event-date-day');
          let dayNum = 0;
          if (dateBadge) {
            const dayText = dateBadge.textContent.replace(/\s+/g, ' ').trim();
            const dm = dayText.match(/(\d{1,2})/);
            if (dm) dayNum = parseInt(dm[1], 10);
          }

          // Build ISO date from month context + day number
          let dateStr = '';
          if (currentMonth && currentYear && dayNum) {
            const mon = monthsMap[currentMonth.toLowerCase()];
            if (mon) dateStr = currentYear + '-' + mon + '-' + String(dayNum).padStart(2, '0');
          }

          if (title.length > 5 && title.length < 150) {
            r.push({ title, date: dateStr, venue: '', link });
          }
        }
      }
      return r;
    }, MONTHS_MAP);

    push(items, 'Strand Bookstore', 'Talk', 'https://www.strandbooks.com/events.html');
    console.error(`Strand Bookstore: ${items.length}`);
  } catch (e) { console.error('Strand Bookstore error:', e.message); }
  finally { await page.close(); }
}

// ---------------------------------------------------------------------------
// PLAYWRIGHT SOURCE — It's In Queens
// ---------------------------------------------------------------------------

async function scrapeItsInQueens(browser) {
  // Its In Queens uses Timely calendar (calendar ID 54713222)
  // The API blocks non-browser requests (TLS fingerprinting), so we use Playwright
  // to load the posterboard and scroll to trigger infinite-scroll API pagination
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  try {
    const allApiItems = [];
    let apiTotal = 0;

    // Intercept API responses containing event data
    page.on('response', async (resp) => {
      const url = resp.url();
      if (url.includes('/api/calendars/') && url.includes('/events') && !url.includes('/filters')) {
        try {
          const body = await resp.json();
          const items = body?.data?.items || [];
          apiTotal = body?.data?.total || apiTotal;
          for (const e of items) allApiItems.push(e);
        } catch (_) {}
      }
    });

    // Load posterboard — triggers first API call (6 items)
    await page.goto('https://events.timely.fun/jxrw1att/posterboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(ciWait(5000));

    // Scroll to bottom repeatedly to trigger infinite scroll pagination
    for (let i = 0; i < 15; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(ciWait(2000));
      if (allApiItems.length >= apiTotal && apiTotal > 0) break;
    }

    console.error(`  Its In Queens API: ${allApiItems.length} raw items (total: ${apiTotal})`);

    // Process collected API items
    const allItems = [];
    for (const e of allApiItems) {
      const title = (e.title || '').trim();
      if (!title || title.length < 3) continue;

      let date = '';
      if (e.start_datetime && /^\d{4}-\d{2}-\d{2}/.test(e.start_datetime)) {
        date = e.start_datetime.slice(0, 10);
      }

      const link = e.id && e.instance
        ? `https://itsinqueens.com/explore/events/#event=${e.id};instance=${e.instance}?popup=1&lang=en-US`
        : 'https://itsinqueens.com/explore/events/';

      let time = '';
      if (e.start_datetime) {
        const timePart = e.start_datetime.slice(11, 16);
        if (timePart && timePart !== '00:00') {
          const [h, m] = timePart.split(':').map(Number);
          const ampm = h >= 12 ? 'PM' : 'AM';
          const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
          time = `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
        }
      }

      const description = (e.description_short || '').replace(/<[^>]+>/g, '').trim().slice(0, 200);
      const venue = e.venue?.name || e.spaces?.[0]?.name || '';

      allItems.push({ title, link, date, time, description, venue });
    }

    push(allItems, 'Its In Queens', 'Other', 'https://itsinqueens.com/explore/events/');
    console.error(`Its In Queens: ${allItems.length}`);
  } catch (e) { console.error('Its In Queens error:', e.message); }
  finally { await page.close(); }
}

// ---------------------------------------------------------------------------
// National Arts Club (cheerio — list view, no browser needed)
// ---------------------------------------------------------------------------
async function scrapeNAC() {
  const MONTHS = { january:1,february:2,march:3,april:4,may:5,june:6,
    july:7,august:8,september:9,october:10,november:11,december:12 };
  const url = 'https://www.nacnyc.org/default.aspx?p=.NET_Calendar&noReset=yes&mtab=true&ssid=323485&qfilter=&startdate=&title=Events+Calendar&subtitle=&showfilter=&chgs=&view=l5';
  const { html } = await fetchHTML(url);
  const $ = cheerio.load(html);

  let currentDate = null;
  const items = [];

  $('tr').each((i, tr) => {
    const $tr = $(tr);
    // Date header row: "Tuesday, March 3, 2026"
    const dateLink = $tr.find('td.modCalWeekDayHeader a.calendarEventDateLink');
    if (dateLink.length) {
      const text = dateLink.text().trim();
      const m = text.match(/(\w+),\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/);
      if (m) {
        const mon = MONTHS[m[2].toLowerCase()];
        if (mon) currentDate = `${m[4]}-${String(mon).padStart(2,'0')}-${m[3].padStart(2,'0')}`;
      }
      return;
    }
    // Event row
    const eventLink = $tr.find('td.modCalWeekRow a[href*="EventView"]');
    if (eventLink.length && currentDate) {
      const title = eventLink.text().trim();
      const href = eventLink.attr('href') || '';
      const timeTd = $tr.find('td.modCalWeekRow font.smallerfont');
      const time = timeTd.length ? timeTd.text().trim() : '';
      // Skip recurring exhibitions and closure notices
      if (/exhibition/i.test(title)) return;
      if (/closed/i.test(title)) return;
      if (/will close/i.test(title)) return;
      if (/brunch\s*@/i.test(title)) return;
      if (title) items.push({ title, date: currentDate, time, link: href });
    }
  });

  push(items, 'National Arts Club', 'Other', 'https://www.nacnyc.org/arts-and-programs/events-calendar');
  console.error(`National Arts Club: ${items.length}`);
}

// ---------------------------------------------------------------------------
// McNally Jackson (Playwright — site blocks plain HTTP)
// ---------------------------------------------------------------------------
async function scrapeMcNally(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto('https://www.mcnallyjackson.com/event', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(ciWait(5000));

    const items = await page.evaluate(() => {
      const results = [];
      const contentDivs = document.querySelectorAll('div[class*="contents"]');
      for (const div of contentDivs) {
        const titleLink = div.querySelector('.views-field-title .field-content a');
        if (!titleLink) continue;
        const title = titleLink.textContent.trim();
        const href = titleLink.href;
        const fullText = div.textContent.trim();
        const dateMatch = fullText.match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{1,2}:\d{2}(?:am|pm))/i);
        let date = '';
        let time = '';
        if (dateMatch) {
          date = dateMatch[3] + '-' + dateMatch[1] + '-' + dateMatch[2];
          time = dateMatch[4];
        }
        if (title.length > 3) results.push({ title, date, time, link: href });
      }
      return results;
    });

    push(items, 'McNally Jackson', 'Talk', 'https://www.mcnallyjackson.com/event');
    console.error(`McNally Jackson: ${items.length}`);
  } catch (e) { console.error('McNally Jackson error:', e.message); }
  finally { await page.close(); }
}

function printReport() {
  console.error('\n' + '='.repeat(70));
  console.error('SCRAPE REPORT — General Events');
  console.error('='.repeat(70));
  console.error(`Date range: ${RANGE}`);
  console.error(`Total events: ${events.length}`);
  console.error('-'.repeat(70));
  console.error('Source'.padEnd(25) + 'Items'.padEnd(8) + 'Dates'.padEnd(8) + 'Time'.padEnd(8) + 'Method'.padEnd(10) + 'Status');
  console.error('-'.repeat(70));
  let failures = 0, zeroResults = 0;
  const jsNames = new Set(['Eventbrite', 'Strand Bookstore', 'Its In Queens', 'McNally Jackson']);
  for (const s of sourceLog) {
    const status = s.error ? `ERROR: ${s.error.slice(0, 35)}` : (s.count === 0 ? '⚠ ZERO' : '✓ OK');
    if (s.error) failures++;
    if (s.count === 0 && !s.error) zeroResults++;
    const method = jsNames.has(s.name) ? 'JS' : 'cheerio';
    console.error(
      s.name.padEnd(25) + String(s.count).padEnd(8) + String(s.datesExtracted).padEnd(8) +
      (s.elapsed + 's').padEnd(8) + method.padEnd(10) + status
    );
  }
  console.error('-'.repeat(70));
  if (failures > 0) console.error(`⛔ ${failures} source(s) had errors`);
  if (zeroResults > 0) console.error(`⚠  ${zeroResults} source(s) returned zero items`);
  const totalDates = sourceLog.reduce((n, s) => n + s.datesExtracted, 0);
  console.error(`📅 ${totalDates}/${events.length} events have specific dates`);
  console.error('='.repeat(70) + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  // Cheerio sources (fast, no browser)
  await runSource('doNYC', scrapeDoNYC);
  await runSource('The Skint', scrapeTheSkint);
  await runSource('Secret NYC', scrapeSecretNYC);
  await runSource('Brooklyn Paper', scrapeBrooklynPaper);
  await runSource('NYC Parks', scrapeNYCParks);
  await runSource('Playbill', scrapePlaybill);
  await runSource('National Arts Club', scrapeNAC);

  // Playwright sources (need JS rendering)
  let browser = null;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({
      headless: true,
      args: IS_CI ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] : [],
    });
    await runSource('Eventbrite', scrapeEventbrite, browser);
    await runSource('Strand Bookstore', scrapeStrand, browser);
    await runSource('Its In Queens', scrapeItsInQueens, browser);
    await runSource('McNally Jackson', scrapeMcNally, browser);
  } catch (e) {
    console.error('Playwright unavailable, skipping JS sources:', e.message);
  } finally {
    if (browser) await browser.close();
  }

  printReport();
  console.log(JSON.stringify(events, null, 2));
})();
