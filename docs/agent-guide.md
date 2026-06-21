# DeepSeek Chat Model — Agent Guide

> This document helps AI Agents understand and use this node when building n8n workflows.

## Overview

| Property | Value |
|----------|-------|
| **Package** | `n8n-nodes-deepseek-chat-model` |
| **Node Type** | AI Sub-node (Language Model) |
| **Connection Type** | Output: `NodeConnectionType.AiLanguageModel` |
| **Credential** | DeepSeek API |
| **n8n displayName** | `DeepSeek Chat Model` |

## What This Node Does

Provides a DeepSeek Chat Model connector for n8n's AI Agent and LangChain workflow nodes. Unlike the built-in OpenAI-compatible models, this node:

1. **Fixes the reasoning_content bug** — Automatically preserves DeepSeek's internal reasoning data (`reasoning_content`) across multi-turn tool-calling loops, preventing `400 Bad Request` errors
2. **Supports Thinking Mode** — Toggle DeepSeek's chain-of-thought reasoning on/off with configurable effort levels
3. **Custom model names** — Works with `deepseek-chat`, `deepseek-reasoner`, and custom/self-hosted deployments

## Credentials Setup

1. Go to [DeepSeek Console](https://platform.deepseek.com/) → API Keys → Create New Key
2. In n8n: Settings → Credentials → Add credential → Select **"DeepSeek API"**
3. Enter:
   - **API Key**: Your DeepSeek API key
   - **Base URL Override**: Default `https://api.deepseek.com` (change for proxy/Ollama)

## Connection Types

| Direction | Type | Description |
|-----------|------|-------------|
| Input | None | Sub-node — no direct input connection |
| Output | `AiLanguageModel` | Connects to AI Agent, LLM Chain, or any node with Language Model input port |

## How to Use in Workflows

### Pattern 1: AI Agent with Tools
Connect this node to an **AI Agent** node's Language Model port. The Agent can then use tools (HTTP Request, Code, etc.) while DeepSeek's reasoning is preserved across tool calls.

### Pattern 2: Simple LLM Chain
Connect to a **Basic LLM Chain** node for direct question-answering without tools.

## Parameter Reference

| Parameter | Type | Default | Required | Description |
|-----------|------|---------|----------|-------------|
| Model Name | Options | `deepseek-chat` | Yes | Select `deepseek-chat`, `deepseek-reasoner`, or custom model name |
| Thinking Mode | Boolean | `true` | Yes | Enable/disable chain-of-thought reasoning |
| Thinking Effort | Options | `high` | Only when Thinking=true | `high` (default) or `max` (for complex logic/code) |
| Max Output Tokens | Number | `4096` | No | Maximum tokens including reasoning tokens |
| Temperature | Number | `1` | Only when Thinking=false | Creativity level (0-2). Hidden when thinking is enabled |

## Gotchas & Known Issues

- **Thinking Mode + Temperature**: When thinking mode is enabled, temperature setting is ignored by DeepSeek API. The parameter is hidden in the UI automatically.
- **Tool Calling Loop**: This node's primary value is fixing the reasoning_content serialization bug. Without it, DeepSeek + n8n AI Agent will crash on the 2nd tool call iteration.
- **Sub-node Display**: Uses `logWrapper` + prototype patching to correctly show execution glow ring and checkmark in n8n UI.
- **Performance**: Sets `callbacks: []` to prevent N8nLlmTracing from making external tiktoken requests, which can cause extreme slowness on air-gapped/firewalled n8n instances.
