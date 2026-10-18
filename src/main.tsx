import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './App';
import { QuickCaptureWindow } from './components/QuickCapture/QuickCaptureWindow';
import { isQuickCaptureHash } from './lib/windows';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isQuickCaptureHash(window.location.hash) ? <QuickCaptureWindow /> : <App />}</StrictMode>,
);
