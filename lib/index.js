import { assertUsableApiKey, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { createHash } from 'node:crypto';
import { createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
export const name = 'opencode-zen-free-provider';
export const inject = ['llm'];
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const FALLBACK_OPENCODE_VERSION = '1.18.18';
const resolveOpenCodeVersion = async () => {
    try {
        const payload = await fetchJson('https://data.jsdelivr.com/v1/packages/npm/opencode-ai/resolved', {
            accept: 'application/json',
        });
        return typeof payload.version === 'string' && payload.version.length > 0
            ? payload.version
            : FALLBACK_OPENCODE_VERSION;
    }
    catch {
        return FALLBACK_OPENCODE_VERSION;
    }
};
const opencodeId = (prefix, value) => {
    const digest = createHash('sha256').update(`dsh-opencode-${prefix}\0${value}`).digest();
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let number = BigInt(`0x${digest.toString('hex')}`);
    let encoded = '';
    while (number > 0) {
        encoded = alphabet[Number(number % 62n)] + encoded;
        number /= 62n;
    }
    while (encoded.length < 14)
        encoded = `0${encoded}`;
    return `${prefix}_${digest.toString('hex').slice(0, 12)}${encoded.slice(0, 14)}`;
};
const lastUserContent = (context) => {
    for (let index = context.messages.length - 1; index >= 0; index -= 1) {
        const message = context.messages[index];
        if (message.role !== 'user')
            continue;
        if (typeof message.content === 'string')
            return message.content;
        return message.content.map(part => part.type === 'text' ? part.text : part.data).join('\0');
    }
    return '';
};
const zenApi = (() => {
    const api = openAICompletionsApi();
    return {
        ...api,
        streamSimple: (model, context, options) => {
            const sessionId = options.sessionId ?? 'dsh-session-unknown';
            const requestSeed = `${sessionId}\0${lastUserContent(context)}`;
            const headers = {
                ...model.headers,
                'HTTP-Referer': 'https://opencode.ai',
                'x-opencode-project': 'global',
                'x-opencode-session': opencodeId('ses', sessionId),
                'x-opencode-request': opencodeId('msg', requestSeed),
                'x-opencode-client': 'cli',
            };
            return api.streamSimple({ ...model, headers }, context, options);
        },
    };
})();
async function fetchJson(url, headers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
        const response = await fetch(url, { headers, signal: controller.signal });
        if (!response.ok)
            throw new Error(`${url}: HTTP ${response.status}`);
        const payload = await response.json();
        if (!isRecord(payload))
            throw new Error(`${url}: unexpected response shape`);
        return payload;
    }
    finally {
        clearTimeout(timer);
    }
}
export async function apply(ctx) {
    const opencodeVersion = await resolveOpenCodeVersion();
    const opencodeUserAgent = `opencode/${opencodeVersion}`;
    const [zen, modelsDev] = await Promise.all([
        fetchJson('https://opencode.ai/zen/v1/models', {
            'User-Agent': opencodeUserAgent,
            accept: 'application/json',
        }),
        fetchJson('https://models.dev/api.json', { accept: 'application/json' }),
    ]);
    if (!Array.isArray(zen.data))
        throw new Error('zen models: unexpected response shape');
    if (!isRecord(modelsDev.opencode) || !isRecord(modelsDev.opencode.models)) {
        throw new Error('models.dev: no "opencode" provider');
    }
    const modelsById = modelsDev.opencode.models;
    const models = zen.data
        .filter((entry) => isRecord(entry) && typeof entry.id === 'string' && entry.id.endsWith('-free'))
        .flatMap((entry) => {
        const id = entry.id;
        const metadata = modelsById[id];
        if (!isRecord(metadata))
            return [];
        const option = (Array.isArray(metadata.reasoning_options) ? metadata.reasoning_options : [])
            .find(value => isRecord(value) && value.type === 'effort');
        const efforts = isRecord(option) && Array.isArray(option.values)
            ? option.values.filter((value) => typeof value === 'string')
            : [];
        const thinkingLevelMap = { off: 'none' };
        for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
            thinkingLevelMap[level] = efforts.length === 0 || efforts.includes(level) ? level : null;
        }
        const limit = isRecord(metadata.limit) ? metadata.limit : undefined;
        const input = isRecord(metadata.modalities) && Array.isArray(metadata.modalities.input)
            ? metadata.modalities.input.filter((value) => value === 'text' || value === 'image')
            : [];
        return [{
                id,
                name: typeof metadata.name === 'string' ? metadata.name : id,
                api: 'openai-completions',
                provider: name,
                baseUrl: 'https://opencode.ai/zen/v1',
                headers: { 'User-Agent': opencodeUserAgent, 'HTTP-Referer': 'https://opencode.ai' },
                reasoning: true,
                thinkingLevelMap,
                input: input.length > 0 ? input : ['text'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: id === 'deepseek-v4-flash-free' ? 1_048_576
                    : typeof limit?.context === 'number' ? limit.context : 1_048_576,
                maxTokens: typeof limit?.output === 'number' ? limit.output : 32_768,
            }];
    });
    if (models.length === 0)
        throw new Error('no OpenCode Zen free models resolved');
    ctx.logger.info('[%s] synced %d free model(s): %s', name, models.length, models.map(model => model.id).join(', '));
    const adapter = new PiAiAdapter({
        profiles: () => new Map([[name, {
                    provider: name,
                    displayName: 'OpenCode Zen Free',
                    apiKeyEnv: credentialRef('OPENCODE_ZEN_FREE_API_KEY'),
                    streamIdleTimeoutMs: 300_000,
                    retryPolicy: resolveRetryPolicy(undefined, `${name}: retryPolicy`),
                    piProvider: createProvider({
                        id: name,
                        name: 'OpenCodeZenFree',
                        baseUrl: 'https://opencode.ai/zen/v1',
                        auth: { apiKey: { name: 'OpenCodeZenFree', resolve: ({ credential }) => Promise.resolve({
                                    auth: credential?.key === undefined ? {} : { apiKey: credential.key },
                                    source: 'OpenCodeZenFree',
                                }) } },
                        models,
                        api: zenApi,
                    }),
                    configuredMaxTokens: new Map(),
                }]]),
        resolveApiKey: async (_provider, profile) => {
            const credentials = ctx.get('credentials');
            if (credentials !== undefined) {
                const hit = await credentials.resolve(profile.apiKeyEnv);
                if (hit !== undefined)
                    return assertUsableApiKey(hit.value, name, String(profile.apiKeyEnv));
            }
            // OpenCode Zen accepts the public route without a user API key.
            return 'public';
        },
    });
    ctx.llm.registerAdapter([name], adapter);
}
