// Site integrity checker — verifies that a project's website is safe before
// we even consider trading its token.
//
// Layers:
//   1. SSL/TLS — is the certificate valid? When does it expire?
//   2. Domain age — fresh domains (<30 days) are a strong scam signal. We
//      query IANA's RDAP bootstrap (free, no auth, no rate limit issue) to
//      get the registration date.
//   3. HTTP security headers — HSTS / CSP / X-Frame-Options presence.
//      Legitimate crypto projects almost always ship these. Missing all 3 is
//      a yellow flag.
//   4. Safe Browsing — Google's Safe Browsing v4 API (free, requires API key
//      but ANY Google API key works, no special enrollment). If no key is
//      configured, we skip this check and rely on the other layers.
//   5. Content red flags — fetch the HTML and grep for known scam patterns:
//      "enter seed phrase", "send ETH to receive", "connect wallet to claim",
//      password inputs asking for mnemonic, etc.
//
// This is best-effort. A scam site can pass all checks (valid SSL is $10,
// domain age can be bought, headers can be copy-pasted). But each layer
// eliminates a class of low-effort scams.

import { logger } from "./logger";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SiteAuditResult {
  url: string;
  score: number; // 0-100 (100 = cleanest)
  passed: boolean;
  sslScore: number;
  domainAgeScore: number;
  headersScore: number;
  safeBrowsingScore: number;
  contentScore: number;
  sslValid: boolean;
  sslDaysToExpiry: number | null;
  domainAgeDays: number | null;
  hstsPresent: boolean;
  cspPresent: boolean;
  xfoPresent: boolean;
  safeBrowsingFlagged: boolean;
  redFlags: string[];
  findings: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// 1. SSL check via Node's tls module
// ---------------------------------------------------------------------------
import tls from "tls";
import https from "https";

function checkSsl(hostname: string): Promise<{
  valid: boolean;
  daysToExpiry: number | null;
  error: string | null;
}> {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: hostname,
      port: 443,
      servername: hostname,
      rejectUnauthorized: true,
    }, () => {
      const cert = socket.getPeerCertificate();
      if (!cert || Object.keys(cert).length === 0) {
        socket.destroy();
        resolve({ valid: false, daysToExpiry: null, error: "Sem certificado" });
        return;
      }
      const validTo = new Date(cert.valid_to).getTime();
      const days = Math.floor((validTo - Date.now()) / 86_400_000);
      socket.destroy();
      resolve({ valid: true, daysToExpiry: days, error: null });
    });
    socket.setTimeout(6000, () => {
      socket.destroy();
      resolve({ valid: false, daysToExpiry: null, error: "Timeout SSL" });
    });
    socket.on("error", (err) => {
      resolve({ valid: false, daysToExpiry: null, error: String(err.message ?? err) });
    });
  });
}

