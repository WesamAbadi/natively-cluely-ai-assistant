import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { CredentialsManager } from './CredentialsManager';

type ParseStatus = 'processing' | 'ready' | 'gemini-only' | 'error';
type GeminiSyncStatus = 'pending' | 'uploading' | 'synced' | 'expired' | 'error';

export interface GeminiRemoteMeta {
  name?: string;
  uri?: string;
  mimeType?: string;
  uploadedAt?: number;
  expiresAt?: number;
  status: GeminiSyncStatus;
  lastError?: string;
}

export interface ContextFileRecord {
  id: string;
  name: string;
  localPath: string;
  mimeType: string;
  sizeBytes: number;
  enabled: boolean;
  parseStatus: ParseStatus;
  parseError?: string;
  extractedText?: string;
  extractedChars: number;
  createdAt: number;
  updatedAt: number;
  geminiRemote: GeminiRemoteMeta;
}

interface ContextBaseConfig {
  enabled: boolean;
  manualText: string;
  files: ContextFileRecord[];
  updatedAt: number;
}

interface InternalChunk {
  sourceId: string;
  sourceName: string;
  sourceType: 'manual' | 'file';
  text: string;
  terms: Map<string, number>;
}

export interface ContextInjectionFilePart {
  fileId: string;
  name: string;
  uri: string;
  mimeType: string;
}

export interface ContextInjectionResult {
  contextBlock?: string;
  geminiFileParts: ContextInjectionFilePart[];
}

export interface ContextBasePublicFileRecord {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  enabled: boolean;
  parseStatus: ParseStatus;
  parseError?: string;
  extractedChars: number;
  geminiStatus: GeminiSyncStatus;
  geminiError?: string;
  geminiExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ContextBasePublicConfig {
  enabled: boolean;
  manualText: string;
  files: ContextBasePublicFileRecord[];
  updatedAt: number;
}

export interface AddContextFileResult {
  filePath: string;
  success: boolean;
  fileId?: string;
  error?: string;
}

const CONTEXT_DIR_NAME = 'context-base';
const CONTEXT_CONFIG_FILE = 'context-base.json';
const CONTEXT_FILES_DIR = 'files';
const MAX_MANUAL_TEXT_CHARS = 50_000;
const MAX_EXTRACTED_TEXT_CHARS = 200_000;
const MAX_CONTEXT_CHARS = 3_500;
const MAX_CONTEXT_CHUNKS = 4;
const GEMINI_FILE_TTL_MS = 47 * 60 * 60 * 1000; // docs say 48h retention; keep a safety margin
const MAX_GEMINI_FILE_PARTS = 2;

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'at', 'is', 'are', 'was', 'were', 'be', 'been',
  'with', 'that', 'this', 'it', 'as', 'by', 'from', 'we', 'you', 'i', 'they', 'he', 'she', 'them', 'his', 'her',
  'our', 'your', 'their', 'what', 'which', 'who', 'when', 'where', 'why', 'how',
]);

function defaultConfig(): ContextBaseConfig {
  return {
    enabled: true,
    manualText: '',
    files: [],
    updatedAt: Date.now(),
  };
}

