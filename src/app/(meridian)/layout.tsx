import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, type SessionUser } from "@/lib/auth/session";
import { Shell } from "@/components/meridian/shell";
import "./meridian-tokens.css";
import "./meridian.css";

export const metadata: Metadata = {
  title: "Auto Trader — Overview",
  description: "Mission control for the autonomous paper-trading engine.",
};

export default async function MeridianLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const cookie = headerList.get("cookie") ?? "";
  let session: SessionUser | null = null;
  try {
    session = await getSession(new Request("http://internal/overview", { headers: { cookie } }));
  } catch {
    session = null;
  }
  if (!session) redirect("/login");

  return (
    <Shell user={{ email: session.email, role: session.role }} serverNow={new Date().toISOString()}>
      {children}
    </Shell>
  );
}
