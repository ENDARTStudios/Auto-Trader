# RBAC — Matriz de Níveis de Acesso

> **Versão:** 1.0 — 2026-08-26
> **Padrão:** RBAC 4 papéis × 24 permissões, enforcement em middleware + RLS
> **Fonte:** `src/lib/auth/rbac.ts` (a implementar em SPRINT) + `src/lib/auth/middleware.ts`

---

## 1. Papéis (Roles)

| Papel | Código | Descrição | Tipo |
|---|---|---|---|
| **Super Admin** | `super_admin` | Controle total. Único que pode gerenciar papéis, rotacionar segredos, ativar kill switch global e promover para live. | Humano (operador) |
| **Trader** | `trader` | Opera o engine, gerencia posições, configura estratégia, vê tudo. Não gerencia usuários nem segredos. | Humano |
| **Viewer** | `viewer` | Somente leitura: dashboard, relatórios, logs, equity curve. Não pode iniciar/parar engine nem modificar config. | Humano / auditor |
| **Service** | `service` | Conta de serviço para engine/signer/broadcaster. Sem acesso a UI. Escopo mínimo: ler config, escrever posições/logs, chamar signer. | Máquina |

> **Princípio:** least privilege. Um usuário tem exatamente 1 papel primário. Permissões são união do papel; não há permissão ad-hoc por usuário (evita drift).

---

## 2. Permissões (Permissions)

| # | Permissão | Código | Descrição |
|---|---|---|---|
| 1 | Ver dashboard | `dashboard:read` | GET /api/status, /api/analytics, /api/source-health |
| 2 | Ver posições | `positions:read` | GET /api/positions, /api/history |
| 3 | Criar/fechar posição | `positions:write` | POST /api/positions, POST close |
| 4 | Ver logs | `logs:read` | GET /api/logs, /api/surveillance, /api/site-audit |
| 5 | Ver config | `config:read` | GET /api/config |
| 6 | Editar config | `config:write` | POST /api/config |
| 7 | Controlar engine | `engine:control` | POST /api/engine/start, /api/engine/stop |
| 8 | Kill switch | `engine:kill` | POST /api/kill-switch |
| 9 | Gerenciar reserva | `reserve:manage` | POST /api/reserve/withdraw |
| 10 | Backtest | `backtest:run` | POST /api/backtest |
| 11 | Gerenciar watchlist | `watchlist:manage` | /api/watchlist CRUD |
| 12 | Gerenciar notificações | `notifications:manage` | /api/notifications CRUD |
| 13 | Gerenciar wallets (leitura) | `wallets:read` | GET /api/wallets |
| 14 | Gerenciar wallets (escrita) | `wallets:write` | POST/DELETE /api/wallets, /api/vault |
| 15 | Gerenciar exchanges | `exchanges:manage` | /api/exchanges CRUD |
| 16 | Gerenciar usuários | `users:manage` | CRUD /api/users, atribuir papéis |
| 17 | Ver auditoria | `audit:read` | GET /api/audit, verify hash-chain |
| 18 | Gerenciar feature flags | `flags:manage` | Toggle flags |
| 19 | Gerenciar schedule | `schedule:manage` | /api/schedule |
| 20 | Acesso signer (service) | `signer:call` | Chamar SignerAdapter.submit() — só `service` + `super_admin` |
| 21 | Broadcast (service) | `chain:broadcast` | Broadcaster.broadcastRawTransaction — só `service` |
| 22 | Exportar dados | `data:export` | CSV/JSON export com rate limit |
| 23 | Ver system info | `system:read` | GET /api/system, /api/runtime |
| 24 | Deploy / graduação | `deploy:promote` | Graduar para live, deploy |

---

## 3. Matriz Papel × Permissão

| Permissão \ Papel | `super_admin` | `trader` | `viewer` | `service` |
|---|---|---|---|---|
| `dashboard:read` | ✅ | ✅ | ✅ | ❌ |
| `positions:read` | ✅ | ✅ | ✅ | ✅* |
| `positions:write` | ✅ | ✅ | ❌ | ✅ |
| `logs:read` | ✅ | ✅ | ✅ | ❌ |
| `config:read` | ✅ | ✅ | ✅ | ✅ |
| `config:write` | ✅ | ✅ | ❌ | ❌ |
| `engine:control` | ✅ | ✅ | ❌ | ✅ |
| `engine:kill` | ✅ | ✅ | ❌ | ❌ |
| `reserve:manage` | ✅ | ❌ | ❌ | ❌ |
| `backtest:run` | ✅ | ✅ | ❌ | ❌ |
| `watchlist:manage` | ✅ | ✅ | ❌ | ❌ |
| `notifications:manage` | ✅ | ✅ | ❌ | ❌ |
| `wallets:read` | ✅ | ✅ | ❌ | ❌ |
| `wallets:write` | ✅ | ❌ | ❌ | ❌ |
| `exchanges:manage` | ✅ | ❌ | ❌ | ❌ |
| `users:manage` | ✅ | ❌ | ❌ | ❌ |
| `audit:read` | ✅ | ✅ | ✅ | ❌ |
| `flags:manage` | ✅ | ❌ | ❌ | ❌ |
| `schedule:manage` | ✅ | ✅ | ❌ | ❌ |
| `signer:call` | ✅ | ❌ | ❌ | ✅ |
| `chain:broadcast` | ✅ | ❌ | ❌ | ✅ |
| `data:export` | ✅ | ✅ | ❌ | ❌ |
| `system:read` | ✅ | ✅ | ✅ | ❌ |
| `deploy:promote` | ✅ | ❌ | ❌ | ❌ |