function toPublicFile(file: ContextFileRecord): ContextBasePublicFileRecord {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    enabled: file.enabled,
    parseStatus: file.parseStatus,
    parseError: file.parseError,
    extractedChars: file.extractedChars,
    geminiStatus: file.geminiRemote.status,
    geminiError: file.geminiRemote.lastError,
    geminiExpiresAt: file.geminiRemote.expiresAt,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

export class ContextBaseManager {
  private static instance: ContextBaseManager | null = null;

  private readonly contextDir: string;
  private readonly filesDir: string;
  private readonly configPath: string;
  private config: ContextBaseConfig = defaultConfig();
  private chunksCache: InternalChunk[] = [];
  private pendingUploadByFileId = new Map<string, Promise<void>>();

  private constructor() {
    const userData = app.getPath('userData');
    this.contextDir = path.join(userData, CONTEXT_DIR_NAME);
    this.filesDir = path.join(this.contextDir, CONTEXT_FILES_DIR);
    this.configPath = path.join(this.contextDir, CONTEXT_CONFIG_FILE);
    this.ensureStorage();
    this.loadConfig();
    this.refreshChunkCache();
    this.markExpiredGeminiFiles();
  }

  public static getInstance(): ContextBaseManager {
    if (!ContextBaseManager.instance) {
      ContextBaseManager.instance = new ContextBaseManager();
    }
    return ContextBaseManager.instance;
  }

  public getPublicConfig(): ContextBasePublicConfig {
    return {
      enabled: this.config.enabled,
      manualText: this.config.manualText,
      files: this.config.files.map(toPublicFile),
      updatedAt: this.config.updatedAt,
    };
  }

  public setEnabled(enabled: boolean): ContextBasePublicConfig {
    this.config.enabled = enabled;
    this.touch();
    this.saveConfig();
    return this.getPublicConfig();
  }

  public setManualText(text: string): ContextBasePublicConfig {
    this.config.manualText = (text || '').slice(0, MAX_MANUAL_TEXT_CHARS);
    this.touch();
    this.saveConfig();
    this.refreshChunkCache();
    return this.getPublicConfig();
  }

  public async addFiles(filePaths: string[]): Promise<{ results: AddContextFileResult[]; config: ContextBasePublicConfig }> {
    const results: AddContextFileResult[] = [];

    for (const sourcePath of filePaths) {
      try {
        const stat = await fs.promises.stat(sourcePath);
        if (!stat.isFile()) {
          results.push({ filePath: sourcePath, success: false, error: 'Not a file' });
          continue;
        }

        const fileId = randomUUID();
        const originalName = path.basename(sourcePath);
        const ext = path.extname(originalName).toLowerCase();
        const mimeType = MIME_BY_EXTENSION[ext] || 'application/octet-stream';
        const managedName = `${fileId}${ext}`;
        const managedPath = path.join(this.filesDir, managedName);

        await fs.promises.copyFile(sourcePath, managedPath);

        const now = Date.now();
        const fileRecord: ContextFileRecord = {
          id: fileId,
          name: originalName,
          localPath: managedPath,
          mimeType,
          sizeBytes: stat.size,
          enabled: true,
          parseStatus: 'processing',
          extractedText: '',
          extractedChars: 0,
          createdAt: now,
          updatedAt: now,
          geminiRemote: { status: 'pending' },
        };

        this.config.files.push(fileRecord);

        try {
          const extracted = await this.extractText(managedPath, ext);
          if (extracted === null) {
            fileRecord.parseStatus = 'gemini-only';
            fileRecord.extractedText = '';
            fileRecord.extractedChars = 0;
          } else {
            const normalized = this.normalizeText(extracted).slice(0, MAX_EXTRACTED_TEXT_CHARS);
            fileRecord.parseStatus = 'ready';
            fileRecord.extractedText = normalized;
            fileRecord.extractedChars = normalized.length;
          }
        } catch (parseError: any) {
          fileRecord.parseStatus = 'error';
          fileRecord.parseError = parseError?.message || 'Failed to parse file';
          fileRecord.extractedText = '';
          fileRecord.extractedChars = 0;
        }

        fileRecord.updatedAt = Date.now();
        results.push({ filePath: sourcePath, success: true, fileId });
      } catch (error: any) {
        results.push({ filePath: sourcePath, success: false, error: error?.message || 'Failed to add file' });
      }
    }

    this.touch();
    this.saveConfig();
    this.refreshChunkCache();
    void this.refreshGeminiSyncForEligibleFiles();
    return { results, config: this.getPublicConfig() };
  }

  public async removeFile(fileId: string): Promise<ContextBasePublicConfig> {
    const file = this.config.files.find((f) => f.id === fileId);
    if (!file) return this.getPublicConfig();

    if (file.geminiRemote?.name) {
      void this.deleteGeminiRemoteFile(file.geminiRemote.name);
    }

    try {
      if (fs.existsSync(file.localPath)) {
        await fs.promises.unlink(file.localPath);
      }
    } catch {
      // best effort local cleanup
    }

    this.config.files = this.config.files.filter((f) => f.id !== fileId);
    this.touch();
    this.saveConfig();
    this.refreshChunkCache();
    return this.getPublicConfig();
  }

  public toggleFile(fileId: string, enabled: boolean): ContextBasePublicConfig {
    const file = this.config.files.find((f) => f.id === fileId);
    if (!file) return this.getPublicConfig();
    file.enabled = enabled;
    file.updatedAt = Date.now();
    this.touch();
    this.saveConfig();
    this.refreshChunkCache();
    return this.getPublicConfig();
  }

  public async refreshGeminiSyncForEligibleFiles(): Promise<void> {
    this.markExpiredGeminiFiles();
    const key = CredentialsManager.getInstance().getGeminiApiKey();
    if (!key) return;

    const files = this.config.files.filter((f) => f.enabled);
    for (const file of files) {
      if (file.geminiRemote.status === 'synced' && file.geminiRemote.expiresAt && file.geminiRemote.expiresAt > Date.now()) {
        continue;
      }
      await this.ensureGeminiUpload(file.id, false);
    }
  }

  public async markGeminiPartsStale(fileIds: string[], errorMessage?: string): Promise<void> {
    let changed = false;
    for (const fileId of fileIds) {
      const file = this.config.files.find((f) => f.id === fileId);
      if (!file) continue;
      file.geminiRemote.status = 'expired';
      file.geminiRemote.lastError = errorMessage || 'Gemini rejected file reference';
      file.updatedAt = Date.now();
      changed = true;
      void this.ensureGeminiUpload(fileId, true);
    }
    if (changed) {
      this.touch();
      this.saveConfig();
    }
  }

  public async buildInjection(
    query: string,
    options?: { includeGeminiFiles?: boolean; maxChars?: number; maxChunks?: number }
  ): Promise<ContextInjectionResult> {
    if (!this.config.enabled) {
      return { geminiFileParts: [] };
    }

    this.markExpiredGeminiFiles();

    const maxChars = options?.maxChars ?? MAX_CONTEXT_CHARS;
    const maxChunks = options?.maxChunks ?? MAX_CONTEXT_CHUNKS;
    const includeGeminiFiles = !!options?.includeGeminiFiles;
    const queryTerms = this.tokenize(query);
    const queryLower = (query || '').toLowerCase();

    const scored = this.chunksCache
      .map((chunk) => {
        let overlap = 0;
        for (const term of queryTerms) {
          const freq = chunk.terms.get(term) || 0;
          if (freq > 0) overlap += 1 + Math.min(2, freq - 1) * 0.2;
        }
        const base = queryTerms.length > 0 ? overlap / queryTerms.length : 0;
        const phraseBonus = queryLower.length >= 10 && chunk.text.toLowerCase().includes(queryLower) ? 0.35 : 0;
        const sourceBonus = chunk.sourceType === 'manual' ? 0.05 : 0;
        return { chunk, score: base + phraseBonus + sourceBonus };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    const selectedChunks: InternalChunk[] = [];
    const selectedFileIds: string[] = [];
    let totalChars = 0;

    for (const entry of scored) {
      if (selectedChunks.length >= maxChunks) break;
      const textLen = entry.chunk.text.length;
      if (totalChars + textLen > maxChars) continue;
      selectedChunks.push(entry.chunk);
      totalChars += textLen;
      if (entry.chunk.sourceType === 'file' && !selectedFileIds.includes(entry.chunk.sourceId)) {
        selectedFileIds.push(entry.chunk.sourceId);
      }
    }

    // If no lexical match but manual text exists, still provide a tiny generic context.
    if (selectedChunks.length === 0 && this.config.manualText.trim().length > 0) {
      selectedChunks.push({
        sourceId: 'manual',
        sourceName: 'Manual Context',
        sourceType: 'manual',
        text: this.config.manualText.slice(0, Math.min(1_000, maxChars)),
        terms: this.computeTermMap(this.config.manualText),
      });
    }

    const contextBlock = selectedChunks.length > 0
      ? [
          '<context_base>',
          'User-provided knowledge. Use only when relevant. If irrelevant, ignore.',
          '',
          ...selectedChunks.map((c) => `[Source: ${c.sourceName}]\n${c.text}`),
          '</context_base>',
        ].join('\n')
      : undefined;

    const geminiFileParts: ContextInjectionFilePart[] = [];
    if (includeGeminiFiles) {
      const filesByPriority = this.getGeminiFileCandidates(selectedFileIds);
      for (const file of filesByPriority) {
        if (geminiFileParts.length >= MAX_GEMINI_FILE_PARTS) break;
        if (file.geminiRemote.status === 'synced' && file.geminiRemote.uri) {
          geminiFileParts.push({
            fileId: file.id,
            name: file.name,
            uri: file.geminiRemote.uri,
            mimeType: file.geminiRemote.mimeType || file.mimeType,
          });
        } else if (file.enabled) {
          void this.ensureGeminiUpload(file.id, file.geminiRemote.status === 'expired');
        }
      }
    }

    return { contextBlock, geminiFileParts };
  }

  private getGeminiFileCandidates(priorityFileIds: string[]): ContextFileRecord[] {
    const byId = new Map(this.config.files.map((f) => [f.id, f]));
    const ordered: ContextFileRecord[] = [];
    for (const id of priorityFileIds) {
      const file = byId.get(id);
      if (file && file.enabled) ordered.push(file);
    }
    for (const file of this.config.files) {
      if (!file.enabled) continue;
      if (!ordered.find((f) => f.id === file.id)) {
        ordered.push(file);
      }
    }
    return ordered;
  }

  private async ensureGeminiUpload(fileId: string, force: boolean): Promise<void> {
    const existingPending = this.pendingUploadByFileId.get(fileId);
    if (existingPending) {
      await existingPending;
      return;
    }

    const file = this.config.files.find((f) => f.id === fileId);
    if (!file || !file.enabled) return;

    const key = CredentialsManager.getInstance().getGeminiApiKey();
    if (!key) {
      file.geminiRemote.status = 'pending';
      file.geminiRemote.lastError = 'Gemini API key not configured';
      file.updatedAt = Date.now();
      this.touch();
      this.saveConfig();
      return;
    }

    if (!force && file.geminiRemote.status === 'synced' && file.geminiRemote.expiresAt && file.geminiRemote.expiresAt > Date.now()) {
      return;
    }

    const uploadPromise = (async () => {
      file.geminiRemote.status = 'uploading';
      file.geminiRemote.lastError = undefined;
      file.updatedAt = Date.now();
      this.touch();
      this.saveConfig();

      try {
        const ai = new GoogleGenAI({ apiKey: key });
        const uploaded = await ai.files.upload({
          file: file.localPath,
          config: { mimeType: file.mimeType },
        });

        file.geminiRemote = {
          ...file.geminiRemote,
          status: 'synced',
          name: uploaded.name || file.geminiRemote.name,
          uri: uploaded.uri || file.geminiRemote.uri,
          mimeType: uploaded.mimeType || file.mimeType,
          uploadedAt: Date.now(),
          expiresAt: Date.now() + GEMINI_FILE_TTL_MS,
          lastError: undefined,
        };
      } catch (error: any) {
        file.geminiRemote.status = 'error';
        file.geminiRemote.lastError = error?.message || 'Failed to upload to Gemini';
      }

      file.updatedAt = Date.now();
      this.touch();
      this.saveConfig();
    })();

    this.pendingUploadByFileId.set(fileId, uploadPromise);
    try {
      await uploadPromise;
    } finally {
      this.pendingUploadByFileId.delete(fileId);
    }
  }

  private async deleteGeminiRemoteFile(fileName: string): Promise<void> {
    const key = CredentialsManager.getInstance().getGeminiApiKey();
    if (!key) return;
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      await ai.files.delete({ name: fileName });
    } catch {
      // best effort remote cleanup
    }
  }

  private ensureStorage(): void {
    if (!fs.existsSync(this.contextDir)) {
      fs.mkdirSync(this.contextDir, { recursive: true });
    }
    if (!fs.existsSync(this.filesDir)) {
      fs.mkdirSync(this.filesDir, { recursive: true });
    }
  }

  private loadConfig(): void {
    if (!fs.existsSync(this.configPath)) {
      this.config = defaultConfig();
      this.saveConfig();
      return;
    }

    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw) as ContextBaseConfig;
      this.config = {
        enabled: parsed.enabled ?? true,
        manualText: (parsed.manualText || '').slice(0, MAX_MANUAL_TEXT_CHARS),
        files: (parsed.files || []).map((file) => ({
          ...file,
          enabled: file.enabled !== false,
          extractedText: file.extractedText || '',
          extractedChars: file.extractedChars || 0,
          geminiRemote: {
            status: file.geminiRemote?.status || 'pending',
            name: file.geminiRemote?.name,
            uri: file.geminiRemote?.uri,
            mimeType: file.geminiRemote?.mimeType,
            uploadedAt: file.geminiRemote?.uploadedAt,
            expiresAt: file.geminiRemote?.expiresAt,
            lastError: file.geminiRemote?.lastError,
          },
        })),
        updatedAt: parsed.updatedAt || Date.now(),
      };
    } catch {
      this.config = defaultConfig();
      this.saveConfig();
    }
  }

  private saveConfig(): void {
    const payload: ContextBaseConfig = {
      ...this.config,
      manualText: this.config.manualText.slice(0, MAX_MANUAL_TEXT_CHARS),
    };

    const tmpPath = `${this.configPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.configPath);
  }

  private touch(): void {
    this.config.updatedAt = Date.now();
  }

  private markExpiredGeminiFiles(): void {
    const now = Date.now();
    let changed = false;
    for (const file of this.config.files) {
      if (file.geminiRemote.status === 'synced' && file.geminiRemote.expiresAt && file.geminiRemote.expiresAt <= now) {
        file.geminiRemote.status = 'expired';
        file.updatedAt = now;
        changed = true;
      }
    }
    if (changed) {
      this.touch();
      this.saveConfig();
    }
  }

  private refreshChunkCache(): void {
    const chunks: InternalChunk[] = [];
    const manual = this.normalizeText(this.config.manualText);
    if (manual.trim().length > 0) {
      for (const text of this.chunkText(manual)) {
        chunks.push({
          sourceId: 'manual',
          sourceName: 'Manual Context',
          sourceType: 'manual',
          text,
          terms: this.computeTermMap(text),
        });
      }
    }

    for (const file of this.config.files) {
      if (!file.enabled) continue;
      if (file.parseStatus !== 'ready') continue;
      const extracted = this.normalizeText(file.extractedText || '');
      if (!extracted) continue;
      for (const text of this.chunkText(extracted)) {
        chunks.push({
          sourceId: file.id,
          sourceName: file.name,
          sourceType: 'file',
          text,
          terms: this.computeTermMap(text),
        });
      }
    }

    this.chunksCache = chunks;
  }

  private chunkText(text: string): string[] {
    const maxLen = 900;
    const overlap = 120;
    const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const chunks: string[] = [];
    let current = '';

    for (const para of paragraphs) {
      if (!current) {
        current = para;
        continue;
      }
      if (current.length + 2 + para.length <= maxLen) {
        current = `${current}\n\n${para}`;
        continue;
      }
      chunks.push(current);
      const tail = current.slice(Math.max(0, current.length - overlap));
      current = `${tail}\n\n${para}`.slice(0, maxLen);
    }

    if (current.trim()) chunks.push(current.trim());

    // If paragraph splitting produced no chunk (single long line), hard-split.
    if (chunks.length === 0 && text.trim().length > 0) {
      let i = 0;
      while (i < text.length) {
        const part = text.slice(i, i + maxLen);
        if (part.trim()) chunks.push(part.trim());
        i += maxLen - overlap;
      }
    }

    return chunks;
  }

  private tokenize(input: string): string[] {
    return (input || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  }

  private computeTermMap(text: string): Map<string, number> {
    const map = new Map<string, number>();
    for (const token of this.tokenize(text)) {
      map.set(token, (map.get(token) || 0) + 1);
    }
    return map;
  }

  private normalizeText(text: string): string {
    return (text || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private async extractText(filePath: string, extension: string): Promise<string | null> {
    if (extension === '.pdf') {
      const buffer = await fs.promises.readFile(filePath);
      const mod = await import('pdf-parse');

      // pdf-parse v2 exports a PDFParse class. Keep a legacy fallback for v1-style function export.
      const PDFParseCtor = (mod as any).PDFParse || (mod as any).default?.PDFParse;
      if (typeof PDFParseCtor === 'function') {
        const parser = new PDFParseCtor({ data: new Uint8Array(buffer) });
        try {
          const parsed = await parser.getText();
          return parsed?.text || '';
        } finally {
          if (typeof parser.destroy === 'function') {
            await parser.destroy().catch(() => {});
          }
        }
      }

      const legacyParser = (mod as any).default || mod;
      if (typeof legacyParser === 'function') {
        const parsed = await legacyParser(buffer);
        return parsed?.text || '';
      }

      throw new Error('Unsupported pdf-parse module format');
    }

    if (extension === '.docx') {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return result?.value || '';
    }

    if (['.txt', '.md', '.json', '.csv'].includes(extension)) {
      return fs.promises.readFile(filePath, 'utf-8');
    }

    return null;
  }
}
