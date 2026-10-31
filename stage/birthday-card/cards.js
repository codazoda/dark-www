(() => {
  'use strict';
  const colors = ['coral', 'gold', 'pearl', 'blue', 'purple', 'teal'];
  const printCards = [
    ['single', 'Single balloon', 'One bright thought, plenty of room'],
    ['bouquet', 'Bouquet', 'A small gathering of color'],
    ['fifty', 'Floating 50', 'A golden milestone'],
    ['confetti', 'Confetti edge', 'A quiet little celebration'],
    ['heart', 'Ribbon heart', 'Tied together with love'],
    ['six', 'Six colors', 'The whole bouquet in an arc']
  ];
  const eCards = [
    ['rise', 'Gentle rise', 'Balloons on their way up'],
    ['reveal', 'Bouquet reveal', 'A greeting that blooms'],
    ['golden', 'Golden 50', 'A softly shining milestone'],
    ['release', 'Tap to release', 'Send the balloons skyward'],
    ['ribbons', 'Ribbon drawing', 'A heart drawn in ribbon'],
    ['field', 'Celebration field', 'Color and a little confetti']
  ];
  const balloon = (color, left, top, size = '', tilt = 0, delay = 0) =>
    `<i class="balloon ${color} ${size}" style="left:${left}%;top:${top}%;--tilt:${tilt}deg;animation-delay:${delay}s"></i>`;
  const confetti = (count = 18) => Array.from({length: count}, (_, i) => {
    const edge = i % 2 ? 4 + (i * 17) % 92 : 7 + (i * 29) % 86;
    const x = i % 2 ? edge : (i % 4 ? 94 : 4);
    const y = i % 2 ? (i % 4 ? 5 : 92) : edge;
    return `<i class="confetti" style="left:${x}%;top:${y}%;--c:var(--${colors[i % 6]});--r:${i * 31}deg"></i>`;
  }).join('');
  const greeting = '<div class="art-greeting">Happy Birthday</div>';

  function art(kind, small = false) {
    const s = small ? 'tiny' : 'small';
    const bouquet = [balloon('coral',39,37,s,-8), balloon('gold',51,28,s,2), balloon('blue',61,39,s,8), balloon('purple',46,47,s,-3), balloon('teal',57,51,s,4)];
    const designs = {
      single: balloon('coral',50,35,'',1) + greeting,
      bouquet: bouquet.join('') + greeting,
      fifty: '<strong class="fifty">50</strong>' + balloon('gold',34,29,s,-4) + balloon('gold',67,30,s,5) + greeting,
      confetti: balloon('coral',44,34,s,-4) + balloon('gold',57,39,s,5) + confetti(small ? 12 : 24) + greeting,
      heart: balloon('coral',37,29,s,8) + balloon('purple',64,29,s,-8) + '<svg class="ribbon-heart" viewBox="0 0 160 130" aria-hidden="true"><path d="M18 4 C18 55 31 104 80 125 C129 104 142 55 142 4" fill="none" stroke="#a36f78" stroke-width="1.5"/></svg>' + greeting,
      six: colors.map((c,i) => balloon(c,20 + i * 12, 31 + Math.abs(2.5-i)*4,s,(i-2.5)*3)).join('') + greeting
    };
    return designs[kind] || designs.single;
  }

  function renderGallery() {
    const make = (item, digital) => `<a class="preview" href="${digital ? 'card' : 'print'}.html?design=${item[0]}"><div class="preview-art">${art(digital && item[0] === 'golden' ? 'fifty' : digital && item[0] === 'field' ? 'six' : digital && item[0] === 'ribbons' ? 'heart' : digital && item[0] === 'release' ? 'bouquet' : item[0], true)}</div><h3>${item[1]}</h3><p>${item[2]}</p></a>`;
    document.querySelector('#print-grid').innerHTML = printCards.map(x => make(x, false)).join('');
    document.querySelector('#digital-grid').innerHTML = eCards.map(x => make(x, true)).join('');
  }

  function selected(valid, fallback) {
    const key = new URLSearchParams(location.search).get('design');
    return valid.some(x => x[0] === key) ? key : fallback;
  }

  function renderPrint() {
    const kind = selected(printCards, 'single');
    const data = printCards.find(x => x[0] === kind);
    document.title = `${data[1]} — Printable birthday card`;
    document.querySelector('.front').className = `front design-${kind}`;
    document.querySelector('.front').innerHTML = art(kind);
    document.querySelector('.front .art-greeting').style.top = kind === 'fifty' ? '72%' : '68%';
  }

  function renderEcard() {
    const kind = selected(eCards, 'rise');
    const root = document.querySelector('#ecard');
    root.className = `ecard ${kind}${kind === 'release' ? ' release-card' : ''}`;
    const artEl = root.querySelector('.ecard-art');
    const positions = [[14,24],[84,22],[25,75],[75,74],[48,18],[53,81]];
    if (kind === 'golden') root.querySelector('.age').textContent = '50';
    if (kind === 'ribbons') {
      artEl.innerHTML = balloon('coral',22,24,'small',-4) + balloon('purple',78,24,'small',4) + '<svg class="heart-line" viewBox="0 0 200 180"><path d="M100 170 C35 132 7 93 21 51 C33 15 76 15 100 49 C124 15 167 15 179 51 C193 93 165 132 100 170"/></svg>';
    } else if (kind === 'release') {
      artEl.innerHTML = colors.slice(0,5).map((c,i) => balloon(c,24+i*13,23+Math.abs(2-i)*8,'small',(i-2)*4,i*.08)).join('');
      root.querySelector('.greeting').insertAdjacentHTML('beforeend', '<button class="release-button" type="button">Release the balloons</button>');
      root.querySelector('.release-button').addEventListener('click', e => { root.classList.add('released'); e.currentTarget.textContent = 'Up they go!'; e.currentTarget.disabled = true; });
    } else if (kind === 'reveal') {
      artEl.innerHTML = colors.slice(0,5).map((c,i) => balloon(c,32+i*9,68-Math.abs(2-i)*5,'small',(i-2)*5,i*.16)).join('');
    } else {
      const chosen = kind === 'rise' ? positions.slice(0,4) : positions;
      artEl.innerHTML = chosen.map((p,i) => balloon(colors[i],p[0],p[1],i%3 ? 'small' : '',(i-2)*3,i*.25)).join('') + (kind === 'field' ? confetti(22) : '');
    }
  }

  if (document.querySelector('#print-grid')) renderGallery();
  if (document.body.classList.contains('print-view')) renderPrint();
  if (document.body.classList.contains('ecard-view')) renderEcard();
})();
