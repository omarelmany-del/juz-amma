/* رفيق جزء عمّ — static build (vanilla JS port of the family File app).
   Quran text: Tanzil verbatim (see surahs.js header). Audio: streamed from the
   sources' official hosts at play time; nothing bundled; no generated voices. */
(function () {
'use strict';

var AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
function arNum(n) { return String(n).replace(/\d/g, function (d) { return AR_DIGITS[Number(d)]; }); }

var byNumber = new Map(SURAHS.map(function (s) { return [s.n, s]; }));
var STARTER = [1, 112, 113, 114];
var JUZ_AMMA = [];
for (var i = 114; i >= 78; i--) JUZ_AMMA.push(i);
var JUZ_AMMA_TOTAL = 37;

/* Per-ayah audio: Quran Foundation / QuranicAudio mirrors, served at play time.
   'ayah' names the per-ayah source for each surah-level reciter. Where the same
   voice has no per-ayah recording we map to the closest teacher-paced voice and
   say so in the UI (sameVoice: false). */
var RECITERS = [
    { id: 'husary', name: 'الحصري مع الأطفال', note: 'المعلم ويردد وراءه الأطفال', base: 'https://download.quranicaudio.com/quran/husary_muallim_kids_repeat/', sourceName: 'QuranicAudio',
      ayah: { base: 'https://mirrors.quranicaudio.com/everyayah/Husary_Muallim_128kbps/', name: 'الحصري المعلم', sameVoice: false, why: 'نسخة الأطفال مفيش منها تسجيل آية بآية، فبنستخدم الحصري المعلم للترديد آية بآية.' } },
    { id: 'azazy', name: 'العزازي مع الأطفال', note: 'المعلم ويردد وراءه الأطفال', base: 'https://download.quranicaudio.com/quran/alhusaynee_al3azazee_with_children/', sourceName: 'QuranicAudio',
      ayah: { base: 'https://mirrors.quranicaudio.com/everyayah/Husary_Muallim_128kbps/', name: 'الحصري المعلم', sameVoice: false, why: 'العزازي مفيش منه تسجيل آية بآية، فبنستخدم الحصري المعلم للترديد آية بآية.' } },
    { id: 'barrak', name: 'محمد البراك', note: 'مرتّل واضح وهادئ', base: 'https://cdn.mp3quran.net/audio/muhammad-barrak/r1/', sourceName: 'MP3Quran',
      ayah: { base: 'https://verses.quran.com/Alafasy/mp3/', name: 'مشاري العفاسي', sameVoice: false, why: 'البراك مفيش منه تسجيل آية بآية، فبنستخدم العفاسي (مرتّل واضح قريب منه) للترديد آية بآية.' } },
    { id: 'minshawi', name: 'المنشاوي المعلم', note: 'بطيء بوقفات مناسبة للترديد', base: 'https://cdn.mp3quran.net/audio/muhammad-minshawi/r3/', sourceName: 'MP3Quran',
      ayah: { base: 'https://verses.quran.com/Minshawi/Mujawwad/mp3/', name: 'المنشاوي المجوّد', sameVoice: false, why: 'نسخة المصحف المعلم مفيش منها ملفات آية بآية، فبنستخدم المنشاوي المجوّد للترديد آية بآية.' } }
];
function reciterById(id) { return RECITERS.find(function (r) { return r.id === id; }) || RECITERS[0]; }
function audioUrl(r, n) { return r.base + String(n).padStart(3, '0') + '.mp3'; }
function ayahUrl(r, n, i) { return r.ayah.base + String(n).padStart(3, '0') + String(i).padStart(3, '0') + '.mp3'; }

function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ---------- persistence (device-local, like the family File) ---------- */
var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
var state = {
    profile: store.get('jz.profile.v1', 'starter'),   // 'starter' | 'full'
    marks: store.get('jz.marks.v1', {}),              // n -> {started, practiced, recited}
    stars: store.get('jz.stars.v1', {}),              // n -> 0..3
    reciterId: store.get('jz.reciter.v1', 'husary'),
    ayahsDone: store.get('jz.ayahs.v1', {}),          // n -> {i: true}
    practiceDays: store.get('jz.days.v1', {}),        // 'YYYY-MM-DD' -> ['n:i', ...]
    repeat: store.get('jz.repeat.v1', 3),             // per-ayah repeat count: 1|3|5
    slow: store.get('jz.slow.v1', false)              // per-ayah playback at 0.75x
};
function reciter() { return reciterById(state.reciterId); }

function practicedToday() { return (state.practiceDays[todayKey()] || []).length; }

function markAyahDone(n, i) {
    var m = state.ayahsDone[n] || {};
    var on = !m[i];
    m[i] = on;
    state.ayahsDone[n] = m;
    store.set('jz.ayahs.v1', state.ayahsDone);
    var key = todayKey();
    var day = state.practiceDays[key] || [];
    var id = n + ':' + i;
    var at = day.indexOf(id);
    if (on && at === -1) day.push(id);
    if (!on && at !== -1) day.splice(at, 1);
    state.practiceDays[key] = day;
    store.set('jz.days.v1', state.practiceDays);
    return on;
}

/* ---------- shared audio player (surah or ayah, one at a time) ---------- */
var player = { key: '', status: 'idle', repeatLeft: 0, repeatTotal: 0, kind: 'surah' }; // idle|loading|playing|paused|error
var audio = null;
var blobCache = new Map();
var playSubs = new Set();
function emit() { playSubs.forEach(function (f) { f(); }); }
function setPlayer(p) { player = p; emit(); }
function keyFor(r, n) { return r.id + ':' + n; }
function ayahKeyFor(r, n, i) { return r.id + ':' + n + ':' + i; }
function stopAudio() { if (audio) audio.pause(); }

function ensureAudio() {
    if (audio) return;
    audio = new Audio();
    audio.addEventListener('play', function () { if (player.status !== 'playing') setPlayer(Object.assign({}, player, { status: 'playing' })); });
    audio.addEventListener('pause', function () { if (player.status === 'playing') setPlayer(Object.assign({}, player, { status: 'paused' })); });
    audio.addEventListener('ended', function () {
        if (player.kind === 'ayah' && player.repeatLeft > 0) {
            setPlayer(Object.assign({}, player, { repeatLeft: player.repeatLeft - 1 }));
            audio.currentTime = 0;
            audio.play().catch(function () { setPlayer(Object.assign({}, player, { status: 'error' })); });
        } else {
            setPlayer(Object.assign({}, player, { status: 'idle', repeatLeft: 0 }));
        }
    });
    audio.addEventListener('error', function () { setPlayer(Object.assign({}, player, { status: 'error' })); });
}

async function loadAndPlay(key, url, extra) {
    setPlayer(Object.assign({ key: key, status: 'loading', repeatLeft: 0, repeatTotal: 0, kind: 'surah' }, extra || {}));
    try {
        var src = blobCache.get(key);
        if (!src) {
            var res = await fetch(url);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            src = URL.createObjectURL(await res.blob());
            blobCache.set(key, src);
        }
        if (player.key !== key) return;
        ensureAudio();
        audio.src = src;
        audio.playbackRate = (player.kind === 'ayah' && state.slow) ? 0.75 : 1;
        await audio.play();
    } catch (e) {
        if (player.key === key) setPlayer(Object.assign({}, player, { status: 'error' }));
    }
}

function toggleSurah(r, n) {
    var key = keyFor(r, n);
    if (player.key === key && player.status === 'playing' && audio) { audio.pause(); return; }
    if (player.key === key && player.status === 'paused' && audio) {
        audio.play().catch(function () { setPlayer(Object.assign({}, player, { status: 'error' })); });
        return;
    }
    if (player.key === key && player.status === 'loading') return;
    loadAndPlay(key, audioUrl(r, n), { kind: 'surah' });
}

function toggleAyah(r, n, i) {
    var key = ayahKeyFor(r, n, i);
    if (player.key === key && player.status === 'playing' && audio) { audio.pause(); return; }
    if (player.key === key && player.status === 'paused' && audio) {
        audio.play().catch(function () { setPlayer(Object.assign({}, player, { status: 'error' })); });
        return;
    }
    if (player.key === key && player.status === 'loading') return;
    loadAndPlay(key, ayahUrl(r, n, i), { kind: 'ayah', repeatLeft: Math.max(0, state.repeat - 1), repeatTotal: state.repeat });
}

function playLabel(status) {
    return status === 'loading' ? '… جاري التحميل'
        : status === 'playing' ? '⏸ إيقاف مؤقت'
        : status === 'paused' ? '▶ متابعة'
        : status === 'error' ? 'تعذر التشغيل'
        : '▶ تشغيل التلاوة';
}

function ayahPlayLabel(p) {
    if (p.status === 'loading') return '…';
    if (p.status === 'playing') return '⏸ ' + arNum(p.repeatTotal - p.repeatLeft) + ' من ' + arNum(p.repeatTotal);
    if (p.status === 'paused') return '▶ متابعة';
    if (p.status === 'error') return 'تعذر';
    return state.repeat > 1 ? '▶ كرر ' + arNum(state.repeat) + '×' : '▶ استمع';
}

/* ---------- tiny DOM helper ---------- */
function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === 'text') el.textContent = attrs[k];
        else if (k === 'html') el.innerHTML = attrs[k];
        else if (k === 'onclick') el.addEventListener('click', attrs[k]);
        else if (k === 'disabled') { if (attrs[k]) el.setAttribute('disabled', ''); }
        else el.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
}
function link(href, text) { return h('a', { href: href, target: '_blank', rel: 'noopener noreferrer' }, [text]); }

