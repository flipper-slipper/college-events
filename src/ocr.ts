import { Env } from "./index";

export async function processNewPosts(env: Env) {
    const { results } = await env.DB.prepare(
        "SELECT * FROM posts WHERE processed = 0"
    ).all();

    for (const post of results as any[]) {
        try {
            console.log(`[OCR] Processing post ${post.id}...`);
            // 1. Fetch the image
            const imageResponse = await fetch(post.image_url);
            if (!imageResponse.ok) {
                console.error(`[OCR] Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
                continue;
            }
            const imageData = await imageResponse.arrayBuffer();
            console.log(`[OCR] Image downloaded (${imageData.byteLength} bytes)`);

            // 2. Perform OCR / Extraction
            console.log("[OCR] Sending to Cloudflare AI model (@cf/llava-hf/llava-1.5-7b-hf)...");
            const prompt = `Analyze this image and its caption to extract event details.
Instagram Caption: "${post.caption}"

Identify all events mentioned. For each event, extract the title, date, time, and a descriptive 'about' section. Use both the text in the image AND the caption for extra details or context. 
Return ONLY a JSON array of objects with keys: title, date, time, about. If no events are found, return [].`;

            const aiResponse: any = await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", {
                image: [...new Uint8Array(imageData)],
                prompt: prompt,
            });

            console.log("[OCR] Raw AI Object:", JSON.stringify(aiResponse));

            const responseText = aiResponse?.description || aiResponse?.text || aiResponse?.result || "";
            console.log(`[OCR] Extracted Text: "${responseText}"`);
            
            const eventsData = parseAIResponse(responseText);
            console.log("[OCR] Parsed JSON:", JSON.stringify(eventsData));

            if (eventsData.length === 0) {
                console.log(`[OCR] No events found in post ${post.id}`);
            } else {
                for (const eventData of eventsData) {
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
                console.log(`[OCR] Saved ${eventsData.length} events for post ${post.id}`);
            }

            // 4. Mark post as processed
            await env.DB.prepare("UPDATE posts SET processed = 1 WHERE id = ?").bind(post.id).run();

        } catch (error) {
            console.error(`Error processing post ${post.id}:`, error);
        }
    }
}

function parseAIResponse(text: string): any[] {
    if (!text) return [];
    
    // Clean up markdown code blocks if the AI includes them
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
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
        console.error("Failed to parse AI JSON:", e, "Original text:", text);
    }
    return [];
}
