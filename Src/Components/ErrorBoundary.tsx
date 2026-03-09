import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 text-zinc-100 font-sans">
          <div className="w-full max-w-md rounded-2xl bg-zinc-900/50 p-8 shadow-2xl ring-1 ring-red-500/20 backdrop-blur-xl">
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10 text-red-400 ring-1 ring-red-500/20">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-white mb-2">Si è verificato un errore</h1>
              <p className="text-sm text-zinc-400">
                L'applicazione ha riscontrato un problema imprevisto.
              </p>
            </div>
            <div className="bg-black/50 rounded-xl p-4 overflow-auto max-h-48 text-xs text-red-400 font-mono ring-1 ring-white/5">
              {this.state.error?.message || 'Errore sconosciuto'}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-white/5 py-3.5 text-sm font-semibold text-white transition-all hover:bg-white/10"
            >
              Ricarica la pagina
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}
