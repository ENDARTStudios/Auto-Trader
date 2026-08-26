'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  label?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Fire-and-forget observability — never throw inside catch
    try {
      // Dynamic import to avoid bundling server-only code
      // In production this would call Sentry.captureException
      if (typeof window !== 'undefined' && (window as any).__SENTRY__) {
        (window as any).__SENTRY__.captureException(error, {
          extra: { label: this.props.label, componentStack: info.componentStack },
        });
      }
    } catch {
      // ignore sentry failure
    }
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[ErrorBoundary:${this.props.label ?? 'unknown'}]`, error, info.componentStack);
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive text-base">
              <AlertTriangle className="h-5 w-5" />
              Erro em {this.props.label ?? 'componente'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Este painel encontrou um erro. O resto do dashboard continua funcionando.
            </p>
            {process.env.NODE_ENV !== 'production' && this.state.error && (
              <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-40 whitespace-pre-wrap break-words">
                {this.state.error.message}
              </pre>
            )}
            <Button variant="outline" size="sm" onClick={() => this.setState({ hasError: false, error: null })}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

export function useErrorHandler(label?: string) {
  return React.useCallback(
    (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      try {
        if (typeof window !== 'undefined' && (window as any).__SENTRY__) {
          (window as any).__SENTRY__.captureException(err, { extra: { label: label ?? 'useErrorHandler' } });
        }
      } catch {
        // ignore
      }
      console.error(`[useErrorHandler:${label ?? 'unknown'}]`, err);
    },
    [label],
  );
}
