/**
 * T-34: AI Copilot resilience against Groq HTTP 413 "Request too large ... TPM".
 * The full system prompt (schema + business rules + verified-training + custom-knowledge)
 * can exceed the small free-tier model's per-request token budget (8000 TPM), producing a 413.
 *  - a compacted buildSystemPromptLite() must exist (no training/custom-knowledge, terse schema)
 *  - callLlmApi must detect the 413/TPM-size error and retry ONCE with the lite prompt
 *  - the retry must be guarded so it cannot loop (isLitePrompt flag)
 *  - if even the lite prompt is rejected, a friendly Arabic 413 message must be thrown
 *  - the existing 429 model-fallback chain must preserve the lite flag
 *  - the normal (non-error) path must still send the FULL prompt first (quality unchanged)
 */
const fs = require('fs');
const path = require('path');

let pass = true;
const check = (name, cond) => { console.log(`  ${cond ? 'PASS' : 'FAIL'} - ${name}`); if (!cond) pass = false; };

const ai = fs.readFileSync(path.join(__dirname, '..', 'ai_assistant.js'), 'utf8');

// --- Lite prompt builder ---
check('buildSystemPromptLite() exists', /function buildSystemPromptLite\(\)\s*\{/.test(ai));
const liteBody = (ai.split('function buildSystemPromptLite')[1] || '').split('function ')[0];
check('lite prompt omits verified-training block', !!liteBody && !/readVerifiedTraining/.test(liteBody));
check('lite prompt omits customKnowledge block', !!liteBody && !/customKnowledge/.test(liteBody));

// --- 413 detection + single retry with lite prompt ---
check('detects 413 / TPM "too large" wording',
    /response\.status === 413 \|\| \/Request too large\|tokens per minute\|reduce your message size\/i/.test(ai));
check('retries once with buildSystemPromptLite() and isLitePrompt=true',
    /callLlmApi\(\s*buildSystemPromptLite\(\)\s*,\s*question\s*,\s*model\s*,\s*apiKeyOverride\s*,\s*true\s*\)/.test(ai));
check('retry guarded so it only fires when prompt was NOT already lite',
    /isTooLarge && !isLitePrompt/.test(ai));
check('friendly Arabic 413 message thrown when lite still rejected',
    /isTooLarge\)\s*\{[\s\S]{0,200}?throw new Error\('خطأ من خادم Groq \(413\)/.test(ai));

// --- callLlmApi signature + 429 chain preserves lite flag ---
check('callLlmApi signature carries isLitePrompt default',
    /async function callLlmApi\(prompt, question, modelOverride, apiKeyOverride, isLitePrompt = false\)/.test(ai));
check('429 120B->20B fallback preserves isLitePrompt',
    /'openai\/gpt-oss-20b', apiKeyOverride, isLitePrompt/.test(ai));
check('429 20B->Qwen fallback preserves isLitePrompt',
    /'qwen\/qwen3\.8-27b', apiKeyOverride, isLitePrompt/.test(ai));

// --- normal path unchanged: full prompt sent first ---
check('processQuestion still builds FULL prompt first',
    /const systemPrompt = buildSystemPrompt\(\);[\s\S]{0,160}?callLlmApi\(\s*systemPrompt/.test(ai));

console.log(pass ? '\nT-34: ALL CHECKS PASSED' : '\nT-34: FAILURES PRESENT');
process.exit(pass ? 0 : 1);
