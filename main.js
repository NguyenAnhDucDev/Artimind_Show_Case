// Globals
let allRecords = [];
let filteredRecords = [];
let currentPage = 1;
let pageSize = 30;
let selectedRecord = null;
let selectedGlobalIndex = -1; // index in filteredRecords

// DOM
const sheetUrlInput = document.getElementById('sheetUrl');
const loadBtn = document.getElementById('loadBtn');
const videoCards = document.getElementById('videoCards');
const countEl = document.getElementById('count');
const pageInfo = document.getElementById('pageInfo');
const pageSizeSelect = document.getElementById('pageSize');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const stripPrev = document.getElementById('stripPrev');
const stripNext = document.getElementById('stripNext');

// Filter elements
const filterTags = document.querySelectorAll('.filter-tag');
const filtersPanel = document.getElementById('filtersPanel');
const filtersTitle = document.getElementById('filtersTitle');
const filtersOptions = document.getElementById('filtersOptions');
const filtersApply = document.getElementById('filtersApply');
const filtersClear = document.getElementById('filtersClear');
const filtersClose = document.getElementById('filtersClose');
const activeFiltersBar = document.getElementById('activeFiltersBar');

// Active filter state
const activeFilters = {
  country: new Set(),
  category: new Set(),
  style: new Set(),
  subscription: new Set(),
  user: new Set()
};

// Inline media preview elements (below strip)
const inlinePreview = document.getElementById('inlinePreview');
const inlineImg1 = document.getElementById('inlineImg1');
const inlineImg2 = document.getElementById('inlineImg2');
const inlineVideo = document.getElementById('inlineVideo');
const inlineLink1 = document.getElementById('inlineLink1');
const inlineLink2 = document.getElementById('inlineLink2');
const inlineLinkVideo = document.getElementById('inlineLinkVideo');

// -------------------------
// Loader helpers
// -------------------------
function extractSheetIdAndGid(googleSheetUrl) {
  try {
    const url = new URL(googleSheetUrl);
    const id = url.pathname.split('/d/')[1]?.split('/')[0];
    const gid = url.searchParams.get('gid') || url.hash.split('gid=')[1] || '';
    return id ? { id, gid } : null;
  } catch (_) {
    return null;
}
}

function buildCandidateCsvUrls(inputUrl) {
  const ids = extractSheetIdAndGid(inputUrl);
  if (!ids) return [inputUrl];
  const { id, gid } = ids;
  return [
    `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid || '0'}`,
    `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid || '0'}`
  ];
}

async function fetchCsvText(url) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (/<html[\s\S]*>/i.test(text)) throw new Error('HTML received');
  return text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"') {
      if (inQuotes && next === '"') { value += '"'; i++; }
      else { inQuotes = !inQuotes; }
      continue;
    }
    if (c === ',' && !inQuotes) { row.push(value); value = ''; continue; }
    if ((c === '\n' || c === '\r') && !inQuotes) {
      if (value.length > 0 || row.length > 0) { row.push(value); rows.push(row); }
      if (c === '\r' && next === '\n') i++;
      row = []; value = ''; continue;
    }
    value += c;
  }
  if (value.length > 0 || row.length > 0) { row.push(value); rows.push(row); }
  return rows;
}

function trimPrefix(text, prefix) {
  if (!text) return text;
  const idx = text.indexOf(prefix);
  return idx === -1 ? text : text.slice(idx + prefix.length).trim();
}

function normalizeHeaderName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function findColumnIndex(header, candidates) {
  const norm = header.map(normalizeHeaderName);
  for (const c of candidates) {
    const target = normalizeHeaderName(c);
    const exact = norm.indexOf(target);
    if (exact !== -1) return exact;
  }
  for (let i = 0; i < norm.length; i++) {
    if (candidates.some(c => norm[i].includes(normalizeHeaderName(c)))) return i;
  }
  return -1;
}

