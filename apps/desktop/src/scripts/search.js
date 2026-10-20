(() => {
  const [id, query] = SEARCH_INPUT;
  if (typeof window.fetch !== 'function') return 'search-unavailable';
  const job = { id, status: 'pending' };
  window.__ytRemoteSearch = job;
  const results = [];
  const seen = new Set();
  const text = (runs) => Array.from((runs || []).map((run) => run.text || '').join('')).slice(0, 250).join('');
  const visit = (node) => {
    if (!node || typeof node !== 'object' || results.length >= 25) return;
    const item = node.musicResponsiveListItemRenderer;
    if (item) {
      if (item.musicItemRendererDisplayPolicy === 'MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT') return;
      const endpoint = item.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
      const videoId = item.playlistItemData?.videoId || endpoint?.watchEndpoint?.videoId;
      const columns = item.flexColumns || [];
      const title = text(columns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs);
      if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId || '') || !title || seen.has(videoId)) return;
      const artist = text(columns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs);
      const thumbnails = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
      const artwork = thumbnails.at(-1)?.url;
      seen.add(videoId);
      results.push({ videoId, title, artist, ...(typeof artwork === 'string' && artwork.length <= 2048 && artwork.startsWith('https://') ? { artwork } : {}) });
      return;
    }
    for (const value of Object.values(node)) visit(value);
  };
  let timeout;
  const request = async () => {
    // AppleScript runs in an isolated world: page globals are inaccessible, but HTML is shared.
    const config = {};
    const readConfig = (text) => {
      for (const match of text.matchAll(/ytcfg\.set\s*\(\s*(\{[\s\S]*?\})\s*\)\s*;?/g)) {
        try { Object.assign(config, JSON.parse(match[1])); } catch {}
      }
    };
    for (const script of document.scripts) readConfig(script.textContent || '');
    if (!config.INNERTUBE_CONTEXT?.client?.clientVersion) {
      const page = await window.fetch('/', { credentials: 'same-origin' });
      if (!page.ok) throw new Error(`Could not load YouTube Music configuration (HTTP ${page.status})`);
      readConfig(await page.text());
    }
    const context = config.INNERTUBE_CONTEXT;
    if (!context?.client?.clientVersion) throw new Error('Could not read YouTube Music search configuration from the page');
    const body = {
      query,
      // YouTube Music's Songs search filter.
      params: 'EgWKAQIIAWoMEA4QChADEAQQCRAF',
    };
    const key = config.INNERTUBE_API_KEY;
    const headers = {
      'Content-Type': 'application/json',
      'X-YouTube-Client-Name': String(config.INNERTUBE_CONTEXT_CLIENT_NAME || 67),
      'X-YouTube-Client-Version': context.client.clientVersion,
    };
    if (context.client.visitorData) headers['X-Goog-Visitor-Id'] = context.client.visitorData;
    return window.fetch('/youtubei/v1/search?prettyPrint=false' + (key ? '&key=' + encodeURIComponent(key) : ''), {
      method: 'POST', credentials: 'same-origin', headers,
      body: JSON.stringify({ context, ...body }),
    }).then((response) => {
      if (!response.ok) throw new Error(`YouTube Music search failed (HTTP ${response.status}). Try reloading the music tab.`);
      return response.json();
    });
  };
  Promise.race([
    Promise.resolve().then(request),
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Search timed out. Try again.')), 12000); }),
  ]).then((response) => {
    if (!response?.contents) throw new Error('YouTube Music returned an unsupported search response');
    visit(response.contents);
    job.results = results;
    job.status = 'done';
  }).catch((error) => {
    job.message = String(error?.message || 'Search failed').slice(0, 500);
    job.status = 'error';
  }).finally(() => clearTimeout(timeout));
  return 'ok';
})()
