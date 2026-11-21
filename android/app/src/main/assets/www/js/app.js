/* Ruh Typography Studio — kinetic typography engine (original implementation) */
'use strict';
const $ = id => document.getElementById(id);
const hasAndroid = () => typeof window.Android !== 'undefined';
function toast(msg){
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove('show'), 2600);
  if (hasAndroid()) { try { Android.toast(msg); } catch(e){} }
}
function goHome(){
  stopPreview();
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $('home').classList.add('active');
  window.scrollTo(0,0);
}
function openTool(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $('tool-'+name).classList.add('active');
  window.scrollTo(0,0);
}
function fmtTime(s){
  s = Math.max(0, s||0);
  const m = Math.floor(s/60), ss = (s%60).toFixed(1);
  return m + ':' + (ss<10?'0':'') + ss;
}

/* ---------- themes ---------- */
const THEMES = [
  { name:'Lagoon',  bg:['#062a28','#0f766e'], fg:'#ffffff', hi:'#2dd4bf', sub:'#9fd8d2' },
  { name:'Midnight',bg:['#0b1026','#1e1b4b'], fg:'#ffffff', hi:'#fbbf24', sub:'#a5b4fc' },
  { name:'Ember',   bg:['#1c0a00','#7c2d12'], fg:'#fff7ed', hi:'#fdba74', sub:'#fed7aa' },
  { name:'Mono',    bg:['#000000','#1a1a1a'], fg:'#ffffff', hi:'#ffffff', sub:'#a3a3a3' },
  { name:'Blush',   bg:['#2b0a1e','#831843'], fg:'#fff1f2', hi:'#f9a8d4', sub:'#fbcfe8' },
  { name:'Sunset',  bg:['#2a0a2e','#db2777'], fg:'#fdf2f8', hi:'#f9a8d4', sub:'#f5c2e0' },
  { name:'Ocean',   bg:['#082f49','#0369a1'], fg:'#f0f9ff', hi:'#7dd3fc', sub:'#bae6fd' },
  { name:'Forest',  bg:['#052e16','#15803d'], fg:'#f0fdf4', hi:'#86efac', sub:'#bbf7d0' },
  { name:'Royal',   bg:['#1e1b4b','#6d28d9'], fg:'#f5f3ff', hi:'#c4b5fd', sub:'#ddd6fe' },
  { name:'Volt',    bg:['#09090b','#3f3f46'], fg:'#fafafa', hi:'#facc15', sub:'#d4d4d8' },
];
const FONTS={sans:'Arial, sans-serif', serif:'Georgia, serif', mono:'"Courier New", monospace'};
let kinTheme = 0, scrTheme = 0, capTheme = 0, capSize = 'm';
function renderThemes(elId, sel, cb){
  const el = $(elId); el.innerHTML='';
  THEMES.forEach((t,i)=>{
    const d = document.createElement('div');
    d.className = 'theme' + (i===sel?' on':'');
    d.innerHTML = `<div class="sw" style="background:linear-gradient(135deg,${t.bg[0]},${t.bg[1]})"></div>${t.name}`;
    d.onclick = ()=>{ cb(i); renderThemes(elId, i, cb); drawKineticPreview(); };
    el.appendChild(d);
  });
}
renderThemes('kin-themes', 0, i=>{ kinTheme=i; });
renderThemes('scr-themes', 0, i=>{ scrTheme=i; });
renderThemes('cap-themes', 0, i=>{ capTheme=i; drawCaptionsPreview(); });

