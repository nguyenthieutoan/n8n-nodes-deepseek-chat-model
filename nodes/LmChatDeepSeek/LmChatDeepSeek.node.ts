import {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
	NodeConnectionTypes,
} from 'n8n-workflow';
import { logWrapper } from '@n8n/ai-utilities';
import { ChatDeepSeekCorrected } from './ChatDeepSeekCorrected';

export class LmChatDeepSeek implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DeepSeek Chat Model (Corrected)',
		name: 'lmChatDeepSeek',
		icon: 'file:deepseek.png',
		group: ['transform'],
		version: 1,
		description: 'Chat model node for DeepSeek with corrected thinking mode and tool support.',
		defaults: {
			name: 'DeepSeek Chat Model',
		},
		inputs: [],
		outputs: [
			{
				displayName: 'Model',
				type: NodeConnectionTypes.AiLanguageModel,
			},
		],
		credentials: [
			{
				name: 'deepseekApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Model Name',
				name: 'model',
				type: 'options',
				options: [
					{ name: 'deepseek-chat (DeepSeek-V3 / Default)', value: 'deepseek-chat' },
					{ name: 'deepseek-reasoner (DeepSeek-R1 / Thinking)', value: 'deepseek-reasoner' },
					{ name: 'deepseek-v4-pro (Xử lý tác vụ chuyên sâu)', value: 'deepseek-v4-pro' },
					{ name: 'deepseek-v4-flash (Tốc độ cao và tối ưu)', value: 'deepseek-v4-flash' },
					{ name: 'Custom / Other Model', value: 'custom' },
				],
				default: 'deepseek-chat',
				description: 'Select the DeepSeek model version to use.',
			},
			{
				displayName: 'Custom Model Name',
				name: 'customModel',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						model: ['custom'],
					},
				},
				description: 'Enter a custom model name if not listed.',
			},
			{
				displayName: 'Bật Chế độ Tư duy (Thinking Mode)',
				name: 'thinkingEnabled',
				type: 'boolean',
				default: true,
				description: 'Enable internal chain-of-thought thinking before responding.',
			},
			{
				displayName: 'Nỗ lực Suy luận (Thinking Effort)',
				name: 'thinkingEffort',
				type: 'options',
				displayOptions: {
					show: {
						thinkingEnabled: [true],
					},
				},
				options: [
					{ name: 'Cao (Mặc định cho hầu hết kịch bản)', value: 'high' },
					{ name: 'Tối đa (Dành cho logic lập trình và tác nhân phức tạp)', value: 'max' },
				],
				default: 'high',
				description: 'Adjust resource depth for thinking processes.',
			},
			{
				displayName: 'Maximum Output Tokens',
				name: 'maxTokens',
				type: 'number',
				default: 4096,
				description: 'The maximum number of tokens to generate, including thinking tokens.',
			},
			{
				displayName: 'Nhiệt độ (Temperature)',
				name: 'temperature',
				type: 'number',
				typeOptions: {
					minValue: 0,
					maxValue: 2,
				},
				default: 1,
				displayOptions: {
					show: {
						thinkingEnabled: [false],
					},
				},
				description: 'Adjust execution creativity. Disabled/ignored during thinking mode.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Frequency Penalty',
						name: 'frequencyPenalty',
						type: 'number',
						typeOptions: {
							minValue: -2,
							maxValue: 2,
						},
						default: 0,
						description: 'Positive values penalize new tokens based on their existing frequency in the text.',
					},
					{
						displayName: 'Presence Penalty',
						name: 'presencePenalty',
						type: 'number',
						typeOptions: {
							minValue: -2,
							maxValue: 2,
						},
						default: 0,
						description: 'Positive values penalize new tokens based on whether they appear in the text so far.',
					},
					{
						displayName: 'Top P',
						name: 'topP',
						type: 'number',
						typeOptions: {
							minValue: 0,
							maxValue: 1,
						},
						default: 1,
						description: 'Nucleus sampling: the model considers the results of the tokens with top_p probability mass.',
					},
					{
						displayName: 'Timeout (ms)',
						name: 'timeout',
						type: 'number',
						default: 60000,
						description: 'Maximum time in milliseconds to wait for the API response.',
					},
					{
						displayName: 'Max Retries',
						name: 'maxRetries',
						type: 'number',
						default: 3,
						description: 'Maximum number of retries for failed requests.',
					},
				],
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = await this.getCredentials('deepseekApi');
		const modelParameter = this.getNodeParameter('model', itemIndex) as string;
		const customModel = this.getNodeParameter('customModel', itemIndex, '') as string;
		const modelName = modelParameter === 'custom' ? customModel : modelParameter;

		const thinkingEnabled = this.getNodeParameter('thinkingEnabled', itemIndex, true) as boolean;
		const maxTokens = this.getNodeParameter('maxTokens', itemIndex, 4096) as number;
		const temperature = this.getNodeParameter('temperature', itemIndex, 1) as number;

		const options = this.getNodeParameter('options', itemIndex, {}) as {
			frequencyPenalty?: number;
			presencePenalty?: number;
			topP?: number;
			timeout?: number;
			maxRetries?: number;
		};

		const extraBody: Record<string, any> = {};
		const modelKwargs: Record<string, any> = {};

		if (thinkingEnabled) {
			const thinkingEffort = this.getNodeParameter('thinkingEffort', itemIndex, 'high') as string;
			extraBody['thinking'] = { type: 'enabled' };
			modelKwargs['reasoning_effort'] = thinkingEffort;
		} else {
			extraBody['thinking'] = { type: 'disabled' };
		}

		const model = new ChatDeepSeekCorrected({
			openAIApiKey: credentials.apiKey as string,
			configuration: {
				baseURL: credentials.baseUrl as string,
			},
			modelName,
			maxTokens,
			temperature: thinkingEnabled ? undefined : temperature,
			extraBody,
			modelKwargs,
			frequencyPenalty: options.frequencyPenalty,
			presencePenalty: options.presencePenalty,
			topP: options.topP,
			timeout: options.timeout,
			maxRetries: options.maxRetries,
			callbacks: [],
		});

		return {
			response: logWrapper(model as any, this),
		};
	}
}