async function loadSheetRows(inputUrl) {
  const errors = [];
  const ids = extractSheetIdAndGid(inputUrl);

  // Prefer GViz JSON for real Sheet URLs (no CORS)
  if (ids && ids.id) {
    try {
      const rows = await fetchViaGvizJsonp(ids.id, ids.gid);
      if (rows && rows.length) return rows;
    } catch (e) {
      console.warn('[loader] GViz JSONP failed', e);
      errors.push({ step: 'gviz_jsonp', error: String(e) });
    }

    // Try proxied CSV exports
    try {
      const candidates = buildCandidateCsvUrls(inputUrl);
      for (const url of candidates) {
        const proxied = `/proxy?url=${encodeURIComponent(url)}`;
        try {
          const text = await fetchCsvText(proxied);
          const rows = parseCsv(text);
          if (rows && rows.length) return rows;
        } catch (err) {
          console.warn('[loader] proxied CSV failed', url, err);
          errors.push({ step: 'proxied_csv', url, error: String(err) });
        }
      }
    } catch (err) {
      errors.push({ step: 'build_candidates', error: String(err) });
    }
  }

  // Direct fetch as-is via proxy
  try {
    const directProxied = `/proxy?url=${encodeURIComponent(inputUrl)}`;
    const text = await fetchCsvText(directProxied);
    const rows = parseCsv(text);
    if (rows && rows.length) return rows;
  } catch (err) {
    console.warn('[loader] direct proxied fetch failed', err);
    errors.push({ step: 'direct_proxied', error: String(err) });
  }

  throw new Error('Không thể tải sheet. Chi tiết: ' + JSON.stringify(errors).slice(0, 800));
}

function parseGvizTableToRows(resp) {
  const table = resp?.table;
  if (!table) return [];
  const header = table.cols.map(c => c.label || c.id || '');
  const rows = [header];
  for (const r of table.rows) {
    rows.push((r.c || []).map(c => {
      if (!c) return '';
      if (typeof c.f !== 'undefined' && c.f !== null) return String(c.f);
      if (typeof c.v !== 'undefined' && c.v !== null) return String(c.v);
      return '';
    }));
  }
  return rows;
}

