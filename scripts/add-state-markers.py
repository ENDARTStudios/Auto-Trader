#!/usr/bin/env python3
"""
Add STATE: FROZEN | ACTIVE | DRAFT | APPEND-ONLY | SNAPSHOT markers
to the header of critical .ai/ governance documents.

State vocabulary:
- FROZEN       — immutable; change requires ADR + operator approval.
- ACTIVE       — living document; evolves with the project.
- DRAFT        — work in progress; not yet authoritative.
- APPEND-ONLY  — entries may be added, never removed or edited.
- SNAPSHOT     — reflects current state only; replaced, not edited.

Idempotent: if a STATE marker is already present, the file is skipped.
"""

import os
import re
import sys
from pathlib import Path

AI_DIR = Path("/home/z/my-project/.ai")

# (relative_path, state, description) — description appears in the marker block.
TARGETS = [
    # Root files
    ("MANIFEST.md",              "FROZEN",      "Declaração de princípios do Project OS."),
    ("README.md",                "ACTIVE",      "Índice mínimo — reindexado quando estrutura muda."),
    ("INDEX.md",                 "ACTIVE",      "Índice completo — reindexado quando arquivos mudam."),
    ("CHECKLIST.md",             "ACTIVE",      "Checklist operacional — refinável conforme processo evolui."),
    ("CORE_RULES.md",            "FROZEN",      "Regras permanentes (imutáveis por princípio)."),
    ("ENGINEERING_RULES.md",     "ACTIVE",      "Regras operacionais (refináveis)."),
    ("PROMPTING_RULES.md",       "FROZEN",      "Regras permanentes de cognição do agente."),
    ("OUTPUT_RULES.md",          "FROZEN",      "Regras permanentes de formato de resposta."),
    ("PROJECT_STATE.md",         "SNAPSHOT",    "Snapshot puro — reescrito a cada mudança de estado."),
    ("DECISION_LOG.md",          "APPEND-ONLY", "Entradas DEC-NNN nunca removidas; reversão = nova entrada."),
    ("TASK_TEMPLATE.md",         "ACTIVE",      "Template — refinável conforme padrões evoluem."),
    # Architecture
    ("architecture/modules.md",         "ACTIVE", "Catálogo evolui conforme módulos são adicionados."),
    ("architecture/interfaces.md",      "ACTIVE", "Contratos públicos — novos adicionados, existentes preservados."),
    ("architecture/runtime.md",         "FROZEN", "Fluxo canônico — alteração requer ADR (suporta INV-001)."),
    ("architecture/dependencies.md",    "ACTIVE", "Mapa de dependências evolui com novos módulos."),
    ("architecture/invariants.md",      "FROZEN", "Garantias arquiteturais — alteração requer ADR."),
    ("architecture/frozen-files.md",    "ACTIVE", "Lista canônica — transições FROZEN↔ACTIVE registradas em DEC-NNN."),
    ("architecture/roadmap.md",         "ACTIVE", "Roadmap — fases concluídas são append-only; futuras podem mudar."),
    # Contracts
    ("contracts/api.md",         "FROZEN", "Contrato HTTP — breaking change requer ADR + bump."),
    ("contracts/database.md",    "FROZEN", "Schema Prisma — migrations reversíveis apenas."),
    ("contracts/events.md",      "FROZEN", "Contrato de eventos — adição ok; remoção/rename requer ADR."),
    ("contracts/rpc.md",         "FROZEN", "Contrato RPC + IPC signer — binário breaking change requer ADR."),
    # Standards
    ("standards/coding-style.md",    "ACTIVE", "Padrões de estilo — refináveis com novas lições."),
    ("standards/testing.md",         "ACTIVE", "Padrões de teste — refináveis com novos REG-NNN."),
    ("standards/security.md",        "ACTIVE", "Padrões de segurança — refináveis com novos attack vectors."),
    ("standards/documentation.md",   "ACTIVE", "Padrões de documentação — refináveis."),
    ("standards/git-workflow.md",    "ACTIVE", "Padrões de git — refináveis."),
    # Context
    ("context/project-summary.md", "FROZEN", "Identidade do projeto — mudança exige ADR."),
    ("context/terminology.md",     "ACTIVE", "Termos podem ser adicionados; rename requer ADR."),
    ("context/conventions.md",     "ACTIVE", "Convenções evoluem com o código."),
    ("context/glossary.md",        "ACTIVE", "Dicionário — adições ok; remoção de termo obsoleto requer nota."),
    # Memory
    ("memory/implementation-history.md", "APPEND-ONLY", "Linha do tempo cronológica — nunca editar entradas antigas."),
    ("memory/known-problems.md",         "APPEND-ONLY", "KP-NNN resolvido ganha nota; nunca removido."),
    ("memory/technical-debt.md",         "APPEND-ONLY", "TD-NNN pago ganha nota; nunca removido."),
    ("memory/future-ideas.md",           "APPEND-ONLY", "FI-NNN implementado ganha nota; nunca removido."),
    # Decisions
    ("decisions/ADR-0001.md", "APPEND-ONLY", "ADR — supersedure via novo ADR, nunca editado."),
    ("decisions/ADR-0002.md", "APPEND-ONLY", "ADR — supersedure via novo ADR, nunca editado."),
]


def add_marker(path: Path, state: str, description: str) -> tuple[bool, str]:
    """Add a STATE marker block right after the H1 title.
    Returns (modified, message)."""
    text = path.read_text(encoding="utf-8")
    if "STATE: " in text and f"STATE: {state}" in text:
        return False, f"skip (already has STATE: {state})"

    # Find the first H1 line.
    lines = text.split("\n")
    h1_idx = None
    for i, line in enumerate(lines):
        if line.startswith("# "):
            h1_idx = i
            break

    if h1_idx is None:
        return False, "skip (no H1 found)"

    # Build the marker block.
    marker_lines = [
        "",
        f"> **STATE: {state}** — {description}",
        f"> Mudança de estado requer entrada em `memory/implementation-history.md`",
        f"> e, se estrutural, novo ADR em `decisions/ADR-NNNN.md`.",
    ]

    new_lines = lines[: h1_idx + 1] + marker_lines + lines[h1_idx + 1 :]
    path.write_text("\n".join(new_lines), encoding="utf-8")
    return True, f"marked STATE: {state}"


def main() -> int:
    if not AI_DIR.exists():
        print(f"ERROR: {AI_DIR} not found", file=sys.stderr)
        return 1

    total = 0
    modified = 0
    skipped = 0
    missing = 0

    for rel, state, desc in TARGETS:
        total += 1
        p = AI_DIR / rel
        if not p.exists():
            print(f"  MISSING: {rel}")
            missing += 1
            continue
        ok, msg = add_marker(p, state, desc)
        if ok:
            modified += 1
            print(f"  + {rel}: {msg}")
        else:
            skipped += 1
            print(f"  - {rel}: {msg}")

    print()
    print(f"Total: {total}  Modified: {modified}  Skipped: {skipped}  Missing: {missing}")
    return 0 if missing == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
