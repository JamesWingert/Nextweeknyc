#!/usr/bin/env node
/**
 * Scrape NYC Film, Arts, Classical, Opera, Ballet & Museum Events
 *
 * Sources (20):
 *   FILM:       Metrograph, Film Forum, IFC Center, BAM, Museum of the Moving Image
 *   MUSEUMS:    The Met, MoMA, Whitney, Guggenheim, Brooklyn Museum, New Museum,
 *               Neue Galerie, Asia Society, Japan Society, The Frick
 *   CLASSICAL:  NY Philharmonic, Carnegie Hall
 *   OPERA:      Metropolitan Opera
 *   BALLET:     American Ballet Theatre, New York City Ballet
 *   DANCE:      The Joyce Theater
 *
 * Outputs JSON array to stdout. Pipe through validate-events.js:
 *   node scripts/scrape-film-arts.js > /tmp/raw-film.json
 *   node scripts/validate-events.js /tmp/raw-film.json public/data/film_museum_events.json
 *
 * Dynamic week: runs on Sunday, populates next Mon–Sun.
 * Override with WEEK_START / WEEK_END env vars (YYYY-MM-DD).
 */

const { chromium } = require('playwright');

const events = [];

// ---------------------------------------------------------------------------
// Week calculation — next Monday through Sunday
// ---------------------------------------------------------------------------

function nextWeekRange() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  // Days until next Monday: if Sun(0) → 1, Mon(1) → 7, Tue(2) → 6, etc.
  const daysUntilMon = day === 0 ? 1 : (8 - day);
  const mon = new Date(now);
  mon.setDate(now.getDate() + daysUntilMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return {
    start: process.env.WEEK_START || fmt(mon),
    end:   process.env.WEEK_END   || fmt(sun),
  };
}

const WEEK = nextWeekRange();
const RANGE = `${WEEK.start} to ${WEEK.end}`;
console.error(`Week range: ${RANGE}`);

async function withPage(browser, fn) {
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  try { await fn(page); } catch (e) { /* handled per-source */ } finally { await page.close(); }
}

function push(items, venue, category, fallbackUrl) {
  items.forEach(item => {
    events.push({
      title: (item.title || '').trim(),
      venue: item.venue || venue,
      date: item.date || RANGE,
      category,
      url: item.link || item.url || fallbackUrl,
      ...(item.time ? { time: item.time } : {}),
      ...(item.description ? { description: item.description } : {}),
    });
  });
}

// ---------------------------------------------------------------------------
// FILM
// ---------------------------------------------------------------------------

async function scrapeMetrograph(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://metrograph.com/calendar/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('.film-card, .movie-card, [class*="film"], h2, h3').forEach(el => {
          const t = el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 100) r.push({ title: t, link });
        });
        return r.slice(0, 25);
      });
      push(items, 'Metrograph', 'Film', 'https://metrograph.com');
      console.error(`Metrograph: ${items.length}`);
    } catch (e) { console.error('Metrograph error:', e.message); }
  });
}

async function scrapeFilmForum(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://filmforum.org/now-playing', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('.film, .movie, [class*="film"], [class*="movie"], h2, h3').forEach(el => {
          const t = el.querySelector('.title, [class*="title"], h2, h3')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 100) r.push({ title: t, link });
        });
        return r.slice(0, 20);
      });
      push(items, 'Film Forum', 'Film', 'https://filmforum.org/now-playing');
      console.error(`Film Forum: ${items.length}`);
    } catch (e) { console.error('Film Forum error:', e.message); }
  });
}

async function scrapeIFC(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.ifccenter.com', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('h2, h3, .film-title, .title').forEach(el => {
          const t = el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 100) r.push({ title: t, link });
        });
        return r.slice(0, 20);
      });
      push(items, 'IFC Center', 'Film', 'https://www.ifccenter.com');
      console.error(`IFC Center: ${items.length}`);
    } catch (e) { console.error('IFC Center error:', e.message); }
  });
}

async function scrapeBAM(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.bam.org/events', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="event"], .card, article, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 25);
      });
      push(items, 'BAM', 'Music/Performing Arts', 'https://www.bam.org');
      console.error(`BAM: ${items.length}`);
    } catch (e) { console.error('BAM error:', e.message); }
  });
}

async function scrapeMovingImage(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://movingimage.us/visit/calendar/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="event"], article, .card, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 15);
      });
      push(items, 'Museum of the Moving Image', 'Film', 'https://movingimage.us');
      console.error(`Moving Image: ${items.length}`);
    } catch (e) { console.error('Moving Image error:', e.message); }
  });
}

// ---------------------------------------------------------------------------
// MUSEUMS & ART
// ---------------------------------------------------------------------------

