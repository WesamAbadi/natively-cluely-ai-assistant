import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Cloud, RefreshCw, Trash2, Upload } from 'lucide-react';
import type { ContextBaseConfig, ContextFileRecord } from '../../types/electron';

const MANUAL_TEXT_LIMIT = 50_000;

const formatBytes = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const getParseBadge = (status: ContextFileRecord['parseStatus']): { label: string; className: string } => {
  if (status === 'ready') return { label: 'Ready', className: 'bg-green-500/10 text-green-500 border-green-500/25' };
  if (status === 'gemini-only') return { label: 'Gemini-only', className: 'bg-sky-500/10 text-sky-400 border-sky-500/25' };
  if (status === 'error') return { label: 'Parse failed', className: 'bg-red-500/10 text-red-400 border-red-500/25' };
  return { label: 'Processing', className: 'bg-amber-500/10 text-amber-400 border-amber-500/25' };
};

const getGeminiBadge = (status: ContextFileRecord['geminiStatus']): { label: string; className: string } => {
  if (status === 'synced') return { label: 'Synced', className: 'bg-green-500/10 text-green-500 border-green-500/25' };
  if (status === 'uploading') return { label: 'Uploading', className: 'bg-amber-500/10 text-amber-400 border-amber-500/25' };
  if (status === 'expired') return { label: 'Expired', className: 'bg-orange-500/10 text-orange-400 border-orange-500/25' };
  if (status === 'error') return { label: 'Error', className: 'bg-red-500/10 text-red-400 border-red-500/25' };
  return { label: 'Pending', className: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/25' };
};

export const ContextBaseSettings: React.FC = () => {
  const [config, setConfig] = useState<ContextBaseConfig | null>(null);
  const [manualTextDraft, setManualTextDraft] = useState('');
  const [baselineManualText, setBaselineManualText] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingEnabled, setSavingEnabled] = useState(false);
  const [savingText, setSavingText] = useState(false);
  const [addingFiles, setAddingFiles] = useState(false);
  const [refreshingSync, setRefreshingSync] = useState(false);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const hasUnsavedText = useMemo(() => manualTextDraft !== baselineManualText, [manualTextDraft, baselineManualText]);

  const loadConfig = async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const next = await window.electronAPI.contextGetConfig();
      setConfig(next);
      setManualTextDraft(next.manualText || '');
      setBaselineManualText(next.manualText || '');
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to load Context Base.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  const handleToggleEnabled = async () => {
    if (!config) return;
    setSavingEnabled(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      const next = await window.electronAPI.contextSetEnabled(!config.enabled);
      setConfig(next);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to update Context Base setting.');
    } finally {
      setSavingEnabled(false);
    }
  };

  const handleSaveText = async () => {
    if (!hasUnsavedText) return;
    setSavingText(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      const next = await window.electronAPI.contextUpdateText(manualTextDraft);
      setConfig(next);
      setManualTextDraft(next.manualText || '');
      setBaselineManualText(next.manualText || '');
      setStatusMessage('Manual context saved.');
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to save manual context.');
    } finally {
      setSavingText(false);
    }
  };

  const handleSelectAndAddFiles = async () => {
    setAddingFiles(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      const selected = await window.electronAPI.contextSelectFiles();
      if (selected?.cancelled || !selected?.paths || selected.paths.length === 0) return;
      const addResult = await window.electronAPI.contextAddFiles(selected.paths);
      setConfig(addResult.config);

      const failures = addResult.results.filter((entry) => !entry.success);
      if (failures.length > 0) {
        setStatusMessage(`Added ${addResult.results.length - failures.length}/${addResult.results.length} files.`);
        setErrorMessage(failures.map((entry) => `${entry.filePath}: ${entry.error || 'Failed'}`).join('\n'));
      } else {
        setStatusMessage(`Added ${addResult.results.length} files.`);
      }
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to add files.');
    } finally {
      setAddingFiles(false);
    }
  };

  const handleRemoveFile = async (fileId: string, fileName: string) => {
    if (!confirm(`Remove "${fileName}" from Context Base?`)) return;
    setBusyFileId(fileId);
    setErrorMessage('');
    setStatusMessage('');
    try {
      const next = await window.electronAPI.contextRemoveFile(fileId);
      setConfig(next);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to remove file.');
    } finally {
      setBusyFileId(null);
    }
  };

  const handleToggleFile = async (fileId: string, enabled: boolean) => {
    setBusyFileId(fileId);
    setErrorMessage('');
    setStatusMessage('');
    try {
      const next = await window.electronAPI.contextToggleFile(fileId, enabled);
      setConfig(next);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to update file state.');
    } finally {
      setBusyFileId(null);
    }
  };

  const handleRefreshGeminiSync = async () => {
    setRefreshingSync(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      const next = await window.electronAPI.contextRefreshGeminiSync();
      setConfig(next);
      setStatusMessage('Gemini sync refresh requested.');
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to refresh Gemini sync.');
    } finally {
      setRefreshingSync(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animated fadeIn h-full flex items-center justify-center">
        <div className="text-xs text-text-secondary flex items-center gap-2">
          <RefreshCw size={14} className="animate-spin" />
          Loading Context Base...
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="space-y-6 animated fadeIn">
        <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[11px] text-red-400 whitespace-pre-wrap">
          {errorMessage || 'Failed to load Context Base.'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animated fadeIn">
      <div>
        <h3 className="text-lg font-bold text-text-primary mb-1">Context Base</h3>
        <p className="text-xs text-text-secondary">
          Global context for all AI replies. Gemini uses File API attachments; other providers use retrieved text snippets.
        </p>
      </div>

      <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-text-primary">Enable Context Base</h4>
          <p className="text-xs text-text-secondary mt-0.5">Turn this off to disable all Context Base injection.</p>
        </div>
        <div
          onClick={() => { if (!savingEnabled) void handleToggleEnabled(); }}
          className={`w-11 h-6 rounded-full relative transition-colors ${savingEnabled ? 'opacity-50 cursor-wait bg-bg-toggle-switch' : config.enabled ? 'bg-accent-primary cursor-pointer' : 'bg-bg-toggle-switch border border-border-muted cursor-pointer'}`}
        >
          <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${config.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
        </div>
      </div>

      <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-text-primary">Manual Context Text</h4>
            <p className="text-xs text-text-secondary mt-0.5">Used for all providers via snippet retrieval.</p>
          </div>
          <button
            onClick={() => void handleSaveText()}
            disabled={!hasUnsavedText || savingText}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${!hasUnsavedText || savingText ? 'bg-bg-input text-text-tertiary border-border-subtle cursor-not-allowed' : 'bg-text-primary text-bg-main border-transparent hover:opacity-90'}`}
          >
            {savingText ? 'Saving...' : hasUnsavedText ? 'Save' : 'Saved'}
          </button>
        </div>
        <textarea
          value={manualTextDraft}
          onChange={(event) => setManualTextDraft(event.target.value.slice(0, MANUAL_TEXT_LIMIT))}
          placeholder="Add global notes, project details, goals, definitions, or reusable context..."
          maxLength={MANUAL_TEXT_LIMIT}
          className="w-full min-h-[140px] bg-bg-input border border-border-subtle rounded-lg p-3 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors resize-y"
        />
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-text-secondary">{manualTextDraft.length.toLocaleString()} / {MANUAL_TEXT_LIMIT.toLocaleString()} chars</span>
          {hasUnsavedText && <span className="text-amber-400">Unsaved changes</span>}
        </div>
      </div>

      <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-text-primary">Context Files</h4>
            <p className="text-xs text-text-secondary mt-0.5">Files are copied into app storage to keep references stable.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleRefreshGeminiSync()}
              disabled={refreshingSync}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-border-subtle ${refreshingSync ? 'bg-bg-input text-text-tertiary cursor-not-allowed' : 'bg-bg-input hover:bg-bg-elevated text-text-primary'}`}
            >
              {refreshingSync ? 'Refreshing...' : 'Refresh Sync'}
            </button>
            <button
              onClick={() => void handleSelectAndAddFiles()}
              disabled={addingFiles}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${addingFiles ? 'bg-bg-input text-text-tertiary cursor-not-allowed border border-border-subtle' : 'bg-text-primary text-bg-main hover:opacity-90'}`}
            >
              <span className="inline-flex items-center gap-1.5">
                {addingFiles ? <RefreshCw size={12} className="animate-spin" /> : <Upload size={12} />}
                Add Files
              </span>
            </button>
          </div>
        </div>

        {config.files.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-subtle p-4 text-xs text-text-secondary">
            No files added yet.
          </div>
        ) : (
          <div className="space-y-2">
            {config.files.map((file) => {
              const parseBadge = getParseBadge(file.parseStatus);
              const geminiBadge = getGeminiBadge(file.geminiStatus);
              const isBusy = busyFileId === file.id;

              return (
                <div key={file.id} className="rounded-lg border border-border-subtle bg-bg-input/40 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-text-primary truncate">{file.name}</div>
                      <div className="text-[11px] text-text-secondary mt-0.5">
                        {formatBytes(file.sizeBytes)} • {file.mimeType} • {file.extractedChars.toLocaleString()} extracted chars
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${parseBadge.className}`}>{parseBadge.label}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${geminiBadge.className}`}>{geminiBadge.label}</span>
                        {file.geminiExpiresAt && (
                          <span className="text-[10px] text-text-tertiary">
                            Expires: {new Date(file.geminiExpiresAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                      {file.parseError && (
                        <div className="mt-2 text-[11px] text-red-400 whitespace-pre-wrap">{file.parseError}</div>
                      )}
                      {file.geminiError && (
                        <div className="mt-1 text-[11px] text-orange-400 whitespace-pre-wrap">{file.geminiError}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div
                        onClick={() => { if (!isBusy) void handleToggleFile(file.id, !file.enabled); }}
                        className={`w-9 h-5 rounded-full relative transition-colors ${isBusy ? 'opacity-50 cursor-wait bg-bg-toggle-switch' : file.enabled ? 'bg-accent-primary cursor-pointer' : 'bg-bg-toggle-switch border border-border-muted cursor-pointer'}`}
                        title={file.enabled ? 'Disable for context injection' : 'Enable for context injection'}
                      >
                        <div className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white transition-transform ${file.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                      </div>
                      <button
                        onClick={() => void handleRemoveFile(file.id, file.name)}
                        disabled={isBusy}
                        className="p-1.5 rounded-md text-text-tertiary hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Remove file"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border-subtle bg-bg-item-surface p-4 space-y-2">
        <div className="flex items-center gap-2 text-text-primary text-xs font-semibold">
          <Cloud size={14} />
          How this works
        </div>
        <div className="text-[11px] text-text-secondary leading-relaxed space-y-1">
          <p>Gemini receives synced files through the File API plus retrieved text snippets.</p>
          <p>Other providers receive only retrieved snippets from manual text and locally parsed files.</p>
          <p>Unsupported local formats show as Gemini-only. Add key points to manual text for cross-provider use.</p>
        </div>
      </div>

      {(errorMessage || statusMessage) && (
        <div className={`px-4 py-3 rounded-lg text-[11px] whitespace-pre-wrap border ${errorMessage ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
          <div className="flex items-start gap-2">
            {errorMessage ? <AlertCircle size={14} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={14} className="shrink-0 mt-0.5" />}
            <span>{errorMessage || statusMessage}</span>
          </div>
        </div>
      )}
    </div>
  );
};

