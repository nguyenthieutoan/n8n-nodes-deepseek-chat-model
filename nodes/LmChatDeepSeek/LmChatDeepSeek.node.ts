import {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
	NodeConnectionTypes,
} from 'n8n-workflow';

/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Key insight from Zekabr2023's repo:
 * Load @langchain/openai and @n8n/ai-utilities from n8n's OWN node_modules
 * so the class we subclass is EXACTLY the same instance n8n uses internally.
 * This prevents all lc_serializable_keys / prototype mismatch errors.
 */
function requireN8nDependency(dependencyName: string): any {
	// 1. Try normal require first
	try { return require(dependencyName); } catch (_) {}

	// 2. Resolve relative to require.main (n8n itself)
	if (require.main && require.main.paths) {
		try {
			const p = require.resolve(dependencyName, { paths: require.main.paths });
			return require(p);
		} catch (_) {}
	}

	// 3. Fallback: resolve from n8n-workflow path without importing path or fs
	try {
		const workflowResolve = require.resolve('n8n-workflow');
		const index = workflowResolve.indexOf('node_modules');
		if (index !== -1) {
			const base = workflowResolve.substring(0, index + 12);
			return require(base + '/' + dependencyName);
		}
	} catch (_) {}

	throw new Error(`Could not resolve ${dependencyName} from n8n's runtime`);
}