/* ---------- components ---------- */
function playButton(r, n, big) {
    var btn = h('button', { type: 'button', 'class': big ? 'jz-bigplay' : 'jz-play', text: playLabel('idle') });
    function refresh() {
        var st = player.key === keyFor(r, n) ? player.status : 'idle';
        btn.textContent = playLabel(st);
        btn.disabled = st === 'loading';
        if (big) btn.removeAttribute('data-playing');
        else btn.setAttribute('data-playing', st === 'playing' ? 'true' : 'false');
    }
    btn.addEventListener('click', function () { toggleSurah(reciter(), n); });
    playSubs.add(refresh);
    refresh();
    return btn;
}

function audioErrorSlot(r, n) {
    var slot = h('p', { 'class': 'jz-hint' });
    slot.style.display = 'none';
    playSubs.add(function () {
        var st = player.key === keyFor(r, n) ? player.status : 'idle';
        if (st === 'error') {
            slot.textContent = '';
            slot.appendChild(document.createTextNode('لو التشغيل مش راضي يشتغل هنا، افتحوا التلاوة من '));
            slot.appendChild(link(audioUrl(reciter(), n), 'المصدر الرسمي (' + reciter().sourceName + ')'));
            slot.appendChild(document.createTextNode('.'));
            slot.style.display = '';
        } else slot.style.display = 'none';
    });
    return slot;
}

