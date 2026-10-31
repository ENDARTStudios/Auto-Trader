"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Newspaper, ExternalLink, AlertTriangle } from "lucide-react";
import { useNews } from "@/hooks/use-trading-data";
import { useTranslation } from "@/lib/i18n/hooks";

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  if (isNaN(d)) return "—";
  const diff = Date.now() - d;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function sanitizeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function NewsPanel() {
  const { t } = useTranslation();
  const news = useNews(12);

  if (news.isLoading && !news.data) {
    return (
      <Card data-testid="news-panel">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Newspaper className="size-4" />
            {t("news.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const items = news.data?.items ?? [];
  const degraded = news.data?.degraded ?? false;

  return (
    <Card data-testid="news-panel">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Newspaper className="size-4" />
          {t("news.title")}
          <span className="text-[10px] text-muted-foreground font-normal ml-auto">
            {t("news.updated")} {news.data ? timeAgo(news.data.fetchedAt) : "—"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {degraded && (
          <div className="flex items-center gap-2 text-[11px] text-amber-400 mb-3">
            <AlertTriangle className="size-3.5 shrink-0" />
            {t("news.degraded")}
          </div>
        )}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("news.empty")}</p>
        ) : (
          <ul className="space-y-2.5">
            {items.map((item) => {
              const safe = sanitizeUrl(item.link);
              return (
                <li key={item.link} className="group border-b border-border/30 pb-2.5 last:border-0 last:pb-0">
                  {safe ? (
                    <a
                      href={safe}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block hover:bg-muted/30 -mx-1 px-1 py-0.5 rounded transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[13px] font-medium leading-snug text-foreground group-hover:text-primary transition-colors">
                          {item.title}
                        </span>
                        <ExternalLink className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                      </div>
                      {item.summary && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                          {item.summary}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                          {item.source}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {timeAgo(item.publishedAt)}
                        </span>
                      </div>
                    </a>
                  ) : (
                    <div className="text-[13px] text-foreground">{item.title}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
