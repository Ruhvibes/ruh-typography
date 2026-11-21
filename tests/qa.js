// Ruh Typography Studio — deep QA: end-to-end flows the smoke test doesn't cover.
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
  await page.goto(WWW, { waitUntil: 'load', timeout: 30000 });
  await new Promise(r => setTimeout(r, 800));

  // stub saveBlob so exports don't trigger downloads
  await page.evaluate(() => {
    window.__saved = [];
    window.saveBlob = async (blob, name, mime) => { window.__saved.push({ name, mime, size: blob.size, type: blob.type }); return 'test'; };
  });

  // helper: click-track buffer (120 BPM) + a vocal-like burst track
  const mkClick = `() => {
    const ctx = audioCtx();
    const buf = ctx.createBuffer(1, 8 * 44100, 44100);
    const d = buf.getChannelData(0);
    for (let k = 0; k < 16; k++) {
      const at = Math.floor(k * 0.5 * 44100);
      for (let j = 0; j < 2000; j++) d[at + j] = Math.sin(2 * Math.PI * 1000 * j / 44100) * 0.8 * (1 - j / 2000);
    }
    return buf;
  }`;

  // 1. Lyrics: SRT + LRC parsing
  const parse = await page.evaluate(() => {
    const srt = parseLyricFile('1\n00:00:01,000 --> 00:00:03,000\ndil mera pyar\n\n2\n00:00:04,000 --> 00:00:06,000\nmohabbat jaan', 'a.srt');
    const lrc = parseLyricFile('[00:01.00]dil mera\n[00:03.50]pyar mohabbat', 'a.lrc');
    return { srt, lrc };
  });
  check('SRT/LRC parse', parse.srt.includes('dil mera pyar') && parse.lrc.includes('dil mera') && parse.lrc.includes('pyar mohabbat'), JSON.stringify(parse));

  // 2. Full lyrics flow: load song -> paste -> Auto Sync -> manual correct -> apply to typography
  const lyr = await page.evaluate(async () => {
    const ctx = audioCtx();
    const buf = ctx.createBuffer(1, 8 * 44100, 44100);
    const d = buf.getChannelData(0);
    for (let k = 0; k < 16; k++) {
      const at = Math.floor(k * 0.5 * 44100);
      for (let j = 0; j < 2000; j++) d[at + j] = Math.sin(2 * Math.PI * 1000 * j / 44100) * 0.8 * (1 - j / 2000);
    }
    lyrBuffer = buf;
    $('lyr-lang').value = 'en-IN';
    $('lyr-text').value = 'dil mera pyar mohabbat jaan chand taare';
    await autoSyncLyrics();
    const synced = lyrWords.length;
    const conf = lyrWords.reduce((a, w) => a + (w.conf || 0), 0) / Math.max(1, lyrWords.length);
    // manual correction: move word 0 to 0.5s
    lyrSel = 0; renderLyrWords(); showLyrEditor();
    $('lyr-edit-start').value = '0.50'; $('lyr-edit-end').value = '0.90';
    $('lyr-edit-apply').click();
    const fixed = lyrWords[0].start === 0.5 && lyrWords[0].conf === 1;
    applySyncToTypography();
    return { synced, conf: conf.toFixed(2), fixed, kinN: kinWords.length, kinHasBuffer: !!kinBuffer };
  });
  check('lyrics sync end-to-end', lyr.synced === 7 && lyr.fixed && lyr.kinN === 7 && lyr.kinHasBuffer, JSON.stringify(lyr));

  // 3. Mashup: real mashExport() function with two buffers
  const mash = await page.evaluate(async () => {
    const ctx = audioCtx();
    const mk = (f) => {
      const b = ctx.createBuffer(1, 44100, 44100);
      const dd = b.getChannelData(0);
      for (let i = 0; i < dd.length; i++) dd[i] = Math.sin(2 * Math.PI * f * i / 44100) * 0.4;
      return b;
    };
    mashA = mk(440); mashB = mk(660);
    mashBpmA = 120; mashBpmB = 120; mashRateB = 1;
    $('mash-xfade').value = '1'; $('mash-bal').value = '50';
    await mashExport();
    return { saved: window.__saved.filter(s => s.name.includes('Mashup')) };
  });
  check('mashup export()', mash.saved.length === 1 && mash.saved[0].size > 10000, JSON.stringify(mash.saved));

  // 4. Video editor: synthetic video -> trim + captions + filter -> export
  const ved = await page.evaluate(async () => {
    // make a 2s video from a canvas stream
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const cc = c.getContext('2d');
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    const done = new Promise(r => rec.onstop = r);
    rec.start();
    let f = 0;
    await new Promise(res => {
      const draw = () => {
        cc.fillStyle = f % 2 ? '#22c55e' : '#052e16'; cc.fillRect(0, 0, 320, 180);
        cc.fillStyle = '#fff'; cc.font = '30px Arial'; cc.fillText('frame ' + f, 20, 100);
        f++;
        if (f < 60) requestAnimationFrame(draw); else res();
      };
      requestAnimationFrame(draw);
    });
    rec.stop(); await done;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const v = $('ved-player');
    v.src = URL.createObjectURL(blob); v.style.display = 'block';
    await new Promise(res => { v.onloadedmetadata = res; });
    vedDur = v.duration || 2;
    $('ved-start').max = vedDur; $('ved-end').max = vedDur; $('ved-end').value = vedDur;
    $('ved-words').value = 'hello world test';
    $('ved-filter').value = 'warm';
    await exportVideoEdit();
    const first = window.__saved.filter(s => s.name.includes('VideoEdit'));
    // the race that used to make 0-byte videos: preview/seek to the very end,
    // then export again — the render must still produce a real video
    v.currentTime = Math.max(0, vedDur - 0.05);
    await new Promise(r => setTimeout(r, 300));
    await exportVideoEdit();
    const second = window.__saved.filter(s => s.name.includes('VideoEdit'));
    return { dur: vedDur, first: first.map(s => s.size), second: second.map(s => s.size) };
  });
  check('video editor export()', ved.first.length === 1 && ved.first[0] > 5000 && ved.second.length === 2 && ved.second[1] > 5000, JSON.stringify(ved));

  // 5. Audio processing: gain + fade + normalize actually change samples
  const proc = await page.evaluate(() => {
    const ctx = audioCtx();
    const buf = ctx.createBuffer(1, 44100, 44100);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = 0.5;
    const out = processAudioBuffer(buf, 200, true, true, false);
    const dd = out.getChannelData(0);
    return { first: dd[0].toFixed(3), mid: dd[22050].toFixed(3), last: dd[44099].toFixed(3) };
  });
  check('gain/fade processing', proc.first === '0.000' && Math.abs(parseFloat(proc.mid) - 1) < 0.01 && parseFloat(proc.last) < 0.01, JSON.stringify(proc));

  // 6. AI Assistant: every listed command runs a real function
  const asst = await page.evaluate(() => {
    const run = (q) => {
      $('asst-input').value = q;
      const before = document.querySelectorAll('#asst-chat .msg').length;
      askAssistant();
      const msgs = document.querySelectorAll('#asst-chat .msg');
      return msgs.length > before ? msgs[msgs.length - 1].textContent : '';
    };
    const r = {};
    run('make the text green'); r.green = kinTheme === 0;
    run('apply a sad typography style'); r.sad = kinTheme === 1;
    run('karaoke layout'); r.karaoke = kinLayout === 'karaoke';
    run('add a cinematic background'); r.cine = kinTheme === 3;
    run('tell me a joke'); r.unknown = document.querySelector('#asst-chat .msg:last-child').textContent.includes('I can do these');
    return r;
  });
  check('assistant commands', asst.green && asst.sad && asst.karaoke && asst.cine && asst.unknown, JSON.stringify(asst));

  // 7. Gateway: invalid key shows a clear error, no crash; key save/remove round-trip
  const gw = await page.evaluate(async () => {
    $('gw-provider').value = 'groq';
    $('gw-key').value = 'gsk_INVALID_KEY_FOR_TEST';
    gwSave();
    const saved = !!gwKeys().groq;
    await gwTest();
    const status = $('gw-status').textContent;
    gwRemove();
    const removed = !gwKeys().groq;
    return { saved, status, removed };
  });
  check('gateway invalid key', gw.saved && gw.removed && /could not|returned 4|401|invalid/i.test(gw.status), JSON.stringify(gw));

  // 8. Projects: create -> duplicate -> open -> delete
  const proj = await page.evaluate(() => {
    storeSet('ruh_projects', []);
    newProject();
    const afterCreate = getProjects().length;
    const id = getProjects()[0].id;
    const list = getProjects();
    const dup = { ...list[0], id: 'p-dup', name: list[0].name + ' (copy)', updated: Date.now() };
    list.unshift(dup); saveProjects(list);
    const afterDup = getProjects().length;
    saveProjects(getProjects().filter(x => x.id !== 'p-dup'));
    const afterDel = getProjects().length;
    return { afterCreate, afterDup, afterDel, id };
  });
  check('projects CRUD', proj.afterCreate === 1 && proj.afterDup === 2 && proj.afterDel === 1, JSON.stringify(proj));

  // 9. Long audio: 5-min buffer through BPM + alignment (perf + no crash)
  const long = await page.evaluate(() => {
    const ctx = audioCtx();
    const t0 = performance.now();
    const buf = ctx.createBuffer(1, 5 * 60 * 44100, 44100);
    const d = buf.getChannelData(0);
    for (let k = 0; k < 5 * 60 * 2; k++) {
      const at = Math.floor(k * 0.5 * 44100);
      for (let j = 0; j < 2000; j++) d[at + j] = Math.sin(2 * Math.PI * 1000 * j / 44100) * 0.8 * (1 - j / 2000);
    }
    const bpm = estimateBPM(buf);
    const words = wordsFromText('one two three four five six seven eight nine ten', 300);
    const aligned = alignWordsToOnsets(words, buf);
    return { bpm, n: aligned.length, ms: Math.round(performance.now() - t0) };
  });
  check('long audio (5 min)', long.bpm === 120 && long.n === 10 && long.ms < 30000, JSON.stringify(long));

  // 10. Overlays actually drawn into a kinetic export frame
  const ov = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 540; c.height = 960;
    $('emo-overlay-text').value = '❤️';
    emoOverlayOn = true;
    drawKinetic(c, wordsFromText('hello world', 2), 1.0, THEMES[0], 'v');
    const d = c.getContext('2d').getImageData(0, 0, 540, 960).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 400) { if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; }
    return { lit, emoOn: emoOverlayOn };
  });
  check('emoji overlay in export frame', ov.lit > 50 && ov.emoOn, JSON.stringify(ov));

  // 11. visual mood particles flag — applied visual should mark exports
  const vis = await page.evaluate(() => {
    applyVisualToTypography();
    return { flag: window.__visParticles === true, bg: kinBg, effect: kinEffect };
  });
  check('visual mood applies to exports', vis.flag === true && vis.bg === 'glow', JSON.stringify(vis));

  // 12. Hindi mixed + Urdu line render (no broken shaping)
  const mix = await page.evaluate(() => {
    const c = document.getElementById('kin-canvas');
    const words = [{ text: 'दिल', start: 0, end: 1 }, { text: 'love', start: 1, end: 2 }, { text: 'محبت', start: 2, end: 3 }];
    drawKinetic(c, words, 2.2, THEMES[0], 'v');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 400) { if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; }
    return lit;
  });
  check('mixed Hindi/English/Urdu render', mix > 50, 'lit: ' + mix);

  // 13. Typography auto-sync: typed words snap to the audio's onsets
  const ty = await page.evaluate(() => {
    const ctx = audioCtx();
    const buf = ctx.createBuffer(1, 8 * 44100, 44100);
    const d = buf.getChannelData(0);
    for (let k = 0; k < 16; k++) {
      const at = Math.floor(k * 0.5 * 44100);
      for (let j = 0; j < 2000; j++) d[at + j] = Math.sin(2 * Math.PI * 1000 * j / 44100) * 0.8 * (1 - j / 2000);
    }
    kinBuffer = buf; kinMode = 'type';
    $('kin-words').value = 'dil mera pyar mohabbat jaan chand';
    rebuildKinWords();
    const before = kinWords.map(w => w.start);
    const ok = autoSyncKinetic();
    const after = kinWords.map(w => w.start);
    const snapped = kinWords.filter(w => Math.abs(w.start % 0.5) < 0.12 || Math.abs((w.start % 0.5) - 0.5) < 0.12).length;
    const status = $('kin-sync-status').textContent;
    // rebuild (as a redraw/language change would) must NOT clobber aligned timings
    rebuildKinWords();
    const kept = kinSynced && kinWords.every((w, i) => Math.abs(w.start - after[i]) < 0.001);
    // editing the text (different word count) drops back to estimates, then re-syncs
    $('kin-words').value = 'dil mera pyar mohabbat';
    rebuildKinWords();
    const dropped = !kinSynced;
    autoSyncKinetic();
    const resynced = kinSynced && kinWords.length === 4;
    return { ok, snapped, before: before.map(x => x.toFixed(2)), after: after.map(x => x.toFixed(2)), status, kept, dropped, resynced };
  });
  check('typography auto-sync to audio', ty.ok && ty.snapped >= 4 && ty.kept && ty.dropped && ty.resynced && /Synced 6 words/.test(ty.status), JSON.stringify(ty));

  // 14. Apply from Lyrics Sync survives a rebuild in Typography
  const ap = await page.evaluate(() => {
    lyrWords = [{ text: 'a', start: 0.5, end: 0.9, conf: 1 }, { text: 'b', start: 1.0, end: 1.4, conf: 1 }];
    applySyncToTypography();
    rebuildKinWords();
    return { synced: kinSynced, starts: kinWords.map(w => w.start) };
  });
  check('lyrics apply survives rebuild', ap.synced && ap.starts[0] === 0.5 && ap.starts[1] === 1.0, JSON.stringify(ap));

  check('no console/page errors', errors.filter(e => !/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED/.test(e)).length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('QA CRASH:', e); process.exit(2); });
