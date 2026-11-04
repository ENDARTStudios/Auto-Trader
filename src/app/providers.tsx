"use client";

import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import { useState } from "react";
import { toast } from "sonner";
import { captureClientError } from "@/lib/observability/sentry-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error, query) => {
            captureClientError(error as Error, {
              label: "tanstack:query",
              queryKey: query.queryKey,
            });
          },
        }),
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) => {
            captureClientError(error as Error, {
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
        {/* reducedMotion="user": respeita prefers-reduced-motion em toda a árvore
            framer-motion (regra de motion — docs/MOTION.md + ui-ux-pro-max prio 7) */}
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
