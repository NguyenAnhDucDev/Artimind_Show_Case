const sheetUrlInput = document.getElementById('sheetUrl');
const btnLoad = document.getElementById('btnLoad');
// Multi-select containers
const msCountryRoot = document.getElementById('msCountry');
const msCategoryRoot = document.getElementById('msCategory');
const msStyleRoot = document.getElementById('msStyle');
const countLabel = document.getElementById('countLabel');
const pageSizeInput = document.getElementById('pageSize');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');
// Removed cards/rows view; we now only use strip chips
const stripEl = document.getElementById('strip');
const stripPrev = document.getElementById('stripPrev');
const stripNext = document.getElementById('stripNext');
const videoEl = document.getElementById('video');
const videoLinkEl = document.getElementById('videoLink');
const img1 = document.getElementById('img1');
const img2 = document.getElementById('img2');
const img1Link = document.getElementById('img1Link');
const img2Link = document.getElementById('img2Link');

/** Utilities */
function extractSheetIdAndGid(googleSheetUrl){
  try{
    const u = new URL(googleSheetUrl);
    const id = u.pathname.split('/d/')[1]?.split('/')[0];
    const gid = u.searchParams.get('gid') || u.hash.split('gid=')[1] || '';
    return id ? { id, gid } : null;
  }catch(_){ return null; }
}

