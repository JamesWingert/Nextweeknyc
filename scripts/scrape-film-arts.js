#!/usr/bin/env node
/**
 * Scrape NYC Film, Arts, Classical, Opera, Ballet & Museum Events
 *
 * Sources (24):
 *   FILM:       Metrograph [JS], Film Forum, IFC Center
 *   MUSEUMS:    The Met, Whitney, Guggenheim [JS], New Museum [JS],
 *               Neue Galerie, Frick (exhibitions), Queens Museum [dropped-403]
 *   CULTURAL:   BAM, Asia Society [dropped-cloudflare], Japan Society [JS],
 *               Brooklyn Museum [dropped-vercel], Moving Image [dropped-cloudflare]
 *   CLASSICAL:  NY Philharmonic [JS], Carnegie Hall [JS]
 *   OPERA:      Met Opera (calendar) [JS]
 *   BALLET:     NYC Ballet [JS]
 *   DANCE:      Joyce Theater [JS]
 *   MULTI:      Lincoln Center [JS], 92NY [JS]
 *
 * Uses cheerio by default, Playwright only where marked [JS].
 * Dropped sources are behind Cloudflare/Vercel security — noted for future fix.
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
  // Start: 1st of current month
  const start = new Date(y, m, 1);
  // End: last day of next month
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
// HTTP fetch (Node 18 compatible)
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

  // "March 5, 2026" or "Mar 5" or "Mar 5, 2026"
  const m1 = s.match(/^([a-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i);
  if (m1) {
    const mon = MONTHS[m1[1].toLowerCase()];
    if (mon !== undefined) {
      const day = parseInt(m1[2], 10);
      const y = m1[3] ? parseInt(m1[3], 10) : year;
      return `${y}-${String(mon+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }
  // "5 March 2026" or "5 Mar"
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
 * Parse "Through {date}" / "thru {date}" / "Ongoing" / "Oct 9, 2025 — May 4, 2026"
 * Returns "YYYY-MM-DD to YYYY-MM-DD" range string, or null.
 */
function parseThrough(str) {
  if (!str) return null;
  const s = str.trim().replace(/\s+/g, ' ');
  const year = new Date(WEEK.start).getFullYear();
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = fmt(new Date());

  // "Through April 5, 2026" / "thru March 12" / "through Sept"
  const throughMatch = s.match(/(?:through|thru)\s+(.+)/i);
  if (throughMatch) {
    const endStr = throughMatch[1].trim();
    const endDate = parseHumanDate(endStr);
    if (endDate) return `${today} to ${endDate}`;
    // "Through Sept" — just month, assume end of that month
    const MONTHS = {jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11};
    const monMatch = endStr.match(/^([a-z]+)$/i);
    if (monMatch) {
      const mon = MONTHS[monMatch[1].toLowerCase()];
      if (mon !== undefined) {
        const lastDay = new Date(year, mon + 1, 0);
        return `${today} to ${fmt(lastDay)}`;
      }
    }
    return null;
  }

  // "Oct 9, 2025 — May 4, 2026" or "Feb 12 - Apr 30, 2026"
  const rangeParts = s.split(/\s*[–—]\s*|\s+to\s+/i);
  if (rangeParts.length === 2) {
    const startDate = parseHumanDate(rangeParts[0].trim());
    const endDate = parseHumanDate(rangeParts[1].trim());
    if (startDate && endDate) return `${startDate} to ${endDate}`;
    // If only end parses (e.g. "Ongoing — May 4, 2026"), use today as start
    if (!startDate && endDate) return `${today} to ${endDate}`;
  }

  // "Ongoing" — no specific date, return null (will show as "Date TBD")
  if (/^ongoing$/i.test(s)) return null;

  return null;
}

function push(items, venue, category, fallbackUrl) {
  items.forEach(item => {
    let date = item.date || null;
    // Already a valid range?
    if (date && /^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/.test(date)) {
      // Keep as-is
    }
    // Already ISO single date?
    else if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      // Keep as-is
    } else if (date && /^\d{4}-\d{2}-\d{2}[T ]/.test(date)) {
      date = date.slice(0, 10);
    } else if (date) {
      // Try "Through..." / range pattern first
      let parsed = parseThrough(date);
      if (!parsed) {
        // Try single date
        parsed = parseHumanDate(date);
      }
      if (!parsed) {
        // Try the start of a range ("Tue Mar 10 - Sun Mar 15")
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
// CHEERIO SOURCES — Film
// ---------------------------------------------------------------------------

async function scrapeFilmForum(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto('https://filmforum.org/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const items = await page.evaluate(() => {
      const r = [], seen = new Set();
      // Grab all unique film links on the homepage
      document.querySelectorAll('a[href*="/film/"]').forEach(el => {
        const t = el.textContent?.trim();
        if (t && t.length > 3 && t.length < 120 && !seen.has(t.toLowerCase())
            && !/^(watch trailer|see all|more|film forum)/i.test(t)) {
          seen.add(t.toLowerCase());
          // Look for date context near the link
          const container = el.closest('article, [class*="card"], li, div, section, [class*="film"]');
          const containerText = container?.textContent?.replace(/\s+/g, ' ')?.trim() || '';
          let dateText = '';
          // "March 5 - March 12" or "March 5" or "through March 12"
          const throughMatch = containerText.match(/(through\s+[A-Za-z]+(?:\s+\d{1,2})?(?:\s*,?\s*\d{4})?)/i);
          if (throughMatch) dateText = throughMatch[1];
          if (!dateText) {
            const dateMatch = containerText.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:\s*[-–—]\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?\d{1,2})?(?:\s*,?\s*\d{4})?)/i);
            if (dateMatch) dateText = dateMatch[1];
          }
          r.push({ title: t, link: el.href || '', date: dateText });
        }
      });
      return r.slice(0, 25);
    });
    push(items, 'Film Forum', 'Film', 'https://filmforum.org');
    console.error(`Film Forum: ${items.length}`);
  } catch (e) { console.error('Film Forum error:', e.message); }
  finally { await page.close(); }
}