// ---------------------------------------------------------------------------
// 2. Domain age via RDAP (free, no auth)
// ---------------------------------------------------------------------------
async function checkDomainAge(
  hostname: string
): Promise<{ days: number | null; error: string | null }> {
  try {
    // IANA RDAP bootstrap — redirects to the right RDAP server
    const url = `https://rdap.org/domain/${hostname}`;
    const resp = await fetch(url, {
      headers: { Accept: "application/rdap+json" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!resp.ok) {
      return { days: null, error: `RDAP HTTP ${resp.status}` };
    }
    const json = (await resp.json()) as {
      events?: Array<{ eventAction: string; eventDate: string }>;
    };
    const registration = json.events?.find((e) => e.eventAction === "registration");
    if (!registration) {
      return { days: null, error: "Sem data de registration no RDAP" };
    }
    const regDate = new Date(registration.eventDate).getTime();
    const days = Math.floor((Date.now() - regDate) / 86_400_000);
    return { days, error: null };
  } catch (err) {
    return { days: null, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// 3. HTTP security headers + 5. content red flags — done in a single fetch
// ---------------------------------------------------------------------------
const RED_FLAG_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /seed\s*phrase/i, label: "Página menciona 'seed phrase'" },
  { pattern: /mnemonic/i, label: "Página menciona 'mnemonic'" },
  { pattern: /private\s*key/i, label: "Página menciona 'private key'" },
  { pattern: /send\s+(eth|btc|usdt|sol)\s+to\s+receive/i, label: "Padrão 'send X to receive' (clássico de giveaway scam)" },
  { pattern: /connect\s+wallet\s+to\s+(claim|receive|verify)/i, label: "Connect wallet para claim/receive — padrão de drainer" },
  { pattern: /verify\s+your\s+(wallet|metamask)/i, label: "Verify your wallet — drainer pattern" },
  { pattern: /airdrop\s+claim\s+now/i, label: "Airdrop claim agressivo (suspeito)" },
  { pattern: /double\s+your\s+(eth|btc|sol)/i, label: "Promessa de dobrar cripto (giveaway scam)" },
  { pattern: /<input[^>]*type=["']password["'][^>]*name=["'](mnemonic|seed|private|recovery)/i, label: "Input de password pedindo mnemonic/seed/private key" },
];

async function checkHeadersAndContent(
  url: string
): Promise<{
  headers: { hsts: boolean; csp: boolean; xfo: boolean; raw: Record<string, string> };
  content: { redFlags: string[]; title: string | null; htmlLength: number };
  error: string | null;
}> {
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
      headers: {
        // Use a real-browser User-Agent so Cloudflare/Akamai WAFs don't return
        // a 0-byte challenge page (which we'd incorrectly flag as "drainer stub").
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
    });
    const headers: Record<string, string> = {};
    resp.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const html = await resp.text();
    const titleMatch = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : null;

    const redFlags: string[] = [];
    for (const { pattern, label } of RED_FLAG_PATTERNS) {
      if (pattern.test(html)) {
        redFlags.push(label);
      }
    }
    // Suspiciously short page → likely a stub or redirect drainer
    if (html.length < 500) {
      redFlags.push(`Página extremamente curta (${html.length} bytes) — possivel drainer stub`);
    }
    return {
      headers: {
        hsts: !!headers["strict-transport-security"],
        csp: !!headers["content-security-policy"],
        xfo: !!headers["x-frame-options"],
        raw: headers,
      },
      content: { redFlags, title, htmlLength: html.length },
      error: null,
    };
  } catch (err) {
    return {
      headers: { hsts: false, csp: false, xfo: false, raw: {} },
      content: { redFlags: [], title: null, htmlLength: 0 },
      error: String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// 4. Google Safe Browsing v4 (optional — needs GOOGLE_SAFE_BROWSING_KEY env)
// ---------------------------------------------------------------------------
async function checkSafeBrowsing(url: string): Promise<{
  flagged: boolean;
  error: string | null;
  skipped: boolean;
}> {
  const apiKey = process.env.GOOGLE_SAFE_BROWSING_KEY;
  if (!apiKey) {
    return { flagged: false, error: null, skipped: true };
  }
  try {
    const endpoint = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`;
    const body = {
      client: { clientId: "auto-trader", clientVersion: "1.0.0" },
      threatInfo: {
        threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
        platformTypes: ["ANY_PLATFORM"],
        threatEntryTypes: ["URL"],
        threatEntries: [{ url }],
      },
    };
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      return { flagged: false, error: `Safe Browsing HTTP ${resp.status}`, skipped: false };
    }
    const json = (await resp.json()) as { matches?: unknown[] };
    return {
      flagged: !!(json.matches && json.matches.length > 0),
      error: null,
      skipped: false,
    };
  } catch (err) {
    return { flagged: false, error: String(err), skipped: false };
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
export async function auditSite(
  url: string,
  metadata?: { symbol?: string; tokenId?: string; chain?: string }
): Promise<SiteAuditResult> {
  const findings: Record<string, string[]> = {
    ssl: [],
    domain_age: [],
    headers: [],
    safe_browsing: [],
    content: [],
  };
  const redFlags: string[] = [];

  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // Not a URL — abort with all-zero scores
    return {
      url,
      score: 0,
      passed: false,
      sslScore: 0,
      domainAgeScore: 0,
      headersScore: 0,
      safeBrowsingScore: 0,
      contentScore: 0,
      sslValid: false,
      sslDaysToExpiry: null,
      domainAgeDays: null,
      hstsPresent: false,
      cspPresent: false,
      xfoPresent: false,
      safeBrowsingFlagged: false,
      redFlags: ["URL inválida"],
      findings: { url_parse: ["URL não pôde ser parseada"] },
    };
  }

  // 1. SSL
  let sslScore = 0;
  let sslValid = false;
  let sslDaysToExpiry: number | null = null;
  const sslResult = await checkSsl(hostname);
  if (sslResult.valid) {
    sslValid = true;
    sslDaysToExpiry = sslResult.daysToExpiry;
    if (sslDaysToExpiry !== null) {
      if (sslDaysToExpiry >= 30) {
        sslScore = 100;
        findings.ssl.push(`✓ SSL válido, expira em ${sslDaysToExpiry}d`);
      } else if (sslDaysToExpiry >= 7) {
        sslScore = 60;
        findings.ssl.push(`⚠️ SSL expira em ${sslDaysToExpiry}d (renovar urgente)`);
      } else {
        sslScore = 30;
        findings.ssl.push(`⚠️ SSL expira em ${sslDaysToExpiry}d (crítico)`);
      }
    } else {
      sslScore = 90;
      findings.ssl.push("✓ SSL válido");
    }
  } else {
    sslScore = 0;
    redFlags.push(`SSL inválido: ${sslResult.error}`);
    findings.ssl.push(`✗ SSL inválido: ${sslResult.error}`);
  }

  // 2. Domain age
  let domainAgeScore = 50;
  let domainAgeDays: number | null = null;
  const ageResult = await checkDomainAge(hostname);
  if (ageResult.days !== null) {
    domainAgeDays = ageResult.days;
    if (domainAgeDays >= 365) {
      domainAgeScore = 100;
      findings.domain_age.push(`✓ Domínio tem ${(domainAgeDays / 365).toFixed(1)} anos`);
    } else if (domainAgeDays >= 90) {
      domainAgeScore = 80;
      findings.domain_age.push(`✓ Domínio tem ${domainAgeDays}d (~${(domainAgeDays / 30).toFixed(0)} meses)`);
    } else if (domainAgeDays >= 30) {
      domainAgeScore = 50;
      findings.domain_age.push(`⚠️ Domínio jovem: ${domainAgeDays}d`);
    } else if (domainAgeDays >= 7) {
      domainAgeScore = 20;
      redFlags.push(`Domínio muito jovem: ${domainAgeDays}d`);
      findings.domain_age.push(`⚠️ Domínio muito jovem: ${domainAgeDays}d`);
    } else {
      domainAgeScore = 0;
      redFlags.push(`Domínio criado há apenas ${domainAgeDays}d — altíssimo risco de scam`);
      findings.domain_age.push(`✗ Domínio criado há ${domainAgeDays}d (scam provável)`);
    }
  } else {
    findings.domain_age.push(`Idade do domínio indisponível: ${ageResult.error}`);
  }

  // 3 + 5. Headers + content
  let headersScore = 50;
  let hstsPresent = false;
  let cspPresent = false;
  let xfoPresent = false;
  let contentScore = 100;
  const hcResult = await checkHeadersAndContent(url.startsWith("http") ? url : `https://${url}`);
  if (hcResult.error) {
    findings.headers.push(`Erro ao buscar headers: ${hcResult.error}`);
    headersScore = 30;
  } else {
    hstsPresent = hcResult.headers.hsts;
    cspPresent = hcResult.headers.csp;
    xfoPresent = hcResult.headers.xfo;
    const present = [hstsPresent, cspPresent, xfoPresent].filter(Boolean).length;
    if (present === 3) {
      headersScore = 100;
      findings.headers.push("✓ HSTS + CSP + X-Frame-Options presentes");
    } else if (present === 2) {
      headersScore = 70;
      findings.headers.push(`⚠️ Apenas 2/3 security headers (${present})`);
    } else if (present === 1) {
      headersScore = 40;
      findings.headers.push(`⚠️ Apenas 1/3 security headers (${present})`);
    } else {
      headersScore = 10;
      findings.headers.push("✗ Nenhum security header presente");
    }
  }
  if (hcResult.content.title) {
    findings.content.push(`Título da página: "${hcResult.content.title}"`);
  }
  if (hcResult.content.redFlags.length > 0) {
    contentScore = Math.max(0, 100 - hcResult.content.redFlags.length * 25);
    for (const flag of hcResult.content.redFlags) {
      redFlags.push(flag);
      findings.content.push(`✗ ${flag}`);
    }
  } else {
    findings.content.push("✓ Nenhum padrão suspeito no HTML");
  }

  // 4. Safe Browsing
  let safeBrowsingScore = 100;
  let safeBrowsingFlagged = false;
  const sbResult = await checkSafeBrowsing(url);
  if (sbResult.skipped) {
    safeBrowsingScore = 75; // neutral-ish when not configured
    findings.safe_browsing.push("ℹ️ Google Safe Browsing não configurado (sem GOOGLE_SAFE_BROWSING_KEY)");
  } else if (sbResult.flagged) {
    safeBrowsingScore = 0;
    safeBrowsingFlagged = true;
    redFlags.push("Google Safe Browsing marcou como ameaça");
    findings.safe_browsing.push("✗ Safe Browsing: AMEAÇA detectada");
  } else if (sbResult.error) {
    safeBrowsingScore = 70;
    findings.safe_browsing.push(`Safe Browsing erro: ${sbResult.error}`);
  } else {
    safeBrowsingScore = 100;
    findings.safe_browsing.push("✓ Safe Browsing limpo");
  }

  // Composite (weighted): content red flags are critical, so weight heaviest
  const composite =
    sslScore * 0.20 +
    domainAgeScore * 0.25 +
    headersScore * 0.10 +
    safeBrowsingScore * 0.15 +
    contentScore * 0.30;
  const score = Math.round(composite);
  const passed = score >= 60 && redFlags.length === 0 && !safeBrowsingFlagged;

  const result: SiteAuditResult = {
    url,
    score,
    passed,
    sslScore,
    domainAgeScore,
    headersScore,
    safeBrowsingScore,
    contentScore,
    sslValid,
    sslDaysToExpiry,
    domainAgeDays,
    hstsPresent,
    cspPresent,
    xfoPresent,
    safeBrowsingFlagged,
    redFlags,
    findings,
  };

  // Persist
  try {
    await db.siteAudit.create({
      data: {
        url,
        symbol: metadata?.symbol ?? null,
        tokenId: metadata?.tokenId ?? null,
        chain: metadata?.chain ?? null,
        score,
        passed,
        sslScore,
        domainAgeScore,
        headersScore,
        safeBrowsingScore,
        contentScore,
        sslValid,
        sslDaysToExpiry: sslDaysToExpiry ?? null,
        domainAgeDays: domainAgeDays ?? null,
        hstsPresent,
        cspPresent,
        xfoPresent,
        safeBrowsingFlagged,
        redFlags: JSON.stringify(redFlags),
        findings: JSON.stringify(findings),
      },
    });
  } catch (err) {
    logger.error("site", `Erro persistindo SiteAudit: ${String(err)}`);
  }

  logger.info("site", `Audit ${url} score=${score} passed=${passed} redFlags=${redFlags.length}`);
  return result;
}
