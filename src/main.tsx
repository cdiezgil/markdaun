import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './App';
import { QuickCaptureWindow } from './components/QuickCapture/QuickCaptureWindow';
import { isQuickCaptureHash } from './lib/windows';
import { applyTheme, readThemePreference, THEME_STORAGE_KEY } from './lib/theme';

// Before the first paint, so a forced theme never flashes the OS one. The storage
// event keeps the other window (main ↔ quick capture) in step.
applyTheme(readThemePreference());
window.addEventListener('storage', (e) => {
  if (e.key === THEME_STORAGE_KEY) applyTheme(readThemePreference());
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isQuickCaptureHash(window.location.hash) ? <QuickCaptureWindow /> : <App />}</StrictMode>,
);
