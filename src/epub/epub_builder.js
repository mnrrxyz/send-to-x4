/**
 * EPUB Builder
 * Generates EPUB files from article/longpost data using JSZip
 */

// EpubBuilder will use the JSZip global from jszip.min.js (loaded via manifest)
const EpubBuilder = {
    /**
     * Generate EPUB blob from article data
     * @param {Object} article - { title, author, date, body, url }
     * @returns {Promise<Blob>} - EPUB blob
     */
    async build(article) {
        // JSZip is available globally from jszip.min.js loaded by service worker
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip not loaded');
        }

        const zip = new JSZip();
        const uuid = this.generateUuid();

        let coverMediaType = null;
        if (article.cover) {
            try {
                const binary = atob(article.cover);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                zip.file('OEBPS/images/cover.jpg', bytes);
                coverMediaType = 'image/jpeg';
            } catch (e) {
                console.warn('[EpubBuilder] Failed to add cover:', e.message);
            }
        }

        const metadata = {
            title: article.title,
            author: article.author,
            date: article.date,
            uuid: uuid,
            coverMediaType
        };

        // Decode and add images as real files in the ZIP
        const ALLOWED_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif']);
        const images = (article.images || []).filter(img =>
            img.id && /^[a-z0-9_-]+$/i.test(img.id) && ALLOWED_EXTS.has(img.ext)
        );
        for (const img of images) {
            try {
                const binary = atob(img.data);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                zip.file(`OEBPS/images/${img.id}.${img.ext}`, bytes);
            } catch (e) {
                console.warn('[EpubBuilder] Skipping image:', img.id, e.message);
            }
        }

        // Add mimetype file (must be first and uncompressed)
        zip.file('mimetype', EpubTemplates.mimetype, { compression: 'STORE' });

        // Add container.xml in META-INF
        zip.file('META-INF/container.xml', EpubTemplates.containerXml);

        // Add content.opf (includes image manifest items)
        zip.file('OEBPS/content.opf', EpubTemplates.contentOpf(metadata, images));

        // Add toc.ncx
        zip.file('OEBPS/toc.ncx', EpubTemplates.tocNcx(metadata));

        // Add content.xhtml (pass full article including url)
        zip.file('OEBPS/content.xhtml', EpubTemplates.contentXhtml(article));

        // Generate the EPUB as a Blob
        const epubBlob = await zip.generateAsync({
            type: 'blob',
            mimeType: 'application/epub+zip',
            compression: 'DEFLATE',
            compressionOptions: { level: 9 }
        });

        return epubBlob;
    },

    /**
     * Generate a filename for the EPUB
     * Format: @handle - YYYY-MM-DD - first words.epub
     * @param {Object} article - { title, author, date }
     * @returns {string}
     */
    generateFilename(article) {
        const parts = [];

        // 1. Title (First)
        const safeTitle = Sanitizer.sanitizeFilename(article.title, 50);
        if (safeTitle) {
            parts.push(safeTitle);
        } else {
            parts.push('Untitled');
        }

        // 2. Author
        if (article.author) {
            const safeAuthor = Sanitizer.sanitizeFilename(article.author, 30);
            if (safeAuthor) parts.push(safeAuthor);
        }

        // 3. Source (Domain)
        if (article.sourceUrl) {
            try {
                const hostname = new URL(article.sourceUrl).hostname;
                const source = hostname.replace(/^www\./, '');
                parts.push(source);
            } catch (e) {
                // ignore invalid url
            }
        }

        // 4. Date (Last)
        const date = article.date || new Date().toISOString().split('T')[0];
        parts.push(date);

        return parts.join(' - ') + '.epub';
    },

    /**
     * Generate a UUID v4
     * @returns {string}
     */
    generateUuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    /**
     * Convert Blob to ArrayBuffer for message passing
     * @param {Blob} blob 
     * @returns {Promise<ArrayBuffer>}
     */
    async blobToArrayBuffer(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(blob);
        });
    }
};
