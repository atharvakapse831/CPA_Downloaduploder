function normalizeYtdlp(raw) {
  const thumbnail = pickBestThumbnail(raw.thumbnails) || raw.thumbnail || null;
  const videoUrl  = pickVideoUrl(raw) || null;

  return {
    externalId:  raw.id || null,
    platform:    detectPlatform(raw),
    sourceUrl:   raw.webpage_url || null,
    title:       truncate(raw.title, 500) || null,
    description: truncate(raw.description, 5000) || null,
    duration:    raw.duration ? Math.round(raw.duration) : null,
    videoUrl,
    thumbnail,
    audioCodec:  raw.acodec || null,
    videoCodec:  raw.vcodec || null,
    width:       raw.width  || null,
    height:      raw.height || null,
    creator: {
      username:    raw.uploader_id  || raw.uploader || null,
      displayName: raw.uploader     || null,
      profileUrl:  raw.uploader_url || null,
      avatarUrl:   null,
    },
    engagement: {
      views:    raw.view_count    ?? null,
      likes:    raw.like_count    ?? null,
      comments: raw.comment_count ?? null,
    },
    uploadedAt:   raw.timestamp ? new Date(raw.timestamp * 1000).toISOString() : null,
    extractedAt:  new Date().toISOString(),
    completeness: scoreCompleteness({ videoUrl, thumbnail, title: raw.title,
                    description: raw.description, duration: raw.duration, creator: raw.uploader_id }),
  };
}

function pickBestThumbnail(thumbnails) {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
  const valid = thumbnails.filter(t => t?.url);
  return valid.length > 0 ? valid[valid.length - 1].url : null;
}

function pickVideoUrl(raw) {
  if (raw.url && raw.url.startsWith('http')) return raw.url;
  if (Array.isArray(raw.formats)) {
    const combined = raw.formats.filter(
      f => f.url && f.url.startsWith('http') && f.vcodec !== 'none' && f.acodec !== 'none'
    );
    if (combined.length > 0) {
      combined.sort((a, b) => (b.filesize || 0) - (a.filesize || 0));
      return combined[0].url;
    }
  }
  return null;
}

function detectPlatform(raw) {
  const url = raw.webpage_url || raw.url || '';
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('tiktok.com'))  return 'tiktok';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  if (url.includes('facebook.com')) return 'facebook';
  return raw.extractor || 'unknown';
}

function truncate(str, maxLen) {
  if (!str) return null;
  return String(str).slice(0, maxLen);
}

function scoreCompleteness(fields) {
  const weights = { videoUrl: 40, thumbnail: 20, title: 15, description: 10, duration: 10, creator: 5 };
  let score = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (fields[key]) score += weight;
  }
  return score;
}

module.exports = { normalizeYtdlp };
