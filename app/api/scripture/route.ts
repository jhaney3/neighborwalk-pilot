type EsvPassageResponse = {
  canonical?: string;
  passages?: string[];
};

const ESV_PASSAGE_ENDPOINT = "https://api.esv.org/v3/passage/text/";

function normalizeReference(value: string) {
  return value.trim().replace(/[–—]/g, "-").replace(/\s+/g, " ");
}

function validReference(value: string) {
  return value.length >= 3
    && value.length <= 100
    && /[A-Za-z]/.test(value)
    && /\d/.test(value)
    && /^[0-9A-Za-z .:',;()-]+$/.test(value);
}

export async function GET(request: Request) {
  const reference = normalizeReference(new URL(request.url).searchParams.get("reference") ?? "");
  if (!validReference(reference)) {
    return Response.json({ error: "Enter a valid scripture reference." }, { status: 400 });
  }

  const apiKey = process.env.ESV_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ code: "not_configured", error: "The ESV reader is not configured." }, { status: 503 });
  }

  const params = new URLSearchParams({
    q: reference,
    "include-passage-references": "false",
    "include-headings": "false",
    "include-footnotes": "false",
    "include-footnote-body": "false",
    "include-verse-numbers": "true",
    "include-first-verse-numbers": "true",
    "include-short-copyright": "true",
    "line-length": "0",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${ESV_PASSAGE_ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `Token ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      return Response.json({ error: response.status === 404 ? "Passage not found." : "The passage could not be loaded." }, { status: response.status === 404 ? 404 : 502 });
    }

    const payload = await response.json() as EsvPassageResponse;
    const text = payload.passages?.join("\n\n").trim();
    if (!text) return Response.json({ error: "Passage not found." }, { status: 404 });

    return Response.json({ reference, canonical: payload.canonical || reference, text }, {
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return Response.json({ error: "The passage could not be loaded." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
