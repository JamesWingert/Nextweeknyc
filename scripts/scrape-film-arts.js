#!/usr/bin/env node
/**
 * Scrape NYC Film, Arts, Classical, Opera, Ballet & Museum Events
 *
 * Sources (26):
 *   FILM:       Metrograph [JS], Film Forum, IFC Center, Angelika [JS],
 *               Film at Lincoln Center [JS, Cloudflare — may fail]
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
  // Scrape both now_playing (with date ranges) and coming_soon pages via cheerio
  // The homepage lacks dates; the now_playing page has "Friday, Feb 27 – Thursday, March 12" etc.
  try {
    const items = [];
    const seen = new Set();

    // Helper to extract films from a Film Forum page
    async function scrapePage(url) {
      const { html } = await fetchHTML(url);
      const $ = cheerio.load(html);
      $('a[href*="/film/"]').each((_, el) => {
        const t = $(el).text().trim();
        if (!t || t.length < 4 || t.length > 120 || seen.has(t.toLowerCase())) return;
        if (/^(watch trailer|see all|more|film forum|showtimes|buy tickets)/i.test(t)) return;
        seen.add(t.toLowerCase());
        const href = $(el).attr('href') || '';
        const fullLink = href.startsWith('http') ? href : `https://filmforum.org${href}`;

        // Clean up Film Forum title quirks (e.g. "Ray'sDAYS" → "Ray's DAYS")
        const cleanedTitle = t.replace(/([a-z])([A-Z])/g, '$1 $2');

        // Walk up to find date context in parent containers
        let dateText = '';
        let container = $(el).parent();
        for (let i = 0; i < 8 && container.length; i++) {
          const text = container.text().replace(/\s+/g, ' ').trim();
          // "Friday, February 27 – Thursday, March 12" or "MUST END THURSDAY, MARCH 5"
          const rangeMatch = text.match(/((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}\s*[–—-]\s*(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s+)?(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+)?\d{1,2})/i);
          if (rangeMatch) { dateText = rangeMatch[1]; break; }
          // "MUST END THURSDAY, MARCH 5"
          const endMatch = text.match(/must end\s+\w+,?\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2})/i);
          if (endMatch) { dateText = endMatch[1]; break; }
          // Single date: "Opens March 6" or "March 15"
          const singleMatch = text.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}(?:\s*,?\s*\d{4})?)/i);
          if (singleMatch) { dateText = singleMatch[1]; break; }
          container = container.parent();
        }
        items.push({ title: cleanedTitle, link: fullLink, date: dateText });
      });
    }

    await scrapePage('https://filmforum.org/now_playing');
    await scrapePage('https://filmforum.org/coming_soon');

    push(items, 'Film Forum', 'Film', 'https://filmforum.org');
    console.error(`Film Forum: ${items.length}`);
  } catch (e) { console.error('Film Forum error:', e.message); }
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

async function scrapeFrick() {
  // The Frick has a Trumba JSON calendar feed — much richer than the RSS (which caps at ~7)
  try {
    const { html: raw } = await fetchHTML('https://www.trumba.com/calendars/frick2.json');
    const data = JSON.parse(raw);
    const items = [];
    const rangeStart = WEEK.start;
    const rangeEnd = WEEK.end;

    for (const ev of data) {
      const title = (ev.title || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
      if (!title || title.length < 4) continue;

      // startDateTime: "2026-03-04T15:30:00"
      const dateStr = ev.startDateTime ? ev.startDateTime.slice(0, 10) : '';
      // Filter to our scrape range
      if (dateStr && (dateStr < rangeStart || dateStr > rangeEnd)) continue;

      // Extract time from dateTimeFormatted: "Wednesday, March 4, 2026, 6 – 7pm EST"
      const formatted = (ev.dateTimeFormatted || '')
        .replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/\s+/g, ' ').trim();
      const timeMatch = formatted.match(/(\d{1,2}(?::\d{2})?\s*(?:–|-)\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|AM|PM)?\s*(?:a\.?m\.?|p\.?m\.?|AM|PM|EST|EDT)?)/i);
      const time = timeMatch ? timeMatch[1].trim() : '';

      // Location — strip "In-Person: " prefix
      const location = (ev.location || '').replace(/^In[- ]Person:\s*/i, '').trim() || 'The Frick Collection';

      // Build link from eventID
      const link = ev.permaLinkUrl || `https://www.frick.org/calendar?trumbaEmbed=view%3devent%26eventid%3d${ev.eventID}`;

      // Clean description
      const desc = (ev.description || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#160;/g, ' ')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ').trim()
        .slice(0, 200);

      items.push({
        title,
        date: dateStr,
        link,
        venue: location,
        time,
        description: desc || undefined,
      });
    }
    push(items, 'The Frick Collection', 'Art', 'https://www.frick.org/calendar');
    console.error(`The Frick (JSON): ${items.length}`);
  } catch (e) { console.error('The Frick error:', e.message); }
}

