#!/usr/bin/env node
/**
 * Scrape NYC Film & Arts Events
 * Sources: Metrograph, Film Forum, IFC Center, Lincoln Center, The Met, MoMA, Whitney, Guggenheim
 */

const { chromium } = require('playwright');

const events = [];

async function scrapeMetrograph(page) {
  try {
    await page.goto('https://metrograph.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    const eventsLink = await page.locator('text=Events').first();
    if (await eventsLink.isVisible().catch(() => false)) await eventsLink.click();
    await page.waitForTimeout(5000);
    
    const items = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('h2, h3, .title').forEach((el, i) => {
        const title = el.textContent?.trim();
        if (title && title.length > 5 && title.length < 80) {
          results.push({ title, venue: 'Metrograph', category: 'Film' });
        }
      });
      return results.slice(0, 20);
    });
    
    items.forEach((item, i) => {
      events.push({
        id: `metro_${i}`,
        ...item,
        date: '2026-03-09 to 2026-03-15',
        sourceUrl: 'https://metrograph.com'
      });
    });
    console.error(`Metrograph: ${items.length} events`);
  } catch (e) {
    console.error('Metrograph error:', e.message);
  }
}

async function scrapeFilmForum(page) {
  try {
    await page.goto('https://filmforum.org/now-playing', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(5000);
    
    const text = await page.evaluate(() => document.body.innerText);
    const lines = text.split('\n').filter(l => l.trim().length > 3);
    
    lines.slice(0, 20).forEach((line, i) => {
      if (line.match(/[A-Z]/)) {
        events.push({
          id: `ff_${i}`,
          title: line.trim().substring(0, 60),
          venue: 'Film Forum',
          date: '2026-03-09 to 2026-03-15',
          category: 'Film',
          sourceUrl: 'https://filmforum.org/now-playing'
        });
      }
    });
    console.error(`Film Forum: ~20 events`);
  } catch (e) {
    console.error('Film Forum error:', e.message);
  }
}

async function scrapeIFC(page) {
  try {
    await page.goto('https://www.ifccenter.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(5000);
    
    const items = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('h2, h3, .film-title, .title').forEach((el, i) => {
        const title = el.textContent?.trim();
        if (title && title.length > 5 && title.length < 80) {
          results.push({ title, venue: 'IFC Center', category: 'Film' });
        }
      });
      return results.slice(0, 15);
    });
    
    items.forEach((item, i) => {
      events.push({
        id: `ifc_${i}`,
        ...item,
        date: '2026-03-09 to 2026-03-15',
        sourceUrl: 'https://www.ifccenter.com'
      });
    });
    console.error(`IFC Center: ${items.length} events`);
  } catch (e) {
    console.error('IFC error:', e.message);
  }
}

async function scrapeMuseums(page) {
  // The Met
  try {
    await page.goto('https://www.metmuseum.org/exhibitions', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(5000);
    
    const items = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('h2, h3, .exhibition-title').forEach((el, i) => {
        const title = el.textContent?.trim();
        if (title && title.length > 5 && title.length < 100 && !title.includes('Exhibitions')) {
          results.push({ title, venue: 'The Met', category: 'Museums/Art' });
        }
      });
      return results.slice(0, 8);
    });
    
    items.forEach((item, i) => {
      events.push({
        id: `met_${i}`,
        ...item,
        date: '2026-03-09 to 2026-04-09',
        sourceUrl: 'https://www.metmuseum.org/exhibitions'
      });
    });
    console.error(`The Met: ${items.length} exhibitions`);
  } catch (e) {
    console.error('The Met error:', e.message);
  }
  
  // Add more museums as needed...
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await scrapeMetrograph(page);
  await scrapeFilmForum(page);
  await scrapeIFC(page);
  await scrapeMuseums(page);
  
  await browser.close();
  
  // Output to stdout
  console.log(JSON.stringify({ weekOf: '2026-03-09', events }, null, 2));
})();
