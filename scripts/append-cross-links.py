#!/usr/bin/env python3
"""
Append `## Relacionado` cross-link section to all .ai/ files that need one.
Idempotent: skips files that already have the section.
"""
from pathlib import Path

AI = Path("/home/z/my-project/.ai")

# Map: file path -> list of bullet strings for `## Relacionado` section
LINKS = {
    "architecture/modules.md": [
        "`architecture/frozen-files.md` — lista canônica de FROZEN (subset desta lista).",
        "`architecture/dependencies.md` — blast radius por módulo.",
        "`architecture/interfaces.md` — contratos públicos por módulo.",
        "`architecture/runtime.md` — fluxo canônico que conecta os módulos.",
        "`PROJECT_STATE.md` — snapshot de quais módulos estão concluídos.",
        "`DECISION_LOG.md` DEC-001 a DEC-005 — decisões que congelaram módulos.",
        "`decisions/ADR-0001.md` — arquitetura defense-in-depth (H0 → M5).",
        "`MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.",
    ],
    "architecture/interfaces.md": [
        "`architecture/modules.md` — donos de cada contrato.",
        "`architecture/invariants.md` INV-001 a INV-010 — garantias que estes contratos devem preservar.",
        "`architecture/frozen-files.md` — contratos FROZEN não podem mudar (Regra 9 CORE_RULES).",
        "`contracts/api.md`, `contracts/database.md`, `contracts/rpc.md`, `contracts/events.md` — contratos de integração detalhados.",
        "`DECISION_LOG.md` DEC-001 (audit), DEC-002 (signer), DEC-003 (lease), DEC-004 (observability), DEC-005 (prefixos) — decisões que fixaram estes contratos.",
        "`standards/coding-style.md` STD-005 (errors), STD-009 (JSDoc) — estilo aplicado a estas interfaces.",
        "`MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.",
    ],
    "architecture/runtime.md": [
        "`architecture/modules.md` — módulos envolvidos no fluxo.",
        "`architecture/interfaces.md` — assinaturas de `Pipeline.process()`, `Broadcaster.broadcast()`, etc.",
        "`architecture/invariants.md` INV-001 (ordem pipeline), INV-002 (broadcaster imutável), INV-005 (audit exactly-once).",
        "`contracts/events.md` — eventos emitidos em cada etapa do runtime.",
        "`contracts/rpc.md` — IPC entre engine e signer (M3.2).",
        "`DECISION_LOG.md` DEC-004 — ordem canônica de execução M5.",
        "`decisions/ADR-0001.md` — arquitetura defense-in-depth com fluxo H0 → M5.",
        "`PROJECT_STATE.md` — snapshot do fluxo corrente.",
        "`MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.",
    ],
    "architecture/dependencies.md": [
        "`architecture/modules.md` — lista completa de módulos.",
        "`architecture/frozen-files.md` — módulos FROZEN têm dependências travadas.",
        "`architecture/interfaces.md` — contratos que definem as dependências.",
        "`CORE_RULES.md` Regra 6 — identificar dependentes antes de alterar.",
        "`ENGINEERING_RULES.md` — mapear dependências é etapa obrigatória do fluxo.",
        "`DECISION_LOG.md` DEC-005 — exemplo de mudança que tocou dependência (Broadcaster → LeasedBroadcaster).",
        "`memory/technical-debt.md` TD-001 — duplicação chain/runtime.ts vs runtime/runtime.ts.",
        "`MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.",
    ],
    "architecture/invariants.md": [
        "`architecture/interfaces.md` — contratos públicos que implementam os invariantes.",
        "`architecture/frozen-files.md` — arquivos cuja alteração exigiria quebrar um invariante.",
        "`standards/security.md` STD-203 a STD-205 — implementação técnica dos invariantes.",
        "`standards/testing.md` STD-102 — testes adversariais validam cada invariante.",
        "`DECISION_LOG.md` DEC-001 a DEC-005 — decisões que estabeleceram invariantes.",
        "`decisions/ADR-0001.md` — arquitetura cujos invariantes são garantidos por H0–M5.",
        "`SECURITY.md` (raiz do projeto) — REG-NNN adversariais que testam os invariantes.",
        "`memory/known-problems.md` KP-001 a KP-011 — bugs que expuseram invariantes.",
        "`MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.",
    ],
    "architecture/frozen-files.md": [
        "`architecture/modules.md` — lista de módulos (coluna FROZEN).",
        "`architecture/invariants.md` INV-003 — FROZEN não pode mudar sem ADR.",
        "`CORE_RULES.md` Regra 8 — lei que define FROZEN.",
        "`ENGINEERING_RULES.md` > Restrições — não mover/renomear módulos FROZEN.",
        "`DECISION_LOG.md` — toda entrada de congelamento fica registrada aqui.",
        "`PROJECT_STATE.md` — snapshot com tabela de módulos FROZEN.",
        "`decisions/ADR-0001.md` — justificativa arquitetural do conjunto H0–M5 FROZEN.",
        "`MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.",
    ],
    "architecture/roadmap.md": [
        "`PROJECT_STATE.md` — snapshot do milestone corrente.",
        "`memory/implementation-history.md` — linha do tempo de conclusão de fases.",
        "`DECISION_LOG.md` DEC-004 — ordem das sub-fases M5.",
        "`decisions/ADR-0001.md` — arquitetura que o roadmap valida.",
        "`HARDENING-ROADMAP.md` (raiz do projeto) — mapeia 30 attack vectors às fases.",
        "`memory/future-ideas.md` FI-NNN — candidatos a futuros milestones.",
        "`memory/technical-debt.md` TD-002 — bloqueador do M6 (Vault/KMS).",
        "`MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.",
    ],
    "contracts/api.md": [
        "`architecture/interfaces.md` — assinaturas TypeScript canônicas.",
        "`contracts/events.md` — eventos emitidos por estes endpoints.",
        "`standards/security.md` STD-201.2 — least privilege em API.",
        "`standards/documentation.md` STD-302 — padrão de documentação de API.",
        "`CORE_RULES.md` Regra 9 — breaking changes exigem DEC-NNN.",
        "`DECISION_LOG.md` — registrar breaking changes de API.",
        "`memory/technical-debt.md` TD-007 — documentação OpenAPI pendente.",
        "`MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.",
    ],
    "contracts/database.md": [
        "`contracts/events.md` — eventos que tocam estas tabelas.",
        "`architecture/invariants.md` INV-005 — audit exactly-once (AuditLog table).",
        "`standards/security.md` STD-202 — segredos não são armazenados em banco.",
        "`CORE_RULES.md` Regra 9 — schema changes são breaking changes.",
        "`memory/technical-debt.md` TD-003 — possível migração SQLite → Postgres.",
        "`prisma/schema.prisma` (raiz do projeto) — fonte canônica do schema.",
        "`MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.",
    ],
    "contracts/rpc.md": [
        "`architecture/interfaces.md` — SignerSink e SignerProtocol.",
        "`architecture/invariants.md` INV-006 — signer nunca expõe chave privada.",
        "`standards/security.md` STD-204 — signer isolation.",
        "`DECISION_LOG.md` DEC-002 — signer isolado em processo próprio.",
        "`decisions/ADR-0001.md` — arquitetura que justifica o protocolo IPC.",
        "`docs/signer-isolation-design.md` (raiz do projeto) — design detalhado.",
        "`MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.",
    ],
    "contracts/events.md": [
        "`contracts/api.md` — endpoints que emitem estes eventos.",
        "`contracts/database.md` — tabelas que persistem estes eventos.",
        "`architecture/runtime.md` — lifecycle dos eventos.",
        "`architecture/invariants.md` INV-005 — audit exactly-once.",
        "`DECISION_LOG.md` DEC-001 — hash-chain do audit log.",
        "`MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.",
    ],
    "memory/implementation-history.md": [
        "`PROJECT_STATE.md` — snapshot atual (referência cruzada com esta linha do tempo).",
        "`DECISION_LOG.md` DEC-NNN — decisões citadas nas entradas.",
        "`decisions/ADR-*.md` — ADRs citados nas entradas.",
        "`memory/known-problems.md` KP-NNN — bugs registrados após cada fase.",
        "`memory/technical-debt.md` TD-NNN — débitos identificados em cada fase.",
        "`architecture/roadmap.md` — fases canônicas referenciadas.",
        "`worklog.md` (raiz do projeto) — log operacional contínuo.",
        "`MANIFEST.md` — princípios do Project OS (append-only, fonte única).",
    ],
    "memory/known-problems.md": [
        "`memory/technical-debt.md` TD-NNN — bugs em aberto viram débito.",
        "`DECISION_LOG.md` DEC-001 (KP-001), DEC-005 (KP-002) — decisões originadas destes bugs.",
        "`standards/security.md` STD-203, STD-205 — padrões derivados destes incidentes.",
        "`SECURITY.md` (raiz do projeto) REG-NNN — testes adversariais que pinnam as correções.",
        "`memory/implementation-history.md` — quando cada KP foi registrado.",
        "`CORE_RULES.md` Regra 11 — todo bug deve produzir aprendizado.",
        "`MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.",
    ],
    "memory/technical-debt.md": [
        "`memory/known-problems.md` KP-NNN — bugs em observação podem virar débito.",
        "`architecture/roadmap.md` — fases que podem pagar estes débitos.",
        "`DECISION_LOG.md` — decisões deliberadas (TD-011, TD-012) são registradas aqui.",
        "`ENGINEERING_RULES.md` > Restrições — diretrizes para avaliar novos débitos.",
        "`PROJECT_STATE.md` — snapshot atual dos débitos pendentes.",
        "`MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.",
    ],
    "memory/future-ideas.md": [
        "`architecture/roadmap.md` — ideias promovidas a milestone.",
        "`DECISION_LOG.md` — toda promoção de FI-NNN a milestone produz entrada aqui.",
        "`memory/implementation-history.md` — registro de quando cada ideia foi promovida.",
        "`MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.",
    ],
    "context/terminology.md": [
        "`context/glossary.md` — referência externa (blockchain, trading, etc.).",
        "`context/conventions.md` — convenções de nomenclatura derivadas destes termos.",
        "`architecture/modules.md` — nomes oficiais dos módulos.",
        "`architecture/interfaces.md` — tipos que usam estes nomes.",
        "`MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.",
    ],
    "context/conventions.md": [
        "`context/terminology.md` — nomes oficiais usados nas convenções.",
        "`standards/coding-style.md` STD-001, STD-008 — convenções de código.",
        "`standards/git-workflow.md` STD-402 — convenções de branch.",
        "`architecture/modules.md` — aplicação das convenções aos módulos.",
        "`MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.",
    ],
    "context/glossary.md": [
        "`context/terminology.md` — termos internos do projeto (não duplicar aqui).",
        "`context/project-summary.md` — visão geral usando estes termos.",
        "`contracts/rpc.md` — termos de RPC/blockchain.",
        "`standards/security.md` — termos de segurança.",
        "`MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.",
    ],
}


def append_section(file_path: Path, bullets: list[str]) -> str:
    """Append `## Relacionado` section. Return status string."""
    if not file_path.exists():
        return f"SKIP (not found): {file_path}"

    content = file_path.read_text(encoding="utf-8")
    if "## Relacionado" in content:
        return f"SKIP (already has section): {file_path}"

    section = "\n---\n\n## Relacionado\n\n"
    for b in bullets:
        section += f"- {b}\n"
    section += "\n"

    # Append with a clean separator
    file_path.write_text(content.rstrip() + "\n" + section, encoding="utf-8")
    return f"OK: {file_path}"


def main():
    for rel_path, bullets in LINKS.items():
        full = AI / rel_path
        print(append_section(full, bullets))


if __name__ == "__main__":
    main()