/* ---------- Devanagari -> Roman transliteration (Hinglish) ---------- */
const DEVA = {
  'अ':'a','आ':'aa','इ':'i','ई':'i','उ':'u','ऊ':'u','ऋ':'ri','ए':'e','ऐ':'ai','ओ':'o','औ':'au',
  'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'ng','च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'ny',
  'ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n','त':'t','थ':'th','द':'d','ध':'dh','न':'n',
  'प':'p','फ':'ph','ब':'b','भ':'bh','म':'m','य':'y','र':'r','ल':'l','व':'v','श':'sh','ष':'sh','स':'s','ह':'h',
  'क्ष':'ksh','त्र':'tr','ज्ञ':'gy','श्र':'shr',
  'ा':'aa','ि':'i','ी':'i','ु':'u','ू':'u','ृ':'ri','े':'e','ै':'ai','ो':'o','ौ':'au',
  'ं':'n','ँ':'n','ः':'h','्':'','़':'','ॉ':'o','ॆ':'e','ॊ':'o','ॲ':'a'
};
const VOWEL_SIGNS = new Set(['ा','ि','ी','ु','ू','ृ','े','ै','ो','ौ','ॉ','ॆ','ॊ']);
const CONSONANTS = new Set(['क','ख','ग','घ','ङ','च','छ','ज','झ','ञ','ट','ठ','ड','ढ','ण','त','थ','द','ध','न','प','फ','ब','भ','म','य','र','ल','व','श','ष','स','ह','क्ष','त्र','ज्ञ','श्र']);
function transliterate(text){
  let out='';
  let firstSchwaDone=false;
  const isWordChar = c => c && !/[\s,.;!?'\"()\-]/.test(c);
  for (let i=0;i<text.length;i++){
    const ch=text[i];
    if (ch==='्') continue; // halant: handled by the lookahead below
    if (!isWordChar(ch)){ firstSchwaDone=false; out+=ch; continue; }
    if (DEVA[ch]!==undefined){
      if (CONSONANTS.has(ch)){
        const next=text[i+1];
        // inherent 'a' is dropped before a vowel sign / halant, and at word end
        if (!next || !isWordChar(next) || VOWEL_SIGNS.has(next) || next==='्') out+=DEVA[ch];
        else {
          // Hindi schwa deletion: the first schwa of a word is kept;
          // a later schwa drops when followed by consonant + vowel.
          const nn=text[i+2];
          if (!firstSchwaDone){ out+=DEVA[ch]+'a'; firstSchwaDone=true; }
          else if (nn && (VOWEL_SIGNS.has(nn) || 'अआइईउऊएऐओऔ'.includes(nn))) out+=DEVA[ch];
          else { out+=DEVA[ch]+'a'; firstSchwaDone=true; }
        }
      } else out+=DEVA[ch];
    } else out+=ch;
  }
  return out;
}
function displayWords(text, lang){
  if (lang === 'hi-IN-roman') return transliterate(text);
  return text;
}

/* ---------- audio context + file loading ---------- */
let actx = null;
function audioCtx(){
  if (!actx) actx = new (window.AudioContext||window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
async function fileToBuffer(file){
  const ctx = audioCtx();
  const ab = await file.arrayBuffer();
  return await ctx.decodeAudioData(ab);
}
function bufferDuration(buf){ return buf ? buf.duration : 0; }

/* ---------- word timing ---------- */
/* Distribute words across a duration, weighted by word length.
   Timing is estimated (not word-perfect ASR) — the UI says so. */
function distributeWords(words, duration){
  const total = words.reduce((a,w)=>a+Math.max(2,w.text.length),0) || 1;
  let t = 0; const out = [];
  words.forEach(w=>{
    const len = Math.max(2,w.text.length)/total*duration;
    out.push({ text:w.text, start:t, end:t+len });
    t += len;
  });
  if (out.length) out[out.length-1].end = duration;
  return out;
}
function wordsFromText(text, duration){
  const parts = (text||'').split(/\s+/).filter(Boolean);
  return distributeWords(parts.map(p=>({text:p})), Math.max(0.5, duration||10));
}
/* Live-transcribed segments already carry rough start/end times. */
function wordsFromSegments(segments){
  const out = [];
  segments.forEach(seg=>{
    const parts = (seg.text||'').split(/\s+/).filter(Boolean);
    if (!parts.length) return;
    const d = Math.max(0.2,(seg.end-seg.start));
    distributeWords(parts.map(p=>({text:p})), d).forEach(w=>{
      out.push({ text:w.text, start:w.start+seg.start, end:w.end+seg.start });
    });
  });
  return out;
}

/* ---------- shared export state ---------- */
let lastExport = null; // {path, name, mime}
function setLastExport(path, name, mime){
  lastExport = { path, name, mime };
  ['kin-share-row','cap-share-row','scr-share-row','vox-share-row','aud-share-row']
    .forEach(id=>{ const el=$(id); if(el) el.hidden=false; });
}
function shareLast(){
  if (!lastExport) return toast('Nothing to share yet');
  if (hasAndroid()) { try { Android.shareFile(lastExport.path, lastExport.mime); return; } catch(e){} }
  toast('Sharing needs the installed app');
}
function blobToBase64(blob){
  return new Promise((res,rej)=>{
    const r = new FileReader();
    r.onload = ()=>res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}
async function saveBlob(blob, fileName, mime){
  if (hasAndroid()){
    const b64 = await blobToBase64(blob);
    window._pendingSave = { name:fileName, mime };
    Android.saveFile(b64, fileName, mime);
    return 'android';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
  return 'browser';
}
window.onFileSaved = function(o){
  const status = window._saveStatusEl;
  if (o && o.ok){
    if (status) status.textContent = 'Saved: ' + (o.name||'') + ' — check your Downloads / RuhTypographyStudio folder.';
    toast('Saved to Downloads');
  } else {
    if (status) status.textContent = 'Save failed: ' + ((o&&o.reason)||'unknown error');
    toast('Save failed');
  }
};
window.onTtsSaved = function(o){
  const st = $('scr-audio-status');
  if (o && o.ok){
    if (window._ttsTarget === 'script'){
      loadScriptAudio(o.path);
      if (st) st.textContent = 'Voice audio ready: ' + o.name;
    } else {
      $('vox-status').textContent = 'Saved: ' + o.name;
      setLastExport(o.path, o.name, 'audio/wav');
      toast('Voice audio saved');
    }
  } else {
    const msg = 'Voice failed: ' + ((o&&o.reason)||'unknown error');
    if (window._ttsTarget === 'script' && st) st.textContent = msg;
    else $('vox-status').textContent = msg;
  }
};

/* ================= KINETIC TYPOGRAPHY ================= */
let kinFile=null, kinBuffer=null, kinWords=[], kinMode='type', kinFormat='v';
let kinEffect='pop', kinLayout='spotlight', kinBg='gradient', kinFont='sans';
let kinRes='1080';
function setKinRes(r){ kinRes=r; $('kin-res-720').classList.toggle('on',r==='720'); $('kin-res-1080').classList.toggle('on',r==='1080'); $('kin-res-4k').classList.toggle('on',r==='4k'); }
function kinExportSize(){ if(kinFormat==='v'){ return kinRes==='4k'?[2160,3840]:kinRes==='720'?[720,1280]:[1080,1920]; } return kinRes==='4k'?[3840,2160]:kinRes==='720'?[1280,720]:[1920,1080]; }
function kinBitrate(){ return kinRes==='4k'?25000000:kinRes==='720'?5000000:12000000; }
let kinSegments=[], kinListening=false, kinSttBase=0;
let previewRAF=null, previewAudioEl=null;

function setKinMode(m){
  kinMode=m;
  $('kin-mode-type').classList.toggle('on', m==='type');
  $('kin-mode-live').classList.toggle('on', m==='live');
  $('kin-type-box').hidden = m!=='type';
  $('kin-live-box').hidden = m!=='live';
}
function setKinFormat(f){
  kinFormat=f;
  $('kin-fmt-v').classList.toggle('on', f==='v');
  $('kin-fmt-h').classList.toggle('on', f==='h');
  const c=$('kin-canvas');
  if(f==='v'){ c.width=540; c.height=960; } else { c.width=960; c.height=540; }
  drawKineticPreview();
}
function setKinEffect(v){ kinEffect=v; drawKineticPreview(); }
function setKinLayout(v){ kinLayout=v; $('kin-lay-s').classList.toggle('on',v==='spotlight'); $('kin-lay-k').classList.toggle('on',v==='karaoke'); drawKineticPreview(); }
function setKinBg(v){ kinBg=v; if(v!=='glow') window.__visParticles=false; $('kin-bg-g').classList.toggle('on',v==='gradient'); $('kin-bg-a').classList.toggle('on',v==='glow'); $('kin-bg-s').classList.toggle('on',v==='solid'); drawKineticPreview(); }
function setKinFont(v){ kinFont=v; $('kin-font-sans').classList.toggle('on',v==='sans'); $('kin-font-serif').classList.toggle('on',v==='serif'); $('kin-font-mono').classList.toggle('on',v==='mono'); drawKineticPreview(); }
function kinFontFamily(){ return FONTS[kinFont]||FONTS.sans; }
function setCapSize(v){ capSize=v; $('cap-size-s').classList.toggle('on',v==='s'); $('cap-size-m').classList.toggle('on',v==='m'); $('cap-size-l').classList.toggle('on',v==='l'); drawCaptionsPreview(); }
$('kin-audio').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{
    kinFile=f; kinBuffer=await fileToBuffer(f);
    $('kin-audio-info').textContent = `${f.name} · ${fmtTime(kinBuffer.duration)} · ${(f.size/1048576).toFixed(1)} MB`;
    const p=$('kin-player'); p.src=URL.createObjectURL(f); p.style.display='block';
    rebuildKinWords(); drawKineticPreview();
    toast('Audio loaded');
  }catch(err){ $('kin-audio-info').textContent='Could not read this audio file: '+err.message; }
});
$('kin-words').addEventListener('input', ()=>{ rebuildKinWords(); drawKineticPreview(); });
$('kin-lang').addEventListener('change', ()=>{ rebuildKinWords(); drawKineticPreview(); });

function rebuildKinWords(){
  const lang=$('kin-lang').value;
  const raw=$('kin-words').value;
  const dur=kinBuffer?kinBuffer.duration:10;
  if(kinMode==='live'){
    kinWords=wordsFromSegments(kinSegments);
  } else {
    kinWords=wordsFromText(displayWords(raw,lang), dur);
  }
}
function kinThemeObj(){ return THEMES[kinTheme]; }

function drawKinetic(canvas, words, t, theme, format){
  const ctx=canvas.getContext('2d');
  const W=canvas.width, H=canvas.height;
  // ---- background ----
  if(kinBg==='solid'){
    ctx.fillStyle=theme.bg[0]; ctx.fillRect(0,0,W,H);
  } else if(kinBg==='glow'){
    ctx.fillStyle=theme.bg[0]; ctx.fillRect(0,0,W,H);
    const gx1=W*(0.5+0.35*Math.sin(t*0.5)), gy1=H*(0.3+0.2*Math.cos(t*0.4));
    const gx2=W*(0.5+0.35*Math.cos(t*0.35)), gy2=H*(0.7+0.2*Math.sin(t*0.45));
    let g=ctx.createRadialGradient(gx1,gy1,0,gx1,gy1,W*0.55);
    g.addColorStop(0,theme.hi+'55'); g.addColorStop(1,theme.hi+'00');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    g=ctx.createRadialGradient(gx2,gy2,0,gx2,gy2,W*0.5);
    g.addColorStop(0,theme.sub+'44'); g.addColorStop(1,theme.sub+'00');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  } else {
    const g=ctx.createLinearGradient(0,0,W,H);
    g.addColorStop(0,theme.bg[0]); g.addColorStop(1,theme.bg[1]);
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  }
  const fam=kinFontFamily();
  const shadowOn=!$('kin-shadow') || $('kin-shadow').checked;
  const barOn=!$('kin-bar') || $('kin-bar').checked;
  // current word
  let idx=-1;
  for(let i=0;i<words.length;i++){ if(t>=words[i].start && t<words[i].end){ idx=i; break; } }
  if(idx<0 && words.length){ idx = t>=words[words.length-1].end ? words.length-1 : 0; }
  ctx.textAlign='center'; ctx.textBaseline='middle';
  const cx=W/2, cy=H/2;
  if(words.length && idx>=0){
    const w=words[idx];
    const prog=Math.min(1,(t-w.start)/Math.max(0.05,(w.end-w.start)));
    if(shadowOn){ ctx.shadowColor='rgba(0,0,0,.45)'; ctx.shadowBlur=W*0.03; ctx.shadowOffsetY=W*0.008; }
    if(kinLayout==='karaoke'){
      // one line: up to 2 words before, current, 2 after
      const lo=Math.max(0,idx-2), hi=Math.min(words.length-1,idx+2);
      const line=words.slice(lo,hi+1);
      let fs=W*0.075;
      const measure=()=>{ let tw=0; line.forEach((wd,i)=>{ const cur=(lo+i)===idx; ctx.font=`800 ${cur?fs*1.35:fs}px ${fam}`; tw+=ctx.measureText(wd.text).width+(i?fs*0.4:0); }); return tw; };
      while(measure()>W*0.92 && fs>W*0.03) fs-=2;
      let x=(W-measure())/2;
      ctx.textAlign='left';
      line.forEach((wd,i)=>{
        const cur=(lo+i)===idx;
        ctx.font=`800 ${cur?fs*1.35:fs}px ${fam}`;
        ctx.fillStyle=cur?theme.hi:theme.sub;
        ctx.globalAlpha=cur?1:0.55;
        const wdW=ctx.measureText(wd.text).width;
        ctx.fillText(wd.text, x, cy);
        x+=wdW+fs*0.4;
      });
      ctx.globalAlpha=1; ctx.textAlign='center';
    } else {
      // previous words (small, above)
      ctx.fillStyle=theme.sub; ctx.globalAlpha=.75;
      let prev='';
      for(let i=Math.max(0,idx-2);i<idx;i++) prev+=(prev?' ':'')+words[i].text;
      if(prev){ fitText(ctx, prev, W*0.8, H*0.052, cx, cy-H*0.13, '600', fam); }
      // current word with effect
      let text=w.text, alpha=1, scale=1, yOff=0;
      if(kinEffect==='slide'){ yOff=(1-prog)*H*0.08; alpha=0.3+0.7*prog; }
      else if(kinEffect==='fade'){ alpha=prog; }
      else if(kinEffect==='zoom'){ scale=1.6-0.6*prog; }
      else if(kinEffect==='bounce'){ scale=1+0.2*Math.sin(prog*Math.PI); yOff=-Math.abs(Math.sin(prog*Math.PI*2))*H*0.015*(1-prog); }
      else if(kinEffect==='typewriter'){ text=text.slice(0, Math.max(1, Math.ceil(prog*text.length))); }
      else { scale=1+0.18*(1-prog); } // pop
      const size=Math.min(W*0.13, H*0.075);
      ctx.save();
      ctx.globalAlpha=alpha;
      ctx.translate(cx, cy+yOff);
      ctx.scale(scale, scale);
      ctx.fillStyle=theme.hi;
      fitText(ctx, text, W*0.88/Math.max(scale,1), size, 0, 0, '800', fam);
      ctx.restore();
      // next word (small, below)
      ctx.fillStyle=theme.sub; ctx.globalAlpha=.75;
      if(idx+1<words.length) fitText(ctx, words[idx+1].text, W*0.8, H*0.05, cx, cy+H*0.13, '600', fam);
      ctx.globalAlpha=1;
    }
    ctx.shadowColor='transparent'; ctx.shadowBlur=0; ctx.shadowOffsetY=0;
  } else {
    ctx.fillStyle=theme.sub; ctx.globalAlpha=.8;
    fitText(ctx,'RUH', W*0.6, H*0.06, cx, cy, '800', fam);
    ctx.globalAlpha=1;
  }
  // overlays (emoji / GIF / visual) drawn by app2.js when enabled
  if(window.__drawOverlays){ try{ window.__drawOverlays(ctx, W, H, t, theme); }catch(e){} }
  // progress bar
  if(barOn){
    const total=words.length?words[words.length-1].end:1;
    const p=Math.min(1,Math.max(0,t/total));
    ctx.fillStyle='rgba(255,255,255,.18)';
    ctx.fillRect(W*0.1, H-14, W*0.8, 5);
    ctx.fillStyle=theme.hi;
    ctx.fillRect(W*0.1, H-14, W*0.8*p, 5);
  }
}
function isArabic(text){ return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text||''); }
function fitText(ctx, text, maxW, size, x, y, weight, family){
  ctx.direction = isArabic(text) ? 'rtl' : 'ltr';
  // Urdu renders in the bundled Nastaliq font (OFL, in assets/fonts);
  // other scripts use the chosen family.
  const fam = isArabic(text) ? `'Noto Nastaliq Urdu', ${family||'Arial, sans-serif'}` : (family||'Arial, sans-serif');
  let s=size;
  ctx.font=`${weight||'700'} ${s}px ${fam}`;
  while(ctx.measureText(text).width>maxW && s>10){
    s*=0.92; ctx.font=`${weight||'700'} ${s}px ${fam}`;
  }
  ctx.fillText(text, x, y);
}
function drawKineticPreview(){
  const c=$('kin-canvas');
  const t=previewAudioEl?previewAudioEl.currentTime||0:0;
  drawKinetic(c, kinWords, t, kinThemeObj(), kinFormat);
}
function stopPreview(){
  if(previewRAF){ cancelAnimationFrame(previewRAF); previewRAF=null; }
  if(previewAudioEl){ try{ previewAudioEl.pause(); }catch(e){} previewAudioEl=null; }
  const v=$('cap-player'); if(v && !v.paused){ try{ v.pause(); }catch(e){} }
}
function previewKinetic(){
  if(!kinBuffer) return toast('Pick an audio file first');
  rebuildKinWords();
  if(!kinWords.length) return toast('Add some words first');
  stopPreview();
  const p=$('kin-player');
  previewAudioEl=p;
  const loop=()=>{
    drawKinetic($('kin-canvas'), kinWords, p.currentTime||0, kinThemeObj(), kinFormat);
    if(!p.paused && !p.ended) previewRAF=requestAnimationFrame(loop);
  };
  p.currentTime=0; p.play().then(()=>{ previewRAF=requestAnimationFrame(loop); })
    .catch(()=>toast('Audio playback was blocked'));
}
async function exportKinetic(){
  if(!kinBuffer) return toast('Pick an audio file first');
  rebuildKinWords();
  if(!kinWords.length) return toast('Add some words first');
  const st=$('kin-export-status'); st.textContent='Rendering video… please wait.';
  try{
    const canvas=document.createElement('canvas');
    const [ew,eh]=kinExportSize(); canvas.width=ew; canvas.height=eh;
    let blob;
    try{ blob=await renderTypographyVideo(canvas, kinWords, kinBuffer, kinThemeObj(), kinFormat, null, kinBitrate()); }
    catch(e){ if(kinRes==='4k'){ st.textContent='4K is not supported on this device — falling back to 1080p…'; canvas.width=1080; canvas.height=kinFormat==='v'?1920:1080; blob=await renderTypographyVideo(canvas, kinWords, kinBuffer, kinThemeObj(), kinFormat, null, 12000000); } else throw e; }
    window._saveStatusEl=st;
    const name='RuhTypography-Kinetic-'+Date.now()+'.webm';
    await saveBlob(blob, name, 'video/webm');
    st.textContent='Video rendered ('+(blob.size/1048576).toFixed(1)+' MB). Saving…';
    setLastExport('downloads', name, 'video/webm');
  }catch(err){ st.textContent='Export failed: '+err.message; }
}
/* Offline render: play the AudioBuffer through a MediaStream destination,
   draw frames in sync, capture with MediaRecorder. Returns a Blob. */
/* One persistent MediaStream destination per app lifetime, so a media
   element's source node (which can only be created once per element)
   stays wired across repeated exports. */
let exportDest=null;
function getExportDest(){
  if(!exportDest) exportDest=audioCtx().createMediaStreamDestination();
  return exportDest;
}
async function renderTypographyVideo(canvas, words, buffer, theme, format, mediaEl, bitrate){
  const ctx=audioCtx();
  // The context must be running before we start: if it is still suspended,
  // currentTime never advances and the recorder captures nothing.
  try { await ctx.resume(); } catch(e){}
  const streamDest=getExportDest();
  const canvasStream=canvas.captureStream(30);
  const combined=new MediaStream([
    ...canvasStream.getVideoTracks(), ...streamDest.stream.getAudioTracks()
  ]);
  const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']
    .find(m=>{ try{ return MediaRecorder.isTypeSupported(m); }catch(e){ return false; } }) || '';
  const rec=new MediaRecorder(combined, mime?{mimeType:mime,videoBitsPerSecond:bitrate||5000000}:undefined);
  const chunks=[];
  rec.ondataavailable=e=>{ if(e.data&&e.data.size) chunks.push(e.data); };
  const done=new Promise(res=>{ rec.onstop=res; });
  const isVideo = !!(mediaEl && mediaEl.tagName==='VIDEO');
  const dur=buffer?buffer.duration:(mediaEl?(mediaEl.duration||10):10);
  let src=null;
  rec.start(250);
  const t0=ctx.currentTime+0.1;
  if(buffer){
    src=ctx.createBufferSource(); src.buffer=buffer;
    src.connect(streamDest); src.connect(ctx.destination);
    src.start(t0);
  } else if(mediaEl){
    if(!mediaEl._tfSrc){
      mediaEl._tfSrc=ctx.createMediaElementSource(mediaEl);
      mediaEl._tfSrc.connect(streamDest);
      mediaEl._tfSrc.connect(ctx.destination);
    }
    mediaEl.currentTime=0;
    mediaEl.play().catch(()=>{});
  }
  await new Promise((resolve)=>{
    const draw=()=>{
      const t = mediaEl ? (mediaEl.currentTime||0) : Math.max(0, ctx.currentTime-t0);
      const total = mediaEl ? (mediaEl.duration||dur) : dur;
      if(isVideo){ drawCaptions(canvas, mediaEl, capWords, t, capPos); }
      else drawKinetic(canvas, words, t, theme, format);
      if(t>=total || (mediaEl && mediaEl.ended)){ resolve(); } else requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  });
  if(src){ try{ src.stop(); }catch(e){} }
  if(mediaEl){ try{ mediaEl.pause(); }catch(e){} }
  rec.stop();
  await done;
  return new Blob(chunks, { type: rec.mimeType || 'video/webm' });
}

/* ================= LIVE TRANSCRIBE (mic) ================= */
let sttTarget=null; // 'kin' | 'cap'
window.onMicPermission=function(o){
  if(o && o.granted){ startSttListening(); }
  else toast('Mic permission is needed for live transcription');
};
function startSttListening(){
  const lang = sttTarget==='cap' ? $('cap-lang').value : sttTarget==='lyr' ? $('lyr-lang').value : $('kin-lang').value;
  const tag = lang==='hi-IN-roman' ? 'hi-IN' : lang;
  try{ Android.sttStart(tag); }catch(e){ toast('Speech recognition failed to start'); }
}
function toggleStt(){
  if(!hasAndroid()) return toast('Live transcription needs the installed app');
  if(kinListening){ try{ Android.sttStop(); }catch(e){} kinListening=false; $('kin-stt-btn').textContent='🎙 Start listening'; return; }
  sttTarget='kin'; kinListening=true; kinSttBase=kinSegments.length?kinSegments[kinSegments.length-1].end:0;
  $('kin-stt-btn').textContent='■ Stop listening';
  if(typeof Android!=='undefined'){ startSttListening(); }
}
function toggleSttCap(){
  if(!hasAndroid()) return toast('Live transcription needs the installed app');
  if(capListening){ try{ Android.sttStop(); }catch(e){} capListening=false; $('cap-stt-btn').textContent='🎙 Start listening'; return; }
  sttTarget='cap'; capListening=true; capSttBase=capSegments.length?capSegments[capSegments.length-1].end:0;
  $('cap-stt-btn').textContent='■ Stop listening';
  startSttListening();
}
window.onSttResult=function(o){
  if(!o) return;
  const isKin = sttTarget==='kin';
  const lang = isKin ? $('kin-lang').value : $('cap-lang').value;
  const text = displayWords(o.text||'', lang);
  if(o.error){
    if(isKin){ kinListening=false; $('kin-stt-btn').textContent='🎙 Start listening'; }
    else { capListening=false; $('cap-stt-btn').textContent='🎙 Start listening'; }
    if(o.error!==7) toast('Listening stopped');
    return;
  }
  if(isKin){
    $('kin-stt-text').textContent = text;
    if(o.isFinal && text.trim()){
      kinSegments.push({ text:text.trim(), start:kinSttBase, end:Math.max(kinSttBase+0.5, o.t||kinSttBase+1) });
      kinSttBase=kinSegments[kinSegments.length-1].end;
      rebuildKinWords(); drawKineticPreview();
    }
  } else {
    $('cap-stt-text').textContent = text;
    if(o.isFinal && text.trim()){
      capSegments.push({ text:text.trim(), start:capSttBase, end:Math.max(capSttBase+0.5, o.t||capSttBase+1) });
      capSttBase=capSegments[capSegments.length-1].end;
      rebuildCapWords();
    }
  }
};

/* ================= AUTO CAPTIONS ================= */
let capFile=null, capWords=[], capMode='type', capPos='b';
let capSegments=[], capListening=false, capSttBase=0;
function setCapMode(m){
  capMode=m;
  $('cap-mode-type').classList.toggle('on', m==='type');
  $('cap-mode-live').classList.toggle('on', m==='live');
  $('cap-type-box').hidden = m!=='type';
  $('cap-live-box').hidden = m!=='live';
}
function setCapPos(p){
  capPos=p;
  $('cap-pos-b').classList.toggle('on', p==='b');
  $('cap-pos-c').classList.toggle('on', p==='c');
  drawCaptionsPreview();
}
$('cap-video').addEventListener('change', e=>{
  const f=e.target.files[0]; if(!f) return;
  capFile=f;
  const v=$('cap-player');
  v.src=URL.createObjectURL(f); v.style.display='block';
  v.onloadedmetadata=()=>{
    $('cap-video-info').textContent=`${f.name} · ${fmtTime(v.duration)} · ${(f.size/1048576).toFixed(1)} MB`;
    const c=$('cap-canvas');
    c.width=540; c.height=960;
    rebuildCapWords(); drawCaptionsPreview();
  };
  v.onerror=()=>{ $('cap-video-info').textContent='Could not read this video file.'; };
});
$('cap-words').addEventListener('input', ()=>{ rebuildCapWords(); drawCaptionsPreview(); });
$('cap-lang').addEventListener('change', ()=>{ rebuildCapWords(); drawCaptionsPreview(); });
function rebuildCapWords(){
  const lang=$('cap-lang').value;
  const v=$('cap-player');
  const dur=v&&v.duration? v.duration : 10;
  if(capMode==='live'){ capWords=wordsFromSegments(capSegments); }
  else { capWords=wordsFromText(displayWords($('cap-words').value,lang), dur); }
}
function drawCaptions(canvas, videoEl, words, t, pos){
  const ctx=canvas.getContext('2d');
  const W=canvas.width, H=canvas.height;
  ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
  if(videoEl && videoEl.videoWidth){
    const vw=videoEl.videoWidth, vh=videoEl.videoHeight;
    const s=Math.max(W/vw, H/vh);
    const dw=vw*s, dh=vh*s;
    ctx.drawImage(videoEl, (W-dw)/2, (H-dh)/2, dw, dh);
  }
  // current phrase: words around t
  let idx=-1;
  for(let i=0;i<words.length;i++){ if(t>=words[i].start && t<words[i].end){ idx=i; break; } }
  if(words.length && idx>=0){
    const lo=Math.max(0,idx-2), hi=Math.min(words.length, idx+3);
    const phrase=words.slice(lo,hi);
    const y = pos==='c' ? H*0.5 : H*0.82;
    const theme=THEMES[capTheme]||THEMES[0];
    const sizeMul = capSize==='s'?0.8 : capSize==='l'?1.25 : 1;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    // measure full phrase
    let size=H*0.042*sizeMul;
    ctx.font=`700 ${size}px Arial, sans-serif`;
    let total=phrase.reduce((a,w)=>a+ctx.measureText(w.text+' ').width,0);
    while(total>W*0.86 && size>12){ size*=0.9; ctx.font=`700 ${size}px Arial, sans-serif`;
      total=phrase.reduce((a,w)=>a+ctx.measureText(w.text+' ').width,0); }
    const barH=size*2.1, barW=Math.min(W*0.92, total+36);
    ctx.fillStyle='rgba(0,0,0,.62)';
    roundRect(ctx, (W-barW)/2, y-barH/2, barW, barH, 12); ctx.fill();
    let x=(W-total)/2;
    phrase.forEach((w,i)=>{
      const ww=ctx.measureText(w.text+' ').width;
      ctx.fillStyle = (lo+i===idx) ? theme.hi : theme.fg;
      ctx.font=`${lo+i===idx?'800':'600'} ${size}px Arial, sans-serif`;
      ctx.fillText(w.text, x+ctx.measureText(w.text).width/2, y);
      x+=ww;
    });
  }
}
function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}
function drawCaptionsPreview(){
  const v=$('cap-player');
  drawCaptions($('cap-canvas'), v, capWords, v?v.currentTime||0:0, capPos);
}
function previewCaptions(){
  const v=$('cap-player');
  if(!v || !v.src) return toast('Pick a video first');
  rebuildCapWords();
  if(!capWords.length) return toast('Add some words first');
  stopPreview();
  v.currentTime=0;
  const loop=()=>{
    drawCaptions($('cap-canvas'), v, capWords, v.currentTime||0, capPos);
    if(!v.paused && !v.ended) previewRAF=requestAnimationFrame(loop);
  };
  v.play().then(()=>{ previewRAF=requestAnimationFrame(loop); })
    .catch(()=>toast('Video playback was blocked'));
}
async function exportCaptions(){
  const v=$('cap-player');
  if(!v || !v.src) return toast('Pick a video first');
  rebuildCapWords();
  if(!capWords.length) return toast('Add some words first');
  const st=$('cap-export-status'); st.textContent='Rendering captioned video… please wait.';
  try{
    const canvas=document.createElement('canvas');
    canvas.width=540; canvas.height=960;
    const blob=await renderTypographyVideo(canvas, capWords, null, THEMES[capTheme], 'v', v);
    window._saveStatusEl=st;
    const name='RuhTypography-Captions-'+Date.now()+'.webm';
    await saveBlob(blob, name, 'video/webm');
    st.textContent='Video rendered ('+(blob.size/1048576).toFixed(1)+' MB). Saving…';
    setLastExport('downloads', name, 'video/webm');
  }catch(err){ st.textContent='Export failed: '+err.message; }
}

/* ================= SCRIPT TO VIDEO ================= */
let scrAudioEl=null, scrWords=[], scrFormat='v', scrDuration=0;
function setScrFormat(f){
  scrFormat=f;
  $('scr-fmt-v').classList.toggle('on', f==='v');
  $('scr-fmt-h').classList.toggle('on', f==='h');
  const c=$('scr-canvas');
  if(f==='v'){ c.width=540; c.height=960; } else { c.width=960; c.height=540; }
  drawScriptPreview();
}
function previewVoice(which){
  const text = which==='scr' ? $('scr-text').value : $('vox-text').value;
  const lang = which==='scr' ? $('scr-lang').value : $('vox-lang').value;
  if(!text.trim()) return toast('Type something first');
  if(hasAndroid()){ try{ Android.ttsSpeak(text, lang); return; }catch(e){} }
  if('speechSynthesis' in window){
    const u=new SpeechSynthesisUtterance(text);
    u.lang=lang; speechSynthesis.cancel(); speechSynthesis.speak(u);
  } else toast('Voice preview needs the installed app');
}
function makeScriptAudio(){
  const text=$('scr-text').value.trim();
  if(!text) return toast('Write your script first');
  if(!hasAndroid()) return toast('Voice audio needs the installed app');
  window._ttsTarget='script';
  $('scr-audio-status').textContent='Making voice audio…';
  try{ Android.ttsSave(text, $('scr-lang').value, 'ruhtypography-script-voice-'+Date.now()+'.wav'); }
  catch(e){ $('scr-audio-status').textContent='Voice failed: '+e.message; }
}
function loadScriptAudio(path){
  if(!scrAudioEl){
    scrAudioEl=document.createElement('audio');
    scrAudioEl.preload='auto';
    document.body.appendChild(scrAudioEl);
  }
  scrAudioEl.src=path;
  scrAudioEl.onloadedmetadata=()=>{
    scrDuration=scrAudioEl.duration||0;
    scrWords=wordsFromText($('scr-text').value, Math.max(1,scrDuration));
    drawScriptPreview();
  };
  scrAudioEl.onerror=()=>{ $('scr-audio-status').textContent='Could not load the voice audio.'; };
}
$('scr-text').addEventListener('input', ()=>{
  if(scrDuration) scrWords=wordsFromText($('scr-text').value, scrDuration);
  drawScriptPreview();
});
function drawScriptPreview(){
  const c=$('scr-canvas');
  const t=scrAudioEl?scrAudioEl.currentTime||0:0;
  drawKinetic(c, scrWords, t, THEMES[scrTheme], scrFormat);
}
function previewScript(){
  if(!scrAudioEl || !scrAudioEl.src) return toast('Make the voice audio first (step 1)');
  if(!scrWords.length) return toast('Write your script first');
  stopPreview();
  previewAudioEl=scrAudioEl;
  const loop=()=>{
    drawKinetic($('scr-canvas'), scrWords, scrAudioEl.currentTime||0, THEMES[scrTheme], scrFormat);
    if(!scrAudioEl.paused && !scrAudioEl.ended) previewRAF=requestAnimationFrame(loop);
  };
  scrAudioEl.currentTime=0;
  scrAudioEl.play().then(()=>{ previewRAF=requestAnimationFrame(loop); })
    .catch(()=>toast('Audio playback was blocked'));
}
async function exportScript(){
  if(!scrAudioEl || !scrAudioEl.src) return toast('Make the voice audio first (step 1)');
  if(!scrWords.length) return toast('Write your script first');
  const st=$('scr-export-status'); st.textContent='Rendering video… please wait.';
  try{
    const canvas=document.createElement('canvas');
    canvas.width=scrFormat==='v'?540:960; canvas.height=scrFormat==='v'?960:540;
    const blob=await renderTypographyVideo(canvas, scrWords, null, THEMES[scrTheme], scrFormat, scrAudioEl);
    window._saveStatusEl=st;
    const name='RuhTypography-Script-'+Date.now()+'.webm';
    await saveBlob(blob, name, 'video/webm');
    st.textContent='Video rendered ('+(blob.size/1048576).toFixed(1)+' MB). Saving…';
    setLastExport('downloads', name, 'video/webm');
  }catch(err){ st.textContent='Export failed: '+err.message; }
}

/* ================= TEXT TO VOICE ================= */
function saveVoice(){
  const text=$('vox-text').value.trim();
  if(!text) return toast('Type something first');
  if(!hasAndroid()) return toast('Saving audio needs the installed app');
  window._ttsTarget='vox';
  $('vox-status').textContent='Making audio…';
  try{ Android.ttsSave(text, $('vox-lang').value, 'ruhtypography-voice-'+Date.now()+'.wav'); }
  catch(e){ $('vox-status').textContent='Voice failed: '+e.message; }
}

/* ================= AUDIO TOOLS ================= */
let audBuffer=null, audBuffer2=null, audFileName='';
$('aud-file').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{
    audBuffer=await fileToBuffer(f); audFileName=f.name;
    $('aud-info').textContent=`${f.name} · ${fmtTime(audBuffer.duration)}`;
    $('aud-start').max=audBuffer.duration; $('aud-end').max=audBuffer.duration;
    $('aud-end').value=audBuffer.duration;
    trimSlider(); drawWaveform();
  }catch(err){ $('aud-info').textContent='Could not read this audio file: '+err.message; }
});
$('aud-file2').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{
    audBuffer2=await fileToBuffer(f);
    $('aud-info2').textContent=`${f.name} · ${fmtTime(audBuffer2.duration)}`;
  }catch(err){ $('aud-info2').textContent='Could not read this audio file: '+err.message; }
});
function trimSlider(){
  if(!audBuffer) return;
  const s=parseFloat($('aud-start').value), en=parseFloat($('aud-end').value);
  $('aud-start-lbl').textContent=fmtTime(s);
  $('aud-end-lbl').textContent=fmtTime(en);
  drawWaveform();
}
function drawWaveform(){
  const c=$('aud-wave'), ctx=c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  ctx.fillStyle='#0a1f22'; ctx.fillRect(0,0,c.width,c.height);
  if(!audBuffer) return;
  const data=audBuffer.getChannelData(0);
  const step=Math.floor(data.length/220)||1;
  const s=parseFloat($('aud-start').value||0), en=parseFloat($('aud-end').value||audBuffer.duration);
  ctx.fillStyle='#14b8a6';
  for(let x=0;x<220;x++){
    let peak=0;
    const off=x*step;
    for(let i=0;i<step;i+=4){ const v=Math.abs(data[off+i]||0); if(v>peak) peak=v; }
    const h=Math.max(2, peak*c.height*0.92);
    const t=x/220*audBuffer.duration;
    ctx.globalAlpha=(t>=s&&t<=en)?1:0.25;
    ctx.fillRect(x*(c.width/220), (c.height-h)/2, Math.max(1,c.width/220-1), h);
  }
  ctx.globalAlpha=1;
}
function sliceBuffer(buf, start, end){
  const sr=buf.sampleRate;
  const s0=Math.floor(start*sr), s1=Math.min(buf.length, Math.floor(end*sr));
  const out=audioCtx().createBuffer(buf.numberOfChannels, Math.max(1,s1-s0), sr);
  for(let ch=0; ch<buf.numberOfChannels; ch++){
    out.getChannelData(ch).set(buf.getChannelData(ch).subarray(s0,s1));
  }
  return out;
}
function encodeWAV(buf){
  const nCh=buf.numberOfChannels, sr=buf.sampleRate, len=buf.length*nCh*2+44;
  const ab=new ArrayBuffer(len), v=new DataView(ab);
  const wstr=(o,s)=>{ for(let i=0;i<s.length;i++) v.setUint8(o+i, s.charCodeAt(i)); };
  wstr(0,'RIFF'); v.setUint32(4,len-8,true); wstr(8,'WAVE'); wstr(12,'fmt ');
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,nCh,true);
  v.setUint32(24,sr,true); v.setUint32(28,sr*nCh*2,true); v.setUint16(32,nCh*2,true);
  v.setUint16(34,16,true); wstr(36,'data'); v.setUint32(40,len-44,true);
  let o=44;
  const chans=[]; for(let c=0;c<nCh;c++) chans.push(buf.getChannelData(c));
  for(let i=0;i<buf.length;i++) for(let c=0;c<nCh;c++){
    const s=Math.max(-1,Math.min(1,chans[c][i]));
    v.setInt16(o, s<0?s*0x8000:s*0x7FFF, true); o+=2;
  }
  return new Blob([ab], {type:'audio/wav'});
}
function encodeMP3(buf){
  if(typeof lamejs==='undefined') throw new Error('MP3 encoder is missing');
  const nCh=Math.min(2,buf.numberOfChannels), sr=buf.sampleRate;
  const enc=new lamejs.Mp3Encoder(nCh, sr, 128);
  const L=buf.getChannelData(0), R=nCh>1?buf.getChannelData(1):L;
  const to16=f=>{ const a=new Int16Array(f.length); for(let i=0;i<f.length;i++){ const s=Math.max(-1,Math.min(1,f[i])); a[i]=s<0?s*0x8000:s*0x7FFF; } return a; };
  const l16=to16(L), r16=to16(R);
  const chunks=[]; const block=1152;
  for(let i=0;i<l16.length;i+=block){
    const l=l16.subarray(i,i+block), r=r16.subarray(i,i+block);
    const d=enc.encodeBuffer(l,r);
    if(d.length) chunks.push(new Int8Array(d));
  }
  const end=enc.flush(); if(end.length) chunks.push(new Int8Array(end));
  return new Blob(chunks, {type:'audio/mp3'});
}
function processAudioBuffer(buf, gainPct, fadeIn, fadeOut, normalize){
  const g=(gainPct==null?100:gainPct)/100;
  let peak=0;
  if(normalize){ for(let ch=0;ch<buf.numberOfChannels;ch++){ const d=buf.getChannelData(ch); for(let i=0;i<d.length;i+=8){ const a=Math.abs(d[i]); if(a>peak) peak=a; } } }
  const norm = normalize && peak>0 ? 0.95/peak : 1;
  // Fades must never overlap: cap each fade at half the buffer, otherwise
  // the middle of a short clip gets attenuated twice.
  const fadeLen=Math.min(Math.floor(buf.length/2), Math.floor(buf.sampleRate*1.5));
  for(let ch=0;ch<buf.numberOfChannels;ch++){
    const d=buf.getChannelData(ch);
    for(let i=0;i<d.length;i++){
      let v=d[i]*g*norm;
      if(fadeIn && i<fadeLen) v*=i/fadeLen;
      if(fadeOut && i>buf.length-fadeLen) v*=(buf.length-i)/fadeLen;
      d[i]=v;
    }
  }
  return buf;
}
async function exportTrim(fmt){
  if(!audBuffer) return toast('Pick an audio file first');
  const s=parseFloat($('aud-start').value||0), en=parseFloat($('aud-end').value||audBuffer.duration);
  if(en-s<0.1) return toast('Trim is too short — widen the range');
  const st=$('aud-trim-status'); st.textContent='Exporting…';
  try{
    const sliced=processAudioBuffer(sliceBuffer(audBuffer, s, en),
      parseFloat($('aud-gain')?$('aud-gain').value:100),
      $('aud-fadein')&&$('aud-fadein').checked, $('aud-fadeout')&&$('aud-fadeout').checked,
      $('aud-norm')&&$('aud-norm').checked);
    const blob= fmt==='mp3' ? encodeMP3(sliced) : encodeWAV(sliced);
    window._saveStatusEl=st;
    const name='RuhTypography-Trim-'+Date.now()+'.'+fmt;
    await saveBlob(blob, name, fmt==='mp3'?'audio/mp3':'audio/wav');
    st.textContent='Trimmed audio ('+(blob.size/1024).toFixed(0)+' KB). Saving…';
    setLastExport('downloads', name, fmt==='mp3'?'audio/mp3':'audio/wav');
  }catch(err){ st.textContent='Export failed: '+err.message; }
}
async function exportMerge(){
  if(!audBuffer || !audBuffer2) return toast('Pick both audios first');
  const st=$('aud-merge-status'); st.textContent='Merging…';
  try{
    const sr=Math.max(audBuffer.sampleRate, audBuffer2.sampleRate);
    const offline=new OfflineAudioContext(2, Math.ceil((audBuffer.duration+audBuffer2.duration)*sr), sr);
    const mk=b=>{ const s=offline.createBufferSource(); s.buffer=b; s.connect(offline.destination); return s; };
    const s1=mk(audBuffer); s1.start(0);
    const s2=mk(audBuffer2); s2.start(audBuffer.duration);
    const merged=await offline.startRendering();
    const blob=encodeWAV(merged);
    window._saveStatusEl=st;
    const name='RuhTypography-Merge-'+Date.now()+'.wav';
    await saveBlob(blob, name, 'audio/wav');
    st.textContent='Merged audio ('+(blob.size/1024).toFixed(0)+' KB). Saving…';
    setLastExport('downloads', name, 'audio/wav');
  }catch(err){ st.textContent='Merge failed: '+err.message; }
}

/* init */
drawKineticPreview();
drawCaptionsPreview();