async function scrapeBAM(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  try {
    await page.goto('https://www.bam.org', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    // Scroll to load lazy content
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(3000);

    const items = await page.evaluate(() => {
      const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};
      const year = new Date().getFullYear();

      function parseDate(s) {
        if (!s) return '';
        // "Now Playing" / "ONGOING" / "Opens Mar 20"
        if (/now playing|ongoing/i.test(s)) return '';
        const opens = s.match(/opens\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\w*\s+\d{1,2})/i);
        if (opens) s = opens[1];
        // Range with days: "Mar 4—Mar 5, 2026" or "Apr 19—May 17, 2026"
        const rangeM = s.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\w*)\s+(\d{1,2})\s*[\u2014\u2013-]\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\w*)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i);
        if (rangeM) {
          const y = parseInt(rangeM[5] || year, 10);
          const m1 = MONTHS[rangeM[1].slice(0,3).toLowerCase()];
          const m2 = MONTHS[rangeM[3].slice(0,3).toLowerCase()];
          if (m1 !== undefined && m2 !== undefined) {
            const y2 = m2 < m1 ? y + 1 : y;
            return `${y}-${String(m1+1).padStart(2,'0')}-${String(parseInt(rangeM[2],10)).padStart(2,'0')} to ${y2}-${String(m2+1).padStart(2,'0')}-${String(parseInt(rangeM[4],10)).padStart(2,'0')}`;
          }
        }
        // Month-only range: "Oct 2025—Apr 2026" or "Jan—Jun 2026"
        const monthRange = s.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\w*)(?:\s+(\d{4}))?\s*[\u2014\u2013-]\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\w*)(?:\s+(\d{4}))?/i);
        if (monthRange) {
          const m1 = MONTHS[monthRange[1].slice(0,3).toLowerCase()];
          const m2 = MONTHS[monthRange[3].slice(0,3).toLowerCase()];
          if (m1 !== undefined && m2 !== undefined) {
            const y1 = parseInt(monthRange[2] || monthRange[4] || year, 10);
            const y2 = parseInt(monthRange[4] || monthRange[2] || year, 10);
            // Last day of end month
            const lastDay = new Date(y2, m2 + 1, 0).getDate();
            return `${y1}-${String(m1+1).padStart(2,'0')}-01 to ${y2}-${String(m2+1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
          }
        }
        // Single: "Thu, Mar 12, 2026" or "Wed, Mar 18, 2026" or "Mar 25, 2026"
        const singleM = s.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\w*)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i);
        if (singleM) {
          const y = parseInt(singleM[3] || year, 10);
          const m = MONTHS[singleM[1].slice(0,3).toLowerCase()];
          if (m !== undefined) return `${y}-${String(m+1).padStart(2,'0')}-${String(parseInt(singleM[2],10)).padStart(2,'0')}`;
        }
        return '';
      }

      // BAM category label -> our category
      const CAT_MAP = {
        'film': 'Film', 'film series': 'Film',
        'music': 'Music/Performing Arts', 'community | music': 'Music/Performing Arts',
        'theater': 'Theater', 'theater | music': 'Theater',
        'dance': 'Dance',
        'talks': 'Talk',
        'opera': 'Opera', 'live broadcast | opera | film': 'Opera',
        'poetry': 'Music/Performing Arts', 'music | poetry': 'Music/Performing Arts',
        'kids': 'Family', 'kids | community': 'Family', 'kids | theater | music': 'Family',
        'visual art': 'Art', 'visual art | performance art': 'Art',
        'performance art': 'Music/Performing Arts',
        'galas & events': 'Other', 'community': 'Other',
      };

      const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const results = [];
      const seen = new Set();

      // Walk through lines looking for category labels followed by event data
      for (let i = 0; i < lines.length; i++) {
        const catKey = lines[i].toLowerCase();
        const cat = CAT_MAP[catKey];
        if (!cat) continue;

        // Next line should be the title
        const title = lines[i + 1] || '';
        if (!title || title.length < 3 || title.length > 150) continue;
        // Skip navigation/chrome/labels
        if (/^(MORE|BUY TICKETS|RSVP|REGISTER|Previous|Next|Goto|Click|NEW RELEASE|NEW PRODUCTION|REVIVAL|MET PREMIERE|NEXT WAVE|BAM FREE MUSIC)/i.test(title)) continue;
        // Skip if title is itself a category label, compound label, or CAT_MAP key
        if (/^(Film|Music|Theater|Dance|Talks|Opera|Poetry|Kids|Visual Art|Performance Art|Galas|Community|Calendar|Featured)(\s*[|&].*)?$/i.test(title)) continue;
        // Skip site chrome / nav items
        if (/^(Visit|PROGRAMS|Programs|Senior Cinema|Community Programs|Community Resources|Support BAM|Fisher Takeovers|DanceAfrica and the BAM)$/i.test(title)) continue;
        if (/^(MON|TUE|WED|THU|FRI|SAT|SUN)$/i.test(title)) continue;
        if (/^AGES\s+\d/i.test(title)) continue;

        // Line after title should be date or "Now Playing"
        const dateLine = lines[i + 2] || '';

        // Dedup by title (case-insensitive)
        const key = title.toLowerCase().replace(/[\u201c\u201d\u2018\u2019"']/g, '');
        if (seen.has(key)) continue;
        seen.add(key);

        const date = parseDate(dateLine);
        results.push({ title, date, category: cat });
      }
      return results;
    });

    // Filter out junk: prints, galas, merch, leaked section labels, site chrome
    const JUNK = /\b(limited edition|print series|print$|gala|ball$|member first|behavioral strategies)\b/i;
    const LABEL_JUNK = /^(KIDS|VISUAL ART|MUSIC|PERFORMANCE ART|COMMUNITY|GALAS|SUPPORT BAM|Share the Brooklyn|Visit|PROGRAMS|Senior Cinema|Community Programs|Community Resources|Fisher Takeovers|DanceAfrica and the BAM)(\s*[|&].*)?$/i;
    const filtered = items.filter(i => !JUNK.test(i.title) && !LABEL_JUNK.test(i.title));

    // Group by category and push each group
    const groups = {};
    for (const item of filtered) {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    }
    for (const [cat, catItems] of Object.entries(groups)) {
      push(catItems, 'BAM', cat, 'https://www.bam.org');
    }
    const total = filtered.length;
    const filmCount = (groups['Film'] || []).length;
    console.error(`BAM: ${total} total (${filmCount} film, ${total - filmCount} other)`);
  } catch (e) { console.error('BAM error:', e.message); }
  finally { await page.close(); }
}

// ---------------------------------------------------------------------------
// PLAYWRIGHT SOURCES — need JS rendering
// ---------------------------------------------------------------------------

async function scrapeMetrograph(browser) {
  // Metrograph has two relevant pages:
  //   /film/   — showtimes listing; each film has h3.movie_title and nearby
  //              date_picker_holder / film_day_chooser with dates like "Mon Mar 2"
  //   /events/ — special events (Q&As, introductions, live accompaniment)
  //              with specific dates like "Friday March 6, 9:00pm"

  const showtimeItems = [];
  const eventItems = [];

  // --- 1. Scrape /film/ for showtimes with per-film dates ---
  const filmPage = await browser.newPage();
  filmPage.setDefaultTimeout(15000);
  try {
    await filmPage.goto('https://metrograph.com/film/', { waitUntil: 'domcontentloaded' });
    await filmPage.waitForTimeout(5000);

    const films = await filmPage.evaluate(() => {
      const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
        january:0,february:1,march:2,april:3,june:5,july:6,august:7,september:8,october:9,november:10,december:11};
      const year = new Date().getFullYear();
      const results = [];

      // Collect all h3.movie_title elements — each represents one film block
      const movieBlocks = document.querySelectorAll('h3.movie_title');

      movieBlocks.forEach((h3, idx) => {
        const title = h3.textContent?.trim();
        if (!title || title.length < 3 || title.length > 120) return;
        if (/^(all films|now playing|coming soon|showtimes)/i.test(title)) return;

        // Scope: collect DOM between this h3 and the NEXT h3.movie_title
        // This avoids picking up dates from the global page header or other films
        const nextH3 = movieBlocks[idx + 1] || null;
        let scopeEl = h3.nextElementSibling;
        const scopeText = [];
        const scopeEls = [];
        while (scopeEl && scopeEl !== nextH3) {
          scopeEls.push(scopeEl);
          scopeText.push(scopeEl.textContent || '');
          scopeEl = scopeEl.nextElementSibling;
        }
        const blockText = scopeText.join(' ').replace(/\s+/g, ' ');

        // Extract dates from film_day_chooser within this block
        const dates = new Set();
        for (const el of scopeEls) {
          el.querySelectorAll?.('.film_day_chooser li, .film_day_chooser a').forEach(dp => {
            const text = dp.textContent?.trim().replace(/\s+/g, ' ') || '';
            const m = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2})/i);
            if (m) {
              const mon = MONTHS[m[1].toLowerCase()];
              if (mon !== undefined) {
                dates.add(`${year}-${String(mon+1).padStart(2,'0')}-${String(parseInt(m[2],10)).padStart(2,'0')}`);
              }
            }
          });
          // Also check if the element itself is a film_day_chooser
          if (el.classList?.contains('film_day_chooser') || el.classList?.contains('date_picker_holder')) {
            el.querySelectorAll('li, a').forEach(dp => {
              const text = dp.textContent?.trim().replace(/\s+/g, ' ') || '';
              const m = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2})/i);
              if (m) {
                const mon = MONTHS[m[1].toLowerCase()];
                if (mon !== undefined) {
                  dates.add(`${year}-${String(mon+1).padStart(2,'0')}-${String(parseInt(m[2],10)).padStart(2,'0')}`);
                }
              }
            });
          }
        }

        // Fallback: parse "Day Mon DD" patterns from the scoped block text only
        if (dates.size === 0) {
          const re = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2})/gi;
          let match;
          while ((match = re.exec(blockText)) !== null) {
            const mon = MONTHS[match[1].toLowerCase()];
            if (mon !== undefined) {
              dates.add(`${year}-${String(mon+1).padStart(2,'0')}-${String(parseInt(match[2],10)).padStart(2,'0')}`);
            }
          }
        }

        // Find the film link
        let link = '';
        const prevA = h3.previousElementSibling;
        if (prevA?.tagName === 'A' && prevA.href?.includes('/film/')) link = prevA.href;
        if (!link) {
          for (const el of scopeEls) {
            const a = el.querySelector?.('a[href*="/film/"]');
            if (a) { link = a.href; break; }
          }
        }
        if (!link) {
          const a = h3.closest('a') || h3.querySelector('a');
          if (a) link = a.href;
        }

        // Convert dates to sorted array
        const dateArr = Array.from(dates).sort();

        if (dateArr.length > 5) {
          // Too many individual dates — collapse into a range
          results.push({ title, link, date: `${dateArr[0]} to ${dateArr[dateArr.length - 1]}` });
        } else if (dateArr.length > 0) {
          // Emit one entry per date
          dateArr.forEach(d => results.push({ title, link, date: d }));
        } else {
          // No dates found — still include with today's date as fallback
          const now = new Date();
          const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
          results.push({ title, link, date: today });
        }
      });
      return results;
    });

    showtimeItems.push(...films);
    console.error(`Metrograph /film/: ${films.length} showtime entries`);
  } catch (e) { console.error('Metrograph /film/ error:', e.message); }
  finally { await filmPage.close(); }

  // --- 2. Scrape /events/ for special events (Q&As, introductions, etc.) ---
  const eventsPage = await browser.newPage();
  eventsPage.setDefaultTimeout(15000);
  try {
    await eventsPage.goto('https://metrograph.com/events/', { waitUntil: 'domcontentloaded' });
    await eventsPage.waitForTimeout(5000);

    const evts = await eventsPage.evaluate(() => {
      const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
        january:0,february:1,march:2,april:3,june:5,july:6,august:7,september:8,october:9,november:10,december:11};
      const year = new Date().getFullYear();
      const results = [];
      const seen = new Set();

      // Events page has h3/h4 titles with descriptions containing dates
      // Each event appears duplicated — dedupe by title
      document.querySelectorAll('h3, h4, [class*="title"]').forEach(el => {
        const title = el.textContent?.trim();
        if (!title || title.length < 4 || title.length > 150) return;
        if (seen.has(title.toLowerCase())) return;
        if (/^(events?|calendar|metrograph|sign in|all films)/i.test(title)) return;

        seen.add(title.toLowerCase());

        // Find the parent container for context
        let container = el.parentElement;
        for (let i = 0; i < 6 && container; i++) {
          const text = container.textContent || '';
          if (text.length > title.length + 20) break;
          container = container.parentElement;
        }

        const fullText = container ? container.textContent?.replace(/\s+/g, ' ')?.trim() || '' : '';
        const link = container?.querySelector('a[href*="/film/"]')?.href
          || el.closest('a')?.href || '';

        // Extract date: "Friday March 6, 9:00pm" or "Sunday, March 8th"
        let dateStr = '';
        const dateMatch = fullText.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:th|st|nd|rd)?/i);
        if (dateMatch) {
          const mon = MONTHS[dateMatch[1].toLowerCase()];
          if (mon !== undefined) {
            dateStr = `${year}-${String(mon+1).padStart(2,'0')}-${String(parseInt(dateMatch[2],10)).padStart(2,'0')}`;
          }
        }
        // Fallback: "March 6th" without day-of-week
        if (!dateStr) {
          const m2 = fullText.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:th|st|nd|rd)?/i);
          if (m2) {
            const mon = MONTHS[m2[1].toLowerCase()];
            if (mon !== undefined) {
              dateStr = `${year}-${String(mon+1).padStart(2,'0')}-${String(parseInt(m2[2],10)).padStart(2,'0')}`;
            }
          }
        }

        // Extract time
        const timeMatch = fullText.match(/(\d{1,2}:\d{2}\s*(?:am|pm))/i);
        const time = timeMatch ? timeMatch[1] : '';

        // Build description from Q&A / introduction context
        let description = '';
        const qaMatch = fullText.match(/(Q&A with[^.]+)/i);
        if (qaMatch) description = qaMatch[1].trim();
        const introMatch = fullText.match(/(Introduction by[^.]+)/i);
        if (introMatch) description = (description ? description + '. ' : '') + introMatch[1].trim();
        const liveMatch = fullText.match(/(Live [^.]+accompaniment[^.]*)/i);
        if (liveMatch) description = (description ? description + '. ' : '') + liveMatch[1].trim();

        results.push({ title, link, date: dateStr, time, description });
      });
      return results;
    });

    eventItems.push(...evts);
    console.error(`Metrograph /events/: ${evts.length} events`);
  } catch (e) { console.error('Metrograph /events/ error:', e.message); }
  finally { await eventsPage.close(); }

  // Showtimes go as Film category (will appear in Showtimes tab via isShowtime())
  push(showtimeItems, 'Metrograph', 'Film', 'https://metrograph.com/film/');
  // Events go as Music/Performing Arts so they appear on the calendar, not showtimes
  push(eventItems, 'Metrograph', 'Music/Performing Arts', 'https://metrograph.com/events/');
  console.error(`Metrograph total: ${showtimeItems.length} showtimes + ${eventItems.length} events`);
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
      // Helper: strip date suffixes that get concatenated into titles
      function cleanTitle(raw) {
        return raw
          .replace(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}\s*[–—-]\s*(Ongoing|January|February|March|April|May|June|July|August|September|October|November|December).*$/i, '')
          .replace(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}.*$/i, '')
          .replace(/\s+/g, ' ').trim();
      }
      // Try exhibition links first
      document.querySelectorAll('a[href*="/exhibition"]').forEach(el => {
        const raw = el.textContent?.trim() || '';
        const t = cleanTitle(raw);
        if (t && t.length > 5 && t.length < 200 && !seen.has(t.toLowerCase())
            && !/^(exhibitions?|view|see all)/i.test(t)) {
          seen.add(t.toLowerCase());
          // Extract date from the raw text or parent container
          const card = el.closest('article, [class*="card"], li, div, section');
          const cardText = card?.textContent?.replace(/\s+/g, ' ')?.trim() || raw;
          let dateText = '';
          const throughMatch = cardText.match(/(through\s+[A-Za-z]+(?:\s+\d{1,2})?(?:\s*,?\s*\d{4})?)/i);
          if (throughMatch) dateText = throughMatch[1];
          if (!dateText) {
            const rangeMatch = cardText.match(/([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})\s*[–—-]\s*([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/);
            if (rangeMatch) dateText = `${rangeMatch[1]} – ${rangeMatch[2]}`;
          }
          if (!dateText) {
            // "March 21, 2026–Ongoing" → use start date as range start
            const ongoingMatch = cardText.match(/([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})\s*[–—-]\s*Ongoing/i);
            if (ongoingMatch) dateText = ongoingMatch[1];
          }
          r.push({ title: t, link: el.href, date: dateText });
        }
      });
      // Fallback: h2/h3 headings
      if (r.length === 0) {
        document.querySelectorAll('h2, h3').forEach(el => {
          const raw = el.textContent?.trim() || '';
          const t = cleanTitle(raw);
          const link = el.closest('a')?.href || el.querySelector('a')?.href || '';
          if (t && t.length > 5 && t.length < 200 && !seen.has(t.toLowerCase())
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

      // Try to extract structured data from links first
      const eventLinks = document.querySelectorAll('a[href*="/season/"]');
      let currentDate = '';

      // Walk through the body text for date context, but grab links for URLs
      const linkMap = new Map();
      eventLinks.forEach(a => {
        const title = a.textContent?.trim();
        const href = a.href || '';
        if (title && title.length > 3 && href.includes('/season/')) {
          linkMap.set(title.toLowerCase(), href);
        }
      });

      const body = document.body.innerText;
      const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      let inRadioSection = false;
      for (const line of lines) {
        // Date header: "SAT, MAR 7" or "MON, MAR 9"
        const dm = line.match(/^(?:MON|TUE|WED|THU|FRI|SAT|SUN),?\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{1,2})$/i);
        if (dm) {
          const mon = MONTHS[dm[1].toLowerCase()];
          if (mon !== undefined) {
            currentDate = `${year}-${String(mon+1).padStart(2,'0')}-${String(parseInt(dm[2],10)).padStart(2,'0')}`;
          }
          inRadioSection = false;
          continue;
        }
        // Track section headers — skip radio broadcasts
        if (/^ON RADIO$/i.test(line)) { inRadioSection = true; continue; }
        if (/^(ON STAGE|IN CINEMAS|BACKSTAGE|ONSTAGE)$/i.test(line)) { inRadioSection = false; continue; }
        if (inRadioSection) continue;
        if (!currentDate) continue;
        if (line.length < 4 || line.length > 150) continue;
        // Skip known non-title lines
        if (/^(ON STAGE|ON RADIO|IN CINEMAS|BACKSTAGE|ALL EVENTS|ONSTAGE|Page|Date|Previous|Next|Enter|Filter|Subscribe|Buy|View|Calendar|FIND STATION|LAST PERFORMANCE|TO |SuMoTu|PrevNext)/i.test(line)) continue;
        if (/\bMORE PERFORMANCES?\b/i.test(line)) continue;
        if (/\bSiriusXM\b/i.test(line)) continue;
        if (/\bTuesday Talk\b/i.test(line)) continue;
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
          // Try exact match first, then fuzzy (title contains an opera name from linkMap)
          let link = linkMap.get(key) || '';
          if (!link) {
            for (const [mapKey, mapUrl] of linkMap.entries()) {
              if (key.includes(mapKey) || mapKey.includes(key)) { link = mapUrl; break; }
            }
          }
          r.push({ title: line, date: currentDate, link: link || 'https://www.metopera.org/season/2025-26-season/' });
        }
      }
      // Filter out any radio broadcast links that slipped through
      return r.filter(e => !/station-finder|\/radio\//i.test(e.link)).slice(0, 25);
    });
    push(items, 'Metropolitan Opera', 'Opera', 'https://www.metopera.org/season/2025-26-season/');
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
            && !/^(upcoming|calendar)/i.test(t)
            && !/^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d/i.test(t)
            && !/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(t)
            && !/^\d{1,2}:\d{2}/i.test(t)) {
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
  'Metrograph', 'Guggenheim', 'New Museum', 'Japan Society',
  'NY Philharmonic', 'Carnegie Hall', 'Met Opera', 'NYCB',
  'Joyce Theater', 'Lincoln Center', 'Moving Image', '92NY',
  'Angelika', 'Film at Lincoln Center', 'ABT'
]);

// ---------------------------------------------------------------------------
// American Ballet Theatre — FullCalendar DOM scraper
// ---------------------------------------------------------------------------

async function scrapeABT(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  try {
    // Map ABT categories to ours
    const CAT_MAP = {
      'performance': 'Ballet',
      'special events': 'Ballet',
      'community': 'Ballet',
    };
    const SKIP_CATS = new Set(['training']);

    const allItems = [];

    // Scrape current month view, then click "next" for next month
    for (let m = 0; m < 2; m++) {
      if (m === 0) {
        await page.goto('https://www.abt.org/performances/master-calendar/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(10000);
      } else {
        // Click the next-month button
        const nextBtn = await page.$('.fc-next-button, .fc-button-next, button.fc-next-button');
        if (nextBtn) {
          await nextBtn.click();
          await page.waitForTimeout(5000);
        } else break;
      }

      const items = await page.evaluate(() => {
        const wrappers = document.querySelectorAll('.event-wrapper');
        return Array.from(wrappers).map(w => {
          const dataId = w.getAttribute('data-id') || '';
          const cat = w.querySelector('.category');
          const catText = cat ? cat.childNodes[0].textContent.trim().toLowerCase() : '';
          const location = w.querySelector('.event-location');
          const titleEl = w.querySelector('.fc-title');
          const time = w.querySelector('.fc-time');
          return {
            date: dataId ? dataId.slice(0, 4) + '-' + dataId.slice(4, 6) + '-' + dataId.slice(6, 8) : '',
            catText,
            location: location ? location.textContent.trim() : '',
            title: titleEl ? titleEl.childNodes[0].textContent.trim() : '',
            time: time ? time.textContent.trim() : '',
          };
        });
      });
      allItems.push(...items);
    }

    // Filter: NYC only, skip training, skip school closures, dedup by title+date
    const seen = new Set();
    const filtered = [];
    for (const item of allItems) {
      if (!item.title || item.title.length < 3) continue;
      if (SKIP_CATS.has(item.catText)) continue;
      if (!/new york/i.test(item.location)) continue;
      if (/school closed/i.test(item.title)) continue;
      const cat = CAT_MAP[item.catText] || 'Ballet';
      const key = item.title.toLowerCase() + '|' + item.date;
      if (seen.has(key)) continue;
      seen.add(key);
      filtered.push({ title: item.title, date: item.date, time: item.time || undefined, category: cat });
    }

    push(filtered, 'American Ballet Theatre', 'Ballet', 'https://www.abt.org/performances/master-calendar/');
    console.error(`ABT: ${filtered.length} NYC events`);
  } catch (e) { console.error('ABT error:', e.message); }
  finally { await page.close(); }
}

async function scrapeAngelika(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto('https://angelikafilmcenter.com/nyc/now-playing', { waitUntil: 'networkidle' });
    await page.waitForTimeout(4000);

    // Get all date tabs (e.g. "Today, 3/2", "Tomorrow, 3/3", "Wednesday 3/4")
    const dateTabs = await page.evaluate(() => {
      const r = [];
      const seen = new Set();
      document.querySelectorAll('.slick-slide span').forEach(el => {
        const t = el.textContent.trim();
        const m = t.match(/(\d{1,2})\/(\d{1,2})/);
        if (m && !seen.has(t)) {
          seen.add(t);
          r.push({ text: t, month: parseInt(m[1], 10), day: parseInt(m[2], 10) });
        }
      });
      return r;
    });

    const year = new Date().getFullYear();
    const allItems = [];

    // Click each date tab and scrape movies
    for (const tab of dateTabs) {
      try {
        // Click the tab by finding the span with matching text
        await page.evaluate((tabText) => {
          document.querySelectorAll('.slick-slide span').forEach(el => {
            if (el.textContent.trim() === tabText) el.click();
          });
        }, tab.text);
        await page.waitForTimeout(1500);

        const dateStr = `${year}-${String(tab.month).padStart(2, '0')}-${String(tab.day).padStart(2, '0')}`;
        const movies = await page.evaluate(() => {
          const r = [];
          document.querySelectorAll('div[class*="movie-details-section"]').forEach(el => {
            const links = el.querySelectorAll('a');
            let title = '', href = '';
            links.forEach(a => {
              if (a.href && a.href.includes('/movies/details/')) {
                title = a.textContent.trim();
                href = a.href;
              }
            });
            if (title && title.length > 2 && title.length < 100) {
              r.push({ title, link: href });
            }
          });
          return r;
        });

        movies.forEach(m => { m.date = dateStr; });
        allItems.push(...movies);
      } catch (e) {
        console.error(`  Angelika tab "${tab.text}" error:`, e.message);
      }
    }

    push(allItems, 'Angelika Film Center', 'Film', 'https://angelikafilmcenter.com/nyc');
    console.error(`Angelika: ${allItems.length} (${dateTabs.length} days)`);
  } catch (e) { console.error('Angelika error:', e.message); }
  finally { await page.close(); }
}

async function scrapeFilmLinc(browser) {
  // Film at Lincoln Center — behind Cloudflare, try anyway
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  try {
    await page.goto('https://www.filmlinc.org/now-playing/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(6000);
    const bodyText = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ' ').trim().slice(0, 200));
    if (/security verification|enable javascript|just a moment/i.test(bodyText)) {
      console.error('Film at Lincoln Center: blocked by Cloudflare');
      return;
    }
    const items = await page.evaluate(() => {
      const r = [], seen = new Set();
      document.querySelectorAll('a[href*="/film"]').forEach(el => {
        const t = el.textContent.trim();
        if (t && t.length > 3 && t.length < 120 && !seen.has(t.toLowerCase())) {
          seen.add(t.toLowerCase());
          const container = el.closest('article, div, li, [class*="card"]');
          const ctx = container ? container.textContent.replace(/\s+/g, ' ').trim() : '';
          const dateMatch = ctx.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}(?:\s*[-–—]\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+)?\d{1,2})?)/i);
          r.push({ title: t, link: el.href, date: dateMatch ? dateMatch[1] : '' });
        }
      });
      return r.slice(0, 30);
    });
    push(items, 'Film at Lincoln Center', 'Film', 'https://www.filmlinc.org');
    console.error(`Film at Lincoln Center: ${items.length}`);
  } catch (e) { console.error('Film at Lincoln Center error:', e.message); }
  finally { await page.close(); }
}

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
  console.error('  Film at Lincoln Center — Cloudflare (attempted, may fail)');
  console.error('='.repeat(70) + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  // Cheerio sources (fast, no browser needed)
  await runSource('IFC Center', scrapeIFC);
  await runSource('Film Forum', scrapeFilmForum);
  await runSource('The Met', scrapeTheMet);
  await runSource('Whitney', scrapeWhitney);
  await runSource('Neue Galerie', scrapeNeueGalerie);
  await runSource('The Frick', scrapeFrick);

  // Playwright sources
  let browser = null;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true });

    await runSource('Metrograph', scrapeMetrograph, browser);
    await runSource('BAM', scrapeBAM, browser);
    await runSource('Angelika', scrapeAngelika, browser);
    await runSource('Film at Lincoln Center', scrapeFilmLinc, browser);
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
    await runSource('ABT', scrapeABT, browser);
  } catch (e) {
    console.error('Playwright unavailable, skipping JS sources:', e.message);
  } finally {
    if (browser) await browser.close();
  }

  printReport();
  console.log(JSON.stringify(events, null, 2));
})();
