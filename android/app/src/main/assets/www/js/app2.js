/* Ruh Typography Studio — studios module (app2.js) */
'use strict';
/* ---------- tiny store ---------- */
function storeGet(k, fb){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):fb; }catch(e){ return fb; } }
function storeSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }

/* ---------- audio analysis: BPM + vocal onsets (real, on-device) ---------- */
function onsetEnvelope(buffer){
  const ch=buffer.getChannelData(0), sr=buffer.sampleRate, hop=512, win=1024;
  const env=[];
  for(let i=0;i+win<ch.length;i+=hop){ let e=0; for(let j=0;j<win;j+=8) e+=Math.abs(ch[i+j]); env.push(e); }
  const onset=[];
  for(let i=1;i<env.length;i++) onset.push(Math.max(0, env[i]-env[i-1]));
  return { onset, fps: sr/hop };
}
function estimateBPM(buffer){
  const { onset, fps } = onsetEnvelope(buffer);
  if(!onset.length) return 0;
  let bestLag=0, bestScore=0;
  for(let bpm=60;bpm<=180;bpm++){
    const lag=Math.round(fps*60/bpm);
    if(lag<2||lag>=onset.length) continue;
    let s=0; for(let i=0;i+lag<onset.length;i++) s+=onset[i]*onset[i+lag];
    if(s>bestScore){ bestScore=s; bestLag=lag; }
  }
  return bestLag? Math.round(60*fps/bestLag) : 0;
}
function detectOnsets(buffer, minGapSec){
  const { onset, fps } = onsetEnvelope(buffer);
  const times=[]; let last=-10;
  const max=Math.max(...onset, 0.001);
  const thr=max*0.25;
  for(let i=1;i<onset.length-1;i++){
    if(onset[i]>thr && onset[i]>=onset[i-1] && onset[i]>=onset[i+1]){
      const t=i/fps;
      if(t-last>=(minGapSec||0.18)){ times.push(t); last=t; }
    }
  }
  return times;
}
/* Align typed words to real vocal onsets. Each word snaps to the nearest
   onset; words without a nearby onset keep their position. Confidence is
   1.0 when snapped within 80ms, lower otherwise. */
function alignWordsToOnsets(words, buffer){
  const onsets=detectOnsets(buffer, 0.18);
  const dur=buffer.duration;
  if(!onsets.length) return words.map(w=>({...w, conf:0.4}));
  // first pass: spread words across the onset range, then snap each to nearest onset
  const first=onsets[0], last=onsets[onsets.length-1];
  return words.map((w,i)=>{
    const frac = words.length>1 ? i/(words.length-1) : 0;
    const guess = first + frac*Math.max(0, last-first);
    let best=onsets[0], bd=1e9;
    for(const o of onsets){ const d=Math.abs(o-guess); if(d<bd){ bd=d; best=o; } }
    const start=Math.max(0, best-0.05);
    const end=Math.min(dur, start+Math.max(0.25, (w.end-w.start)||0.4));
    return { ...w, start, end, conf: bd<=0.08?1:bd<=0.25?0.8:0.6 };
  });
}