function ayahErrorSlot(r, n, i) {
    var slot = h('p', { 'class': 'jz-hint' });
    slot.style.display = 'none';
    playSubs.add(function () {
        var st = player.key === ayahKeyFor(r, n, i) ? player.status : 'idle';
        if (st === 'error') {
            slot.textContent = '';
            slot.appendChild(document.createTextNode('لو الآية مش راضية تشتغل، افتحوها من '));
            slot.appendChild(link(ayahUrl(reciter(), n, i), 'المصدر (' + reciter().ayah.name + ')'));
            slot.appendChild(document.createTextNode('.'));
            slot.style.display = '';
        } else slot.style.display = 'none';
    });
    return slot;
}

/* Repeat + speed toolbar for a surah's ayah list. Settings are stored and shared. */
var toolbarSubs = new Set();
function emitToolbar() { toolbarSubs.forEach(function (f) { f(); }); }
function ayahToolbar(r) {
    var wrap = h('div', { 'class': 'jz-ayahtool' });
    var repWrap = h('span', { 'class': 'jz-toolgroup' });
    repWrap.appendChild(h('span', { 'class': 'jz-toollabel', text: 'التكرار:' }));
    [1, 3, 5].forEach(function (v) {
        var b = h('button', {
            type: 'button', 'class': 'jz-toolbtn', text: arNum(v) + (v === 1 ? ' مرة' : ' مرات'),
            onclick: function () { state.repeat = v; store.set('jz.repeat.v1', state.repeat); emitToolbar(); emit(); }
        });
        toolbarSubs.add(function () { b.setAttribute('data-on', state.repeat === v ? 'true' : 'false'); });
        repWrap.appendChild(b);
    });
    var slow = h('button', {
        type: 'button', 'class': 'jz-toolbtn',
        onclick: function () { state.slow = !state.slow; store.set('jz.slow.v1', state.slow); emitToolbar(); }
    });
    toolbarSubs.add(function () {
        slow.textContent = state.slow ? '🐢 سرعة أبطأ: شغّالة' : 'سرعة أبطأ';
        slow.setAttribute('data-on', state.slow ? 'true' : 'false');
    });
    wrap.appendChild(repWrap);
    wrap.appendChild(slow);
    if (!r.ayah.sameVoice) wrap.appendChild(h('p', { 'class': 'jz-hint', text: 'التشغيل آية بآية بصوت ' + r.ayah.name + '. ' + r.ayah.why }));
    emitToolbar();
    return wrap;
}

