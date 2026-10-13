/**
 * IndexedDB Vault Disabled Module
 * Per user instruction, browser IndexedDB storage and offline local vaults have been disabled.
 * Heavy attachments and entity files are saved directly to the central server disk storage (/api/state & /api/upload).
 */

const memoryCache = new Map<string, any>();
const projectArchivesMemoryCache = new Map<string, Record<string, any>>();

export const IndexedDBVault = {
  async setAttachment(expenseId: string, item: any): Promise<void> {
    if (!expenseId || !item) return;
    memoryCache.set(expenseId, item);
    if (item.projectId) {
      const prjMap = projectArchivesMemoryCache.get(item.projectId) || {};
      prjMap[expenseId] = item;
      projectArchivesMemoryCache.set(item.projectId, prjMap);
    }
  },

  async batchSetAttachments(projectId: string, items: any[]): Promise<void> {
    if (!items || items.length === 0) return;
    const prjMap = projectArchivesMemoryCache.get(projectId) || {};
    items.forEach((it) => {
      memoryCache.set(it.expenseId, it);
      prjMap[it.expenseId] = it;
    });
    projectArchivesMemoryCache.set(projectId, prjMap);
  },

  getAttachmentSync(expenseId: string): any | null {
    return memoryCache.get(expenseId) || null;
  },

  async getAttachment(expenseId: string): Promise<any | null> {
    return memoryCache.get(expenseId) || null;
  },

  getProjectAttachmentsSync(projectId: string): Record<string, any> {
    return projectArchivesMemoryCache.get(projectId) || {};
  },

  async getProjectAttachments(projectId: string): Promise<Record<string, any>> {
    return projectArchivesMemoryCache.get(projectId) || {};
  },

  async getAllAttachments(): Promise<any[]> {
    return Array.from(memoryCache.values());
  },

  async initMemoryCache(): Promise<void> {}
};
