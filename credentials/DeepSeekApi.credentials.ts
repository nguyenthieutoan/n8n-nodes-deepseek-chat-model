import type {
	ICredentialType,
	INodeProperties,
	ICredentialTestRequest,
} from 'n8n-workflow';

export class DeepSeekApi implements ICredentialType {
	name = 'deepseekApi';
	displayName = 'DeepSeek API';
	documentationUrl = 'https://api-docs.deepseek.com/';
	icon = 'file:deepseek.png' as const;
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'API Key provided in DeepSeek dashboard.',
		},
		{
			displayName: 'Base URL Override',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.deepseek.com',
			required: true,
			description: 'Base URL of the DeepSeek API or local proxy URL.',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl || "https://api.deepseek.com"}}',
			url: '/models',
			method: 'GET',
			headers: {
				'Authorization': '=Bearer {{$credentials.apiKey}}',
			},
		},
	};
}
