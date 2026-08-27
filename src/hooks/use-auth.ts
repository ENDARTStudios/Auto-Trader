"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export function useAuth() {
  const query = useQuery<{ user: AuthUser } | null>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error("Failed to fetch session");
      return res.json();
    },
    retry: false,
    staleTime: 30_000,
  });

  return {
    user: query.data?.user ?? null,
    isLoading: query.isLoading,
    isAuthenticated: !!query.data?.user,
    refetch: query.refetch,
  };
}

export function useLogin() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: async (input: { email: string; password: string; totp?: string }) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) {
        const err: Error & { mfaRequired?: boolean } = new Error(data.error || "Login failed");
        if (data.mfaRequired) err.mfaRequired = true;
        (err as unknown as { data: unknown }).data = data;
        throw err;
      }
      return data;
    },
    onSuccess: () => {
      toast.success("Login realizado");
      qc.invalidateQueries({ queryKey: ["auth"] });
      router.push("/");
      router.refresh();
    },
    onError: (e: Error & { mfaRequired?: boolean }) => {
      if (e.mfaRequired) toast.error("MFA requerido — insira o código TOTP");
      else toast.error(e.message);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Logout failed");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Logout realizado");
      qc.setQueryData(["auth", "me"], null);
      qc.invalidateQueries({ queryKey: ["auth"] });
      router.push("/login");
    },
  });
}
