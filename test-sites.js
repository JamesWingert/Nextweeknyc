const { chromium } = require('playwright');

const sites = [
  { name: 'Metrograph', url: 'https://metrograph.com/calendar', type: 'film' },
  { name: 'IFC Center', url: 'https://www.ifccenter.com', type: 'film' },
  { name: 'Film Forum', url: 'https://filmforum.org/events', type: 'film' },
  { name: 'Angelika', url: 'https://angelikafilmcenter.com', type: 'film' },
  { name: 'BAM', url: 'https://bam.org', type: 'film' },
  { name: 'Lincoln Center', url: 'https://www.lincolncenter.org', type: 'arts' },
  { name: 'The Met', url: 'https://www.metmuseum.org/exhibitions', type: 'museum' },
  { name: 'MoMA', url: 'https://www.moma.org/calendar', type: 'museum' },
];

async function testSite(site) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(site.url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Wait for content
    await page.waitForTimeout(3000);
    
    // Check if we got real content
    const title = await page.title().catch(() => 'No title');
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    const hasEvents = bodyText.toLowerCase().includes('film') || 
                      bodyText.toLowerCase().includes('screening') ||
                      bodyText.toLowerCase().includes('exhibition') ||
                      bodyText.toLowerCase().includes('event');
    
    await browser.close();
    
    return {
      name: site.name,
      url: site.url,
      title: title.substring(0, 50),
      hasContent: hasEvents,
      preview: bodyText.substring(0, 100).replace(/\n/g, ' ')
    };
  } catch (error) {
    await browser.close();
    return {
      name: site.name,
      url: site.url,
      error: error.message.substring(0, 100)
    };
  }
}

async function runTests() {
  console.log('Testing film/arts sites with Playwright...\n');
  
  for (const site of sites) {
    const result = await testSite(site);
    console.log('---');
    console.log(`Site: ${result.name}`);
    console.log(`URL: ${result.url}`);
    if (result.error) {
      console.log(`Status: ❌ Error - ${result.error}`);
    } else {
      console.log(`Status: ${result.hasContent ? '✅ Has content' : '⚠️ Limited content'}`);
      console.log(`Title: ${result.title}`);
      console.log(`Preview: ${result.preview}...`);
    }
    console.log('');
  }
}

runTests();