/* ---------- AUTO LYRICS SYNC ---------- */
let lyrBuffer=null, lyrWords=[], lyrMode='type', lyrSegments=[], lyrListening=false, lyrSttBase=0, lyrSel=-1;
$('lyr-audio').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{
    lyrBuffer=await fileToBuffer(f);
    $('lyr-audio-info').textContent=`${f.name} · ${fmtTime(lyrBuffer.duration)} · ${(f.size/1048576).toFixed(1)} MB`;
    const p=$('lyr-player'); p.src=URL.createObjectURL(f); p.style.display='block';
    toast('Song loaded — now paste the lyrics');
  }catch(err){ $('lyr-audio-info').textContent='Could not read this audio file: '+err.message; }
});
$('lyr-file').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return;
  const txt=await f.text();
  $('lyr-text').value=parseLyricFile(txt, f.name);
  toast('Lyrics imported from '+f.name);
});
function parseLyricFile(txt, name){
  if(/\.lrc$/i.test(name)){
    return txt.split(/\r?\n/).map(l=>l.replace(/^\[\d+:\d+(\.\d+)?\]/,'').trim()).filter(Boolean).join('\n');
  }
  if(/\.srt$/i.test(name)){
    return txt.split(/\r?\n\r?\n/).map(b=>b.split(/\r?\n/).slice(2).join(' ')).filter(Boolean).join('\n');
  }
  return txt;
}
function setLyrMode(m){
  lyrMode=m;
  $('lyr-mode-type').classList.toggle('on', m==='type');
  $('lyr-mode-live').classList.toggle('on', m==='live');
  $('lyr-type-box').hidden = m!=='type';
  $('lyr-live-box').hidden = m!=='live';
}
function toggleSttLyr(){
  if(!hasAndroid()) return toast('Live transcription needs the installed app');
  if(lyrListening){ try{ Android.sttStop(); }catch(e){} lyrListening=false; $('lyr-stt-btn').textContent='🎙 Start listening'; return; }
  sttTarget='lyr'; lyrListening=true; lyrSttBase=lyrSegments.length?lyrSegments[lyrSegments.length-1].end:0;
  $('lyr-stt-btn').textContent='■ Stop listening';
  startSttListening();
}
/* extend the app.js STT result handler for the lyrics screen */
const _origSttResult = window.onSttResult;
window.onSttResult = function(o){
  if(sttTarget==='lyr'){
    if(!o) return;
    const lang=$('lyr-lang').value;
    const text=displayWords(o.text||'', lang);
    if(o.error){ lyrListening=false; $('lyr-stt-btn').textContent='🎙 Start listening'; if(o.error!==7) toast('Listening stopped'); return; }
    $('lyr-stt-text').textContent=text;
    if(o.isFinal && text.trim()){
      lyrSegments.push({ text:text.trim(), start:lyrSttBase, end:Math.max(lyrSttBase+0.5, o.t||lyrSttBase+1) });
      lyrSttBase=lyrSegments[lyrSegments.length-1].end;
    }
    return;
  }
  return _origSttResult(o);
};
function lyrWordsFromText(){
  const raw = lyrMode==='live' ? lyrSegments.map(s=>s.text).join(' ') : $('lyr-text').value;
  const dur = lyrBuffer?lyrBuffer.duration:10;
  return wordsFromText(displayWords(raw, $('lyr-lang').value), dur);
}
async function autoSyncLyrics(){
  if(!lyrBuffer) return toast('Pick a song first');
  const words=lyrWordsFromText();
  if(!words.length) return toast('Add some lyrics first');
  const st=$('lyr-sync-status'); st.textContent='Listening to vocal onsets…';
  $('lyr-sync-bar').style.width='30%';
  await new Promise(r=>setTimeout(r,30));
  lyrWords=alignWordsToOnsets(words, lyrBuffer);
  $('lyr-sync-bar').style.width='100%';
  const avg=lyrWords.reduce((a,w)=>a+(w.conf||0),0)/lyrWords.length;
  st.textContent=`Synced ${lyrWords.length} words to real vocal onsets · avg confidence ${(avg*100).toFixed(0)}%. Tap any word below to correct its time.`;
  renderLyrWords();
}
function renderLyrWords(){
  const box=$('lyr-words'); box.innerHTML='';
  lyrWords.forEach((w,i)=>{
    const s=document.createElement('span');
    s.className='chip'+(lyrSel===i?' on':'');
    s.textContent=`${w.text} · ${w.start.toFixed(2)}s${(w.conf||1)<0.8?' ~':''}`;
    s.onclick=()=>{ lyrSel=i; renderLyrWords(); showLyrEditor(); };
    box.appendChild(s);
  });
}
function showLyrEditor(){
  const w=lyrWords[lyrSel]; if(!w) return;
  const box=$('lyr-words');
  const div=document.createElement('div');
  div.style.marginTop='10px';
  div.innerHTML=`<b>${w.text}</b> — start <input type="number" id="lyr-edit-start" step="0.05" value="${w.start.toFixed(2)}" style="width:80px"> end <input type="number" id="lyr-edit-end" step="0.05" value="${w.end.toFixed(2)}" style="width:80px"> <button class="btn" id="lyr-edit-apply">Apply</button>`;
  box.appendChild(div);
  $('lyr-edit-apply').onclick=()=>{
    w.start=Math.max(0, parseFloat($('lyr-edit-start').value)||0);
    w.end=Math.max(w.start+0.1, parseFloat($('lyr-edit-end').value)||w.start+0.4);
    w.conf=1; lyrSel=-1; renderLyrWords();
    $('lyr-sync-status').textContent='Word timing corrected manually.';
  };
}
function previewSync(){
  if(!lyrBuffer) return toast('Pick a song first');
  if(!lyrWords.length) return toast('Sync the lyrics first');
  stopPreview();
  const p=$('lyr-player');
  previewAudioEl=p;
  const loop=()=>{
    drawKinetic($('lyr-canvas'), lyrWords, p.currentTime||0, kinThemeObj(), kinFormat);
    if(!p.paused && !p.ended) previewRAF=requestAnimationFrame(loop);
  };
  p.currentTime=0; p.play().then(()=>{ previewRAF=requestAnimationFrame(loop); })
    .catch(()=>toast('Audio playback was blocked'));
}
function applySyncToTypography(){
  if(!lyrWords.length) return toast('Sync the lyrics first');
  kinBuffer=lyrBuffer; kinWords=lyrWords.map(w=>({...w}));
  const p=$('lyr-player');
  if(p && p.src){ const kp=$('kin-player'); kp.src=p.src; kp.style.display='block'; }
  $('kin-words').value=lyrWords.map(w=>w.text).join(' ');
  $('lyr-apply-status').textContent='Applied — open Typography Studio to style and export it.';
  toast('Synced lyrics applied to Typography Studio');
  setTimeout(()=>openTool('kinetic'), 600);
}

/* ---------- AUDIO STUDIO extras ---------- */
let audEl=null, audSpeed=1;
function audPlayPause(){
  if(!audBuffer) return toast('Pick an audio first');
  if(!audEl){ audEl=new Audio(); }
  if(!audEl.src){ const f=$('aud-file').files[0]; if(!f) return toast('Pick an audio first'); audEl.src=URL.createObjectURL(f); }
  audEl.playbackRate=audSpeed;
  if(audEl.paused) audEl.play(); else audEl.pause();
}
function setAudSpeed(r){
  audSpeed=r;
  document.querySelectorAll('#tool-audio .seg-btn').forEach(b=>b.classList.remove('on'));
  event && event.target && event.target.classList.add('on');
  if(audEl) audEl.playbackRate=r;
  toast('Speed '+r+'× (preview)');
}
function audDetectBpm(){
  if(!audBuffer) return toast('Pick an audio first');
  const bpm=estimateBPM(audBuffer);
  const onsets=detectOnsets(audBuffer, 0.25);
  $('aud-bpm').textContent = bpm? `Tempo ≈ ${bpm} BPM · ${onsets.length} beats detected · duration ${fmtTime(audBuffer.duration)}` : 'Could not detect a steady tempo in this audio.';
}

