#!/usr/bin/env node
/**
 * Test the rewritten Eventbrite scraper using the actual scraper code.
 * Usage: node scripts/test-eventbrite.js
 */

const { chromium } = require('playwright');

const PAGES = [
  'https://www.eventbrite.com/d/ny--new-york/events--this-week/',
  'https://www.eventbrite.com/d/ny--new-york/arts--events--this-week/',
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const seenTitles = new Set();
  let total = 0;
  let withDate = 0, withVenue = 0, withPrice = 0;

  for (const url of PAGES) {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    try {
      console.error(`Loading: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
      for (let i = 0; i < 8; i++) {
        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(1500);
      }

      const items = await page.evaluate(() => {
        const r = [];
        const now = new Date();
        const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
        const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

        const containers = document.querySelectorAll('[class*="map_experiment_event_card"]');
        const seen = new Set();

        containers.forEach(container => {
          const link = container.querySelector('a.event-card-link');
          if (!link) return;
          const href = link.href;
          if (seen.has(href)) return;
          seen.add(href);

          const h3 = container.querySelector('h3');
          if (!h3) return;
          const title = h3.textContent?.trim();
          if (!title || title.length < 5 || title.length > 150) return;

          const ps = Array.from(container.querySelectorAll('p')).map(p => p.textContent?.trim() || '');
          let dateText = '', timeText = '', venue = '', price = '';

          for (const pText of ps) {
            if (pText.includes('\u2022') && !dateText) {
              const parts = pText.split('\u2022');
              const dayPart = parts[0].trim();
              const timePart = (parts[1] || '').trim();
              if (timePart) timeText = timePart;
              const dayLower = dayPart.toLowerCase();
              if (dayLower === 'today') { dateText = fmt(now); }
              else if (dayLower === 'tomorrow') { const tom = new Date(now); tom.setDate(tom.getDate() + 1); dateText = fmt(tom); }
              else {
                const fullMatch = dayPart.match(/(\w{3}),?\s+(\w{3})\s+(\d{1,2})/);
                if (fullMatch) {
                  const monthIdx = MONTHS.indexOf(fullMatch[2].toLowerCase().slice(0, 3));
                  if (monthIdx >= 0) { dateText = `${now.getFullYear()}-${String(monthIdx + 1).padStart(2, '0')}-${String(parseInt(fullMatch[3], 10)).padStart(2, '0')}`; }
                } else {
                  const dayIdx = DAYS.indexOf(dayLower);
                  if (dayIdx >= 0) { let diff = dayIdx - now.getDay(); if (diff <= 0) diff += 7; const target = new Date(now); target.setDate(target.getDate() + diff); dateText = fmt(target); }
                }
              }
            }
            if (pText.includes('\u00B7') && !venue) { venue = (pText.split('\u00B7')[1] || '').trim(); }
            if (/^\$|^From \$/i.test(pText) && !price) { price = pText; }
          }
          r.push({ title, date: dateText, time: timeText, venue, price, href });
        });
        return r;
      });

      let newCount = 0;
      for (const item of items) {
        const key = item.title.toLowerCase().trim();
        if (seenTitles.has(key)) continue;
        seenTitles.add(key);
        newCount++;
        total++;
        if (item.date) withDate++;
        if (item.venue) withVenue++;
        if (item.price) withPrice++;
        console.log(`${total}. ${item.title}`);
        console.log(`   Date: ${item.date || '(none)'} | Time: ${item.time || '(none)'} | Venue: ${item.venue || '(none)'} | Price: ${item.price || '(none)'}`);
      }
      console.error(`  → ${items.length} cards, ${newCount} new unique`);
    } catch (e) {
      console.error(`  Error: ${e.message}`);
    } finally {
      await page.close();
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total unique: ${total}`);
  console.log(`With date: ${withDate} (${Math.round(withDate/total*100)}%)`);
  console.log(`With venue: ${withVenue} (${Math.round(withVenue/total*100)}%)`);
  console.log(`With price: ${withPrice} (${Math.round(withPrice/total*100)}%)`);

  await browser.close();
})();
