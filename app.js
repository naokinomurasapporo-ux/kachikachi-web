(() => {
  const STORAGE_KEY = 'kachikachi-web-v1';
  const COLORS = ['white','red','green','yellow'];
  const LABELS = ['白','赤','緑','黄'];
  const DISPLAY_ORDER = [2,1,3,0]; // 緑・赤・黄・白

  const blankTab = () => ({
    startG: 0,
    currentG: 0,
    upper: [0,0,0,0],
    lower: [0,0,0,0],
    ui: { sumMode: false, linkMode: false, sumSelected: [] }
  });

  const defaultState = () => ({
    active: 'A',
    tabs: { A: blankTab(), B: blankTab(), C: blankTab() },
    settings: { vibration: true, wake: true }
  });

  function clampInt(v,max=999999){
    const n = parseInt(String(v ?? '').replace(/\D/g,''),10);
    return Number.isFinite(n) ? Math.max(0, Math.min(max,n)) : 0;
  }

  function normalizeTab(raw){
    const base = blankTab();
    if (!raw || typeof raw !== 'object') return base;
    return {
      startG: clampInt(raw.startG),
      currentG: clampInt(raw.currentG),
      upper: Array.from({length:4}, (_,i) => clampInt(raw.upper?.[i], 1999)),
      lower: Array.from({length:4}, (_,i) => clampInt(raw.lower?.[i], 1999)),
      ui: {
        sumMode: !!raw.ui?.sumMode,
        linkMode: !!raw.ui?.linkMode,
        sumSelected: Array.isArray(raw.ui?.sumSelected)
          ? raw.ui.sumSelected.filter(v => /^(upper|lower)-[0-3]$/.test(v))
          : []
      }
    };
  }

  function normalizeState(raw){
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    return {
      active: ['A','B','C'].includes(raw.active) ? raw.active : 'A',
      tabs: {
        A: normalizeTab(raw.tabs?.A),
        B: normalizeTab(raw.tabs?.B),
        C: normalizeTab(raw.tabs?.C)
      },
      settings: {
        vibration: raw.settings?.vibration !== false,
        wake: raw.settings?.wake !== false
      }
    };
  }

  let state = load();
  let minusMode = false;
  let wakeLock = null;
  let editTarget = null;

  const $ = (id) => document.getElementById(id);
  const upperCounters = $('upperCounters');
  const lowerCounters = $('lowerCounters');
  const startG = $('startG');
  const currentG = $('currentG');
  const playG = $('playG');
  const status = $('status');

  function load(){
    try{
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return normalizeState(parsed);
    }catch{
      return defaultState();
    }
  }

  function save(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function tab(){ return state.tabs[state.active]; }
  function playGames(){ return Math.max(0, tab().currentG - tab().startG); }

  function ratio(count){
    const g = playGames();
    if (!(g > 0 && count > 0)) return '—';
    const value = g / count;
    return `1/${value < 10 ? value.toFixed(2) : value.toFixed(1)}`;
  }

  function ratioLabel(count){
    const g = playGames();
    if (g <= 0) return '確率 —';
    if (count <= 0) return '確率 —';
    return `確率 ${ratio(count)}`;
  }

  function vibrate(pattern=15){
    if (state.settings.vibration && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  }

  function setStatus(msg){ status.textContent = msg; }

  function render(){
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === state.active));
    startG.value = tab().startG;
    currentG.value = tab().currentG;
    playG.textContent = playGames();
    $('vibrationToggle').checked = !!state.settings.vibration;
    $('wakeToggle').checked = !!state.settings.wake;
    $('minusBtn').classList.toggle('active', minusMode);
    $('sumBtn').classList.toggle('active', tab().ui.sumMode);
    $('linkBtn').classList.toggle('active', tab().ui.linkMode);
    renderCounters(upperCounters,'upper');
    renderCounters(lowerCounters,'lower');
    renderLink();
    renderSum();
    save();
  }

  function renderCounters(container, which){
    container.innerHTML = '';
    DISPLAY_ORDER.forEach((i) => {
      const color = COLORS[i];
      const count = tab()[which][i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'counter';
      btn.dataset.color = color;
      btn.dataset.which = which;
      btn.dataset.index = String(i);
      btn.setAttribute('aria-label', `${which === 'upper' ? '上段' : '下段'} ${LABELS[i]} ${count}回 ${ratioLabel(count)}`);
      btn.innerHTML = `<span>${LABELS[i]}</span><strong class="count">${count}</strong><span class="ratio">${ratioLabel(count)}</span>`;

      let longPressTimer = null;
      let longPressTriggered = false;
      let pointerStartX = 0;
      let pointerStartY = 0;

      const clearLongPress = () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      };

      btn.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        longPressTriggered = false;
        pointerStartX = e.clientX;
        pointerStartY = e.clientY;
        clearLongPress();
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          longPressTriggered = true;
          vibrate([20,35,20]);
          flashExistingCounter(which, i, 'long');
          openEdit(which,i);
        }, 550);
      });

      btn.addEventListener('pointermove', (e) => {
        if (Math.abs(e.clientX - pointerStartX) > 12 || Math.abs(e.clientY - pointerStartY) > 12) {
          clearLongPress();
        }
      });
      btn.addEventListener('pointerup', clearLongPress);
      btn.addEventListener('pointercancel', clearLongPress);
      btn.addEventListener('pointerleave', clearLongPress);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());

      btn.addEventListener('click', () => {
        if (longPressTriggered) {
          longPressTriggered = false;
          return;
        }

        const arr = tab()[which];
        if (minusMode) {
          arr[i] = Math.max(0, arr[i] - 1);
          minusMode = false;
          setStatus(`${LABELS[i]}を1減らしました`);
        } else {
          arr[i] = Math.min(1999, arr[i] + 1);
          setStatus(`${LABELS[i]} +1`);
        }

        vibrate();
        render();
        flashExistingCounter(which, i, 'tap');
      });

      container.appendChild(btn);
    });
  }

  function flashExistingCounter(which, i, type='tap'){
    const container = which === 'upper' ? upperCounters : lowerCounters;
    const btn = container.querySelector(`.counter[data-index="${i}"]`);
    if (!btn) return;
    btn.classList.remove('flash','flash-long');
    void btn.offsetWidth;
    btn.classList.add(type === 'long' ? 'flash-long' : 'flash');
    setTimeout(() => btn.classList.remove('flash','flash-long'), type === 'long' ? 320 : 230);
  }

  function openEdit(which,i){
    editTarget = {which,i};
    $('editTitle').textContent = `${which === 'upper' ? '上段' : '下段'}・${LABELS[i]}を直接入力`;
    $('editInput').value = tab()[which][i];
    $('editDialog').showModal();
    setTimeout(() => {
      $('editInput').focus();
      $('editInput').select();
    }, 50);
  }

  $('editForm').addEventListener('submit', (e) => {
    if (!editTarget) return;
    if (e.submitter?.value === 'cancel') {
      editTarget = null;
      return;
    }
    const {which,i} = editTarget;
    tab()[which][i] = clampInt($('editInput').value,1999);
    editTarget = null;
    render();
    flashExistingCounter(which, i, 'tap');
    setStatus('回数を更新しました');
  });

  $('editDialog').addEventListener('close', () => { editTarget = null; });

  function renderLink(){
    const on = tab().ui.linkMode;
    $('linkPanel').classList.toggle('hidden', !on);
    if (!on) return;
    $('linkGrid').innerHTML = '';
    DISPLAY_ORDER.forEach((i) => {
      const up = tab().upper[i];
      const down = tab().lower[i];
      const pct = up > 0 ? `${((down/up)*100).toFixed(1)}%` : '—';
      const div = document.createElement('div');
      div.className = 'mini';
      div.innerHTML = `<strong>${LABELS[i]}</strong><div>${pct}</div>`;
      $('linkGrid').appendChild(div);
    });
  }

  function renderSum(){
    const on = tab().ui.sumMode;
    $('sumPanel').classList.toggle('hidden', !on);
    if (!on) return;
    $('sumChoices').innerHTML = '';

    ['upper','lower'].forEach(which => DISPLAY_ORDER.forEach((i) => {
      const id = `${which}-${i}`;
      const label = document.createElement('label');
      label.className = 'sum-choice';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = tab().ui.sumSelected.includes(id);
      cb.addEventListener('change', () => {
        const selected = new Set(tab().ui.sumSelected);
        if (cb.checked) selected.add(id); else selected.delete(id);
        tab().ui.sumSelected = [...selected];
        save();
        renderSumResult();
      });
      const span = document.createElement('span');
      span.textContent = `${which === 'upper' ? '上' : '下'}・${LABELS[i]}`;
      label.append(cb,span);
      $('sumChoices').appendChild(label);
    }));

    renderSumResult();
  }

  function renderSumResult(){
    let total = 0;
    tab().ui.sumSelected.forEach(id => {
      const [which,i] = id.split('-');
      total += tab()[which][Number(i)] || 0;
    });
    $('sumResult').textContent = total > 0 ? `合算 ${ratio(total)}` : '—';
  }

  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
    state.active = b.dataset.tab;
    minusMode = false;
    render();
    setStatus(`${state.active}を表示中`);
  }));

  function refreshCalculatedDisplays(){
    playG.textContent = playGames();
    renderCounters(upperCounters,'upper');
    renderCounters(lowerCounters,'lower');
    renderLink();
    renderSum();
    save();
  }

  function updateGamesFromInputs(){
    tab().startG = clampInt(startG.value);
    tab().currentG = clampInt(currentG.value);
    refreshCalculatedDisplays();
    if (tab().currentG < tab().startG) {
      setStatus('現在Gが開始Gより小さいため、確率は計算できません');
    }
  }

  startG.addEventListener('input', updateGamesFromInputs);
  currentG.addEventListener('input', updateGamesFromInputs);

  $('add100').addEventListener('click', () => {
    const base = Math.max(tab().currentG, tab().startG);
    tab().currentG = Math.min(999999, base + 100);
    vibrate();
    render();
    setStatus('現在Gを+100しました');
  });

  $('add1000').addEventListener('click', () => {
    const base = Math.max(tab().currentG, tab().startG);
    tab().currentG = Math.min(999999, base + 1000);
    vibrate();
    render();
    setStatus('現在Gを+1000しました');
  });

  $('minusBtn').addEventListener('click', () => {
    minusMode = !minusMode;
    render();
    setStatus(minusMode ? '訂正モード：次に押した項目を1減らします' : '訂正モード解除');
  });

  $('sumBtn').addEventListener('click', () => {
    tab().ui.sumMode = !tab().ui.sumMode;
    render();
  });

  $('linkBtn').addEventListener('click', () => {
    tab().ui.linkMode = !tab().ui.linkMode;
    render();
  });

  $('settingsBtn').addEventListener('click', () => $('settingsPanel').classList.toggle('hidden'));

  $('vibrationToggle').addEventListener('change', (e) => {
    state.settings.vibration = e.target.checked;
    save();
    if (e.target.checked) vibrate();
  });

  $('wakeToggle').addEventListener('change', async(e) => {
    state.settings.wake = e.target.checked;
    save();
    await syncWakeLock();
  });

  $('resetCurrent').addEventListener('click', () => {
    if (confirm(`${state.active}のデータをリセットしますか？`)) {
      state.tabs[state.active] = blankTab();
      minusMode = false;
      render();
      setStatus(`${state.active}をリセットしました`);
    }
  });

  $('resetAll').addEventListener('click', () => {
    if (confirm('A/B/Cすべてのデータをリセットしますか？')) {
      state.tabs = {A:blankTab(),B:blankTab(),C:blankTab()};
      state.active = 'A';
      minusMode = false;
      render();
      setStatus('全台リセットしました');
    }
  });

  async function syncWakeLock(){
    try{
      if (!('wakeLock' in navigator)) return;
      if (state.settings.wake) {
        if (!wakeLock) {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeLock.addEventListener('release', () => { wakeLock = null; });
        }
      } else if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    }catch{}
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncWakeLock();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }

  render();
  syncWakeLock();
})();