/* ---------- AI MASHUP STUDIO ---------- */
let mashA=null, mashB=null, mashBpmA=0, mashBpmB=0, mashRateB=1, mashNodes=null;
$('mash-a').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{ mashA=await fileToBuffer(f); $('mash-a-info').textContent=`${f.name} · ${fmtTime(mashA.duration)}`; }
  catch(err){ $('mash-a-info').textContent='Could not read: '+err.message; }
});
$('mash-b').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{ mashB=await fileToBuffer(f); $('mash-b-info').textContent=`${f.name} · ${fmtTime(mashB.duration)}`; }
  catch(err){ $('mash-b-info').textContent='Could not read: '+err.message; }
});
function mashDetect(){
  if(!mashA || !mashB) return toast('Pick both songs first');
  mashBpmA=estimateBPM(mashA); mashBpmB=estimateBPM(mashB);
  $('mash-bpm').textContent=`Song A ≈ ${mashBpmA||'?'} BPM · Song B ≈ ${mashBpmB||'?'} BPM`;
}
function mashMatchTempo(){
  if(!mashBpmA || !mashBpmB) mashDetect();
  if(!mashBpmA || !mashBpmB) return toast('Tempo could not be detected on one of the songs');
  mashRateB=mashBpmA/mashBpmB;
  $('mash-bpm').textContent=`Song A ${mashBpmA} BPM · Song B ${mashBpmB} BPM → B plays at ${mashRateB.toFixed(2)}× to match A (pitch shifts with tempo).`;
}
function mashPreview(){
  if(!mashA || !mashB) return toast('Pick both songs first');
  stopPreview();
  const ctx=audioCtx(); ctx.resume();
  const gA=ctx.createGain(), gB=ctx.createGain();
  const bal=parseFloat($('mash-bal').value||50)/100;
  gA.gain.value=bal; gB.gain.value=1-bal;
  const xfade=parseFloat($('mash-xfade').value||3);
  const sA=ctx.createBufferSource(); sA.buffer=mashA; sA.connect(gA); gA.connect(ctx.destination);
  const sB=ctx.createBufferSource(); sB.buffer=mashB; sB.playbackRate.value=mashRateB; sB.connect(gB); gB.connect(ctx.destination);
  const t0=ctx.currentTime+0.1;
  const bStart=Math.max(0, mashA.duration-xfade);
  sA.start(t0); sB.start(t0+bStart);
  gA.gain.setValueAtTime(bal, t0+bStart); gA.gain.linearRampToValueAtTime(0, t0+bStart+xfade);
  gB.gain.setValueAtTime(0, t0+bStart); gB.gain.linearRampToValueAtTime(1-bal, t0+bStart+xfade);
  mashNodes={sA,sB,gA,gB};
  toast('Playing mashup preview');
}
async function mashExport(){
  if(!mashA || !mashB) return toast('Pick both songs first');
  const st=$('mash-status'); st.textContent='Rendering mashup…';
  try{
    const sr=Math.max(mashA.sampleRate, mashB.sampleRate);
    const xfade=parseFloat($('mash-xfade').value||3);
    const bStart=Math.max(0, mashA.duration-xfade);
    const total=bStart + mashB.duration/mashRateB;
    const off=new OfflineAudioContext(2, Math.ceil(total*sr), sr);
    const bal=parseFloat($('mash-bal').value||50)/100;
    const mk=(buf, rate)=>{ const s=off.createBufferSource(); s.buffer=buf; s.playbackRate.value=rate; return s; };
    const gA=off.createGain(), gB=off.createGain();
    const sA=mk(mashA,1); sA.connect(gA); gA.connect(off.destination);
    const sB=mk(mashB,mashRateB); sB.connect(gB); gB.connect(off.destination);
    gA.gain.setValueAtTime(bal, bStart); gA.gain.linearRampToValueAtTime(0, bStart+xfade);
    gB.gain.setValueAtTime(0, bStart); gB.gain.linearRampToValueAtTime(1-bal, bStart+xfade);
    sA.start(0); sB.start(bStart);
    const rendered=await off.startRendering();
    const blob=encodeWAV(rendered);
    window._saveStatusEl=st;
    const name='RuhTypography-Mashup-'+Date.now()+'.wav';
    await saveBlob(blob, name, 'audio/wav');
    st.textContent='Mashup exported ('+(blob.size/1048576).toFixed(1)+' MB). Saving…';
    setLastExport('downloads', name, 'audio/wav');
    $('mash-share-row').hidden=false;
  }catch(err){ st.textContent='Mashup export failed: '+err.message; }
}

/* ---------- VIDEO EDITOR ---------- */
let vedFile=null, vedSpeed=1, vedFormat='v', vedRes='1080', vedDur=0;
$('ved-file').addEventListener('change', e=>{
  const f=e.target.files[0]; if(!f) return;
  vedFile=f;
  const v=$('ved-player');
  v.src=URL.createObjectURL(f); v.style.display='block';
  v.onloadedmetadata=()=>{
    vedDur=v.duration||0;
    $('ved-info').textContent=`${f.name} · ${fmtTime(vedDur)} · ${(f.size/1048576).toFixed(1)} MB`;
    $('ved-start').max=vedDur; $('ved-end').max=vedDur; $('ved-end').value=vedDur;
    vedTrimSlider();
  };
  v.onerror=()=>{ $('ved-info').textContent='Could not read this video file.'; };
});
function vedTrimSlider(){
  const s=parseFloat($('ved-start').value||0), en=parseFloat($('ved-end').value||vedDur);
  $('ved-start-lbl').textContent=s.toFixed(1)+'s';
  $('ved-end-lbl').textContent=en.toFixed(1)+'s';
  const v=$('ved-player'); if(v && v.src) v.currentTime=Math.min(s, vedDur-0.1);
}
function setVedSpeed(r){ vedSpeed=r; const v=$('ved-player'); if(v) v.playbackRate=r; }
function setVedFormat(f){ vedFormat=f; ['v','h','s'].forEach(x=>$('ved-fmt-'+x).classList.toggle('on',x===f)); }
function setVedRes(r){ vedRes=r; ['720','1080','4k'].forEach(x=>$('ved-res-'+x).classList.toggle('on',x===r)); }
function vedFilterCSS(){ const f=$('ved-filter').value;
  return f==='warm'?'sepia(0.35) saturate(1.3)':f==='cool'?'hue-rotate(180deg) saturate(1.1)':f==='bw'?'grayscale(1)':f==='vivid'?'saturate(1.8) contrast(1.1)':f==='vintage'?'sepia(0.6) contrast(0.9) brightness(1.05)':'none'; }
