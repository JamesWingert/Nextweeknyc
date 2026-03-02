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
// Week calculation
// ---------------------------------------------------------------------------

function nextWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const daysUntilMon = day === 0 ? 1 : (8 - day);
  const mon = new Date(now);
  mon.setDate(now.getDate() + daysUntilMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { start: process.env.WEEK_START || fmt(mon), end: process.env.WEEK_END || fmt(sun) };
}

const WEEK = nextWeekRange();
const RANGE = `${WEEK.start} to ${WEEK.end}`;
console.error(`Week range: ${RANGE}`);

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
    may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,september:8,
    oct:9,october:9,nov:10,november:10,dec:11,december:11
  };
  const m1 = s.match(/^([a-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i);
  if (m1) {
    const mon = MONTHS[m1[1].toLowerCase()];
    if (mon !== undefined) {
      const day = parseInt(m1[2], 10);
      const year = m1[3] ? parseInt(m1[3], 10) : new Date(WEEK.start).getFullYear();
      return `${year}-${String(mon+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }
  const m2 = s.match(/^(\d{1,2})\s+([a-z]+)(?:\s*,?\s*(\d{4}))?/i);
  if (m2) {
    const mon = MONTHS[m2[2].toLowerCase()];
    if (mon !== undefined) {
      const day = parseInt(m2[1], 10);
      const year = m2[3] ? parseInt(m2[3], 10) : new Date(WEEK.start).getFullYear();
      return `${year}-${String(mon+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }
  const m3 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m3) {
    return `${m3[3]}-${String(parseInt(m3[1],10)).padStart(2,'0')}-${String(parseInt(m3[2],10)).padStart(2,'0')}`;
  }
  return null;
}

function push(items, venue, category, fallbackUrl) {
  items.forEach(item => {
    let date = item.date || null;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      if (date < WEEK.start || date > WEEK.end) date = RANGE;
    } else if (date && /^\d{4}-\d{2}-\d{2}[T ]/.test(date)) {
      const d = date.slice(0, 10);
      date = (d >= WEEK.start && d <= WEEK.end) ? d : RANGE;
    } else {
      const parsed = parseHumanDate(date);
      if (parsed && parsed >= WEEK.start && parsed <= WEEK.end) {
        date = parsed;
      } else {
        date = RANGE;
      }
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

async function scrapeFilmForum() {
  try {
    const { html } = await fetchHTML('https://filmforum.org/now-playing');
    const $ = cheerio.load(html);
    const items = [];
    // Film Forum uses .film-title links inside film blocks
    $('a[href*="/film/"]').each((_, el) => {
      const title = $(el).text().trim();
      const link = $(el).attr('href') || '';
      const fullLink = link.startsWith('/') ? `https://filmforum.org${link}` : link;
      if (title && title.length > 3 && title.length < 100) items.push({ title, link: fullLink });
    });
    // Dedupe by title
    const seen = new Set();
    const deduped = items.filter(i => { const k = i.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    push(deduped, 'Film Forum', 'Film', 'https://filmforum.org/now-playing');
    console.error(`Film Forum: ${deduped.length}`);
  } catch (e) { console.error('Film Forum error:', e.message); }
}

async function scrapeIFC() {
  try {
    const { html } = await fetchHTML('https://www.ifccenter.com');
    const $ = cheerio.load(html);
    const items = [];
    $('a[href*="/films/"], a[href*="/series/"]').each((_, el) => {
      const title = $(el).text().trim();
      const link = $(el).attr('href') || '';
      const fullLink = link.startsWith('/') ? `https://www.ifccenter.com${link}` : link;
      if (title && title.length > 3 && title.length < 100) items.push({ title, link: fullLink });
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
    $('[class*="exhibition"], .card, .tile').each((_, el) => {
      const $el = $(el);
      const title = $el.find('h2, h3, h4, [class*="title"]').first().text().trim();
      const link = $el.find('a').first().attr('href') || '';
      const fullLink = link.startsWith('/') ? `https://www.metmuseum.org${link}` : link;
      if (title && title.length > 3 && title.length < 120 && !/^Exhibitions$/i.test(title))
        items.push({ title, link: fullLink });
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
    $('[class*="exhibition"], .card').each((_, el) => {
      const $el = $(el);
      const title = $el.find('h2, h3, h4, [class*="title"]').first().text().trim();
      const link = $el.find('a').first().attr('href') || '';
      const fullLink = link.startsWith('/') ? `https://whitney.org${link}` : link;
      if (title && title.length > 3 && title.length < 120) items.push({ title, link: fullLink });
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
    // Exhibition links at a[href*="/exhibitions/"]
    $('a[href*="/exhibitions/"]').each((_, el) => {
      const $el = $(el);
      const title = $el.text().trim();
      const link = $el.attr('href') || '';
      const fullLink = link.startsWith('/') ? `https://www.neuegalerie.org${link}` : link;
      if (title && title.length > 5 && title.length < 120
          && !seen.has(title.toLowerCase())
          && !/^(exhibitions?|current|upcoming|past|view all)/i.test(title)) {
        seen.add(title.toLowerCase());
        items.push({ title, link: fullLink });
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
          r.push({ title: t, link: el.href });
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
  // BAM root page has .eventInfo blocks with event data
  try {
    const { html } = await fetchHTML('https://www.bam.org');
    const $ = cheerio.load(html);
    const items = [];
    $('.eventInfo').each((_, el) => {
      const $el = $(el);
      const parent = $el.parent();
      const title = parent.find('h2, h3').first().text().trim();
      const link = parent.closest('a').attr('href') || parent.find('a').first().attr('href') || '';
      const fullLink = link.startsWith('/') ? `https://www.bam.org${link}` : link;
      const dateText = parent.find('[class*="date"]').first().text().trim();
      if (title && title.length > 3 && title.length < 120) items.push({ title, link: fullLink, date: dateText });
    });
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
      document.querySelectorAll('[class*="film"], [class*="screening"], .calendar-item, a[href*="/film/"]').forEach(el => {
        const t = el.querySelector('h2, h3, .title, [class*="title"]')?.textContent?.trim()
          || (el.tagName === 'A' ? el.textContent?.trim() : '');
        const link = el.closest('a')?.href || el.querySelector('a')?.href || '';
        if (t && t.length > 3 && t.length < 100 && !seen.has(t.toLowerCase())) {
          seen.add(t.toLowerCase());
          r.push({ title: t, link });
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
  // Guggenheim is a JS SPA — needs Playwright
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto('https://www.guggenheim.org/exhibitions', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const items = await page.evaluate(() => {
      const r = [], seen = new Set();
      document.querySelectorAll('a[href*="/exhibition/"]').forEach(el => {
        const t = el.textContent?.trim();
        if (t && t.length > 3 && t.length < 120 && !seen.has(t.toLowerCase())) {
          seen.add(t.toLowerCase());
          r.push({ title: t, link: el.href });
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
          r.push({ title: t, link: el.href });
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
            r.push({ title: t, link });
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
          r.push({ title: t, link: el.href });
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
      const r = [], seen = new Set();
      document.querySelectorAll('a[href*="/concerts-tickets/"]').forEach(el => {
        const t = el.textContent?.trim();
        const dateEl = el.closest('[class*="event"], [class*="concert"], [class*="row"]')
          ?.querySelector('[class*="date"]');
        const rawDate = dateEl?.textContent?.trim() || '';
        if (t && t.length > 5 && t.length < 150 && !seen.has(t.toLowerCase())
            && !/^(concerts|calendar|tickets)/i.test(t)) {
          seen.add(t.toLowerCase());
          r.push({ title: t, link: el.href, date: rawDate });
        }
      });
      return r.slice(0, 20);
    });
    push(items, 'New York Philharmonic', 'Classical Music', 'https://nyphil.org/calendar');
    console.error(`NY Philharmonic: ${items.length}`);
  } catch (e) { console.error('NY Philharmonic error:', e.message); }
  finally { await page.close(); }
}

async function scrapeCarnegieHall(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  try {
    await page.goto('https://www.carnegiehall.org/calendar', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    const items = await page.evaluate(() => {
      const r = [], seen = new Set();
      // Carnegie Hall renders h3 titles for events, links are # anchors
      // Grab h3 elements that look like event names
      document.querySelectorAll('h3').forEach(el => {
        const t = el.textContent?.trim();
        const parent = el.closest('a, [class*="event"], [class*="card"], div');
        const link = parent?.querySelector('a')?.href || el.closest('a')?.href || '';
        if (t && t.length > 5 && t.length < 150 && !seen.has(t.toLowerCase())
            && !/^(calendar|filter|search|subscribe|upcoming|location|event type|genre|date|march|february|january)/i.test(t)) {
          seen.add(t.toLowerCase());
          r.push({ title: t, link: link || 'https://www.carnegiehall.org/calendar' });
        }
      });
      return r.slice(0, 25);
    });
    push(items, 'Carnegie Hall', 'Classical Music', 'https://www.carnegiehall.org/calendar');
    console.error(`Carnegie Hall: ${items.length}`);
  } catch (e) { console.error('Carnegie Hall error:', e.message); }
  finally { await page.close(); }
}

async function scrapeMetOpera(browser) {
  // /calendar/ works (not /season/ which is Cloudflare-blocked)
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto('https://www.metopera.org/calendar/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const items = await page.evaluate(() => {
      const r = [], seen = new Set();
      document.querySelectorAll('a[href*="/season/"]').forEach(a => {
        const t = a.textContent?.trim();
        if (t && t.length > 3 && t.length < 120 && !seen.has(t.toLowerCase())
            && !/^(season|calendar|filter|2025|2026)/i.test(t)) {
          seen.add(t.toLowerCase());
          r.push({ title: t, link: a.href });
        }
      });
      return r.slice(0, 15);
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
      // NYCB uses h3.season-slide__title and links to /season-and-tickets/spring-2026/
      document.querySelectorAll('.season-slide__title, a[href*="/season-and-tickets/"]').forEach(el => {
        const t = el.textContent?.trim();
        const link = el.closest('a')?.href || el.querySelector('a')?.href || '';
        if (t && t.length > 3 && t.length < 120 && !seen.has(t.toLowerCase())
            && !/^(season|tickets|subscribe|spring|winter|fall)/i.test(t)) {
          seen.add(t.toLowerCase());
          r.push({ title: t, link });
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
      document.querySelectorAll('a[href*="/performances/"]').forEach(a => {
        const t = a.textContent?.trim();
        const dateEl = a.closest('[class*="event"], [class*="card"]')?.querySelector('[class*="date"]');
        const rawDate = dateEl?.textContent?.trim().replace(/\s+/g, ' ') || '';
        if (t && t.length > 3 && t.length < 120 && !/^(performances|agenda)/i.test(t)) {
          r.push({ title: t, link: a.href, date: rawDate });
        }
      });
      // Dedupe
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

async function scrape92NY(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto('https://www.92ny.org/whats-on/events', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const items = await page.evaluate(() => {
      const r = [], seen = new Set();
      document.querySelectorAll('a[href*="/event/"]').forEach(a => {
        const t = a.textContent?.trim();
        if (t && t.length > 5 && t.length < 150 && !seen.has(t.toLowerCase())
            && !/^(members|in person|virtual|save)/i.test(t)) {
          seen.add(t.toLowerCase());
          r.push({ title: t, link: a.href });
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
  'Metrograph', 'The Frick', 'Guggenheim', 'New Museum', 'Japan Society',
  'NY Philharmonic', 'Carnegie Hall', 'Met Opera', 'NYCB',
  'Joyce Theater', 'Lincoln Center', '92NY'
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
  const datesExtracted = events.slice(before).filter(e => e.date && !e.date.includes(' to ')).length;
  sourceLog.push({ name, count, datesExtracted, elapsed, error });
}

function printReport() {
  console.error('\n' + '='.repeat(70));
  console.error('SCRAPE REPORT — Film/Arts');
  console.error('='.repeat(70));
  console.error(`Week: ${RANGE}`);
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
  console.error('  Moving Image — Cloudflare');
  console.error('  Queens Museum — 403 Forbidden');
  console.error('='.repeat(70) + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  // Cheerio sources (fast, no browser needed)
  await runSource('Film Forum', scrapeFilmForum);
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
    await runSource('92NY', scrape92NY, browser);
  } catch (e) {
    console.error('Playwright unavailable, skipping JS sources:', e.message);
  } finally {
    if (browser) await browser.close();
  }

  printReport();
  console.log(JSON.stringify(events, null, 2));
})();