function ayahList(surah) {
    var ayahs = surah.ayahs.slice();
    var basmala = null;
    if (surah.n !== 1 && ayahs[0].indexOf(BASMALA + ' ') === 0) {
        basmala = BASMALA;
        ayahs[0] = ayahs[0].slice(BASMALA.length + 1);
    }
    var wrap = h('div', { 'class': 'jz-ayahs', lang: 'ar' });
    wrap.appendChild(ayahToolbar(reciter()));
    if (basmala) wrap.appendChild(h('div', { 'class': 'jz-basmala', text: basmala }));
    ayahs.forEach(function (text, i) {
        var ai = i + 1;
        var play = h('button', {
            type: 'button', 'class': 'jz-ayahbtn',
            onclick: function () { toggleAyah(reciter(), surah.n, ai); }
        });
        function refreshPlay() {
            var p = player.key === ayahKeyFor(reciter(), surah.n, ai) ? player : { status: 'idle' };
            play.textContent = ayahPlayLabel(p);
            play.disabled = p.status === 'loading';
            play.setAttribute('data-playing', p.status === 'playing' ? 'true' : 'false');
        }
        playSubs.add(refreshPlay);
        refreshPlay();
        var done = h('button', {
            type: 'button', 'class': 'jz-ayahbtn',
            onclick: function () {
                markAyahDone(surah.n, ai);
                refreshDone();
                goalSubs.forEach(function (f) { f(); });
            }
        });
        function refreshDone() {
            var on = (state.ayahsDone[surah.n] || {})[ai];
            done.textContent = on ? '✓ حفظتها' : 'حفظتها';
            done.setAttribute('data-on', on ? 'true' : 'false');
        }
        refreshDone();
        wrap.appendChild(h('div', { 'class': 'jz-ayahline' }, [
            h('div', { 'class': 'jz-ayahtext-row' }, [
                h('span', { 'class': 'jz-ayahnum', text: arNum(ai) }),
                h('span', { 'class': 'jz-ayahtext', text: text })
            ]),
            h('div', { 'class': 'jz-ayahctrl' }, [play, done]),
            ayahErrorSlot(reciter(), surah.n, ai)
        ]));
    });
    return wrap;
}

/* ---------- daily goal: one new ayah, forgiving (nothing resets) ---------- */
var goalSubs = new Set();
function goalCard() {
    var fill = h('i');
    var cap = h('span');
    var box = h('div', { 'class': 'jz-goal' }, [
        h('div', { 'class': 'jz-goalrow' }, [
            h('b', { text: 'هدف اليوم: آية واحدة جديدة' }),
            cap
        ]),
        h('div', { 'class': 'jz-goalbar' }, [fill])
    ]);
    function refresh() {
        var c = practicedToday();
        var met = c >= 1;
        fill.style.width = met ? '100%' : '33%';
        cap.textContent = met ? 'اتنجز ⭐ أحسنت!' : 'لسه — جلسة دقيقتين تكفي';
        box.setAttribute('data-met', met ? 'true' : 'false');
    }
    goalSubs.add(refresh);
    refresh();
    return box;
}

