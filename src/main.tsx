import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { Store } from './store/store.tsx';
import { ProveedorConfirmacion } from './components/ui/confirmar.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Store>
      <ProveedorConfirmacion>
        <App />
      </ProveedorConfirmacion>
    </Store>
  </StrictMode>,
);

// Service worker: cachea el armazon para que la app abra al instante y siga
// abriendo sin señal. Solo en produccion, para no pelear con el hot reload.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Sin service worker la app funciona igual, solo que sin modo offline.
    });
  });
}
