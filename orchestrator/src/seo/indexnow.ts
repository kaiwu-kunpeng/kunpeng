export interface IndexNowResult {
  submitted: number;
  ok: boolean;
  status?: number;
}

export interface SubmitIndexNowOpts {
  host: string;
  key: string;
  keyLocation?: string;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

const DEFAULT_ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS = 10_000;

export async function submitIndexNow(
  urls: string[],
  opts: SubmitIndexNowOpts,
): Promise<IndexNowResult> {
  const urlList = Array.from(new Set(urls.map((url) => url.trim()).filter(Boolean))).slice(0, MAX_URLS);
  if (urlList.length === 0) {
    return { submitted: 0, ok: true };
  }

  const body = {
    host: opts.host,
    key: opts.key,
    ...(opts.keyLocation ? { keyLocation: opts.keyLocation } : {}),
    urlList,
  };

  try {
    const response = await (opts.fetchImpl ?? fetch)(opts.endpoint ?? DEFAULT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return { submitted: 0, ok: false, status: response.status };
    }

    return { submitted: urlList.length, ok: true, status: response.status };
  } catch {
    return { submitted: 0, ok: false };
  }
}