function starsControl(n) {
    var wrap = h('div', { 'class': 'jz-stars', role: 'group', 'aria-label': 'نجوم المجهود' });
    function refresh() {
        var v = state.stars[n] || 0;
        Array.from(wrap.children).forEach(function (b, idx) {
            b.setAttribute('data-on', idx < v ? 'true' : 'false');
        });
    }
    [1, 2, 3].forEach(function (i) {
        wrap.appendChild(h('button', {
            type: 'button', 'class': 'jz-star', text: '★',
            'aria-label': arNum(i) + ' ' + (i === 1 ? 'نجمة' : 'نجوم'),
            onclick: function () {
                var v = state.stars[n] || 0;
                state.stars[n] = (i === v ? i - 1 : i);
                store.set('jz.stars.v1', state.stars);
                refresh();
            }
        }));
    });
    refresh();
    return wrap;
}

function kidCard(n) {
    var surah = byNumber.get(n);
    var textWrap = h('div');
    textWrap.style.display = 'none';
    textWrap.appendChild(ayahList(surah));
    var toggle = h('button', {
        type: 'button', 'class': 'fbtn ghost', text: 'عرض النص والترديد آية بآية',
        onclick: function () {
            var open = textWrap.style.display !== 'none';
            textWrap.style.display = open ? 'none' : '';
            toggle.textContent = open ? 'إخفاء النص' : 'عرض النص والترديد آية بآية';
        }
    });
    return h('div', { 'class': 'jz-kidcard' }, [
        h('div', {}, [
            h('div', { 'class': 'jz-kidname', text: 'سورة ' + surah.name }),
            h('div', { 'class': 'jz-kidmeta', text: arNum(surah.ayahs.length) + ' آيات' })
        ]),
        playButton(reciter(), n, true),
        audioErrorSlot(reciter(), n),
        starsControl(n),
        toggle,
        textWrap
    ]);
}

function badges(marks) {
    var wrap = h('span', { 'class': 'jz-badges' });
    if (marks.recited) wrap.appendChild(h('span', { 'class': 'jz-badge', 'data-teal': 'true', text: 'حفظ غيبًا' }));
    else if (marks.practiced) wrap.appendChild(h('span', { 'class': 'jz-badge', text: 'راجعناها' }));
    else if (marks.started) wrap.appendChild(h('span', { 'class': 'jz-badge', text: 'بدأنا' }));
    return wrap;
}

function surahRow(n) {
    var surah = byNumber.get(n);
    var body = h('div', { 'class': 'jz-surahbody' });
    body.style.display = 'none';
    body.appendChild(ayahList(surah));

    var controls = h('div', { 'class': 'jz-controls' });
    controls.appendChild(playButton(reciter(), n, false));
    function markBtn(key, label) {
        return h('button', {
            type: 'button', 'class': 'fbtn', text: label,
            onclick: function () {
                var m = state.marks[n] || {};
                m[key] = !m[key];
                state.marks[n] = m;
                store.set('jz.marks.v1', state.marks);
                refresh();
                refreshProgress();
            }
        });
    }
    var bStarted = markBtn('started', 'بدأنا');
    var bPracticed = markBtn('practiced', 'راجعناها');
    var bRecited = markBtn('recited', 'حفظ غيبًا');
    controls.appendChild(bStarted);
    controls.appendChild(bPracticed);
    controls.appendChild(bRecited);
    body.appendChild(controls);
    body.appendChild(audioErrorSlot(reciter(), n));

    var head = h('button', { type: 'button', 'class': 'jz-surahhead', 'aria-expanded': 'false' }, [
        h('span', { 'class': 'jz-num', text: arNum(n) }),
        h('span', { 'class': 'jz-name', text: 'سورة ' + surah.name })
    ]);
    var badgeSlot = h('span', { 'class': 'jz-badges' });
    head.appendChild(badgeSlot);
    head.addEventListener('click', function () {
        var open = body.style.display !== 'none';
        body.style.display = open ? 'none' : '';
        head.setAttribute('aria-expanded', open ? 'false' : 'true');
    });

    function refresh() {
        var m = state.marks[n] || {};
        badgeSlot.textContent = '';
        var b = badges(m);
        while (b.firstChild) badgeSlot.appendChild(b.firstChild);
        bStarted.setAttribute('data-selected', m.started ? 'true' : 'false');
        bPracticed.setAttribute('data-selected', m.practiced ? 'true' : 'false');
        bRecited.setAttribute('data-selected', m.recited ? 'true' : 'false');
    }
    refresh();
    return h('div', { 'class': 'jz-surahrow' }, [head, body]);
}

