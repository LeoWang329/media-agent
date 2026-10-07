import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
// 设计原型的样式原样引入
import './design/app.css';
import './design/canvas.css';
import './design/setup.css';
import './design/home.css';
import './design/settings.css';
import './design/image.css';
import './design/video.css';
import './design/glue.css';
import './design/features.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
