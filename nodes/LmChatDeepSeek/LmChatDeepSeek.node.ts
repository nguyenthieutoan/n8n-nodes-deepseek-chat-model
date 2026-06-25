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
						type: 'fixedCollection',
						default: {},
						placeholder: 'Add Tool Name',
						typeOptions: {
							multipleValues: true,
						},
						options: [
							{
								displayName: 'Tool Name',
								name: 'tools',
								values: [
									{
										displayName: 'Tool Name',
										name: 'name',
										type: 'string',
										default: '',
										description: 'The name of the tool that should only be executed at most once (e.g. "search_document").',
									},
								],
							},
						],
						description: 'List of tool names that should only be executed at most once per execution.',
					},
					{
						displayName: 'Max Tool Executions',
						name: 'maxToolExecutions',
						type: 'number',
						default: 3,
						description: 'The maximum number of times any single tool can be executed per run. Prevents loops when the AI changes query parameters repeatedly.',
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
			oneShotTools?: string | {
				tools?: Array<{ name: string }>;
			};
			maxToolExecutions?: number;
			frequencyPenalty?: number;
			maxTokens?: number;
			responseFormat?: 'text' | 'json_object';
			presencePenalty?: number;
			temperature?: number;
			timeout?: number;
			maxRetries?: number;
			topP?: number;
		};

		let oneShotToolsList: string[] = [];
		if (options.oneShotTools) {
			if (typeof options.oneShotTools === 'string') {
				oneShotToolsList = options.oneShotTools
					.split(',')
					.map(name => name.trim())
					.filter(name => name.length > 0);
			} else if (typeof options.oneShotTools === 'object' && options.oneShotTools !== null) {
				const tools = (options.oneShotTools as any).tools || [];
				oneShotToolsList = tools
					.map((item: any) => item.name ? String(item.name).trim() : '')
					.filter((name: string) => name.length > 0);
			}
		}

		const maxToolExecutionsVal = options.maxToolExecutions !== undefined ? options.maxToolExecutions : 3;

		// ══════════ DIAGNOSTIC: Verify parameter parsing ══════════
		console.log('╔══════════════════════════════════════════════╗');
		console.log('║ [DeepSeek] INSTANCE CREATION                 ║');
		console.log('╠══════════════════════════════════════════════╣');
		console.log('║ oneShotToolsList:', JSON.stringify(oneShotToolsList));
		console.log('║ maxToolExecutionsVal:', maxToolExecutionsVal);
		console.log('║ raw options.oneShotTools:', JSON.stringify(options.oneShotTools));
		console.log('║ raw options.maxToolExecutions:', options.maxToolExecutions);
		console.log('║ typeof options.oneShotTools:', typeof options.oneShotTools);
		console.log('╚══════════════════════════════════════════════╝');

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
			maxToolExecutions: number = 3;
			HumanMessageClass: any;

			constructor(fields: any) {
				const { oneShotToolsList, maxToolExecutions, HumanMessageClass, ...rest } = fields;
				super(rest);
				this.oneShotToolsList = oneShotToolsList || [];
				this.maxToolExecutions = maxToolExecutions !== undefined ? maxToolExecutions : 3;
				this.HumanMessageClass = HumanMessageClass;
			}

			// ── DIAGNOSTIC: Override invoke() to capture full call flow ──
			async invoke(input: any, options?: any): Promise<any> {
				console.log('╔══════════════════════════════════════════════╗');
				console.log('║ [DeepSeek] invoke() CALLED                   ║');
				console.log('╠══════════════════════════════════════════════╣');
				console.log('║ input type:', typeof input, Array.isArray(input) ? `(array len=${input.length})` : '');
				console.log('║ options keys:', options ? Object.keys(options) : 'NULL');
				console.log('║ options?.tools?:', !!(options?.tools));
				if (options?.tools && Array.isArray(options.tools)) {
					console.log('║ options.tools count:', options.tools.length);
					console.log('║ options.tools[0] keys:', options.tools[0] ? Object.keys(options.tools[0]) : 'EMPTY');
				}
				console.log('║ Closure oneShotToolsList:', JSON.stringify(oneShotToolsList));
				console.log('║ Closure maxToolExecutionsVal:', maxToolExecutionsVal);
				console.log('╚══════════════════════════════════════════════╝');
				return super.invoke(input, options);
			}

			async _generate(messages: any[], callOptions: any, runManager?: any): Promise<any> {
				// ── DIAGNOSTIC: Verify _generate is called + inspect callOptions ──
				console.log('╔══════════════════════════════════════════════╗');
				console.log('║ [DeepSeek] _generate() CALLED                ║');
				console.log('╠══════════════════════════════════════════════╣');
				console.log('║ Closure oneShotToolsList:', JSON.stringify(oneShotToolsList));
				console.log('║ Closure maxToolExecutionsVal:', maxToolExecutionsVal);
				console.log('║ Instance this.oneShotToolsList:', JSON.stringify(this.oneShotToolsList));
				console.log('║ Messages count:', messages.length);
				console.log('║ callOptions keys:', callOptions ? Object.keys(callOptions) : 'NULL');
				console.log('║ callOptions.tools?:', !!(callOptions?.tools),
					'type:', typeof callOptions?.tools,
					'isArray:', Array.isArray(callOptions?.tools));
				if (Array.isArray(callOptions?.tools) && callOptions.tools.length > 0) {
					const t0 = callOptions.tools[0];
					console.log('║ tools count:', callOptions.tools.length);
					console.log('║ tools[0] keys:', Object.keys(t0));
					console.log('║ tools[0].type:', t0.type);
					console.log('║ tools[0].function?.name:', t0.function?.name);
					console.log('║ tools[0].name:', t0.name);
					console.log('║ ALL tool names:', callOptions.tools.map((t: any) =>
						t.function?.name || t.name || 'UNKNOWN').join(', '));
				}
				// Check this.kwargs (where bindTools may store tools)
				const selfKwargs = (this as any).kwargs;
				console.log('║ this.kwargs keys:', selfKwargs ? Object.keys(selfKwargs) : 'NO_KWARGS');
				if (selfKwargs?.tools) {
					console.log('║ this.kwargs.tools count:', selfKwargs.tools.length);
				}
				// Check message types for tool call history
				for (let i = 0; i < messages.length; i++) {
					const msg = messages[i];
					const msgType = msg._getType?.() || msg.constructor?.name || typeof msg;
					const hasToolCalls = !!(msg.tool_calls?.length || msg.additional_kwargs?.tool_calls?.length);
					if (hasToolCalls) {
						const tcNames = (msg.tool_calls || msg.additional_kwargs?.tool_calls || []).map(
							(tc: any) => tc.name || tc.function?.name || 'UNKNOWN'
						);
						console.log(`║ msg[${i}] type=${msgType} TOOL_CALLS=[${tcNames.join(',')}]`);
					}
				}
				console.log('╚══════════════════════════════════════════════╝');

				const patchedMessages = DeepSeekCorrected.injectReasoning(messages, thinkingIsEnabled);
				const {
					patchedMessages: finalMessages,
					patchedCallOptions,
				} = DeepSeekCorrected.patchMessagesAndCallOptions(
					patchedMessages,
					callOptions,
					oneShotToolsList,
					maxToolExecutionsVal,
					HumanMessage
				);

				const response = await super._generate(finalMessages, patchedCallOptions, runManager);
				const gen = response?.generations?.[0];
				if (gen?.message) {
					gen.message.additional_kwargs = gen.message.additional_kwargs ?? {};
				}
				return response;
			}

			async *_streamResponseChunks(messages: any[], callOptions: any, runManager?: any): AsyncGenerator<any> {
				console.log('╔══════════════════════════════════════════════╗');
				console.log('║ [DeepSeek] _streamResponseChunks() CALLED    ║');
				console.log('║ Closure oneShotToolsList:', JSON.stringify(oneShotToolsList));
				console.log('║ callOptions.tools?:', !!(callOptions?.tools));
				if (Array.isArray(callOptions?.tools)) {
					console.log('║ ALL tool names:', callOptions.tools.map((t: any) =>
						t.function?.name || t.name || 'UNKNOWN').join(', '));
				}
				console.log('╚══════════════════════════════════════════════╝');

				const patchedMessages = DeepSeekCorrected.injectReasoning(messages, thinkingIsEnabled);
				const {
					patchedMessages: finalMessages,
					patchedCallOptions,
				} = DeepSeekCorrected.patchMessagesAndCallOptions(
					patchedMessages,
					callOptions,
					oneShotToolsList,
					maxToolExecutionsVal,
					HumanMessage
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
				return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
			}

			/**
			 * Implements strict JSON Schema validation and limits tool execution.
			 */
			static patchMessagesAndCallOptions(
				messages: any[],
				callOptions: any,
				oneShotToolsList: string[],
				maxToolExecutions: number,
				HumanMessageClass: any
			): { patchedMessages: any[]; patchedCallOptions: any } {
				console.log('--- DeepSeek patchMessagesAndCallOptions START ---');
				console.log('oneShotToolsList:', oneShotToolsList);
				console.log('maxToolExecutions limit:', maxToolExecutions);
				console.log('Number of messages in history:', messages.length);

				const patchedMessages = [...messages];
				const patchedCallOptions = callOptions ? { ...callOptions } : {};

				if (patchedCallOptions.tools && Array.isArray(patchedCallOptions.tools)) {
					console.log('Available tools in callOptions:', patchedCallOptions.tools.map((t: any) => t.function?.name));
					const oneShotToolsSet = new Set(
						oneShotToolsList.map((t: string) => DeepSeekCorrected.sanitizeNameForComparison(t))
					);
					const callCounts: Record<string, number> = {};
					let lastSignature: string | null = null;
					let consecutiveLoopDetected = false;

					let consecutiveToolNameCount = 0;
					let lastToolName: string | null = null;
					let consecutiveToolLoopDetected = false;

					for (let index = 0; index < messages.length; index++) {
						const msg = messages[index];
						console.log(`Message ${index} type:`, msg.constructor?.name || typeof msg, 'role:', msg._getType?.());
						
						let toolCalls: any[] = [];
						if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
							console.log(`Message ${index} has msg.tool_calls:`, msg.tool_calls);
							toolCalls = msg.tool_calls.map((tc: any) => ({
								name: tc.name,
								args: tc.args || {},
							}));
						} else if (msg.additional_kwargs?.tool_calls && Array.isArray(msg.additional_kwargs.tool_calls)) {
							console.log(`Message ${index} has msg.additional_kwargs.tool_calls:`, msg.additional_kwargs.tool_calls);
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
						} else {
							if (msg._getType?.() === 'ai' || msg.constructor?.name === 'AIMessage') {
								console.log(`Message ${index} is AI but has no tool calls. Content:`, msg.content);
							}
						}

						for (const tc of toolCalls) {
							if (tc.name) {
								const sanitizedName = DeepSeekCorrected.sanitizeNameForComparison(tc.name);
								callCounts[sanitizedName] = (callCounts[sanitizedName] || 0) + 1;

								const argsStr = tc.args ? JSON.stringify(tc.args) : '{}';
								const signature = `${tc.name}:${argsStr}`;
								console.log(`Analyzed tool call: ${tc.name}, signature: ${signature}, lastSignature was: ${lastSignature}`);
								
								// 1. Identical signature check (tool name + exact same arguments)
								if (lastSignature === signature) {
									consecutiveLoopDetected = true;
									console.log(`[LOOP DETECTED] Consecutive loop signature match: ${signature}`);
								}
								lastSignature = signature;

								// 2. Consecutive same tool name check (same tool called consecutively 3 times, even with changing queries)
								if (lastToolName === sanitizedName) {
									consecutiveToolNameCount++;
									if (consecutiveToolNameCount >= 3) {
										consecutiveToolLoopDetected = true;
										console.log(`[LOOP DETECTED] Consecutive same tool name run threshold hit: ${tc.name}`);
									}
								} else {
									consecutiveToolNameCount = 1;
								}
								lastToolName = sanitizedName;
							}
						}
					}

					console.log('Final callCounts:', callCounts);
					console.log('consecutiveLoopDetected:', consecutiveLoopDetected);
					console.log('consecutiveToolLoopDetected:', consecutiveToolLoopDetected);

					if (consecutiveLoopDetected || consecutiveToolLoopDetected) {
						console.log('Applying consecutive loop ngắt mạch...');
						patchedMessages.push(
							new HumanMessageClass(
								'Yêu cầu hệ thống khẩn cấp: Bạn đang bị kẹt trong một vòng lặp gọi công cụ với các tham số trùng lặp hoặc lặp chuỗi. Ngay lập tức ngừng việc gọi thêm bất kỳ công cụ nào và sử dụng các thông tin đã thu thập trước đó để đưa ra câu trả lời trực tiếp cho tôi.'
							)
						);
						delete patchedCallOptions.tools;
					} else {
						// Otherwise, filter out one-shot tools that have already been executed
						patchedCallOptions.tools = patchedCallOptions.tools
							.filter((t: any) => {
								const name = t.function?.name;
								if (name) {
									const sanitizedName = DeepSeekCorrected.sanitizeNameForComparison(name);
									
									// 1. One-Shot Limit check
									if (oneShotToolsSet.has(sanitizedName)) {
										const count = callCounts[sanitizedName] || 0;
										console.log(`Checking one-shot tool ${name} (sanitized: ${sanitizedName}), count in history: ${count}`);
										if (count >= 1) {
											console.log(`Filtering out one-shot tool ${name} because count ${count} >= 1`);
											return false; // Disable this tool since it already ran once
										}
									}

									// 2. Max Executions Ceiling check
									const count = callCounts[sanitizedName] || 0;
									if (count >= maxToolExecutions) {
										console.log(`Filtering out tool ${name} because it reached max executions limit of ${maxToolExecutions} (current count: ${count})`);
										return false;
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
							console.log('No tools left after one-shot filtering. Deleting tools option.');
							delete patchedCallOptions.tools;
						} else {
							console.log('Tools remaining after one-shot filtering:', patchedCallOptions.tools.map((t: any) => t.function?.name));
						}
					}
				} else {
					console.log('No tools present in callOptions.');
				}

				console.log('--- DeepSeek patchMessagesAndCallOptions END ---');
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
			maxToolExecutions: maxToolExecutionsVal,
			HumanMessageClass: HumanMessage,
		});

		return { response: chatModel };
	}
}
