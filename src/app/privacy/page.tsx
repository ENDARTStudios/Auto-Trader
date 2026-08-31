import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade — Auto Trader",
  description: "Política de Privacidade da plataforma Auto Trader — END ART Studios — LGPD",
};

export default function PrivacyPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 prose prose-invert prose-sm">
      <h1>Política de Privacidade — Auto Trader</h1>
      <p className="text-xs text-muted-foreground">Última atualização: 30 de agosto de 2026 — END ART Studios — CNPJ 45.370.930/0001-75 — Osasco/SP - Brasil — Encarregado: endart.studios@gmail.com</p>

      <h2>1. Controlador e Encarregado</h2>
      <p>
        Controladora: <strong>END ART Studios</strong>, CNPJ 45.370.930/0001-75, Osasco/SP - Brasil, e-mail <a href="mailto:endart.studios@gmail.com">endart.studios@gmail.com</a>, Telegram <a href="https://t.me/AutoTrader2027" target="_blank" rel="noopener noreferrer">https://t.me/AutoTrader2027</a>. Encarregado (DPO): endart.studios@gmail.com.
      </p>

      <h2>2. Dados Coletados</h2>
      <ul>
        <li><strong>Cadastro:</strong> e-mail, senha com hash bcrypt (custo 12), papel (role), status ativo, MFA secret (quando habilitado).</li>
        <li><strong>Sessão:</strong> token opaco com hash SHA-256, expiração (7 dias), IP e user-agent.</li>
        <li><strong>Trading:</strong> posições, relatórios de scam, snapshots de mercado, insights de IA, logs de auditoria, alertas de vigilância, resultados de backtest, snapshots de performance, chaves de carteira/exchange criptografadas (AES-256-GCM), feature flags, embeddings para RAG.</li>
        <li><strong>Comunicação:</strong> canais de notificação (Telegram/Discord/webhook) quando configurados pelo usuário.</li>
        <li><strong>Navegação:</strong> cookies estritamente necessários (sessão `session`, `csrf`), headers de observabilidade (`X-Request-Id`), logs de acesso anonimizados.</li>
      </ul>

      <h2>3. Bases Legais (LGPD, art. 7º)</h2>
      <ul>
        <li><strong>Execução de contrato:</strong> criar e manter sua conta, autenticar, operar a Plataforma.</li>
        <li><strong>Legítimo interesse:</strong> segurança (detecção de fraude, rate limiting, audit log hash-chain), melhoria do serviço.</li>
        <li><strong>Consentimento:</strong> aceite obrigatório dos Termos e desta Política no cadastro; notificações externas quando opt-in.</li>
        <li><strong>Cumprimento de obrigação legal:</strong> guarda de logs por determinação legal, quando aplicável.</li>
      </ul>

      <h2>4. Finalidades</h2>
      <p>Autenticar e autorizar acesso (RBAC 4 papéis × 24 permissões, RLS por `ownerId`), executar o loop de trading, auditar decisões, enviar alertas configurados, gerar analytics e cumprir obrigações legais. Não utilizamos seus dados para comercialização a terceiros.</p>

      <h2>5. Compartilhamento</h2>
      <p>
        Não vendemos dados. Compartilhamos apenas com: (a) <strong>processadores necessários</strong> — provedores de infraestrutura (Fly.io/Railway, PostgreSQL, Redis), observabilidade (Sentry/Datadog/New Relic quando configurado) e, quando habilitado, provedores de pagamento (Stripe) e LLM (Ollama local ou provedor gratuito); (b) <strong>autoridades</strong> quando exigido por lei ou ordem judicial. Todos os processadores são orientados a tratar dados conforme esta Política e a LGPD.
      </p>

      <h2>6. Armazenamento e Segurança</h2>
      <ul>
        <li>Senhas: hash bcrypt custo 12; nunca em texto plano.</li>
        <li>Chaves privadas/API keys: AES-256-GCM com KDF versionado e `ENCRYPTION_KEY` em variável de ambiente/secret manager; zeroização de chave em `finally`.</li>
        <li>Sessão: cookie `session` opaco, `HttpOnly`, `Secure` (produção), `SameSite=Lax`, expiração 7 dias; token armazenado como hash SHA-256.</li>
        <li>Transmissão: TLS 1.2/1.3, HSTS `max-age=63072000; includeSubDomains; preload`, CSP restritiva.</li>
        <li>Logs: `redact` de `password`, `token`, `apiKey`, `ENCRYPTION_KEY` em Pino; `gitleaks` no pre-commit/CI.</li>
      </ul>

      <h2>7. Seus Direitos (LGPD, art. 18)</h2>
      <p>Você pode, a qualquer tempo e mediante requisição a <a href="mailto:endart.studios@gmail.com">endart.studios@gmail.com</a>: confirmar a existência de tratamento; acessar, corrigir, atualizar ou eliminar dados; solicitar anonimização, bloqueio ou eliminação de dados desnecessários; opor-se a tratamento; solicitar portabilidade; revogar consentimento (sem afetar tratamento anterior); e peticionar à ANPD. Responderemos em até 15 dias.</p>

      <h2>8. Retenção</h2>
      <p>Mantemos dados enquanto sua conta estiver ativa e pelo prazo necessário para cumprir finalidades, obrigações legais ou exercício regular de direitos. Logs de auditoria (`AuditLog` hash-chain, `AppLog`) são retidos por até 5 anos ou conforme exigência legal. Sessões expiram em 7 dias; tokens de reset em 15 minutos. Dados de contas excluídas são anonimizados ou eliminados, exceto quando a retenção for exigida por lei.</p>

      <h2>9. Cookies</h2>
      <p>Utilizamos apenas cookies estritamente necessários: `session` (autenticação, 7 dias) e `csrf` (proteção CSRF, sessão). Não utilizamos cookies de rastreamento ou publicidade. Você pode gerenciar cookies no navegador, mas a desativação dos cookies estritamente necessários impede o uso da Plataforma.</p>

      <h2>10. Transferência Internacional</h2>
      <p>Dados podem ser processados em servidores fora do Brasil (ex.: Fly.io `gru`/`iad`, Sentry US/EU) com garantias adequadas (cláusulas contratuais padrão, adequação do país ou consentimento específico quando aplicável).</p>

      <h2>11. Aceite Obrigatório</h2>
      <p>
        <strong>O cadastro só é concluído mediante o aceite expresso e destacado</strong> da caixa &quot;Li e aceito os Termos de Uso e a Política de Privacidade&quot;. O aceite é registrado com carimbo de data/hora e IP em `AuditLog` (`action: auth:register` ou `users:manage`). Sem o aceite, o botão de cadastro permanece desabilitado. Você pode revogar o consentimento a qualquer tempo, o que implicará o encerramento da conta.
      </p>

      <h2>12. Alterações desta Política</h2>
      <p>Podemos atualizar esta Política periodicamente. A versão vigente será publicada em <code>/privacy</code> com a data de última atualização. Alterações materiais serão comunicadas por e-mail ou aviso na Plataforma. O uso continuado após alterações implica aceitação.</p>

      <h2>13. Contato e Encarregado</h2>
      <p>
        Dúvidas, solicitações de direitos ou comunicações sobre privacidade: <a href="mailto:endart.studios@gmail.com">endart.studios@gmail.com</a> — Telegram: <a href="https://t.me/AutoTrader2027" target="_blank" rel="noopener noreferrer">https://t.me/AutoTrader2027</a> — Encarregado: endart.studios@gmail.com — Endereço: Osasco/SP - Brasil — CNPJ 45.370.930/0001-75.
      </p>

      <hr />
      <p className="text-center text-xs text-muted-foreground">Copyright © 2026 END ART Studios — CNPJ 45.370.930/0001-75 — Osasco/SP - Brasil — Todos os direitos reservados.</p>
    </div>
  );
}
