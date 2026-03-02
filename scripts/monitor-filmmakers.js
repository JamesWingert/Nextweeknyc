#!/usr/bin/env node
/**
 * Monitor Ethan Hawke & Park Chan-wook NYC Events
 * Checks daily for appearances, Q&As, screenings in NYC
 */

const { chromium } = require('playwright');

const TARGETS = ['Ethan Hawke', 'Park Chan-wook'];

async function checkVenue(page, venue, url, checkFn) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(5000);
    
    const content = await page.evaluate(() => document.body.innerText);
    const found = [];
    
    TARGETS.forEach(name => {
      if (content.includes(name)) {
        // Extract surrounding context
        const index = content.indexOf(name);
        const context = content.substring(Math.max(0, index - 100), index + 100);
        found.push({ name, context, venue, url });
      }
    });
    
    return found;
  } catch (e) {
    console.error(`${venue} error:`, e.message);
    return [];
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const allFindings = [];
  
  // Check Film Forum
  const filmForum = await checkVenue(page, 'Film Forum', 'https://filmforum.org/now-playing');
  allFindings.push(...filmForum);
  
  // Check Metrograph
  const metrograph = await checkVenue(page, 'Metrograph', 'https://metrograph.com');
  allFindings.push(...metrograph);
  
  // Check Lincoln Center
  const lincolnCenter = await checkVenue(page, 'Lincoln Center', 'https://www.lincolncenter.org/lincoln-center-at-home/calendar');
  allFindings.push(...lincolnCenter);
  
  await browser.close();
  
  if (allFindings.length > 0) {
    console.log('FOUND EVENTS:');
    allFindings.forEach(f => {
      console.log(`\n${f.name} at ${f.venue}`);
      console.log(`Context: ${f.context}`);
      console.log(`URL: ${f.url}`);
    });
    
    // Send notification (if Telegram configured)
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_USER_ID) {
      // Notification logic here
      console.log('Would send Telegram notification');
    }
  } else {
    console.log('No events found for Ethan Hawke or Park Chan-wook today.');
  }
})();
