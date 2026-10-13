import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

// Scrolling over a number box never changes its value (the user, 2026-10-13): the box lets go, and the page scrolls.
document.addEventListener('wheel', (e) => {
  const el = document.activeElement;
  if (el && el.tagName === 'INPUT' && el.type === 'number' && (e.target === el || el.contains(e.target))) el.blur();
}, { passive: true });

ReactDOM.createRoot(document.getElementById('root')).render(
  // <React.StrictMode>
  <App />
  // </React.StrictMode>,
)

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:beforeUpdate' }, '*');
  });
  import.meta.hot.on('vite:afterUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:afterUpdate' }, '*');
  });
}



