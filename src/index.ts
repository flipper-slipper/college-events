import { scrapeInstagramPosts } from "./scraper";
import { processNewPosts } from "./ocr";

export interface Env {
	DB: D1Database;
	AI: Ai;
}

export default {
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		console.log("Running scheduled task...");
		ctx.waitUntil(scrapeInstagramPosts(env).then(() => processNewPosts(env)));
	},

	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/api/events") {
			const { results } = await env.DB.prepare("SELECT * FROM events ORDER BY event_date DESC").all();
			return Response.json(results);
		}

		return new Response(`
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>College Events</title>
				<style>
					body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
					.event { border: 1px solid #ccc; padding: 15px; margin-bottom: 20px; border-radius: 8px; }
					.date { color: #666; font-size: 0.9em; }
				</style>
			</head>
			<body>
				<h1>Upcoming College Events</h1>
				<div id="events-list">Loading events...</div>

				<script>
					fetch('/api/events')
						.then(res => res.json())
						.then(events => {
							const list = document.getElementById('events-list');
							list.innerHTML = '';
							if (events.length === 0) {
								list.innerHTML = '<p>No events found.</p>';
								return;
							}
							events.forEach(event => {
								const div = document.createElement('div');
								div.className = 'event';
								div.innerHTML = \`
									<h2>\${event.title}</h2>
									<p class="date">\${event.event_date} at \${event.event_time}</p>
									<p>\${event.description}</p>
								\`;
								list.appendChild(div);
							});
						});
				</script>
			</body>
			</html>
		`, {
			headers: { "Content-Type": "text/html" }
		});
	},
};
