(() => {
  const [id, query] = SEARCH_INPUT;
  const app = document.querySelector('ytmusic-app');
  if (typeof app?.networkManager?.fetch !== 'function') return 'missing';
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
  Promise.race([
    Promise.resolve().then(() => app.networkManager.fetch('/search', {
      query,
      // YouTube Music's Songs search filter.
      params: 'EgWKAQIIAWoMEA4QChADEAQQCRAF',
    })),
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