function buildCsvUrl(id, gid){
  const gidPart = gid ? `&gid=${gid}` : '';
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gidPart}`;
}

function buildCandidateCsvUrls(inputUrl){
  const ids = extractSheetIdAndGid(inputUrl);
  if(!ids) return [inputUrl];
  const { id, gid } = ids;
  return [
    `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid||'0'}`,
    `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid||'0'}`
  ];
}

async function fetchCsvText(url){
  const res = await fetch(url, { credentials: 'omit' });
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if(/<html[\s\S]*>/i.test(text)) throw new Error('HTML received');
  return text;
}

function parseCsv(text){
  // Simple CSV parser handling commas inside quotes
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;
  for(let i=0;i<text.length;i++){
    const c = text[i];
    const next = text[i+1];
    if(c === '"'){
      if(inQuotes && next === '"'){ value += '"'; i++; }
      else { inQuotes = !inQuotes; }
      continue;
    }
    if(c === ',' && !inQuotes){ row.push(value); value=''; continue; }
    if((c === '\n' || c === '\r') && !inQuotes){
      if(value.length>0 || row.length>0){ row.push(value); rows.push(row); }
      if(c === '\r' && next === '\n') i++;
      row = []; value = '';
      continue;
    }
    value += c;
  }
  if(value.length>0 || row.length>0){ row.push(value); rows.push(row); }
  return rows;
}

function trimPrefix(text, prefix){
  if(!text) return text;
  const idx = text.indexOf(prefix);
  return idx === -1 ? text : text.slice(idx + prefix.length).trim();
}

/**
 * Data model: We expect rows with columns:
 * A: event_name
 * B: event_params.key (style | category | output | ... )
 * C: event_params.value.string_value (value or URL)
 * D: event_timestamp
 * E: geo.country
 * Success = three rows for the same group: style, category, output
 * Fail = two rows: style, category (no output)
 */

/** @typedef {{
 *  status: 'success'|'fail',
 *  styleName: string,
 *  categoryName: string,
 *  outputUrl?: string,
 *  timestamp: string,
 *  country?: string
 * }} VideoRecord */

/**
 * Group raw rows into records by scanning in order and bundling keys.
 */
function groupRows(rows){
  const header = rows[0] || [];
  const idxKey = {
    event_name: header.indexOf('event_name'),
    key: header.indexOf('event_params.key'),
    value: header.indexOf('event_params.value.string_value'),
    ts: header.indexOf('event_timestamp'),
    country: header.indexOf('geo.country')
  };
  const data = rows.slice(1);
  /** @type {VideoRecord[]} */
  const records = [];

  // If we have GA-style columns, chunk strictly by triplets of consecutive success rows
  const hasEvent = idxKey.event_name !== -1 && idxKey.key !== -1 && idxKey.value !== -1;
  if(hasEvent){
    for(let i=0;i<data.length;){
      const r0 = data[i];
      const ev = (r0[idxKey.event_name]||'').toString().toLowerCase();
      const isSuccess = ev.includes('success');
      if(!isSuccess){ i++; continue; }
      const chunk = data.slice(i, i+3);
      if(chunk.length < 3){ break; }
      // Ensure three consecutive rows are also success
      const allSuccess = chunk.every(r => ((r[idxKey.event_name]||'').toString().toLowerCase().includes('success')));
      if(!allSuccess){ i++; continue; }
      const assembled = { style:null, category:null, output:null, ts:null, country:null };
      for(const r of chunk){
        const k = r[idxKey.key];
        const v = r[idxKey.value];
        if(k === 'style') assembled.style = v;
        else if(k === 'category') assembled.category = v;
        else if(k === 'output') assembled.output = v;
        if(!assembled.ts) assembled.ts = r[idxKey.ts];
        if(!assembled.country) assembled.country = r[idxKey.country];
      }
      if(assembled.output){
        records.push({
          status: 'success',
          styleName: trimPrefix(assembled.style||'', 'Style Name:'),
          categoryName: trimPrefix(assembled.category||'', 'Category Name:'),
          outputUrl: assembled.output || undefined,
          timestamp: assembled.ts || '',
          country: assembled.country || ''
        });
      }
      i += 3; // move to next triplet
    }
    return records;
  }

  // Fallback to previous streaming assembler (non-GA legacy CSV)
  let acc = {style:null, category:null, output:null, ts:null, country:null};
  function flush(){
    if(!acc.style && !acc.category && !acc.output) return;
    const status = acc.output ? 'success' : 'fail';
    records.push({
      status,
      styleName: trimPrefix(acc.style||'', 'Style Name:'),
      categoryName: trimPrefix(acc.category||'', 'Category Name:'),
      outputUrl: acc.output || undefined,
      timestamp: acc.ts || '',
      country: acc.country || ''
    });
    acc = {style:null, category:null, output:null, ts:null, country:null};
  }
  for(const r of data){
    const key = r[idxKey.key];
    const val = r[idxKey.value];
    const ts = r[idxKey.ts];
    const country = r[idxKey.country];
    if(key === 'style'){
      if(acc.style || acc.category || acc.output) flush();
      acc.style = val; acc.ts = ts; acc.country = country;
    } else if(key === 'category'){ acc.category = val; acc.ts = ts; acc.country = country; }
    else if(key === 'output'){ acc.output = val; acc.ts = ts; acc.country = country; flush(); }
  }
  flush();
  return records;
}

function uniqueSorted(values){
  return Array.from(new Set(values.filter(Boolean))).sort((a,b)=>a.localeCompare(b));
}

// Multi-select helpers
function countMap(list){
  const m = new Map();
  for(const v of list){ m.set(v, (m.get(v)||0)+1); }
  return Array.from(m.entries()).map(([value,count])=>({ value, count }))
    .sort((a,b)=> b.count - a.count || String(a.value).localeCompare(String(b.value)));
}

function createMultiSelect(root, label){
  if(!root) return null;
  root.classList.add('ms');
  root.innerHTML = '';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ms-btn';
  btn.textContent = label;
  const panel = document.createElement('div');
  panel.className = 'ms-panel';
  const list = document.createElement('div');
  panel.appendChild(list);
  root.appendChild(btn);
  root.appendChild(panel);
  let isOpen = false;
  let items = [];
  const selected = new Set();
  let onChangeCb = null;
  function toggle(){ isOpen = !isOpen; root.classList.toggle('open', isOpen); }
  btn.addEventListener('click', toggle);
  document.addEventListener('click', (e)=>{ if(!root.contains(e.target)){ isOpen=false; root.classList.remove('open'); } });
  function render(){
    list.innerHTML = '';
    for(const it of items){
      const row = document.createElement('div'); row.className = 'ms-item' + (selected.has(it.value)?' selected':'');
      const check = document.createElement('div'); check.className = 'ms-check'; check.textContent = selected.has(it.value)?'✓':'';
      const name = document.createElement('div'); name.textContent = it.value || 'null';
      const count = document.createElement('div'); count.className = 'ms-count'; count.textContent = String(it.count);
      row.appendChild(check); row.appendChild(name); row.appendChild(count);
      row.addEventListener('click', ()=>{
        if(selected.has(it.value)) selected.delete(it.value); else selected.add(it.value);
        render();
        if(onChangeCb) onChangeCb(Array.from(selected));
        updateBtn();
      });
      list.appendChild(row);
    }
  }
  function updateBtn(){
    if(selected.size) btn.textContent = `${label} (${selected.size})`; else btn.textContent = label;
  }
  return {
    setData(data){ items = data.slice(); render(); updateBtn(); },
    getSelected(){ return Array.from(selected); },
    onChange(cb){ onChangeCb = cb; }
  };
}

let msCountry = null, msCategory = null, msStyle = null;

function populateFilters(records){
  msCountry ||= createMultiSelect(msCountryRoot, 'Country');
  msCategory ||= createMultiSelect(msCategoryRoot, 'Category');
  msStyle ||= createMultiSelect(msStyleRoot, 'Style');
  msCountry?.setData(countMap(records.map(r=>r.country||'')));
  msCategory?.setData(countMap(records.map(r=>r.categoryName||'')));
  msStyle?.setData(countMap(records.map(r=>r.styleName||'')));
  // Ensure handlers are bound after first creation
  if(msCountry) msCountry.onChange(()=>{ currentPage = 1; render(); });
  if(msCategory) msCategory.onChange(()=>{ currentPage = 1; render(); });
  if(msStyle) msStyle.onChange(()=>{ currentPage = 1; render(); });
}

function recordMatchesFilters(r){
  const countries = msCountry ? new Set(msCountry.getSelected()) : null;
  const categories = msCategory ? new Set(msCategory.getSelected()) : null;
  const styles = msStyle ? new Set(msStyle.getSelected()) : null;
  if(countries && countries.size && !countries.has(r.country||'')) return false;
  if(categories && categories.size && !categories.has(r.categoryName||'')) return false;
  if(styles && styles.size && !styles.has(r.styleName||'')) return false;
  return true;
}

function formatTimestamp(ts){
  const n = Number(ts);
  if(Number.isFinite(n)){
    // Many sheets show scientific notation milliseconds; coerce
    const ms = Math.round(n);
    try{ return new Date(ms).toLocaleString(); }catch(_){ return String(ts); }
  }
  return String(ts);
}

/** @type {VideoRecord[]} */
let allRecords = [];
let visibleRecords = [];
let selectedIndex = -1;
let currentPage = 1;
let pageSize = 30;

function render(){
  visibleRecords = allRecords.filter(recordMatchesFilters);
  const total = visibleRecords.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  const start = (currentPage-1) * pageSize;
  const pageItems = visibleRecords.slice(start, start + pageSize);
  countLabel.textContent = `Đã tải ${total} video.`;
  pageInfo.textContent = `${currentPage}/${totalPages}`;
  prevPageBtn.disabled = currentPage<=1; nextPageBtn.disabled = currentPage>=totalPages;

  // Build top strip: only 1 row of chips
  // Show chips count equal to current page size
  const stripItems = pageItems;
  stripEl.innerHTML = stripItems.map((r,i)=>{
    return `
      <div class="chip" data-index="${i}">
        <span class="title">${escapeHtml(r.styleName)}</span>
        <span class="sub">${escapeHtml(r.categoryName||'')}</span>
        <span class="sub">${escapeHtml(r.country||'')}</span>
      </div>`;
  }).join('');

  // Remove legacy views (cards/rows)

  const selectFromLocal = (idx)=>{ selectCard(idx); };
  stripEl.querySelectorAll('.chip').forEach(chip=>chip.addEventListener('click',()=>{
    const idx = Number(chip.getAttribute('data-index'));
    selectFromLocal(idx);
  }));
  function updateStripNav(){
    const canScrollLeft = stripEl.scrollLeft > 0;
    const canScrollRight = stripEl.scrollWidth - stripEl.clientWidth - stripEl.scrollLeft > 1;
    stripPrev.disabled = !canScrollLeft;
    stripNext.disabled = !canScrollRight;
  }
  updateStripNav();
  stripEl.removeEventListener('scroll', updateStripNav);
  stripEl.addEventListener('scroll', updateStripNav);
  stripPrev.onclick = ()=> stripEl.scrollBy({ left: -stripEl.clientWidth, behavior: 'smooth' });
  stripNext.onclick = ()=> stripEl.scrollBy({ left: stripEl.clientWidth, behavior: 'smooth' });
  cardsEl.querySelectorAll('.card').forEach(card=>card.addEventListener('click',()=>{
    const idx = Number(card.getAttribute('data-index'));
    selectFromLocal(idx);
  }));
  rowsEl.querySelectorAll('.row-item').forEach(row=>row.addEventListener('click',()=>{
    const idx = Number(row.getAttribute('data-index'));
    selectFromLocal(idx);
  }));

  // Maintain selection
  if(pageItems.length){ selectCard(Math.max(0, Math.min(selectedIndex - start, pageItems.length-1))); }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

function selectCard(idx){
  const start = (currentPage-1) * pageSize;
  selectedIndex = start + idx;
  const localSelect = (selector)=>{
    document.querySelectorAll(selector).forEach((el,i)=>{
      if(el.closest('#rows')){
        el.classList.toggle('selected', i===idx);
      }
      if(el.closest('#cards')){
        el.classList.toggle('selected', i===idx);
      }
    });
  };
  stripEl.querySelectorAll('.chip').forEach((el,i)=>{
    el.classList.toggle('selected', i===idx);
  });
  // Ensure selected chip is visible
  const chipEl = stripEl.querySelector(`.chip[data-index="${idx}"]`);
  if(chipEl && typeof chipEl.scrollIntoView === 'function'){
    chipEl.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }
  const rec = visibleRecords[selectedIndex];
  if(!rec) return;
  if(rec.outputUrl){
    try{ videoEl.pause(); }catch(_){ }
    videoEl.src = rec.outputUrl;
    try{ videoEl.currentTime = 0; }catch(_){ }
    videoLinkEl.textContent = rec.outputUrl;
    videoLinkEl.href = rec.outputUrl;
    // Try to autoplay on selection change
    setTimeout(()=>{ try{ videoEl.play().catch(()=>{}); }catch(_){ } }, 0);
  } else {
    videoEl.removeAttribute('src');
    videoLinkEl.textContent = '';
    videoLinkEl.removeAttribute('href');
  }
}

// Keyboard navigation across chips
stripEl.addEventListener('keydown', (e)=>{
  if(!visibleRecords.length) return;
  const columns = computeColumnCount();
  if(['ArrowRight','ArrowLeft','ArrowDown','ArrowUp','Home','End'].includes(e.key)){
    e.preventDefault();
  }
  const start = (currentPage-1) * pageSize;
  const endExclusive = start + Math.min(pageSize, Math.max(0, visibleRecords.length - start));
  const localIndex = Math.max(0, Math.min((selectedIndex - start), Math.max(0, endExclusive - start -1)));
  function goToGlobal(newGlobal){
    const newPage = Math.floor(newGlobal / pageSize) + 1;
    if(newPage !== currentPage){ currentPage = newPage; render(); return; }
    selectCard(newGlobal - start);
  }
  if(e.key==='ArrowRight') goToGlobal(Math.min(visibleRecords.length-1, selectedIndex+1));
  if(e.key==='ArrowLeft') goToGlobal(Math.max(0, selectedIndex-1));
  if(e.key==='ArrowDown') goToGlobal(Math.min(visibleRecords.length-1, selectedIndex+columns));
  if(e.key==='ArrowUp') goToGlobal(Math.max(0, selectedIndex-columns));
  if(e.key==='Home') goToGlobal(start);
  if(e.key==='End') goToGlobal(Math.min(visibleRecords.length-1, endExclusive-1));
});

function computeColumnCount(){
  const start = (currentPage-1) * pageSize;
  const remaining = Math.max(0, visibleRecords.length - start);
  return Math.max(1, Math.min(pageSize, remaining));
}

// Filter listeners for multi-selects
// No-op: handlers are attached in populateFilters once data is available
pageSizeInput.addEventListener('change', ()=>{
  const v = Number(pageSizeInput.value);
  if(Number.isFinite(v) && v>0){ pageSize = Math.floor(v); currentPage = 1; render(); }
});
prevPageBtn.addEventListener('click', ()=>{ if(currentPage>1){ currentPage--; render(); } });
nextPageBtn.addEventListener('click', ()=>{ const totalPages = Math.max(1, Math.ceil(visibleRecords.length / pageSize)); if(currentPage<totalPages){ currentPage++; render(); } });

// Load from local storage
const lastUrl = localStorage.getItem('sheetUrl');
if(lastUrl){ sheetUrlInput.value = lastUrl; }

btnLoad.addEventListener('click', async ()=>{
  const url = sheetUrlInput.value.trim();
  if(!url){ alert('Vui lòng dán URL Google Sheet'); return; }
  localStorage.setItem('sheetUrl', url);
  btnLoad.disabled = true; btnLoad.textContent = 'Đang tải...';
  try{
    const rows = await loadSheetRows(url);
    allRecords = groupRows(rows).filter(r => r && r.status === 'success' && r.outputUrl);
    populateFilters(allRecords);
    render();
    // Focus strip for keyboard navigation
    setTimeout(()=>{ stripEl.focus(); selectCard(0); }, 0);
  }catch(err){
    console.error(err);
    if(!allRecords || allRecords.length === 0){
      alert('Không thể tải sheet. Kiểm tra quyền chia sẻ và URL.');
    }
  }finally{
    btnLoad.disabled = false; btnLoad.textContent = 'Tải danh sách';
  }
});

// Prefill the demo URL from the prompt if available
if(!sheetUrlInput.value){
  sheetUrlInput.value = 'https://docs.google.com/spreadsheets/d/1JY0GzK2sCLsz4njaiGEwAn49PXlkaI4I3f_LJ7jfMZs/edit?gid=478131050#gid=478131050';
}

/**
 * Sheet loading flow (referencing your snippet):
 * - Try native CSV endpoints
 * - If fails or returns HTML, try gviz: out:csv
 * - If still fails, proxy through r.jina.ai
 * - Finally, as last resort, use GViz JSONP
 */
async function loadSheetRows(inputUrl){
  const ids = extractSheetIdAndGid(inputUrl);
  if(!ids) throw new Error('URL không hợp lệ');
  const errors = [];
  // 1) Prefer GViz JSONP (bypass CORS reliably)
  try{
    const rows = await fetchViaGvizJsonp(ids.id, ids.gid);
    if(rows && rows.length) return rows;
  }catch(e){ errors.push({ jsonp:true, error: String(e) }); }
  // 2) Fallback to CSV via r.jina.ai proxy
  try{
    const candidates = buildCandidateCsvUrls(inputUrl);
    for(const url of candidates){
      const proxied = `https://r.jina.ai/http/${url.replace(/^https?:\/\//,'')}`;
      try{
        const text = await fetchCsvText(proxied);
        return parseCsv(text);
      }catch(err){ errors.push({ proxied:url, error:String(err) }); }
    }
  }catch(err){ errors.push({ build:true, error:String(err) }); }
  throw new Error('All load attempts failed: ' + JSON.stringify(errors).slice(0,500));
}

