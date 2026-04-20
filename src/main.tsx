import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { createLightconeAdapter } from './api';
import { AdapterProvider } from './contexts/AdapterContext';
import { ModeProvider } from './contexts/ModeContext';
import 'katex/dist/katex.min.css';
import './vellum.css';

const adapter = createLightconeAdapter();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AdapterProvider adapter={adapter}>
        <ModeProvider>
          <App />
        </ModeProvider>
      </AdapterProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
