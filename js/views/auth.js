// Prijava i prvo podešavanje.

import * as V from '../vault.js';
import { t, getLang, setLang } from '../i18n.js';
import { $, on, toast, busy, confirmBox, icon } from '../ui.js';
import { esc } from '../util.js';
import { passwordProblems, WrongPassword } from '../crypto.js';
import { defaultDataRepo, showSetupErr } from './data.js';

const langSwitch = () => `<div class="lang">${['de', 'sr'].map((l) => `<button type="button" data-lang="${l}" class="${getLang() === l ? 'on' : ''}">${l.toUpperCase()}</button>`).join('')}</div>`;

function frame(root, inner) {
  root.innerHTML = `<div class="auth"><div class="authbox">
    <div class="brand-big">${icon('invoice')}<div><b>Physio-Rechnung</b><span>${t('tagline')}</span></div></div>
    ${inner}${langSwitch()}</div></div>`;
}

export async function renderAuth(root, done) {
  const mode = await V.bootMode();
  const rerender = () => renderAuth(root, done);
  if (mode === 'login') login(root, done, rerender); else setup(root, done, rerender);
  on(root, '[data-lang]', 'click', (e, b) => { setLang(b.dataset.lang); rerender(); });
}

function login(root, done) {
  const msg = sessionStorage.getItem('physio_msg');
  sessionStorage.removeItem('physio_msg');
  frame(root, `<form id="lf" class="stack">
    <h1>${t('login_title')}</h1>
    ${msg ? `<p class="hint warn">${esc(t(msg))}</p>` : ''}
    <label class="field"><span>${t('password')}</span><input type="password" id="pw" autocomplete="current-password" required autofocus></label>
    <label class="check"><input type="checkbox" id="rem"> ${t('remember')}</label>
    <p class="small muted">${t('remember_hint')}</p>
    <button class="btn primary big" type="submit">${t('unlock')}</button>
    <p class="small muted">${t('forgot_pw')}</p>
  </form>`);
  $('#pw', root).focus();
  $('#lf', root).onsubmit = async (e) => {
    e.preventDefault();
    try {
      await busy(t('unlocking'), () => V.login($('#pw', root).value, $('#rem', root).checked));
      done();
    } catch (err) {
      if (err instanceof WrongPassword) { toast(t('wrong_pw'), 'error'); $('#pw', root).select(); }
      else if (err.kind === 'offline') toast(t('first_login_offline'), 'error');
      else if (err.kind === 'auth') toast(t('err_auth'), 'error');
      else showSetupErr(err);
    }
  };
}

function setup(root, done) {
  frame(root, `<form id="sf" class="stack" autocomplete="off">
    <h1>${t('setup_title')}</h1>
    <p>${t('setup_intro')}</p>
    <label class="field"><span>${t('new_pw')}</span><input type="password" id="p1" autocomplete="new-password" required></label>
    <label class="field"><span>${t('new_pw2')}</span><input type="password" id="p2" autocomplete="new-password" required></label>
    <div id="pwState" class="small muted">${t('pw_rules')}</div>
    <label class="check strong"><input type="checkbox" id="wrote" required> ${t('pw_written')}</label>

    <fieldset><legend>${t('storage')}</legend>
      <label class="check"><input type="radio" name="m" value="cloud" checked> <span><b>${t('mode_cloud')}</b><br><small class="muted">${t('mode_cloud_hint')}</small></span></label>
      <div id="cloudBox" class="stack indent">
        <p class="small">${t('token_help')}</p>
        <label class="field"><span>${t('gh_token')}</span><input type="password" id="tok"></label>
        <label class="field"><span>${t('data_repo')}</span><input type="text" id="drepo" value="${esc(defaultDataRepo())}"></label>
        <label class="field"><span>${t('code_repo')}</span><input type="text" id="crepo" value="${esc(V.codeRepoGuess())}"></label>
      </div>
      <label class="check"><input type="radio" name="m" value="local"> <span><b>${t('mode_local')}</b><br><small class="muted">${t('mode_local_hint')}</small></span></label>
    </fieldset>
    <button class="btn primary big" type="submit">${t('setup_go')}</button>
  </form>`);
  const upd = () => {
    const p = passwordProblems($('#p1', root).value);
    $('#pwState', root).innerHTML = $('#p1', root).value ? (p.length ? p.map((x) => `<span class="bad-text">${t(x)}</span>`).join(' ') : `<span class="ok">${icon('check')} ${t('pw_good')}</span>`) : t('pw_rules');
  };
  $('#p1', root).oninput = upd;
  on(root, 'input[name=m]', 'change', () => { $('#cloudBox', root).hidden = $('input[name=m]:checked', root).value !== 'cloud'; });
  $('#sf', root).onsubmit = async (e) => {
    e.preventDefault();
    const pw = $('#p1', root).value;
    if (pw !== $('#p2', root).value) { toast(t('pw_mismatch'), 'error'); return; }
    if (passwordProblems(pw).length) { toast(t('pw_weak'), 'error'); return; }
    const mode = $('input[name=m]:checked', root).value;
    try {
      if (mode === 'cloud') {
        const token = $('#tok', root).value.trim();
        const dataRepo = $('#drepo', root).value.trim(), codeRepo = $('#crepo', root).value.trim();
        if (!token || !/^[\w.-]+\/[\w.-]+$/.test(dataRepo) || !/^[\w.-]+\/[\w.-]+$/.test(codeRepo)) { toast(t('setup_fields'), 'error'); return; }
        await busy(t('connecting'), () => V.setupCloud({ password: pw, token, dataRepo, codeRepo }));
      } else {
        if (!(await confirmBox(t('local_confirm')))) return;
        await busy(t('setting_up'), () => V.setupLocal(pw));
      }
      toast(t('setup_done'));
      done(true);
    } catch (err) { showSetupErr(err); }
  };
}
