"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
import { Icon } from "./icons";
import { Badge, Card, Empty, Kpi, Skeleton } from "./ui";
import { clockUtc, stampUtc } from "@/lib/meridian/format";

interface UserRow {
  id: string;
  email: string;
  role: string;
  mfaEnabled?: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
}

interface Flag {
  key: string;
  enabled?: boolean;
  value?: string | number | boolean | null;
  scope?: string;
  updatedAt?: string;
}

interface LogRow {
  id: number;
  level: string;
  source?: string;
  message: string;
  createdAt: string;
}

export function AdminView() {
  const users = useQuery<{ users: UserRow[] } | UserRow[]>({
    queryKey: ["mrd", "users"],
    queryFn: () => apiGet<{ users: UserRow[] } | UserRow[]>("/api/users"),
    retry: 0,
  });
  const flags = useQuery<{ flags: Flag[] }>({
    queryKey: ["mrd", "flags"],
    queryFn: () => apiGet<{ flags: Flag[] }>("/api/feature-flags"),
    retry: 0,
  });
  const logs = useQuery<{ logs: LogRow[]; total: number } | LogRow[]>({
    queryKey: ["mrd", "audit-logs"],
    queryFn: () => apiGet<{ logs: LogRow[]; total: number } | LogRow[]>("/api/logs?limit=40"),
    retry: 0,
  });

  const userList = Array.isArray(users.data) ? users.data : users.data?.users ?? [];
  const flagList = flags.data?.flags ?? [];
  const logList = Array.isArray(logs.data) ? logs.data : logs.data?.logs ?? [];
  const admins = userList.filter((u) => u.role === "super_admin").length;

  return (
    <>
      <header className="mrd-page-head">
        <div>
          <div className="mrd-title-row">
            <h1 className="mrd-title">Users &amp; audit</h1>
            <span className="mrd-status">
              <Badge tone="brand">super admin</Badge>
              <span className="mrd-dim" style={{ fontSize: 12 }}>{userList.length} accounts · {flagList.length} flags</span>
            </span>
          </div>
          <p className="mrd-sub">
            Every privileged action is recorded with actor, IP and timestamp. Feature flags are read-only here until the
            rollout policy is signed off.
          </p>
        </div>
        <div className="mrd-actions">
          <button type="button" className="mrd-btn mrd-btn-ghost mrd-btn-sm" onClick={() => { users.refetch(); logs.refetch(); }}>
            <Icon name="activity" size={15} /> Refresh
          </button>
          <button type="button" className="mrd-btn mrd-btn-secondary mrd-btn-sm" disabled title="Invites arrive with the auth phase">
            <Icon name="users" size={15} /> Invite user
          </button>
        </div>
      </header>

      <div className="mrd-kpi-row">
        <Kpi label="Accounts" value={String(userList.length)} foot={<span className="mrd-dim">all roles</span>} />
        <Kpi label="Admins" value={String(admins)} foot={<span className="mrd-dim">super admin</span>} />
        <Kpi label="With MFA" value={String(userList.filter((u) => u.mfaEnabled).length)} foot={<span className="mrd-dim">of {userList.length}</span>} />
        <Kpi label="Flags" value={String(flagList.length)} foot={<span className="mrd-dim">read-only</span>} />
      </div>

      <div className="mrd-hero" style={{ marginTop: 16 }}>
        <section className="mrd-card">
          <div className="mrd-card-hd" data-border="true">
            <div>
              <div className="mrd-card-title">Accounts</div>
              <div className="mrd-card-sub">role changes require MFA re-auth</div>
            </div>
            <Badge>{userList.length}</Badge>
          </div>
          {users.isLoading ? (
            <div className="mrd-card-body" style={{ display: "grid", gap: 10 }}><Skeleton height={16} /><Skeleton height={16} /></div>
          ) : users.isError ? (
            <Empty title="Restricted" description="Your role cannot read the user directory." />
          ) : userList.length === 0 ? (
            <Empty title="No accounts" description="Create the first operator account in the legacy admin until invites land here." />
          ) : (
            <div className="mrd-table-wrap">
              <table className="mrd-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>MFA</th>
                    <th>Created</th>
                    <th>Last login</th>
                  </tr>
                </thead>
                <tbody>
                  {userList.map((u) => (
                    <tr key={u.id}>
                      <td>{u.email}</td>
                      <td><Badge tone={u.role === "super_admin" ? "brand" : "neutral"}>{u.role.replace("_", " ")}</Badge></td>
                      <td className={u.mfaEnabled ? "mrd-pos" : "mrd-dim"}>{u.mfaEnabled ? "on" : "off"}</td>
                      <td className="mrd-dim">{u.createdAt ? stampUtc(u.createdAt) : "—"}</td>
                      <td className="mrd-dim">{u.lastLoginAt ? stampUtc(u.lastLoginAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="mrd-side">
          <Card title="Feature flags" sub="environment state">
            {flags.isLoading ? (
              <Skeleton height={16} />
            ) : flagList.length === 0 ? (
              <p className="mrd-dim" style={{ fontSize: 12.5 }}>No flags stored.</p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {flagList.slice(0, 8).map((f) => (
                  <div key={f.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}>
                    <span className="mrd-dim" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{f.key}</span>
                    <Badge tone={f.enabled ?? Boolean(f.value) ? "pos" : "neutral"}>{String(f.enabled ?? f.value ?? "—")}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <section className="mrd-card" style={{ marginTop: 16 }}>
        <div className="mrd-card-hd" data-border="true">
          <div>
            <div className="mrd-card-title">Audit log</div>
            <div className="mrd-card-sub">most recent privileged events</div>
          </div>
          <Badge>{logList.length}</Badge>
        </div>
        {logs.isLoading ? (
          <div className="mrd-card-body"><Skeleton height={16} /></div>
        ) : logList.length === 0 ? (
          <Empty title="No audit entries" description="Actions like kill switch, config changes and logins are recorded here." />
        ) : (
          <div className="mrd-table-wrap">
            <table className="mrd-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Level</th>
                  <th>Source</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {logList.map((l) => (
                  <tr key={l.id}>
                    <td className="mrd-dim">{clockUtc(l.createdAt)}</td>
                    <td><Badge tone={l.level === "error" ? "neg" : l.level === "warn" ? "warn" : "neutral"}>{l.level}</Badge></td>
                    <td className="mrd-muted">{l.source ?? "—"}</td>
                    <td className="mrd-muted">{l.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
