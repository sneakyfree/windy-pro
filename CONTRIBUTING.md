# Contributing to Windy Pro

## Development Setup

### Prerequisites
- **Node.js** 18+ and npm
- **Python** 3.10+ with venv
- **Linux** (primary target) — tested on Ubuntu 22.04+

### Clone & Install

```bash
git clone https://github.com/user/windy-pro.git
cd windy-pro

# Python backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Electron desktop client
npm install
```

### Running Locally

```bash
# Start the Python API server
source venv/bin/activate
python src/api/api.py

# In a separate terminal, start the Electron app
npm start
```

### Running Tests

```bash
source venv/bin/activate
python -m pytest tests/ --ignore=tests/test_api.py -v
```

> **Note:** `test_api.py` requires a running Python server. Run it separately with `python -m pytest tests/test_api.py -v` after starting the API.

### Project Structure

```
windy-pro/
├── src/
│   ├── api/              # Python FastAPI backend
│   │   └── api.py        # Main API server
│   ├── client/
│   │   ├── desktop/      # Electron app
│   │   │   ├── main.js   # Main process
│   │   │   ├── preload.js
│   │   │   ├── updater.js
│   │   │   └── renderer/ # UI files
│   │   └── web/          # Web client (Vite)
│   └── engine/           # Transcription engines
├── tests/                # Python test suite
├── scripts/              # Build scripts
└── resources/            # Icons, assets
```

### Code Style
- **JavaScript:** Use JSDoc for public methods. Prefer `const`/`let` over `var`.
- **Python:** Use docstrings (Google style). Type hints encouraged.
- **CSS:** Use CSS custom properties. Match the existing dark theme.

### Pull Request Process
1. Create a feature branch: `git checkout -b feat/your-feature`
2. Make changes and add tests
3. Run the test suite: `pytest tests/ --ignore=tests/test_api.py -v`
4. Submit a PR with a clear description

### Reporting Issues
Use GitHub Issues. Include:
- OS and version
- Steps to reproduce
- Expected vs actual behavior
- Console logs if available
