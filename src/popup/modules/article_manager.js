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
                    result.externalSrcs || []
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

    async buildImageArray(embedded, externalSrcs) {
        const images = [];

        for (const m of embedded) {
            const b64 = m.dataUrl.split(',')[1];
            if (b64) images.push({ id: m.id, data: b64, mimeType: m.mimeType, ext: m.ext });
        }

        const MAX_BLOB = 500 * 1024;
        const TIMEOUT = 5000;

        for (const { id, src, ext } of externalSrcs) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), TIMEOUT);
                const res = await fetch(src, { signal: controller.signal });
                clearTimeout(timer);
                if (!res.ok) continue;
                const blob = await res.blob();
                if (blob.size > MAX_BLOB) continue;
                const mimeType = blob.type || (ext === 'png' ? 'image/png' : 'image/jpeg');
                const dataUrl = await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(blob);
                });
                if (!dataUrl) continue;
                images.push({ id, data: dataUrl.split(',')[1], mimeType, ext });
            } catch (e) { /* skip — timeout, CORS, or network */ }
        }

        return images;
    }
}
