import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { ThemeProvider } from './contexts/ThemeContext';
import App from './App';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <WebSocketProvider>
        <App />
      </WebSocketProvider>
    </ThemeProvider>
  </StrictMode>
);
