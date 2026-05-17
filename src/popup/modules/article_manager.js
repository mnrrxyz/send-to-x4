import { extractArticle } from './extraction_logic.js';

// Cross-browser compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

/**
 * Article Manager
 * Handles article detection and extraction via content scripts
 */
export class ArticleManager {
    constructor() {
        this.articleData = null;
    }

    /**
     * Check if current tab has a valid article
     * @returns {Promise<Object>} The extracted article data or null
     */
    async checkArticle() {
        try {
            const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });

            if (!tab || !tab.id) {
                throw new Error('No active tab found');
            }

            // check if we can access the tab (e.g. chrome:// urls are restricted)
            if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
                throw new Error('Cannot access this page type');
            }

            console.log('[Article Manager] Checking tab:', tab.url);

            // First, inject Readability into the page if not already present
            try {
                // We inject it every time just in case. Content scripts usually run once but popup re-runs.
                // However, executeScript files: [] runs immediately.
                await browserAPI.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['src/content/readability.min.js']
                });
                console.log('[Article Manager] Readability injected');
            } catch (injectError) {
                console.log('[Article Manager] Could not inject Readability (maybe already there?):', injectError.message);
                // Continue anyway, extraction logic checks for Readability presence
            }

            // Now execute extraction logic
            const results = await browserAPI.scripting.executeScript({
                target: { tabId: tab.id },
                func: extractArticle
            });

            const result = results?.[0]?.result;
            console.log('[Article Manager] Extraction result:', result);

            if (result && result.success) {
                const article = result.article;
                const images = await this.buildImageArray(
                    result.media || [],
                    result.externalSrcs || [],
                    article
                );
                if (images.length > 0) article.images = images;
                this.articleData = article;
                return article;
            } else {
                console.log('[Article Manager] No article found:', result?.reason);
                return null;
            }

        } catch (error) {
            console.error('[Article Manager] Article check error:', error);
            throw error;
        }
    }

    getArticleData() {
        return this.articleData;
    }

    async buildImageArray(embedded, externalSrcs, article) {
        const images = [];
        // Use baseUri (document.baseURI) for resolving placeholder URLs — it matches
        // what Readability uses internally. Falls back to sourceUrl when not set.
        const sourceUrl = article.baseUri || article.sourceUrl || '';

        // Readability absolutizes relative URLs against the page base URL.
        // Given we replaced img srcs with `images/id.ext` in the clone,
        // Readability turns them into `https://base/path/to/images/id.ext`.
        // This helper finds that absolutized version and restores the relative path.
        const fixBodySrc = (id, ext) => {
            const relative = `images/${id}.${ext}`;
            try {
                const absolutized = new URL(relative, sourceUrl).href;
                article.body = article.body.split(absolutized).join(relative);
            } catch (e) {}
            // Also catch any leftover relative reference (edge case)
            article.body = article.body.split(`"${relative}"`).join(`"${relative}"`);
        };

        // Embedded (canvas → JPEG, SVG → PNG): already have base64 data
        for (const m of embedded) {
            const b64 = m.dataUrl.split(',')[1];
            if (!b64) continue;
            images.push({ id: m.id, data: b64, mimeType: m.mimeType, ext: m.ext });
            fixBodySrc(m.id, m.ext);
        }

        // External images: fetch then fix body reference
        const MAX_BLOB = 1500 * 1024;
        const TIMEOUT = 5000;

        for (const { id, src, ext } of externalSrcs) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), TIMEOUT);
                const res = await fetch(src, { signal: controller.signal });
                clearTimeout(timer);
                if (!res.ok) continue;
                let blob = await res.blob();
                if (blob.size > MAX_BLOB) continue;

                // Derive extension from actual content type, not the URL.
                // CDNs often serve JPEG under non-.jpg URLs.
                const mimeType = blob.type || 'image/jpeg';
                const actualExt = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' }[mimeType] || 'jpg';

                // Convert WebP to JPEG — CrossPoint doesn't support WebP natively.
                if (mimeType === 'image/webp') {
                    try {
                        const bitmap = await createImageBitmap(blob);
                        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                        canvas.getContext('2d').drawImage(bitmap, 0, 0);
                        blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
                    } catch (e) { continue; }
                }

                const dataUrl = await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(blob);
                });
                if (!dataUrl) continue;
                images.push({ id, data: dataUrl.split(',')[1], mimeType: blob.type || 'image/jpeg', ext: actualExt });
                fixBodySrc(id, ext); // fix the absolutized placeholder back to relative
                // if the actual extension differs from the URL-based one, rename the reference too
                if (actualExt !== ext) {
                    article.body = article.body.split(`images/${id}.${ext}`).join(`images/${id}.${actualExt}`);
                }
            } catch (e) { /* skip — timeout, CORS, or network */ }
        }

        return images;
    }
}
