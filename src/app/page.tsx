import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, type SessionUser } from "@/lib/auth/session";

/**
 * Raiz do produto: manda quem tem sessão para o novo shell e quem não tem para
 * o login. O dashboard antigo continua acessível em /terminal até a paridade
 * completa das telas restantes.
 */
export default async function RootPage() {
  const headerList = await headers();
  const cookie = headerList.get("cookie") ?? "";
  let session: SessionUser | null = null;
  try {
    session = await getSession(new Request("http://internal/", { headers: { cookie } }));
  } catch {
    session = null;
  }
  redirect(session ? "/overview" : "/welcome");
}
