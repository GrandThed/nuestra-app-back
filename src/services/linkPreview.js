const axios = require('axios');

/**
 * Extract Open Graph metadata from a URL
 * @param {string} url - The URL to fetch metadata from
 * @returns {Promise<{title: string, description: string, image: string}>}
 */
const fetchLinkPreview = async (url) => {
  try {
    const response = await axios.get(url, {
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HouseholdHub/1.0)'
      }
    });

    const html = response.data;

    // Extract Open Graph tags
    const ogTitle = extractMeta(html, 'og:title') || extractTitle(html);
    const ogDescription = extractMeta(html, 'og:description') || extractMeta(html, 'description');
    const ogImage = extractMeta(html, 'og:image');

    return {
      title: ogTitle || null,
      description: ogDescription || null,
      image: ogImage || null
    };
  } catch (err) {
    console.error('Link preview error:', err.message);
    return {
      title: null,
      description: null,
      image: null
    };
  }
};

/**
 * Extract meta tag content
 */
const extractMeta = (html, property) => {
  // Try property attribute (Open Graph)
  let match = html.match(new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["']`, 'i'));
  if (match) return match[1];

  // Try content first, then property
  match = html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${property}["']`, 'i'));
  if (match) return match[1];

  // Try name attribute (standard meta)
  match = html.match(new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']*)["']`, 'i'));
  if (match) return match[1];

  // Try content first, then name
  match = html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${property}["']`, 'i'));
  if (match) return match[1];

  return null;
};

/**
 * Extract title tag content
 */
const extractTitle = (html) => {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : null;
};

module.exports = {
  fetchLinkPreview
};
