import { Env } from "./index";

export async function scrapeInstagramPosts(env: Env) {
    const taskId = "conscious_veil~instagram-scraper-task";
    const url = `https://api.apify.com/v2/actor-tasks/${taskId}/run-sync-get-dataset-items?token=${env.APIFY_TOKEN}`;

    try {
        console.log("Triggering Apify task...");
        const response = await fetch(url, { method: "POST" });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Apify error (${response.status}): ${errorText}`);
        }

        const items = await response.json() as any[];
        console.log(`Successfully fetched ${items.length} items from Apify.`);

        for (const item of items) {
            const id = item.id || item.shortCode || (item.url ? item.url.split('/').filter(Boolean).pop() : crypto.randomUUID());
            const imageUrl = item.displayUrl || (item.images && item.images[0]);
            const caption = item.caption || "";
            const postUrl = item.url;
            const timestamp = item.timestamp;

            if (!id || !imageUrl) continue;

            await env.DB.prepare(
                "INSERT OR IGNORE INTO posts (id, image_url, caption, post_url, timestamp, processed) VALUES (?, ?, ?, ?, ?, 0)"
            ).bind(id, imageUrl, caption, postUrl, timestamp).run();
        }
    } catch (error) {
        console.error("Scraping failed:", error);
    }
}
