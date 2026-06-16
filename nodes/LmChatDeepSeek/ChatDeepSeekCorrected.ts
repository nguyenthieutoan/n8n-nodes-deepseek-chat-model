import { ChatOpenAI } from '@langchain/openai';
import { BaseMessage, AIMessage } from '@langchain/core/messages';

export class ChatDeepSeekCorrected extends ChatOpenAI {
	private thinkingEnabled: boolean;
	private currentMessages: BaseMessage[] = [];

	constructor(fields: any & { thinkingEnabled?: boolean }) {
		const { thinkingEnabled, ...rest } = fields;

		// Intercept fetch requests to inject reasoning_content on outbound paths
		const originalFetch = rest.configuration?.fetch || fetch;
		const interceptingFetch = async (url: string, init?: any) => {
			if (init && init.body) {
				try {
					const body = JSON.parse(init.body);
					if (body && Array.isArray(body.messages)) {
						let modified = false;
						const rawMessages = this.currentMessages;

						if (rawMessages && rawMessages.length > 0) {
							// Filter input history messages for AIMessage
							const aiMessages = rawMessages.filter(
								(m) =>
									m instanceof AIMessage ||
									m._getType() === 'ai' ||
									m.constructor.name === 'AIMessage'
							);
							let aiMsgCount = 0;

							body.messages = body.messages.map((apiMsg: any) => {
								if (apiMsg.role === 'assistant') {
									const aiMessage = aiMessages[aiMsgCount++];
									if (aiMessage) {
										const reasoning = aiMessage.additional_kwargs?.reasoning_content;
										if (reasoning) {
											if (this.thinkingEnabled) {
												apiMsg.reasoning_content = reasoning;
												modified = true;
											} else {
												if ('reasoning_content' in apiMsg) {
													delete apiMsg.reasoning_content;
													modified = true;
												}
											}
										}
									}
								}
								return apiMsg;
							});
						}

						if (modified) {
							init.body = JSON.stringify(body);
						}
					}
				} catch (e) {
					// Ignore parsing errors
				}
			}
			return originalFetch(url, init);
		};

		if (!rest.configuration) {
			rest.configuration = {};
		}
		rest.configuration.fetch = interceptingFetch;

		super(rest);
		this.thinkingEnabled = thinkingEnabled !== false;
	}

	override async _generate(messages: BaseMessage[], options: any, runManager?: any): Promise<any> {
		this.currentMessages = messages;
		try {
			return await super._generate(messages, options, runManager);
		} finally {
			this.currentMessages = [];
		}
	}

	override async *_streamResponseChunks(messages: BaseMessage[], options: any, runManager?: any): AsyncGenerator<any> {
		this.currentMessages = messages;
		try {
			yield* super._streamResponseChunks(messages, options, runManager);
		} finally {
			this.currentMessages = [];
		}
	}
}


