import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, Cloud, Terminal, Monitor, Server, Plus } from 'lucide-react';

interface ModelSelectorProps {
    currentModel: string;
    onSelectModel: (model: string) => void;
}

interface CustomProvider {
    id: string;
    name: string;
    curlCommand: string;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({ currentModel, onSelectModel }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'cloud' | 'custom' | 'local'>('cloud');
    const [ollamaModels, setOllamaModels] = useState<string[]>([]);
    const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Load Data
    useEffect(() => {
        if (!isOpen) return;

        const loadData = async () => {
            try {
                // Load Custom
                const custom = await window.electronAPI?.getCustomProviders() as CustomProvider[];
                if (custom) setCustomProviders(custom);

                // Load Ollama
                const local = await window.electronAPI?.getAvailableOllamaModels() as string[];
                if (local) setOllamaModels(local);
            } catch (e) {
                console.error("Failed to load models:", e);
            }
        };
        loadData();
    }, [isOpen]);

    const handleSelect = (model: string) => {
        // For custom/local, we might need to pass an ID or specific format
        // The backend logic (LLMHelper) needs to know how to handle this string or we need a richer object
        // For now, consistent with existing app, we pass a string. 
        // We'll rely on a prefix convention or just the name if unique enough, 
        // OR the app state handling this selection needs to store provider type.
        // Assuming onSelectModel handles the switching logic.

        onSelectModel(model);
        setIsOpen(false);
    };

    const getModelDisplayName = (model: string) => {
        if (model.startsWith('ollama-')) return model.replace('ollama-', '');
        if (model === 'gemini-3-flash-preview') return 'Gemini 3 Flash';
        if (model === 'gemini-3-pro-preview') return 'Gemini 3 Pro';
        if (model === 'gemini-3.1-flash-lite-preview-06-17' || model === 'gemini-3.1-flash-lite-preview') return 'Gemini 3.1 Flash-Lite';
        if (model === 'llama-3.3-70b-versatile') return 'Groq Llama 3.3';
        if (model === 'gpt-5.2-chat-latest') return 'GPT 5.2';
        if (model === 'claude-sonnet-4-5') return 'Sonnet 4.5';

        // Check custom providers
        const custom = customProviders.find(p => p.id === model || p.name === model);
        if (custom) return custom.name;

        return model;
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-1.5 bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-lg transition-colors text-xs font-medium text-text-primary max-w-[150px]"
            >
                <span className="truncate">{getModelDisplayName(currentModel)}</span>
                <ChevronDown size={14} className={`shrink-0 text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-64 bg-bg-item-surface border border-border-subtle rounded-xl shadow-xl z-50 overflow-hidden animated fadeIn">
                    {/* Tabs */}
                    <div className="flex border-b border-border-subtle bg-bg-input/50">
                        <button
                            onClick={() => setActiveTab('cloud')}
                            className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${activeTab === 'cloud' ? 'text-accent-primary bg-bg-item-surface border-t-2 border-t-accent-primary' : 'text-text-secondary hover:text-text-primary'}`}
                        >
                            Cloud
                        </button>
                        <button
                            onClick={() => setActiveTab('custom')}
                            className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${activeTab === 'custom' ? 'text-accent-primary bg-bg-item-surface border-t-2 border-t-accent-primary' : 'text-text-secondary hover:text-text-primary'}`}
                        >
                            Custom
                        </button>
                        <button
                            onClick={() => setActiveTab('local')}
                            className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${activeTab === 'local' ? 'text-accent-primary bg-bg-item-surface border-t-2 border-t-accent-primary' : 'text-text-secondary hover:text-text-primary'}`}
                        >
                            Local
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-2 max-h-64 overflow-y-auto">

                        {/* Cloud Models */}
                        {activeTab === 'cloud' && (
                            <div className="space-y-1">
                                <ModelOption
                                    id="gemini-3-flash-preview"
                                    name="Gemini 3 Flash"
                                    desc="Fastest • Multimodal"
                                    icon={<Monitor size={14} />}
                                    selected={currentModel === 'gemini-3-flash-preview'}
                                    onSelect={() => handleSelect('gemini-3-flash-preview')}
                                />
                                <ModelOption
                                    id="gemini-3-pro-preview"
                                    name="Gemini 3 Pro"
                                    desc="Reasoning • High Quality"
                                    icon={<Monitor size={14} />}
                                    selected={currentModel === 'gemini-3-pro-preview'}
                                    onSelect={() => handleSelect('gemini-3-pro-preview')}
                                />
                                <ModelOption
                                    id="gemini-3.1-flash-lite-preview-06-17"
                                    name="Gemini 3.1 Flash-Lite"
                                    desc="Low latency • Preview"
                                    icon={<Monitor size={14} />}
                                    selected={currentModel === 'gemini-3.1-flash-lite-preview-06-17' || currentModel === 'gemini-3.1-flash-lite-preview'}
                                    onSelect={() => handleSelect('gemini-3.1-flash-lite-preview-06-17')}
                                />
                                <div className="h-px bg-border-subtle my-1" />
                                <ModelOption
                                    id="gpt-5.2-chat-latest"
                                    name="GPT 5.2"
                                    desc="OpenAI"
                                    icon={<Cloud size={14} />}
                                    selected={currentModel === 'gpt-5.2-chat-latest'}
                                    onSelect={() => handleSelect('gpt-5.2-chat-latest')}
                                />
                                <ModelOption
                                    id="claude-sonnet-4-5"
                                    name="Sonnet 4.5"
                                    desc="Anthropic"
                                    icon={<Cloud size={14} />}
                                    selected={currentModel === 'claude-sonnet-4-5'}
                                    onSelect={() => handleSelect('claude-sonnet-4-5')}
                                />
                                <ModelOption
                                    id="llama-3.3-70b-versatile"
                                    name="Groq Llama 3.3"
                                    desc="Ultra Fast"
                                    icon={<Cloud size={14} />}
                                    selected={currentModel === 'llama-3.3-70b-versatile'}
                                    onSelect={() => handleSelect('llama-3.3-70b-versatile')}
                                />
                            </div>
                        )}

                        {/* Custom Models */}
                        {activeTab === 'custom' && (
                            <div className="space-y-1">
                                {customProviders.length === 0 ? (
                                    <div className="text-center py-6 text-text-tertiary">
                                        <p className="text-xs mb-2">No custom providers.</p>
                                        <button className="text-[10px] text-accent-primary hover:underline">Manage in Settings</button>
                                    </div>
                                ) : (
                                    customProviders.map(provider => (
                                        <ModelOption
                                            key={provider.id}
                                            id={provider.id}
                                            name={provider.name}
                                            desc="Custom cURL"
                                            icon={<Terminal size={14} />}
                                            selected={currentModel === provider.id}
                                            onSelect={() => handleSelect(provider.id)}
                                        />
                                    ))
                                )}
                            </div>
                        )}

                        {/* Local Models (Ollama) */}
                        {activeTab === 'local' && (
                            <div className="space-y-1">
                                {ollamaModels.length === 0 ? (
                                    <div className="text-center py-6 text-text-tertiary">
                                        <p className="text-xs">No Ollama models found.</p>
                                        <p className="text-[10px] mt-1 opacity-70">Ensure Ollama is running.</p>
                                    </div>
                                ) : (
                                    ollamaModels.map(model => (
                                        <ModelOption
                                            key={model}
                                            id={`ollama-${model}`}
                                            name={model}
                                            desc="Local"
                                            icon={<Server size={14} />}
                                            selected={currentModel === `ollama-${model}`}
                                            onSelect={() => handleSelect(`ollama-${model}`)}
                                        />
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

interface ModelOptionProps {
    id: string;
    name: string;
    desc: string;
    icon: React.ReactNode;
    selected: boolean;
    onSelect: () => void;
}

const ModelOption: React.FC<ModelOptionProps> = ({ name, desc, icon, selected, onSelect }) => (
    <button
        onClick={onSelect}
        className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors group ${selected ? 'bg-accent-primary/10' : 'hover:bg-bg-input'}`}
    >
        <div className="flex items-center gap-3">
            <div className={`p-1.5 rounded-md ${selected ? 'bg-accent-primary/20 text-accent-primary' : 'bg-bg-elevated text-text-secondary group-hover:text-text-primary'}`}>
                {icon}
            </div>
            <div className="text-left">
                <div className={`text-xs font-medium truncate max-w-[140px] ${selected ? 'text-accent-primary' : 'text-text-primary'}`}>{name}</div>
                <div className="text-[10px] text-text-tertiary">{desc}</div>
            </div>
        </div>
        {selected && <Check size={14} className="text-accent-primary" />}
    </button>
);
