"""EchoRegent fine-tuning pipeline package.

Package structure
-----------------
pipeline/
├── __init__.py          — this file
├── pipeline_config.json — shared configuration (model, paths, hyper-params)
├── requirements.txt     — Python dependencies
├── utils.py             — shared I/O helpers (JSON, JSONL, config loading)
├── data/                — data generation and preprocessing
│   ├── wordlists/       — raw wordlist assets
│   └── seeds/           — seed conversation assets
├── train/               — fine-tuning scripts and helpers
├── eval/                — evaluation scripts and metrics
├── export/              — model export and conversion utilities
└── tests/               — unit and integration tests
"""
