const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeDoNYC() {
  console.log('Scraping doNYC...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const allEvents = [];
  try {
    // Try events page
    await page.goto('https://donyc.com/events', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    const events = await page.evaluate(() => {
      const items = [];
      const eventEls = document.querySelectorAll('.event-card, .event, [class*="event"], .card');
      eventEls.forEach(el => {
        const title = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim();
        const venue = el.querySelector('.venue, [class*="venue"]')?.textContent?.trim();
        const dateText = el.querySelector('.date, [class*="date"], time')?.textContent?.trim();
        const link = el.querySelector('a')?.href;
        if (title) {
          items.push({ title, venue, dateText, link });
        }
      });
      return items;
    });
    
    allEvents.push(...events);
    await browser.close();
  } catch (e) {
    console.log('doNYC error:', e.message);
    await browser.close();
  }
  
  return allEvents.filter(e => e.title).map(e => ({
    title: e.title,
    venue: e.venue || 'doNYC',
    date: '2026-03-09 to 2026-03-15',
    category: 'General',
    url: e.link || 'https://donyc.com/'
  }));
}

async function scrapeTheSkint() {
  console.log('Scraping The Skint...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://theskint.com/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    const events = await page.evaluate(() => {
      const items = [];
      const eventEls = document.querySelectorAll('.event, .post, article, [class*="event"]');
      eventEls.forEach(el => {
        const title = el.querySelector('h2, h3, .entry-title, [class*="title"]')?.textContent?.trim();
        const dateText = el.querySelector('.date, [class*="date"], time')?.textContent?.trim();
        const link = el.querySelector('a')?.href;
        if (title) {
          items.push({ title, dateText, link });
        }
      });
      return items;
    });
    
    await browser.close();
    return events.filter(e => e.title).slice(0, 30).map(e => ({
      title: e.title,
      venue: 'The Skint',
      date: '2026-03-09 to 2026-03-15',
      category: 'General',
      url: e.link || 'https://theskint.com/'
    }));
  } catch (e) {
    console.log('The Skint error:', e.message);
    await browser.close();
    return [];
  }
}

async function scrapeTimeOut() {
  console.log('Scraping Time Out NY...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://www.timeout.com/newyork/events', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    const events = await page.evaluate(() => {
      const items = [];
      const eventEls = document.querySelectorAll('[data-testid*="event"], .event, [class*="eventCard"]');
      eventEls.forEach(el => {
        const title = el.querySelector('h3, h2, [data-testid*="title"], [class*="title"]')?.textContent?.trim();
        const venue = el.querySelector('[data-testid*="venue"], [class*="venue"]')?.textContent?.trim();
        const link = el.querySelector('a')?.href;
        if (title) {
          items.push({ title, venue, link });
        }
      });
      return items;
    });
    
    await browser.close();
    return events.filter(e => e.title).slice(0, 30).map(e => ({
      title: e.title,
      venue: e.venue || 'Time Out NY',
      date: '2026-03-09 to 2026-03-15',
      category: 'General',
      url: e.link || 'https://www.timeout.com/newyork/events'
    }));
  } catch (e) {
    console.log('Time Out error:', e.message);
    await browser.close();
    return [];
  }
}

async function scrapeSecretNYC() {
  console.log('Scraping Secret NYC...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://secretnyc.co/events/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // Accept cookies
    try {
      const cookieBtn = await page.$('button[class*="cookie"], button[id*="accept"], .accept-cookies');
      if (cookieBtn) await cookieBtn.click();
    } catch (e) {}
    
    const events = await page.evaluate(() => {
      const items = [];
      const eventEls = document.querySelectorAll('.event, article, [class*="event"], .post');
      eventEls.forEach(el => {
        const title = el.querySelector('h2, h3, .title, [class*="title"]')?.textContent?.trim();
        const link = el.querySelector('a')?.href;
        if (title) {
          items.push({ title, link });
        }
      });
      return items;
    });
    
    await browser.close();
    return events.filter(e => e.title).slice(0, 30).map(e => ({
      title: e.title,
      venue: 'Secret NYC',
      date: '2026-03-09 to 2026-03-15',
      category: 'General',
      url: e.link || 'https://secretnyc.co/'
    }));
  } catch (e) {
    console.log('Secret NYC error:', e.message);
    await browser.close();
    return [];
  }
}

async function scrapeBrooklynMagazine() {
  console.log('Scraping Brooklyn Magazine...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://brooklynmagazine.com/events/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    const events = await page.evaluate(() => {
      const items = [];
      const eventEls = document.querySelectorAll('.event, article, [class*="event"]');
      eventEls.forEach(el => {
        const title = el.querySelector('h2, h3, .title, [class*="title"]')?.textContent?.trim();
        const link = el.querySelector('a')?.href;
        if (title) {
          items.push({ title, link });
        }
      });
      return items;
    });
    
    await browser.close();
    return events.filter(e => e.title).slice(0, 30).map(e => ({
      title: e.title,
      venue: 'Brooklyn Magazine',
      date: '2026-03-09 to 2026-03-15',
      category: 'General',
      url: e.link || 'https://brooklynmagazine.com/'
    }));
  } catch (e) {
    console.log('Brooklyn Magazine error:', e.message);
    await browser.close();
    return [];
  }
}