function group(label, heading, children) {
    var g = h('div', { 'class': 'group' }, [h('div', { 'class': 'g-label', text: label })]);
    if (heading) g.appendChild(h('h2', { 'class': 'g-heading', text: heading }));
    (children || []).forEach(function (c) { if (c) g.appendChild(c); });
    return g;
}
function callout(tone, title, text) {
    return h('div', { 'class': 'callout' + (tone === 'warning' ? ' warn' : '') }, [
        h('div', { 'class': 'c-title', text: title }),
        h('div', { html: text })
    ]);
}

var progressFill = null;
var progressCaption = null;
function refreshProgress() {
    if (!progressFill) return;
    var recited = JUZ_AMMA.filter(function (n) { return (state.marks[n] || {}).recited; }).length;
    progressFill.style.width = (recited / JUZ_AMMA_TOTAL * 100) + '%';
    progressCaption.textContent = 'حفظ غيبًا حتى الآن: ' + arNum(recited) + ' من ' + arNum(JUZ_AMMA_TOTAL) + '.';
}

/* ---------- view sections ---------- */
var viewSlot = h('div');

function renderView() {
    viewSlot.textContent = '';
    if (state.profile === 'starter') {
        var grid = h('div', { 'class': 'jz-grid' });
        STARTER.forEach(function (n) { grid.appendChild(kidCard(n)); });
        viewSlot.appendChild(group('هدف اليوم', null, [
            goalCard(),
            h('p', { 'class': 'caption', text: 'النجوم والعلامات بتفضل محفوظة على الجهاز ومفيش يوم بيمسح حاجة — اللي اتعمل مكسب، حتى لو فات يوم أو اتنين.' })
        ]));
        viewSlot.appendChild(group('سور البداية', 'اختاروا سورة واسمعوها', [
            grid,
            h('p', { 'class': 'caption', text: 'افتحوا «النص والترديد» عشان تسمعوا كل آية لوحدها وتكرروها، وبابا أو ماما بيدوسوا على النجوم بعد كل مرة يسمع أو يكرر. جلسة دقيقتين تلاتة تكفي، واللعب قبل الحفظ.' })
        ]));
    } else {
        var bar = h('div', { 'class': 'jz-progress', 'aria-label': 'التقدم' }, [h('div')]);
        progressFill = bar.firstChild;
        progressCaption = h('p', { 'class': 'caption' });
        var stack = h('div', { 'class': 'jz-stack' });
        JUZ_AMMA.forEach(function (n) { stack.appendChild(surahRow(n)); });
        viewSlot.appendChild(group('هدف اليوم', null, [goalCard()]));
        viewSlot.appendChild(group('الهدف', 'جزء عمّ كامل', [
            h('p', { 'class': 'para', text: 'الهدف جزء عمّ كله (' + arNum(JUZ_AMMA_TOTAL) + ' سورة)، خطوة خطوة ومن غير استعجال. التقدم هنا بتعلّموه انتوا بإيدكم، وهو خاص بيكم على هذا الجهاز.' }),
            bar,
            progressCaption
        ]));
        viewSlot.appendChild(group('المتتبع', 'السور السبع والثلاثين، من الناس إلى النبأ', [
            stack,
            h('p', { 'class': 'caption', text: 'افتحوا أي سورة عشان تشوفوا آياتها، تشغّلوا تلاوتها، أو تكرروا كل آية لوحدها. «بدأنا» و«راجعناها» و«حفظ غيبًا» بإيد بابا أو ماما.' })
        ]));
        refreshProgress();
    }
}

