# Order Ease

Ordering app for Jabalpur distributor serving ~1,800 kirana retailers.
Core slice: catalogue, cart, order lifecycle, vernacular AI order capture, order desk management, Tally export.

## Environment Variables

Configure environment variables in a root `.env` file (see `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `LLM_API_KEY` | `""` | API key for the OpenAI-compatible `/chat/completions` endpoint used for LLM order capture. |
| `CAPTURE_PARSER` | `rule` | Mode for order parsing: `rule` (default), `llm`, or `auto`. |

### Parser Modes
- **`rule`** (default): High-performance, deterministic vernacular rule parser handling Hinglish, Hindi, Devanagari numerals, units (`peti`, `carton`, `packet`), and size hints.
- **`llm`**: Generative LLM parser communicating via HTTP `/chat/completions`. On any failure (timeout, HTTP 429/5xx, invalid JSON, empty output), falls back immediately to `RuleBasedParser`.
- **`auto`**: Tries the LLM parser first and gracefully falls back to `RuleBasedParser` on any failure.

## Getting Started

### Installation
```bash
pip install -r backend/requirements.txt
```

### Running Tests
```bash
pytest -v
```

### Running Backend API
```bash
uvicorn backend.app.main:app --reload
```
Interactive API documentation available at `http://127.0.0.1:8000/docs`.

