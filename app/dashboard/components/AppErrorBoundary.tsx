'use client';

import React, { Component, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Card, Button, IconBadge } from '@/components/ui';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[AppErrorBoundary] Caught error:', error);
    console.error('[AppErrorBoundary] Component stack:', errorInfo.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex items-center justify-center bg-[var(--bg-primary)] theme-transition p-8">
          <Card size="lg" className="max-w-md w-full p-8 text-center">
            <IconBadge icon={AlertTriangle} accent="red" size={56} className="rounded-[16px] mx-auto mb-4" />
            <h2 className="text-[17px] font-bold mb-2">
              Something went wrong
            </h2>
            <p className="text-[12px] text-[var(--text-secondary)] mb-6 leading-relaxed">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            {process.env.NODE_ENV === 'development' && this.state.error?.stack && (
              <details className="mb-4 text-left">
                <summary className="text-[10px] text-[var(--text-secondary)] cursor-pointer font-mono">
                  Stack trace
                </summary>
                <pre className="mt-2 p-3 rounded-[12px] bg-[var(--skeleton-bg)] text-[9px] text-[var(--text-secondary)] font-mono overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap">
                  {this.state.error.stack}
                </pre>
              </details>
            )}
            <Button onClick={this.handleRetry} className="mx-auto">
              <RefreshCw className="w-[14px] h-[14px]" />
              Retry
            </Button>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
