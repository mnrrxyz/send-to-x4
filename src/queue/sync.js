/**
 * Queue Sync
 * Checks X4 reachability every 30s via chrome.alarms and uploads pending items.
 * Also exposes trySyncQueue() for manual sync triggered from the popup.
 */
const QueueSync = {
    ALARM_NAME: 'x4-queue-sync',

    setupAlarm() {
        chrome.alarms.create(this.ALARM_NAME, { periodInMinutes: 0.5 });
    },

    async handleAlarm(alarmName) {
        if (alarmName !== this.ALARM_NAME) return;
        await this.trySyncQueue();
    },

    async trySyncQueue() {
        const settings = await Settings.getAll();
        const isCrosspoint = settings.firmwareType === 'crosspoint';
        const deviceIp = settings.deviceIp || (isCrosspoint ? '192.168.4.1' : '192.168.3.3');

        const reachable = await this.pingX4(deviceIp);
        if (!reachable) return { synced: 0, failed: 0, skipped: true };

        return await this.drainQueue(deviceIp, isCrosspoint);
    },

    async pingX4(ip) {
        try {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 3000);
            const response = await fetch(`http://${ip}/list?dir=/`, {
                method: 'GET',
                signal: controller.signal
            });
            return response.ok;
        } catch {
            return false;
        }
    },

    async drainQueue(deviceIp, isCrosspoint) {
        const pending = await QueueStorage.getPending();
        let synced = 0;
        let failed = 0;

        const uploader = isCrosspoint ? CrossPointUpload : X4UploadTab;
        if (isCrosspoint) {
            CrossPointUpload.setIp(deviceIp);
        } else if (typeof X4UploadTab.setIp === 'function') {
            X4UploadTab.setIp(deviceIp);
        }

        for (const item of pending) {
            try {
                const epubBlob = await EpubBuilder.build(item);
                const filename = EpubBuilder.generateFilename(item);
                const arrayBuffer = await EpubBuilder.blobToArrayBuffer(epubBlob);
                const result = await uploader.uploadEpub(arrayBuffer, filename);

                if (result.success) {
                    await QueueStorage.remove(item.id);
                    synced++;
                } else {
                    await QueueStorage.markFailed(item.id);
                    failed++;
                }
            } catch (err) {
                await QueueStorage.markFailed(item.id);
                failed++;
                console.error('[QueueSync] Error on', item.title, err);
            }
        }

        return { synced, failed, skipped: false };
    }
};
