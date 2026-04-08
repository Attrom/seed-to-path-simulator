export function updateInfoBar(result, container) {
  container.innerHTML = '';
  const tag = (cls, text) => {
    const s = document.createElement('span');
    s.className = 'tag ' + cls;
    s.textContent = text;
    container.appendChild(s);
  };
  tag('tag-neutral', `Seed: ${result.seed}`);
  tag('tag-neutral', `Ticks: ${result.ticks}`);
  tag(result.landed ? 'tag-win' : 'tag-loss',
    result.landed ? `Win  ${result.totalMult.toFixed(2)}\u00d7` : 'Loss  0\u00d7');
  tag('tag-neutral', `Bonuses hit: ${result.collected.length}`);
  tag('tag-neutral', `Bonuses missed: ${result.missed.length}`);
  tag('tag-neutral', `Peak alt: ${Math.round(result.peakAlt)}`);
}

export function updateEventsStrip(result, container) {
  container.innerHTML = '';
  result.events.forEach((ev, i) => {
    if (i > 0) {
      const arr = document.createElement('span');
      arr.className = 'ev-arrow';
      arr.textContent = '\u2192';
      container.appendChild(arr);
    }
    const el = document.createElement('span');
    const START_EV = ['takeoff', 'kickoff'];
    const WIN_EV   = ['landed', 'goal'];
    const LOSS_EV  = ['crashed', 'saved'];
    if (START_EV.includes(ev.label))      el.className = 'ev ev-start';
    else if (WIN_EV.includes(ev.label))   el.className = 'ev ev-end-win';
    else if (LOSS_EV.includes(ev.label))  el.className = 'ev ev-end-crash';
    else el.className = ev.isLoss ? 'ev ev-loss' : 'ev ev-gain';
    el.textContent = ev.label + ' ' + ev.mult.toFixed(2) + '\u00d7';
    container.appendChild(el);
  });
}

export function updateLegend(container) {
  container.innerHTML = '';
  const item = (color, text) => {
    const s = document.createElement('span');
    s.innerHTML = `<span class="legend-dot" style="background:${color}"></span> ${text}`;
    container.appendChild(s);
  };
  item('#4090e0', 'Path 1-1.5\u00d7');
  item('#60d870', 'Path 1.5-3\u00d7');
  item('#f0b020', 'Path 3-10\u00d7');
  item('#ff6a4a', 'Path 10\u00d7+');
  item('#30a050', '+N collected');
  item('#d0a020', 'xN collected');
  item('#c03030', 'x0.5 / rocket');
  item('#6080a0', 'Missed (dim)');
}

export function renderResultsTable(results, container) {
  container.innerHTML = '';
  if (results.length === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#4a5580">No seeds matched the filters.</div>';
    return null;
  }

  const table = document.createElement('table');
  table.className = 'results-table';

  const cols = [
    { key: 'seed',            label: 'Seed',      align: 'num-right' },
    { key: 'objectsHit',      label: 'Hits',      align: 'num-right' },
    { key: 'outcome',         label: 'Outcome',   align: '' },
    { key: 'finalMultiplier', label: 'Final Mult', align: 'num-right' },
    { key: 'totalMultiplier', label: 'Total Mult', align: 'num-right' },
    { key: 'distance',        label: 'Distance',   align: 'num-right' },
    { key: 'peakAltitude',    label: 'Peak Alt',   align: 'num-right' },
    { key: 'ticks',           label: 'Ticks',      align: 'num-right' },
    { key: 'hitsPerTick',     label: 'Hits/Tick',  align: 'num-right' },
  ];

  let sortCol = 'seed';
  let sortAsc = true;

  function sortAndRender() {
    results.sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol];
      if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });

    const thead = table.querySelector('thead');
    for (const th of thead.querySelectorAll('th')) {
      const arrow = th.querySelector('.sort-arrow');
      const col = th.dataset.col;
      arrow.textContent = col === sortCol ? (sortAsc ? '\u25b2' : '\u25bc') : '';
    }

    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    for (const r of results) {
      const tr = document.createElement('tr');
      tr.className = r.outcome === 'win' ? 'row-win' : 'row-crash';
      tr.dataset.seed = r.seed;

      for (const col of cols) {
        const td = document.createElement('td');
        if (col.align) td.className = col.align;
        const v = r[col.key];
        if (col.key === 'outcome') {
          td.className = v === 'win' ? 'outcome-win' : 'outcome-crash';
          td.textContent = v.toUpperCase();
        } else if (typeof v === 'number' && !Number.isInteger(v)) {
          td.textContent = v < 0.1 ? v.toFixed(4) : v.toFixed(2);
        } else {
          td.textContent = v;
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const col of cols) {
    const th = document.createElement('th');
    th.dataset.col = col.key;
    th.innerHTML = `${col.label}<span class="sort-arrow"></span>`;
    th.addEventListener('click', () => {
      if (sortCol === col.key) sortAsc = !sortAsc;
      else { sortCol = col.key; sortAsc = true; }
      sortAndRender();
    });
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  table.appendChild(tbody);

  container.appendChild(table);
  sortAndRender();
  return table;
}
