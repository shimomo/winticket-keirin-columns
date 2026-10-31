(() => {
  'use strict';

  // 枠・車・選手名は左の固定表と重なって表示されるため、並び替えも非表示もしない
  const LOCKED_COLUMNS = 3;
  const STORAGE_KEY = 'columns';
  const DEFAULT_CONFIG = { order: ['メモ'], hidden: [] };
  const ORIG = 'data-wtc-orig';
  const HIDDEN = 'data-wtc-hidden';
  const SEAM = 'data-wtc-seam';

  let config = clone(DEFAULT_CONFIG);
  let observer;
  const buttons = new WeakMap();
  const owners = new WeakMap();
  const headerMemo = new WeakMap();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalize(text) {
    return text.replace(/\s+/g, '');
  }

  function isStringArray(value) {
    return Array.isArray(value) && value.every((v) => typeof v === 'string');
  }

  // 元の列番号を data 属性に記録する。
  // レース切り替えなどで React が一部のセルだけ作り直すと、印のないセルが現れる。
  // 印のあるセルの位置と rowspan に占有された列を除いた空き列に、印のないセルを左から割り当てる。
  // rowspan は行グループ (thead/tbody) の中で打ち切る
  function tagOriginalColumns(table) {
    const rows = [...table.rows];
    if (!rows.length) return;
    const headerCells = [...rows[0].cells];
    const total = headerCells.reduce((sum, cell) => sum + cell.colSpan, 0);
    tagHeaderFromMemo(table, headerCells);
    const occupied = rows.map(() => new Set());
    rows.forEach((row, i) => {
      let sectionEnd = i;
      while (sectionEnd + 1 < rows.length && rows[sectionEnd + 1].parentElement === row.parentElement) {
        sectionEnd++;
      }
      const cells = [...row.cells];
      for (const cell of cells) {
        if (!cell.hasAttribute(ORIG)) continue;
        const col = originalColumn(cell);
        for (let c = col; c < col + cell.colSpan; c++) occupied[i].add(c);
      }
      const free = [];
      for (let c = 0; c < total; c++) if (!occupied[i].has(c)) free.push(c);
      for (const cell of cells) {
        if (cell.hasAttribute(ORIG)) continue;
        const col = free.shift() ?? total;
        cell.removeAttribute(HIDDEN);
        cell.setAttribute(ORIG, String(col));
        for (let c = col; c < col + cell.colSpan; c++) occupied[i].add(c);
      }
      for (const cell of cells) {
        const col = originalColumn(cell);
        const lastRow = cell.rowSpan === 0 ? sectionEnd : Math.min(i + cell.rowSpan - 1, sectionEnd);
        for (let r = i + 1; r <= lastRow; r++) {
          for (let c = col; c < col + cell.colSpan; c++) occupied[r].add(c);
        }
      }
    });
    rememberHeaderOrder(table, headerCells);
  }

  // 見出しのセルが作り直されても、並び替え済みの DOM 順から元の列番号を誤って付けないよう、
  // 元の見出し順を表ごとに覚えておく
  function tagHeaderFromMemo(table, headerCells) {
    const memo = headerMemo.get(table);
    const texts = headerCells.map((cell) => normalize(cell.textContent));
    if (!memo || memo.length !== texts.length) return;
    if ([...memo].sort().join('\n') !== [...texts].sort().join('\n')) return;
    if (new Set(memo).size !== memo.length) return;
    headerCells.forEach((cell, i) => {
      if (!cell.hasAttribute(ORIG)) cell.setAttribute(ORIG, String(memo.indexOf(texts[i])));
    });
  }

  function rememberHeaderOrder(table, headerCells) {
    const sorted = [...headerCells].sort((a, b) => originalColumn(a) - originalColumn(b));
    headerMemo.set(table, sorted.map((cell) => normalize(cell.textContent)));
  }

  function originalColumn(cell) {
    return Number(cell.getAttribute(ORIG));
  }

  // 見出しの文字で列を特定する。同名の見出しは #2, #3 … を付けて区別する
  function headerKeys(table) {
    const headerRow = table.tHead?.rows[0] ?? table.rows[0];
    if (!headerRow) return null;
    const keys = [];
    const seen = new Map();
    for (const cell of [...headerRow.cells].sort((a, b) => originalColumn(a) - originalColumn(b))) {
      let key = normalize(cell.textContent) || `列${originalColumn(cell) + 1}`;
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count > 1) key += `#${count}`;
      keys[originalColumn(cell)] = key;
    }
    return keys;
  }

  // 基本情報の出走表だけを対象にする。
  // 見出しが1段で colspan がなく、競走得点の列がある表に限る。
  // EXデータ・直近成績は見出しが2段や colspan 付きで列の対応が取れず、
  // 対戦成績は選手どうしの縦横の表で、列を入れ替える意味がない
  function isRacecard(table) {
    const headerRow = table.tHead?.rows[0] ?? table.rows[0];
    if (!headerRow || headerRow.cells.length <= LOCKED_COLUMNS) return false;
    if (table.tHead && table.tHead.rows.length !== 1) return false;
    if ([...headerRow.cells].some((cell) => cell.colSpan > 1)) return false;
    const texts = [...headerRow.cells].map((cell) => normalize(cell.textContent));
    return texts[2] === '選手名' && texts.includes('競走得点');
  }

  // config.order に従った並び順 (固定列を除く)。config に無い列は元の順で後ろに付く
  function orderedKeys(keys) {
    const movable = keys.slice(LOCKED_COLUMNS);
    return [
      ...config.order.filter((key) => movable.includes(key)),
      ...movable.filter((key) => !config.order.includes(key)),
    ];
  }

  function applyToTable(table) {
    tagOriginalColumns(table);
    const keys = headerKeys(table);
    if (!keys) return;
    const rank = new Map(orderedKeys(keys).map((key, i) => [key, LOCKED_COLUMNS + i]));
    const rankOf = (cell) => {
      const col = originalColumn(cell);
      return col < LOCKED_COLUMNS ? col : (rank.get(keys[col]) ?? col);
    };

    for (const row of table.rows) {
      const cells = [...row.cells];
      const sorted = [...cells].sort((a, b) => rankOf(a) - rankOf(b));
      if (sorted.some((cell, i) => cell !== cells[i])) {
        for (const cell of sorted) row.appendChild(cell);
      }
      for (const cell of cells) {
        const col = originalColumn(cell);
        const hide = col >= LOCKED_COLUMNS && config.hidden.includes(keys[col]);
        if (hide !== cell.hasAttribute(HIDDEN)) cell.toggleAttribute(HIDDEN, hide);
      }
      markSeams(cells.filter((cell) => !cell.hasAttribute(HIDDEN)).sort((a, b) => rankOf(a) - rankOf(b)));
    }
  }

  // サイトは列ごとの左右の罫線でグループを区切っている。並びが元と変わった境目には線がなくなるので、足す
  function markSeams(visible) {
    visible.forEach((cell, i) => {
      const col = originalColumn(cell);
      const sides = [];
      if (i > 0 && originalColumn(visible[i - 1]) !== col - 1) sides.push('l');
      if (i < visible.length - 1 && originalColumn(visible[i + 1]) !== col + 1) sides.push('r');
      const value = sides.join(' ');
      if (value) {
        if (cell.getAttribute(SEAM) !== value) cell.setAttribute(SEAM, value);
      } else if (cell.hasAttribute(SEAM)) {
        cell.removeAttribute(SEAM);
      }
    });
  }

  function scrollContainer(table) {
    for (let el = table.parentElement; el && el !== document.body; el = el.parentElement) {
      if (['auto', 'scroll'].includes(getComputedStyle(el).overflowX)) return el;
    }
    return table.parentElement;
  }

  // ボタンは表ごとに1つ。タブ切り替えで表が差し替わると古いボタンが残るので、同じ場所の古いものは消す。
  // 左の固定表 (枠・車・選手名) はスクロール領域の親ブロックの上端に絶対配置されているため、
  // ボタンをその中に入れると右の表だけが下がってずれる。ブロックの外 (すぐ上) に置く
  function ensureButton(table) {
    if (buttons.get(table)?.isConnected) return;
    const block = scrollContainer(table).parentElement;
    const stale = block.previousElementSibling;
    if (stale?.classList.contains('wtc-open')) stale.remove();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wtc-open';
    button.textContent = '列を設定';
    button.addEventListener('click', () => openPanel(table));
    block.parentElement.insertBefore(button, block);
    buttons.set(table, button);
    owners.set(button, table);
  }

  function removeOrphanButtons(activeTables) {
    for (const button of document.querySelectorAll('.wtc-open')) {
      if (!activeTables.has(owners.get(button))) button.remove();
    }
  }

  function applyAll() {
    observer?.disconnect();
    try {
      const active = new Set();
      for (const table of document.querySelectorAll('table')) {
        if (!isRacecard(table)) continue;
        applyToTable(table);
        ensureButton(table);
        active.add(table);
      }
      removeOrphanButtons(active);
    } finally {
      observer?.observe(document.body, { childList: true, subtree: true });
    }
  }

  function save() {
    chrome.storage.local.set({ [STORAGE_KEY]: config });
    applyAll();
  }

  function openPanel(table) {
    const keys = headerKeys(table);
    if (!keys) return;

    const backdrop = document.createElement('div');
    backdrop.className = 'wtc-backdrop';
    const panel = document.createElement('div');
    panel.className = 'wtc-panel';
    backdrop.append(panel);

    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });

    const render = () => {
      panel.replaceChildren();

      const title = document.createElement('h2');
      title.textContent = '列の設定';
      const hint = document.createElement('p');
      hint.className = 'wtc-hint';
      hint.textContent = 'ドラッグか ▲▼ で並び替え。チェックを外すと非表示。';
      const list = document.createElement('ul');
      list.className = 'wtc-list';

      for (const key of keys.slice(0, LOCKED_COLUMNS)) {
        const item = document.createElement('li');
        item.className = 'wtc-item wtc-locked';
        item.textContent = `${key}（固定）`;
        list.append(item);
      }

      const order = orderedKeys(keys);
      const commit = (next) => {
        config.order = next;
        save();
        render();
      };
      let dragIndex = -1;

      order.forEach((key, index) => {
        const item = document.createElement('li');
        item.className = 'wtc-item';
        item.draggable = true;

        const handle = document.createElement('span');
        handle.className = 'wtc-handle';
        handle.textContent = '⠿';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !config.hidden.includes(key);
        checkbox.addEventListener('change', () => {
          const hidden = new Set(config.hidden);
          if (checkbox.checked) hidden.delete(key);
          else hidden.add(key);
          config.hidden = [...hidden];
          save();
        });

        const label = document.createElement('span');
        label.className = 'wtc-label';
        label.textContent = key;

        const move = (delta) => {
          const target = index + delta;
          if (target < 0 || target >= order.length) return;
          const next = [...order];
          [next[index], next[target]] = [next[target], next[index]];
          commit(next);
        };
        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'wtc-move';
        up.textContent = '▲';
        up.addEventListener('click', () => move(-1));
        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'wtc-move';
        down.textContent = '▼';
        down.addEventListener('click', () => move(1));

        item.addEventListener('dragstart', (event) => {
          dragIndex = index;
          item.classList.add('wtc-dragging');
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', key);
        });
        item.addEventListener('dragend', () => item.classList.remove('wtc-dragging'));
        item.addEventListener('dragover', (event) => {
          event.preventDefault();
          item.classList.add('wtc-over');
        });
        item.addEventListener('dragleave', () => item.classList.remove('wtc-over'));
        item.addEventListener('drop', (event) => {
          event.preventDefault();
          if (dragIndex < 0 || dragIndex === index) return;
          const next = [...order];
          const [moved] = next.splice(dragIndex, 1);
          next.splice(index, 0, moved);
          commit(next);
        });

        item.append(handle, checkbox, label, up, down);
        list.append(item);
      });

      const footer = document.createElement('div');
      footer.className = 'wtc-footer';
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.textContent = '初期状態に戻す';
      reset.addEventListener('click', () => {
        config = clone(DEFAULT_CONFIG);
        save();
        render();
      });
      const done = document.createElement('button');
      done.type = 'button';
      done.textContent = '閉じる';
      done.addEventListener('click', close);
      footer.append(reset, done);

      panel.append(title, hint, list, footer);
    };

    render();
    document.body.append(backdrop);
  }

  function loadConfig(stored) {
    if (stored && isStringArray(stored.order) && isStringArray(stored.hidden)) {
      config = { order: stored.order, hidden: stored.hidden };
    } else {
      config = clone(DEFAULT_CONFIG);
    }
  }

  // 描画の前に直すため、デバウンスせずに変更を受けた直後に適用する
  observer = new MutationObserver(applyAll);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    loadConfig(changes[STORAGE_KEY].newValue);
    applyAll();
  });
  chrome.storage.local.get(STORAGE_KEY).then((result) => {
    loadConfig(result[STORAGE_KEY]);
    applyAll();
  });
})();
