import { Model } from '../types';

export const OpenrouterModels: Model[] = [
    {
        name: 'DeepSeek V4 Flash',
        id: 'deepseek/deepseek-v4-flash-0731',
        provider: 'openrouter',
        pricing: {
            input: 0.3,
            output: 0.6,
        },
    },
    {
        name: 'GLM 5.3 Flash',
        id: 'z-ai/glm-5.3-flash',
        provider: 'openrouter',
        pricing: {
            input: 0.4,
            output: 0.8,
        },
    },
    {
        name: 'Qwen 3.8 Flash',
        id: 'qwen/qwen3.8-flash',
        provider: 'openrouter',
        pricing: {
            input: 0.3,
            output: 0.6,
        },
    },
];
