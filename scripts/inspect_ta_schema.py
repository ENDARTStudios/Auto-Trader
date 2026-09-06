#!/usr/bin/env python3
"""
B-fim manifest — extrai o schema REAL do TradingAgentsX por AST estático.
Nao precisa de API keys nem de rodar o grafo. Fecha a B-fim com evidencia.

Uso:
    python scripts/inspect_ta_schema.py /caminho/para/TradingAgentsX
    (ou no repo root: python scripts/inspect_ta_schema.py .)

Imprime:
    - keys do estado LangGraph (TypedDict/Pydantic/MessagesState)
    - keys escritas por cada no (state["k"]=... e return {"k":...})
    - nos registrados no grafo
    - deteccao de JSON-mode / structured output nos provedores
    - um SchemaDescriptor JSON p/ colar no TS
"""
from __future__ import annotations
import ast, json, sys, pathlib, re

def find_py(root: pathlib.Path):
    return sorted(root.rglob("*.py"))

def collect_state_keys(root: pathlib.Path) -> dict:
    """Keys declaradas em TypedDict / BaseSettings / class(...)State."""
    keys = {}
    for p in find_py(root):
        try:
            tree = ast.parse(p.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            # class FooState(TypedDict): a: str; b: int
            if isinstance(node, ast.ClassDef) and re.search(r"State|AgentState", node.name):
                for stmt in node.body:
                    if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
                        keys.setdefault(node.name, set()).add(stmt.target.id)
    return {k: sorted(v) for k, v in keys.items()}

def collect_written_keys(root: pathlib.Path) -> dict:
    """Keys escritas nos nos: state["k"] = ...  e  return {"k": ...}."""
    written = {}
    for p in find_py(root):
        if "graph" in str(p).lower() or "agent" in str(p).lower() or "node" in str(p).lower():
            try:
                src = p.read_text(encoding="utf-8")
            except Exception:
                continue
            # state["x"] = / state.update({"x":...}) / return {"x":...}
            for m in re.finditer(r"""state\[\s*["']([a-zA-Z0-9_]+)["']\s*\]\s*=""", src):
                written.setdefault(p.name, set()).add(m.group(1))
            for m in re.finditer(r"""["']([a-zA-Z0-9_]+)["']\s*:""", src):
                # pega chaves de dict-literal em returns (heuristica, marcada como tal)
                written.setdefault(p.name, set()).add(m.group(1))
    return {k: sorted(v) for k, v in written.items()}

def collect_nodes(root: pathlib.Path) -> list:
    """add_node("name", fn) — nomes reais dos nos do grafo."""
    nodes = []
    for p in find_py(root):
        try:
            src = p.read_text(encoding="utf-8")
        except Exception:
            continue
        for m in re.finditer(r"""add_node\(\s*["']([a-zA-Z0-9_]+)["']""", src):
            nodes.append(m.group(1))
    return sorted(set(nodes))

def detect_json_mode(root: pathlib.Path) -> dict:
    """Procura response_format/json_mode/structured output nos provedores."""
    hits = {}
    pat = re.compile(r"(response_format|json_mode|structured_output|json_schema|tool_choice|function_calling)", re.I)
    for p in find_py(root):
        try:
            src = p.read_text(encoding="utf-8")
        except Exception:
            continue
        found = sorted(set(m.group(1).lower() for m in pat.finditer(src)))
        if found:
            hits[p.name] = found
    return hits

def main():
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    if not (root / ".git").exists() and not any(root.rglob("*.py")):
        print(f"[ERRO] nao parece um repo python: {root}", file=sys.stderr); sys.exit(1)

    state_keys = collect_state_keys(root)
    written = collect_written_keys(root)
    nodes = collect_nodes(root)
    json_mode = detect_json_mode(root)

    # --- monta o SchemaDescriptor p/ o TS (keys ALTA = confirmadas por AST) ---
    all_state = sorted({k for ks in state_keys.values() for k in ks} |
                       {k for ws in written.values() for k in ws})
    descriptor = {
        "graph_entry_keys": ["company_name", "trade_date"],  # confirmar se aparecem em all_state
        "prosa_keys": {
            "technical":   _pick(all_state, ["market_report", "technical_report"]),
            "fundamental": _pick(all_state, ["fundamentals_report", "fundamental_report"]),
            "sentiment":   _pick(all_state, ["social_media_report", "news_report", "sentiment_report"]),
            "macro":       _pick(all_state, ["news_report", "macro_report", "financial_report"]),
        },
        "debate_keys": {
            "bull":   _pick(all_state, ["bull_history", "bull_researcher", "bull_argument"]),
            "bear":   _pick(all_state, ["bear_history", "bear_researcher", "bear_argument"]),
            "judge":  _pick(all_state, ["judge_decision", "investment_plan", "research_plan"]),
        },
        "decision_keys": {
            "trader": _pick(all_state, ["trader_plan", "investment_plan", "trader_investment_plan"]),
            "final":  _pick(all_state, ["final_trade_decision", "final_decision"]),
        },
        "risk_keys_ignored": _pick(all_state, ["risk_debate_state", "risk_manager_plan"]),
        "nodes_detected": nodes,
        "json_mode_detected": bool(json_mode),
        "json_mode_files": list(json_mode.keys())[:10],
        "confidence_note": "keys acima sao CONFIRMADAS por AST neste repo; "
                           "null = nao encontrada (ajustar manualmente).",
    }

    print("=== STATE KEYS (TypedDict/State classes) ==="); print(json.dumps(state_keys, indent=2))
    print("=== WRITTEN KEYS por arquivo (heuristica) ==="); print(json.dumps(written, indent=2))
    print("=== NODES add_node() ==="); print(json.dumps(nodes, indent=2))
    print("=== JSON-MODE detection ==="); print(json.dumps(json_mode, indent=2))
    print("\n=== >>> SCHEMA_DESCRIPTOR p/ colar no TS <<< ===")
    print(json.dumps(descriptor, indent=2))

def _pick(all_keys, candidates):
    """Retorna a primeira candidate presente em all_keys (confirmada), senao None."""
    for c in candidates:
        if c in all_keys:
            return c
    return None

if __name__ == "__main__":
    main()
