import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { asReadOnlyAdapter } from './adapter';
import { AdapterProvider } from './contexts/AdapterContext';
import { AnnotationActionsProvider } from './contexts/AnnotationActionsContext';
import { ModeProvider } from './contexts/ModeContext';
import { createStaticAdapter, staticSiteBase } from './static-adapter';
import './vellum.css';

const adapter = asReadOnlyAdapter(createStaticAdapter());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter
      basename={staticSiteBase()}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AdapterProvider adapter={adapter}>
        <AnnotationActionsProvider bulkActions={[]} singleActions={[]}>
          <ModeProvider>
            <App />
          </ModeProvider>
        </AnnotationActionsProvider>
      </AdapterProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
