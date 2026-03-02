#!/usr/bin/env node
/**
 * Scrape NYC General Events
 *
 * Sources (8):
 *   - doNYC              (concerts, nightlife, comedy)
 *   - The Skint           (free/cheap events)
 *   - Time Out NY         (curated picks)
 *   - Secret NYC          (things to do)
 *   - Brooklyn Magazine   (Brooklyn events)
 *   - NYC Parks           (free outdoor events, all boroughs)
 *   - Eventbrite NYC      (community events, workshops, pop-ups)
 *   - Playbill            (Broadway + Off-Broadway)
 *
 * Outputs JSON array to stdout. Pipe through validate-events.js:
 *   node scripts/scrape-general-events.js > /tmp/raw-events.json
 *   node scripts/validate-events.js /tmp/raw-events.json public/data/events.json
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
// Sources
// ---------------------------------------------------------------------------

async function scrapeDoNYC(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://donyc.com/events', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('.event-card, .event, [class*="event"], .card').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim();
          const venue = el.querySelector('.venue, [class*="venue"]')?.textContent?.trim();
          const link = el.querySelector('a')?.href;
          if (t && t.length > 3) r.push({ title: t, venue, link });
        });
        return r.slice(0, 40);
      });
      push(items, 'doNYC', 'Other', 'https://donyc.com');
      console.error(`doNYC: ${items.length}`);
    } catch (e) { console.error('doNYC error:', e.message); }
  });
}

async function scrapeTheSkint(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://theskint.com/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('.event, .post, article, [class*="event"]').forEach(el => {
          const t = el.querySelector('h2, h3, .entry-title, [class*="title"]')?.textContent?.trim();
          const link = el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 30);
      });
      push(items, 'The Skint', 'Other', 'https://theskint.com');
      console.error(`The Skint: ${items.length}`);
    } catch (e) { console.error('The Skint error:', e.message); }
  });
}

async function scrapeTimeOut(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.timeout.com/newyork/things-to-do/this-week-in-new-york', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[data-testid*="event"], .event, [class*="eventCard"], article, h3').forEach(el => {
          const t = el.querySelector('h3, h2, [data-testid*="title"], [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const venue = el.querySelector('[data-testid*="venue"], [class*="venue"]')?.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 5 && t.length < 120) r.push({ title: t, venue, link });
        });
        return r.slice(0, 30);
      });
      push(items, 'Time Out NY', 'Other', 'https://www.timeout.com/newyork');
      console.error(`Time Out: ${items.length}`);
    } catch (e) { console.error('Time Out error:', e.message); }
  });
}

async function scrapeSecretNYC(browser) {
  // Main events page
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://secretnyc.co/events/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      try {
        const btn = await page.$('button[class*="cookie"], button[id*="accept"], .accept-cookies');
        if (btn) await btn.click();
        await page.waitForTimeout(2000);
      } catch (_) {}
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('.event, article, [class*="event"], .post').forEach(el => {
          const t = el.querySelector('h2, h3, .title, [class*="title"]')?.textContent?.trim();
          const link = el.querySelector('a')?.href;
          if (t && t.length > 5 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 30);
      });
      push(items, 'Secret NYC', 'Other', 'https://secretnyc.co');
      console.error(`Secret NYC (events): ${items.length}`);
    } catch (e) { console.error('Secret NYC events error:', e.message); }
  });

  // Weekend roundup — great for Sunday runs, catches weekend + multi-day events
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://secretnyc.co/what-to-do-this-weekend-nyc/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      try {
        const btn = await page.$('button[class*="cookie"], button[id*="accept"], .accept-cookies');
        if (btn) await btn.click();
        await page.waitForTimeout(2000);
      } catch (_) {}
      const items = await page.evaluate(() => {
        const r = [];
        // Article-style page — grab headings and list items that look like event names
        document.querySelectorAll('article h2, article h3, article li, .entry-content h2, .entry-content h3').forEach(el => {
          const t = el.textContent?.trim();
          const link = el.querySelector('a')?.href || el.closest('a')?.href;
          if (t && t.length > 5 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 30);
      });
      push(items, 'Secret NYC', 'Other', 'https://secretnyc.co/what-to-do-this-weekend-nyc/');
      console.error(`Secret NYC (weekend): ${items.length}`);
    } catch (e) { console.error('Secret NYC weekend error:', e.message); }
  });
}

async function scrapeBrooklynMag(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://brooklynmagazine.com/events/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('.event, article, [class*="event"]').forEach(el => {
          const t = el.querySelector('h2, h3, .title, [class*="title"]')?.textContent?.trim();
          const link = el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, link });
        });
        return r.slice(0, 30);
      });
      push(items, 'Brooklyn Magazine', 'Other', 'https://brooklynmagazine.com');
      console.error(`Brooklyn Magazine: ${items.length}`);
    } catch (e) { console.error('Brooklyn Magazine error:', e.message); }
  });
}

async function scrapeNYCParks(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.nycgovparks.org/events', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="event"], .card, article, tr, li').forEach(el => {
          const t = el.querySelector('h2, h3, h4, a, .title, [class*="title"]')?.textContent?.trim();
          const venue = el.querySelector('[class*="location"], [class*="park"]')?.textContent?.trim();
          const link = el.querySelector('a')?.href;
          if (t && t.length > 5 && t.length < 120) r.push({ title: t, venue, link });
        });
        return r.slice(0, 30);
      });
      push(items, 'NYC Parks', 'Outdoor/Parks', 'https://www.nycgovparks.org/events');
      console.error(`NYC Parks: ${items.length}`);
    } catch (e) { console.error('NYC Parks error:', e.message); }
  });
}

async function scrapeEventbrite(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://www.eventbrite.com/d/ny--new-york/events--this-week/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="event-card"], [class*="search-event"], article, [data-testid*="event"]').forEach(el => {
          const t = el.querySelector('h2, h3, h4, [class*="title"]')?.textContent?.trim();
          const venue = el.querySelector('[class*="location"], [class*="venue"]')?.textContent?.trim();
          const link = el.querySelector('a')?.href;
          if (t && t.length > 5 && t.length < 120) r.push({ title: t, venue, link });
        });
        return r.slice(0, 25);
      });
      push(items, 'Eventbrite', 'Other', 'https://www.eventbrite.com');
      console.error(`Eventbrite: ${items.length}`);
    } catch (e) { console.error('Eventbrite error:', e.message); }
  });
}

async function scrapePlaybill(browser) {
  await withPage(browser, async (page) => {
    try {
      await page.goto('https://playbill.com/productions', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const items = await page.evaluate(() => {
        const r = [];
        document.querySelectorAll('[class*="production"], [class*="show"], .card, article, h2, h3').forEach(el => {
          const t = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim() || el.textContent?.trim();
          const venue = el.querySelector('[class*="venue"], [class*="theater"]')?.textContent?.trim();
          const link = el.closest('a')?.href || el.querySelector('a')?.href;
          if (t && t.length > 3 && t.length < 120) r.push({ title: t, venue, link });
        });
        return r.slice(0, 30);
      });
      push(items, 'Broadway', 'Theater', 'https://playbill.com/productions');
      console.error(`Playbill: ${items.length}`);
    } catch (e) { console.error('Playbill error:', e.message); }
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  const browser = await chromium.launch({ headless: true });

  await scrapeDoNYC(browser);
  await scrapeTheSkint(browser);
  await scrapeTimeOut(browser);
  await scrapeSecretNYC(browser);
  await scrapeBrooklynMag(browser);
  await scrapeNYCParks(browser);
  await scrapeEventbrite(browser);
  await scrapePlaybill(browser);

  await browser.close();

  console.error(`\nTotal: ${events.length} general events for ${RANGE}`);
  console.log(JSON.stringify(events, null, 2));
})();
