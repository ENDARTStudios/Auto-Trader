"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Brain, Sparkles, Bot, FileSearch, Newspaper } from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AIInsightRow } from "@/hooks/use-trading-data";

const ROLE_META: Record<string, { icon: typeof Brain; label: string; color: string }> = {
  thesis: { icon: Sparkles, label: "Trading Thesis", color: "text-purple-500" },
  contract_analyst: { icon: FileSearch, label: "Contract Auditor", color: "text-blue-500" },
  news_sentiment: { icon: Newspaper, label: "News/Sentiment", color: "text-orange-500" },
  risk_advisor: { icon: Bot, label: "Risk Advisor", color: "text-red-500" },
};

function recColor(rec: string): string {
  switch (rec) {
    case "buy": return "text-emerald-500";
    case "hold": return "text-yellow-500";
    case "avoid": return "text-red-500";
    case "investigate": return "text-orange-500";
    case "exit": return "text-red-600";
    default: return "text-muted-foreground";
  }
}

function recBadgeVariant(rec: string): "default" | "secondary" | "destructive" | "outline" {
  switch (rec) {
    case "buy": return "default";
    case "avoid":
    case "exit": return "destructive";
    case "investigate":
    case "hold": return "secondary";
    default: return "outline";
  }
}

interface Props {
  insights: AIInsightRow[];
  isLoading: boolean;
}

export function AIInsightsPanel({ insights, isLoading }: Props) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<number | null>(null);

  if (isLoading && insights.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Carregando AI insights...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Alert>
        <Brain className="size-4" />
        <AlertDescription className="text-xs">
          Agentes de IA (LLM via z-ai-web-dev-sdk) analisam cada candidato em três papéis:
          <strong> Trading Thesis</strong> (combina TA + scam + GoPlus em recomendação buy/avoid),
          <strong> Contract Auditor</strong> (audita source code em busca de lógica oculta de rug pull),
          <strong> News/Sentiment</strong> (síntese contextual do projeto). Engine dá veto à AI — se
          consensus = "avoid" ou "investigate", token é rejeitado.
        </AlertDescription>
      </Alert>

      {insights.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Nenhum AI insight ainda. Inicie a engine — a cada round, todos os
            candidatos aprovados no scam filter passam pelo squad de agentes.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {insights.map((insight) => {
            const meta = ROLE_META[insight.agentRole] ?? { icon: Bot, label: insight.agentRole, color: "text-muted-foreground" };
            const Icon = meta.icon;
            const isOpen = expanded === insight.id;
            return (
              <Card key={insight.id} className={isOpen ? "border-primary/50" : ""}>
                <CardHeader className="pb-3 cursor-pointer" onClick={() => setExpanded(isOpen ? null : insight.id)}>
                  <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Icon className={`size-4 ${meta.color}`} />
                      <span>{meta.label}</span>
                      {insight.symbol && (
                        <Badge variant="outline" className="text-[10px]">{insight.symbol}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={recBadgeVariant(insight.recommendation)} className="text-[10px]">
                        {insight.recommendation.toUpperCase()}
                      </Badge>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        conf {insight.confidence}%
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {insight.durationMs}ms · {insight.tokensUsed} tok
                      </span>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {insight.error ? (
                    <Alert variant="destructive">
                      <AlertDescription className="text-xs">{insight.error}</AlertDescription>
                    </Alert>
                  ) : (
                    <>
                      {insight.keySignals.length > 0 && (
                        <ul className="text-xs space-y-1 mb-2">
                          {insight.keySignals.slice(0, isOpen ? 99 : 3).map((sig, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-muted-foreground">•</span>
                              <span>{sig}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {isOpen && (
                        <div className="mt-3 pt-3 border-t">
                          <Label className="text-[10px] text-muted-foreground">Output completo do modelo:</Label>
                          <Textarea
                            readOnly
                            value={insight.modelOutput}
                            className="mt-1 font-mono text-[11px] h-72 resize-y"
                          />
                          <Label className="text-[10px] text-muted-foreground mt-2 block">Prompt summary:</Label>
                          <p className="text-[11px] text-muted-foreground mt-1 line-clamp-3">
                            {insight.promptSummary}
                          </p>
                        </div>
                      )}
                      {!isOpen && (
                        <p className="text-[10px] text-muted-foreground">Clique para expandir output completo</p>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
