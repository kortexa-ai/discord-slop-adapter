# Discord to SLOP Adapter

A lightweight adapter that connects [Discord](https://discord.com/) bots with any [SLOP](https://github.com/agnt-gg/slop) (Simple Language Open Protocol) compatible server.

## What is Discord and SLOP?

- **Discord**: A popular communication platform for communities, servers, and channels. [Learn more about Discord](https://discord.com/).
- **SLOP (Simple Language Open Protocol)**: A simple open-source REST-based pattern for AI APIs with 5 basic endpoints. [Learn more about SLOP](https://github.com/agnt-gg/slop) or join the [SLOP Discord community](https://discord.com/invite/nwXJMnHmXP).

## Features

This adapter bridges Discord and SLOP by:

- Converting Discord commands to SLOP API calls
- Exposing SLOP resources as Discord resources
- Handling error conversion between protocols

## Installation & Usage

### Using npx

You can run the adapter directly using npx:

```bash
npx @kortexa-ai/discord-slop-adapter http://your-slop-server-url
```

### Global Installation

```bash
npm install -g @kortexa-ai/discord-slop-adapter
mcp-slop-adapter http://your-slop-server-url
```

## License

MIT