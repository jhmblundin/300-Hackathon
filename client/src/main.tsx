import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Admin from './pages/Admin';
import Play from './pages/Play';
import Screen from './pages/Screen';
import Countdown from './pages/Countdown';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/ideaathon">
      <Routes>
        <Route path="/admin" element={<Screen />} />
        <Route path="/console" element={<Admin />} />
        <Route path="/timer" element={<Countdown />} />
        <Route
          path="/building"
          element={
            <Countdown
              label="Building starts in"
              endAt="2026-11-12T21:22:00-05:00"
              after={['GO', 'BUILD.']}
              sub=""
            />
          }
        />
        <Route path="/screen" element={<Screen />} />
        <Route path="/presentation" element={<Screen />} />
        <Route path="*" element={<Play />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
