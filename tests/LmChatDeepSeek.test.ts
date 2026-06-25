import { LmChatDeepSeek } from '../nodes/LmChatDeepSeek/LmChatDeepSeek.node';

// Mock các thư viện bên ngoài để tránh gọi API thực tế và lỗi prototype
class MockChatOpenAI {
	config: any;
	constructor(config: any) {
		this.config = config;
	}
	async _generate(messages: any[], callOptions: any, runManager?: any) {
		return {
			generations: [
				{
					message: {
						content: 'mock response',
						additional_kwargs: {
							reasoning_content: 'mock reasoning'
						}
					}
				}
			]
		};
	}
	async * _streamResponseChunks(messages: any[], callOptions: any, runManager?: any) {
		yield { content: 'chunk' };
	}
}

jest.mock('@langchain/openai', () => {
	return {
		ChatOpenAI: MockChatOpenAI
	};
});

jest.mock('@n8n/ai-utilities', () => {
	return {
		N8nLlmTracing: jest.fn().mockImplementation(() => ({})),
		logWrapper: jest.fn().mockImplementation((provider) => provider)
	};
});

describe('LmChatDeepSeek Community Node', () => {
	let node: LmChatDeepSeek;
	let mockSupplyDataContext: any;

	beforeEach(() => {
		node = new LmChatDeepSeek();
		mockSupplyDataContext = {
			getNodeParameter: jest.fn().mockImplementation((paramName, index, fallback) => {
				if (paramName === 'model') return 'deepseek-chat';
				if (paramName === 'customModel') return '';
				if (paramName === 'thinkingEnabled') return true;
				if (paramName === 'thinkingEffort') return 'high';
				if (paramName === 'options') return {};
				return fallback;
			}),
			getCredentials: jest.fn().mockResolvedValue({
				apiKey: 'sk_test_key_123',
				baseUrl: 'https://api.deepseek.com'
			}),
			getNode: jest.fn().mockReturnValue({ name: 'DeepSeek Chat Model (Preserved Reasoning)' })
		};
	});

	test('should define correct node description', () => {
		expect(node.description.displayName).toBe('DeepSeek Chat Model (Preserved Reasoning)');
		expect(node.description.name).toBe('lmChatDeepSeek');
		expect(node.description.icon).toBe('file:deepseek.png');
		expect(node.description.inputs).toEqual([]);
		expect(node.description.outputs).toContain('ai_languageModel');
	});

	test('Happy Path: should successfully instantiate chat model with thinking enabled', async () => {
		const result = (await node.supplyData.call(mockSupplyDataContext, 0)) as any;

		expect(result).toBeDefined();
		expect(result.response).toBeDefined();
		expect(result.response.config.model).toBe('deepseek-chat');
		expect(result.response.config.modelKwargs.thinking.type).toBe('enabled');
		expect(result.response.config.modelKwargs.reasoning_effort).toBe('high');
	});

	test('Missing Data: should apply defaults for custom model and other fields', async () => {
		// Giả lập options trống và model custom
		mockSupplyDataContext.getNodeParameter = jest.fn().mockImplementation((paramName, index, fallback) => {
			if (paramName === 'model') return 'custom';
			if (paramName === 'customModel') return 'my-custom-deepseek-model';
			if (paramName === 'thinkingEnabled') return false;
			if (paramName === 'options') return { temperature: 0.9 };
			return fallback;
		});

		const result = (await node.supplyData.call(mockSupplyDataContext, 0)) as any;

		expect(result.response.config.model).toBe('my-custom-deepseek-model');
		expect(result.response.config.modelKwargs.thinking.type).toBe('disabled');
		expect(result.response.config.temperature).toBe(0.9);
	});

	test('Backward Compatibility: should successfully parse string-based oneShotTools', async () => {
		mockSupplyDataContext.getNodeParameter = jest.fn().mockImplementation((paramName, index, fallback) => {
			if (paramName === 'model') return 'deepseek-v4-flash';
			if (paramName === 'thinkingEnabled') return false;
			if (paramName === 'options') return { oneShotTools: 'old_tool_1, old_tool_2' };
			return fallback;
		});

		const result = (await node.supplyData.call(mockSupplyDataContext, 0)) as any;
		expect(result.response.oneShotToolsList).toEqual(['old_tool_1', 'old_tool_2']);
	});

	test('Thinking Mode: should preserve and inject reasoning_content into assistant messages', async () => {
		const result = (await node.supplyData.call(mockSupplyDataContext, 0)) as any;
		const deepseekModel = result.response as any;

		const mockAIMessage = {
			_getType: () => 'ai',
			additional_kwargs: {
				reasoning_content: 'This is my internal thinking.'
			}
		};

		// Chạy phương thức tĩnh injectReasoning để kiểm tra logic biến đổi tin nhắn của DeepSeek
		const DeepSeekCorrectedClass = deepseekModel.constructor as any;
		const patchedMessages = DeepSeekCorrectedClass.injectReasoning([mockAIMessage], true);

		expect(patchedMessages[0].reasoning_content).toBe('This is my internal thinking.');
		expect(patchedMessages[0].additional_kwargs.reasoning_content).toBe('This is my internal thinking.');
	});

	test('Anti-Loop and Execution Caps: patchMessagesAndCallOptions logic', async () => {
		const result = (await node.supplyData.call(mockSupplyDataContext, 0)) as any;
		const DeepSeekCorrectedClass = result.response.constructor as any;

		class MockHumanMessage {
			content: string;
			constructor(content: string) {
				this.content = content;
			}
		}

		// Helper to construct AI messages with tool calls
		const makeAIMessage = (toolCalls: Array<{ name: string, args?: any }>) => ({
			_getType: () => 'ai',
			tool_calls: toolCalls.map((tc, i) => ({
				id: `call_${i}`,
				name: tc.name,
				args: tc.args || {}
			}))
		});

		// 1. One-Shot limits check
		{
			const messages = [
				makeAIMessage([{ name: 'one_shot_tool', args: { query: 'test' } }])
			];
			const callOptions = {
				tools: [
					{ function: { name: 'one_shot_tool', parameters: { type: 'object', properties: { query: { type: 'string' } } } } },
					{ function: { name: 'regular_tool', parameters: { type: 'object', properties: { query: { type: 'string' } } } } }
				]
			};
			const res = DeepSeekCorrectedClass.patchMessagesAndCallOptions(
				messages,
				callOptions,
				['one_shot_tool'],
				3,
				MockHumanMessage
			);
			expect(res.patchedCallOptions.tools).toBeDefined();
			// one_shot_tool should be filtered out
			expect(res.patchedCallOptions.tools.map((t: any) => t.function.name)).toEqual(['regular_tool']);
		}

		// 2. Max executions check
		{
			const messages = [
				makeAIMessage([{ name: 'test_tool', args: { q: '1' } }]),
				makeAIMessage([{ name: 'test_tool', args: { q: '2' } }]),
				makeAIMessage([{ name: 'test_tool', args: { q: '3' } }])
			];
			const callOptions = {
				tools: [
					{ function: { name: 'test_tool', parameters: { type: 'object', properties: { q: { type: 'string' } } } } }
				]
			};
			const res = DeepSeekCorrectedClass.patchMessagesAndCallOptions(
				messages,
				callOptions,
				[],
				3, // maxToolExecutions limit is 3
				MockHumanMessage
			);
			// test_tool should be filtered out because it reached 3 executions
			expect(res.patchedCallOptions.tools).toBeUndefined();
		}

		// 3. Consecutive identical signature check (2 times)
		{
			const messages = [
				makeAIMessage([{ name: 'test_tool', args: { q: 'same' } }]),
				makeAIMessage([{ name: 'test_tool', args: { q: 'same' } }])
			];
			const callOptions = {
				tools: [
					{ function: { name: 'test_tool', parameters: { type: 'object', properties: { q: { type: 'string' } } } } }
				]
			};
			const res = DeepSeekCorrectedClass.patchMessagesAndCallOptions(
				messages,
				callOptions,
				[],
				5,
				MockHumanMessage
			);
			// consecutive identical signature should trigger circuit breaker (system warning inserted and tools deleted)
			expect(res.patchedMessages.length).toBe(3);
			expect(res.patchedMessages[2]).toBeInstanceOf(MockHumanMessage);
			expect(res.patchedMessages[2].content).toContain('vòng lặp gọi công cụ với các tham số trùng lặp');
			expect(res.patchedCallOptions.tools).toBeUndefined();
		}

		// 4. Consecutive same tool name check (3 times)
		{
			const messages = [
				makeAIMessage([{ name: 'test_tool', args: { q: '1' } }]),
				makeAIMessage([{ name: 'test_tool', args: { q: '2' } }]),
				makeAIMessage([{ name: 'test_tool', args: { q: '3' } }])
			];
			const callOptions = {
				tools: [
					{ function: { name: 'test_tool', parameters: { type: 'object', properties: { q: { type: 'string' } } } } }
				]
			};
			const res = DeepSeekCorrectedClass.patchMessagesAndCallOptions(
				messages,
				callOptions,
				[],
				5, // maxToolExecutions = 5, so it's not execution cap, but consecutive name cap
				MockHumanMessage
			);
			// should trigger circuit breaker because test_tool was called 3 times consecutively
			expect(res.patchedMessages.length).toBe(4);
			expect(res.patchedMessages[3]).toBeInstanceOf(MockHumanMessage);
			expect(res.patchedMessages[3].content).toContain('lặp chuỗi');
			expect(res.patchedCallOptions.tools).toBeUndefined();
		}
	});
});
