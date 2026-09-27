# Network Access Control (NAC)

> Esqueleto criado na reorganizacao F16 (2026-09-28) e validado com metadata minima (T088).

## Objetivo

Controle de acesso de rede: segmentacao, allowlists de IP e protecao de endpoints de admin.

## Escopo

Esqueletizado na reorganizacao F16 (2026-09-28). Endpoints de admin protegidos por RBAC; NAC de rede pendente.

## Status

Esqueleto validado T088; politica pendente

## Owner/Responsavel

DevOps + Operador

## Proximas Acoes

Definir politica de allowlist por role; configurar WAF para endpoints sensiveis (kill-switch, reserve/withdraw).

## Referencias

- `docs/05-security-compliance/WAF_RATE_LIMIT.md`
- `docs/05-security-compliance/RBAC.md`
