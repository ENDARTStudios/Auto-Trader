# DEFINE_THE_USER — Quem é o Usuário

> **Versão:** 1.0 — 2026-09-23
> **Fonte:** PRD §2 (Personas & Jobs) + `MANUAL_DO_OPERADOR.md`. Este doc aprofunda o "para quem" para guiar decisões de produto.

---

## Persona principal — **Operador autônomo** (você, dono do sistema)

- **Perfil:** técnico, confortável com terminal/CI, roda o sistema na própria infraestrutura (local/VPS/Docker).
- **Job:** delegar o monitoramento 24/7 de candidatos CEX+DEX ao sistema, mantendo **controle humano final** (kill switch, envelope de risco).
- **Dores:** milhares de tokens, 90%+ honeypot/rug em L2; disciplina de risco manual falha; sem tempo para vigiar 35+ plataformas.
- **Critérios de sucesso:** equity curve de paper positiva por N ciclos; zero exposição a honeypot conhecido; kill switches testados; auditoria íntegra de cada decisão.

## Personas secundárias (RBAC)

| Papel | Quem é | Pode | Não pode |
|---|---|---|---|
| `viewer` | Auditor/observador | Ler dashboard/status | Qualquer ação (kill switch → 403) |
| `trader` | Operador júnior | Operar dentro dos limites | Mudar envelope de risco |
| `admin` | Operador sênior | Config, usuários (não super) | Sair de `crisis_lock` sozinho |
| `super_admin` | Dono | Tudo, incl. gestão de usuários | — (mesmo assim, envelope exige edição consciente) |

Matriz completa: [RBAC.md](./RBAC.md).

## Anti-personas (não é para quem)

- **Trader de alta frequência competitivo:** o sistema se auto-limita (order_to_trade_ratio → advisory) por compliance — não é para(latency-sensitive) HFT.
- **Pessoa física leiga buscando renda passiva:** exige operação técnica e entendimento de risco; a graduação paper→live existe justamente para desestimular uso impulsivo.
- **Quem quer "bot de lucro garantido":** aviso de risco é explícito; não é aconselhamento financeiro.

## Jobs-to-be-done (resumo)

1. "Quando surgir um candidato DEX, quero que ele passe por 6+ camadas de scam detection antes de qualquer capital, para eu não perder em rug pull."
2. "Quando o mercado/regime quebrar, quero o sistema neutralizando posição sozinho, para eu não reagir tarde."
3. "Quando o modelo degradar (Brier piora), quero o sistema reduzindo risco autonomamente, para o aprendizado não virar prejuízo."
4. "Sempre, quero trilha de auditoria íntegra, para eu entender qualquer decisão depois."

---

**Relacionados:** [PRD.md](./PRD.md) · [RBAC.md](./RBAC.md) · [COMPLIANCE.md](./COMPLIANCE.md) · [../MANUAL_DO_OPERADOR.md](../MANUAL_DO_OPERADOR.md)
