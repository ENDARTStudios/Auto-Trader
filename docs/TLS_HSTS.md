# TLS/SSL + HSTS — Full (Strict)

> **Versão:** 1.0 — 2026-08-26
> **Padrão:** TLS 1.2+1.3, HSTS `max-age=63072000; includeSubDomains; preload`, redirect HTTP→HTTPS, Cloudflare Full (Strict)
> **Verificação:** `curl -I`, `securityheaders.com`, `hstspreload.org`

---

## 1. Modos TLS — Por que Full (Strict)

| Modo Cloudflare | O que faz | Seguro? | Usar? |
|---|---|---|---|
| **Off** | Sem TLS | ❌ | Nunca |
| **Flexible** | TLS só browser→CF, CF→origin em HTTP | ❌ (MITM entre CF e origin) | Nunca |
| **Full** | TLS browser→CF e CF→origin, mas não valida cert do origin | ⚠️ (self-signed passa) | Não |
| **Full (Strict)** | TLS end-to-end + valida cert do origin (CA válido, não expirado, hostname match) | ✅ | **Sim — obrigatório** |

**Full (Strict) exige:** origin tem certificado válido (Let's Encrypt via Caddy, ou Cloudflare Origin Certificate).

---

## 2. Caddy — TLS Automático (Let's Encrypt)

`Caddy` já está no projeto (`Caddyfile`, `Dockerfile`). Com `Full (Strict)`, Caddy obtém e renova cert automaticamente.

```caddyfile
# Caddyfile — Full (Strict) + HSTS preload-ready

{
    # Optional: Cloudflare DNS challenge (se origin atrás de CF proxy)
    # Necessário se CF proxy está ON (orange cloud) — Let's Encrypt precisa provar domínio via DNS
    # acme_dns cloudflare {env.CF_API_TOKEN}
}

# HTTPS — Caddy obtém cert Let's Encrypt automaticamente
:443 {
    tls {
        protocols tls1.2 tls1.3
        # curves x25519 secp256r1 secp384r1
        # ciphers TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256 TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256 ...
        # (Caddy defaults já são seguros — não precisa sobrescrever)
    }

    header {
        # HSTS — 2 anos, inclui subdomínios, preload
        # Só enviar em HTTPS (Caddy só serve :443 aqui, então ok)
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"

        # Security headers (defesa em profundidade — também no middleware)
        X-Frame-Options "DENY"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.binance.com https://api.dexscreener.com; frame-ancestors 'none'"
        Cross-Origin-Opener-Policy "same-origin"
        Cross-Origin-Embedder-Policy "require-corp"
        # Remove fingerprint
        -Server
    }

    reverse_proxy localhost:3000 {
        header_up Host {host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Real-IP {remote_host}
    }
}

# HTTP → HTTPS redirect (HSTS precisa disso para primeiro acesso)
:80 {
    redir https://{host}{uri} permanent
}
```

**Sem Caddy (Vercel/Fly.io/Railway):** TLS é gerenciado pela plataforma (já Full Strict). Só garantir HSTS header no `next.config.ts` / `middleware.ts`:

```ts
// next.config.ts — HSTS via headers()
const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: process.env.NODE_ENV === 'production' ? [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ] : [],
      },
    ];
  },
};
```

---

## 3. Cloudflare — Configuração Full (Strict)

Dashboard → SSL/TLS → Overview → **Full (strict)**

1. **SSL/TLS encryption mode:** `Full (strict)`
2. **Edge Certificates:**
   - Always Use HTTPS: **ON**
   - Automatic HTTPS Rewrites: **ON**
   - Minimum TLS Version: **1.2**
   - Opportunistic Encryption: **ON**
   - TLS 1.3: **ON**
3. **Origin Server:**
   - Origin Certificate: gerar em SSL/TLS → Origin Server → Create certificate (RSA 2048, 15 anos) → instalar no Caddy (`tls /path/cert.pem /path/key.pem`) OU deixar Caddy com Let's Encrypt (preferido — auto-renew).
   - Authenticated Origin Pulls: **ON** (opcional, mas recomendado — só CF pode falar com origin)

**Via API:**

```bash
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/ssl" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value":"strict"}'

curl -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/min_tls_version" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -d '{"value":"1.2"}'
```

---

## 4. HSTS — Detalhes

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
                           │                │                └─ autoriza inclusão em hstspreload.org
                           │                └─ HSTS vale para *.example.com também
                           └─ 63072000s = 2 anos (recomendado mínimo para preload)
```

- **max-age:** 2 anos (63072000). Menos que isso não é aceito para preload.
- **includeSubDomains:** obrigatório para preload. Cuidado: todos os subdomínios precisam servir HTTPS.
- **preload:** indica que o domínio quer entrar na lista hardcoded dos browsers (Chrome, Firefox, Safari). Após incluir, o browser NUNCA tenta HTTP, nem no primeiro acesso.
- **Só em HTTPS:** nunca enviar HSTS em HTTP (browser ignora e pode ser MITM).

**Submissão para preload:**

1. Garantir `https://example.com` serve HSTS com `includeSubDomains; preload`.
2. Garantir `https://www.example.com` também (se existir).
3. Submeter em https://hstspreload.org → Enter domain → Check → Submit.

**Verificação:**

```bash
# HSTS header presente?
curl -sI https://your-domain.com | grep -i strict-transport-security
# Esperado: Strict-Transport-Security: max-age=63072000; includeSubDomains; preload

# Preload status?
curl -s "https://hstspreload.org/api/v2/status?domain=your-domain.com" | jq .

# Security headers nota A+?
# https://securityheaders.com/?q=https://your-domain.com&followRedirects=on
# Esperado: A ou A+
```

---

## 5. Verificação Completa (Local + Prod)

```bash
# 5.1 Local — Caddy deve redirecionar HTTP→HTTPS
curl -i http://localhost:80/ 2>&1 | head -5
# Esperado: HTTP/1.1 308 Permanent Redirect → Location: https://...

# 5.2 Local — HTTPS deve ter HSTS (se NODE_ENV=production)
curl -skI https://localhost:443/api/health | grep -i strict
# Esperado (prod): Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
# Esperado (dev):  (vazio — HSTS só em prod para não travar localhost)

# 5.3 Prod — TLS válido e Full Strict
echo | openssl s_client -connect your-domain.com:443 -servername your-domain.com 2>/dev/null | openssl x509 -noout -dates -issuer
# Esperado: notBefore/notAfter válidos, issuer Let's Encrypt ou Cloudflare

# 5.4 Prod — TLS version
nmap --script ssl-enum-ciphers -p 443 your-domain.com 2>&1 | grep -E "TLSv|SSLv"
# Esperado: TLSv1.2 e TLSv1.3 OK; SSLv3, TLSv1.0, TLSv1.1 ausentes

# 5.5 Prod — securityheaders.com
# Abrir https://securityheaders.com/?q=https://your-domain.com
# Esperado: A ou A+ (falha se faltar HSTS, CSP, X-Frame, etc.)
```

---

## 6. Checklist de Deploy

- [ ] `Caddyfile` com `tls { protocols tls1.2 tls1.3 }` e HSTS header
- [ ] Cloudflare SSL mode = **Full (strict)** (não Flexible/Full)
- [ ] Always Use HTTPS = ON, Min TLS = 1.2, TLS 1.3 = ON
- [ ] `curl -I https://domain` → `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- [ ] `curl -I http://domain` → `308 → https://`
- [ ] `securityheaders.com` → A ou A+
- [ ] (Opcional) Submetido em `hstspreload.org` e aprovado
- [ ] `next.config.ts` headers() também tem HSTS (defesa em profundidade se Caddy cair)
- [ ] `middleware.ts` também seta HSTS em prod (terceira camada)

---

## 7. DNSSEC + CAA + HSTS Preload — Condicional (Fase 7.10)

> Status: **Condicional** — só quando domínio próprio for registrado (`PENDENCIAS_OPERADOR.md:1`). Sem domínio, Cloudflare gerencia DNSSEC automaticamente quando o domínio é delegado.
> Evidência: `docs/TLS_HSTS.md:7` + `PLANO_MESTRE.md:7.10` stub.

**Cloudflare (quando domínio delegado):**

```bash
# 1. Registrar domínio e apontar NS para Cloudflare (Dashboard → Add site)
# 2. DNS → Settings → DNSSEC → Enable
#    Cloudflare publica DS automaticamente no registrar (se registrar suporta CDS/CDNSKEY)
#    Verificar: dig +dnssec your-domain.com DS
# 3. DNS → Add record → Type CAA
#    0 issue "letsencrypt.org"
#    0 issuewild "letsencrypt.org"
#    0 iodef "mailto:endart.studios@gmail.com"
#    Verificar: dig your-domain.com CAA
# 4. HSTS preload — ver seção 4 (hstspreload.org)
```

**Sem domínio próprio (estado atual Beta):** usar `http://localhost:3000` + Fly.io `*.fly.dev` (já tem TLS + HSTS via `next.config.ts:12` prod-only). DNSSEC/CAA só faz sentido após `your-domain.com`.
