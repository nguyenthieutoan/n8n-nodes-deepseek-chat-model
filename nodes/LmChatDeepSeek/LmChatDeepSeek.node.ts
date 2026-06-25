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
					{ name: 'deepseek-v4-flash', value: 'deepseek-v4-flash' },
					{ name: 'deepseek-v4-pro', value: 'deepseek-v4-pro' },
					{ name: 'Custom Model', value: 'custom' },
				],
				default: 'deepseek-v4-flash',
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
				default: false,
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
						displayName: 'One-Shot Tools',
						name: 'oneShotTools',
						type: 'string',
						default: '',
						placeholder: 'rag_tool, send_message',
						description: 'Comma-separated list of tool names that can only be called at most once during execution.',
					},
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
		const thinkingEnabled = this.getNodeParameter('thinkingEnabled', itemIndex, false) as boolean;

		const options = this.getNodeParameter('options', itemIndex, {}) as {
			oneShotTools?: string;
			frequencyPenalty?: number;
			maxTokens?: number;
			responseFormat?: 'text' | 'json_object';
			presencePenalty?: number;
			temperature?: number;
			timeout?: number;
			maxRetries?: number;
			topP?: number;
		};

		const oneShotToolsRaw = options.oneShotTools || '';
		const oneShotToolsList = oneShotToolsRaw
			.split(',')
			.map(t => t.trim())
			.filter(t => t.length > 0);

		const modelKwargs: Record<string, any> = {};
		if (thinkingEnabled) {
			const thinkingEffort = this.getNodeParameter('thinkingEffort', itemIndex, 'high') as string;
			modelKwargs.thinking = { type: 'enabled' };
			modelKwargs.thinking_mode = thinkingEffort === 'max' ? 'think_max' : 'think_high';
			modelKwargs.reasoning_effort = thinkingEffort;
		} else {
			modelKwargs.thinking = { type: 'disabled' };
			modelKwargs.thinking_mode = 'non-think';
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
		const { HumanMessage } = requireN8nDependency('@langchain/core/messages');

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
		 *  3. Process call options to enforce strict schema structure and limit tool execution.
		 */
		class DeepSeekCorrected extends ChatOpenAI {
			oneShotToolsList: string[] = [];
			HumanMessageClass: any;

			constructor(fields: any) {
				const { oneShotToolsList, HumanMessageClass, ...rest } = fields;
				super(rest);
				this.oneShotToolsList = oneShotToolsList || [];
				this.HumanMessageClass = HumanMessageClass;
			}

			async _generate(messages: any[], callOptions: any, runManager?: any): Promise<any> {
				const patchedMessages = DeepSeekCorrected.injectReasoning(messages, thinkingIsEnabled);
				const {
					patchedMessages: finalMessages,
					patchedCallOptions,
				} = DeepSeekCorrected.patchMessagesAndCallOptions(
					patchedMessages,
					callOptions,
					this.oneShotToolsList,
					this.HumanMessageClass
				);

				const response = await super._generate(finalMessages, patchedCallOptions, runManager);
				const gen = response?.generations?.[0];
				if (gen?.message) {
					gen.message.additional_kwargs = gen.message.additional_kwargs ?? {};
				}
				return response;
			}

			async *_streamResponseChunks(messages: any[], callOptions: any, runManager?: any): AsyncGenerator<any> {
				const patchedMessages = DeepSeekCorrected.injectReasoning(messages, thinkingIsEnabled);
				const {
					patchedMessages: finalMessages,
					patchedCallOptions,
				} = DeepSeekCorrected.patchMessagesAndCallOptions(
					patchedMessages,
					callOptions,
					this.oneShotToolsList,
					this.HumanMessageClass
				);
				yield* super._streamResponseChunks(finalMessages, patchedCallOptions, runManager);
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
						// Create a clone preserving the prototype to prevent LangChain serialization errors
						const clone = Object.create(Object.getPrototypeOf(msg));
						Object.assign(clone, msg);
						
						clone.additional_kwargs = {
							...msg.additional_kwargs,
						};
						clone.reasoning_content = msg.additional_kwargs.reasoning_content;
						
						if (msg._getType) {
							clone._getType = msg._getType.bind(clone);
						}
						return clone;
					}
					return msg;
					
				});
			}

			/**
			 * Implements strict JSON Schema validation and limits tool execution.
			 */
			static sanitizeNameForComparison(name: string): string {
				if (!name) return '';
				return name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').trim();
			}

			/**
			 * Implements strict JSON Schema validation and limits tool execution.
			 */
			static patchMessagesAndCallOptions(
				messages: any[],
				callOptions: any,
				oneShotToolsList: string[],
				HumanMessageClass: any
			): { patchedMessages: any[]; patchedCallOptions: any } {
				const patchedMessages = [...messages];
				const patchedCallOptions = callOptions ? { ...callOptions } : {};

				if (patchedCallOptions.tools && Array.isArray(patchedCallOptions.tools)) {
					const oneShotToolsSet = new Set(
						oneShotToolsList.map((t: string) => DeepSeekCorrected.sanitizeNameForComparison(t))
					);
					const callCounts: Record<string, number> = {};
					const signatureCounts: Record<string, number> = {};
					let lastSignature: string | null = null;
					let consecutiveLoopDetected = false;

					for (const msg of messages) {
						let toolCalls: any[] = [];
						if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
							toolCalls = msg.tool_calls.map((tc: any) => ({
								name: tc.name,
								args: tc.args || {},
							}));
						} else if (msg.additional_kwargs?.tool_calls && Array.isArray(msg.additional_kwargs.tool_calls)) {
							toolCalls = msg.additional_kwargs.tool_calls.map((tc: any) => {
								let args = {};
								if (tc.function?.arguments) {
									try {
										args = JSON.parse(tc.function.arguments);
									} catch (_) {}
								}
								return {
									name: tc.function?.name,
									args,
								};
							});
						}

						for (const tc of toolCalls) {
							if (tc.name) {
								const sanitizedName = DeepSeekCorrected.sanitizeNameForComparison(tc.name);
								callCounts[sanitizedName] = (callCounts[sanitizedName] || 0) + 1;

								// Fingerprint for the signature check (tool name + hash of stringified arguments)
								const argsStr = tc.args ? JSON.stringify(tc.args) : '{}';
								const signature = `${tc.name}:${argsStr}`;
								
								// Check if this signature is identical to the last one (consecutive duplicate execution)
								if (lastSignature === signature) {
									consecutiveLoopDetected = true;
								}
								lastSignature = signature;
							}
						}
					}

					// Anti-Loop Circuit Breaker:
					// If we detect a loop (same tool called consecutively with same parameters)
					if (consecutiveLoopDetected) {
						patchedMessages.push(
							new HumanMessageClass(
								'Yêu cầu hệ thống khẩn cấp: Bạn đang bị kẹt trong một vòng lặp gọi công cụ với các tham số trùng lặp. Ngay lập tức ngừng việc gọi thêm bất kỳ công cụ nào và sử dụng các thông tin đã thu thập trước đó để đưa ra câu trả lời trực tiếp cho tôi.'
							)
						);
						// Remove all tools to physically prevent another tool call
						delete patchedCallOptions.tools;
					} else {
						// Otherwise, filter out one-shot tools that have already been executed
						patchedCallOptions.tools = patchedCallOptions.tools
							.filter((t: any) => {
								const name = t.function?.name;
								if (name) {
									const sanitizedName = DeepSeekCorrected.sanitizeNameForComparison(name);
									if (oneShotToolsSet.has(sanitizedName)) {
										const count = callCounts[sanitizedName] || 0;
										if (count >= 1) {
											return false; // Disable this tool since it already ran once
										}
									}
								}
								return true;
							})
							.map((t: any) => {
								// Enforce strict schemas
								if (t.function?.parameters) {
									return {
										...t,
										strict: true,
										function: {
											...t.function,
											parameters: DeepSeekCorrected.enforceStrictSchema(t.function.parameters),
										},
									};
								}
								return t;
							});

						if (patchedCallOptions.tools.length === 0) {
							delete patchedCallOptions.tools;
						}
					}
				}

				return { patchedMessages, patchedCallOptions };
			}

			static enforceStrictSchema(schema: any): any {
				if (!schema || typeof schema !== 'object') {
					return schema;
				}

				if (schema.type === 'object') {
					const result = { ...schema };
					result.additionalProperties = false;

					if (result.properties) {
						result.required = Object.keys(result.properties);
						const newProperties: Record<string, any> = {};
						for (const [key, value] of Object.entries(result.properties)) {
							newProperties[key] = DeepSeekCorrected.enforceStrictSchema(value);
						}
						result.properties = newProperties;
					} else {
						result.required = [];
					}
					return result;
				}

				if (schema.type === 'array' && schema.items) {
					return {
						...schema,
						items: DeepSeekCorrected.enforceStrictSchema(schema.items),
					};
				}

				return schema;
			}
		}

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
			oneShotToolsList,
			HumanMessageClass: HumanMessage,
		});

		return { response: chatModel };
	}
}
