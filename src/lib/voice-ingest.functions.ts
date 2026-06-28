import { createServerFn } from "@tanstack/react-start";

type IngestInput = {
  filename: string;
  mimeType: string;
  // base64-encoded file contents (no data: prefix)
  base64: string;
};

/**
 * Accepts an image or PDF, runs it through Lovable AI Gateway (Gemini Flash)
 * to extract text + a concise summary. Returns plain text the voice agent can
 * use as contextual knowledge.
 */
export const ingestForVoiceAgent = createServerFn({ method: "POST" })
  .inputValidator((input: IngestInput) => {
    if (!input?.base64) throw new Error("base64 required");
    if (!input?.mimeType) throw new Error("mimeType required");
    return input;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const isImage = data.mimeType.startsWith("image/");
    const isPdf = data.mimeType === "application/pdf";
    if (!isImage && !isPdf) {
      throw new Error(`Unsupported type ${data.mimeType}. Use image/* or PDF.`);
    }

    const userContent: any[] = [
      {
        type: "text",
        text:
          "You are helping a billing voice assistant ingest a user-uploaded " +
          (isImage ? "screenshot/image" : "document") +
          `. Filename: ${data.filename}.\n\n` +
          "Return a thorough, structured plain-text summary that captures:\n" +
          "- Document/screen type and apparent purpose\n" +
          "- Every patient name, ID, date, diagnosis, wound detail, insurance/coverage code, and dollar amount you can read\n" +
          "- Any tables: render them as compact key:value lines\n" +
          "- Any flags, statuses, or decisions visible\n\n" +
          "Be exhaustive but concise. No markdown headers, no preamble.",
      },
    ];

    if (isImage) {
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${data.mimeType};base64,${data.base64}` },
      });
    } else {
      userContent.push({
        type: "file",
        file: {
          filename: data.filename,
          file_data: `data:${data.mimeType};base64,${data.base64}`,
        },
      });
    }

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`AI gateway error [${res.status}]: ${errText.slice(0, 500)}`);
    }

    const json: any = await res.json();
    const text: string =
      json?.choices?.[0]?.message?.content ??
      json?.choices?.[0]?.message?.content?.[0]?.text ??
      "";

    return {
      filename: data.filename,
      mimeType: data.mimeType,
      summary: text || "(no content extracted)",
    };
  });