async function scrapeTheMet(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.metmuseum.org/exhibitions', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('.exhibition, [class*="exhibition"], .card, .tile, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120 && !/^Exhibitions$/i.test(t)) r.push({ title: t, link });
        });
        return r.slice(0, 15);
      });
      push(items, 'The Met', 'Art', 'https://www.metmuseum.org/exhibitions');
      console.error(`The Met: ${items.length}`);
    } catch (e) { console.error('The Met error:', e.message); }
  });
}

async function scrapeMoMA(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.moma.org/calendar', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('.event-card, [class*="event"], .card, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 20);
      });
      push(items, 'MoMA', 'Art', 'https://www.moma.org/calendar');
      console.error(`MoMA: ${items.length}`);
    } catch (e) { console.error('MoMA error:', e.message); }
  });
}

async function scrapeWhitney(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://whitney.org/exhibitions', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('.exhibition-card, [class*="exhibition"], .card, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 10);
      });
      push(items, 'Whitney Museum', 'Art', 'https://whitney.org');
      console.error(`Whitney: ${items.length}`);
    } catch (e) { console.error('Whitney error:', e.message); }
  });
}

async function scrapeGuggenheim(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.guggenheim.org/exhibitions', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('.exhibition, [class*="exhibition"], .card, .tile, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 10);
      });
      push(items, 'Guggenheim', 'Art', 'https://www.guggenheim.org/exhibitions');
      console.error(`Guggenheim: ${items.length}`);
    } catch (e) { console.error('Guggenheim error:', e.message); }
  });
}

async function scrapeBrooklynMuseum(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.brooklynmuseum.org/exhibitions', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="exhibition"], .card, article, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 15);
      });
      push(items, 'Brooklyn Museum', 'Art', 'https://www.brooklynmuseum.org/exhibitions');
      console.error(`Brooklyn Museum: ${items.length}`);
    } catch (e) { console.error('Brooklyn Museum error:', e.message); }
  });
}

async function scrapeNewMuseum(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.newmuseum.org/exhibitions', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="exhibition"], .card, article, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 10);
      });
      push(items, 'New Museum', 'Art', 'https://www.newmuseum.org');
      console.error(`New Museum: ${items.length}`);
    } catch (e) { console.error('New Museum error:', e.message); }
  });
}

async function scrapeNeueGalerie(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.neuegalerie.org/exhibitions', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="exhibition"], .card, article, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 10);
      });
      push(items, 'Neue Galerie', 'Art', 'https://www.neuegalerie.org');
      console.error(`Neue Galerie: ${items.length}`);
    } catch (e) { console.error('Neue Galerie error:', e.message); }
  });
}

async function scrapeAsiaSociety(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://asiasociety.org/new-york/events', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="event"], .card, article, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 15);
      });
      push(items, 'Asia Society', 'Art', 'https://asiasociety.org/new-york/events');
      console.error(`Asia Society: ${items.length}`);
    } catch (e) { console.error('Asia Society error:', e.message); }
  });
}

async function scrapeJapanSociety(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.japansociety.org/events', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="event"], .card, article, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 15);
      });
      push(items, 'Japan Society', 'Art', 'https://www.japansociety.org/events');
      console.error(`Japan Society: ${items.length}`);
    } catch (e) { console.error('Japan Society error:', e.message); }
  });
}

async function scrapeQueensMuseum(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://queensmuseum.org/exhibitions/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="exhibition"], .card, article, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 10);
      });
      push(items, 'Queens Museum', 'Art', 'https://queensmuseum.org');
      console.error(`Queens Museum: ${items.length}`);
    } catch (e) { console.error('Queens Museum error:', e.message); }
  });
}

async function scrapeFrick(browser) {
  await withPage(browser, async (page) => {
    try {
      // Frick uses Trumba calendar widget
      await page.goto('https://www.frick.org/visit/calendar', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
      const items = await page.evaluate(() => {
        const r = [];
        // Try Trumba widget elements and standard selectors
        document.querySelectorAll('.twEventTitle, [class*="event"], .card, article, h2, h3, a[href*="frick"]').forEach(el => {
          const t = el.querySelector('.twEventTitle, h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 15);
      });
      push(items, 'The Frick Collection', 'Art', 'https://www.frick.org/visit/calendar');
      console.error(`The Frick: ${items.length}`);
    } catch (e) { console.error('The Frick error:', e.message); }
  });
}

// ---------------------------------------------------------------------------
// CLASSICAL MUSIC
// ---------------------------------------------------------------------------

async function scrapeNYPhil(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://nyphil.org/calendar', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="event"], [class*="concert"], .card, article, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 150) r.push({ title: t, link });
        });
        return r.slice(0, 15);
      });
      push(items, 'New York Philharmonic', 'Classical Music', 'https://nyphil.org/calendar');
      console.error(`NY Philharmonic: ${items.length}`);
    } catch (e) { console.error('NY Philharmonic error:', e.message); }
  });
}

