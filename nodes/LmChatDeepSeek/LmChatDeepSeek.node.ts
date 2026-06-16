import {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
	NodeConnectionTypes,
} from 'n8n-workflow';
import { N8nLlmTracing } from '@n8n/ai-utilities';
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
		outputs: [NodeConnectionTypes.AiLanguageModel],
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
					{ name: 'deepseek-chat', value: 'deepseek-chat' },
					{ name: 'deepseek-reasoner', value: 'deepseek-reasoner' },
					{ name: 'deepseek-v4-pro', value: 'deepseek-v4-pro' },
					{ name: 'deepseek-v4-flash', value: 'deepseek-v4-flash' },
					{ name: 'Custom Model', value: 'custom' },
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
				displayName: 'Thinking Mode',
				name: 'thinkingEnabled',
				type: 'boolean',
				default: true,
				description: 'Enable internal chain-of-thought thinking before responding.',
			},
			{
				displayName: 'Thinking Effort',
				name: 'thinkingEffort',
				type: 'options',
				displayOptions: {
					show: {
						thinkingEnabled: [true],
					},
				},
				options: [
					{ name: 'High', value: 'high' },
					{ name: 'Max', value: 'max' },
				],
				default: 'high',
				description: 'Adjust resource depth for thinking processes.',
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
							numberPrecision: 1,
						},
						default: 0.0,
						description: 'Positive values penalize new tokens based on their existing frequency in the text.',
					},
					{
						displayName: 'Maximum Number of Tokens',
						name: 'maxTokens',
						type: 'number',
						default: -1,
						description: 'The maximum number of tokens to generate. Use -1 for unlimited.',
					},
					{
						displayName: 'Response Format',
						name: 'responseFormat',
						type: 'options',
						options: [
							{ name: 'Text', value: 'text', description: 'Regular text response' },
							{ name: 'JSON', value: 'json_object', description: 'Enables JSON mode, which should guarantee the message the model generates is valid JSON' },
						],
						default: 'text',
						description: 'Format of the model response.',
					},
					{
						displayName: 'Presence Penalty',
						name: 'presencePenalty',
						type: 'number',
						typeOptions: {
							minValue: -2,
							maxValue: 2,
							numberPrecision: 1,
						},
						default: 0.0,
						description: 'Positive values penalize new tokens based on whether they appear in the text so far.',
					},
					{
						displayName: 'Sampling Temperature',
						name: 'temperature',
						type: 'number',
						typeOptions: {
							minValue: 0,
							maxValue: 2,
							numberPrecision: 1,
						},
						default: 0.7,
						description: 'Adjust execution creativity. Ignored during thinking mode.',
					},
					{
						displayName: 'Timeout',
						name: 'timeout',
						type: 'number',
						default: 360000,
						description: 'Maximum time in milliseconds to wait for the API response.',
					},
					{
						displayName: 'Max Retries',
						name: 'maxRetries',
						type: 'number',
						default: 2,
						description: 'Maximum number of retries for failed requests.',
					},
					{
						displayName: 'Top P',
						name: 'topP',
						type: 'number',
						typeOptions: {
							minValue: 0,
							maxValue: 1,
							numberPrecision: 1,
						},
						default: 1.0,
						description: 'Nucleus sampling: the model considers the results of the tokens with top_p probability mass.',
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

		const options = this.getNodeParameter('options', itemIndex, {}) as {
			frequencyPenalty?: number;
			maxTokens?: number;
			responseFormat?: 'text' | 'json_object';
			presencePenalty?: number;
			temperature?: number;
			timeout?: number;
			maxRetries?: number;
			topP?: number;
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

		if (options.responseFormat === 'json_object') {
			modelKwargs['response_format'] = { type: 'json_object' };
		}

		const maxTokensVal = (options.maxTokens !== undefined && options.maxTokens > 0) ? options.maxTokens : undefined;

		const model = new ChatDeepSeekCorrected({
			apiKey: credentials.apiKey as string,
			openAIApiKey: credentials.apiKey as string,
			configuration: {
				baseURL: credentials.baseUrl as string,
			},
			modelName,
			maxTokens: maxTokensVal,
			temperature: thinkingEnabled ? undefined : (options.temperature ?? 0.7),
			extraBody,
			modelKwargs,
			frequencyPenalty: options.frequencyPenalty ?? 0,
			presencePenalty: options.presencePenalty ?? 0,
			topP: options.topP ?? 1,
			timeout: options.timeout ?? 360000,
			maxRetries: options.maxRetries ?? 2,
			callbacks: [new N8nLlmTracing(this)],
		});

		return {
			response: model,
		};
	}
}
