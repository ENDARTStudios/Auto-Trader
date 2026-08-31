import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termos de Uso e Serviços — Auto Trader",
  description: "Termos de Uso e Serviços da plataforma Auto Trader — END ART Studios",
};

export default function TermsPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 prose prose-invert prose-sm">
      <h1>Termos de Uso e Serviços — Auto Trader</h1>
      <p className="text-xs text-muted-foreground">Última atualização: 30 de agosto de 2026 — END ART Studios — CNPJ 45.370.930/0001-75 — Osasco/SP - Brasil</p>

      <h2>1. Aceitação dos Termos</h2>
      <p>
        Ao criar uma conta, acessar ou utilizar a plataforma <strong>Auto Trader</strong> (doravante &quot;Plataforma&quot;), operada por <strong>END ART Studios</strong>, CNPJ 45.370.930/0001-75, com sede em Osasco/SP - Brasil, contato <a href="mailto:endart.studios@gmail.com">endart.studios@gmail.com</a> e Telegram <a href="https://t.me/AutoTrader2027" target="_blank" rel="noopener noreferrer">https://t.me/AutoTrader2027</a>, você declara que leu, compreendeu e concorda integralmente com estes Termos de Uso e Serviços e com a <a href="/privacy">Política de Privacidade</a>. <strong>O aceite é obrigatório para o cadastro</strong> — sem a marcação da caixa &quot;Li e aceito os Termos de Uso e a Política de Privacidade&quot; o cadastro não será concluído.
      </p>

      <h2>2. Descrição do Serviço</h2>
      <p>
        A Plataforma é um sistema autônomo de <em>paper trading</em> de criptomoedas com detecção multicamada de golpes (<em>scam detection</em>), circuit breakers e divisão 50/50 de lucro (reserva cold em USDC / reinvestimento). O modo padrão é <em>paper trading</em> (simulação, sem capital real). O modo <em>live</em> só é liberado após 50 ciclos paper lucrativos (graduação) e mediante habilitação explícita do operador.
      </p>

      <h2>3. Cadastro e Conta</h2>
      <ul>
        <li>Você deve ter pelo menos 18 anos e fornecer informações verdadeiras, completas e atualizadas.</li>
        <li>Você é responsável por manter a confidencialidade de sua senha e por todas as atividades realizadas em sua conta.</li>
        <li>O uso de autenticação de dois fatores (TOTP) é recomendado e pode ser exigido para operações sensíveis.</li>
        <li>A END ART Studios pode suspender ou encerrar contas que violem estes Termos ou a legislação aplicável.</li>
      </ul>

      <h2>4. Riscos e Isenção de Responsabilidade</h2>
      <p>
        <strong>AVISO DE RISCO:</strong> Operações com criptomoedas envolvem alto risco e podem resultar em perda total do capital investido. A Plataforma <strong>reduz</strong> o risco de golpes e perdas por meio de heurísticas automatizadas, mas <strong>não elimina</strong> o risco. <em>Rug pulls</em> sofisticados, falhas de contrato ou de mercado podem passar pelas detecções. <strong>Nunca invista mais do que pode perder.</strong> O conteúdo da Plataforma não constitui aconselhamento financeiro, jurídico ou tributário.
      </p>

      <h2>5. Propriedade Intelectual</h2>
      <p>
        Copyright © 2026 END ART Studios. Todos os direitos reservados. O software, seu código-fonte, marcas, logotipos, textos, gráficos e demais conteúdos são de propriedade exclusiva da END ART Studios e são protegidos pela legislação brasileira e internacional. É vedada, sem autorização prévia e por escrito, a cópia, modificação, distribuição, sublicenciamento, publicação, engenharia reversa ou uso em qualquer forma.
      </p>

      <h2>6. Uso Aceitável</h2>
      <p>Você concorda em não:</p>
      <ul>
        <li>Utilizar a Plataforma para atividades ilícitas, fraudulentas ou que violem direitos de terceiros;</li>
        <li>Tentar obter acesso não autorizado a sistemas, contas ou dados;</li>
        <li>Introduzir vírus, malware ou código malicioso;</li>
        <li>Realizar engenharia reversa, descompilação ou extração do código-fonte;</li>
        <li>Compartilhar credenciais de acesso com terceiros.</li>
      </ul>

      <h2>7. Privacidade e Proteção de Dados</h2>
      <p>
        O tratamento de dados pessoais é regido pela <a href="/privacy">Política de Privacidade</a>, elaborada em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 - LGPD). Ao aceitar estes Termos, você também aceita a Política de Privacidade.
      </p>

      <h2>8. Limitação de Responsabilidade</h2>
      <p>
        Na extensão máxima permitida por lei, a END ART Studios não será responsável por danos diretos, indiretos, incidentais, consequenciais ou lucros cessantes decorrentes do uso ou da impossibilidade de uso da Plataforma, ainda que avisada da possibilidade de tais danos.
      </p>

      <h2>9. Alterações dos Termos</h2>
      <p>
        Estes Termos podem ser atualizados periodicamente. A versão vigente será sempre publicada em <code>/terms</code> com a data de última atualização. O uso continuado após alterações implica aceitação dos novos Termos. Alterações materiais serão comunicadas por e-mail ou aviso na Plataforma.
      </p>

      <h2>10. Lei Aplicável e Foro</h2>
      <p>
        Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro da comarca de Osasco/SP, com exclusão de qualquer outro, por mais privilegiado que seja, para dirimir controvérsias oriundas destes Termos.
      </p>

      <h2>11. Contato</h2>
      <p>
        Dúvidas, solicitações ou comunicações sobre estes Termos: <a href="mailto:endart.studios@gmail.com">endart.studios@gmail.com</a> — Telegram: <a href="https://t.me/AutoTrader2027" target="_blank" rel="noopener noreferrer">https://t.me/AutoTrader2027</a>
      </p>

      <hr />
      <p className="text-center text-xs text-muted-foreground">Copyright © 2026 END ART Studios — CNPJ 45.370.930/0001-75 — Osasco/SP - Brasil — Todos os direitos reservados.</p>
    </div>
  );
}
