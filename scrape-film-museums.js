const { chromium } = require('playwright');
const fs = require('fs');

const TARGET_WEEK_START = new Date('2026-03-09');
const TARGET_WEEK_END = new Date('2026-03-15');

function isInTargetWeek(dateStr) {
  const date = new Date(dateStr);
  return date >= TARGET_WEEK_START && date <= TARGET_WEEK_END;
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

async function scrapeMetrograph() {
  console.log('Scraping Metrograph...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    await page.goto('https://metrograph.com/events/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    const events = await page.evaluate(() => {
      const items = [];
      const eventEls = document.querySelectorAll('.event-card, .event-item, [class*="event"]');
      eventEls.forEach(el => {
        const title = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim();
        const dateText = el.querySelector('.date, [class*="date"], time')?.textContent?.trim();
        const link = el.querySelector('a')?.href;
        if (title) {
          items.push({ title, dateText, link });
        }
      });
      return items;
    });
    
    await browser.close();
    return events.filter(e => e.title).map(e => ({
      title: e.title,
      venue: 'Metrograph',
      date: '2026-03-09 to 2026-03-15',
      category: 'Film',
      url: e.link || 'https://metrograph.com/events/'
    }));
  } catch (e) {
    console.log('Metrograph error:', e.message);
    await browser.close();
    return [];
  }
}

async function scrapeFilmForum() {
  console.log('Scraping Film Forum...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://filmforum.org/now-playing', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    const events = await page.evaluate(() => {
      const items = [];
      const films = document.querySelectorAll('.film, .movie, [class*="film"], [class*="movie"]');
      films.forEach(el => {
        const title = el.querySelector('h2, h3, .title, [class*="title"]')?.textContent?.trim();
        const director = el.querySelector('.director, [class*="director"]')?.textContent?.trim();
        const link = el.querySelector('a')?.href;
        if (title) {
          items.push({ title, director, link });
        }
      });
      return items;
    });
    
    await browser.close();
    return events.filter(e => e.title).map(e => ({
      title: e.title + (e.director ? ` - ${e.director}` : ''),
      venue: 'Film Forum',
      date: '2026-03-09 to 2026-03-15',
      category: 'Film',
      url: e.link || 'https://filmforum.org/now-playing'
    }));
  } catch (e) {
    console.log('Film Forum error:', e.message);
    await browser.close();
    return [];
  }
}

async function scrapeIFCCenter() {
  console.log('Scraping IFC Center...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://ifccenter.com/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    const events = await page.evaluate(() => {
      const items = [];
      const films = document.querySelectorAll('.movie, .film, [class*="movie"], h2, h3');
      films.forEach(el => {
        const title = el.textContent?.trim();
        const link = el.closest('a')?.href || el.querySelector('a')?.href;
        if (title && title.length > 2 && title.length < 100) {
          items.push({ title, link });
        }
      });
      return items;
    });
    
    await browser.close();
    return events.filter(e => e.title).slice(0, 20).map(e => ({
      title: e.title,
      venue: 'IFC Center',
      date: '2026-03-09 to 2026-03-15',
      category: 'Film',
      url: e.link || 'https://ifccenter.com/'
    }));
  } catch (e) {
    console.log('IFC Center error:', e.message);
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
    await page.waitForTimeout(3000);
    
    const events = await page.evaluate(() => {
      const items = [];
      const eventEls = document.querySelectorAll('.event, [class*="event"], .card');
      eventEls.forEach(el => {
        const title = el.querySelector('h2, h3, .title, [class*="title"]')?.textContent?.trim();
        const dateText = el.querySelector('.date, [class*="date"], time')?.textContent?.trim();
        const link = el.querySelector('a')?.href;
        if (title) {
          items.push({ title, dateText, link });
        }
      });
      return items;
    });
    
    await browser.close();
    return events.filter(e => e.title).map(e => ({
      title: e.title,
      venue: 'Lincoln Center',
      date: '2026-03-09 to 2026-03-15',
      category: 'Arts',
      url: e.link || 'https://www.lincolncenter.org/calendar'
    }));
  } catch (e) {
    console.log('Lincoln Center error:', e.message);
    await browser.close();
    return [];
  }
}

