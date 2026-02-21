/**
 * Shared helpers for channel setup scripts.
 *
 * Provides Inngest REST API access for webhook management.
 */

const INNGEST_API = "https://api.inngest.com/v1";

function getSigningKey(): string {
  const key = process.env.INNGEST_SIGNING_KEY;
  if (!key) throw new Error("INNGEST_SIGNING_KEY is required");
  return key;
}

/**
 * Fetch from the Inngest REST API (authenticated with signing key).
 */
export async function inngestFetch(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${INNGEST_API}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${getSigningKey()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Inngest API ${path}: ${res.status} — ${JSON.stringify(json)}`);
  }
  return json;
}
