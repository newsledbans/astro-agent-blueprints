# astro-agent-blueprints

A collection of agent blueprints for [astropods.com](https://astropods.com). Each subdirectory is a self-contained, deployable agent.

## Blueprints

| Blueprint | Description |
|-----------|-------------|
| [`brainstorming`](./brainstorming) | Turns rough ideas into fully-formed designs and specs through collaborative dialogue. |

## Using a blueprint

```bash
cd <blueprint-name>
bun install
ast dev
```

Each blueprint has its own `README.md` with setup details, required integrations, and environment variables.

## Contributing

To add a new blueprint, create a new top-level directory containing at minimum:
- `astropods.yml` — agent specification
- `agent/index.ts` — entry point
- `package.json`
- `README.md`

## License

MIT — see [LICENSE](./LICENSE).
