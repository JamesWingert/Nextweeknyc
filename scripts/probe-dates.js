#!/usr/bin/env node
/**
 * Probe each scraper source to find where dates live in the DOM.
 * Run: node scripts/probe-dates.js [source-name]
 * If no source name given, probes all sources.
 */

const cheerio = require('cheerio');
const https = require('https');
const http = require('http');

function fetchHTML(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const timer = setTimeout(() => reject(new Error('Timeout')), 20000);
    mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,*/*',
      },
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        clearTimeout(timer);
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        return fetchHTML(next, maxRedirects - 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { clearTimeout(timer); resolve(data); });
      res.on('error', e => { clearTimeout(timer); reject(e); });
    }).on('error', e => { clearTimeout(timer); reject(e); });
  });
}

// Probe a cheerio-based source
async function probeCheerio(name, url, selectors) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`PROBING: ${name}`);
  console.log(`URL: ${url}`);
  console.log('='.repeat(60));
  try {
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);

    // Look for common date patterns
    const dateSelectors = [
      'time[datetime]',
      '[class*="date"]',
      '[class*="Date"]',
      '[data-date]',
      '[itemprop="startDate"]',
      '[itemprop="endDate"]',
      'meta[itemprop="startDate"]',
      '.event-date',
      '.exhibition-date',
      '.show-date',
      ...selectors,
    ];

    for (const sel of dateSelectors) {
      const els = $(sel);
      if (els.length > 0) {
        console.log(`\n  ✓ ${sel} — ${els.length} match(es)`);
        els.slice(0, 5).each((i, el) => {
          const $el = $(el);
          const text = $el.text().trim().replace(/\s+/g, ' ').slice(0, 100);
          const datetime = $el.attr('datetime') || $el.attr('content') || '';
          const dataDate = $el.attr('data-date') || '';
          let info = `    [${i}] text: "${text}"`;
          if (datetime) info += ` | datetime="${datetime}"`;
          if (dataDate) info += ` | data-date="${dataDate}"`;
          console.log(info);
        });
        if (els.length > 5) console.log(`    ... and ${els.length - 5} more`);
      }
    }

    // Also look for date-like text patterns in the first few event cards
    const cardSelectors = [
      '[class*="exhibition"]', '[class*="event"]', '.card', 'article',
      '[class*="show"]', '[class*="film"]', '[class*="performance"]',
      'a[href*="/exhibition"]', 'a[href*="/event"]', 'a[href*="/film"]',
    ];
    console.log('\n  --- Card-level date search ---');
    for (const cardSel of cardSelectors) {
      const cards = $(cardSel);
      if (cards.length > 0) {
        console.log(`\n  Cards matching "${cardSel}": ${cards.length}`);
        cards.slice(0, 3).each((i, el) => {
          const $el = $(el);
          const fullText = $el.text().trim().replace(/\s+/g, ' ').slice(0, 300);
          // Look for date patterns in the text
          const datePatterns = fullText.match(
            /(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:\s*[,–—-]\s*(?:\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}))?(?:\s*,?\s*\d{4})?/gi
          );
          if (datePatterns) {
            console.log(`    [${i}] DATE FOUND: ${datePatterns.join(' | ')}`);
          }
          // Show a snippet
          console.log(`    [${i}] snippet: "${fullText.slice(0, 150)}"`);
        });
      }
    }
  } catch (e) {
    console.log(`  ✗ ERROR: ${e.message}`);
  }
}

// Probe a Playwright-based source
async function probePlaywright(name, url, evalFn) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`PROBING (Playwright): ${name}`);
  console.log(`URL: ${url}`);
  console.log('='.repeat(60));
  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    const result = await page.evaluate(evalFn);
    console.log(result);

    await browser.close();
  } catch (e) {
    console.log(`  ✗ ERROR: ${e.message}`);
  }
}

const CHEERIO_SOURCES = {
  'ifc': { name: 'IFC Center', url: 'https://www.ifccenter.com', selectors: ['.showing-date', '.schedule-date', '[class*="schedule"]'] },
  'met': { name: 'The Met', url: 'https://www.metmuseum.org/exhibitions', selectors: ['[class*="exhibition-date"]', '[class*="dates"]', '.card__date'] },
  'whitney': { name: 'Whitney', url: 'https://whitney.org/exhibitions', selectors: ['[class*="exhibition-date"]', '[class*="dates"]'] },
  'neue': { name: 'Neue Galerie', url: 'https://www.neuegalerie.org/exhibitions', selectors: ['[class*="date"]'] },
  'bam': { name: 'BAM', url: 'https://www.bam.org', selectors: ['.eventInfo', '[class*="date"]', '[class*="Date"]'] },
  'timeout': { name: 'Time Out NY', url: 'https://www.timeout.com/newyork/things-to-do', selectors: ['time', '[class*="date"]'] },
  'skint': { name: 'The Skint', url: 'https://theskint.com/', selectors: ['.entry-date', 'time', '[class*="date"]'] },
  'playbill': { name: 'Playbill', url: 'https://playbill.com/productions', selectors: ['[class*="date"]', 'time', '.production-date'] },
};

const PLAYWRIGHT_SOURCES = {
  'filmforum': { name: 'Film Forum', url: 'https://filmforum.org/', evalFn: () => {
    const results = [];
    // Look for date elements
    const dateEls = document.querySelectorAll('time, [class*="date"], [class*="Date"], [data-date]');
    results.push(`Date elements found: ${dateEls.length}`);
    dateEls.forEach((el, i) => {
      if (i < 10) results.push(`  [${i}] tag=${el.tagName} class="${el.className}" text="${el.textContent?.trim().slice(0,80)}" datetime="${el.getAttribute('datetime')||''}" data-date="${el.getAttribute('data-date')||''}"`);
    });
    // Look at film links and their parent context
    const filmLinks = document.querySelectorAll('a[href*="/film/"]');
    results.push(`\nFilm links: ${filmLinks.length}`);
    filmLinks.forEach((el, i) => {
      if (i < 5) {
        const parent = el.closest('div, article, section, li');
        const parentText = parent?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 200) || '';
        results.push(`  [${i}] title="${el.textContent?.trim().slice(0,60)}" parent="${parentText.slice(0,150)}"`);
      }
    });
    return results.join('\n');
  }},
  'metrograph': { name: 'Metrograph', url: 'https://metrograph.com/calendar/', evalFn: () => {
    const results = [];
    const dateEls = document.querySelectorAll('time, [class*="date"], [class*="Date"], [data-date]');
    results.push(`Date elements: ${dateEls.length}`);
    dateEls.forEach((el, i) => {
      if (i < 10) results.push(`  [${i}] tag=${el.tagName} class="${el.className}" text="${el.textContent?.trim().slice(0,80)}" datetime="${el.getAttribute('datetime')||''}"`);
    });
    // Calendar items
    const items = document.querySelectorAll('[class*="film"], [class*="screening"], .calendar-item, [class*="calendar"]');
    results.push(`\nCalendar items: ${items.length}`);
    items.forEach((el, i) => {
      if (i < 5) results.push(`  [${i}] class="${el.className?.slice(0,80)}" text="${el.textContent?.trim().replace(/\s+/g,' ').slice(0,150)}"`);
    });
    return results.join('\n');
  }},
  'guggenheim': { name: 'Guggenheim', url: 'https://www.guggenheim.org/exhibitions', evalFn: () => {
    const results = [];
    const timeEls = document.querySelectorAll('time[datetime]');
    results.push(`time[datetime] elements: ${timeEls.length}`);
    timeEls.forEach((el, i) => {
      if (i < 10) results.push(`  [${i}] datetime="${el.getAttribute('datetime')}" text="${el.textContent?.trim().slice(0,80)}"`);
    });
    const dateEls = document.querySelectorAll('[class*="date"], [class*="Date"]');
    results.push(`\n[class*="date"] elements: ${dateEls.length}`);
    dateEls.forEach((el, i) => {
      if (i < 10) results.push(`  [${i}] class="${el.className?.slice(0,60)}" text="${el.textContent?.trim().slice(0,80)}"`);
    });
    // Exhibition cards
    const cards = document.querySelectorAll('a[href*="/exhibition/"]');
    results.push(`\nExhibition links: ${cards.length}`);
    cards.forEach((el, i) => {
      if (i < 5) {
        const card = el.closest('article, [class*="card"], li, div');
        results.push(`  [${i}] title="${el.textContent?.trim().slice(0,60)}" card="${card?.textContent?.trim().replace(/\s+/g,' ').slice(0,200)}"`);
      }
    });
    return results.join('\n');
  }},
  'carnegie': { name: 'Carnegie Hall', url: 'https://www.carnegiehall.org/calendar', evalFn: () => {
    const results = [];
    // Check for date elements
    const dateEls = document.querySelectorAll('time, [class*="date"], [class*="Date"], [data-date]');
    results.push(`Date elements: ${dateEls.length}`);
    dateEls.forEach((el, i) => {
      if (i < 15) results.push(`  [${i}] tag=${el.tagName} class="${el.className?.slice(0,60)}" text="${el.textContent?.trim().slice(0,80)}" datetime="${el.getAttribute('datetime')||''}"`);
    });
    // Event cards
    const cards = document.querySelectorAll('[class*="event"], article, .card');
    results.push(`\nEvent cards: ${cards.length}`);
    cards.forEach((el, i) => {
      if (i < 5) results.push(`  [${i}] class="${el.className?.slice(0,60)}" text="${el.textContent?.trim().replace(/\s+/g,' ').slice(0,200)}"`);
    });
    return results.join('\n');
  }},
  '92ny': { name: '92NY', url: 'https://www.92ny.org/whats-on/events', evalFn: () => {
    const results = [];
    const dateEls = document.querySelectorAll('time, [class*="date"], [class*="Date"]');
    results.push(`Date elements: ${dateEls.length}`);
    dateEls.forEach((el, i) => {
      if (i < 10) results.push(`  [${i}] tag=${el.tagName} class="${el.className?.slice(0,60)}" text="${el.textContent?.trim().slice(0,80)}"`);
    });
    const eventLinks = document.querySelectorAll('a[href*="/event/"]');
    results.push(`\nEvent links: ${eventLinks.length}`);
    eventLinks.forEach((el, i) => {
      if (i < 5) {
        const card = el.closest('div, article, li');
        results.push(`  [${i}] title="${el.textContent?.trim().slice(0,60)}" card="${card?.textContent?.trim().replace(/\s+/g,' ').slice(0,200)}"`);
      }
    });
    return results.join('\n');
  }},
  'japan': { name: 'Japan Society', url: 'https://www.japansociety.org/events', evalFn: () => {
    const results = [];
    const dateEls = document.querySelectorAll('time, [class*="date"], [class*="Date"]');
    results.push(`Date elements: ${dateEls.length}`);
    dateEls.forEach((el, i) => {
      if (i < 10) results.push(`  [${i}] tag=${el.tagName} class="${el.className?.slice(0,60)}" text="${el.textContent?.trim().slice(0,80)}"`);
    });
    const eventLinks = document.querySelectorAll('a[href*="/events/"]');
    results.push(`\nEvent links: ${eventLinks.length}`);
    eventLinks.forEach((el, i) => {
      if (i < 5) {
        const card = el.closest('div, article, li');
        results.push(`  [${i}] title="${el.textContent?.trim().slice(0,60)}" card="${card?.textContent?.trim().replace(/\s+/g,' ').slice(0,200)}"`);
      }
    });
    return results.join('\n');
  }},
  'eventbrite': { name: 'Eventbrite', url: 'https://www.eventbrite.com/d/ny--new-york/events--this-week/', evalFn: () => {
    const results = [];
    const dateEls = document.querySelectorAll('time, [class*="date"], [class*="Date"], [data-testid*="date"]');
    results.push(`Date elements: ${dateEls.length}`);
    dateEls.forEach((el, i) => {
      if (i < 10) results.push(`  [${i}] tag=${el.tagName} class="${el.className?.slice(0,60)}" text="${el.textContent?.trim().slice(0,80)}" datetime="${el.getAttribute('datetime')||''}"`);
    });
    const cards = document.querySelectorAll('[class*="event-card"], [data-testid*="event"], article');
    results.push(`\nEvent cards: ${cards.length}`);
    cards.forEach((el, i) => {
      if (i < 5) results.push(`  [${i}] class="${el.className?.slice(0,60)}" text="${el.textContent?.trim().replace(/\s+/g,' ').slice(0,200)}"`);
    });
    return results.join('\n');
  }},
};

(async () => {
  const target = process.argv[2]?.toLowerCase();

  // Run cheerio probes
  for (const [key, src] of Object.entries(CHEERIO_SOURCES)) {
    if (target && target !== key && target !== 'all-cheerio') continue;
    await probeCheerio(src.name, src.url, src.selectors);
  }

  // Run Playwright probes
  const pwKeys = Object.keys(PLAYWRIGHT_SOURCES).filter(k => !target || target === k || target === 'all-playwright' || target === 'all');
  if (pwKeys.length > 0) {
    for (const key of pwKeys) {
      const src = PLAYWRIGHT_SOURCES[key];
      await probePlaywright(src.name, src.url, src.evalFn);
    }
  }

  if (!target) {
    console.log('\n\nUsage: node scripts/probe-dates.js [source-key|all|all-cheerio|all-playwright]');
    console.log('Cheerio sources:', Object.keys(CHEERIO_SOURCES).join(', '));
    console.log('Playwright sources:', Object.keys(PLAYWRIGHT_SOURCES).join(', '));
  }
})();
