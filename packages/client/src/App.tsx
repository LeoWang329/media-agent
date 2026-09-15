import { Route, Routes } from 'react-router';
import { Canvas } from './pages/Canvas';
import { Home } from './pages/Home';
import { Settings } from './pages/Settings';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/canvas/:id" element={<Canvas />} />
      <Route path="/settings" element={<Settings />} />
    </Routes>
  );
}