// Retry missing film/museum venues
async function scrapeMetrograph() {
  console.log('Scraping Metrograph...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://metrograph.com/calendar/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(4000);
    
    const events = await page.evaluate(() => {
      const items = [];
      const cards = document.querySelectorAll('.film-card, .movie-card, [class*="film"], [class*="movie"]');
      cards.forEach(el => {
        const title = el.querySelector('h2, h3, h4, .title, .film-title')?.textContent?.trim();
        const director = el.querySelector('.director, [class*="director"]')?.textContent?.trim();
        const link = el.querySelector('a')?.href;
        if (title && title.length > 1) {
          items.push({ title, director, link });
        }
      });
      return items;
    });
    
    await browser.close();
    return events.filter(e => e.title).map(e => ({
      title: e.title + (e.director ? ` - ${e.director}` : ''),
      venue: 'Metrograph',
      date: '2026-03-09 to 2026-03-15',
      category: 'Film',
      url: e.link || 'https://metrograph.com/'
    }));
  } catch (e) {
    console.log('Metrograph error:', e.message);
    await browser.close();
    return [];
  }
}

async function scrapeLincolnCenter() {
  console.log('Scraping Lincoln Center...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://www.lincolncenter.org/calendar', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(4000);
    
    const events = await page.evaluate(() => {
      const items = [];
      const cards = document.querySelectorAll('[data-testid*="event"], .event-card, [class*="event"]');
      cards.forEach(el => {
        const title = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim();
        const venue = el.querySelector('.venue, [class*="venue"]')?.textContent?.trim();
        const link = el.querySelector('a')?.href;
        if (title) {
          items.push({ title, venue, link });
        }
      });
      return items;
    });
    
    await browser.close();
    return events.filter(e => e.title).map(e => ({
      title: e.title,
      venue: e.venue || 'Lincoln Center',
      date: '2026-03-09 to 2026-03-15',
      category: 'Arts',
      url: e.link || 'https://www.lincolncenter.org/'
    }));
  } catch (e) {
    console.log('Lincoln Center error:', e.message);
    await browser.close();
    return [];
  }
}

async function scrapeMoMA() {
  console.log('Scraping MoMA...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://www.moma.org/calendar', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(4000);
    
    const events = await page.evaluate(() => {
      const items = [];
      const cards = document.querySelectorAll('.event-card, [class*="event"], .card');
      cards.forEach(el => {
        const title = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim();
        const link = el.querySelector('a')?.href;
        if (title) {
          items.push({ title, link });
        }
      });
      return items;
    });
    
    await browser.close();
    return events.filter(e => e.title).map(e => ({
      title: e.title,
      venue: 'MoMA',
      date: '2026-03-09 to 2026-03-15',
      category: 'Museum',
      url: e.link || 'https://www.moma.org/'
    }));
  } catch (e) {
    console.log('MoMA error:', e.message);
    await browser.close();
    return [];
  }
}

async function scrapeWhitney() {
  console.log('Scraping Whitney...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://whitney.org/exhibitions', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(4000);
    
    const events = await page.evaluate(() => {
      const items = [];
      const cards = document.querySelectorAll('.exhibition-card, [class*="exhibition"], .card');
      cards.forEach(el => {
        const title = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim();
        const link = el.querySelector('a')?.href;
        if (title) {
          items.push({ title, link });
        }
      });
      return items;
    });
    
    await browser.close();
    return events.filter(e => e.title).map(e => ({
      title: e.title,
      venue: 'Whitney Museum',
      date: '2026-03-09 to 2026-03-15',
      category: 'Museum',
      url: e.link || 'https://whitney.org/'
    }));
  } catch (e) {
    console.log('Whitney error:', e.message);
    await browser.close();
    return [];
  }
}

async function main() {
  // General events
  const generalEvents = [
    ...await scrapeDoNYC(),
    ...await scrapeTheSkint(),
    ...await scrapeTimeOut(),
    ...await scrapeSecretNYC(),
    ...await scrapeBrooklynMagazine(),
  ];
  
  fs.writeFileSync('/root/Nextweeknyc/public/data/events.json', JSON.stringify(generalEvents, null, 2));
  console.log(`Saved ${generalEvents.length} general events`);
  
  // Retry missing film/museum venues
  const additionalFilmMuseum = [
    ...await scrapeMetrograph(),
    ...await scrapeLincolnCenter(),
    ...await scrapeMoMA(),
    ...await scrapeWhitney(),
  ];
  
  // Read existing film_museum_events and append
  const existing = JSON.parse(fs.readFileSync('/root/Nextweeknyc/public/data/film_museum_events.json', 'utf8'));
  const combined = [...existing, ...additionalFilmMuseum];
  fs.writeFileSync('/root/Nextweeknyc/public/data/film_museum_events.json', JSON.stringify(combined, null, 2));
  console.log(`Added ${additionalFilmMuseum.length} more film/museum events (total: ${combined.length})`);
}

main().catch(console.error);
