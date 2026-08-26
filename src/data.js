function asText(value, limit) { return typeof value === 'string' ? value.trim().slice(0, limit) : ''; }
function safeUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }

export function normalizeStories(topic, stories) {
  if (!Array.isArray(stories)) return [];
  const seen = new Set();
  return stories.slice(0, 10).map((story, index) => {
    const title = asText(story?.title, 240);
    const source = asText(story?.source, 100);
    const url = safeUrl(story?.url);
    if (!title || !source || !url || seen.has(url)) return null;
    seen.add(url);
    const published = new Date(story?.publishedAt);
    const tags = Array.isArray(story?.tags) ? [...new Set(story.tags.map((tag) => asText(tag, 40)).filter(Boolean))].slice(0, 3) : [];
    return { id: `web-${Date.now()}-${index}`, title, source, url, imageUrl: safeUrl(story?.imageUrl), tags, summary: asText(story?.summary, 420) || `Web research about ${asText(topic, 120)}.`, publishedAt: Number.isNaN(published.getTime()) ? new Date().toISOString() : published.toISOString(), category: asText(story?.category, 60) || 'Web research', addedBy: 'ChatGPT' };
  }).filter(Boolean);
}