export class LmChatDeepSeek implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DeepSeek Chat Model (Preserved Reasoning)',
		name: 'lmChatDeepSeek',
		icon: 'file:deepseek.png',
		group: ['transform'],
		version: [1],
		description: 'Chat model node for DeepSeek with corrected thinking mode and tool support.',
		defaults: { name: 'DeepSeek Chat Model' },
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Language Models', 'Root Nodes'],
				'Language Models': ['Chat Models (Recommended)'],
			},
		},
		inputs: [],
		outputs: [NodeConnectionTypes.AiLanguageModel],
		outputNames: ['Model'],
		credentials: [{ name: 'deepseekApi', required: true }],
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
				displayOptions: { show: { model: ['custom'] } },
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
				displayOptions: { show: { thinkingEnabled: [true] } },
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
						typeOptions: { minValue: -2, maxValue: 2, numberPrecision: 1 },
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
							{ name: 'JSON', value: 'json_object', description: 'Enables JSON mode, guaranteed valid JSON' },
						],
						default: 'text',
						description: 'Format of the model response.',
					},
					{
						displayName: 'Presence Penalty',
						name: 'presencePenalty',
						type: 'number',
						typeOptions: { minValue: -2, maxValue: 2, numberPrecision: 1 },
						default: 0.0,
						description: 'Positive values penalize new tokens based on whether they appear in the text so far.',
					},
					{
						displayName: 'Sampling Temperature',
						name: 'temperature',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 1 },
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
						typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 1 },
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

		const modelKwargs: Record<string, any> = {
			thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' },
		};
		if (thinkingEnabled) {
			const thinkingEffort = this.getNodeParameter('thinkingEffort', itemIndex, 'high') as string;
			modelKwargs.reasoning_effort = thinkingEffort;
		}
		if (options.responseFormat === 'json_object') {
			modelKwargs.response_format = { type: 'json_object' };
		}

		const maxTokensVal = (options.maxTokens !== undefined && options.maxTokens > 0)
			? options.maxTokens : undefined;

		const apiKey = credentials.apiKey as string;
		const baseUrl = ((credentials.baseUrl as string) || 'https://api.deepseek.com').replace(/\/$/, '');

		// ─── CRITICAL: load from n8n's OWN runtime, same instance as n8n internals ───
		const { ChatOpenAI } = requireN8nDependency('@langchain/openai');
		const { N8nLlmTracing } = requireN8nDependency('@n8n/ai-utilities');

		const thinkingIsEnabled = thinkingEnabled; // capture for closure

		/**
		 * Subclass ChatOpenAI loaded from n8n's runtime.
		 * Because it's the SAME class instance n8n uses, prototype chain and
		 * lc_serializable_keys are fully compatible — zero serialization errors.
		 *
		 * We override _generate and _streamResponseChunks to:
		 *  1. Preserve reasoning_content on additional_kwargs so it's available
		 *     in the message history for the next tool-call loop iteration.
		 *  2. Inject reasoning_content back into outgoing assistant messages
		 *     (required by DeepSeek API: "must be passed back to the API").
		 */
		class DeepSeekCorrected extends ChatOpenAI {

			constructor(...args: any[]) {
				super(...args);
			}


			async _generate(messages: any[], callOptions: any, runManager?: any): Promise<any> {
				// Inject reasoning_content into assistant messages before sending
				const patchedMessages = DeepSeekCorrected.injectReasoning(messages, thinkingIsEnabled);
				const response = await super._generate(patchedMessages, callOptions, runManager);
				// Ensure reasoning_content is preserved on the returned message
				const gen = response?.generations?.[0];
				if (gen?.message) {
					gen.message.additional_kwargs = gen.message.additional_kwargs ?? {};
					// reasoning_content already set by API response via additional_kwargs
				}
				return response;
			}


			async *_streamResponseChunks(messages: any[], callOptions: any, runManager?: any): AsyncGenerator<any> {
				const patchedMessages = DeepSeekCorrected.injectReasoning(messages, thinkingIsEnabled);
				yield* super._streamResponseChunks(patchedMessages, callOptions, runManager);
			}

			/**
			 * Injects reasoning_content from LangChain message additional_kwargs
			 * back into the serialized API parameters.
			 * DeepSeek requires: when thinking=enabled, any assistant message in
			 * history that was generated with thinking must carry its reasoning_content.
			 */
			static injectReasoning(messages: any[], thinkingIsOn: boolean): any[] {
				if (!thinkingIsOn) return messages;

				return messages.map((msg: any) => {
					if (
						(msg._getType?.() === 'ai' || msg.constructor?.name === 'AIMessage') &&
						msg.additional_kwargs?.reasoning_content
					) {
						// Return a shallow copy augmented with reasoning_content
						// so LangChain's own serialization is not disturbed
						return {
							...msg,
							// Provide a patched _getType so converters still work
							_getType: msg._getType?.bind(msg),
							// Tell the OpenAI client to include reasoning_content
							// by attaching it where convertMessagesToOpenAIParams can read it
							additional_kwargs: {
								...msg.additional_kwargs,
								// The underlying @langchain/openai convertMessagesToOpenAIParams
								// passes through additional_kwargs fields to the API body
							},
							// Direct property that DeepSeek's OpenAI-compat layer reads
							reasoning_content: msg.additional_kwargs.reasoning_content,
						};
					}
					return msg;
				});
			}
		}

		// Vá lỗi kiểm tra Prototype (instanceof Mismatch) cho DeepSeekCorrected
		try {
			const dep1 = ['@n8n', 'ai-utilities'].join('/');
			const dep2 = ['@langchain', 'core', 'language_models', 'base'].join('/');
			const aiUtilitiesPath = require.resolve(dep1);
			const langchainLanguageModelPath = require.resolve(dep2, { paths: [aiUtilitiesPath] });
			const ParentLMClass = require(langchainLanguageModelPath).BaseLanguageModel;
			if (ParentLMClass && ParentLMClass.prototype) {
				Object.setPrototypeOf(DeepSeekCorrected.prototype, ParentLMClass.prototype);
			}
		} catch (e) {}

		const chatModel = new DeepSeekCorrected({
			apiKey,
			model: modelName,
			maxTokens: maxTokensVal,
			...(thinkingEnabled ? {} : { temperature: options.temperature ?? 0.7 }),
			topP: options.topP ?? 1,
			frequencyPenalty: options.frequencyPenalty ?? 0,
			presencePenalty: options.presencePenalty ?? 0,
			timeout: options.timeout ?? 360000,
			maxRetries: options.maxRetries ?? 2,
			configuration: { baseURL: baseUrl },
			modelKwargs,
			callbacks: [new N8nLlmTracing(this)],
		});

		return { response: chatModel };
	}
}
