"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, LogIn } from "lucide-react";
import { useAuth, useLogin } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { fadeInUp } from "@/lib/ui/motion";
import { useTranslation } from "@/lib/i18n/hooks";

export default function LoginPage() {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();
  const login = useLogin();
  const router = useRouter();
  const [email, setEmail] = useState("admin@local");
  const [password, setPassword] = useState("Admin123!");
  const [totp, setTotp] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-4 w-48 mt-2" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (user) {
    router.push("/");
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Já logado como {user.email} — redirecionando…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="w-full max-w-sm">
        <Card className="border-border/60">
          <CardHeader className="text-center">
            <div className="mx-auto size-10 rounded-full bg-primary/10 flex items-center justify-center mb-2">
              <Shield className="size-5 text-primary" />
            </div>
            <CardTitle className="text-xl">{t("login.title")}</CardTitle>
            <CardDescription>{t("login.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                login.mutate(
                  { email, password, totp: totp || undefined },
                  {
                    onError: (err: unknown) => {
                      const mfa = (err as Error & { mfaRequired?: boolean }).mfaRequired;
                      if (mfa) setMfaRequired(true);
                    },
                    onSuccess: () => setMfaRequired(false),
                  },
                );
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="email">{t("login.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@local"
                  required
                  autoComplete="email"
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t("login.password")}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="h-9"
                />
              </div>
              {mfaRequired && (
                <div className="space-y-2">
                  <Label htmlFor="totp">Código 2FA (TOTP)</Label>
                  <Input
                    id="totp"
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    value={totp}
                    onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    autoComplete="one-time-code"
                    className="h-9 font-mono tracking-widest"
                  />
                  <p className="text-[11px] text-muted-foreground">Abra seu app autenticador (Google Authenticator, Authy) e insira o código de 6 dígitos.</p>
                </div>
              )}
              <Button type="submit" className="w-full gap-2" disabled={login.isPending}>
                {login.isPending ? (
                  <span className="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                ) : (
                  <LogIn className="size-4" />
                )}
                {login.isPending ? t("login.signingIn") : t("login.signIn")}
              </Button>
            </form>

            <Alert className="mt-4">
              <AlertDescription className="text-xs leading-relaxed">
                <span className="font-medium">{t("login.credentialsTest")}</span>
                <br />
                <span className="tabular">admin@local / Admin123! {t("login.adminRole")}</span>
                <br />
                <span className="tabular">viewer@local / Viewer123! {t("login.viewerRole")}</span>
                <br />
                <span className="tabular">trader@local / Trader123! {t("login.traderRole")}</span>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
