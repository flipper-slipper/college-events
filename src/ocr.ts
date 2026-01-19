import { Env } from "./index";

export async function processNewPosts(env: Env) {
    console.log("[OCR] Checking for new unprocessed posts...");
    const { results } = await env.DB.prepare(
        "SELECT * FROM posts WHERE processed = 0"
    ).all();

    if (!results || results.length === 0) {
        console.log("[OCR] No new posts to process.");
        return;
    }

    console.log(`[OCR] Found ${results.length} posts to process.`);

    for (const post of results as any[]) {
        try {
            console.log(`[OCR] Processing post ${post.id}...`);

            // 1. Immediately mark as processed to prevent concurrent runs
            await env.DB.prepare("UPDATE posts SET processed = 1 WHERE id = ?").bind(post.id).run();

            // 2. Fetch the image
            const imageResponse = await fetch(post.image_url);
            if (!imageResponse.ok) {
                console.error(`[OCR] Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
                continue;
            }
            const imageData = await imageResponse.arrayBuffer();
            console.log(`[OCR] Image downloaded (${imageData.byteLength} bytes)`);

            // 2. Perform OCR / Extraction
            console.log("[OCR] Sending to Cloudflare AI model (@cf/llava-hf/llava-1.5-7b-hf)...");
            const prompt = `Analyze this image and its caption for events.
Caption: "${post.caption}"

Extract ALL unique events. For each, give: title, date, time, about.
BE CONCISE. Do not repeat events. 
Return ONLY a valid JSON array of objects. Example: [{"title": "...", "date": "...", "time": "...", "about": "..."}]`;

            const aiResponse: any = await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", {
                image: [...new Uint8Array(imageData)],
                prompt: prompt,
            });

            console.log("[OCR] Raw AI Object:", JSON.stringify(aiResponse));

            const responseText = aiResponse?.description || aiResponse?.text || aiResponse?.result || "";
            console.log(`[OCR] Extracted Text: "${responseText}"`);
            
            const eventsData = parseAIResponse(responseText);
            console.log("[OCR] Parsed JSON:", JSON.stringify(eventsData));

            // Sanity Check: De-duplicate events from the SAME post that have the same time slot
            const uniqueEvents: any[] = [];
            const seenSlots = new Set<string>();

            for (const event of eventsData) {
                const date = (event.date || "").trim();
                const time = (event.time || "").trim();
                const slotKey = `${date}|${time}`;

                if (seenSlots.has(slotKey) && date !== "" && time !== "") {
                    console.log(`[OCR] Skipping duplicate event slot in same post: ${slotKey}`);
                    // Optionally update the existing event if this one has a better description, 
                    // but for now, we just take the first one found.
                    continue;
                }
                seenSlots.add(slotKey);
                uniqueEvents.push(event);
            }

            // Clean up any existing events for this post_id before inserting new ones
            await env.DB.prepare("DELETE FROM events WHERE post_id = ?").bind(post.id).run();

            if (uniqueEvents.length === 0) {
                console.log(`[OCR] No unique events found in post ${post.id}`);
            } else {
                for (const eventData of uniqueEvents) {
                    // Final safety: check if an event with this title & date already exists from ANY post 
                    // to prevent duplicates across different posts (e.g. a reminder post)
                    const existing = await env.DB.prepare(
                        "SELECT id FROM events WHERE title = ? AND event_date = ?"
                    ).bind(eventData.title, eventData.date).first();

                    if (existing) {
                        console.log(`[OCR] Skipping duplicate event from different post: ${eventData.title} on ${eventData.date}`);
                        continue;
                    }

                    await env.DB.prepare(
                        "INSERT INTO events (post_id, title, description, event_date, event_time, post_url) VALUES (?, ?, ?, ?, ?, ?)"
                    ).bind(
                        post.id,
                        eventData.title || "Untitled Event",
                        eventData.about || post.caption,
                        eventData.date || null,
                        eventData.time || null,
                        post.post_url
                    ).run();
                }
                console.log(`[OCR] Saved ${uniqueEvents.length} events for post ${post.id}`);
            }

        } catch (error) {
            console.error(`Error processing post ${post.id}:`, error);
            // On error, we might want to unmark it as processed so it can be retried
            await env.DB.prepare("UPDATE posts SET processed = 0 WHERE id = ?").bind(post.id).run();
        }
    }
}

function parseAIResponse(text: string): any[] {
    if (!text) return [];
    
    // Clean up markdown code blocks if the AI includes them
    let cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
    // HEURISTIC: If the JSON is truncated (common with LLMs), try to close it
    if (cleaned.startsWith('[') && !cleaned.endsWith(']')) {
        // Try to find the last complete object
        const lastCurly = cleaned.lastIndexOf('}');
        if (lastCurly !== -1) {
            cleaned = cleaned.substring(0, lastCurly + 1) + ']';
        } else {
            cleaned = cleaned + ']';
        }
    }

    try {
        // Find everything between [ ] or { }
        const arrayMatch = cleaned.match(/\[.*\]/s);
        if (arrayMatch) {
            return JSON.parse(arrayMatch[0]);
        }
        
        const objectMatch = cleaned.match(/\{.*\}/s);
        if (objectMatch) {
            const obj = JSON.parse(objectMatch[0]);
            return (obj.about === "Not an event" || obj.title === "Not an event") ? [] : [obj];
        }
    } catch (e) {
        console.error("Failed to parse AI JSON:", e, "Cleaned text:", cleaned);
    }
    return [];
}
