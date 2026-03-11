import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_WHAT_TO_ANSWER_PROMPT, EXAM_WHAT_TO_ANSWER_PROMPT } from "./prompts";
import { TemporalContext } from "./TemporalContextBuilder";
import { IntentResult } from "./IntentClassifier";

export class WhatToAnswerLLM {
    private llmHelper: LLMHelper;
    private examMode: boolean = false;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    setExamMode(enabled: boolean): void {
        this.examMode = enabled;
        console.log(`[WhatToAnswerLLM] Exam mode: ${enabled}`);
    }

    getExamMode(): boolean {
        return this.examMode;
    }

    // Deprecated non-streaming method (redirect to streaming or implement if needed)
    async generate(cleanedTranscript: string): Promise<string> {
        // Simple wrapper around stream
        const stream = this.generateStream(cleanedTranscript);
        let full = "";
        for await (const chunk of stream) full += chunk;
        return full;
    }

    async *generateStream(
        cleanedTranscript: string,
        temporalContext?: TemporalContext,
        intentResult?: IntentResult,
        imagePath?: string
    ): AsyncGenerator<string> {
        try {
            // Build a rich message context
            // Note: We can't easily inject the complex temporal/intent logic into universal prompt *variables* 
            // but we can prepend it to the message.

            let contextParts: string[] = [];

            if (intentResult) {
                contextParts.push(`<intent_and_shape>
DETECTED INTENT: ${intentResult.intent}
ANSWER SHAPE: ${intentResult.answerShape}
</intent_and_shape>`);
            }

            if (temporalContext && temporalContext.hasRecentResponses) {
                // ... simplify temporal context injection for universal prompt ...
                // Just dump it in context if possible
                const history = temporalContext.previousResponses.map((r, i) => `${i + 1}. "${r}"`).join('\n');
                contextParts.push(`PREVIOUS RESPONSES (Avoid Repetition):\n${history}`);
            }

            const extraContext = contextParts.join('\n\n');
            const fullMessage = extraContext
                ? `${extraContext}\n\nCONVERSATION:\n${cleanedTranscript}`
                : cleanedTranscript;

            // Select prompt based on exam mode
            let systemPrompt = UNIVERSAL_WHAT_TO_ANSWER_PROMPT;
            if (this.examMode) {
                const { CredentialsManager } = require('../services/CredentialsManager');
                const customPrompt = CredentialsManager.getInstance().getExamModePrompt();
                systemPrompt = customPrompt && customPrompt.trim().length > 0
                    ? customPrompt
                    : EXAM_WHAT_TO_ANSWER_PROMPT;
            }

            yield* this.llmHelper.streamChat(fullMessage, imagePath, undefined, systemPrompt);

        } catch (error) {
            console.error("[WhatToAnswerLLM] Stream failed:", error);
            yield "Could you repeat that? I want to make sure I address your question properly.";
        }
    }
}
