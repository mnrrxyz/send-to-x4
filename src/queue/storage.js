/**
 * Queue Storage
 * Persists read-later articles in chrome.storage.local (unlimitedStorage).
 * Each item: { id, title, author, date, sourceUrl, body, images, cover, addedAt, status }
 * status: 'pending' | 'failed'
 * On successful sync the item is removed entirely.
 */
const QueueStorage = {
    KEY: 'x4_queue',

    getAll() {
        return new Promise(resolve => {
            chrome.storage.local.get([this.KEY], result => {
                resolve(result[this.KEY] || []);
            });
        });
    },

    save(items) {
        return new Promise(resolve => {
            chrome.storage.local.set({ [this.KEY]: items }, resolve);
        });
    },

    async add(article) {
        const items = await this.getAll();
        const item = {
            id: Date.now().toString(),
            title:     article.title     || 'Untitled',
            author:    article.author    || '',
            date:      article.date      || '',
            sourceUrl: article.sourceUrl || '',
            baseUri:   article.baseUri   || '',
            body:      article.body      || '',
            images:    article.images    || [],
            cover:     article.cover     || null,
            addedAt:   Date.now(),
            status:    'pending'
        };
        items.push(item);
        await this.save(items);
        return item;
    },

    async remove(id) {
        const items = await this.getAll();
        await this.save(items.filter(i => i.id !== id));
    },

    async markFailed(id) {
        const items = await this.getAll();
        const item = items.find(i => i.id === id);
        if (item) item.status = 'failed';
        await this.save(items);
    },

    async getPending() {
        const items = await this.getAll();
        return items.filter(i => i.status === 'pending' || i.status === 'failed');
    }
};
