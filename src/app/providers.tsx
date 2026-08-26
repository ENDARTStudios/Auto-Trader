"use client";

import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { toast } from "sonner";

function getCaptureError() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@/lib/observability/sentry").captureError as (
      err: Error,
      ctx?: Record<string, unknown>,
    ) => void;
  } catch {
    return (err: Error, ctx?: Record<string, unknown>) =>
      console.error("[captureError]", ctx?.label ?? "unknown", err.message);
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error, query) => {
            getCaptureError()(error as Error, {
              label: "tanstack:query",
              queryKey: query.queryKey,
            });
          },
        }),
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) => {
            getCaptureError()(error as Error, {
              label: "tanstack:mutation",
              mutationKey: (mutation.options as unknown as { mutationKey?: unknown })?.mutationKey,
            });
            toast.error(`Erro: ${(error as Error).message}`);
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 2000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        forcedTheme="dark"
        enableSystem={false}
        disableTransitionOnChange
      >
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