\* `service` lê posições apenas via pipeline interno, não via API pública.

---

## 4. Enforcement — 3 Camadas

### 4.1 Middleware Next.js (`src/middleware.ts`)

```ts
// Pseudocódigo — SPRINT implementa
export async function middleware(req: NextRequest) {
  const session = await getSession(req); // cookie httpOnly Secure SameSite
  if (!session && !isPublicRoute(req.nextUrl.pathname)) 
    return NextResponse.redirect('/login');
  
  const required = routePermissionMap[req.nextUrl.pathname + ':' + req.method];
  if (required && !hasPermission(session.role, required))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  
  // Rate limit por user_id + IP (ver docs/WAF_RATE_LIMIT.md)
  const rl = await checkRateLimit(session?.userId ?? ip, route);
  if (!rl.allowed) return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': rl.retryAfter } });
  
  return NextResponse.next();
}
```

### 4.2 API Route Guard (`src/lib/auth/middleware.ts`)

```ts
export function requirePermission(perm: Permission) {
  return async (req: NextRequest) => {
    const session = await requireSession(req); // 401 se não autenticado
    if (!hasPermission(session.role, perm)) throw new ForbiddenError(perm);
    return session; // injeta session no handler
  };
}
// Uso em rota:
// export const POST = withAuth(requirePermission('engine:kill'), async (req, session) => { ... })
```

### 4.3 RLS / App-Layer Guard (`docs/RLS.md`)

Mesmo com RBAC no middleware, cada query Prisma passa por `withRLS(session, prismaAction)` que injeta `where: { ownerId: session.userId }` quando aplicável. Defesa em profundidade: se middleware falhar, RLS ainda bloqueia.

---

## 5. Tabela `User` + `Role` (Prisma — SPRINT)

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String   // argon2id, custo ≥12
  role         String   @default("viewer") // super_admin|trader|viewer|service
  isActive     Boolean  @default(true)
  mfaEnabled   Boolean  @default(false)
  mfaSecret    String?  // TOTP secret, encrypted
  lastLoginAt  DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([email])
  @@index([role])
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  tokenHash String   @unique // SHA-256 do token opaco
  expiresAt DateTime
  ip        String?
  userAgent String?
  createdAt DateTime @default(now())
  @@index([userId])
  @@index([expiresAt])
}

model AuditLog {
  id        String   @id @default(cuid())
  actorId   String   // quem fez
  actorRole String
  action    String   // ex: "engine:kill", "wallets:write"
  target    String?  // ex: positionId, walletId
  ip        String?
  prevHash  String?
  hash      String   // SHA-256(canonical JSON) — hash-chain
  seq       Int      @unique // monotonic
  createdAt DateTime @default(now())
  @@index([actorId])
  @@index([action])
}
```

---

## 6. Fluxo de Autenticação

```mermaid
sequenceDiagram
    participant User
    participant Login as POST /api/auth/login
    participant DB as Prisma
    participant Session as Session table
    participant Cookie as httpOnly Secure SameSite cookie

    User->>Login: {email, password, totp?}
    Login->>DB: find User by email
    DB-->>Login: user {passwordHash, mfaEnabled, role}
    Login->>Login: argon2.verify(passwordHash, password)
    alt MFA enabled
        Login->>Login: verify TOTP (totp code vs mfaSecret)
    end
    Login->>DB: Session.create(tokenHash=sha256(token), expiresAt=+7d)
    Login->>Cookie: Set-Cookie: session=<opaque> ; HttpOnly ; Secure ; SameSite=Lax ; Path=/
    Login-->>User: 200 {user: {id, email, role}}
```

- **Token:** opaco 32 bytes `crypto.randomBytes(32).toString('hex')` — nunca JWT com segredo no client.
- **Cookie:** `httpOnly` (JS não lê), `Secure` (só HTTPS), `SameSite=Lax` (CSRF).
- **Lockout:** 5 tentativas falhas → 429 por 15min (por IP + por email). Ver `HARDENING-ROADMAP.md` H7.5.

---

## 7. Testes de RBAC (a implementar)

- [ ] `viewer` chama `POST /api/kill-switch` → 403
- [ ] `trader` chama `POST /api/reserve/withdraw` → 403
- [ ] `service` chama `GET /api/system` → 403 (service não acessa UI)
- [ ] Sem cookie chama `GET /api/positions` → 401
- [ ] `super_admin` faz tudo → 200
- [ ] IDOR: `trader` tenta `GET /api/wallets/:id` de outro user → 403/404 (RLS)
