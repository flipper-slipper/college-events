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

        // 1. Mark all current posts as "not live" temporarily
        await env.DB.prepare("UPDATE posts SET is_live = 0").run();

        for (const item of items) {
            const id = item.id || item.shortCode || (item.url ? item.url.split('/').filter(Boolean).pop() : crypto.randomUUID());
            const imageUrl = item.displayUrl || (item.images && item.images[0]);
            const caption = item.caption || "";
            const postUrl = item.url;
            const timestamp = item.timestamp;

            if (!id || !imageUrl) continue;

            // 2. Insert or Update (marks them back as live if they still exist)
            await env.DB.prepare(`
                INSERT INTO posts (id, image_url, caption, post_url, timestamp, is_live) 
                VALUES (?, ?, ?, ?, ?, 1)
                ON CONFLICT(id) DO UPDATE SET is_live = 1
            `).bind(id, imageUrl, caption, postUrl, timestamp).run();
        }

        // 3. (Optional) Cleanup: logic to handle posts that are no longer live
        // In your case, you might want to delete events linked to posts that vanished
        await env.DB.prepare("DELETE FROM events WHERE post_id IN (SELECT id FROM posts WHERE is_live = 0)").run();
        await env.DB.prepare("DELETE FROM posts WHERE is_live = 0").run();
    } catch (error) {
        console.error("Scraping failed:", error);
    }
}
