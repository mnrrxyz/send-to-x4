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
                article.cover = await this.generateCover(article);
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

    async generateCover(article) {
        const W = 480, H = 800;
        try {
            const canvas = new OffscreenCanvas(W, H);
            const ctx = canvas.getContext('2d');

            // Background
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, W, H);

            // Top bar
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, W, 12);

            const margin = 52;
            const maxWidth = W - margin * 2;
            ctx.fillStyle = '#000000';
            ctx.textBaseline = 'top';

            // Adaptive font size: shrink for long titles
            const title = article.title || 'Untitled';
            let fontSize = 38;
            if (title.length > 60)  fontSize = 30;
            if (title.length > 100) fontSize = 24;
            if (title.length > 160) fontSize = 20;

            ctx.font = `bold ${fontSize}px sans-serif`;
            const lineHeight = Math.round(fontSize * 1.35);

            // Word-wrap title
            const words = title.split(' ');
            const lines = [];
            let current = '';
            for (const word of words) {
                const test = current ? `${current} ${word}` : word;
                if (ctx.measureText(test).width > maxWidth && current) {
                    lines.push(current);
                    current = word;
                } else {
                    current = test;
                }
            }
            if (current) lines.push(current);

            // Center title block in upper 58% of canvas
            const titleBlockH = lines.length * lineHeight;
            let titleY = Math.max(60, (H * 0.58 - titleBlockH) / 2);
            for (const line of lines) {
                const lw = ctx.measureText(line).width;
                ctx.fillText(line, (W - lw) / 2, titleY);
                titleY += lineHeight;
            }

            // Divider
            const divY = Math.round(H * 0.63);
            ctx.fillStyle = '#000000';
            ctx.fillRect(margin, divY, maxWidth, 2);

            // Author
            const author = article.author || '';
            if (author) {
                ctx.font = `19px sans-serif`;
                ctx.fillStyle = '#222222';
                ctx.textBaseline = 'top';
                const aw = ctx.measureText(author).width;
                ctx.fillText(author, (W - Math.min(aw, maxWidth)) / 2, divY + 22);
            }

            // Source · date
            const source = (() => {
                try { return new URL(article.sourceUrl || '').hostname.replace(/^www\./, ''); } catch { return ''; }
            })();
            const date = article.date || '';
            const meta = [source, date].filter(Boolean).join(' · ');
            if (meta) {
                ctx.font = `16px sans-serif`;
                ctx.fillStyle = '#666666';
                ctx.textBaseline = 'top';
                const mw = ctx.measureText(meta).width;
                ctx.fillText(meta, (W - Math.min(mw, maxWidth)) / 2, divY + (author ? 54 : 22));
            }

            // Bottom bar
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, H - 12, W, 12);

            const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
            const dataUrl = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(blob);
            });
            return dataUrl ? dataUrl.split(',')[1] : null;
        } catch (e) {
            console.warn('[ArticleManager] Cover generation failed:', e.message);
            return null;
        }
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
        };

        // Embedded (canvas → JPEG, SVG → PNG): already have base64 data
        for (const m of embedded) {
            const b64 = m.dataUrl.split(',')[1];
            if (!b64) continue;
            images.push({ id: m.id, data: b64, mimeType: m.mimeType, ext: m.ext });
            fixBodySrc(m.id, m.ext);
        }

        // External images: fetch in parallel then patch body sequentially.
        // Parallel fetch cuts worst-case wait from (N × timeout) to (1 × timeout).
        const MAX_BLOB = 1500 * 1024;
        const TIMEOUT = 5000;

        const fetchImage = async ({ id, src, ext }) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), TIMEOUT);
            try {
                const res = await fetch(src, { signal: controller.signal });
                clearTimeout(timer);
                if (!res.ok) return null;
                let blob = await res.blob();
                if (blob.size > MAX_BLOB) return null;

                const mimeType = blob.type || 'image/jpeg';
                const actualExt = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' }[mimeType] || 'jpg';

                // Convert WebP → JPEG (CrossPoint doesn't support WebP).
                if (mimeType === 'image/webp') {
                    const bitmap = await createImageBitmap(blob);
                    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                    canvas.getContext('2d').drawImage(bitmap, 0, 0);
                    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
                }

                const dataUrl = await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(blob);
                });
                if (!dataUrl) return null;

                return { id, ext, actualExt, data: dataUrl.split(',')[1], mimeType: blob.type || 'image/jpeg' };
            } catch (e) {
                clearTimeout(timer);
                return null;
            }
        };

        const fetched = await Promise.allSettled(externalSrcs.map(fetchImage));

        // Patch body sequentially to avoid concurrent string mutation.
        for (const result of fetched) {
            if (result.status !== 'fulfilled' || !result.value) continue;
            const { id, ext, actualExt, data, mimeType } = result.value;
            images.push({ id, data, mimeType, ext: actualExt });
            fixBodySrc(id, ext);
            if (actualExt !== ext) {
                article.body = article.body.split(`images/${id}.${ext}`).join(`images/${id}.${actualExt}`);
            }
        }

        return images;
    }
}
