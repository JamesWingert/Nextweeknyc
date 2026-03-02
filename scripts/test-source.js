#!/usr/bin/env node
/**
 * Test individual scrape sources — diagnoses connectivity, selectors, date formats.
 *
 * Uses cheerio (fetch + parse) by default. Falls back to Playwright for JS-heavy sites.
 *
 * Usage:
 *   node scripts/test-source.js                  # test ALL sources
 *   node scripts/test-source.js donyc             # test one source (fuzzy match)
 *   node scripts/test-source.js --list            # list available source names
 *   node scripts/test-source.js --js metrograph   # force Playwright for a source
 */

const cheerio = require('cheerio');
const https = require('https');
const http = require('http');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fetchHTML(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const timer = setTimeout(() => reject(new Error('Timeout after 15s')), 15000);
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        clearTimeout(timer);
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        return fetchHTML(next, maxRedirects - 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, html: data, url }); });
      res.on('error', e => { clearTimeout(timer); reject(e); });
    });
    req.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

function findDateElements($) {
  const dateSelectors = [
    'time[datetime]',
    '[class*="date"]',
    '[data-date]',
    '.date',
    'meta[property="event:start_date"]',
    '[itemprop="startDate"]',
    '[class*="time"]',
    '.ds-event-time',
  ];
  const found = {};
  for (const sel of dateSelectors) {
    const els = $(sel);
    if (els.length > 0) {
      const samples = [];
      els.slice(0, 3).each((_, el) => {
        const $el = $(el);
        const dt = $el.attr('datetime') || $el.attr('content') || $el.attr('data-date') || $el.text().trim();
        if (dt) samples.push(dt.slice(0, 80));
      });
      if (samples.length) found[sel] = { count: els.length, samples };
    }
  }
  return found;
}

function log(msg) { console.error(msg); }
function hr() { log('-'.repeat(70)); }


// ---------------------------------------------------------------------------
// Source definitions — name, url, how to extract items from cheerio $
// ---------------------------------------------------------------------------

