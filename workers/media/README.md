# workers/media

Python media worker for Doubletake. Spawned by the server as a long-lived child
process speaking JSON-lines over stdio (protocol in `docs/MEDIA-PIPELINE.md`).
Empty until **M3**.

```sh
cd workers/media && uv sync && uv run pytest
```
