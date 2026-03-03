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
    events.push({
      title: (item.title || '').trim(),
      venue: item.venue || venue,
      date,
      category,
      url: item.link || item.url || fallbackUrl,
      ...(item.time ? { time: item.time } : {}),
      ...(item.description ? { description: item.description } : {}),
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

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + dayOffset);
    const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const url = `https://donyc.com/events/${y}/${m}/${day}`;

    try {
      const { html } = await fetchHTML(url);
      const $ = cheerio.load(html);
      const items = [];
      $('.ds-listing').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h3, .ds-listing-event-title').first().text().trim();
        const venue = $el.find('.ds-venue-name').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const fullLink = link.startsWith('/') ? `https://donyc.com${link}` : link;
        const time = $el.find('.ds-event-time').first().text().trim();
        if (title && title.length > 3) items.push({ title, venue, link: fullLink, time, date: dateStr });
      });
      push(items, 'doNYC', 'Other', url);
      console.error(`doNYC ${dateStr}: ${items.length}`);
    } catch (e) { console.error(`doNYC ${dateStr} error:`, e.message); }
  }
}

async function scrapeTheSkint() {
  const year = new Date(WEEK.start).getFullYear();
  // Homepage — daily picks (blog-post style, titles contain date info)
  try {
    const { html } = await fetchHTML('https://theskint.com/');
    const $ = cheerio.load(html);
    const items = [];
    $('article, .post').each((_, el) => {
      const $el = $(el);
      const title = $el.find('h2, h3, .entry-title').first().text().trim();
      const link = $el.find('a').first().attr('href') || '';
      if (title && title.length > 5 && title.length < 120) {
        // Try to extract date from title: "FRI-MON, 2/27-3/2: SKINT WEEKEND"
        let dateText = '';
        const mmddMatch = title.match(/(\d{1,2})\/(\d{1,2})/);
        if (mmddMatch) {
          dateText = `${year}-${String(parseInt(mmddMatch[1],10)).padStart(2,'0')}-${String(parseInt(mmddMatch[2],10)).padStart(2,'0')}`;
        }
        items.push({ title, link, date: dateText });
      }
    });
    push(items, 'The Skint', 'Other', 'https://theskint.com');
    console.error(`The Skint (home): ${items.length}`);
  } catch (e) { console.error('The Skint home error:', e.message); }

  // Ongoing events page — curated list of ongoing NYC events
  try {
    const { html } = await fetchHTML('https://theskint.com/ongoing-events/');
    const $ = cheerio.load(html);
    const items = [];
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const today = fmt(new Date());
    // Events are in paragraphs with bold titles and ► markers
    $('.entry-content p').each((_, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      const bold = $el.find('b, strong').first().text().trim();
      const link = $el.find('a').last().attr('href') || '';
      if (bold && bold.length > 3 && bold.length < 100 && text.length > 10) {
        // Extract "thru 3/8" or "thru 3/30" dates from text
        let dateText = '';
        const thruMatch = text.match(/thru\s+(\d{1,2})\/(\d{1,2})/i);
        if (thruMatch) {
          const endDate = `${year}-${String(parseInt(thruMatch[1],10)).padStart(2,'0')}-${String(parseInt(thruMatch[2],10)).padStart(2,'0')}`;
          dateText = `${today} to ${endDate}`;
        }
        items.push({ title: bold, link, description: text.slice(0, 200), date: dateText });
      }
    });
    push(items, 'The Skint', 'Other', 'https://theskint.com/ongoing-events/');
    console.error(`The Skint (ongoing): ${items.length}`);
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
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  try {
    await page.goto('https://www.eventbrite.com/d/ny--new-york/events--this-week/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    const items = await page.evaluate(() => {
      const r = [], seen = new Set();
      const now = new Date();
      const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

      document.querySelectorAll('[class*="event-card"], [class*="search-event"], article, [data-testid*="event"]').forEach(el => {
        const t = el.querySelector('h2, h3, h4, [class*="title"]')?.textContent?.trim();
        if (!t || t.length < 5 || t.length > 120) return;
        const key = t.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);

        const venue = el.querySelector('[class*="location"], [class*="venue"]')?.textContent?.trim();
        const link = el.querySelector('a')?.href;

        // Date is in a <p> tag like "Friday • 10:00 PM" or "Saturday • 9:00 PM"
        // Scan all p tags in the card for day-of-week patterns
        let dateText = '';
        el.querySelectorAll('p').forEach(p => {
          if (dateText) return;
          const pText = p.textContent?.trim() || '';
          // "Friday • 10:00 PM" or "Tomorrow • 7:00 PM" or "Today • 9:00 AM"
          const parts = pText.split('\u2022'); // bullet •
          if (parts.length < 2) return;
          const dayPart = parts[0].trim().toLowerCase();
          if (dayPart === 'today') {
            dateText = fmt(now);
          } else if (dayPart === 'tomorrow') {
            const tom = new Date(now); tom.setDate(tom.getDate() + 1);
            dateText = fmt(tom);
          } else {
            const dayIdx = DAYS.indexOf(dayPart);
            if (dayIdx >= 0) {
              const today = now.getDay();
              let diff = dayIdx - today;
              if (diff <= 0) diff += 7;
              const target = new Date(now); target.setDate(target.getDate() + diff);
              dateText = fmt(target);
            }
          }
        });

        // Also try time[datetime] as fallback
        if (!dateText) {
          const timeEl = el.querySelector('time[datetime]');
          if (timeEl) dateText = timeEl.getAttribute('datetime') || '';
        }

        r.push({ title: t, venue, link, date: dateText });
      });
      return r.slice(0, 25);
    });
    push(items, 'Eventbrite', 'Other', 'https://www.eventbrite.com');
    console.error(`Eventbrite: ${items.length}`);
  } catch (e) { console.error('Eventbrite error:', e.message); }
  finally { await page.close(); }
}

// ---------------------------------------------------------------------------
// Source tracking & report
// ---------------------------------------------------------------------------

const sourceLog = [];

async function runSource(name, fn, browserOrNull) {
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
  sourceLog.push({ name, count, datesExtracted, elapsed, error });
}

// ---------------------------------------------------------------------------
// PLAYWRIGHT SOURCE — Strand Bookstore
// ---------------------------------------------------------------------------

async function scrapeStrand(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto('https://www.strandbooks.com/events.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

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
  const jsNames = new Set(['Eventbrite', 'Strand Bookstore']);
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

  // Playwright sources (only Eventbrite truly needs JS)
  let browser = null;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true });
    await runSource('Eventbrite', scrapeEventbrite, browser);
    await runSource('Strand Bookstore', scrapeStrand, browser);
  } catch (e) {
    console.error('Playwright unavailable, skipping JS sources:', e.message);
  } finally {
    if (browser) await browser.close();
  }

  printReport();
  console.log(JSON.stringify(events, null, 2));
})();
