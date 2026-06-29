const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3-lite"; // 512 dimensions

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const res = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Voyage API error (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    data: { embedding: number[]; index: number }[];
  };

  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  return embedding;
}
