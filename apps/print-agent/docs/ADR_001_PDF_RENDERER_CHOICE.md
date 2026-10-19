# ADR 001: PDF Renderer Selection — PDFium (pypdfium2) vs MuPDF (PyMuPDF)

## Status
**Accepted**

## Context
CAPS (Cloud Automated Printing Solution) Windows Print Agent (`apps/print-agent`) is responsible for receiving print jobs from the cloud backend, validating PDF input files, parsing requested page ranges, scaling page bounding boxes to target paper/printable dimensions, and rendering raster/vector output for submission to the Windows Print Spooler.

Selecting an embedded PDF rendering engine is a foundational architecture choice for the Windows Print Agent. The two primary open-source rendering engines evaluated are:
1. **Google PDFium** (via `pypdfium2`)
2. **Artifex MuPDF** (via `PyMuPDF` / `fitz`)

## Evaluation Criteria

### 1. Licensing & Legal Compliance (Critical)
- **MuPDF (`PyMuPDF`)**:
  - Licensed under the **GNU Affero General Public License v3 (AGPL-3.0)**, or requires an expensive proprietary commercial license from Artifex Software Inc.
  - The AGPL-3.0 is a strong copyleft license with network copyleft provisions. Distributing or linking MuPDF inside the proprietary CAPS Windows Print Agent would legally mandate releasing the entire application source code and proprietary backend integrations under AGPL-3.0.
  - **Verdict**: Unacceptable for proprietary commercial software without purchasing commercial Artifex licenses.
- **PDFium (`pypdfium2`)**:
  - Originates from Google Chromium's PDF engine.
  - Licensed under **Apache License 2.0** and **BSD 3-Clause**.
  - Permissive licenses that explicitly permit commercial use, proprietary embedding, redistribution, and binary packaging without viral copyleft obligations.
  - **Verdict**: Fully compliant with CAPS proprietary distribution model.

### 2. Security & Hardening
- **PDFium**:
  - Heavily fuzzed by Google Chrome's ClusterFuzz infrastructure across billions of users.
  - Highly resilient against malicious PDF exploits, heap corruptions, and invalid object streams.
- **MuPDF**:
  - High performance, but historically higher frequency of parser CVEs compared to Chromium's sandboxed PDFium.

### 3. Packaging & Windows Runtime Compatibility
- **pypdfium2**:
  - Distributes self-contained precompiled shared libraries (`pdfium.dll`) for Windows (`x86_64`, `arm64`).
  - Seamlessly packages with PyInstaller without external C-compiler toolchains or system DLL conflicts.
  - Exposes fine-grained bitmap rendering, page geometry, bounding boxes, and encryption status.

## Decision
CAPS adopts **Google PDFium** via `pypdfium2` as the production PDF rendering engine.
In addition, the agent provides a pure-Python fallback parser (`BuiltinPdfBackend`) that can validate headers, trailers, page counts, `/Encrypt` password dictionaries, MediaBox bounding boxes, and uncompressed Windows BMP rasters for offline testing and lean environments where external binaries are not yet compiled.

## Consequences
- **Positive**:
  - Zero risk of AGPL copyleft contamination for CAPS intellectual property.
  - Native Windows x64 binary compatibility via PyInstaller.
  - Accurate page extraction, bounding-box calculation, and high-DPI rasterization.
- **Neutral**:
  - `pypdfium2` adds ~15MB to the frozen agent installer binary, which is well within acceptable limits for a Windows desktop application.
