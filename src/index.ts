import { scrapeInstagramPosts } from "./scraper";
import { processNewPosts } from "./ocr";

export interface Env {
	DB: D1Database;
	AI: Ai;
	APIFY_TOKEN: string;
}

export default {
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		console.log("Running scheduled task...");
		ctx.waitUntil(scrapeInstagramPosts(env).then(() => processNewPosts(env)));
	},

	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/run-process") {
			await scrapeInstagramPosts(env);
			await processNewPosts(env);
			return new Response("Success! Scrape and AI OCR complete.", { status: 200 });
		}

		if (url.pathname === "/reset") {
			await env.DB.prepare("UPDATE posts SET processed = 0").run();
			await env.DB.prepare("DELETE FROM events").run();
			return new Response("Database reset. You can now run the process again.", { status: 200 });
		}

		if (url.pathname === "/") {
			const { results: events } = await env.DB.prepare("SELECT * FROM events ORDER BY created_at DESC").all();
			const { results: status } = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM posts) as total_posts, (SELECT COUNT(*) FROM posts WHERE processed = 0) as pending").all();
			const stats = (status[0] || { total_posts: 0, pending: 0 }) as { total_posts: number, pending: number };

			return new Response(`
				<!DOCTYPE html>
				<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<title>College Events</title>
					<style>
						body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f9f9f9; }
						.stats { background: #eee; padding: 10px; border-radius: 4px; margin-bottom: 20px; font-size: 0.9em; }
						.event { background: white; border: 1px solid #ddd; padding: 15px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
						.date { color: #007bff; font-weight: bold; }
						.btn { padding: 10px 20px; background: #007bff; color: white; border: none; cursor: pointer; border-radius: 4px; font-weight: bold; }
						.btn:disabled { background: #ccc; }
					</style>
				</head>
				<body>
					<h1>College Events</h1>
					
					<div class="stats">
						<b>Database Status:</b> ${stats.total_posts} Scraped Posts | ${stats.pending} Waiting for AI OCR
					</div>

					<button id="refreshBtn" onclick="runProcess()" class="btn">🔄 Refresh/Scrape Now</button>
					<p id="statusMsg"></p>

					<div id="events-list">
						${events.length === 0 ? '<p>No events extracted yet.</p>' : ''}
						${events.map((e: any) => `
							<div class="event">
								<h2>${e.title || 'Extracted Event'}</h2>
								<p class="date">📅 ${e.event_date || 'TBD'} at ${e.event_time || 'TBD'}</p>
								<p>${e.description || 'No description extracted.'}</p>
								<a href="${e.post_url}" target="_blank">View Original Post</a>
							</div>
						`).join('')}
					</div>

					<script>
						async function runProcess() {
							const btn = document.getElementById('refreshBtn');
							const msg = document.getElementById('statusMsg');
							btn.disabled = true;
							msg.innerText = 'Scraping and running AI... This may time out in the browser but will continue in the background. Refresh in 1-2 minutes.';
							
							try {
								await fetch('/run-process');
								location.reload();
							} catch (e) {
								console.error(e);
								// Errors are likely timeouts, but the worker usually finishes the CPU work
								msg.innerText = 'The request is taking a while. Please wait a minute and refresh manually.';
							}
						}
					</script>
				</body>
				</html>
			`, {
				headers: { "Content-Type": "text/html" }
			});
		}

		if (url.pathname === "/api/events") {
			const { results } = await env.DB.prepare("SELECT * FROM events ORDER BY event_date DESC").all();
			return Response.json(results);
		}

		return new Response("Not Found", { status: 404 });
	},
};
