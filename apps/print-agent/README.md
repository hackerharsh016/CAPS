# CAPS Desktop Print Agent

The CAPS Desktop Print Agent (`apps/print-agent`) is a background service and system tray utility designed for Windows 10/11 shop PCs. It receives authorized print jobs from the Cloud API, renders PDF documents locally, applies customer-configured print parameters (paper size, duplex, color, copies) via the Windows Print Spooler (Win32 DEVMODE), and provides status tracking while automatically cleaning up all temporary files.

## Architecture Highlights

- **Outbound-Only Connectivity:** The agent initiates outbound HTTPS/WSS connections to the Cloud API; no inbound ports are exposed to the public internet.
- **Strict Loopback Binding:** Diagnostic interfaces bind exclusively to `127.0.0.1` (`localhost`), strictly prohibiting external network access.
- **Privacy by Design:** Zero document content or sensitive tokens are written to log files. The structured logging pipeline automatically redacts secrets and PII.
- **Pluggable PrintEngine Protocol:** Core printing logic is encapsulated behind the `PrintEngine` protocol, enabling in-memory testing (`FakePrintEngine`) on any developer machine without physical printer hardware.

## Development Setup

1. **Create and activate a virtual environment:**
   ```powershell
   python -m venv .venv
   .venv\Scripts\activate
   ```

2. **Install dependencies:**
   ```powershell
   pip install -e .
   pip install pytest ruff
   ```

3. **Run tests:**
   ```powershell
   python -m unittest discover -s tests -p "test_*.py"
   # or with pytest once installed:
   pytest -v
   ```

4. **Lint and format code:**
   ```powershell
   ruff check .
   ruff format .
   ```
