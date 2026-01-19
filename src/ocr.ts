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
            const aiResponse: any = await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", {
                image: [...new Uint8Array(imageData)],
                prompt: "Identify the event title, date, time, and a short description from this image. Return ONLY a JSON object with keys: title, date, time, about. If it's not an event, return { \"about\": \"Not an event\" }",
            });

            console.log("[OCR] Raw AI Object:", JSON.stringify(aiResponse));

            const responseText = aiResponse?.description || aiResponse?.text || aiResponse?.result || "";
            console.log(`[OCR] Extracted Text: "${responseText}"`);
            
            const extractedData = parseAIResponse(responseText);
            console.log("[OCR] Parsed JSON:", JSON.stringify(extractedData));

            if (extractedData.about === 'Not an event') {
                await env.DB.prepare("UPDATE posts SET processed = TRUE WHERE id = ?").bind(post.id).run();
                continue;
            }

            await env.DB.prepare(
                "INSERT INTO events (post_id, title, description, event_date, event_time, post_url) VALUES (?, ?, ?, ?, ?, ?)"
            ).bind(
                post.id,
                extractedData.title || "Untitled Event",
                extractedData.about || post.caption,
                extractedData.date || null,
                extractedData.time || null,
                post.post_url
            ).run();

            // 4. Mark post as processed
            await env.DB.prepare("UPDATE posts SET processed = TRUE WHERE id = ?").bind(post.id).run();

        } catch (error) {
            console.error(`Error processing post ${post.id}:`, error);
        }
    }
}

function parseAIResponse(text: string) {
    if (!text) return { title: "Extracted Event", about: "No text returned from AI", date: "", time: "" };
    
    // Clean up markdown code blocks if the AI includes them
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
    try {
        const jsonMatch = cleaned.match(/\{.*\}/s);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
    } catch (e) {
        console.error("Failed to parse AI JSON:", e, "Original text:", text);
    }
    return { title: "Extracted Event", about: text, date: "", time: "" };
}