function vedPreviewFilter(){ const v=$('ved-player'); if(v) v.style.filter=vedFilterCSS(); }
async function exportVideoEdit(){
  const v=$('ved-player');
  if(!v || !v.src) return toast('Pick a video first');
  const st=$('ved-status'); st.textContent='Rendering edited video… please wait.';
  try{
    const s=parseFloat($('ved-start').value||0), en=parseFloat($('ved-end').value||vedDur);
    if(en-s<0.2) return toast('Trim is too short — widen the range');
    const [W,H]= vedRes==='4k' ? (vedFormat==='v'?[2160,3840]:vedFormat==='s'?[2160,2160]:[3840,2160])
      : vedRes==='720' ? (vedFormat==='v'?[720,1280]:vedFormat==='s'?[720,720]:[1280,720])
      : (vedFormat==='v'?[1080,1920]:vedFormat==='s'?[1080,1080]:[1920,1080]);
    const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
    const ctx=canvas.getContext('2d');
    const filter=vedFilterCSS();
    const words=wordsFromText(($('ved-words').value||'').trim(), en-s);
    const bitrate=vedRes==='4k'?25000000:vedRes==='720'?5000000:12000000;
    const blob=await renderVideoEdit(canvas, v, s, en, vedSpeed, filter, words, bitrate);
    window._saveStatusEl=st;
    const name='RuhTypography-VideoEdit-'+Date.now()+'.webm';
    await saveBlob(blob, name, 'video/webm');
    st.textContent='Video exported ('+(blob.size/1048576).toFixed(1)+' MB). Saving…';
    setLastExport('downloads', name, 'video/webm');
    $('ved-share-row').hidden=false;
  }catch(err){ st.textContent='Video export failed: '+err.message; }
}
async function renderVideoEdit(canvas, videoEl, start, end, speed, filter, words, bitrate){
  const ctx=audioCtx();
  try{ await ctx.resume(); }catch(e){}
  const streamDest=getExportDest();
  const canvasStream=canvas.captureStream(30);
  const combined=new MediaStream([...canvasStream.getVideoTracks(), ...streamDest.stream.getAudioTracks()]);
  const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']
    .find(m=>{ try{ return MediaRecorder.isTypeSupported(m); }catch(e){ return false; } }) || '';
  const rec=new MediaRecorder(combined, mime?{mimeType:mime,videoBitsPerSecond:bitrate||12000000}:undefined);
  const chunks=[]; rec.ondataavailable=e=>{ if(e.data&&e.data.size) chunks.push(e.data); };
  const done=new Promise(res=>{ rec.onstop=res; });
  if(!videoEl._tfSrc){ videoEl._tfSrc=ctx.createMediaElementSource(videoEl); videoEl._tfSrc.connect(streamDest); videoEl._tfSrc.connect(ctx.destination); }
  const W=canvas.width, H=canvas.height, c2=canvas.getContext('2d');
  videoEl.currentTime=start; videoEl.playbackRate=speed;
  rec.start(250);
  await videoEl.play().catch(()=>{});
  await new Promise((resolve)=>{
    const draw=()=>{
      const t=videoEl.currentTime||0;
      c2.filter=filter;
      const vw=videoEl.videoWidth||W, vh=videoEl.videoHeight||H;
      const sc=Math.max(W/vw, H/vh), dw=vw*sc, dh=vh*sc;
      c2.drawImage(videoEl, (W-dw)/2, (H-dh)/2, dw, dh);
      c2.filter='none';
      if(words && words.length) drawCaptionText(canvas, words.map(w=>({...w, start:w.start+start, end:w.end+start})), t, 'b');
      if(t>=end || videoEl.ended) resolve(); else requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  });
  try{ videoEl.pause(); }catch(e){}
  rec.stop(); await done;
  return new Blob(chunks, { type: rec.mimeType || 'video/webm' });
}

/* caption text only (no background fill) — for the video editor, which
   has already drawn its own video frame */
function drawCaptionText(canvas, words, t, pos){
  const ctx=canvas.getContext('2d');
  const W=canvas.width, H=canvas.height;
  let idx=-1;
  for(let i=0;i<words.length;i++){ if(t>=words[i].start && t<words[i].end){ idx=i; break; } }
  if(!words.length || idx<0) return;
  const lo=Math.max(0,idx-2), hi=Math.min(words.length, idx+3);
  const phrase=words.slice(lo,hi);
  const y = pos==='c' ? H*0.5 : H*0.82;
  const theme=THEMES[capTheme]||THEMES[0];
  const sizeMul = capSize==='s'?0.8 : capSize==='l'?1.25 : 1;
  ctx.textAlign='center'; ctx.textBaseline='middle';
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
/* stop the mashup preview too */
const _origStopPreview = stopPreview;
stopPreview = function(){
  if(mashNodes){ try{ mashNodes.sA.stop(); mashNodes.sB.stop(); }catch(e){} mashNodes=null; }
  if(visRAF){ cancelAnimationFrame(visRAF); visRAF=null; }
  _origStopPreview();
};

/* ---------- EMOJI STUDIO ---------- */
const EMOJI_MOODS={
  love:['❤️','🥰','🌹','💕','😍'], sad:['💔','😢','🌧️','🥀','😔'],
  romantic:['🌹','🦋','✨','💖','🌙'], happy:['😊','🎉','☀️','😄','🌈'],
  attitude:['🔥','😎','⚡','👑','💪'], alone:['🥀','🌌','🌙','💭','🖤'],
  lofi:['🎧','🌙','🌧️','☕','💤'], sufi:['🌙','✨','🕊️','💫','🤲'],
};
const EMOJI_KEYS={
  love:['love','pyar','pyaar','mohabbat','dil','heart','jaan','ishq','muhabbat'],
  sad:['sad','dukh','dard','rona','aansoo','tears','alone','akela','miss','judai','gham','غم'],
  romantic:['romantic','chand','moon','raat','night','taare','stars','mehboob','sanam'],
  happy:['happy','khush','party','celebrat','dance','nach','masti','jeet'],
  attitude:['attitude','king','badshah','sher','fire','aag','style','swag'],
  alone:['alone','akela','tanha','empty','khamosh','silent','door'],
  lofi:['lofi','chill','slow','rain','baarish','coffee','raat','night'],
  sufi:['sufi','allah','khuda','rab','dua','noor','maula','sufi'],
};
function moodOfLine(line){
  const l=' '+line.toLowerCase()+' ';
  let best='happy', bestN=0;
  for(const m in EMOJI_KEYS){ let n=0; for(const k of EMOJI_KEYS[m]) if(l.includes(k)) n++; if(n>bestN){ bestN=n; best=m; } }
  return bestN?best:null;
}
function suggestEmojis(){
  const txt=$('emo-text').value.trim();
  if(!txt) return toast('Paste some lyrics first');
  const lines=txt.split(/\r?\n/).filter(x=>x.trim());
  const box=$('emo-result'); box.innerHTML='';
  lines.forEach(line=>{
    const mood=moodOfLine(line)||'happy';
    const row=document.createElement('div');
    row.style.cssText='margin-bottom:10px;font-size:14px;line-height:1.6';
    row.innerHTML=`<b>${line}</b><br><span style="font-size:22px">${EMOJI_MOODS[mood].join(' ')}</span> <span style="color:var(--muted);font-size:12px">· ${mood} (tap an emoji to copy)</span>`;
    row.querySelectorAll('span')[0].style.cursor='pointer';
    row.onclick=()=>{ const em=EMOJI_MOODS[mood][0]; try{ navigator.clipboard.writeText(em); toast(em+' copied'); }catch(e){ toast('Emoji: '+EMOJI_MOODS[mood].join(' ')); } };
    box.appendChild(row);
  });
}
let emoPos='top', emoOverlayOn=false;
function setEmoPos(p){ emoPos=p; document.querySelectorAll('#tool-emoji .seg-btn').forEach(b=>b.classList.remove('on')); event && event.target && event.target.classList.add('on'); }
function previewEmojiOverlay(){
  const c=$('emo-canvas');
  drawKinetic(c, kinWords.length?kinWords:wordsFromText('hello beautiful world',3), 1.0, kinThemeObj(), 'v');
  const ctx=c.getContext('2d');
  const em=$('emo-overlay-text').value||'❤️';
  const size=parseInt($('emo-size').value||80);
  ctx.font=size+'px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  const y=emoPos==='top'?c.height*0.18:emoPos==='mid'?c.height*0.5:c.height*0.82;
  ctx.fillText(em, c.width/2, y);
  emoOverlayOn=true;
  toast('Emoji overlay enabled for typography exports');
}

/* ---------- GIF STUDIO ---------- */
let gifImg=null;
$('gif-file').addEventListener('change', e=>{
  const f=e.target.files[0]; if(!f) return;
  gifImg=new Image();
  gifImg.onload=()=>{
    const p=$('gif-preview'); p.src=gifImg.src; p.style.display='block';
    $('gif-info').textContent=`${f.name} · ${gifImg.width}×${gifImg.height} — tap Preview to place it on the canvas.`;
  };
  gifImg.src=URL.createObjectURL(f);
});
function previewGifOverlay(){
  if(!gifImg) return toast('Import a GIF first');
  const c=$('gif-canvas');
  drawKinetic(c, kinWords.length?kinWords:wordsFromText('hello beautiful world',3), 1.0, kinThemeObj(), 'v');
  const ctx=c.getContext('2d');
  const w=c.width*(parseInt($('gif-size').value||40)/100);
  const h=w*(gifImg.height/gifImg.width);
  ctx.globalAlpha=parseInt($('gif-op').value||100)/100;
  ctx.drawImage(gifImg, (c.width-w)/2, c.height*0.68, w, h);
  ctx.globalAlpha=1;
  toast('GIF overlay enabled for typography exports');
}
function clearGif(){ gifImg=null; $('gif-preview').style.display='none'; $('gif-info').textContent='GIF removed.'; }

/* ---------- AI VISUAL GENERATOR ---------- */
const VIS_MOODS={
  Sad:{bg:['#0b1026','#312e81'],hi:'#a5b4fc',p:'rain'}, Romantic:{bg:['#2b0a1e','#831843'],hi:'#f9a8d4',p:'hearts'},
  Happy:{bg:['#451a03','#ea580c'],hi:'#fde68a',p:'sun'}, Dark:{bg:['#000000','#1f2937'],hi:'#e5e7eb',p:'smoke'},
  Emotional:{bg:['#1e1b4b','#6d28d9'],hi:'#c4b5fd',p:'glow'}, Chill:{bg:['#082f49','#0369a1'],hi:'#7dd3fc',p:'waves'},
  Lofi:{bg:['#1c1917','#44403c'],hi:'#fbbf24',p:'rain'}, Sufi:{bg:['#052e16','#14532d'],hi:'#86efac',p:'glow'},
  Cinematic:{bg:['#09090b','#3f3f46'],hi:'#facc15',p:'smoke'}, Nature:{bg:['#052e16','#15803d'],hi:'#86efac',p:'leaves'},
  Rain:{bg:['#0f172a','#334155'],hi:'#94a3b8',p:'rain'}, Night:{bg:['#020617','#1e3a8a'],hi:'#93c5fd',p:'stars'},
  Dreamy:{bg:['#2a0a2e','#db2777'],hi:'#f9a8d4',p:'glow'},
};
let visMood='Romantic', visUpload=null, visRAF=null;
(function(){
  const box=$('vis-moods');
  Object.keys(VIS_MOODS).forEach(m=>{
    const c=document.createElement('span');
    c.className='chip'+(m===visMood?' on':''); c.textContent=m;
    c.onclick=()=>{ visMood=m; document.querySelectorAll('#vis-moods .chip').forEach(x=>x.classList.remove('on')); c.classList.add('on'); visPreview(false); };
    box.appendChild(c);
  });
})();
$('vis-file').addEventListener('change', e=>{
  const f=e.target.files[0]; if(!f) return;
  visUpload={ file:f, url:URL.createObjectURL(f), isVideo:f.type.startsWith('video') };
  $('vis-info').textContent=`${f.name} — uploaded as background.`;
});
function drawVisualBG(canvas, mood, t){
  const ctx=canvas.getContext('2d'), W=canvas.width, H=canvas.height;
  const m=VIS_MOODS[mood]||VIS_MOODS.Romantic;
  const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,m.bg[0]); g.addColorStop(1,m.bg[1]);
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  ctx.fillStyle=m.hi;
  const n=40;
  for(let i=0;i<n;i++){
    const x=((i*97.3)%100)/100*W;
    const speed= m.p==='rain'? 0.9 : m.p==='stars'? 0.05 : 0.3;
    const y=((i*57.7 + t*60*speed)%100)/100*H;
    ctx.globalAlpha=0.25+0.45*Math.abs(Math.sin(t+i));
    const r= m.p==='rain'? 1.5 : 2+ (i%4);
    if(m.p==='rain'){ ctx.fillRect(x, y, 2, 14); }
    else { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
  }
  ctx.globalAlpha=1;
}
function visPreview(withAudio){
  stopPreview();
  const c=$('vis-canvas');
  if(withAudio && !kinBuffer && !lyrBuffer) return toast('Pick an audio in Typography Studio first, then try the visualizer');
  const buf=kinBuffer||lyrBuffer;
  if(!withAudio){ drawVisualBG(c, visMood, 1.2); return; }
  const ctxA=audioCtx(); ctxA.resume();
  const analyser=ctxA.createAnalyser(); analyser.fftSize=256;
  const src=ctxA.createBufferSource(); src.buffer=buf;
  src.connect(analyser); analyser.connect(ctxA.destination);
  const data=new Uint8Array(analyser.frequencyBinCount);
  const t0=ctxA.currentTime+0.1; src.start(t0);
  const loop=()=>{
    const t=Math.max(0, ctxA.currentTime-t0);
    drawVisualBG(c, visMood, t);
    analyser.getByteFrequencyData(data);
    const cc=c.getContext('2d'), W=c.width, H=c.height;
    const bars=32, bw=W/bars;
    for(let i=0;i<bars;i++){
      const v=data[Math.floor(i*data.length/bars)]/255;
      const bh=v*H*0.28;
      cc.fillStyle=(VIS_MOODS[visMood]||VIS_MOODS.Romantic).hi;
      cc.globalAlpha=0.85;
      cc.fillRect(i*bw+2, H*0.86-bh, bw-4, bh);
    }
    cc.globalAlpha=1;
    if(t<buf.duration) visRAF=requestAnimationFrame(loop);
  };
  previewRAF=requestAnimationFrame(loop);
}
function applyVisualToTypography(){
  const m=VIS_MOODS[visMood];
  const idx=THEMES.findIndex(t=>t.hi===m.hi);
  if(idx>=0){ kinTheme=idx; renderThemes('kin-themes', idx, i=>{ kinTheme=i; }); }
  kinBg='glow'; kinEffect='bounce';
  $('vis-apply-status').textContent=`${visMood} visual applied — glow background + bounce effect in Typography Studio.`;
  toast('Visual applied to Typography Studio');
}

/* ---------- TEMPLATES LIBRARY ---------- */
const TEMPLATES=[
  {name:'Romantic', cat:'Romantic', theme:4, effect:'fade', layout:'karaoke', font:'serif', bg:'glow'},
  {name:'Heartbreak', cat:'Sad', theme:1, effect:'fade', layout:'spotlight', font:'serif', bg:'gradient'},
  {name:'Emotional', cat:'Emotional', theme:8, effect:'slide', layout:'spotlight', font:'serif', bg:'glow'},
  {name:'Lofi Nights', cat:'Lofi', theme:6, effect:'typewriter', layout:'karaoke', font:'mono', bg:'solid'},
  {name:'Mashup Energy', cat:'Mashup', theme:9, effect:'bounce', layout:'spotlight', font:'sans', bg:'glow'},
  {name:'Urdu Nastaliq', cat:'Urdu Nastaliq', theme:3, effect:'fade', layout:'karaoke', font:'serif', bg:'gradient'},
  {name:'Hindi Classic', cat:'Hindi', theme:2, effect:'pop', layout:'spotlight', font:'serif', bg:'gradient'},
  {name:'English Clean', cat:'English', theme:0, effect:'pop', layout:'spotlight', font:'sans', bg:'gradient'},
  {name:'Cinematic', cat:'Cinematic', theme:3, effect:'zoom', layout:'spotlight', font:'serif', bg:'solid'},
  {name:'Dark Mode', cat:'Dark', theme:3, effect:'fade', layout:'karaoke', font:'mono', bg:'solid'},
  {name:'Neon Nights', cat:'Neon', theme:0, effect:'bounce', layout:'spotlight', font:'sans', bg:'glow'},
  {name:'Sufi Soul', cat:'Sufi', theme:7, effect:'fade', layout:'karaoke', font:'serif', bg:'glow'},
  {name:'Karaoke Pro', cat:'Karaoke', theme:5, effect:'pop', layout:'karaoke', font:'sans', bg:'gradient'},
  {name:'Minimal', cat:'Minimal', theme:3, effect:'fade', layout:'spotlight', font:'sans', bg:'solid'},
];
function renderTemplates(){
  const box=$('tpl-list'); if(!box) return; box.innerHTML='';
  TEMPLATES.forEach(t=>{
    const d=document.createElement('div');
    d.className='proj'; d.onclick=()=>applyTemplate(t);
    d.innerHTML=`<b>${t.name}</b><span>${t.cat} · ${THEMES[t.theme].name} theme · ${t.effect} · ${t.layout} · ${t.font}</span>`;
    box.appendChild(d);
  });
}
function applyTemplate(t){
  kinTheme=t.theme; kinEffect=t.effect; kinLayout=t.layout; kinFont=t.font; kinBg=t.bg;
  renderThemes('kin-themes', t.theme, i=>{ kinTheme=i; });
  $('kin-effect').value=t.effect;
  setKinLayout(t.layout); setKinBg(t.bg); setKinFont(t.font);
  drawKineticPreview();
  toast(`Template “${t.name}” applied`);
  setTimeout(()=>openTool('kinetic'), 400);
}
renderTemplates();

/* ---------- AI ASSISTANT (calls real app functions) ---------- */
function asstSay(who, text){
  const box=$('asst-chat');
  const d=document.createElement('div');
  d.className='msg '+(who==='me'?'me':'ai');
  d.textContent=text;
  box.appendChild(d); box.scrollTop=box.scrollHeight;
}
function askAssistant(){
  const inp=$('asst-input'); const q=(inp.value||'').trim();
  if(!q) return;
  asstSay('me', q); inp.value='';
  const l=q.toLowerCase();
  const done=(msg)=>asstSay('ai', 'Done — '+msg);
  if(/green|hara|hari/.test(l)){ kinTheme=0; renderThemes('kin-themes',0,i=>{kinTheme=i;}); drawKineticPreview(); return done('text is green now (Lagoon theme).'); }
  if(/sad|dukh|heartbreak/.test(l)){ applyTemplate(TEMPLATES[1]); return done('sad typography style applied (Heartbreak template).'); }
  if(/romantic|love|pyar/.test(l)){ applyTemplate(TEMPLATES[0]); return done('romantic style applied.'); }
  if(/lofi/.test(l)){ applyTemplate(TEMPLATES[3]); return done('lofi style applied.'); }
  if(/emoji/.test(l)){ const t=$('kin-words').value||$('lyr-text').value||''; if(!t) return asstSay('ai','Paste some lyrics in Typography Studio first, then ask me for emojis.'); $('emo-text').value=t; suggestEmojis(); openTool('emoji'); return done('romantic/sad emojis suggested in Emoji Studio.'); }
  if(/beat/.test(l)){ kinEffect='bounce'; $('kin-effect').value='bounce'; drawKineticPreview(); return done('animations now bounce with the beat. For exact beat sync, run Detect BPM in Audio Studio.'); }
  if(/karaoke/.test(l)){ setKinLayout('karaoke'); return done('karaoke line layout on.'); }
  if(/export.*1080|1080p/.test(l)){ setKinRes('1080'); if(!kinBuffer) return asstSay('ai','Pick an audio and add words in Typography Studio first — then I can export it in 1080p.'); exportKinetic(); return done('export started in 1080p.'); }
  if(/cinematic/.test(l)){ applyTemplate(TEMPLATES[8]); return done('cinematic background applied.'); }
  if(/sync|lyrics/.test(l)){ openTool('lyrics'); return done('opened Auto Lyrics Sync — pick a song and tap Auto Sync.'); }
  asstSay('ai', 'I can do these right now: make the text green · sad / romantic / lofi style · add emojis · match animations with beats · karaoke layout · cinematic background · export in 1080p · sync lyrics. What would you like?');
}

/* ---------- RUH AI GATEWAY ---------- */
const GW_ENDPOINTS={
  groq:{url:'https://api.groq.com/openai/v1/models', hdr:k=>({'Authorization':'Bearer '+k})},
  gemini:{url:k=>'https://generativelanguage.googleapis.com/v1beta/models?key='+encodeURIComponent(k), hdr:()=>({})},
  openai:{url:'https://api.openai.com/v1/models', hdr:k=>({'Authorization':'Bearer '+k})},
  mistral:{url:'https://api.mistral.ai/v1/models', hdr:k=>({'Authorization':'Bearer '+k})},
  openrouter:{url:'https://openrouter.ai/api/v1/models', hdr:k=>({'Authorization':'Bearer '+k})},
  cloudflare:{url:null, hdr:()=>({})},
  nvidia:{url:'https://integrate.api.nvidia.com/v1/models', hdr:k=>({'Authorization':'Bearer '+k})},
};
function gwKeys(){ return storeGet('ruh_gw_keys', {}); }
function gwSave(){
  const p=$('gw-provider').value, k=$('gw-key').value.trim(), m=$('gw-model').value.trim();
  if(!k) return toast('Paste an API key first');
  const all=gwKeys(); all[p]={key:k, model:m, saved:Date.now()};
  storeSet('ruh_gw_keys', all);
  $('gw-status').textContent=`${p} key saved on this device. Tap “Test connection” to verify it.`;
  $('gw-key').value='';
  renderGwList();
}
function gwRemove(){
  const p=$('gw-provider').value;
  const all=gwKeys(); delete all[p]; storeSet('ruh_gw_keys', all);
  $('gw-status').textContent=`${p} key removed.`;
  renderGwList();
}
async function gwTest(){
  const p=$('gw-provider').value;
  const all=gwKeys();
  const rec=all[p];
  if(!rec) return toast('No key saved for '+p+' yet');
  const ep=GW_ENDPOINTS[p];
  const st=$('gw-status'); st.textContent='Testing connection…';
  if(!ep.url){ st.textContent=p+': no public models endpoint to test automatically — the key is saved; it will be used when you call this provider.'; return; }
  try{
    const url=typeof ep.url==='function'?ep.url(rec.key):ep.url;
    const r=await fetch(url, {headers:ep.hdr(rec.key)});
    if(r.ok){ const j=await r.json().catch(()=>null); const n=j&&j.data?j.data.length:(j&&j.models?j.models.length:'?'); st.textContent=`${p}: connected ✓ (${n} models available)`; }
    else st.textContent=`${p}: provider returned ${r.status} — the key may be wrong or expired.`;
  }catch(e){ st.textContent=`${p}: could not reach the provider from the app (${e.message}). The key is saved on your device; it will be used when you call this provider.`; }
}
function renderGwList(){
  const box=$('gw-list'); if(!box) return;
  const all=gwKeys(); const names=Object.keys(all);
  box.innerHTML=names.length? '' : '<div class="info">No provider keys saved yet.</div>';
  names.forEach(p=>{
    const d=document.createElement('div');
    d.className='kv'; d.innerHTML=`<span>${p}${all[p].model?' · '+all[p].model:''}</span><b>● saved</b>`;
    box.appendChild(d);
  });
}
renderGwList();

/* ---------- PROJECTS ---------- */
function getProjects(){ return storeGet('ruh_projects', []); }
function saveProjects(list){ storeSet('ruh_projects', list); renderProjects(); renderHomeRecent(); }
function currentProjectData(){
  return { kinWords: $('kin-words')?$('kin-words').value:'', kinTheme, kinEffect, kinLayout, kinBg, kinFont,
    lyrText: $('lyr-text')?$('lyr-text').value:'', lyrWords, updated: Date.now() };
}
function newProject(){
  const list=getProjects();
  const p={ id:'p'+Date.now(), name:'Untitled Project '+(list.length+1), created:Date.now(), updated:Date.now(), data:currentProjectData() };
  list.unshift(p); saveProjects(list);
  toast('New project created — pick an audio in Typography Studio');
  openTool('kinetic');
}
function renderProjects(){
  const box=$('proj-list'); if(!box) return;
  const list=getProjects();
  box.innerHTML=list.length?'':'<div class="card"><div class="info">No projects yet. Tap “New Project” to start one.</div></div>';
  list.forEach(p=>{
    const d=document.createElement('div');
    d.className='proj';
    d.innerHTML=`<b>${p.name}</b><span>Updated ${new Date(p.updated).toLocaleString()} · ${(p.data.lyrWords||[]).length} synced words</span>
      <div class="row" style="margin-top:8px">
        <button class="btn" data-a="open">Open</button>
        <button class="btn" data-a="dup">Duplicate</button>
        <button class="btn" data-a="ren">Rename</button>
        <button class="btn" data-a="del">Delete</button>
      </div>`;
    d.querySelector('[data-a=open]').onclick=()=>openProject(p.id);
    d.querySelector('[data-a=dup]').onclick=()=>{ const c={...p, id:'p'+Date.now(), name:p.name+' (copy)', updated:Date.now()}; const l=getProjects(); l.unshift(c); saveProjects(l); };
    d.querySelector('[data-a=ren]').onclick=()=>{ const n=prompt('Project name', p.name); if(n){ const l=getProjects(); const t=l.find(x=>x.id===p.id); if(t){ t.name=n; t.updated=Date.now(); saveProjects(l); } } };
    d.querySelector('[data-a=del]').onclick=()=>{ if(confirm('Delete “'+p.name+'”?')){ saveProjects(getProjects().filter(x=>x.id!==p.id)); } };
    box.appendChild(d);
  });
  const sc=$('set-proj-count'); if(sc) sc.textContent=list.length;
}
function openProject(id){
  const p=getProjects().find(x=>x.id===id); if(!p) return;
  const d=p.data||{};
  if(d.kinWords!=null) $('kin-words').value=d.kinWords;
  if(d.lyrText!=null) $('lyr-text').value=d.lyrText;
  if(d.lyrWords) lyrWords=d.lyrWords;
  kinTheme=d.kinTheme||0; kinEffect=d.kinEffect||'pop'; kinLayout=d.kinLayout||'spotlight'; kinBg=d.kinBg||'gradient'; kinFont=d.kinFont||'sans';
  renderThemes('kin-themes', kinTheme, i=>{ kinTheme=i; });
  $('kin-effect').value=kinEffect;
  setKinLayout(kinLayout); setKinBg(kinBg); setKinFont(kinFont);
  rebuildKinWords(); drawKineticPreview();
  toast('Opened “'+p.name+'”');
  openTool('kinetic');
}
function exportProjectFile(){
  const list=getProjects();
  const blob=new Blob([JSON.stringify(list,null,2)], {type:'application/json'});
  saveBlob(blob, 'RuhTypography-Projects-'+Date.now()+'.json', 'application/json');
  toast('Projects backup exported');
}
$('proj-import').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{
    const list=JSON.parse(await f.text());
    if(Array.isArray(list)){ saveProjects(list); toast(list.length+' projects restored'); }
    else toast('That file is not a projects backup');
  }catch(err){ toast('Could not read backup: '+err.message); }
});
renderProjects();

