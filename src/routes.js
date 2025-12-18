// Reddit Community Scraper - Router configuration
// This file contains routing logic for the scraper
// Note: This file is currently not used in main.js which uses CheerioCrawler instead

import { createPuppeteerRouter, Dataset } from 'crawlee';

export const router = createPuppeteerRouter();

router.addDefaultHandler(async ({ enqueueLinks, log }) => {
    log.info(`enqueueing new URLs`);
    await enqueueLinks({
        globs: ['https://reddit.com/*'],
        label: 'detail',
    });
});

router.addHandler('detail', async ({ request, page, log }) => {
    const title = await page.title();
    log.info(`${title}`, { url: request.loadedUrl });

    await Dataset.pushData({
        url: request.loadedUrl,
        title,
    });
});