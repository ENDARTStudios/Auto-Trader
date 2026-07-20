"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { LogRow } from "@/hooks/use-trading-data";

const LEVEL_COLOR: Record<string, string> = {
  debug: "text-muted-foreground",
  info: "text-foreground",
  warn: "text-yellow-500",
  error: "text-red-500",
};

const SOURCE_COLOR: Record<string, string> = {
  engine: "bg-blue-500/10 text-blue-500",
  risk: "bg-red-500/10 text-red-500",
  scam: "bg-purple-500/10 text-purple-500",
  cex: "bg-cyan-500/10 text-cyan-500",
  dex: "bg-teal-500/10 text-teal-500",
  portfolio: "bg-green-500/10 text-green-500",
  api: "bg-orange-500/10 text-orange-500",
  selector: "bg-pink-500/10 text-pink-500",
};

export function LogsFeed({
  logs,
  isLoading,
}: {
  logs: LogRow[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Activity Logs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (logs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Activity Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-12">
            Nenhum log ainda.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Logs ({logs.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-[600px] overflow-y-auto font-mono text-xs space-y-0.5">
          {logs.map((l) => (
            <div
              key={l.id}
              className={`flex items-start gap-2 px-2 py-1 hover:bg-muted/50 rounded ${LEVEL_COLOR[l.level] ?? ""}`}
            >
              <span className="text-muted-foreground shrink-0">
                {new Date(l.createdAt).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
              <Badge
                variant="outline"
                className={`text-[10px] px-1 py-0 h-4 shrink-0 ${SOURCE_COLOR[l.source] ?? ""}`}
              >
                {l.source}
              </Badge>
              <span className="text-muted-foreground shrink-0 uppercase">
                {l.level}
              </span>
              <span className="break-all">{l.message}</span>
              {l.context && (
                <span className="text-muted-foreground/70 break-all">
                  {l.context}
                </span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
