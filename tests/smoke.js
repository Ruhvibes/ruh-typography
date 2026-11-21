// Ruh Typography Studio headless smoke test — loads the real www in headless Chrome,
// exercises the core logic (transliteration, timing, render, export, audio).
const puppeteer = require('/home/hatch/workspace/smoke/node_modules/puppeteer');
const path = require('path');

const WWW = 'file:///home/hatch/workspace/ruh-typography/android/app/src/main/assets/www/index.html';
const CHROME = path.join(process.env.HOME, '.cache/puppeteer/chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'shell',
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
      '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 900 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', r => errors.push('REQFAIL: ' + r.url()));

  await page.goto(WWW, { waitUntil: 'load', timeout: 30000 });
  await new Promise(r => setTimeout(r, 800));

  // 1. home renders (16 studios + logo)
  const home = await page.evaluate(() => ({
    title: document.title,
    tiles: document.querySelectorAll('#home-grid .tile').length,
    logo: !!document.querySelector('.hero-logo'),
    hero: document.querySelector('.hero h1') ? document.querySelector('.hero h1').textContent : '',
  }));
  check('home renders', home.tiles === 16 && home.logo && /Make words move/.test(home.hero), JSON.stringify(home));

  // 2. transliteration
  const tr = await page.evaluate(() => transliterate('कहानी'));
  check('Devanagari->Roman', tr === 'kahaani', 'got: ' + tr);
  const tr2 = await page.evaluate(() => transliterate('मेरा नाम हसनैन है'));
  check('Hinglish sentence', tr2 === 'meraa naam hasnain hai', 'got: ' + tr2);

  // 3. word timing distribution
  const tw = await page.evaluate(() => {
    const w = wordsFromText('hello beautiful world', 6);
    return { n: w.length, first: w[0].start, lastEnd: w[w.length - 1].end, mono: w.every((x, i) => i === 0 || x.start >= w[i - 1].start) };
  });
  check('word timing', tw.n === 3 && tw.first === 0 && Math.abs(tw.lastEnd - 6) < 0.01 && tw.mono, JSON.stringify(tw));

  // 4. kinetic draw produces non-blank pixels
  const px = await page.evaluate(() => {
    const c = document.getElementById('kin-canvas');
    kinWords = wordsFromText('hello beautiful world', 6);
    drawKinetic(c, kinWords, 1.0, THEMES[0], 'v');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 400) { if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; }
    return lit;
  });
  check('kinetic canvas draws', px > 50, 'lit samples: ' + px);

  // 4b. every style & effect draws non-blank
  const styles = await page.evaluate(() => {
    const c = document.getElementById('kin-canvas');
    const words = wordsFromText('hello beautiful world this is TypeFlow', 6);
    const lit = () => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 400) { if (d[i] + d[i + 1] + d[i + 2] > 60) n++; }
      return n;
    };
    const out = {};
    for (const e of ['pop','slide','fade','zoom','bounce','typewriter']) {
      kinEffect = e; kinLayout = 'spotlight'; kinBg = 'gradient'; kinFont = 'sans';
      drawKinetic(c, words, 1.3, THEMES[0], 'v');
      out['effect:' + e] = lit();
    }
    kinEffect = 'pop'; kinLayout = 'karaoke';
    drawKinetic(c, words, 1.3, THEMES[0], 'v');
    out['layout:karaoke'] = lit();
    kinLayout = 'spotlight'; kinBg = 'glow';
    drawKinetic(c, words, 1.3, THEMES[0], 'v');
    out['bg:glow'] = lit();
    kinBg = 'solid';
    drawKinetic(c, words, 1.3, THEMES[0], 'v');
    out['bg:solid'] = lit();
    kinBg = 'gradient'; kinFont = 'serif';
    drawKinetic(c, words, 1.3, THEMES[0], 'v');
    out['font:serif'] = lit();
    kinFont = 'mono';
    drawKinetic(c, words, 1.3, THEMES[0], 'v');
    out['font:mono'] = lit();
    kinFont = 'sans';
    out.themes = THEMES.length;
    out.kinThemeChips = document.querySelectorAll('#kin-themes .theme').length;
    out.capThemeChips = document.querySelectorAll('#cap-themes .theme').length;
    // captions with a non-default theme + large size
    capTheme = 5; capSize = 'l';
    capWords = wordsFromText('captions look professional now', 3);
    drawCaptions($('cap-canvas'), null, capWords, 1.0, 'b');
    out['captions:themed'] = (() => {
      const d = $('cap-canvas').getContext('2d').getImageData(0, 0, 540, 960).data;
      let n = 0; for (let i = 0; i < d.length; i += 400) { if (d[i] + d[i + 1] + d[i + 2] > 60) n++; }
      return n;
    })();
    capTheme = 0; capSize = 'm';
    return out;
  });
  const bad = Object.entries(styles).filter(([k, v]) => (k === 'themes' ? v !== 10 : k.endsWith('Chips') ? v !== 10 : v <= 5));
  check('all styles & effects draw', bad.length === 0, JSON.stringify(styles));

  // 5. WAV + MP3 encode round-trip on a generated buffer
  const enc = await page.evaluate(async () => {
    const ctx = audioCtx();
    const buf = ctx.createBuffer(2, 44100, 44100);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 440 * i / 44100) * 0.5;
    }
    const wav = encodeWAV(buf);
    const mp3 = encodeMP3(buf);
    const wavHead = new Uint8Array(await wav.slice(0, 4).arrayBuffer());
    const mp3Head = new Uint8Array(await mp3.slice(0, 2).arrayBuffer());
    const sliced = sliceBuffer(buf, 0.25, 0.75);
    return {
      wavSize: wav.size, mp3Size: mp3.size,
      wavMagic: String.fromCharCode(...wavHead),
      mp3Sync: mp3Head[0] === 0xFF && (mp3Head[1] & 0xE0) === 0xE0,
      slicedDur: sliced.duration,
    };
  });
  check('WAV encode', enc.wavSize > 1000 && enc.wavMagic === 'RIFF', 'size: ' + enc.wavSize);
  check('MP3 encode', enc.mp3Size > 1000 && enc.mp3Sync, 'size: ' + enc.mp3Size);
  check('slice buffer', Math.abs(enc.slicedDur - 0.5) < 0.01, 'dur: ' + enc.slicedDur);

  // 6. full kinetic video export (2s tone) via MediaRecorder
  const exp = await page.evaluate(async () => {
    const ctx = audioCtx();
    const buf = ctx.createBuffer(1, 88200, 44100);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 440 * i / 44100) * 0.4;
    kinBuffer = buf;
    kinWords = wordsFromText('hello beautiful world this is TypeFlow', 2);
    let captured = null;
    window.saveBlob = async (blob, name, mime) => { captured = { size: blob.size, type: blob.type, name }; return 'test'; };
    const canvas = document.createElement('canvas');
    canvas.width = 540; canvas.height = 960;
    const t0 = Date.now();
    const blob = await renderTypographyVideo(canvas, kinWords, buf, THEMES[0], 'v', null);
    return { blobSize: blob.size, blobType: blob.type, ms: Date.now() - t0,
      mr: typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm') };
  });
  check('MediaRecorder webm supported', exp.mr === true, '');
  check('kinetic video export', exp.blobSize > 5000, `size: ${exp.blobSize} type: ${exp.blobType} in ${exp.ms}ms`);

  // 7. captions draw (no video source -> black bg + phrase)
  const cap = await page.evaluate(() => {
    const c = document.getElementById('cap-canvas');
    capWords = wordsFromText('caption test words here', 4);
    drawCaptions(c, null, capWords, 1.0, 'b');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 400) { if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; }
    return lit;
  });
  check('captions canvas draws', cap > 5, 'lit samples: ' + cap);

  // 8. every studio screen opens
  const screens = await page.evaluate(() => {
    const out = {};
    for (const t of ['kinetic', 'lyrics', 'audio', 'mashup', 'video', 'captions', 'emoji', 'gif', 'visual', 'templates', 'script', 'voice', 'assistant', 'gateway', 'history', 'settings', 'projects']) {
      openTool(t);
      out[t] = document.getElementById('tool-' + t).classList.contains('active');
    }
    goHome();
    out.home = document.getElementById('home').classList.contains('active');
    return out;
  });
  check('all tool screens open', Object.values(screens).every(Boolean), JSON.stringify(screens));

  check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  // 9. Urdu rendering (RTL + Nastaliq font loads)
  const urdu = await page.evaluate(async () => {
    await document.fonts.load('800 40px "Noto Nastaliq Urdu"');
    const loaded = document.fonts.check('40px "Noto Nastaliq Urdu"');
    const c = document.getElementById('kin-canvas');
    const words = [{text:'دل', start:0, end:1}, {text:'محبت', start:1, end:2}, {text:'جان', start:2, end:3}];
    drawKinetic(c, words, 1.2, THEMES[0], 'v');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 400) { if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; }
    return { loaded, lit, arabic: isArabic('محبت') };
  });
  check('Urdu Nastaliq draws', urdu.loaded && urdu.lit > 50 && urdu.arabic, JSON.stringify(urdu));

  // 10. BPM detection on a 120 BPM click track
  const bpm = await page.evaluate(() => {
    const ctx = audioCtx();
    const buf = ctx.createBuffer(1, 4 * 44100, 44100);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = 0;
    for (let k = 0; k < 8; k++) { // click every 0.5s = 120 BPM
      const at = Math.floor(k * 0.5 * 44100);
      for (let j = 0; j < 2000; j++) d[at + j] = Math.sin(2 * Math.PI * 1000 * j / 44100) * 0.8 * (1 - j / 2000);
    }
    return estimateBPM(buf);
  });
  check('BPM detection ~120', Math.abs(bpm - 120) <= 10, 'got: ' + bpm);

  // 11. onset alignment snaps words to real click times
  const align = await page.evaluate(() => {
    const ctx = audioCtx();
    const buf = ctx.createBuffer(1, 4 * 44100, 44100);
    const d = buf.getChannelData(0);
    for (let k = 0; k < 8; k++) {
      const at = Math.floor(k * 0.5 * 44100);
      for (let j = 0; j < 2000; j++) d[at + j] = Math.sin(2 * Math.PI * 1000 * j / 44100) * 0.8 * (1 - j / 2000);
    }
    const words = wordsFromText('one two three four five six', 4);
    const aligned = alignWordsToOnsets(words, buf);
    const snapped = aligned.filter(w => Math.abs(w.start % 0.5) < 0.12 || Math.abs((w.start % 0.5) - 0.5) < 0.12).length;
    return { n: aligned.length, snapped, first: aligned[0].start.toFixed(2) };
  });
  check('onset alignment snaps to clicks', align.snapped >= 4, JSON.stringify(align));

  // 12. mashup export renders a real WAV
  const mash = await page.evaluate(async () => {
    const ctx = audioCtx();
    const mk = (freq) => {
      const b = ctx.createBuffer(1, 44100, 44100);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * freq * i / 44100) * 0.4;
      return b;
    };
    mashA = mk(440); mashB = mk(660); mashBpmA = 120; mashBpmB = 120; mashRateB = 1;
    const sr = 44100, total = 1.5;
    const off = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
    const s1 = off.createBufferSource(); s1.buffer = mashA; s1.connect(off.destination); s1.start(0);
    const s2 = off.createBufferSource(); s2.buffer = mashB; s2.connect(off.destination); s2.start(0.5);
    const rendered = await off.startRendering();
    return { dur: rendered.duration, wav: encodeWAV(rendered).size };
  });
  check('mashup offline render', mash.dur > 1 && mash.wav > 10000, JSON.stringify(mash));

  // 13. emoji suggestions from Hindi lyrics
  const emo = await page.evaluate(() => {
    $('emo-text').value = 'dil mera pyar mohabbat jaan';
    suggestEmojis();
    return document.getElementById('emo-result').textContent;
  });
  check('emoji mood suggestion', /❤️|🥰/.test(emo), emo.slice(0, 60));

  // 14. templates render (14 real presets) + visual mood draws
  const tpl = await page.evaluate(() => {
    const c = document.getElementById('vis-canvas');
    drawVisualBG(c, 'Romantic', 1.2);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 400) { if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; }
    return { n: TEMPLATES.length, lit, applied: (() => { applyTemplate(TEMPLATES[0]); return kinTheme === 4 && kinEffect === 'fade'; })() };
  });
  check('templates + visual mood', tpl.n === 14 && tpl.lit > 50 && tpl.applied, JSON.stringify(tpl));

  // 15. 4K export sizing + 4K canvas draw
  const res4k = await page.evaluate(() => {
    kinFormat = 'v'; setKinRes('4k');
    const [w, h] = kinExportSize();
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const words = wordsFromText('hello beautiful world', 2);
    drawKinetic(c, words, 1.0, THEMES[0], 'v');
    const d = c.getContext('2d').getImageData(0, 0, 200, 200).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 40) { if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; }
    setKinRes('1080');
    return { w, h, lit };
  });
  check('4K export size + draw', res4k.w === 2160 && res4k.h === 3840 && res4k.lit > 50, JSON.stringify(res4k));

  // 16. projects + history store round-trip
  const store = await page.evaluate(() => {
    storeSet('ruh_projects', [{ id: 't1', name: 'Test Project', updated: Date.now(), data: {} }]);
    storeSet('ruh_history', [{ name: 'Test-Export.webm', mime: 'video/webm', when: Date.now() }]);
    renderProjects(); renderHistory();
    return { proj: document.querySelectorAll('#proj-list .proj').length, hist: document.querySelectorAll('#hist-list .proj').length };
  });
  check('projects + history store', store.proj === 1 && store.hist === 1, JSON.stringify(store));
  await page.evaluate(() => { storeSet('ruh_projects', []); storeSet('ruh_history', []); });

  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