function parseGvizTableToRows(resp){
  const table = resp?.table;
  if(!table) return [];
  const header = table.cols.map(c=>c.label || c.id || '');
  const rows = [header];
  for(const r of table.rows){
    rows.push((r.c||[]).map(c=>{
      if(!c) return '';
      if(typeof c.f !== 'undefined' && c.f !== null) return String(c.f);
      if(typeof c.v !== 'undefined' && c.v !== null) return String(c.v);
      return '';
    }));
  }
  return rows;
}

function fetchViaGvizJsonp(id, gid){
  return new Promise((resolve, reject)=>{
    const cbName = `__gviz_cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const prev = (window.google && window.google.visualization && window.google.visualization.Query && window.google.visualization.Query.setResponse) || null;
    window.google = window.google || {};
    window.google.visualization = window.google.visualization || {};
    window.google.visualization.Query = window.google.visualization.Query || {};
    window.google.visualization.Query.setResponse = (resp)=>{
      try{ resolve(parseGvizTableToRows(resp)); }
      catch(err){ reject(err); }
      cleanup();
    };
    function cleanup(){
      if(prev){ window.google.visualization.Query.setResponse = prev; }
      script.remove();
      clearTimeout(timer);
    }
    const script = document.createElement('script');
    const base = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq`;
    const qp = new URLSearchParams();
    if(gid) qp.set('gid', gid);
    qp.set('tqx', 'out:json');
    script.src = `${base}?${qp.toString()}`;
    script.onerror = ()=>{ cleanup(); reject(new Error('Script load error')); };
    document.head.appendChild(script);
    const timer = setTimeout(()=>{ cleanup(); reject(new Error('Timeout')); }, 15000);
  });
}


