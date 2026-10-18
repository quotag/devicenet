import createClient, { type Middleware } from "openapi-fetch";
import type { paths as ApiPaths } from "./api.gen";
import { env } from "@/env";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type TokenGetter = () => Promise<string | null> | string | null;
let tokenGetter: TokenGetter = () => null;
export function setTokenGetter(fn: TokenGetter): void {
  tokenGetter = fn;
}

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    const token = await tokenGetter();
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    return request;
  },
  async onResponse({ response }) {
    if (response.ok) return undefined;
    let code = "unknown";
    let message = response.statusText;
    try {
      const body = (await response.clone().json()) as { error?: { code?: string; message?: string } };
      if (body?.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
      }
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(response.status, code, message);
  },
};

export function createApi(baseUrl: string, fetchImpl?: typeof fetch) {
  const client = createClient<ApiPaths>({
    baseUrl,
    ...(fetchImpl ? { fetch: (r: Request) => fetchImpl(r) } : {}),
  });
  client.use(authMiddleware);
  return client;
}

let shared: ReturnType<typeof createApi> | null = null;
/** App-wide client on VITE_API_URL (created lazily). */
export function getApi() {
  return (shared ??= createApi(env.apiUrl ?? ""));
}