async function scrapeTheMet() {
  console.log('Scraping The Met...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://www.metmuseum.org/exhibitions', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    const events = await page.evaluate(() => {
      const items = [];
      const exhibits = document.querySelectorAll('.exhibition, [class*="exhibition"], .card, .tile');
      exhibits.forEach(el => {
        const title = el.querySelector('h2, h3, h4, .title, [class*="title"]')?.textContent?.trim();
        const dateText = el.querySelector('.date, [class*="date"]')?.textContent?.trim();
        const link = el.querySelector('a')?.href;
        if (title) {
          items.push({ title, dateText, link });
        }
      });
      return items;
    });
    
    await browser.close();
    return events.filter(e => e.title).map(e => ({
      title: e.title,
      venue: 'The Met',
      date: '2026-03-09 to 2026-03-15',
      category: 'Museum',
      url: e.link || 'https://www.metmuseum.org/exhibitions'
    }));
  } catch (e) {
    console.log('The Met error:', e.message);
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
    await page.waitForTimeout(3000);
    
    const events = await page.evaluate(() => {
      const items = [];
      const eventEls = document.querySelectorAll('.event, [class*="event"], .card');
      eventEls.forEach(el => {
        const title = el.querySelector('h2, h3, .title, [class*="title"]')?.textContent?.trim();
        const dateText = el.querySelector('.date, [class*="date"], time')?.textContent?.trim();
        const link = el.querySelector('a')?.href;
        if (title) {
          items.push({ title, dateText, link });
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
      url: e.link || 'https://www.moma.org/calendar'
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
    await page.goto('https://whitney.org/ exhibitions', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    const events = await page.evaluate(() => {
      const items = [];
      const exhibits = document.querySelectorAll('.exhibition, [class*="exhibition"], .card');
      exhibits.forEach(el => {
        const title = el.querySelector('h2, h3, .title, [class*="title"]')?.textContent?.trim();
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

async function scrapeGuggenheim() {
  console.log('Scraping Guggenheim...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://www.guggenheim.org/exhibitions', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // Accept cookies if present
    try {
      const cookieBtn = await page.$('[class*="cookie"], [id*="cookie"], .accept, #accept');
      if (cookieBtn) await cookieBtn.click();
    } catch (e) {}
    
    const events = await page.evaluate(() => {
      const items = [];
      const exhibits = document.querySelectorAll('.exhibition, [class*="exhibition"], .card, .tile');
      exhibits.forEach(el => {
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
      venue: 'Guggenheim',
      date: '2026-03-09 to 2026-03-15',
      category: 'Museum',
      url: e.link || 'https://www.guggenheim.org/exhibitions'
    }));
  } catch (e) {
    console.log('Guggenheim error:', e.message);
    await browser.close();
    return [];
  }
}

async function main() {
  const allEvents = [];
  
  const filmArtsEvents = [
    ...await scrapeMetrograph(),
    ...await scrapeFilmForum(),
    ...await scrapeIFCCenter(),
    ...await scrapeLincolnCenter(),
  ];
  
  const museumEvents = [
    ...await scrapeTheMet(),
    ...await scrapeMoMA(),
    ...await scrapeWhitney(),
    ...await scrapeGuggenheim(),
  ];
  
  const filmMuseumEvents = [...filmArtsEvents, ...museumEvents];
  
  fs.writeFileSync('/root/Nextweeknyc/public/data/film_museum_events.json', JSON.stringify(filmMuseumEvents, null, 2));
  console.log(`Saved ${filmMuseumEvents.length} film/museum events`);
}

main().catch(console.error);
