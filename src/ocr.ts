import { Env } from "./index";

export async function processNewPosts(env: Env) {
    const { results } = await env.DB.prepare(
        "SELECT * FROM posts WHERE processed = FALSE"
    ).all();

    for (const post of results as any[]) {
        try {
            // 1. Fetch the image
            const imageResponse = await fetch(post.image_url);
            if (!imageResponse.ok) continue;
            const imageData = await imageResponse.arrayBuffer();

            // 2. Perform OCR / Extraction using AI Workers
            // Note: Cloudflare AI Vision models vary. 
            // Here we use a hypothetical model that can extract text.
            // Documentation: https://developers.cloudflare.com/workers-ai/models/
            
            const aiResponse: any = await env.AI.run("@cf/minicpm-v-2_6-awq", {
                image: [...new Uint8Array(imageData)],
                prompt: "Extract the event date, time, and description from this image. Format as JSON with keys: date, time, about.",
            });

            // 3. Store the result in events table
            // In a real scenario, you'd parse aiResponse.text and extract JSON
            const extractedData = parseAIResponse(aiResponse.description);

            await env.DB.prepare(
                "INSERT INTO events (post_id, title, description, event_date, event_time) VALUES (?, ?, ?, ?, ?)"
            ).bind(
                post.id,
                extractedData.title || "Untitled Event",
                extractedData.about || post.caption,
                extractedData.date || null,
                extractedData.time || null
            ).run();

            // 4. Mark post as processed
            await env.DB.prepare("UPDATE posts SET processed = TRUE WHERE id = ?").bind(post.id).run();

        } catch (error) {
            console.error(`Error processing post ${post.id}:`, error);
        }
    }
}

function parseAIResponse(text: string) {
    // Simple parser or regex to extract info from AI response
    // For now, returning a mock object
    try {
        const jsonMatch = text.match(/\{.*\}/s);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
    } catch (e) {}
    return { title: "Extracted Event", about: text, date: "", time: "" };
}
