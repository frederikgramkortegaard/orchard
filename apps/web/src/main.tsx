import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import { ToastContainer } from './components/Toast';
import App from './App';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <WebSocketProvider>
          <App />
        </WebSocketProvider>
        <ToastContainer />
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>
);
