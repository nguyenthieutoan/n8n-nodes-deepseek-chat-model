# n8n-nodes-deepseek-chat-model

Developed and maintained by **[Jay Nguyen (Nguyễn Thiệu Toàn)](https://nguyenthieutoan.com)**.

🛡️ **[Verified n8n Creator](https://n8n.io/creators/nguyenthieutoan)** | 💼 CEO/Founder of **[GenStaff](https://genstaff.net)**

**Connect with me:**  
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?style=flat&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/nguyenthieutoan) [![Facebook](https://img.shields.io/badge/Facebook-1877F2?style=flat&logo=facebook&logoColor=white)](https://www.facebook.com/nguyenthieutoan) [![Website](https://img.shields.io/badge/Website-nguyenthieutoan.com-brightgreen?style=flat)](https://nguyenthieutoan.com) [![Email](https://img.shields.io/badge/Email-me%40nguyenthieutoan.com-blue?style=flat)](mailto:me@nguyenthieutoan.com)


---

An optimized, community-verified n8n Chat Model node for **DeepSeek** (`deepseek-chat`, `deepseek-reasoner`, etc.) that solves the reasoning content tool-calling bug in n8n AI Agents and LangChain workflows.

## Features

* **Corrected Reasoning Logic**: Automatically preserves and passes back the `reasoning_content` field in multi-turn tool-calling loops, preventing `400 Bad Request` API errors.
* **Thinking Mode Control**: Easily toggle DeepSeek's thinking/reasoning process (Enabled/Disabled) and configure its thinking effort (`high` / `max`).
* **AI Agent & LangChain Integration**: Fully compatible with n8n AI Agent and Advanced AI nodes.
* **Fully Custom model names**: Support for standard models (`deepseek-chat`, `deepseek-reasoner`) as well as custom/self-hosted deployment models.

## Installation

Go to **Settings > Community Nodes** in your n8n instance and install:

```bash
n8n-nodes-deepseek-chat-model
```

## Credentials Configuration

1. Get your API Key from the [DeepSeek Console](https://platform.deepseek.com/).
2. In n8n, set up a new **DeepSeek API** credential:
   * **API Key**: Enter your DeepSeek API key.
   * **Base URL Override**: Default is `https://api.deepseek.com`, but can be replaced if using a proxy or local inference model (e.g. Ollama).

## License

[MIT](LICENSE)
