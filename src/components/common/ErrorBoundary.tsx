import { Component, type ReactNode } from 'react';
import { Button } from './Button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/** Last-resort safety net so a runtime bug never shows a blank white screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error('Memory Match crashed:', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          textAlign: 'center',
          background: '#0a0a16',
          color: '#f5f5fb',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h1 style={{ fontSize: 24 }}>Something went sideways.</h1>
        <p style={{ color: 'rgba(245,245,251,0.7)', maxWidth: 360 }}>
          Memory Match hit an unexpected error. Reloading will get you right back to the menu.
        </p>
        <Button onClick={() => window.location.reload()}>Reload Game</Button>
      </div>
    );
  }
}