const SOURCES = [
  // ========== GENERAL ==========
  {
    name: 'donyc',
    url: 'https://donyc.com/events',
    needsJS: false,
    extract($) {
      const items = [];
      $('.ds-listing').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h3, .ds-listing-event-title').first().text().trim();
        const venue = $el.find('.ds-venue-name').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('meta[datetime], time[datetime]').first().attr('datetime')
          || $el.find('.ds-event-time').first().text().trim() || '';
        if (title) items.push({ title, venue, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'donyc-day',
    url: (() => {
      const d = new Date(); d.setDate(d.getDate() + 1);
      return `https://donyc.com/events/${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
    })(),
    needsJS: false,
    extract($) {
      const items = [];
      $('.ds-listing').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h3, .ds-listing-event-title').first().text().trim();
        const venue = $el.find('.ds-venue-name').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        if (title) items.push({ title, venue, link, rawDate: '(from URL date)' });
      });
      return items;
    },
  },
  {
    name: 'theskint',
    url: 'https://theskint.com/',
    needsJS: false,
    extract($) {
      const items = [];
      $('article, .post, .entry, [class*="event"]').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, .entry-title').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('.entry-date, [class*="date"]').first().text().trim() || '';
        if (title && title.length > 3) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'theskint-ongoing',
    url: 'https://theskint.com/ongoing-events/',
    needsJS: false,
    extract($) {
      const items = [];
      $('article, .post, .entry, [class*="event"], .entry-content li, .entry-content h2, .entry-content h3').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, .entry-title, a').first().text().trim() || $el.text().trim();
        const link = $el.find('a').first().attr('href') || $el.closest('a').attr('href') || '';
        if (title && title.length > 5 && title.length < 120) items.push({ title, link, rawDate: '' });
      });
      return items;
    },
  },
  {
    name: 'timeout',
    url: 'https://www.timeout.com/newyork/things-to-do/this-week-in-new-york',
    needsJS: false,
    extract($) {
      const items = [];
      $('article, [class*="card"], [class*="tile"], [data-testid]').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 5 && title.length < 120) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'secretnyc',
    url: 'https://secretnyc.co/events/',
    needsJS: false,
    extract($) {
      const items = [];
      $('article, .event, [class*="event"], .post').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, .title').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 5 && title.length < 120) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'brooklynpaper',
    url: 'https://events.brooklynpaper.com/event/',
    needsJS: false,
    extract($) {
      const items = [];
      $('.tribe-events-calendar-list__event, .event, article, [class*="event"]').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, .tribe-events-calendar-list__event-title').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('.tribe-events-calendar-list__event-datetime, [class*="date"]').first().text().trim() || '';
        const venue = $el.find('[class*="venue"]').first().text().trim();
        if (title && title.length > 3) items.push({ title, venue, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'nycparks',
    url: 'https://www.nycgovparks.org/events',
    needsJS: false,
    extract($) {
      const items = [];
      $('[class*="event"], .card, article, tr').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, a, .title').first().text().trim();
        const venue = $el.find('[class*="location"], [class*="park"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 5 && title.length < 120) items.push({ title, venue, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'eventbrite',
    url: 'https://www.eventbrite.com/d/ny--new-york/events--this-week/',
    needsJS: true, // Eventbrite is heavily JS-rendered
    extract($) {
      const items = [];
      $('[class*="event-card"], [class*="search-event"], article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 5) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'playbill',
    url: 'https://playbill.com/productions',
    needsJS: false,
    extract($) {
      const items = [];
      $('[class*="production"], [class*="show"], .card, article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const venue = $el.find('[class*="venue"], [class*="theater"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        if (title && title.length > 3 && title.length < 120) items.push({ title, venue, link, rawDate: '' });
      });
      return items;
    },
  },

  // ========== FILM ==========
  {
    name: 'metrograph',
    url: 'https://metrograph.com/calendar/',
    needsJS: true, // React app
    extract($) {
      const items = [];
      $('.film-card, .movie-card, [class*="film"], .calendar-item, [class*="screening"]').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'filmforum',
    url: 'https://filmforum.org/now-playing',
    needsJS: false,
    extract($) {
      const items = [];
      $('.film, .movie, [class*="film"], [class*="movie"]').each((_, el) => {
        const $el = $(el);
        const title = $el.find('.title, [class*="title"], h2, h3').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'ifc',
    url: 'https://www.ifccenter.com',
    needsJS: false,
    extract($) {
      const items = [];
      $('h2, h3, .film-title, [class*="film"], [class*="screening"]').each((_, el) => {
        const $el = $(el);
        const title = $el.text().trim();
        const link = $el.closest('a').attr('href') || $el.find('a').first().attr('href') || '';
        if (title && title.length > 3 && title.length < 100) items.push({ title, link, rawDate: '' });
      });
      return items;
    },
  },
  {
    name: 'bam',
    url: 'https://www.bam.org/events',
    needsJS: true, // likely JS-rendered
    extract($) {
      const items = [];
      $('[class*="event"], .card, article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3 && title.length < 120) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'movingimage',
    url: 'https://movingimage.us/visit/calendar/',
    needsJS: false,
    extract($) {
      const items = [];
      $('[class*="event"], article, .card').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3 && title.length < 120) items.push({ title, link, rawDate });
      });
      return items;
    },
  },

  // ========== MUSEUMS ==========
  {
    name: 'themet',
    url: 'https://www.metmuseum.org/exhibitions',
    needsJS: false,
    extract($) {
      const items = [];
      $('[class*="exhibition"], .card, .tile').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3 && title.length < 120) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'moma',
    url: 'https://www.moma.org/calendar',
    needsJS: true, // React app
    extract($) {
      const items = [];
      $('[class*="event"], .card, article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'whitney',
    url: 'https://whitney.org/exhibitions',
    needsJS: false,
    extract($) {
      const items = [];
      $('[class*="exhibition"], .card').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'guggenheim',
    url: 'https://www.guggenheim.org/exhibitions',
    needsJS: false,
    extract($) {
      const items = [];
      $('[class*="exhibition"], .card, .tile').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'brooklynmuseum',
    url: 'https://www.brooklynmuseum.org/exhibitions',
    needsJS: true, // Vercel security checkpoint
    extract($) {
      const items = [];
      $('[class*="exhibition"], .card, article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        if (title && title.length > 3) items.push({ title, link, rawDate: '' });
      });
      return items;
    },
  },
  {
    name: 'newmuseum',
    url: 'https://www.newmuseum.org/exhibitions',
    needsJS: false,
    extract($) {
      const items = [];
      $('[class*="exhibition"], .card, article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'neuegalerie',
    url: 'https://www.neuegalerie.org/exhibitions',
    needsJS: false,
    extract($) {
      const items = [];
      $('[class*="exhibition"], .card, article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'asiasociety',
    url: 'https://asiasociety.org/new-york/events',
    needsJS: false,
    extract($) {
      const items = [];
      $('[class*="event"], .card, article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3 && title.length < 120) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'japansociety',
    url: 'https://www.japansociety.org/events',
    needsJS: true, // likely JS-rendered
    extract($) {
      const items = [];
      $('[class*="event"], .card, article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'queensmuseum',
    url: 'https://queensmuseum.org/exhibitions/',
    needsJS: false,
    extract($) {
      const items = [];
      $('[class*="exhibition"], .card, article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'frick',
    url: 'https://www.frick.org/visit/calendar',
    needsJS: true, // uses Timely calendar widget (JS)
    extract($) {
      const items = [];
      $('.twEventTitle, [class*="event"], .card, article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('.twEventTitle, h2, h3, h4, .title').first().text().trim() || $el.text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('.twEventDate, time[datetime], [class*="date"]').first().text().trim() || '';
        if (title && title.length > 3 && title.length < 120) items.push({ title, link, rawDate });
      });
      return items;
    },
  },

  // ========== CLASSICAL / OPERA / BALLET / DANCE ==========
  {
    name: 'nyphil',
    url: 'https://nyphil.org/calendar',
    needsJS: true,
    extract($) {
      const items = [];
      $('[class*="event"], [class*="concert"], .card, article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3 && title.length < 150) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'carnegiehall',
    url: 'https://www.carnegiehall.org/calendar',
    needsJS: true,
    extract($) {
      const items = [];
      $('[class*="event"], [class*="concert"], .card, article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3 && title.length < 150) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'metopera',
    url: 'https://www.metopera.org/season/2025-26-season/',
    needsJS: false,
    extract($) {
      const items = [];
      $('[class*="opera"], [class*="production"], [class*="event"], .card, article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3 && title.length < 120) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'abt',
    url: 'https://www.abt.org/performances/',
    needsJS: false,
    extract($) {
      const items = [];
      $('[class*="performance"], [class*="event"], .card, article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'nycballet',
    url: 'https://www.nycballet.com/season-and-tickets/',
    needsJS: true,
    extract($) {
      const items = [];
      $('[class*="performance"], [class*="event"], .card, article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'joyce',
    url: 'https://www.joyce.org/performances',
    needsJS: true,
    extract($) {
      const items = [];
      $('[class*="performance"], [class*="event"], .card, article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: 'lincolncenter',
    url: 'https://www.lincolncenter.org/calendar',
    needsJS: true,
    extract($) {
      const items = [];
      $('[class*="event"], .card, article').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
  {
    name: '92ny',
    url: 'https://www.92ny.org/whats-on/events',
    needsJS: true,
    extract($) {
      const items = [];
      $('[class*="event"], .card, article, [class*="program"]').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, h3, h4, .title, [class*="title"]').first().text().trim();
        const link = $el.find('a').first().attr('href') || '';
        const rawDate = $el.find('time[datetime]').first().attr('datetime')
          || $el.find('[class*="date"]').first().text().trim() || '';
        if (title && title.length > 3 && title.length < 150) items.push({ title, link, rawDate });
      });
      return items;
    },
  },
];


// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function testSource(source, { forceJS = false } = {}) {
  const url = typeof source.url === 'function' ? source.url() : source.url;
  log(`\n${'='.repeat(70)}`);
  log(`SOURCE: ${source.name}`);
  log(`URL: ${url}`);
  log(`Method: ${(forceJS || source.needsJS) ? 'Playwright (JS)' : 'fetch + cheerio'}`);
  hr();

  const start = Date.now();

  try {
    let html, status;

    if (forceJS || source.needsJS) {
      // Use Playwright
      let browser;
      try {
        const { chromium } = require('playwright');
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);
        html = await page.content();
        status = 200;
      } finally {
        if (browser) await browser.close();
      }
    } else {
      // Use fetch + cheerio
      const result = await fetchHTML(url);
      html = result.html;
      status = result.status;
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log(`HTTP Status: ${status} | Fetch time: ${elapsed}s | HTML size: ${(html.length / 1024).toFixed(0)}KB`);

    // Check for security/block pages
    const lowerHTML = html.toLowerCase();
    if (lowerHTML.includes('security checkpoint') || lowerHTML.includes('captcha') ||
        lowerHTML.includes('access denied') || lowerHTML.includes('403 forbidden') ||
        lowerHTML.includes('just a moment') || lowerHTML.includes('checking if the site')) {
      log('⛔ BLOCKED — security checkpoint / captcha / access denied detected');
    }

    const $ = cheerio.load(html);

    // Show page title
    log(`Page title: "${$('title').text().trim()}"`);

    // Find date-related elements on the page
    const dateEls = findDateElements($);
    if (Object.keys(dateEls).length > 0) {
      log('\n📅 Date elements found on page:');
      for (const [sel, info] of Object.entries(dateEls)) {
        log(`  ${sel} (${info.count} elements)`);
        info.samples.forEach(s => log(`    → "${s}"`));
      }
    } else {
      log('\n📅 No standard date elements found (time[datetime], [class*="date"], etc.)');
    }

    // Run the source's extraction logic
    const items = source.extract($);
    log(`\n📦 Extracted items: ${items.length}`);

    if (items.length > 0) {
      const withDates = items.filter(i => i.rawDate && i.rawDate.length > 0);
      log(`📅 Items with dates: ${withDates.length}/${items.length}`);

      log('\nSample items (up to 5):');
      items.slice(0, 5).forEach((item, i) => {
        log(`  [${i+1}] "${item.title}"`);
        if (item.venue) log(`      venue: ${item.venue}`);
        if (item.rawDate) log(`      date: "${item.rawDate}"`);
        if (item.link) log(`      link: ${item.link}`);
      });

      // Show unique date formats found
      const dateFormats = [...new Set(items.map(i => i.rawDate).filter(Boolean))];
      if (dateFormats.length > 0) {
        log('\nUnique date strings found:');
        dateFormats.slice(0, 10).forEach(d => log(`  "${d}"`));
      }
    } else {
      log('\n⚠ ZERO ITEMS extracted — selectors may be wrong');
      // Dump some page structure to help debug
      log('\nPage structure hints:');
      const tags = ['article', 'section', 'main', '[class*="event"]', '[class*="card"]',
                     '[class*="list"]', '[class*="item"]', '[class*="film"]', '[class*="exhibition"]',
                     '[class*="production"]', '[class*="show"]', 'h2', 'h3'];
      for (const tag of tags) {
        const count = $(tag).length;
        if (count > 0) {
          const sample = $(tag).first();
          const cls = sample.attr('class') || '';
          log(`  ${tag}: ${count} elements (first class: "${cls.slice(0, 60)}")`);
        }
      }
    }

    return { name: source.name, status, items: items.length, elapsed, error: null };

  } catch (e) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log(`⛔ ERROR: ${e.message}`);
    return { name: source.name, status: 0, items: 0, elapsed, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    log('Available sources:');
    SOURCES.forEach(s => log(`  ${s.name.padEnd(20)} ${s.url.toString().slice(0, 60)} ${s.needsJS ? '[JS]' : '[fetch]'}`));
    process.exit(0);
  }

  const forceJS = args.includes('--js');
  const filterArgs = args.filter(a => !a.startsWith('--'));

  let toTest = SOURCES;
  if (filterArgs.length > 0) {
    toTest = SOURCES.filter(s =>
      filterArgs.some(f => s.name.toLowerCase().includes(f.toLowerCase()))
    );
    if (toTest.length === 0) {
      log(`No sources match "${filterArgs.join(', ')}". Use --list to see available names.`);
      process.exit(1);
    }
  }

  log(`Testing ${toTest.length} source(s)...\n`);

  const results = [];
  for (const source of toTest) {
    results.push(await testSource(source, { forceJS }));
  }

  // Summary
  log('\n' + '='.repeat(70));
  log('SUMMARY');
  log('='.repeat(70));
  log('Source'.padEnd(22) + 'Status'.padEnd(8) + 'Items'.padEnd(8) + 'Time'.padEnd(8) + 'Result');
  hr();
  for (const r of results) {
    const result = r.error ? `ERROR: ${r.error.slice(0, 35)}` : (r.items === 0 ? '⚠ ZERO' : '✓ OK');
    log(r.name.padEnd(22) + String(r.status).padEnd(8) + String(r.items).padEnd(8) + (r.elapsed + 's').padEnd(8) + result);
  }
  log('='.repeat(70));

  const ok = results.filter(r => r.items > 0 && !r.error).length;
  const zero = results.filter(r => r.items === 0 && !r.error).length;
  const errors = results.filter(r => r.error).length;
  log(`✓ ${ok} working | ⚠ ${zero} zero items | ⛔ ${errors} errors`);
})();