async function scrapeIFC() {
  try {
    // Use the showtimes page which has per-day structure
    const { html } = await fetchHTML('https://www.ifccenter.com/showtimes/');
    const $ = cheerio.load(html);
    const items = [];
    const MONTHS = {jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11};
    const year = new Date(WEEK.start).getFullYear();
    let currentDate = '';

    // IFC showtimes page has day headers like "Mon Mar 2" and film titles below
    $('h2, h3, h4, .showtime-day, [class*="day-header"]').each((_, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      // Day header: "Mon Mar 2" or "Monday, March 2"
      const dayMatch = text.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s+([A-Za-z]+)\s+(\d{1,2})/i);
      if (dayMatch) {
        const mon = MONTHS[dayMatch[1].toLowerCase()];
        if (mon !== undefined) {
          currentDate = `${year}-${String(mon+1).padStart(2,'0')}-${String(parseInt(dayMatch[2],10)).padStart(2,'0')}`;
        }
      }
    });

    // Also try the main page for film links with dates
    const { html: mainHtml } = await fetchHTML('https://www.ifccenter.com');
    const $main = cheerio.load(mainHtml);
    $main('a[href*="/films/"], a[href*="/series/"]').each((_, el) => {
      const title = $main(el).text().trim();
      const link = $main(el).attr('href') || '';
      const fullLink = link.startsWith('/') ? `https://www.ifccenter.com${link}` : link;
      // Look for date in parent container
      const container = $main(el).closest('li, article, div, [class*="film"]');
      const containerText = container.length ? container.text().replace(/\s+/g, ' ').trim() : '';
      let dateText = '';
      const dateMatch = containerText.match(/((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2})/i);
      if (dateMatch) dateText = dateMatch[1];
      if (!dateText && currentDate) dateText = currentDate;
      if (title && title.length > 3 && title.length < 100) items.push({ title, link: fullLink, date: dateText });
    });
    const seen = new Set();
    const deduped = items.filter(i => { const k = i.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    push(deduped, 'IFC Center', 'Film', 'https://www.ifccenter.com');
    console.error(`IFC Center: ${deduped.length}`);
  } catch (e) { console.error('IFC Center error:', e.message); }
}

// ---------------------------------------------------------------------------
// CHEERIO SOURCES — Museums & Art
// ---------------------------------------------------------------------------

async function scrapeTheMet() {
  try {
    const { html } = await fetchHTML('https://www.metmuseum.org/exhibitions');
    const $ = cheerio.load(html);
    const items = [];
    $('[class*="exhibition"], .card, .tile, article').each((_, el) => {
      const $el = $(el);
      const title = $el.find('h2, h3, h4, [class*="title"]').first().text().trim();
      const link = $el.find('a').first().attr('href') || '';
      const fullLink = link.startsWith('/') ? `https://www.metmuseum.org${link}` : link;
      // Date info: look for "Through {date}" or date range in card text
      const cardText = $el.text().replace(/\s+/g, ' ').trim();
      let dateText = '';
      // "Through April 5, 2026" or "Through September"
      const throughMatch = cardText.match(/(through\s+[A-Za-z]+(?:\s+\d{1,2})?(?:\s*,?\s*\d{4})?)/i);
      if (throughMatch) dateText = throughMatch[1];
      // "Month DD, YYYY–Month DD, YYYY" range
      if (!dateText) {
        const rangeMatch = cardText.match(/([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})\s*[–—-]\s*([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/);
        if (rangeMatch) dateText = `${rangeMatch[1]} – ${rangeMatch[2]}`;
      }
      if (title && title.length > 3 && title.length < 120 && !/^Exhibitions$/i.test(title))
        items.push({ title, link: fullLink, date: dateText });
    });
    const seen = new Set();
    const deduped = items.filter(i => { const k = i.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    push(deduped, 'The Met', 'Art', 'https://www.metmuseum.org/exhibitions');
    console.error(`The Met: ${deduped.length}`);
  } catch (e) { console.error('The Met error:', e.message); }
}

async function scrapeWhitney() {
  try {
    const { html } = await fetchHTML('https://whitney.org/exhibitions');
    const $ = cheerio.load(html);
    const items = [];
    $('[class*="exhibition"], .card, article, [class*="listing"]').each((_, el) => {
      const $el = $(el);
      const title = $el.find('h2, h3, h4, [class*="title"]').first().text().trim();
      const link = $el.find('a').first().attr('href') || '';
      const fullLink = link.startsWith('/') ? `https://whitney.org${link}` : link;
      // Date info: "Through Mar 9, 2026" or date range in card text
      const cardText = $el.text().replace(/\s+/g, ' ').trim();
      let dateText = '';
      const throughMatch = cardText.match(/(through\s+[A-Za-z]+(?:\s+\d{1,2})?(?:\s*,?\s*\d{4})?)/i);
      if (throughMatch) dateText = throughMatch[1];
      if (!dateText) {
        const rangeMatch = cardText.match(/([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})\s*[–—-]\s*([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/);
        if (rangeMatch) dateText = `${rangeMatch[1]} – ${rangeMatch[2]}`;
      }
      if (title && title.length > 3 && title.length < 120) items.push({ title, link: fullLink, date: dateText });
    });
    const seen = new Set();
    const deduped = items.filter(i => { const k = i.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    push(deduped, 'Whitney Museum', 'Art', 'https://whitney.org/exhibitions');
    console.error(`Whitney: ${deduped.length}`);
  } catch (e) { console.error('Whitney error:', e.message); }
}

async function scrapeNeueGalerie() {
  try {
    const { html } = await fetchHTML('https://www.neuegalerie.org/exhibitions');
    const $ = cheerio.load(html);
    const items = [];
    const seen = new Set();
    $('a[href*="/exhibitions/"]').each((_, el) => {
      const $el = $(el);
      const title = $el.text().trim();
      const link = $el.attr('href') || '';
      const fullLink = link.startsWith('/') ? `https://www.neuegalerie.org${link}` : link;
      // Look for date in sibling/nearby elements
      const container = $el.closest('li, article, div, [class*="exhibition"]');
      const dateEl = container.length ? container.find('[class*="date"]').first().text().trim() : '';
      // Also check text after the link for date patterns
      const containerText = container.length ? container.text().replace(/\s+/g, ' ').trim() : '';
      let dateText = dateEl;
      if (!dateText) {
        // "Oct 9, 2025 — May 4, 2026" or "Ongoing"
        const rangeMatch = containerText.match(/([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})\s*[–—]\s*([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/);
        if (rangeMatch) dateText = `${rangeMatch[1]} – ${rangeMatch[2]}`;
        else {
          const throughMatch = containerText.match(/(through\s+[A-Za-z]+(?:\s+\d{1,2})?(?:\s*,?\s*\d{4})?)/i);
          if (throughMatch) dateText = throughMatch[1];
        }
      }
      if (title && title.length > 5 && title.length < 120
          && !seen.has(title.toLowerCase())
          && !/^(exhibitions?|current|upcoming|past|view all)/i.test(title)) {
        seen.add(title.toLowerCase());
        items.push({ title, link: fullLink, date: dateText });
      }
    });
    push(items, 'Neue Galerie', 'Art', 'https://www.neuegalerie.org/exhibitions');
    console.error(`Neue Galerie: ${items.length}`);
  } catch (e) { console.error('Neue Galerie error:', e.message); }
}

async function scrapeFrick(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto('https://www.frick.org/exhibitions', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const items = await page.evaluate(() => {
      const r = [], seen = new Set();
      document.querySelectorAll('a[href*="/exhibitions/"]').forEach(el => {
        const t = el.textContent?.trim();
        if (t && t.length > 5 && t.length < 120 && !seen.has(t.toLowerCase())
            && !/^(exhibitions?|current|upcoming|past|virtual|view|read more|all past|explore)/i.test(t)) {
          seen.add(t.toLowerCase());
          // Look for date in parent container
          const card = el.closest('article, [class*="card"], li, div, section');
          const cardText = card?.textContent?.replace(/\s+/g, ' ')?.trim() || '';
          let dateText = '';
          const throughMatch = cardText.match(/(through\s+[A-Za-z]+(?:\s+\d{1,2})?(?:\s*,?\s*\d{4})?)/i);
          if (throughMatch) dateText = throughMatch[1];
          if (!dateText) {
            const rangeMatch = cardText.match(/([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})\s*[–—-]\s*([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/);
            if (rangeMatch) dateText = `${rangeMatch[1]} – ${rangeMatch[2]}`;
          }
          r.push({ title: t, link: el.href, date: dateText });
        }
      });
      return r;
    });
    push(items, 'The Frick Collection', 'Art', 'https://www.frick.org/exhibitions');
    console.error(`The Frick: ${items.length}`);
  } catch (e) { console.error('The Frick error:', e.message); }
  finally { await page.close(); }
}

async function scrapeBAM() {
  try {
    const { html } = await fetchHTML('https://www.bam.org');
    const $ = cheerio.load(html);
    const items = [];
    // BAM uses blocks with class patterns like bam-block-2x4, bam-block-2x2, etc.
    // Each block has a title (h2/h3) and a date element with class containing "date"
    // Strategy: find all date-containing elements, then find the nearest title
    $('[class*="date"]').each((_, el) => {
      const $el = $(el);
      const dateText = $el.text().trim();
      if (!dateText || dateText.length > 60 || /^(date|filter)/i.test(dateText)) return;
      // Skip hover duplicates and mobile duplicates
      const cls = $el.attr('class') || '';
      if (cls.includes('hover') || cls.includes('mobile')) return;
      // Walk up to find the containing block
      const block = $el.closest('[class*="bam-block"], [class*="module"], article, [class*="event"], a[href]');
      if (!block.length) return;
      const title = block.find('h2, h3, h4, [class*="title"]').first().text().trim();
      const link = block.closest('a').attr('href') || block.find('a').first().attr('href') || '';
      const fullLink = link.startsWith('/') ? `https://www.bam.org${link}` : link;
      if (title && title.length > 3 && title.length < 120) {
        items.push({ title, link: fullLink, date: dateText });
      }
    });
    // Fallback: also grab eventInfo blocks
    if (items.length < 5) {
      $('.eventInfo, [class*="eventInfo"]').each((_, el) => {
        const $el = $(el);
        const container = $el.closest('a, article, [class*="card"], li, div').first();
        const title = container.find('h2, h3, h4, [class*="title"]').first().text().trim()
          || $el.find('h2, h3, h4').first().text().trim();
        const link = container.closest('a').attr('href') || container.find('a').first().attr('href') || '';
        const fullLink = link.startsWith('/') ? `https://www.bam.org${link}` : link;
        // Extract date from the parent text
        const parentText = container.text().replace(/\s+/g, ' ').trim();
        let dateText = '';
        // "Thu, Mar 12, 2026" or "Feb 27—Mar 3, 2026" or "Apr 19—May 17, 2026"
        const dateMatch = parentText.match(/((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:\s*,?\s*\d{4})?)/i);
        if (dateMatch) dateText = dateMatch[1];
        if (!dateText) {
          const rangeMatch = parentText.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2})\s*[\u2014\u2013-]\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:\s*,?\s*\d{4})?)/i);
          if (rangeMatch) dateText = `${rangeMatch[1]}\u2014${rangeMatch[2]}`;
        }
        if (title && title.length > 3 && title.length < 120) items.push({ title, link: fullLink, date: dateText });
      });
    }
    const seen = new Set();
    const deduped = items.filter(i => { const k = i.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    push(deduped, 'BAM', 'Music/Performing Arts', 'https://www.bam.org');
    console.error(`BAM: ${deduped.length}`);
  } catch (e) { console.error('BAM error:', e.message); }
}

// ---------------------------------------------------------------------------
// PLAYWRIGHT SOURCES — need JS rendering
// ---------------------------------------------------------------------------

async function scrapeMetrograph(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto('https://metrograph.com/calendar/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const items = await page.evaluate(() => {
      const r = [], seen = new Set();
      const MONTHS = {jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11};
      const year = new Date().getFullYear();

      // The selected day tab has the current date — "Today March 2" or "Tuesday March 3"
      // Find the selected day-selector-day to get the date for all films shown
      let currentDate = '';
      const selectedDay = document.querySelector('.day-selector-day.selected, a.day-selector-day.selected');
      if (selectedDay) {
        const monthEl = selectedDay.textContent?.replace(/\s+/g, ' ')?.trim() || '';
        // "TodayMarch2" or "TuesdayMarch3" — extract month + day
        const dayMatch = monthEl.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s*(\d{1,2})/i);
        if (dayMatch) {
          const mon = MONTHS[dayMatch[1].toLowerCase()];
          if (mon !== undefined) {
            currentDate = `${year}-${String(mon+1).padStart(2,'0')}-${String(parseInt(dayMatch[2],10)).padStart(2,'0')}`;
          }
        }
      }
      // Fallback: use today's date
      if (!currentDate) {
        const now = new Date();
        currentDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      }

      // Films are shown as links to /film/ pages
      document.querySelectorAll('[class*="film"], [class*="screening"], a[href*="/film/"]').forEach(el => {
        const titleEl = el.querySelector('h2, h3, h4, .title, [class*="title"]');
        const t = titleEl?.textContent?.trim()
          || (el.tagName === 'A' ? el.textContent?.trim() : '');
        const link = el.closest('a')?.href || el.querySelector('a')?.href || '';
        if (t && t.length > 3 && t.length < 100 && !seen.has(t.toLowerCase())
            && !/^(calendar|schedule|today|this week|view calendar|sign in|showtimes)/i.test(t)) {
          seen.add(t.toLowerCase());
          r.push({ title: t, link, date: currentDate });
        }
      });
      return r.slice(0, 30);
    });
    push(items, 'Metrograph', 'Film', 'https://metrograph.com/calendar/');
    console.error(`Metrograph: ${items.length}`);
  } catch (e) { console.error('Metrograph error:', e.message); }
  finally { await page.close(); }
}

async function scrapeGuggenheim(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto('https://www.guggenheim.org/exhibitions', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const items = await page.evaluate(() => {
      const r = [], seen = new Set();
      // Each exhibition card — look for links + nearby date text
      document.querySelectorAll('a[href*="/exhibition/"]').forEach(el => {
        const t = el.textContent?.trim();
        const card = el.closest('article, [class*="card"], li, div, section');
        // Try time[datetime] first
        const timeEl = card?.querySelector('time[datetime]');
        let dateText = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
        // If no time element, look for "Through {date}" in card text
        if (!dateText && card) {
          const cardText = card.textContent?.replace(/\s+/g, ' ')?.trim() || '';
          const throughMatch = cardText.match(/(through\s+[A-Za-z]+(?:\s+\d{1,2})?(?:\s*,?\s*\d{4})?)/i);
          if (throughMatch) dateText = throughMatch[1];
          // Also try "Month DD, YYYY–Month DD, YYYY"
          if (!dateText) {
            const rangeMatch = cardText.match(/([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})\s*[–—-]\s*([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/);
            if (rangeMatch) dateText = `${rangeMatch[1]} – ${rangeMatch[2]}`;
          }
          // "Month DD–Month DD, YYYY" (shared year)
          if (!dateText) {
            const sharedYearMatch = cardText.match(/([A-Z][a-z]+\s+\d{1,2})\s*[–—-]\s*([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/);
            if (sharedYearMatch) dateText = `${sharedYearMatch[1]} – ${sharedYearMatch[2]}`;
          }
        }
        if (t && t.length > 3 && t.length < 120 && !seen.has(t.toLowerCase())) {
          seen.add(t.toLowerCase());
          r.push({ title: t, link: el.href, date: dateText });
        }
      });
      return r.slice(0, 15);
    });
    push(items, 'Guggenheim', 'Art', 'https://www.guggenheim.org/exhibitions');
    console.error(`Guggenheim: ${items.length}`);
  } catch (e) { console.error('Guggenheim error:', e.message); }
  finally { await page.close(); }
}

async function scrapeNewMuseum(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  try {
    await page.goto('https://www.newmuseum.org/exhibitions', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const items = await page.evaluate(() => {
      const r = [], seen = new Set();
      // Try exhibition links first
      document.querySelectorAll('a[href*="/exhibition"]').forEach(el => {
        const t = el.textContent?.trim();
        if (t && t.length > 5 && t.length < 120 && !seen.has(t.toLowerCase())
            && !/^(exhibitions?|view|see all)/i.test(t)) {
          seen.add(t.toLowerCase());
          // Look for date in parent container
          const card = el.closest('article, [class*="card"], li, div, section');
          const cardText = card?.textContent?.replace(/\s+/g, ' ')?.trim() || '';
          let dateText = '';
          const throughMatch = cardText.match(/(through\s+[A-Za-z]+(?:\s+\d{1,2})?(?:\s*,?\s*\d{4})?)/i);
          if (throughMatch) dateText = throughMatch[1];
          if (!dateText) {
            const rangeMatch = cardText.match(/([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})\s*[–—-]\s*([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/);
            if (rangeMatch) dateText = `${rangeMatch[1]} – ${rangeMatch[2]}`;
          }
          r.push({ title: t, link: el.href, date: dateText });
        }
      });
      // Fallback: h2/h3 headings
      if (r.length === 0) {
        document.querySelectorAll('h2, h3').forEach(el => {
          const t = el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href || '';
          if (t && t.length > 5 && t.length < 120 && !seen.has(t.toLowerCase())
              && !/^(exhibitions?|current|upcoming|past)/i.test(t)) {
            seen.add(t.toLowerCase());
            const card = el.closest('article, [class*="card"], li, div, section');
            const cardText = card?.textContent?.replace(/\s+/g, ' ')?.trim() || '';
            let dateText = '';
            const throughMatch = cardText.match(/(through\s+[A-Za-z]+(?:\s+\d{1,2})?(?:\s*,?\s*\d{4})?)/i);
            if (throughMatch) dateText = throughMatch[1];
            r.push({ title: t, link, date: dateText });
          }
        });
      }
      return r.slice(0, 15);
    });
    push(items, 'New Museum', 'Art', 'https://www.newmuseum.org/exhibitions');
    console.error(`New Museum: ${items.length}`);
  } catch (e) { console.error('New Museum error:', e.message); }
  finally { await page.close(); }
}

async function scrapeJapanSociety(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto('https://www.japansociety.org/events', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const items = await page.evaluate(() => {
      const r = [], seen = new Set();
      document.querySelectorAll('a[href*="/events/"]').forEach(el => {
        const t = el.textContent?.trim();
        if (t && t.length > 5 && t.length < 120 && !seen.has(t.toLowerCase())
            && !/^(events|calendar|show filter)/i.test(t)) {
          seen.add(t.toLowerCase());
          // Look for date in parent card text
          const card = el.closest('article, [class*="card"], li, div, section');
          const cardText = card?.textContent?.replace(/\s+/g, ' ')?.trim() || '';
          let dateText = '';
          // "Mar 3, 2026, 10:30 am" or "March 15, 2026"
          const dateMatch = cardText.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\d{4})/i);
          if (dateMatch) dateText = dateMatch[1];
          // Also try "Through {date}"
          if (!dateText) {
            const throughMatch = cardText.match(/(through\s+[A-Za-z]+(?:\s+\d{1,2})?(?:\s*,?\s*\d{4})?)/i);
            if (throughMatch) dateText = throughMatch[1];
          }
          r.push({ title: t, link: el.href, date: dateText });
        }
      });
      return r.slice(0, 15);
    });
    push(items, 'Japan Society', 'Art', 'https://www.japansociety.org/events');
    console.error(`Japan Society: ${items.length}`);
  } catch (e) { console.error('Japan Society error:', e.message); }
  finally { await page.close(); }
}

async function scrapeNYPhil(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto('https://nyphil.org/calendar', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const items = await page.evaluate(() => {
      const r = [];
      // Each li.calendar-performance has date-holder + details with title
      document.querySelectorAll('li.calendar-performance').forEach(el => {
        const dateHolder = el.querySelector('.calendar-performance__date-holder');
        const rawDate = dateHolder?.textContent?.trim().replace(/\s+/g, ' ') || '';
        const titleEl = el.querySelector('.calendar-performance__title') || el.querySelector('a[href*="/concerts-tickets/"]');
        const t = titleEl?.textContent?.trim();
        const link = el.querySelector('a[href*="/concerts-tickets/"]')?.href || '';
        if (t && t.length > 3 && t.length < 150
            && !/^(concerts|calendar|tickets|subscriptions|special offers)/i.test(t)) {
          r.push({ title: t, link, date: rawDate });
        }
      });
      return r.slice(0, 30);
    });
    push(items, 'New York Philharmonic', 'Classical Music', 'https://nyphil.org/calendar');
    console.error(`NY Philharmonic: ${items.length}`);
  } catch (e) { console.error('NY Philharmonic error:', e.message); }
  finally { await page.close(); }
}

async function scrapeCarnegieHall(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(35000);
  try {
    let apiData = null;
    page.on('response', async (response) => {
      const url = response.url();
      const ct = response.headers()['content-type'] || '';
      if (ct.includes('json') && (url.includes('event') || url.includes('calendar') || url.includes('api'))) {
        try {
          const text = await response.text();
          const json = JSON.parse(text);
          const arr = Array.isArray(json) ? json : (json.events || json.data || json.results || json.items || null);
          if (Array.isArray(arr) && arr.length > 0 && !apiData) apiData = arr;
        } catch(e) {}
      }
    });
    await page.goto('https://www.carnegiehall.org/calendar', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    // Scroll to trigger lazy loading
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(4000);

    if (apiData && apiData.length > 0) {
      const items = apiData.slice(0, 30).map(e => ({
        title: e.title || e.name || e.eventTitle || '',
        link: e.url || e.link || e.detailUrl || 'https://www.carnegiehall.org/calendar',
        date: e.date || e.startDate || e.eventDate || e.performanceDate || '',
        time: e.time || e.startTime || '',
      })).filter(e => e.title.length > 3);
      push(items, 'Carnegie Hall', 'Classical Music', 'https://www.carnegiehall.org/calendar');
      console.error(`Carnegie Hall (API): ${items.length}`);
    } else {
      // DOM fallback — try to extract dates from text near event titles
      const items = await page.evaluate(() => {
        const r = [], seen = new Set();
        const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};
        const year = new Date().getFullYear();

        // Look for event cards/rows with title + date
        document.querySelectorAll('h3, [class*="event-title"], [class*="listing"], article, [class*="card"]').forEach(el => {
          const t = el.textContent?.trim();
          if (!t || t.length < 5 || t.length > 150) return;
          if (/^(calendar|filter|search|subscribe|upcoming|location|event type|genre|date|narrow|edit)/i.test(t)) return;

          // Look for date in parent/sibling context
          const card = el.closest('article, [class*="card"], li, div, a');
          const cardText = card?.textContent?.replace(/\s+/g, ' ')?.trim() || '';
          let dateText = '';
          const dateMatch = cardText.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:\s*,?\s*\d{4})?)/i);
          if (dateMatch) dateText = dateMatch[1];

          const title = el.querySelector('a')?.textContent?.trim() || t.slice(0, 100);
          const link = el.closest('a')?.href || el.querySelector('a')?.href || 'https://www.carnegiehall.org/calendar';

          if (title.length > 4 && !seen.has(title.toLowerCase())) {
            seen.add(title.toLowerCase());
            r.push({ title, link, date: dateText });
          }
        });
        return r.slice(0, 25);
      });
      push(items, 'Carnegie Hall', 'Classical Music', 'https://www.carnegiehall.org/calendar');
      console.error(`Carnegie Hall (DOM): ${items.length}`);
    }
  } catch (e) { console.error('Carnegie Hall error:', e.message); }
  finally { await page.close(); }
}

async function scrapeMetOpera(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  try {
    await page.goto('https://www.metopera.org/calendar/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    // Click "All Events" to get the list view
    await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a, button, [ng-click]'));
      for (const l of links) {
        if (l.textContent?.trim().includes('All Events')) { l.click(); break; }
      }
    });
    await page.waitForTimeout(5000);
    const items = await page.evaluate(() => {
      const r = [], seen = new Set();
      const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
      const year = new Date().getFullYear();
      const body = document.body.innerText;
      const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      let currentDate = '';
      for (const line of lines) {
        // Date header: "SAT, MAR 7" or "MON, MAR 9"
        const dm = line.match(/^(?:MON|TUE|WED|THU|FRI|SAT|SUN),?\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{1,2})$/i);
        if (dm) {
          const mon = MONTHS[dm[1].toLowerCase()];
          if (mon !== undefined) {
            currentDate = `${year}-${String(mon+1).padStart(2,'0')}-${String(parseInt(dm[2],10)).padStart(2,'0')}`;
          }
          continue;
        }
        if (!currentDate) continue;
        if (line.length < 4 || line.length > 150) continue;
        // Skip known non-title lines
        if (/^(ON STAGE|ON RADIO|IN CINEMAS|BACKSTAGE|ALL EVENTS|ONSTAGE|Page|Date|Previous|Next|Enter|Filter|Subscribe|Buy|View|Calendar|FIND STATION|MORE PERFORMANCE|LAST PERFORMANCE|TO |SuMoTu|PrevNext)/i.test(line)) continue;
        if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(line)) continue;
        // Skip ALL CAPS lines (composer names like "RICHARD WAGNER", "GIACOMO PUCCINI")
        if (/^[A-Z\s.,'()-]+$/.test(line) && line.length < 50) continue;
        // Skip cast/conductor lines (contain semicolons)
        if (line.includes(';')) continue;
        // Skip "APPLICABLE NOT" type lines
        if (/^APPLICABLE/i.test(line)) continue;
        // This should be an event title
        const key = line.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          r.push({ title: line, date: currentDate, link: 'https://www.metopera.org/calendar/' });
        }
      }
      return r.slice(0, 25);
    });
    push(items, 'Metropolitan Opera', 'Opera', 'https://www.metopera.org/calendar/');
    console.error(`Met Opera: ${items.length}`);
  } catch (e) { console.error('Met Opera error:', e.message); }
  finally { await page.close(); }
}

async function scrapeNYCB(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto('https://www.nycballet.com/season-and-tickets/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const items = await page.evaluate(() => {
      const r = [], seen = new Set();
      // Each slide has .season-slide__title + .season-slide__start-date / __end-date
      document.querySelectorAll('[class*="season-slide"]').forEach(el => {
        const titleEl = el.querySelector('.season-slide__title, h3');
        const t = titleEl?.textContent?.trim();
        const startDate = el.querySelector('.season-slide__start-date')?.textContent?.trim() || '';
        const endDate = el.querySelector('.season-slide__end-date')?.textContent?.trim() || '';
        const link = el.querySelector('a')?.href || '';
        const dateStr = startDate + (endDate ? ' - ' + endDate : '');
        if (t && t.length > 3 && t.length < 120 && !seen.has(t.toLowerCase())
            && !/^(season|tickets|subscribe|spring|winter|fall)/i.test(t)) {
          seen.add(t.toLowerCase());
          r.push({ title: t, link, date: dateStr });
        }
      });
      return r.slice(0, 15);
    });
    push(items, 'New York City Ballet', 'Ballet', 'https://www.nycballet.com/season-and-tickets/');
    console.error(`NYCB: ${items.length}`);
  } catch (e) { console.error('NYCB error:', e.message); }
  finally { await page.close(); }
}

async function scrapeJoyce(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto('https://www.joyce.org/performances', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const items = await page.evaluate(() => {
      const r = [];
      // Each .eventCard has h3.title for name, a.desc for link, .top-date > .start for date
      document.querySelectorAll('.eventCard, [class*="eventCard"]').forEach(card => {
        const titleEl = card.querySelector('h3.title, h3, [class*="title"]');
        const t = titleEl?.textContent?.trim();
        const linkEl = card.querySelector('a.desc, a.image, a[href*="/performances/"]');
        const link = linkEl?.href || card.querySelector('a')?.href || '';
        const startDate = card.querySelector('.top-date .start')?.textContent?.trim() || '';
        const endDate = card.querySelector('.top-date .end')?.textContent?.trim() || '';
        const rawDate = startDate + (endDate ? ' - ' + endDate : '');
        if (t && t.length > 2 && t.length < 120 && !/^(performances|agenda)/i.test(t)) {
          r.push({ title: t, link, date: rawDate });
        }
      });
      const seen = new Set();
      return r.filter(i => { const k = i.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 15);
    });
    push(items, 'The Joyce Theater', 'Dance', 'https://www.joyce.org/performances');
    console.error(`Joyce Theater: ${items.length}`);
  } catch (e) { console.error('Joyce Theater error:', e.message); }
  finally { await page.close(); }
}

async function scrapeLincolnCenter(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto('https://www.lincolncenter.org/calendar', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const items = await page.evaluate(() => {
      const r = [], seen = new Set();
      document.querySelectorAll('[class*="event"], .card, article').forEach(el => {
        const t = el.querySelector('h2, h3, h4, [class*="title"]')?.textContent?.trim();
        const link = el.querySelector('a')?.href;
        const dateEl = el.querySelector('[class*="date"]');
        const rawDate = dateEl?.textContent?.trim().replace(/\s+/g, ' ') || '';
        if (t && t.length > 3 && t.length < 120 && !seen.has(t.toLowerCase())
            && !/^(upcoming|calendar)/i.test(t)) {
          seen.add(t.toLowerCase());
          r.push({ title: t, link, date: rawDate });
        }
      });
      return r.slice(0, 25);
    });
    push(items, 'Lincoln Center', 'Music/Performing Arts', 'https://www.lincolncenter.org/calendar');
    console.error(`Lincoln Center: ${items.length}`);
  } catch (e) { console.error('Lincoln Center error:', e.message); }
  finally { await page.close(); }
}

async function scrapeMovingImage(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto('https://movingimage.org/whats-on/events/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const items = await page.evaluate(() => {
      const r = [], seen = new Set();
      document.querySelectorAll('a[href*="/event/"], a[href*="/events/"], article, [class*="event"]').forEach(el => {
        const titleEl = el.querySelector('h2, h3, h4, [class*="title"]') || (el.tagName === 'A' ? el : null);
        const t = titleEl?.textContent?.trim();
        const link = el.closest('a')?.href || el.querySelector('a')?.href || '';
        const dateEl = el.querySelector('time, [class*="date"]');
        const rawDate = dateEl?.getAttribute('datetime') || dateEl?.textContent?.trim() || '';
        if (t && t.length > 5 && t.length < 120 && !seen.has(t.toLowerCase())
            && !/^(events?|calendar|what.s on|filter)/i.test(t)) {
          seen.add(t.toLowerCase());
          r.push({ title: t, link, date: rawDate });
        }
      });
      return r.slice(0, 20);
    });
    push(items, 'Museum of the Moving Image', 'Film', 'https://movingimage.org/whats-on/events/');
    console.error(`Moving Image: ${items.length}`);
  } catch (e) { console.error('Moving Image error:', e.message); }
  finally { await page.close(); }
}

async function scrape92NY(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  try {
    await page.goto('https://www.92ny.org/whats-on/events', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    // Scroll to trigger lazy loading
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(3000);
    const items = await page.evaluate(() => {
      const r = [], seen = new Set();
      document.querySelectorAll('a[href*="/event/"]').forEach(a => {
        const t = a.textContent?.trim();
        if (t && t.length > 5 && t.length < 150 && !seen.has(t.toLowerCase())
            && !/^(members|in person|virtual|save)/i.test(t)) {
          seen.add(t.toLowerCase());
          // Look for date in parent card
          const card = a.closest('article, [class*="card"], li, div, section');
          const cardText = card?.textContent?.replace(/\s+/g, ' ')?.trim() || '';
          let dateText = '';
          const dateMatch = cardText.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:\s*,?\s*\d{4})?)/i);
          if (dateMatch) dateText = dateMatch[1];
          r.push({ title: t, link: a.href, date: dateText });
        }
      });
      return r.slice(0, 20);
    });
    push(items, '92NY', 'Music/Performing Arts', 'https://www.92ny.org/whats-on/events');
    console.error(`92NY: ${items.length}`);
  } catch (e) { console.error('92NY error:', e.message); }
  finally { await page.close(); }
}

// ---------------------------------------------------------------------------
// Source tracking & report
// ---------------------------------------------------------------------------

const sourceLog = [];
const JS_SOURCES = new Set([
  'Film Forum', 'Metrograph', 'The Frick', 'Guggenheim', 'New Museum', 'Japan Society',
  'NY Philharmonic', 'Carnegie Hall', 'Met Opera', 'NYCB',
  'Joyce Theater', 'Lincoln Center', 'Moving Image', '92NY'
]);

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

function printReport() {
  console.error('\n' + '='.repeat(70));
  console.error('SCRAPE REPORT — Film/Arts');
  console.error('='.repeat(70));
  console.error(`Date range: ${RANGE}`);
  console.error(`Total events: ${events.length}`);
  console.error('-'.repeat(70));
  console.error('Source'.padEnd(25) + 'Items'.padEnd(8) + 'Dates'.padEnd(8) + 'Time'.padEnd(8) + 'Method'.padEnd(10) + 'Status');
  console.error('-'.repeat(70));
  let failures = 0, zeroResults = 0;
  for (const s of sourceLog) {
    const status = s.error ? `ERROR: ${s.error.slice(0, 35)}` : (s.count === 0 ? '⚠ ZERO' : '✓ OK');
    if (s.error) failures++;
    if (s.count === 0 && !s.error) zeroResults++;
    const method = JS_SOURCES.has(s.name) ? 'JS' : 'cheerio';
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
  console.error('\nDropped sources (blocked):');
  console.error('  Brooklyn Museum — Vercel Security Checkpoint');
  console.error('  MoMA — Cloudflare (try /calendar/exhibitions)');
  console.error('  Asia Society — Cloudflare');
  console.error('  Queens Museum — 403 Forbidden');
  console.error('='.repeat(70) + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  // Cheerio sources (fast, no browser needed)
  await runSource('IFC Center', scrapeIFC);
  await runSource('The Met', scrapeTheMet);
  await runSource('Whitney', scrapeWhitney);
  await runSource('Neue Galerie', scrapeNeueGalerie);
  await runSource('BAM', scrapeBAM);

  // Playwright sources
  let browser = null;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true });

    await runSource('Film Forum', scrapeFilmForum, browser);
    await runSource('Metrograph', scrapeMetrograph, browser);
    await runSource('The Frick', scrapeFrick, browser);
    await runSource('Guggenheim', scrapeGuggenheim, browser);
    await runSource('New Museum', scrapeNewMuseum, browser);
    await runSource('Japan Society', scrapeJapanSociety, browser);
    await runSource('NY Philharmonic', scrapeNYPhil, browser);
    await runSource('Carnegie Hall', scrapeCarnegieHall, browser);
    await runSource('Met Opera', scrapeMetOpera, browser);
    await runSource('NYCB', scrapeNYCB, browser);
    await runSource('Joyce Theater', scrapeJoyce, browser);
    await runSource('Lincoln Center', scrapeLincolnCenter, browser);
    await runSource('Moving Image', scrapeMovingImage, browser);
    await runSource('92NY', scrape92NY, browser);
  } catch (e) {
    console.error('Playwright unavailable, skipping JS sources:', e.message);
  } finally {
    if (browser) await browser.close();
  }

  printReport();
  console.log(JSON.stringify(events, null, 2));
})();
