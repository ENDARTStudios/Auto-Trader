"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "./api";
import { Icon } from "./icons";
import { Badge, Card, Empty, Kpi, Skeleton } from "./ui";
import { stampUtc } from "@/lib/meridian/format";

interface SourceRow {
  id: string;
  source: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMsg: string | null;
  successCount24h: number;
  errorCount24h: number;
  rateLimited: boolean;
  rateLimitUntil: string | null;
  windowSuccessCount: number;
  windowErrorCount: number;
}

interface SourcesResponse {
  sources: SourceRow[];
}

interface SystemInfo {
  version?: string;
  uptimeSeconds?: number;
  node?: string;
  env?: string;
  tables?: Record<string, number>;
  [key: string]: unknown;
}

export function DataView() {
  const qc = useQueryClient();
  const sources = useQuery<SourcesResponse>({
    queryKey: ["mrd", "sources"],
    queryFn: () => apiGet<SourcesResponse>("/api/source-health"),
    refetchInterval: 30_000,
  });
  const info = useQuery<SystemInfo>({
    queryKey: ["mrd", "system-info"],
    queryFn: () => apiGet<SystemInfo>("/api/system/info"),
    retry: 0,
  });

  const reset = useMutation({
    mutationFn: (source: string) => apiPost<{ ok: boolean }>("/api/source-health/reset", { source }),
    onSuccess: (_r, source) => {
      toast.success("Source health reset", { description: `${source} counters cleared.` });
      void qc.invalidateQueries({ queryKey: ["mrd", "sources"] });
    },
    onError: (err: Error) => toast.error("Reset failed", { description: err.message }),
  });

  const rows = sources.data?.sources ?? [];
  const unhealthy = rows.filter((r) => r.rateLimited || (r.lastErrorAt && (!r.lastSuccessAt || new Date(r.lastErrorAt) > new Date(r.lastSuccessAt))));
  const tables = info.data?.tables ?? {};

  return (
    <>
      <header className="mrd-page-head">
        <div>
          <div className="mrd-title-row">
            <h1 className="mrd-title">Data &amp; sources</h1>
            <span className="mrd-status">
              <Badge tone={unhealthy.length ? "warn" : "pos"}>{unhealthy.length ? `${unhealthy.length} degraded` : "all healthy"}</Badge>
              <span className="mrd-dim" style={{ fontSize: 12 }}>{rows.length} sources tracked</span>
            </span>
          </div>
          <p className="mrd-sub">
            Where prices, candles and safety signals come from. If a source degrades the engine reduces size instead of
            guessing — the counters here are what it uses to decide.
          </p>
        </div>
        <div className="mrd-actions">
          <button type="button" className="mrd-btn mrd-btn-ghost mrd-btn-sm" onClick={() => sources.refetch()}>
            <Icon name="activity" size={15} /> Refresh
          </button>
          <button type="button" className="mrd-btn mrd-btn-secondary mrd-btn-sm" disabled title="Adding venues arrives with Settings">
            <Icon name="data" size={15} /> Add source
          </button>
        </div>
      </header>

      <div className="mrd-kpi-row">
        <Kpi label="Sources" value={String(rows.length)} foot={<span className="mrd-dim">tracked independently</span>} />
        <Kpi label="Healthy" value={String(rows.length - unhealthy.length)} valueClassName="mrd-pos" foot={<span className="mrd-dim">success more recent than error</span>} />
        <Kpi label="Degraded" value={String(unhealthy.length)} valueClassName={unhealthy.length ? "mrd-neg" : ""} foot={<span className="mrd-dim">rate limited or erroring</span>} />
        <Kpi
          label="DB tables"
          value={String(Object.keys(tables).length)}
          foot={<span className="mrd-dim">{info.data?.version ?? "system info"}</span>}
        />
      </div>

      <div className="mrd-hero" style={{ marginTop: 16 }}>
        <section className="mrd-card">
          <div className="mrd-card-hd" data-border="true">
            <div>
              <div className="mrd-card-title">Source health</div>
              <div className="mrd-card-sub">success/error counters over 24h and current window</div>
            </div>
            <Badge>{rows.length}</Badge>
          </div>
          {sources.isLoading ? (
            <div className="mrd-card-body" style={{ display: "grid", gap: 10 }}><Skeleton height={16} /><Skeleton height={16} /></div>
          ) : rows.length === 0 ? (
            <Empty title="No sources registered" description="The engine registers each external source the first time it uses one." />
          ) : (
            <div className="mrd-table-wrap">
              <table className="mrd-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>State</th>
                    <th className="num">24h ok</th>
                    <th className="num">24h errors</th>
                    <th>Last success</th>
                    <th>Last error</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const erroring = r.lastErrorAt && (!r.lastSuccessAt || new Date(r.lastErrorAt) > new Date(r.lastSuccessAt));
                    return (
                      <tr key={r.id}>
                        <td className="mrd-muted">{r.source}</td>
                        <td>
                          <Badge tone={r.rateLimited ? "warn" : erroring ? "neg" : "pos"}>
                            {r.rateLimited ? "rate limited" : erroring ? "error" : "ok"}
                          </Badge>
                        </td>
                        <td className="num">{r.successCount24h}</td>
                        <td className={`num ${r.errorCount24h ? "mrd-neg" : ""}`}>{r.errorCount24h}</td>
                        <td className="mrd-dim">{stampUtc(r.lastSuccessAt)}</td>
                        <td className="mrd-dim">{r.lastErrorAt ? stampUtc(r.lastErrorAt) : "—"}</td>
                        <td className="num">
                          <button type="button" className="mrd-btn mrd-btn-ghost mrd-btn-sm" onClick={() => reset.mutate(r.source)} disabled={reset.isPending}>
                            Reset
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="mrd-side">
          <Card title="System" sub={info.data?.env ? `env ${info.data.env}` : "runtime"}>
            {info.isLoading ? (
              <Skeleton height={16} />
            ) : info.isError ? (
              <p className="mrd-dim" style={{ fontSize: 12.5 }}>System info is not available for this role.</p>
            ) : (
              <dl className="mrd-kv">
                <dt>Version</dt>
                <dd>{info.data?.version ?? "—"}</dd>
                <dt>Node</dt>
                <dd>{info.data?.node ?? "—"}</dd>
                <dt>Uptime</dt>
                <dd>{info.data?.uptimeSeconds ? `${Math.round(info.data.uptimeSeconds / 60)} min` : "—"}</dd>
                <dt>Tables</dt>
                <dd>{Object.keys(tables).length}</dd>
              </dl>
            )}
          </Card>
          <Card title="Row counts" sub="what the ledger holds">
            {Object.keys(tables).length === 0 ? (
              <p className="mrd-dim" style={{ fontSize: 12.5 }}>No table counters returned.</p>
            ) : (
              <div style={{ display: "grid", gap: 7 }}>
                {Object.entries(tables)
                  .slice(0, 10)
                  .map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span className="mrd-dim">{k}</span>
                      <b>{v}</b>
                    </div>
                  ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
