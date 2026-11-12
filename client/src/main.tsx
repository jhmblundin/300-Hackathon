import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Admin from './pages/Admin';
import Play from './pages/Play';
import Screen from './pages/Screen';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/admin" element={<Admin />} />
        <Route path="/screen" element={<Screen />} />
        <Route path="*" element={<Play />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
