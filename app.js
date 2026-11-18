/* Общий движок сайтов «Чита»: табло свободных часов, цены, окно записи, заявка на расчёт, cookie.
   Вёрстка и оформление у каждого сайта свои; движок ищет в странице элементы по id и классам (см. build.mjs). */
var WORKER_URL = 'https://zastudio-zayavki.kenny-ki.workers.dev';
var STEP = 60; // запись начинается с целого часа
var DAYKEYS = {'Пн':1,'Вт':2,'Ср':3,'Чт':4,'Пт':5,'Сб':6,'Вс':0};

// Часы дня: «10:00-21:00» или с перерывом «10:00-12:00, 13:00-21:00». Результат — [[начало, конец], ...] в часах.
function parseDay(v){
  var out = [], parts = String(v).split(',');
  for (var i = 0; i < parts.length; i++){
    var m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(parts[i].trim());
    if (!m) return null;
    out.push([+m[1] + m[2] / 60, +m[3] + m[4] / 60]);
  }
  return out;
}
function parseHours(o){
  var r = {};
  Object.keys(o).forEach(function(k){
    var iv = k in DAYKEYS && String(o[k]).trim() && parseDay(o[k]);
    if (iv && iv.length) r[DAYKEYS[k]] = iv;
  });
  return r;
}
function fits(iv, start, dur){ return iv.some(function(i){ return start >= i[0] * 60 && start + dur <= i[1] * 60; }); }
function el(t, c, x){ var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
function money(n){ return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }
function p2(n){ return ('0' + n).slice(-2); }
function hm(m){ return p2(Math.floor(m / 60)) + ':' + (m % 60 ? '30' : '00'); }
function cells(start, dur){ var o = []; for (var m = start; m < start + dur; m += 30) o.push(hm(m)); return o; }
function isoOf(d){ return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
function fullDate(d){ return d.toLocaleDateString('ru-RU', {weekday:'long', day:'numeric', month:'long'}); }
function nowMin(){ var n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
function fmtMin(n){ return n < 60 ? n + ' мин' : (n % 60 ? Math.floor(n / 60) + ' ч ' + (n % 60) + ' мин' : Math.floor(n / 60) + ' ч'); }

// Выезжающая форма
var book = document.getElementById('book'), drawer = document.getElementById('drawer'), lastFocus = null, api = null;
function openBook(opts){
  lastFocus = document.activeElement;
  document.body.classList.add('lock'); book.classList.add('open'); drawer.setAttribute('aria-hidden', 'false');
  if (api) api.prefill(opts || {});
  setTimeout(function(){ document.getElementById('dtitle').focus({preventScroll: true}); }, 350);
}
function closeBook(){
  document.body.classList.remove('lock'); book.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true');
  if (lastFocus) lastFocus.focus({preventScroll: true});
}
document.addEventListener('click', function(e){
  var b = e.target.closest('[data-book]');
  if (b){ e.preventDefault(); openBook({service: b.dataset.service, level: b.dataset.level, date: b.dataset.date, time: b.dataset.time}); }
});
document.getElementById('ovl').onclick = closeBook;
document.getElementById('dclose').onclick = closeBook;
document.getElementById('again').onclick = closeBook;
document.addEventListener('keydown', function(e){
  if (!book.classList.contains('open')) return;
  if (e.key === 'Escape') closeBook();
  if (e.key === 'Tab'){ // фокус не уходит из формы
    var f = drawer.querySelectorAll('button,input,select,textarea,a[href],summary'), v = [].filter.call(f, function(x){ return x.offsetParent; });
    if (!v.length) return;
    if (e.shiftKey && document.activeElement === v[0]){ e.preventDefault(); v[v.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === v[v.length - 1]){ e.preventDefault(); v[0].focus(); }
  }
});

// Занятые получасы по постам и дням: общий запас для табло и формы
var busy = {}, pending = {};
function loadBusy(mid, iso, done){
  var key = mid + '|' + iso;
  if (Array.isArray(busy[key])){ done(); return; }
  if (pending[key]){ pending[key].push(done); return; }
  pending[key] = [done];
  fetch(WORKER_URL + '?master=' + mid + '&date=' + iso, {cache: 'no-store'})
    .then(function(r){ return r.ok ? r.json() : Promise.reject(); })
    .then(function(a){ busy[key] = a; })
    .catch(function(){ busy[key] = 'err'; })
    .then(function(){ var cbs = pending[key]; delete pending[key]; cbs.forEach(function(f){ f(); }); });
}

function start(CFG){
initCookies(CFG.metrika);
var AHEAD = CFG.ahead, SHOP = CFG.shop, LEVELS = CFG.levels, SERVICES = CFG.services;
var POSTS = CFG.masters.map(function(m){ return {id: m.id, name: m.name, h: parseHours(m.hours)}; }).filter(function(m){ return Object.keys(m.h).length; });
function hasMin(s){ return LEVELS.some(function(l){ return s.prices[l] && s.prices[l].minutes; }); }
var BOOK = SERVICES.filter(function(s){ return !s.request && hasMin(s); });
var REQ = SERVICES.filter(function(s){ return s.request; });
var MAIN = SERVICES.filter(function(s){ return BOOK.indexOf(s) >= 0 || s.request; });
var EXTRAS = SERVICES.filter(function(s){ return MAIN.indexOf(s) < 0; });
var HAS_BOOK = BOOK.length > 0 && POSTS.length > 0;
function svcByName(n){ return SERVICES.filter(function(s){ return s.name === n; })[0]; }
function pOf(s, l){ return s && s.prices[l] ? s.prices[l] : null; }
function known(p){ return p && p.price != null; }
function minPrice(s){ var v = LEVELS.map(function(l){ var p = pOf(s, l); return known(p) ? p.price : Infinity; }); return Math.min.apply(null, v); }
function maxPrice(s){ var v = LEVELS.map(function(l){ var p = pOf(s, l); return known(p) ? p.price : -Infinity; }); return Math.max.apply(null, v); }
function priceLine(p){ return !p ? '—' : (p.price == null ? 'уточнить' : (p.from ? 'от ' : '') + money(p.price)); }

document.body.dataset.mode = HAS_BOOK ? (REQ.length ? 'mixed' : 'booking') : 'request';
if (!HAS_BOOK){ [].forEach.call(document.querySelectorAll('[data-board]'), function(n){ n.remove(); }); }
if (!EXTRAS.length){ [].forEach.call(document.querySelectorAll('[data-extras]'), function(n){ n.remove(); }); }

// Контакты и часы из настроек
document.getElementById('c-hrs').textContent = SHOP.hours.map(function(r){ return r[0] + ' ' + r[1]; }).join(', ');
var telHref = 'tel:' + SHOP.phone.replace(/[^\d+]/g, '');
var tel = document.getElementById('c-tel'); tel.textContent = SHOP.phone.replace(/[()]/g, '').replace(/\s+/g, ' '); tel.href = telHref;
var ht = document.getElementById('h-tel'); if (ht){ ht.textContent = SHOP.phone; ht.href = telHref; }
var ca = document.getElementById('c-addr'); if (ca){ ca.textContent = SHOP.address; ca.href = 'https://yandex.ru/maps/?text=' + encodeURIComponent(SHOP.address); }
var links = document.getElementById('c-links');
if (links) [['vk', 'ВКонтакте'], ['tg', 'Telegram'], ['wa', 'WhatsApp']].forEach(function(k){
  if (SHOP[k[0]] && /^https:\/\//.test(SHOP[k[0]])){ var a = el('a', '', k[1]); a.href = SHOP[k[0]]; a.target = '_blank'; a.rel = 'noopener'; links.appendChild(a); }
});

// ---- цены: уровень (класс авто) меняет цены в карточках ----
var curLevel = LEVELS[0];
var chipsEl = document.getElementById('chips'), plansEl = document.getElementById('plans'), planEls = [];
MAIN.forEach(function(s, i){
  var c = el('div', 'plan' + (s.request ? ' req' : '') + (i % 2 ? ' alt' : ''));
  c.appendChild(el('h3', '', s.name));
  if (s.desc) c.appendChild(el('p', '', s.desc));
  var pr = el('div', 'price'); c.appendChild(pr);
  var tm = el('span', 'time'); c.appendChild(tm);
  var bt = el('button', 'btn', s.request ? 'Рассчитать' : 'Записаться'); bt.type = 'button'; bt.dataset.book = ''; bt.dataset.service = s.name; c.appendChild(bt);
  plansEl.appendChild(c); planEls.push({s: s, pr: pr, tm: tm, bt: bt});
});
function setLevel(l){
  curLevel = l;
  [].forEach.call(chipsEl.children, function(b){ b.setAttribute('aria-pressed', b.textContent === l); });
  planEls.forEach(function(x){
    var p = pOf(x.s, l); x.pr.textContent = '';
    if (!p) x.pr.appendChild(el('span', 'ask', 'для этого класса нет'));
    else if (p.price == null) x.pr.appendChild(el('span', 'ask', 'цена уточняется'));
    else {
      if (p.from) x.pr.appendChild(el('span', 'from', 'от '));
      x.pr.appendChild(document.createTextNode(String(p.price).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' '));
      x.pr.appendChild(el('span', 'cur', '₽'));
    }
    x.tm.textContent = x.s.request ? 'по заявке, считаем после осмотра' : (p && p.minutes ? (x.s.estimate ? 'ориентировочно ' : '') + fmtMin(p.minutes) : 'по записи');
    x.bt.dataset.level = l;
  });
}
if (LEVELS.length > 1) LEVELS.forEach(function(l){ var b = el('button', '', l); b.type = 'button'; b.onclick = function(){ setLevel(l); }; chipsEl.appendChild(b); });
else chipsEl.hidden = true;
setLevel(curLevel);

// ---- список допуслуг ----
var xl = document.getElementById('extras-list');
if (xl && EXTRAS.length){
  var GR = [];
  EXTRAS.forEach(function(s){ if (GR.indexOf(s.group || 'Другое') < 0) GR.push(s.group || 'Другое'); });
  GR.forEach(function(g){
    xl.appendChild(el('h3', '', g)); var ul = el('ul');
    EXTRAS.filter(function(s){ return (s.group || 'Другое') === g; }).forEach(function(s){
      var lo = minPrice(s), hi = maxPrice(s), li = el('li');
      li.appendChild(el('span', '', s.name));
      li.appendChild(el('b', '', lo === Infinity ? 'уточнить' : (lo < hi ? 'от ' : '') + money(lo)));
      if (s.desc) li.appendChild(el('small', '', s.desc)); ul.appendChild(li);
    });
    xl.appendChild(ul);
  });
}

// ---- свободное время: часы поста с перерывом, несколько постов ----
var base = new Date(); base = new Date(base.getFullYear(), base.getMonth(), base.getDate());
function dayAt(k){ return new Date(base.getFullYear(), base.getMonth(), base.getDate() + k); }
function minutesOf(s){ var a = LEVELS.map(function(l){ var p = pOf(s, l); return p && p.minutes ? p.minutes : Infinity; }); return Math.min.apply(null, a); }
var DUR = HAS_BOOK ? Math.min.apply(null, BOOK.map(minutesOf)) : 60;
function startsFor(d, dur){ // все возможные начала на день: хотя бы у одного поста услуга помещается в промежуток
  var set = {};
  POSTS.forEach(function(p){ var iv = p.h[d.getDay()]; if (!iv) return;
    iv.forEach(function(i){ for (var m = i[0] * 60; m + dur <= i[1] * 60; m += STEP) set[m] = 1; }); });
  return Object.keys(set).map(Number).sort(function(a, b){ return a - b; });
}
function freeAt(iso, d, m, dur){ // свободен ли хотя бы один пост
  return POSTS.some(function(p){
    var iv = p.h[d.getDay()]; if (!iv || !fits(iv, m, dur)) return false;
    var b = busy[p.id + '|' + iso];
    return Array.isArray(b) && cells(m, dur).every(function(c){ return b.indexOf(c) < 0; });
  });
}
function dayStatus(iso){ // 'err' — хоть один пост не ответил, 'wait' — ещё грузится, 'ok'
  var st = 'ok';
  POSTS.forEach(function(p){ var b = busy[p.id + '|' + iso]; if (b === 'err') st = 'err'; else if (!Array.isArray(b) && st !== 'err') st = 'wait'; });
  return st;
}
function loadDay(iso, done){
  var left = POSTS.length;
  POSTS.forEach(function(p){ loadBusy(p.id, iso, function(){ if (--left === 0) done(); }); });
}
var tabs = document.getElementById('days-tabs'), rowsEl = document.getElementById('rows'), boardDay = 0;
function renderBoard(){
  if (!HAS_BOOK || !rowsEl) return;
  var k = boardDay, d = dayAt(k), iso = isoOf(d), st = dayStatus(iso), starts = startsFor(d, DUR);
  rowsEl.innerHTML = '';
  if (!starts.length){ rowsEl.appendChild(el('span', 'hour wait', 'В этот день мы не принимаем')); return; }
  if (st === 'err'){ rowsEl.appendChild(el('p', 'note', 'Не удалось загрузить расписание. Позвоните: ' + SHOP.phone)); return; }
  starts.forEach(function(m){
    var t = hm(m), past = k === 0 && m < nowMin() + 30, x;
    var free = st === 'ok' && !past && freeAt(iso, d, m, DUR);
    if (free){
      x = el('button', 'hour free', t); x.type = 'button'; x.dataset.book = ''; x.dataset.date = iso; x.dataset.time = t;
      x.setAttribute('aria-label', 'Записаться на ' + t + ', ' + fullDate(d));
    } else {
      x = el('span', 'hour ' + (past ? 'past' : st === 'ok' ? 'busy' : 'wait'), t);
      x.setAttribute('aria-label', t + ': ' + (past ? 'прошло' : st === 'ok' ? 'занято' : 'загружаем'));
    }
    rowsEl.appendChild(x);
  });
  if (st === 'wait') loadDay(iso, function(){ if (boardDay === k) renderBoard(); });
}
if (HAS_BOOK && tabs){
  // лента часов: на узком экране листается колёсиком мыши и перетаскиванием
  rowsEl.addEventListener('wheel', function(e){
    var max = rowsEl.scrollWidth - rowsEl.clientWidth;
    if (max <= 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if ((e.deltaY < 0 && rowsEl.scrollLeft <= 0) || (e.deltaY > 0 && rowsEl.scrollLeft >= max)) return;
    e.preventDefault(); rowsEl.scrollLeft += e.deltaY;
  }, {passive: false});
  (function(){
    var down = false, sx = 0, sl = 0, moved = false;
    rowsEl.addEventListener('pointerdown', function(e){ if (e.pointerType !== 'mouse' || e.button !== 0) return; down = true; moved = false; sx = e.clientX; sl = rowsEl.scrollLeft; });
    window.addEventListener('pointermove', function(e){
      if (!down) return; var dx = e.clientX - sx;
      if (!moved && Math.abs(dx) > 5){ moved = true; rowsEl.classList.add('drag'); }
      if (moved) rowsEl.scrollLeft = sl - dx;
    });
    window.addEventListener('pointerup', function(){ if (!down) return; down = false; setTimeout(function(){ rowsEl.classList.remove('drag'); }, 0); });
  })();
  ['Сегодня', 'Завтра', 'Послезавтра'].forEach(function(name, k){
    var b = el('button', '', name); b.type = 'button';
    b.setAttribute('aria-label', name + ', ' + dayAt(k).toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'}));
    b.setAttribute('aria-pressed', k === 0);
    b.onclick = function(){ boardDay = k; [].forEach.call(tabs.children, function(x, i){ x.setAttribute('aria-pressed', i === k); }); renderBoard(); };
    tabs.appendChild(b);
  });
  // если сегодня уже ничего не осталось, открываем завтра
  var left0 = startsFor(base, DUR).filter(function(m){ return m >= nowMin() + 30; });
  if (!left0.length){ boardDay = 1; [].forEach.call(tabs.children, function(x, i){ x.setAttribute('aria-pressed', i === 1); }); }
  renderBoard();
  setInterval(function(){ if (!document.hidden && !book.classList.contains('open')){ busy = {}; renderBoard(); } }, 60000);
}

// ---- форма записи ----
var form = document.getElementById('f');
var nameEl = form.elements['name'], phoneEl = form.elements['phone'];
var levelEl = document.getElementById('level'), svcEl = document.getElementById('svc'), exEl = document.getElementById('ex');
var selDate = null, selTime = null, DAYS = [], byIso = {};
LEVELS.forEach(function(l){ var o = el('option', '', l); o.value = l; levelEl.appendChild(o); });
if (LEVELS.length < 2) document.getElementById('lvl-wrap').hidden = true;
if (!EXTRAS.length) document.getElementById('more').hidden = true;
function curSvc(){ return svcByName(svcEl.value); }
function isReq(){ var s = curSvc(); return !!(s && s.request); }
function curMin(){ var p = pOf(curSvc(), levelEl.value); return p && p.minutes ? p.minutes : DUR; }
function fillServices(want){
  var keep = want || svcEl.value; svcEl.innerHTML = '';
  // если у услуг заданы две и более группы (категории), список в форме разбивается на группы; без групп он плоский, как раньше
  var groups = MAIN.reduce(function(a, s){ if (s.group && a.indexOf(s.group) < 0) a.push(s.group); return a; }, []), box = {};
  MAIN.forEach(function(s){ var p = pOf(s, levelEl.value); if (!p) return;
    var o = el('option', '', s.name + (s.request ? ' — заявка' : known(p) ? ' — ' + priceLine(p) : '')); o.value = s.name;
    var g = groups.length > 1 ? (s.group || 'Другое') : '';
    if (!g){ svcEl.appendChild(o); return; }
    if (!box[g]){ box[g] = document.createElement('optgroup'); box[g].label = g; svcEl.appendChild(box[g]); }
    box[g].appendChild(o); });
  svcEl.value = keep; if (svcEl.selectedIndex < 0) svcEl.selectedIndex = 0;
}
function fillExtras(){
  var on = chosenExtras(); exEl.innerHTML = '';
  EXTRAS.forEach(function(s){ var p = pOf(s, levelEl.value); if (!p) return;
    var lb = el('label'), cb = el('input'); cb.type = 'checkbox'; cb.value = s.name; cb.checked = on.indexOf(s.name) >= 0; cb.onchange = renderSum;
    lb.appendChild(cb); lb.appendChild(el('span', '', s.name)); lb.appendChild(el('b', '', priceLine(p))); exEl.appendChild(lb); });
}
function chosenExtras(){ return [].map.call(exEl.querySelectorAll('input:checked'), function(i){ return i.value; }); }
// заявка на расчёт: можно отметить сразу несколько услуг (основная в списке, остальные галочками, по категориям, если они заданы)
var exReqEl = document.getElementById('ex-req'), moreReq = document.getElementById('more-req');
var REQS = MAIN.filter(function(s){ return s.request; });
function chosenReq(){ return [].map.call(exReqEl.querySelectorAll('input:checked'), function(i){ return i.value; }); }
function countReq(){ var n = chosenReq().length; document.getElementById('more-req-s').textContent = 'Добавить ещё услуги' + (n ? ' · выбрано ' + n : ''); }
function fillReqExtras(){
  var on = chosenReq(), cur = svcEl.value; exReqEl.innerHTML = '';
  var groups = REQS.reduce(function(a, s){ if (s.group && a.indexOf(s.group) < 0) a.push(s.group); return a; }, []), seen = {};
  REQS.forEach(function(s){ if (s.name === cur) return; var p = pOf(s, levelEl.value); if (!p) return;
    var g = groups.length > 1 ? (s.group || 'Другое') : '';
    if (g && !seen[g]){ seen[g] = 1; exReqEl.appendChild(el('div', 'exh', g)); }
    var lb = el('label'), cb = el('input'); cb.type = 'checkbox'; cb.value = s.name; cb.checked = on.indexOf(s.name) >= 0;
    cb.onchange = function(){ countReq(); renderSum(); };
    lb.appendChild(cb); lb.appendChild(el('span', '', s.name)); lb.appendChild(el('b', '', priceLine(p))); exReqEl.appendChild(lb); });
  countReq();
}
function renderSum(){
  var t = document.getElementById('sum'); t.textContent = '';
  var s = curSvc(), p = pOf(s, levelEl.value); if (!s || !p) return;
  if (s.request){
    // демо-цена (Улан-Удэ, 18.11.2026): у услуги desc «демо-цена» — к сумме звёздочка и пояснение
    var isDemo = function(x){ return !!(x && x.desc && /демо-цена/.test(x.desc)); };
    var more = chosenReq();
    if (more.length){ // несколько услуг: сумма «от» по тем, у кого цена известна
      var tot = 0, unk = 0, dm = false; [s.name].concat(more).forEach(function(n){ var sv = svcByName(n), q = pOf(sv, levelEl.value); if (known(q)){ tot += q.price; if (isDemo(sv)) dm = true; } else unk++; });
      var l1 = el('span', '', 'Выбрано услуг: ' + (more.length + 1)); l1.appendChild(el('small', '', (dm ? '* в сумме есть демо-цены; ' : '') + 'точную стоимость назовём после осмотра' + (unk ? ', у части цена уточняется' : '')));
      t.appendChild(l1); t.appendChild(el('b', tot ? '' : 'ask', tot ? 'от ' + money(tot) + (dm ? '*' : '') : 'цена уточняется')); return;
    }
    var d1 = isDemo(s) && known(p);
    var l0 = el('span', '', 'Стоимость'); l0.appendChild(el('small', '', d1 ? '* демо-цена, точную назовём после осмотра' : 'считаем после осмотра автомобиля')); t.appendChild(l0); t.appendChild(el('b', known(p) ? '' : 'ask', priceLine(p) + (d1 ? '*' : ''))); return; }
  var total = 0, unknown = !known(p), from = !!p.from, ex = chosenExtras();
  if (known(p)) total += p.price;
  ex.forEach(function(n){ var q = pOf(svcByName(n), levelEl.value); if (known(q)){ total += q.price; if (q.from) from = true; } else unknown = true; });
  var l = el('span', '', 'Итого'); l.appendChild(el('small', '', unknown ? 'часть цен уточним при подтверждении' : ex.length ? 'услуга и ' + ex.length + ' доп.' : 'только основная услуга'));
  t.appendChild(l); t.appendChild(el('b', total || !unknown ? '' : 'ask', total || !unknown ? (from ? 'от ' : '') + money(total) : 'цена уточняется'));
}
function syncMode(){ // заявка на расчёт: без дня и времени, но с автомобилем и комментарием
  var r = isReq();
  [].forEach.call(document.querySelectorAll('.only-book'), function(n){ n.hidden = r; });
  [].forEach.call(document.querySelectorAll('.only-req'), function(n){ n.hidden = !r; });
  form.elements['car'].required = r;
  document.getElementById('dtitle-t').textContent = r ? 'Заявка на расчёт' : document.getElementById('dtitle-t').dataset.book;
  form.querySelector('button[type=submit]').textContent = r ? 'Отправить заявку' : 'Записаться';
  document.getElementById('more').hidden = r || !EXTRAS.length;
  moreReq.hidden = !r || REQS.length < 2; if (r) fillReqExtras();
}

nameEl.addEventListener('input', function(){
  var pos = this.selectionStart;
  this.value = this.value.replace(/[^A-Za-zА-Яа-яЁё\s-]/g, '').replace(/(^|[\s-])([a-zа-яё])/g, function(m, a, b){ return a + b.toUpperCase(); });
  this.setSelectionRange(pos, pos);
});
function fmtPhone(v){
  var d = v.replace(/\D/g, '');
  if (d[0] === '7' || d[0] === '8') d = d.slice(1);
  if (d.length > 10 && (d[0] === '7' || d[0] === '8')) d = d.slice(1);
  d = d.slice(0, 10);
  var o = '+7 (' + d.slice(0, 3);
  if (d.length > 3) o += ') ' + d.slice(3, 6);
  if (d.length > 6) o += '-' + d.slice(6, 8);
  if (d.length > 8) o += '-' + d.slice(8, 10);
  return o;
}
phoneEl.addEventListener('focus', function(){ if (!this.value) this.value = '+7 ('; });
phoneEl.addEventListener('input', function(){ this.value = fmtPhone(this.value); });
phoneEl.addEventListener('blur', function(){ if (fmtPhone(this.value) === '+7 (') this.value = ''; });

// Дни: лента на AHEAD дней вперёд, только те, где есть подходящее начало
function buildDays(){
  DAYS = []; byIso = {};
  if (!HAS_BOOK) return;
  var dur = curMin();
  for (var k = 0; k < AHEAD; k++){
    var d = dayAt(k), st = startsFor(d, dur);
    if (k === 0) st = st.filter(function(m){ return m >= nowMin() + 30; });
    if (!st.length) continue;
    var x = {d: d, k: k, iso: isoOf(d)}; DAYS.push(x); byIso[x.iso] = x;
  }
}
function renderDays(){
  var box = document.getElementById('days'); box.innerHTML = '';
  DAYS.forEach(function(x){
    var b = el('button', selDate === x ? 'on' : ''); b.type = 'button';
    b.appendChild(document.createTextNode(x.k === 0 ? 'Сегодня' : x.k === 1 ? 'Завтра' : x.d.toLocaleDateString('ru-RU', {weekday: 'short'})));
    b.appendChild(el('b', '', x.d.getDate()));
    b.setAttribute('aria-label', fullDate(x.d)); b.setAttribute('aria-pressed', selDate === x);
    b.onclick = function(){ pickDay(x); };
    box.appendChild(b);
    if (selDate === x) setTimeout(function(){ box.style.scrollBehavior = 'auto'; box.scrollLeft = Math.max(0, b.offsetLeft - box.offsetLeft - 48); box.style.scrollBehavior = ''; if (window.ddUpdate) window.ddUpdate(); }, 0);
  });
  setTimeout(function(){ if (window.ddUpdate) window.ddUpdate(); }, 0);
}
// Лента дней: на компьютере листается стрелками, колёсиком мыши и перетаскиванием
(function(){
  var box = document.getElementById('days'), pv = document.getElementById('dd-prev'), nx = document.getElementById('dd-next');
  function upd(){ var max = box.scrollWidth - box.clientWidth; pv.hidden = box.scrollLeft <= 4; nx.hidden = box.scrollLeft >= max - 4; }
  function step(dir){ box.scrollBy({left: dir * Math.max(box.clientWidth * 0.8, 160), behavior: 'smooth'}); }
  pv.onclick = function(){ step(-1); }; nx.onclick = function(){ step(1); };
  box.addEventListener('scroll', upd, {passive: true}); window.addEventListener('resize', upd);
  box.addEventListener('wheel', function(e){
    if (box.scrollWidth <= box.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    var max = box.scrollWidth - box.clientWidth;
    if ((e.deltaY < 0 && box.scrollLeft <= 0) || (e.deltaY > 0 && box.scrollLeft >= max)) return; // у края — прокручиваем форму дальше
    e.preventDefault(); box.style.scrollBehavior = 'auto'; box.scrollLeft += e.deltaY; box.style.scrollBehavior = '';
  }, {passive: false});
  var down = false, sx = 0, sl = 0, moved = false;
  box.addEventListener('pointerdown', function(e){ if (e.pointerType !== 'mouse' || e.button !== 0) return; down = true; moved = false; sx = e.clientX; sl = box.scrollLeft; });
  window.addEventListener('pointermove', function(e){
    if (!down) return; var dx = e.clientX - sx;
    if (!moved && Math.abs(dx) > 5){ moved = true; box.classList.add('drag'); }
    if (moved) box.scrollLeft = sl - dx;
  });
  window.addEventListener('pointerup', function(){ if (!down) return; down = false; setTimeout(function(){ box.classList.remove('drag'); }, 0); });
  window.ddUpdate = upd;
})();
function pickDay(x, keepTime){
  selDate = x; if (!keepTime) selTime = null;
  if (!x){ renderDays(); document.getElementById('times').textContent = 'Свободных дней в ближайшее время нет. Позвоните нам.'; return; }
  renderDays(); renderTimes(); loadDay(x.iso, function(){ if (selDate === x) renderTimes(); });
}
function renderTimes(){
  var box = document.getElementById('times'); if (!selDate) return;
  var st = dayStatus(selDate.iso);
  if (st === 'wait'){ box.textContent = 'Загружаем свободное время…'; return; }
  if (st === 'err'){ box.textContent = 'Не удалось загрузить расписание. Позвоните нам.'; return; }
  var dur = curMin();
  box.innerHTML = ''; box.appendChild(el('p', 'picked', fullDate(selDate.d)));
  var grid = el('div', 'slots'), any = false;
  startsFor(selDate.d, dur).forEach(function(m){
    var t = hm(m), past = selDate.k === 0 && m < nowMin() + 30;
    if (past || !freeAt(selDate.iso, selDate.d, m, dur)){ if (selTime === t) selTime = null; return; }
    any = true;
    var btn = el('button', 'slot' + (selTime === t ? ' on' : ''), t); btn.type = 'button';
    btn.setAttribute('aria-pressed', selTime === t);
    btn.onclick = function(){ selTime = t; renderTimes(); };
    grid.appendChild(btn);
  });
  if (any) box.appendChild(grid); else box.appendChild(el('p', '', 'На этот день всё занято. Выберите другой день.'));
}
function refreshAll(){ buildDays(); var x = (selDate && byIso[selDate.iso]) || DAYS[0]; if (!isReq()) pickDay(x); }
levelEl.addEventListener('change', function(){ fillServices(); fillExtras(); renderSum(); syncMode(); refreshAll(); });
svcEl.addEventListener('change', function(){ renderSum(); syncMode(); refreshAll(); });

function showErr(msg){ var e = document.getElementById('err'); e.textContent = msg; e.style.display = 'block'; }
form.addEventListener('submit', async function(e){
  e.preventDefault();
  document.getElementById('err').style.display = 'none';
  var req = isReq();
  if (!req && !selTime){ showErr('Выберите день и время.'); return; }
  var btn = form.querySelector('button[type=submit]'), label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Отправляем...';
  var data = req
    ? {request: true, name: nameEl.value, phone: phoneEl.value, level: levelEl.value, service: svcEl.value, extras: chosenReq(), car: form.elements['car'].value,
       comment: form.elements['comment'].value, consent: form.elements['consent'].checked, hp: form.elements['website'].value}
    : {name: nameEl.value, phone: phoneEl.value, level: levelEl.value, service: svcEl.value, extras: chosenExtras(), master: 'any',
       date: selDate.iso, time: selTime, label: fullDate(selDate.d), consent: form.elements['consent'].checked, hp: form.elements['website'].value};
  try {
    var r = await fetch(WORKER_URL, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
    if (r.status === 409){
      POSTS.forEach(function(p){ delete busy[p.id + '|' + selDate.iso]; }); selTime = null; pickDay(selDate);
      throw new Error('Это время только что заняли. Выберите другое.');
    }
    if (r.status === 429) throw new Error('Слишком много заявок с вашего устройства. Позвоните нам: ' + SHOP.phone);
    if (!r.ok) throw new Error('Не удалось отправить заявку. Позвоните нам, мы запишем вас сразу.');
    document.getElementById('ok-text').textContent = req
      ? 'Мы перезвоним в рабочее время, уточним детали и назовём стоимость.'
      : fullDate(selDate.d) + ', ' + selTime + '. Мы перезвоним и подтвердим время.';
    if (!req){ POSTS.forEach(function(p){ delete busy[p.id + '|' + selDate.iso]; }); renderBoard(); }
    form.style.display = 'none';
    document.getElementById('ok').style.display = 'block';
  } catch (err) {
    showErr(err.message || 'Не удалось отправить заявку. Позвоните нам.');
    btn.disabled = false; btn.textContent = label;
  }
});

fillServices(); fillExtras(); renderSum(); syncMode(); buildDays(); if (!isReq()) pickDay(DAYS[0]);
api = { prefill: function(o){
  if (form.style.display === 'none'){ // после отправленной заявки форма снова пустая
    form.reset(); form.style.display = ''; document.getElementById('ok').style.display = 'none';
  }
  document.getElementById('err').style.display = 'none';
  var lv = o.level || curLevel;
  if (LEVELS.indexOf(lv) >= 0) levelEl.value = lv;
  fillServices(o.service); fillExtras(); renderSum(); syncMode(); buildDays();
  var sb = form.querySelector('button[type=submit]'); sb.disabled = false;
  if (isReq()) return;
  var x = (o.date && byIso[o.date]) || (selDate && byIso[selDate.iso]) || DAYS[0];
  if (o.time) selTime = o.time;
  pickDay(x, !!o.time);
} };
}

// ---- cookie ----
// Правило: до ответа посетителя сайт не ставит ни одного cookie и не загружает ничего стороннего.
// Сам сайт cookie не использует вообще. Единственный источник cookie — Яндекс Метрика (если в config.json задан metrika),
// и она загружается только после «Принять» или включённой галочки «Статистика».
// Окно показывается при первом визите всегда; ответ хранится год (с датой и версией текста), потом спрашиваем снова.
// Сам ответ лежит в localStorage браузера: это не cookie и на сервер не отправляется.
var CC_KEY = 'cookie-consent', CC_VER = 1, CC_DAYS = 365, CC_ID = null, ymLoaded = false;
function ccGet(){
  try {
    var v = JSON.parse(localStorage.getItem(CC_KEY) || 'null');
    if (!v || v.v !== CC_VER || !v.at || (Date.now() - Date.parse(v.at)) > CC_DAYS * 864e5) return null;
    return v;
  } catch (e) { return null; }
}
function ccSet(stats){ try { localStorage.setItem(CC_KEY, JSON.stringify({v: CC_VER, stats: !!stats, at: new Date().toISOString()})); } catch (e) {} }
function hasMetrika(){ return /^\d{5,12}$/.test(String(CC_ID || '')); }
function loadMetrika(){
  if (ymLoaded || !hasMetrika()) return; ymLoaded = true;
  (function(m, e, t, r, i, k, a){ m[i] = m[i] || function(){ (m[i].a = m[i].a || []).push(arguments); }; m[i].l = 1 * new Date();
    k = e.createElement(t); a = e.getElementsByTagName(t)[0]; k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
  })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
  ym(+CC_ID, 'init', {clickmap: true, trackLinks: true, accurateTrackBounce: true});
}
function dropMetrika(){ // отзыв согласия: стираем cookie и записи Метрики в браузере
  document.cookie.split(';').forEach(function(c){
    var n = c.split('=')[0].trim(); if (!/^_ym/.test(n)) return;
    var host = location.hostname.split('.'), doms = ['', location.hostname, '.' + location.hostname];
    for (var i = 1; i < host.length - 1; i++) doms.push('.' + host.slice(i).join('.'));
    doms.forEach(function(d){ document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : ''); });
  });
  try { Object.keys(localStorage).forEach(function(k){ if (/^_ym/.test(k)) localStorage.removeItem(k); }); } catch (e) {}
  try { Object.keys(sessionStorage).forEach(function(k){ if (/^_ym/.test(k)) sessionStorage.removeItem(k); }); } catch (e) {}
}
function ccDecide(stats){
  var was = ccGet(); ccSet(stats);
  var b = document.getElementById('cc'); if (b) b.remove();
  if (stats) loadMetrika();
  else if (was && was.stats){ dropMetrika(); location.reload(); } // Метрика уже работала — выгружаем её перезагрузкой
}
function cookieBanner(){
  var old = document.getElementById('cc'); if (old) old.remove();
  var cur = ccGet();
  var b = el('div', 'cc'); b.id = 'cc'; b.setAttribute('role', 'dialog'); b.setAttribute('aria-labelledby', 'cc-h');
  var h = el('h3', '', 'Мы бережём ваши данные'); h.id = 'cc-h'; b.appendChild(h);
  var p = el('p', '', hasMetrika()
    ? 'Сайт работает без cookie. С вашего согласия мы включим Яндекс Метрику: она ставит cookie и считает посещения. Пока вы не ответили, ничего не собирается. '
    : 'Сайт не ставит cookie и не собирает статистику. Если мы подключим статистику посещений, она заработает только с вашего согласия. ');
  var a = el('a', '', 'Подробнее'); a.href = 'privacy.html#cookie'; p.appendChild(a); b.appendChild(p);
  // настройки по категориям
  var opts = el('div', 'opts');
  var o1 = el('label', 'opt'), c1 = el('input'); c1.type = 'checkbox'; c1.checked = true; c1.disabled = true;
  var t1 = el('span'); t1.appendChild(el('b', '', 'Необходимые')); t1.appendChild(document.createTextNode('Запоминают только ваш ответ в этом окне. Cookie не используются.'));
  o1.appendChild(c1); o1.appendChild(t1); opts.appendChild(o1);
  var o2 = el('label', 'opt'), c2 = el('input'); c2.type = 'checkbox'; c2.checked = !!(cur && cur.stats);
  var t2 = el('span'); t2.appendChild(el('b', '', 'Статистика (Яндекс Метрика)')); t2.appendChild(document.createTextNode(hasMetrika() ? 'Cookie ООО «Яндекс» для подсчёта посещений. Данные хранятся в России.' : 'Сейчас на сайте не подключена. Ваш выбор сохранится на будущее.'));
  o2.appendChild(c2); o2.appendChild(t2); opts.appendChild(o2);
  b.appendChild(opts);
  var row = el('div', 'row'), yes = el('button', 'btn', 'Принять все'), no = el('button', 'btn ghost', 'Только необходимые'), set = el('button', 'lnkbtn', 'Настроить');
  yes.type = no.type = set.type = 'button';
  yes.onclick = function(){ ccDecide(true); };
  no.onclick = function(){ ccDecide(false); };
  set.onclick = function(){
    if (!b.classList.contains('more')){ b.classList.add('more'); set.textContent = 'Сохранить выбор'; c2.focus(); }
    else ccDecide(c2.checked);
  };
  row.appendChild(yes); row.appendChild(no); row.appendChild(set); b.appendChild(row);
  document.body.appendChild(b);
}
function initCookies(id){
  CC_ID = id;
  var v = ccGet();
  if (!v) cookieBanner(); else if (v.stats) loadMetrika();
  // в подвале ссылка, чтобы передумать в любой момент
  if (!document.getElementById('cc-set')){
    var s = el('button', 'cclink', 'Настройки cookie'); s.id = 'cc-set';
    s.type = 'button'; s.onclick = function(){ cookieBanner(); }; document.getElementById('foot-lnk').appendChild(s);
  }
}


function getJson(u){ return fetch(u, {cache: 'no-cache'}).then(function(r){ if (!r.ok) throw new Error(u + ': ' + r.status); return r.json(); }); }
getJson(WORKER_URL + '/config').catch(function(){ return getJson('config.json'); })
  .then(start)
  .catch(function(e){ console.error(e); initCookies(null); var r = document.getElementById('rows'); if (r) r.innerHTML = '<p class="note">Не удалось загрузить настройки сайта. Позвоните нам.</p>'; });
