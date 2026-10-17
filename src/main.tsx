import React from 'react';
import ReactDOM from 'react-dom/client';
import { onHostConfig, onOrbState } from './sdk/mnemo-sdk';
import { setDucked } from './lib/player';
import App from './App';
import './glass.css';
import './app.css';
import { adoptHostLang } from './i18n/useI18n';

/** The SDK applies the shell's theme on its own and hands us its language.
 *  Registered before render so the first paint is already themed. */
onHostConfig((cfg) => {
  adoptHostLang(cfg.lang);
});

/** The orb listens or speaks: the music goes down under it, then back to the person's volume. */
onOrbState(({ active }) => setDucked(active));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
