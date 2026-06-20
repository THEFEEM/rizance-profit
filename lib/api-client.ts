// Browser-side fetch helper that understands our { data } / { error } envelope.
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; code?: string; fields?: Record<string, string[] | undefined> };

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    return { ok: false, status: 0, message: "Network error — check your connection." };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // no/invalid JSON body
  }

  if (res.ok) {
    return { ok: true, data: (body as { data: T })?.data };
  }

  const err = (body as { error?: { message?: string; code?: string; fields?: Record<string, string[] | undefined> } })?.error;
  return {
    ok: false,
    status: res.status,
    message: err?.message ?? "Something went wrong. Please try again.",
    code: err?.code,
    fields: err?.fields,
  };
}