async function scrapeCarnegieHall(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.carnegiehall.org/calendar', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="event"], [class*="concert"], .card, article, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const time = el.querySelector('[class*="time"], time, .date')?.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 150) r.push({ title: t, link, time });
        });
        return r.slice(0, 20);
      });
      push(items, 'Carnegie Hall', 'Classical Music', 'https://www.carnegiehall.org/calendar');
      console.error(`Carnegie Hall: ${items.length}`);
    } catch (e) { console.error('Carnegie Hall error:', e.message); }
  });
}

// ---------------------------------------------------------------------------
// OPERA
// ---------------------------------------------------------------------------

async function scrapeMetOpera(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.metopera.org/season/2025-26-season/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="opera"], [class*="production"], [class*="event"], .card, article, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 15);
      });
      push(items, 'Metropolitan Opera', 'Opera', 'https://www.metopera.org');
      console.error(`Met Opera: ${items.length}`);
    } catch (e) { console.error('Met Opera error:', e.message); }
  });
}

// ---------------------------------------------------------------------------
// BALLET & DANCE
// ---------------------------------------------------------------------------

async function scrapeABT(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.abt.org/performances/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="performance"], [class*="event"], .card, article, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 15);
      });
      push(items, 'American Ballet Theatre', 'Ballet', 'https://www.abt.org/performances/');
      console.error(`ABT: ${items.length}`);
    } catch (e) { console.error('ABT error:', e.message); }
  });
}

async function scrapeNYCB(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.nycballet.com/season-and-tickets/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="performance"], [class*="event"], .card, article, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 15);
      });
      push(items, 'New York City Ballet', 'Ballet', 'https://www.nycballet.com');
      console.error(`NYCB: ${items.length}`);
    } catch (e) { console.error('NYCB error:', e.message); }
  });
}

async function scrapeJoyce(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.joyce.org/performances', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="performance"], [class*="event"], .card, article, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 15);
      });
      push(items, 'The Joyce Theater', 'Dance', 'https://www.joyce.org/performances');
      console.error(`Joyce Theater: ${items.length}`);
    } catch (e) { console.error('Joyce Theater error:', e.message); }
  });
}

// ---------------------------------------------------------------------------
// LINCOLN CENTER (multi-category)
// ---------------------------------------------------------------------------

async function scrapeLincolnCenter(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.lincolncenter.org/calendar', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[data-testid*="event"], .event-card, .event, .card, [class*="event"]').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim();
          const venue = el.querySelector('.venue, [class*="venue"]')?.textContent?.trim();
          const link = el.querySelector('a')?.href;
          if (t && t.length > 3) r.push({ title: t, venue, link });
        });
        return r.slice(0, 25);
      });
      push(items, 'Lincoln Center', 'Music/Performing Arts', 'https://www.lincolncenter.org/calendar');
      console.error(`Lincoln Center: ${items.length}`);
    } catch (e) { console.error('Lincoln Center error:', e.message); }
  });
}

// ---------------------------------------------------------------------------
// 92NY
// ---------------------------------------------------------------------------

async function scrape92NY(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.92ny.org/whats-on/events', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="event"], .card, article, h2, h3, [class*="program"]').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 150) r.push({ title: t, link });
        });
        return r.slice(0, 20);
      });
      push(items, '92NY', 'Music/Performing Arts', 'https://www.92ny.org/whats-on/events');
      console.error(`92NY: ${items.length}`);
    } catch (e) { console.error('92NY error:', e.message); }
  });
}

// ---------------------------------------------------------------------------
// Main — single browser instance, all sources sequential
// ---------------------------------------------------------------------------

(async () => {
  const browser = await chromium.launch({ headless: true });

  // Film
  await scrapeMetrograph(browser);
  await scrapeFilmForum(browser);
  await scrapeIFC(browser);
  await scrapeBAM(browser);
  await scrapeMovingImage(browser);

  // Museums & Art
  await scrapeTheMet(browser);
  await scrapeMoMA(browser);
  await scrapeWhitney(browser);
  await scrapeGuggenheim(browser);
  await scrapeBrooklynMuseum(browser);
  await scrapeNewMuseum(browser);
  await scrapeNeueGalerie(browser);
  await scrapeAsiaSociety(browser);
  await scrapeJapanSociety(browser);
  await scrapeQueensMuseum(browser);
  await scrapeFrick(browser);

  // Classical
  await scrapeNYPhil(browser);
  await scrapeCarnegieHall(browser);

  // Opera
  await scrapeMetOpera(browser);

  // Ballet & Dance
  await scrapeABT(browser);
  await scrapeNYCB(browser);
  await scrapeJoyce(browser);

  // Multi-category
  await scrapeLincolnCenter(browser);
  await scrape92NY(browser);

  await browser.close();

  console.error(`\nTotal: ${events.length} film/arts events for ${RANGE}`);
  console.log(JSON.stringify(events, null, 2));
})();
