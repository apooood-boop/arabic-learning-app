import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Register VitePWA Workbox service worker for offline & standalone PWA support
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onOfflineReady() {
      console.log('Qalam PWA is ready for offline study.');
    },
  });
}

createRoot(document.getElementById('root')!).render(<App />);
