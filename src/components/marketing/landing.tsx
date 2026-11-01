"use client";

import Link from "next/link";
import { Icon } from "@/components/meridian/icons";

const FEATURES = [
  {
    icon: "strategy" as const,
    title: "Decisão com rastro",
    body: "Cada ordem nasce de um sinal, passa por gates de liquidez e scam score, e guarda o motivo no journal.",
  },
  {
    icon: "risk" as const,
    title: "Risco antes do lucro",
    body: "Caps de perda diária, drawdown e exposição avaliados a cada rodada. Kill switch com confirmação tipada.",
  },
  {
    icon: "analytics" as const,
    title: "Números sem enfeite",
    body: "Retorno, drawdown e atribuição por símbolo com a janela explícita. Nada é anualizado pelas suas costas.",
  },
];

export function Landing() {
  return (
    <div className="mrd mrd-mkt" data-theme="dark">
      <header className="mrd-mkt-nav">
        <Link href="/welcome" className="mrd-mkt-brand">
          <span className="mrd-logo">
            <Icon name="overview" size={16} />
          </span>
          <span>
            <b>Auto Trader</b>
            <small>MERIDIAN</small>
          </span>
        </Link>
        <nav className="mrd-mkt-links" aria-label="Sections">
          <a href="#produto">Produto</a>
          <a href="#risco">Risco</a>
          <Link href="/pricing">Planos</Link>
        </nav>
        <div className="mrd-mkt-actions">
          <Link href="/login" className="mrd-btn mrd-btn-ghost mrd-btn-sm">
            Entrar
          </Link>
          <Link href="/signup" className="mrd-btn mrd-btn-primary mrd-btn-sm">
            Criar conta
          </Link>
        </div>
      </header>

      <main>
        <section className="mrd-mkt-hero">
          <div className="mrd-mkt-eyebrow">
            <span className="mrd-dot" /> Paper trading primeiro · live só depois de 50 ciclos
          </div>
          <h1>
            O motor que mostra
            <br />
            <span className="mrd-mkt-accent">o porquê</span> de cada trade.
          </h1>
          <p>
            Auto Trader é um motor de trading multi-ativo com risco humano no comando e auditoria em cada passo. Comece em
            paper, veja a lógica trabalhar, e só então libere capital real.
          </p>
          <div className="mrd-mkt-cta">
            <Link href="/signup" className="mrd-btn mrd-btn-primary">
              Começar em paper <Icon name="up" size={15} />
            </Link>
            <Link href="/login" className="mrd-btn mrd-btn-secondary">
              Já tenho conta
            </Link>
          </div>
          <div className="mrd-mkt-trust">
            <span><Icon name="shield" size={14} /> Kill switch auditado</span>
            <span><Icon name="risk" size={14} /> Scam score antes da entrada</span>
            <span><Icon name="journal" size={14} /> Journal exportável</span>
          </div>
        </section>

        <section className="mrd-mkt-shot" aria-label="Prévia do produto">
          <div className="mrd-mkt-shot-bar">
            <span /><span /><span />
            <em>overview · mission control</em>
          </div>
          <div className="mrd-mkt-shot-body">
            <div className="mrd-mkt-shot-rail">
              {["Overview", "Markets", "Portfolio", "Strategy", "Risk", "Analytics", "Journal"].map((n, i) => (
                <div key={n} className={i === 0 ? "on" : ""}>{n}</div>
              ))}
            </div>
            <div className="mrd-mkt-shot-main">
              <div className="mrd-mkt-shot-head">
                <b>Mission control</b>
                <span className="mrd-badge">Paper</span>
              </div>
              <div className="mrd-mkt-shot-kpis">
                <div><small>Equity</small><b>$11,018.80</b><em className="mrd-pos">+9.69%</em></div>
                <div><small>Exposure</small><b>67.3%</b><em>of equity</em></div>
                <div><small>Open positions</small><b>3</b><em>$7.4K deployed</em></div>
              </div>
              <div className="mrd-mkt-shot-chart">
                <svg viewBox="0 0 560 120" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient id="mktFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--positive)" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="var(--positive)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d="M0,96 L40,90 L80,92 L120,78 L160,80 L200,66 L240,70 L280,54 L320,58 L360,40 L400,46 L440,30 L480,34 L520,22 L560,18" fill="none" stroke="var(--positive)" strokeWidth="1.6" />
                  <path d="M0,96 L40,90 L80,92 L120,78 L160,80 L200,66 L240,70 L280,54 L320,58 L360,40 L400,46 L440,30 L480,34 L520,22 L560,18 L560,120 L0,120 Z" fill="url(#mktFill)" />
                </svg>
              </div>
            </div>
          </div>
        </section>

        <section id="produto" className="mrd-mkt-features">
          {FEATURES.map((f) => (
            <article key={f.title} className="mrd-mkt-card">
              <span className="mrd-mkt-ico"><Icon name={f.icon} size={17} /></span>
              <h2>{f.title}</h2>
              <p>{f.body}</p>
            </article>
          ))}
        </section>

        <section id="risco" className="mrd-mkt-band">
          <div>
            <h2>O dinheiro é seu. O freio também.</h2>
            <p>
              O motor pode apertar limites, nunca afrouxar. Kill switch, caps de perda e revisão humana vivem no mesmo
              lugar — com registro de quem apertou.
            </p>
          </div>
          <Link href="/login" className="mrd-btn mrd-btn-secondary">
            Ver a página de risco <Icon name="up" size={15} />
          </Link>
        </section>
      </main>

      <footer className="mrd-mkt-foot">
        <span>© {new Date().getFullYear()} Auto Trader · Meridian</span>
        <nav>
          <Link href="/pricing">Planos</Link>
          <Link href="/login">Entrar</Link>
          <Link href="/signup">Criar conta</Link>
        </nav>
      </footer>
    </div>
  );
}
