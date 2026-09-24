import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DriverDownloadsProvider } from './hooks/useDriverDownloads';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DriverDownloadsProvider>
      <App />
    </DriverDownloadsProvider>
  </StrictMode>,
);