/* ---------- page ---------- */
function render() {
    var root = h('div', { 'class': 'card jz-root', lang: 'ar', dir: 'rtl' });

    var hdr = h('div', { 'class': 'hdr' }, [
        h('h1', { text: 'رفيق جزء عمّ' }),
        h('p', { 'class': 'fact', text: arNum(JUZ_AMMA_TOTAL) + ' سورة · من النبأ إلى الناس' }),
        h('p', { 'class': 'intro', text: 'صفحة مجانية للعائلات: تسمعوا التلاوة، تتابعوا الآيات، وبابا أو ماما يعلّموا على اللي اتراجع. النجوم على المجهود والمحاولة، مش على السرعة.' })
    ]);
    root.appendChild(hdr);

    var photos = h('div', { 'class': 'photos' }, [
        h('img', { src: 'hero.webp', alt: 'رسمة توضيحية: كتاب مفتوح مضيء تحت هلال ونجوم' })
    ]);
    root.appendChild(photos);
    root.appendChild(h('p', { 'class': 'caption', text: 'رسمة توضيحية بالذكاء الاصطناعي، مش من المصادر.' }));

    var choice = h('div', { 'class': 'choicerow' });
    [['starter', 'البداية (٤ سور)'], ['full', 'جزء عمّ كامل (٣٧ سورة)']].forEach(function (opt) {
        var b = h('button', {
            type: 'button', text: opt[1],
            'data-on': state.profile === opt[0] ? 'true' : 'false',
            onclick: function () {
                stopAudio();
                state.profile = opt[0];
                store.set('jz.profile.v1', state.profile);
                Array.from(choice.children).forEach(function (c, i) {
                    c.setAttribute('data-on', state.profile === ['starter', 'full'][i] ? 'true' : 'false');
                });
                renderView();
            }
        });
        choice.appendChild(b);
    });
    root.appendChild(group('المستوى', null, [choice]));

    var recWrap = h('div', { 'class': 'jz-reciters' });
    RECITERS.forEach(function (r) {
        recWrap.appendChild(h('button', {
            type: 'button', 'class': 'jz-reciter',
            'data-on': reciter().id === r.id ? 'true' : 'false',
            onclick: function () {
                stopAudio();
                state.reciterId = r.id;
                store.set('jz.reciter.v1', state.reciterId);
                Array.from(recWrap.children).forEach(function (c, i) {
                    c.setAttribute('data-on', RECITERS[i].id === r.id ? 'true' : 'false');
                });
                renderView();
            }
        }, [
            h('span', { 'class': 'jz-reciter-name', text: r.name }),
            h('span', { 'class': 'jz-reciter-note', text: r.note })
        ]));
    });
    root.appendChild(group('صوت القارئ', null, [recWrap]));

    root.appendChild(viewSlot);

    root.appendChild(group('قبل ما تعتمدوا عليها', null, [
        callout('warning', 'مراجعة النص قبل الاستخدام المنتظم',
            'النص القرآني هنا منقول حرفيًا من مصدر موثوق (<bdi>Tanzil</bdi>، رواية حفص، الرسم العثماني) من غير أي تغيير في الحروف. ومع ذلك، لازم شخص مؤهل يراجع النص كما يظهر هنا قبل الاعتماد عليه في الحفظ بشكل منتظم. البسملة معروضة في سطر منفصل فوق أول آية كما هو متعارف عليه، والحروف نفسها كما وردت في المصدر بدون أي تغيير.'),
        callout('note', 'الصوت',
            'أربع تلاوات حقيقية تختاروا بينها من «صوت القارئ» فوق، وبتتنقل من الخوادم الرسمية (<bdi>QuranicAudio</bdi> و<bdi>MP3Quran</bdi>) لحظة الضغط على تشغيل، ومش محفوظة داخل الصفحة. التشغيل آية بآية بيجيب ملف صغير لكل آية من خوادم <bdi>Quran Foundation</bdi> برضه، وبيكررها بالعدد اللي تختاروه (١ أو ٣ أو ٥ مرات) مع خيار سرعة أبطأ. مفيش أي صوت مولّد هنا.'),
        callout('note', 'الخصوصية',
            'النجوم والعلامات وهدف اليوم بتتحفظ على الجهاز والمتصفح ده بس، وتفضل موجودة لما تقفلوا الصفحة وترجعوا لها. مش بتتنقل بين الأجهزة ولا بتتشارك مع حد، ولو اتمسحت بيانات المتصفح هتبدأوا من جديد.')
    ]));

    var sources = h('div');
    sources.appendChild(h('p', { 'class': 'para', html: '<bdi>Tanzil Quran Text (Uthmani, Version 1.1)</bdi> — <bdi>Copyright (C) 2007-2021 Tanzil Project</bdi> — <bdi>License: Creative Commons Attribution 3.0</bdi>. النص منقول حرفيًا بدون تغيير، والمصدر: ' }));
    sources.lastChild.appendChild(link('https://tanzil.net', 'tanzil.net'));
    sources.lastChild.appendChild(document.createTextNode('.'));
    var p2 = h('p', { 'class': 'para', text: 'التلاوات: محمود خليل الحصري والحسيني العزازي (المعلم مع الأطفال) عبر ' });
    p2.appendChild(link('https://www.quranicaudio.com', 'QuranicAudio.com'));
    p2.appendChild(document.createTextNode('، بشروط '));
    var bdi = h('bdi'); bdi.textContent = 'Quran Foundation'; p2.appendChild(bdi);
    p2.appendChild(document.createTextNode(' للمطورين مع النسب للمؤسسة والقارئ. ومحمد البراك ومحمد صديق المنشاوي (المصحف المعلم) عبر منصة '));
    p2.appendChild(link('https://www.mp3quran.net/ar', 'MP3Quran.net'));
    p2.appendChild(document.createTextNode(' وواجهتها المفتوحة للمطورين. كل الملفات بتتشغل من خوادم المصادر مباشرة لحظة الاستماع.'));
    sources.appendChild(p2);
    var p3 = h('p', { 'class': 'para', text: 'التشغيل آية بآية: الحصري المعلم ومشاري العفاسي والمنشاوي المجوّد، ملف لكل آية عبر واجهة ' });
    p3.appendChild(link('https://quran.com', 'Quran.com'));
    p3.appendChild(document.createTextNode(' وخوادم '));
    p3.appendChild(link('https://www.quranicaudio.com', 'QuranicAudio'));
    p3.appendChild(document.createTextNode(' (Quran Foundation) بنفس شروط النسب.'));
    sources.appendChild(p3);
    sources.appendChild(h('p', { 'class': 'para', html: 'الخطوط: <bdi>Amiri Quran</bdi> و<bdi>IBM Plex Sans Arabic</bdi>، برخصة الخطوط المفتوحة (<bdi>OFL</bdi>).' }));
    root.appendChild(group('المصادر والحقوق', null, [sources]));

    root.appendChild(h('p', { 'class': 'closing', text: 'صفحة مجانية للعائلات، أُعدت في نوفمبر ٢٠٢٦. النص القرآني مجاني دائمًا، ومفيش حاجة بتتبعت ولا بتتنشر من هنا.' }));
    const packLine = h('p', { 'class': 'closing pack-link', html: 'ولو حابين متابعة ورقية للحفظ، في حزمة طباعة منزلية اختيارية تكمل الصفحة — والصفحة دي بتفضل مجانية كاملة: ' });
    packLine.appendChild(link('https://omarelmany.gumroad.com/l/juz-amma-pack', 'حزمة رفيق جزء عمّ للطباعة'));
    root.appendChild(packLine);

    document.getElementById('app').appendChild(root);
    renderView();
}

render();
})();
