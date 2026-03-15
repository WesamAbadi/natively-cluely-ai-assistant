import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check } from 'lucide-react';

interface KeyRecorderProps {
    currentKeys: string[];
    onSave: (keys: string[]) => void;
    className?: string;
}

export const KeyRecorder: React.FC<KeyRecorderProps> = ({ currentKeys, onSave, className }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
    const inputRef = useRef<HTMLDivElement>(null);

    const isMacPlatform = useCallback(() => {
        if (typeof navigator === 'undefined') return false;
        return /Mac|iPod|iPhone|iPad/i.test(navigator.platform);
    }, []);

    const getMetaLabel = useCallback(() => {
        return isMacPlatform() ? '⌘' : '⊞';
    }, [isMacPlatform]);

    useEffect(() => {
        if (isRecording && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isRecording]);

    useEffect(() => {
        if (!isRecording) return;

        const handleMouseDown = (event: MouseEvent) => {
            if (inputRef.current && !inputRef.current.contains(event.target as Node)) {
                setIsRecording(false);
                setRecordedKeys([]);
            }
        };

        const handleWindowKeyDown = (event: KeyboardEvent) => {
            handleCapturedEvent(event);
        };

        document.addEventListener('mousedown', handleMouseDown, true);
        window.addEventListener('keydown', handleWindowKeyDown, true);

        return () => {
            document.removeEventListener('mousedown', handleMouseDown, true);
            window.removeEventListener('keydown', handleWindowKeyDown, true);
        };
    }, [isRecording]);

    const handleCapturedEvent = useCallback((e: {
        key: string;
        code: string;
        metaKey: boolean;
        ctrlKey: boolean;
        altKey: boolean;
        shiftKey: boolean;
        preventDefault: () => void;
        stopPropagation?: () => void;
    }) => {
        if (!isRecording) return;
        e.preventDefault();
        e.stopPropagation?.();

        const key = e.key;
        const code = e.code;
        const meta = e.metaKey;
        const ctrl = e.ctrlKey;
        const alt = e.altKey;
        const shift = e.shiftKey;

        // Ignore modifier key presses alone if possible, but we need to show them
        const modifiers = [];
        if (meta) modifiers.push(getMetaLabel());
        if (ctrl) modifiers.push('⌃');
        if (alt) modifiers.push('⌥');
        if (shift) modifiers.push('⇧');

        if (key === 'Escape') {
            setIsRecording(false);
            setRecordedKeys([]);
            return;
        }

        let mainKey = '';
        if (key !== 'Meta' && key !== 'Control' && key !== 'Alt' && key !== 'Shift') {
            if (code.startsWith('Key')) mainKey = code.slice(3).toUpperCase();
            else if (code.startsWith('Digit')) mainKey = code.slice(5);
            else if (code === 'Space') mainKey = 'Space';
            else if (key === 'Enter') mainKey = 'Enter';
            else if (key === 'Backspace') mainKey = 'Backspace';
            else if (key.startsWith('Arrow')) mainKey = key;
            else mainKey = key.toUpperCase();
        }

        if (mainKey) {
            setRecordedKeys([...modifiers, mainKey]);
            setIsRecording(false);
            onSave([...modifiers, mainKey]);
        } else {
            // Just modifiers pressed so far
            setRecordedKeys([...modifiers]);
        }
    }, [getMetaLabel, isRecording, onSave]);

    return (
        <div
            className={`relative flex items-center gap-1.5 cursor-pointer group ${className || ''}`}
            onClick={() => {
                setRecordedKeys([]);
                setIsRecording(true);
            }}
        >
            {isRecording ? (
                <div
                    ref={inputRef}
                    tabIndex={0}
                    className="flex items-center gap-1 bg-bg-input border border-accent-primary text-accent-primary px-2 py-1 rounded-md text-xs font-sans shadow-sm outline-none min-w-[60px] justify-center"
                >
                    {recordedKeys.length > 0 ? recordedKeys.join(' + ') : 'Press keys...'}
                </div>
            ) : (
                <div className="flex items-center gap-1">
                    {currentKeys.map((k, i) => {
                        let displayKey = k;
                        if (k === 'ArrowUp') displayKey = '↑';
                        else if (k === 'ArrowDown') displayKey = '↓';
                        else if (k === 'ArrowLeft') displayKey = '←';
                        else if (k === 'ArrowRight') displayKey = '→';

                        return (
                            <span key={i} className="bg-bg-input text-text-secondary h-6 min-w-[26px] px-1.5 rounded-md text-xs font-sans flex items-center justify-center shadow-sm border border-border-subtle group-hover:border-text-tertiary transition-colors">
                                {displayKey}
                            </span>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