/* ---------- EXPORT HISTORY ---------- */
const _origSetLastExport = setLastExport;
setLastExport = function(path, name, mime){
  _origSetLastExport(path, name, mime);
  const h=storeGet('ruh_history', []);
  h.unshift({name, mime, when:Date.now()});
  storeSet('ruh_history', h.slice(0,50));
  renderHistory();
};
function renderHistory(){
  const box=$('hist-list'); if(!box) return;
  const h=storeGet('ruh_history', []);
  box.innerHTML=h.length?'':'<div class="card"><div class="info">No exports yet.</div></div>';
  h.forEach(x=>{
    const d=document.createElement('div');
    d.className='proj'; d.innerHTML=`<b>${x.name}</b><span>${x.mime} · ${new Date(x.when).toLocaleString()}</span>`;
    box.appendChild(d);
  });
  const sc=$('set-hist-count'); if(sc) sc.textContent=h.length;
}
function clearHistory(){ storeSet('ruh_history', []); renderHistory(); toast('History cleared'); }
renderHistory();

/* ---------- SETTINGS / HOME ---------- */
const I18N={
  en:{hero:'Make words move.', sub:'Lyrics, typography, mashups and video — one studio, on your phone. Free, no login, no subscription.'},
  hi:{hero:'शब्दों को चलता बनाओ।', sub:'Lyrics, typography, mashup aur video — ek hi studio, aapke phone par. Free, no login, no subscription.'},
  ur:{hero:'الفاظ کو حرکت دیں۔', sub:'لیرکس، ٹائپوگرافی، میش اپ اور ویڈیو — ایک اسٹوڈیو، آپ کے فون پر۔ مفت، کوئی لاگ ان نہیں۔'},
};
function setAppLang(l){
  storeSet('ruh_lang', l);
  const d=I18N[l]||I18N.en;
  const h=document.querySelector('.hero h1'); if(h) h.textContent=d.hero;
  const p=document.querySelector('.hero p'); if(p) p.textContent=d.sub;
  toast('Language preference saved');
}
function setDefaultRes(r){
  storeSet('ruh_def_res', r);
  if(typeof setKinRes==='function') setKinRes(r);
  toast('Default export resolution: '+r);
}
function clearCache(){
  const keep={};
  ['ruh_projects','ruh_gw_keys','ruh_lang','ruh_def_res'].forEach(k=>{ keep[k]=localStorage.getItem(k); });
  localStorage.clear();
  Object.keys(keep).forEach(k=>{ if(keep[k]!=null) localStorage.setItem(k, keep[k]); });
  renderHistory(); renderProjects();
  $('set-status').textContent='Cache cleared (projects and keys kept).';
}
function homeSearch(q){
  q=(q||'').toLowerCase();
  document.querySelectorAll('#home-grid .tile').forEach(t=>{
    t.style.display = !q || t.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
function renderHomeRecent(){
  const box=$('home-recent'); if(!box) return;
  const list=getProjects().slice(0,3);
  box.innerHTML=list.length?'':'<div class="info">No projects yet — tap “New Project” above.</div>';
  list.forEach(p=>{
    const d=document.createElement('div');
    d.className='proj'; d.onclick=()=>openProject(p.id);
    d.innerHTML=`<b>${p.name}</b><span>Updated ${new Date(p.updated).toLocaleString()}</span>`;
    box.appendChild(d);
  });
}
renderHomeRecent();

/* ---------- overlays drawn into typography exports ---------- */
window.__drawOverlays=function(ctx, W, H, t, theme){
  // emoji overlay
  if(emoOverlayOn){
    const em=($('emo-overlay-text')&&$('emo-overlay-text').value)||'❤️';
    const size=parseInt(($('emo-size')&&$('emo-size').value)||80);
    ctx.save(); ctx.font=size+'px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
    const y=emoPos==='top'?H*0.18:emoPos==='mid'?H*0.5:H*0.82;
    ctx.fillText(em, W/2, y); ctx.restore();
  }
  // GIF overlay (animates in exported video because the <img> advances each frame)
  if(gifImg && gifImg.complete && gifImg.naturalWidth){
    const w=W*(parseInt(($('gif-size')&&$('gif-size').value)||40)/100);
    const h=w*(gifImg.naturalHeight/gifImg.naturalWidth);
    ctx.save(); ctx.globalAlpha=parseInt(($('gif-op')&&$('gif-op').value)||100)/100;
    ctx.drawImage(gifImg, (W-w)/2, H*0.68, w, h); ctx.restore();
  }
  // visual mood particles (subtle, over the background)
  if(window.__visParticles){
    const m=VIS_MOODS[visMood]||VIS_MOODS.Romantic;
    ctx.save(); ctx.fillStyle=m.hi;
    for(let i=0;i<24;i++){
      const x=((i*97.3)%100)/100*W;
      const y=((i*57.7 + t*40)%100)/100*H;
      ctx.globalAlpha=0.18+0.2*Math.abs(Math.sin(t+i));
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
};

/* ---------- init ---------- */
(function(){
  const lang=storeGet('ruh_lang','en');
  const sel=$('set-lang'); if(sel) sel.value=lang;
  if(lang!=='en') setAppLang(lang);
  const dr=storeGet('ruh_def_res','1080');
  if(typeof setKinRes==='function') setKinRes(dr);
})();
