import {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
	NodeConnectionTypes,
} from 'n8n-workflow';
import { N8nLlmTracing } from '@n8n/ai-utilities';
import { ChatOpenAI } from '@langchain/openai';

export class LmChatDeepSeek implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DeepSeek Chat Model (Corrected)',
		name: 'lmChatDeepSeek',
		icon: 'file:deepseek.png',
		group: ['transform'],
		version: [1],
		description: 'Chat model node for DeepSeek with corrected thinking mode and tool support.',
		defaults: {
			name: 'DeepSeek Chat Model',
		},
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

		/**
		 * Shared state held purely in the closure.
		 * - currentMessages: the input messages for the current call (set before each API request)
		 * - reasoningStore: map from call index (monotonic) to captured reasoning_content
		 * - callIndex: incremented each time a new request starts
		 * - capturedReasoning: the most recently completed reasoning_content captured from the API response
		 */
		const state = {
			currentMessages: [] as any[],
			capturedReasoning: '',
		};

		const originalFetch = fetch;

		/**
		 * A single fetch interceptor that handles BOTH directions:
		 *  1. OUTBOUND: injects reasoning_content into assistant messages in the request body
		 *  2. INBOUND: reads the response body to capture reasoning_content, then reconstructs a
		 *              Response object so the LangChain client can still consume it normally.
		 */
		const interceptingFetch = async (url: any, init?: any): Promise<Response> => {
			// --- OUTBOUND: inject reasoning_content ---
			if (init?.body) {
				try {
					const body = JSON.parse(init.body);
					if (body && Array.isArray(body.messages) && state.currentMessages.length > 0) {
						let modified = false;
						const aiMessages = state.currentMessages.filter(
							(m: any) => m._getType?.() === 'ai' || m.constructor?.name === 'AIMessage',
						);
						let aiMsgCount = 0;

						body.messages = body.messages.map((apiMsg: any) => {
							if (apiMsg.role === 'assistant') {
								const langchainMsg = aiMessages[aiMsgCount++];
								if (langchainMsg) {
									const reasoning = langchainMsg.additional_kwargs?.reasoning_content;
									if (reasoning && thinkingEnabled) {
										apiMsg.reasoning_content = reasoning;
										modified = true;
									} else if (!thinkingEnabled && 'reasoning_content' in apiMsg) {
										delete apiMsg.reasoning_content;
										modified = true;
									}
								}
							}
							return apiMsg;
						});

						if (modified) {
							init.body = JSON.stringify(body);
						}
					}
				} catch (_) { /* ignore parse errors */ }
			}

			// --- Execute the real request ---
			const rawResponse = await originalFetch(url, init);

			// --- INBOUND: capture reasoning_content from the response ---
			// Only intercept JSON (non-streaming) responses from the completions endpoint.
			const contentType = rawResponse.headers?.get?.('content-type') ?? '';
			const isStream = contentType.includes('text/event-stream');
			const isJson = contentType.includes('application/json');

			if (isJson && rawResponse.ok) {
				try {
					const cloned = rawResponse.clone();
					const json = await cloned.json();
					const reasoning = json?.choices?.[0]?.message?.reasoning_content;
					if (reasoning) {
						state.capturedReasoning = reasoning;
					}
				} catch (_) { /* ignore */ }
			}

			if (isStream) {
				// For streaming: wrap the ReadableStream to intercept SSE chunks
				const originalBody = rawResponse.body;
				if (originalBody) {
					const decoder = new TextDecoder();
					let streamReasoning = '';

					const transformedStream = new ReadableStream({
						async start(controller) {
							const reader = originalBody.getReader();
							try {
								while (true) {
									const { done, value } = await reader.read();
									if (done) {
										// Commit accumulated reasoning before closing
										if (streamReasoning) {
											state.capturedReasoning = streamReasoning;
										}
										controller.close();
										break;
									}
									// Extract reasoning_content from SSE data lines
									const text = decoder.decode(value, { stream: true });
									for (const line of text.split('\n')) {
										const trimmed = line.trim();
										if (trimmed.startsWith('data:') && !trimmed.includes('[DONE]')) {
											try {
												const chunk = JSON.parse(trimmed.slice(5).trim());
												const rc = chunk?.choices?.[0]?.delta?.reasoning_content;
												if (rc) streamReasoning += rc;
											} catch (_) { /* ignore */ }
										}
									}
									controller.enqueue(value);
								}
							} catch (err) {
								controller.error(err);
							}
						},
					});

					// Reconstruct a proper Response with the transformed stream
					return new Response(transformedStream, {
						status: rawResponse.status,
						statusText: rawResponse.statusText,
						headers: rawResponse.headers,
					});
				}
			}

			return rawResponse;
		};

		const model = new ChatOpenAI({
			apiKey: credentials.apiKey as string,
			openAIApiKey: credentials.apiKey as string,
			configuration: {
				baseURL: credentials.baseUrl as string,
				fetch: interceptingFetch,
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
			callbacks: [new N8nLlmTracing(this) as any],
		} as any);

		// --- Patch _generate: track messages, then stamp reasoning_content onto the returned AIMessage ---
		const originalGenerate = model._generate.bind(model);
		model._generate = async function (messages: any[], callOptions: any, runManager?: any): Promise<any> {
			state.currentMessages = messages;
			state.capturedReasoning = '';
			try {
				const result = await originalGenerate(messages, callOptions, runManager);
				// Stamp reasoning_content onto the first generation's message
				const msg = result?.generations?.[0]?.message;
				if (msg && state.capturedReasoning) {
					msg.additional_kwargs = msg.additional_kwargs ?? {};
					msg.additional_kwargs.reasoning_content = state.capturedReasoning;
				}
				return result;
			} finally {
				state.currentMessages = [];
				state.capturedReasoning = '';
			}
		};

		// --- Patch _streamResponseChunks: track messages, stamp reasoning_content on final chunk ---
		const protoStream = (model as any)._streamResponseChunks;
		if (typeof protoStream === 'function') {
			const originalStream = protoStream.bind(model);
			(model as any)._streamResponseChunks = async function* (messages: any[], callOptions: any, runManager?: any): AsyncGenerator<any> {
				state.currentMessages = messages;
				state.capturedReasoning = '';
				try {
					let lastChunk: any;
					for await (const chunk of originalStream(messages, callOptions, runManager)) {
						lastChunk = chunk;
						yield chunk;
					}
					// Stamp reasoning_content on the last chunk's message after all chunks yielded
					if (lastChunk?.message && state.capturedReasoning) {
						lastChunk.message.additional_kwargs = lastChunk.message.additional_kwargs ?? {};
						lastChunk.message.additional_kwargs.reasoning_content = state.capturedReasoning;
					}
				} finally {
					state.currentMessages = [];
					state.capturedReasoning = '';
				}
			};
		}

		return { response: model };
	}
}
