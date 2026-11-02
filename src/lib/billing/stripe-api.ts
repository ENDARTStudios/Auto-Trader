// Cliente mínimo da API Stripe via fetch (sem SDK). Usado apenas no servidor.
// A secret key nunca é logada; erros devolvem a mensagem do Stripe, não a chave.

const API_BASE = "https://api.stripe.com/v1";

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

function authHeader(): string {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("stripe_not_configured");
  return `Bearer ${key}`;
}

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `stripe_error_${res.status}`);
  }
  return body;
}

export async function stripePost<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") form.append(k, String(v));
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    cache: "no-store",
  });
  return parse<T>(res);
}

export async function stripeGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.append(k, String(v));
  }
  const res = await fetch(`${API_BASE}${path}?${qs.toString()}`, {
    headers: { Authorization: authHeader() },
    cache: "no-store",
  });
  return parse<T>(res);
}

export function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3100")
  );
}
