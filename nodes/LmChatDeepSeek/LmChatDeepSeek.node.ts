import {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
	NodeConnectionTypes,
} from 'n8n-workflow';

/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Ultra-robust dependency loader for n8n Community Nodes:
 * Resolves @langchain/openai, @n8n/ai-utilities, @langchain/core across all n8n runtime
 * setups (Official Docker images, n8n Desktop, npm global, custom n8n builds, pnpm).
 */
function requireN8nDependency(dependencyName: string): any {
	// 1. Try standard require first
	try {
		return require(dependencyName);
	} catch (_) {}

	const path = require('path');

	const tryRequire = (targetPath: string) => {
		try {
			return require(targetPath);
		} catch (_) {
			return null;
		}
	};

	// 2. Collect candidate base directories where node_modules might live
	const candidateDirs: string[] = [];

	// Climb up from __dirname
	let currentDir = __dirname;
	while (currentDir) {
		candidateDirs.push(currentDir);
		const parent = path.dirname(currentDir);
		if (parent === currentDir) break;
		currentDir = parent;
	}

	// Climb up from process.cwd()
	try {
		if (process.cwd()) {
			let cwdDir = process.cwd();
			while (cwdDir) {
				candidateDirs.push(cwdDir);
				const parent = path.dirname(cwdDir);
				if (parent === cwdDir) break;
				cwdDir = parent;
			}
		}
	} catch (_) {}

	// Climb up from require.main.filename if available
	if (require.main && require.main.filename) {
		try {
			let mainDir = path.dirname(require.main.filename);
			while (mainDir) {
				candidateDirs.push(mainDir);
				const parent = path.dirname(mainDir);
				if (parent === mainDir) break;
				mainDir = parent;
			}
		} catch (_) {}
	}

	// Standard Docker / Global n8n paths
	const globalPaths = [
		'/home/node',
		'/data',
		'/usr/local/lib/node_modules/n8n',
		'/usr/local/lib/node_modules',
		'/usr/lib/node_modules',
		'/opt/n8n',
	];
	for (const gp of globalPaths) {
		candidateDirs.push(gp);
	}

	// 3. Direct path resolution against candidateDirs
	for (const dir of candidateDirs) {
		// dir/node_modules/dependencyName
		const p1 = path.join(dir, 'node_modules', dependencyName);
		let res = tryRequire(p1);
		if (res) return res;

		// dir/dependencyName (in case dir IS a node_modules folder)
		const p2 = path.join(dir, dependencyName);
		res = tryRequire(p2);
		if (res) return res;
	}

	// 4. Try resolving relative to known n8n packages
	const n8nPackages = [
		'@n8n/n8n-nodes-langchain',
		'n8n-nodes-base',
		'n8n-workflow',
		'n8n',
	];
	for (const pkg of n8nPackages) {
		try {
			const pkgPath = require.resolve(pkg);
			let dir = path.dirname(pkgPath);
			while (dir) {
				const p1 = path.join(dir, 'node_modules', dependencyName);
				let res = tryRequire(p1);
				if (res) return res;

				const parent = path.dirname(dir);
				if (parent === dir) break;
				dir = parent;
			}
		} catch (_) {}
	}

	// 5. Try require.resolve with search starting dirs
	for (const sDir of candidateDirs) {
		try {
			const resolved = require.resolve(dependencyName, { paths: [sDir] });
			const res = tryRequire(resolved);
			if (res) return res;
		} catch (_) {}
	}

	throw new Error(`Could not resolve ${dependencyName} from n8n's runtime`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Sanitize tool name for comparison (strip non-alphanumeric, lowercase)
// ─────────────────────────────────────────────────────────────────────────────
function sanitizeName(name: string): string {
	if (!name) return '';
	return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Enforce additionalProperties:false + required on all object schemas
// ─────────────────────────────────────────────────────────────────────────────
function enforceStrictSchema(schema: any): any {
	if (!schema || typeof schema !== 'object') return schema;

	if (schema.type === 'object') {
		const result = { ...schema };
		result.additionalProperties = false;
		if (result.properties) {
			result.required = Object.keys(result.properties);
			const newProperties: Record<string, any> = {};
			for (const [key, value] of Object.entries(result.properties)) {
				newProperties[key] = enforceStrictSchema(value);
			}
			result.properties = newProperties;
		} else {
			result.required = [];
		}
		return result;
	}

	if (schema.type === 'array' && schema.items) {
		return { ...schema, items: enforceStrictSchema(schema.items) };
	}

	return schema;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: Tool filtering logic that runs at HTTP request level
// ─────────────────────────────────────────────────────────────────────────────
function filterToolsInRequestBody(
	body: any,
	oneShotToolsList: string[],
	maxToolExecutions: number,
): any {
	if (!body.tools || !Array.isArray(body.tools) || !body.messages || !Array.isArray(body.messages)) {
		return body;
	}

	const oneShotSet = new Set(oneShotToolsList.map(n => sanitizeName(n)));
	const callCounts: Record<string, number> = {};
	let lastSignature: string | null = null;
	let consecutiveLoopDetected = false;
	let lastToolName: string | null = null;
	let consecutiveToolNameCount = 0;
	let consecutiveToolLoopDetected = false;

	// Scan message history for tool calls (raw OpenAI message format)
	for (const msg of body.messages) {
		if (msg.role === 'assistant' && msg.tool_calls && Array.isArray(msg.tool_calls)) {
			for (const tc of msg.tool_calls) {
				const name = tc.function?.name;
				if (!name) continue;

				const sanitized = sanitizeName(name);
				callCounts[sanitized] = (callCounts[sanitized] || 0) + 1;

				// 1. Identical signature check (same tool + same arguments)
				const argsStr = tc.function?.arguments || '{}';
				const signature = `${name}:${argsStr}`;
				if (lastSignature === signature) {
					consecutiveLoopDetected = true;
				}
				lastSignature = signature;

				// 2. Consecutive same tool name check (≥3 consecutive calls to same tool)
				if (lastToolName === sanitized) {
					consecutiveToolNameCount++;
					if (consecutiveToolNameCount >= 3) {
						consecutiveToolLoopDetected = true;
					}
				} else {
					consecutiveToolNameCount = 1;
				}
				lastToolName = sanitized;
			}
		}
	}

	const modified = { ...body };

	if (consecutiveLoopDetected || consecutiveToolLoopDetected) {
		// Circuit breaker: remove all tools to stop the loop
		console.warn('[DeepSeek] Anti-loop circuit breaker activated. Removing all tools.');
		delete modified.tools;
	} else {
		// Filter tools: remove one-shot tools that already ran, and tools at max
		const filtered = modified.tools.filter((t: any) => {
			const name = t.function?.name;
			if (!name) return true;
			const sanitized = sanitizeName(name);

			// One-shot check
			if (oneShotSet.has(sanitized) && (callCounts[sanitized] || 0) >= 1) {
				console.warn(`[DeepSeek] One-shot tool "${name}" already used. Removing from available tools.`);
				return false;
			}

			// Max executions check
			if ((callCounts[sanitized] || 0) >= maxToolExecutions) {
				console.warn(`[DeepSeek] Tool "${name}" reached max executions (${maxToolExecutions}). Removing.`);
				return false;
			}

			return true;
		});

		if (filtered.length === 0) {
			console.warn('[DeepSeek] No tools remaining after filtering. Removing tools option.');
			delete modified.tools;
		} else {
			modified.tools = filtered;
		}
	}

	// Enforce strict JSON schemas on remaining tools
	if (modified.tools && Array.isArray(modified.tools)) {
		modified.tools = modified.tools.map((t: any) => {
			if (t.function?.parameters) {
				return {
					...t,
					strict: true,
					function: {
						...t.function,
						parameters: enforceStrictSchema(t.function.parameters),
					},
				};
			}
			return t;
		});
	}

	return modified;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory: Create a custom fetch function that intercepts API requests
// to apply tool filtering at the HTTP level.
// ─────────────────────────────────────────────────────────────────────────────
function createToolFilteringFetch(
	oneShotToolsList: string[],
	maxToolExecutions: number,
): typeof globalThis.fetch {
	const hasFiltering = oneShotToolsList.length > 0 || maxToolExecutions < Infinity;

	return async function toolFilteringFetch(
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> {
		// Only intercept POST requests with a body (chat completions)
		if (hasFiltering && init?.method === 'POST' && init.body && typeof init.body === 'string') {
			try {
				const body = JSON.parse(init.body);
				if (body.tools && body.messages) {
					const filtered = filterToolsInRequestBody(body, oneShotToolsList, maxToolExecutions);
					init = { ...init, body: JSON.stringify(filtered) };
				}
			} catch (_) {
				// If JSON parsing fails, pass through unchanged
			}
		}
		return globalThis.fetch(input, init);
	};
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

		const oneShotToolsRaw = options.oneShotTools || '';
		const oneShotToolsList = oneShotToolsRaw
			.split(',')
			.map(t => t.trim())
			.filter(t => t.length > 0);

		const maxToolExecutionsVal = options.maxToolExecutions !== undefined ? options.maxToolExecutions : 3;

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
					oneShotToolsList,
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
				const patchedMessages = DeepSeekCorrected.injectReasoning(messages, thinkingIsEnabled);
				const {
					patchedMessages: finalMessages,
					patchedCallOptions,
				} = DeepSeekCorrected.patchMessagesAndCallOptions(
					patchedMessages,
					callOptions,
					oneShotToolsList,
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
				HumanMessageClass: any
			): { patchedMessages: any[]; patchedCallOptions: any } {
				console.log('--- DeepSeek patchMessagesAndCallOptions START ---');
				console.log('oneShotToolsList:', oneShotToolsList);
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
								
								if (lastSignature === signature) {
									consecutiveLoopDetected = true;
									console.log(`[LOOP DETECTED] Consecutive loop signature match: ${signature}`);
								}
								lastSignature = signature;
							}
						}
					}

					console.log('Final callCounts:', callCounts);
					console.log('consecutiveLoopDetected:', consecutiveLoopDetected);

					if (consecutiveLoopDetected) {
						console.log('Applying consecutive loop ngắt mạch...');
						patchedMessages.push(
							new HumanMessageClass(
								'Yêu cầu hệ thống khẩn cấp: Bạn đang bị kẹt trong một vòng lặp gọi công cụ với các tham số trùng lặp. Ngay lập tức ngừng việc gọi thêm bất kỳ công cụ nào và sử dụng các thông tin đã thu thập trước đó để đưa ra câu trả lời trực tiếp cho tôi.'
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
									if (oneShotToolsSet.has(sanitizedName)) {
										const count = callCounts[sanitizedName] || 0;
										console.log(`Checking one-shot tool ${name} (sanitized: ${sanitizedName}), count in history: ${count}`);
										if (count >= 1) {
											console.log(`Filtering out one-shot tool ${name} because count ${count} >= 1`);
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
			configuration: {
				baseURL: baseUrl,
				fetch: createToolFilteringFetch(oneShotToolsList, maxToolExecutionsVal),
			},
			modelKwargs,
			callbacks: [new N8nLlmTracing(this)],
			oneShotToolsList,
			HumanMessageClass: HumanMessage,
		});

		return { response: chatModel };
	}
}
