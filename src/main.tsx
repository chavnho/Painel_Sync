import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ background: '#090D12', color: '#F1F5F9', minHeight: '100vh', padding: 24, fontFamily: 'monospace' }}>
          <h2 style={{ color: '#F43F5E', marginBottom: 8 }}>Erro de Renderização Detectado</h2>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#0F141C', padding: 16, borderRadius: 8, border: '1px solid #1E293B' }}>
            {this.state.error.message}{'\n\n'}{this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>
);