function fetchViaGvizJsonp(id, gid) {
  return new Promise((resolve, reject) => {
    const prev = (window.google && window.google.visualization &&
      window.google.visualization.Query && window.google.visualization.Query.setResponse) || null;
    window.google = window.google || {};
    window.google.visualization = window.google.visualization || {};
    window.google.visualization.Query = window.google.visualization.Query || {};
    window.google.visualization.Query.setResponse = (resp) => {
      try { resolve(parseGvizTableToRows(resp)); }
      catch (err) { reject(err); }
      cleanup();
    };
    function cleanup() {
      if (prev) window.google.visualization.Query.setResponse = prev;
      script.remove();
      clearTimeout(timer);
    }
    const script = document.createElement('script');
    const base = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq`;
    const qp = new URLSearchParams();
    if (gid) qp.set('gid', gid);
    qp.set('tqx', 'out:json');
    script.src = `${base}?${qp.toString()}`;
    script.onerror = () => { cleanup(); reject(new Error('Script load error')); };
    document.head.appendChild(script);
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timeout')); }, 15000);
  });
}

// -------------------------
// Grouping logic (5-row success)
// -------------------------
function groupRows(rows) {
  const header = rows[0] || [];
  const idxKey = {
    event_name: findColumnIndex(header, ['event_name']),
    key: findColumnIndex(header, ['event_params.key']),
    value: findColumnIndex(header, ['event_params.value.string_value']),
    ts: findColumnIndex(header, ['event_timestamp']),
    country: findColumnIndex(header, ['geo.country', 'geo_country', 'country']),
    subStatus: findColumnIndex(header, ['subscription_status']),
    userPseudoId: findColumnIndex(header, ['user_pseudo_id', 'user_pseudoid'])
  };

  const data = rows.slice(1);
  const records = [];
  const hasEvent = idxKey.event_name !== -1 && idxKey.key !== -1 && idxKey.value !== -1;
  if (hasEvent) {
    for (let i = 0; i < data.length;) {
      const r0 = data[i];
      const ev = (r0[idxKey.event_name] || '').toString().toLowerCase();
      const isSuccess = ev.includes('success');
      if (!isSuccess) { i++; continue; }
      
      // Find the end of this success group (up to 5 rows)
      let endIndex = i;
      while (endIndex < data.length && endIndex < i + 5) {
        const rowEv = (data[endIndex][idxKey.event_name] || '').toString().toLowerCase();
        if (!rowEv.includes('success')) break;
        endIndex++;
      }
      
      const chunk = data.slice(i, endIndex);
      if (chunk.length === 0) { i++; continue; }
      
      const assembled = { input1: null, input2: null, style: null, category: null, output: null, ts: null, country: null, subStatus: null, userPseudoId: null };
      for (const r of chunk) {
        const k = r[idxKey.key];
        const v = r[idxKey.value];
        if (k === 'input1') assembled.input1 = v;
        else if (k === 'input2') assembled.input2 = v;
        else if (k === 'style') assembled.style = v;
        else if (k === 'category') assembled.category = v;
        else if (k === 'output') assembled.output = v;
        if (!assembled.ts) assembled.ts = r[idxKey.ts];
        if (!assembled.country) assembled.country = r[idxKey.country];
        if (assembled.subStatus == null && idxKey.subStatus !== -1) { const sv = r[idxKey.subStatus]; if (sv && sv !== '#N/A') assembled.subStatus = sv; }
        if (assembled.userPseudoId == null && idxKey.userPseudoId !== -1) { const up = r[idxKey.userPseudoId]; if (up) assembled.userPseudoId = up; }
      }
      
      if (assembled.output) {
        records.push({
          id: records.length,
          input1Url: assembled.input1 || null,
          input2Url: assembled.input2 || null,
          styleName: trimPrefix(assembled.style || '', 'Style Name:'),
          categoryName: trimPrefix(assembled.category || '', 'Category Name:'),
          outputUrl: assembled.output || undefined,
          timestamp: assembled.ts || '',
          country: assembled.country || '',
          subscriptionStatus: assembled.subStatus || '',
          userPseudoId: assembled.userPseudoId || ''
        });
      }
      i = endIndex; // Move to end of current group
    }
    return records;
  }

  // Fallback streaming assembler
  let acc = { input1: null, input2: null, style: null, category: null, output: null, ts: null, country: null, subStatus: null, userPseudoId: null };
  function flush() {
    if (!acc.style && !acc.category && !acc.output) return;
    if (!acc.output) { acc = { input1: null, input2: null, style: null, category: null, output: null, ts: null, country: null, subStatus: null, userPseudoId: null }; return; }
    records.push({ id: records.length, input1Url: acc.input1 || null, input2Url: acc.input2 || null, styleName: trimPrefix(acc.style || '', 'Style Name:'), categoryName: trimPrefix(acc.category || '', 'Category Name:'), outputUrl: acc.output || undefined, timestamp: acc.ts || '', country: acc.country || '', subscriptionStatus: acc.subStatus || '', userPseudoId: acc.userPseudoId || '' });
    acc = { input1: null, input2: null, style: null, category: null, output: null, ts: null, country: null, subStatus: null, userPseudoId: null };
  }
  for (const r of data) {
    const key = r[idxKey.key];
    const val = r[idxKey.value];
    const ts = r[idxKey.ts];
    const country = r[idxKey.country];
    const rawSub = idxKey.subStatus !== -1 ? r[idxKey.subStatus] : null;
    const subStatus = rawSub && rawSub !== '#N/A' ? rawSub : null;
    if (key === 'input1') { if (acc.input1 || acc.input2 || acc.style || acc.category || acc.output) flush(); acc.input1 = val; acc.ts = ts; acc.country = country; acc.subStatus = subStatus; acc.userPseudoId = idxKey.userPseudoId !== -1 ? r[idxKey.userPseudoId] : acc.userPseudoId; }
    else if (key === 'input2') { acc.input2 = val; acc.ts = ts; acc.country = country; acc.subStatus = subStatus ?? acc.subStatus; acc.userPseudoId = idxKey.userPseudoId !== -1 ? r[idxKey.userPseudoId] : acc.userPseudoId; }
    else if (key === 'style') { if (acc.style || acc.category || acc.output) flush(); acc.style = val; acc.ts = ts; acc.country = country; acc.subStatus = subStatus; acc.userPseudoId = idxKey.userPseudoId !== -1 ? r[idxKey.userPseudoId] : acc.userPseudoId; }
    else if (key === 'category') { acc.category = val; acc.ts = ts; acc.country = country; acc.subStatus = subStatus ?? acc.subStatus; acc.userPseudoId = idxKey.userPseudoId !== -1 ? r[idxKey.userPseudoId] : acc.userPseudoId; }
    else if (key === 'output') { acc.output = val; acc.ts = ts; acc.country = country; acc.subStatus = subStatus ?? acc.subStatus; acc.userPseudoId = idxKey.userPseudoId !== -1 ? r[idxKey.userPseudoId] : acc.userPseudoId; flush(); }
  }
  flush();
  return records;
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function formatTimestamp(ts) {
  const n = Number(ts);
  if (Number.isFinite(n)) { const ms = Math.round(n); try { return new Date(ms).toLocaleString(); } catch (_) { return String(ts); } }
  return String(ts);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// -------------------------
// UI: strip + selection
// -------------------------
function applyFilters() {
  filteredRecords = allRecords;
  currentPage = 1;
  renderStrip();
  updatePagination();
}

function renderVideoCards(records) {
  if (!records.length) { 
    videoCards.innerHTML = '<div class="empty-state">Không có dữ liệu</div>'; 
    return; 
  }
  
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const pageRecords = records.slice(start, end);
  
  videoCards.innerHTML = pageRecords.map((r, idx) => {
    const isCancelled = r.subscriptionStatus && r.subscriptionStatus.toLowerCase().includes('cancelled');
    return `
      <div class="video-card" id="card-${idx + 1}" data-page-index="${idx}" data-id="${r.id}" onclick="selectVideo(${r.id})">
        <div class="video-title">${escapeHtml(r.styleName || 'Unknown Style')}</div>
        <div class="video-category">${escapeHtml(r.categoryName || 'Unknown Category')}</div>
        <div class="video-location">${escapeHtml(r.country || 'Unknown Country')}</div>
        <div class="video-user">${escapeHtml(r.userPseudoId || 'Unknown User')}</div>
        <div class="video-subscription ${isCancelled ? 'cancelled' : ''}">${escapeHtml(r.subscriptionStatus || 'Unknown Status')}</div>
      </div>
    `;
  }).join('');

  // Keep selection visible if any
  if (selectedGlobalIndex >= 0) {
    const within = (selectedGlobalIndex % pageSize) + 1;
    const el = document.getElementById(`card-${within}`);
    if (el) el.classList.add('selected');
  }
}

function selectVideo(id) {
  selectedRecord = allRecords.find(r => r.id === id);
  if (!selectedRecord) return;
  // Track global index for keyboard nav
  const gi = filteredRecords.findIndex(r => r.id === id);
  if (gi !== -1) selectedGlobalIndex = gi;
  
  // Update selected card
  document.querySelectorAll('.video-card').forEach(card => {
    card.classList.remove('selected');
  });
  document.querySelector(`[data-id="${id}"]`).classList.add('selected');
  
  // Show inline preview
  renderInlinePreview();
}

function renderInlinePreview() {
  if (!selectedRecord) return;
  
  // input1
  const input1Container = inlineImg1.parentElement;
  const hasInput1 = selectedRecord.input1Url && 
                   selectedRecord.input1Url !== 'null' && 
                   selectedRecord.input1Url !== 'undefined' && 
                   String(selectedRecord.input1Url).trim() !== '';
  
  if (hasInput1) {
    inlineImg1.src = selectedRecord.input1Url;
    inlineImg1.style.display = 'block';
    inlineLink1.href = selectedRecord.input1Url;
    inlineLink1.textContent = 'View Image 1';
    input1Container.style.display = 'flex';
  } else {
    input1Container.style.display = 'none';
  }
  
  // input2 - ẩn hoàn toàn nếu không có hoặc giống input1
  const input2Container = inlineImg2.parentElement;
  const hasInput2 = selectedRecord.input2Url && 
                   selectedRecord.input2Url !== 'null' && 
                   selectedRecord.input2Url !== 'undefined' && 
                   String(selectedRecord.input2Url).trim() !== '' &&
                   selectedRecord.input2Url !== selectedRecord.input1Url; // Không hiển thị nếu giống input1
  
  if (hasInput2) {
    inlineImg2.src = selectedRecord.input2Url;
    inlineImg2.style.display = 'block';
    inlineLink2.href = selectedRecord.input2Url;
    inlineLink2.textContent = 'View Image 2';
    input2Container.style.display = 'flex';
  } else {
    input2Container.style.display = 'none';
  }
  
  // Update grid layout based on visible items
  const grid = document.querySelector('.inline-grid');
  const visibleItems = [input1Container, input2Container].filter(container => 
    container.style.display !== 'none'
  ).length + 1; // +1 for video which is always visible
  
  grid.className = 'inline-grid';
  if (visibleItems === 1) grid.classList.add('one-item');
  else if (visibleItems === 2) grid.classList.add('two-items');
  else if (visibleItems === 3) grid.classList.add('three-items');
  // video
  if (selectedRecord.outputUrl) {
    try { inlineVideo.pause(); } catch {}
    inlineVideo.removeAttribute('src');
    inlineVideo.load();
    inlineVideo.src = selectedRecord.outputUrl;
    // Autoplay ngay khi chuyển thẻ
    inlineVideo.autoplay = true;
    inlineVideo.muted = true; // đảm bảo autoplay trên nhiều trình duyệt
    inlineVideo.playsInline = true;
    inlineVideo.controls = true;
    inlineVideo.style.display = 'block';
    // play() sau khi gán src
    const tryPlay = () => {
      const p = inlineVideo.play();
      if (p && typeof p.then === 'function') p.catch(() => {});
    };
    if (inlineVideo.readyState >= 2) tryPlay(); else inlineVideo.oncanplay = tryPlay;

    inlineLinkVideo.href = selectedRecord.outputUrl;
    inlineLinkVideo.textContent = 'Download Video';
  } else {
    inlineVideo.style.display = 'none';
    inlineLinkVideo.textContent = 'No Video';
    inlineLinkVideo.href = '#';
  }
  inlinePreview.style.display = 'block';
}

function updatePagination() {
  const totalPages = Math.ceil(filteredRecords.length / pageSize);
  pageInfo.textContent = `${currentPage}/${Math.max(totalPages, 1)}`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
  countEl.textContent = `Đã tải ${filteredRecords.length} video.`;
}

function goToPage(page) {
  const totalPages = Math.ceil(filteredRecords.length / pageSize);
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  renderVideoCards(filteredRecords);
  updatePagination();
}

function applyFilters() {
  // Apply multi-select filters
  filteredRecords = allRecords.filter(r =>
    (activeFilters.country.size === 0 || activeFilters.country.has(r.country || '')) &&
    (activeFilters.category.size === 0 || activeFilters.category.has(r.categoryName || '')) &&
    (activeFilters.style.size === 0 || activeFilters.style.has(r.styleName || '')) &&
    (activeFilters.subscription.size === 0 || activeFilters.subscription.has(r.subscriptionStatus || '')) &&
    (activeFilters.user.size === 0 || activeFilters.user.has(r.userPseudoId || ''))
  );
  currentPage = 1;
  renderVideoCards(filteredRecords);
  updatePagination();
}

// (legacy strip/detail funcs removed)

// Events
loadBtn.addEventListener('click', async () => {
  const url = sheetUrlInput.value.trim();
  if (!url) { alert('Vui lòng nhập URL Google Sheet'); return; }
  loadBtn.disabled = true; loadBtn.textContent = '⏳ Đang tải...';
  try {
    const rows = await loadSheetRows(url);
    allRecords = groupRows(rows);
    applyFilters();
    // Không hiện alert; chỉ log nhẹ nếu rỗng
    if (allRecords.length === 0) {
      console.warn('Không tìm thấy dữ liệu video nào trong sheet');
    }
    // Focus strip để điều hướng arrow hoạt động chắc chắn
    setTimeout(() => { try { videoCards && videoCards.focus(); } catch {} }, 0);
  } catch (error) {
    console.error('Load error:', error);
    // Không hiện alert gây phiền; hiển thị console
  } finally { loadBtn.disabled = false; loadBtn.textContent = 'Tải'; }
});

// Pagination events
prevBtn.addEventListener('click', () => goToPage(currentPage - 1));
nextBtn.addEventListener('click', () => goToPage(currentPage + 1));
pageSizeSelect.addEventListener('change', (e) => {
  pageSize = parseInt(e.target.value);
  currentPage = 1;
  renderVideoCards(filteredRecords);
  updatePagination();
});

// Strip navigation
stripPrev.addEventListener('click', () => {
  videoCards.scrollBy({ left: -300, behavior: 'smooth' });
});
stripNext.addEventListener('click', () => {
  videoCards.scrollBy({ left: 300, behavior: 'smooth' });
});

// Filter events
filterTags.forEach(tag => {
  tag.addEventListener('click', () => {
    const type = tag.getAttribute('data-filter');
    buildAndShowFilter(type);
  });
});

function buildAndShowFilter(type){
  if (!type) return;
  filtersTitle.textContent = `Filter: ${type}`;
  // Build unique options from current allRecords
  const values = Array.from(new Set(allRecords.map(r => {
    if (type === 'country') return r.country || '';
    if (type === 'category') return r.categoryName || '';
    if (type === 'style') return r.styleName || '';
    if (type === 'subscription') return r.subscriptionStatus || '';
    if (type === 'user') return r.userPseudoId || '';
    return '';
  }).filter(Boolean))).sort((a,b)=>a.localeCompare(b));

  filtersOptions.innerHTML = values.map(v => {
    const selected = activeFilters[type].has(v) ? 'selected' : '';
    return `<div class="option-chip ${selected}" data-type="${type}" data-value="${encodeHTML(v)}">${escapeHtml(v)}</div>`;
  }).join('');

  // Toggle selection
  filtersOptions.querySelectorAll('.option-chip').forEach(el => {
    el.addEventListener('click', () => {
      const t = el.getAttribute('data-type');
      const val = el.getAttribute('data-value');
      if (activeFilters[t].has(val)) activeFilters[t].delete(val); else activeFilters[t].add(val);
      el.classList.toggle('selected');
    });
  });

  filtersPanel.style.display = 'block';
}

filtersApply.addEventListener('click', () => {
  filtersPanel.style.display = 'none';
  applyFilters();
  renderActiveFiltersBar();
});

filtersClear.addEventListener('click', () => {
  const current = filtersTitle.textContent.split(':')[1]?.trim();
  const map = { Country:'country', Category:'category', Style:'style', Subscription:'subscription', User:'user' };
  const type = map[current] || current;
  if (type && activeFilters[type]) activeFilters[type].clear();
  filtersOptions.querySelectorAll('.option-chip.selected').forEach(e=>e.classList.remove('selected'));
  renderActiveFiltersBar();
});

filtersClose.addEventListener('click', () => { filtersPanel.style.display = 'none'; });

function encodeHTML(s){ return String(s).replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

function renderActiveFiltersBar(){
  const entries = [];
  for (const key of Object.keys(activeFilters)) {
    if (activeFilters[key].size > 0) {
      activeFilters[key].forEach(v => entries.push({ key, label: `${key}: ${v}` }));
    }
  }
  if (entries.length === 0) { activeFiltersBar.style.display = 'none'; activeFiltersBar.innerHTML=''; return; }
  activeFiltersBar.style.display = 'flex';
  activeFiltersBar.innerHTML = entries.map((e,i)=>
    `<span class="active-pill" data-type="${e.key}" data-value="${encodeHTML(e.label.split(': ')[1])}">${escapeHtml(e.label)} <span class="remove">✕</span></span>`
  ).join('');
  activeFiltersBar.querySelectorAll('.active-pill .remove').forEach((btn)=>{
    btn.addEventListener('click', ()=>{
      const pill = btn.parentElement;
      const t = pill.getAttribute('data-type');
      const val = pill.getAttribute('data-value');
      if (activeFilters[t]) { activeFilters[t].delete(val); applyFilters(); renderActiveFiltersBar(); }
    });
  });
}

// Global function for card selection (used in onclick)
window.selectVideo = selectVideo;

document.addEventListener('DOMContentLoaded', () => {
  const def = 'https://docs.google.com/spreadsheets/d/1J2qIoQaTAWkBL81EGibg4k1i0ldgesQuE_29IT2rGC4/edit?pli=1&gid=478131050#gid=478131050';
  sheetUrlInput.value = def;
  updatePagination();
});

// Keyboard navigation for video cards: ArrowLeft / ArrowRight
function selectByOffset(delta) {
  if (!filteredRecords.length) return;
  if (selectedGlobalIndex < 0) selectedGlobalIndex = (currentPage - 1) * pageSize;
  let newIndex = Math.min(Math.max(selectedGlobalIndex + delta, 0), filteredRecords.length - 1);
  const newPage = Math.floor(newIndex / pageSize) + 1;
  if (newPage !== currentPage) {
    goToPage(newPage);
  }
  const rec = filteredRecords[newIndex];
  if (rec) {
    selectedGlobalIndex = newIndex;
    // Wait a tick if page changed to ensure DOM updated
    const run = () => {
      selectVideo(rec.id);
      const withinPageIndex = (newIndex % pageSize) + 1;
      const el = document.getElementById(`card-${withinPageIndex}`) || document.querySelector(`.video-card[data-id="${rec.id}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    };
    if (newPage !== currentPage) setTimeout(run, 0); else run();
  }
}

function handleArrowKeys(e){
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); selectByOffset(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); selectByOffset(1); }
}

// Capture phase to beat browser's default scroll on scrollable containers
document.addEventListener('keydown', handleArrowKeys, { capture: true });
window.addEventListener('keydown', handleArrowKeys, { capture: true });
// Also bind directly on the scroll container to suppress native arrow scroll
if (videoCards) {
  videoCards.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      handleArrowKeys(e);
    }
  }, { capture: true });
}
