import React, { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-cyber-darker text-slate-100 p-6">
          <div className="glass-panel p-8 max-w-md w-full border-red-500/30">
            <h2 className="text-2xl font-bold text-red-500 mb-4 font-sans">System Exception</h2>
            <p className="text-slate-300 text-sm mb-6">
              An unexpected error occurred in the dashboard rendering engine.
            </p>
            <div className="bg-black/40 p-4 rounded text-xs font-mono text-red-400 overflow-x-auto mb-6">
              {this.state.error?.toString() || 'Unknown Error'}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 px-4 rounded transition-all duration-200"
            >
              Refresh Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
