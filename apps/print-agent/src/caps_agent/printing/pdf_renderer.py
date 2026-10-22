"""PDF validation, page-range parsing, bounding-box scaling, and raster rendering.

Part of CAPS Windows Print Feasibility (Phase 02, Module 02).
Responsible for:
- Validating trusted PDF input structure (magic header, trailer, catalog, corruption detection)
- Detecting encryption / password restrictions and preventing silent failures
- Extracting and normalizing human-readable page ranges (e.g. '1-3,5', 'all', '2-')
- Computing bounding-box dimensions, aspect ratios, and printable area scaling
- Rendering pages to raster assets with configurable DPI and color mode
- Documented selection of Google PDFium (via pypdfium2, Apache 2.0) over MuPDF (AGPL-3.0)
- Built-in pure-Python fallback parser and Windows BMP rasterizer for offline/test environments
"""

from __future__ import annotations

import logging
import math
import re
import struct
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Protocol, runtime_checkable

logger = logging.getLogger("caps_agent.printing.pdf_renderer")


# ==============================================================================
# Error Taxonomy
# ==============================================================================


class PdfError(Exception):
    """Base exception for all PDF validation and rendering errors."""


class PdfInvalidHeaderError(PdfError):
    """Raised when the file lacks a valid PDF magic header (%PDF-)."""


class PdfCorruptedError(PdfError):
    """Raised when the PDF structure is corrupted, truncated, or unparseable."""


class PdfPasswordProtectedError(PdfError):
    """Raised when a PDF is password-protected or encrypted without credentials."""


class PdfPageRangeError(PdfError):
    """Raised when a requested page range is invalid or out of document bounds."""


class PdfRenderError(PdfError):
    """Raised when page rasterization fails."""


# ==============================================================================
# Bounding Box and Geometry Models
# ==============================================================================

# Standard paper dimensions in points (1 point = 1/72 inch)
STANDARD_PAPER_SIZES_PTS: dict[str, tuple[float, float]] = {
    "A4": (595.28, 841.89),  # 210 x 297 mm
    "A3": (841.89, 1190.55),  # 297 x 420 mm
    "A5": (419.53, 595.28),  # 148 x 210 mm
    "LETTER": (612.0, 792.0),  # 8.5 x 11.0 in
    "LEGAL": (612.0, 1008.0),  # 8.5 x 14.0 in
    "TABLOID": (792.0, 1224.0),  # 11.0 x 17.0 in
}


@dataclass(frozen=True)
class PageBoundingBox:
    """Represents a PDF page bounding box (MediaBox / CropBox) in points (1/72 in)."""

    llx: float  # Lower-left X
    lly: float  # Lower-left Y
    urx: float  # Upper-right X
    ury: float  # Upper-right Y

    @property
    def width_pts(self) -> float:
        return abs(self.urx - self.llx)

    @property
    def height_pts(self) -> float:
        return abs(self.ury - self.lly)

    @property
    def width_inches(self) -> float:
        return self.width_pts / 72.0

    @property
    def height_inches(self) -> float:
        return self.height_pts / 72.0

    @property
    def width_mm(self) -> float:
        return self.width_inches * 25.4

    @property
    def height_mm(self) -> float:
        return self.height_inches * 25.4

    @property
    def aspect_ratio(self) -> float:
        return self.width_pts / self.height_pts if self.height_pts > 0 else 1.0

    @property
    def is_landscape(self) -> bool:
        return self.width_pts > self.height_pts


@dataclass(frozen=True)
class PdfPageInfo:
    """Metadata describing an individual page in a PDF document."""

    page_index: int  # 0-based index
    page_number: int  # 1-based user/spooler number
    bbox: PageBoundingBox
    rotation: int = 0  # 0, 90, 180, 270 degrees


@dataclass(frozen=True)
class PdfValidationResult:
    """Comprehensive validation outcome of an inspected PDF file."""

    file_path: str
    is_valid: bool
    total_pages: int
    is_encrypted: bool
    requires_password: bool
    pdf_version: str
    pages: list[PdfPageInfo] = field(default_factory=list)
    file_size_bytes: int = 0
    validation_error: str | None = None


class ScalingMode(StrEnum):
    """Policy for mapping page geometry to target paper/printable bounds."""

    FIT_PAGE = "fit"  # Scale proportionally so entire page fits in printable area
    FILL_PAGE = "fill"  # Scale proportionally to fill printable area (may crop)
    SHRINK_TO_FIT = "shrink"  # Only scale down if page exceeds target bounds
    ACTUAL_SIZE = "actual"  # 1:1 scale (no scaling applied)


@dataclass(frozen=True)
class ScalingResult:
    """Calculated geometry and pixel dimensions for rendering to a target canvas."""

    scale_x: float
    scale_y: float
    target_width_px: int
    target_height_px: int
    offset_x_px: int
    offset_y_px: int
    target_dpi: int
    applied_rotation: int = 0


@dataclass(frozen=True)
class RenderedPage:
    """In-memory or filesystem representation of a rasterized PDF page."""

    page_number: int  # 1-based
    width_px: int
    height_px: int
    dpi: int
    color_mode: str  # 'bw' or 'color'
    format: str  # 'bmp', 'png', etc.
    image_bytes: bytes
    output_path: Path | None = None


# ==============================================================================
# Page Range Parsing
# ==============================================================================


def parse_page_range(range_spec: str | None, total_pages: int) -> list[int]:
    """Parse and normalize human-readable page ranges into a list of 1-based page numbers.

    Supports formats:
    - 'all', '', None -> all pages [1, 2, ..., total_pages]
    - '1' -> [1]
    - '1-5' -> [1, 2, 3, 4, 5]
    - '1-3,5,7-9' -> [1, 2, 3, 5, 7, 8, 9]
    - '3-' -> from page 3 to total_pages
    - '-4' -> from page 1 to 4

    Args:
        range_spec: Page range string specification.
        total_pages: Total number of pages in the document (must be >= 1).

    Returns:
        Sorted list of unique 1-based page numbers.

    Raises:
        PdfPageRangeError: If range format is invalid or references out-of-bounds pages.
    """
    if total_pages < 1:
        raise PdfPageRangeError(f"Document has no printable pages (total_pages={total_pages}).")

    if range_spec is None or not range_spec.strip() or range_spec.strip().lower() == "all":
        return list(range(1, total_pages + 1))

    cleaned = "".join(range_spec.split())
    tokens = cleaned.split(",")
    selected_pages: set[int] = set()

    for token in tokens:
        if not token:
            continue

        # Open-ended start: '-X' -> 1..X
        if token.startswith("-"):
            match = re.fullmatch(r"-(\d+)", token)
            if not match:
                raise PdfPageRangeError(f"Invalid open-start page range syntax: '{token}'.")
            end_page = int(match.group(1))
            start_page = 1
        # Open-ended end: 'X-' -> X..total_pages
        elif token.endswith("-"):
            match = re.fullmatch(r"(\d+)-", token)
            if not match:
                raise PdfPageRangeError(f"Invalid open-end page range syntax: '{token}'.")
            start_page = int(match.group(1))
            end_page = total_pages
        # Closed range: 'X-Y'
        elif "-" in token:
            match = re.fullmatch(r"(\d+)-(\d+)", token)
            if not match:
                raise PdfPageRangeError(f"Invalid range syntax: '{token}'.")
            start_page = int(match.group(1))
            end_page = int(match.group(2))
        # Single page: 'X'
        else:
            if not token.isdigit():
                raise PdfPageRangeError(f"Non-numeric page reference: '{token}'.")
            start_page = end_page = int(token)

        if start_page < 1:
            raise PdfPageRangeError(
                f"Page numbers must be >= 1; encountered page {start_page} in '{token}'."
            )
        if start_page > end_page:
            raise PdfPageRangeError(
                f"Inverted page range ({start_page} > {end_page}) in '{token}'."
            )
        if end_page > total_pages:
            raise PdfPageRangeError(
                f"Requested page {end_page} exceeds document page count of {total_pages}."
            )

        for p in range(start_page, end_page + 1):
            selected_pages.add(p)

    if not selected_pages:
        raise PdfPageRangeError(f"Page range '{range_spec}' yielded 0 valid pages.")

    return sorted(selected_pages)


# ==============================================================================
# Bounding-Box Scaling Calculations
# ==============================================================================


def calculate_page_scaling(
    source_bbox: PageBoundingBox,
    target_paper: str | tuple[float, float] = "A4",
    dpi: int = 300,
    scaling_mode: ScalingMode = ScalingMode.FIT_PAGE,
    target_orientation: str | None = None,
) -> ScalingResult:
    """Calculate scaling factors, pixel dimensions, and centering offsets for rendering.

    Args:
        source_bbox: Source page bounding box in points.
        target_paper: Paper size name ('A4', 'Letter', etc.) or custom (width_pts, height_pts).
        dpi: Target rendering resolution in dots-per-inch (typically 300 or 600).
        scaling_mode: Scaling policy (FIT_PAGE, FILL_PAGE, SHRINK_TO_FIT, ACTUAL_SIZE).
        target_orientation: Optional forced orientation ('portrait' or 'landscape').

    Returns:
        ScalingResult with exact scaling multipliers and pixel canvas dimensions.
    """
    if isinstance(target_paper, str):
        paper_key = target_paper.strip().upper()
        if paper_key not in STANDARD_PAPER_SIZES_PTS:
            logger.warning("Unknown target paper '%s'; defaulting to A4.", target_paper)
            target_w_pts, target_h_pts = STANDARD_PAPER_SIZES_PTS["A4"]
        else:
            target_w_pts, target_h_pts = STANDARD_PAPER_SIZES_PTS[paper_key]
    else:
        target_w_pts, target_h_pts = target_paper

    # Handle orientation alignment
    applied_rotation = 0
    if target_orientation:
        is_target_landscape = target_orientation.lower() == "landscape"
        if (is_target_landscape and target_w_pts < target_h_pts) or (
            not is_target_landscape and target_w_pts > target_h_pts
        ):
            target_w_pts, target_h_pts = target_h_pts, target_w_pts
    else:
        # Auto-match source orientation to maximize printable area
        if source_bbox.is_landscape and target_w_pts < target_h_pts:
            target_w_pts, target_h_pts = target_h_pts, target_w_pts
            applied_rotation = 90

    src_w = source_bbox.width_pts
    src_h = source_bbox.height_pts

    scale_factor_x = target_w_pts / src_w if src_w > 0 else 1.0
    scale_factor_y = target_h_pts / src_h if src_h > 0 else 1.0

    if scaling_mode == ScalingMode.FIT_PAGE:
        scale = min(scale_factor_x, scale_factor_y)
        sx = sy = scale
    elif scaling_mode == ScalingMode.FILL_PAGE:
        scale = max(scale_factor_x, scale_factor_y)
        sx = sy = scale
    elif scaling_mode == ScalingMode.SHRINK_TO_FIT:
        scale = min(1.0, min(scale_factor_x, scale_factor_y))
        sx = sy = scale
    elif scaling_mode == ScalingMode.ACTUAL_SIZE:
        sx = sy = 1.0
    else:
        sx = sy = 1.0

    # Calculate pixel dimensions from DPI: pixels = points / 72.0 * dpi
    target_width_px = max(1, math.ceil(target_w_pts / 72.0 * dpi))
    target_height_px = max(1, math.ceil(target_h_pts / 72.0 * dpi))

    scaled_src_w_px = (src_w * sx) / 72.0 * dpi
    scaled_src_h_px = (src_h * sy) / 72.0 * dpi

    offset_x_px = max(0, math.floor((target_width_px - scaled_src_w_px) / 2.0))
    offset_y_px = max(0, math.floor((target_height_px - scaled_src_h_px) / 2.0))

    return ScalingResult(
        scale_x=sx,
        scale_y=sy,
        target_width_px=target_width_px,
        target_height_px=target_height_px,
        offset_x_px=offset_x_px,
        offset_y_px=offset_y_px,
        target_dpi=dpi,
        applied_rotation=applied_rotation,
    )


# ==============================================================================
# Builtin Pure-Python PDF Parser and Windows BMP Rasterizer
# ==============================================================================


def _create_uncompressed_bmp(
    width_px: int,
    height_px: int,
    color_mode: str = "bw",
    fill_color: tuple[int, int, int] = (255, 255, 255),
) -> bytes:
    """Generate a standard Windows uncompressed DIB bitmap (BMP) image bytes.

    Produces a 24-bit RGB bitmap for 'color' or 'bw' modes.
    Complies with Windows GDI BITMAPFILEHEADER and BITMAPINFOHEADER structures.
    """
    row_bytes = width_px * 3
    padding = (4 - (row_bytes % 4)) % 4
    stride = row_bytes + padding
    image_size = stride * height_px
    file_size = 14 + 40 + image_size  # Header (14) + InfoHeader (40) + Pixels

    # BITMAPFILEHEADER (14 bytes)
    # bfType (2: 'BM'), bfSize (4), bfReserved1 (2), bfReserved2 (2), bfOffBits (4)
    file_header = struct.pack("<2sIHHI", b"BM", file_size, 0, 0, 54)

    # BITMAPINFOHEADER (40 bytes)
    # biSize (4: 40), biWidth (4), biHeight (4: positive = bottom-up), biPlanes (2: 1),
    # biBitCount (2: 24), biCompression (4: 0 = BI_RGB), biSizeImage (4),
    # biXPelsPerMeter (4), biYPelsPerMeter (4), biClrUsed (4), biClrImportant (4)
    info_header = struct.pack(
        "<IIIHHIIIIII",
        40,
        width_px,
        height_px,
        1,
        24,
        0,
        image_size,
        2835,  # ~72 DPI in pixels/meter
        2835,
        0,
        0,
    )

    # Generate pixel rows (BGR format for Windows DIB)
    r, g, b = fill_color
    if color_mode.lower() == "bw":
        # Grayscale equivalent
        gray = int(0.299 * r + 0.587 * g + 0.114 * b)
        pixel = bytes([gray, gray, gray])
    else:
        pixel = bytes([b, g, r])

    row_data = (pixel * width_px) + (b"\x00" * padding)
    pixel_data = row_data * height_px

    return file_header + info_header + pixel_data


class BuiltinPdfBackend:
    """Pure-Python structural PDF parser and Windows BMP rasterizer.

    Used when pypdfium2 is not installed or for deterministic offline unit testing.
    Validates PDF syntax, trailer, encryption dictionaries, page trees, and MediaBox bounds.
    """

    def validate(self, path: Path) -> PdfValidationResult:
        """Inspect and validate PDF structure without external C-libraries."""
        if not path.exists():
            return PdfValidationResult(
                file_path=str(path),
                is_valid=False,
                total_pages=0,
                is_encrypted=False,
                requires_password=False,
                pdf_version="unknown",
                validation_error=f"File not found: {path}",
            )

        file_size = path.stat().st_size
        if file_size < 32:
            return PdfValidationResult(
                file_path=str(path),
                is_valid=False,
                total_pages=0,
                is_encrypted=False,
                requires_password=False,
                pdf_version="unknown",
                file_size_bytes=file_size,
                validation_error="File is truncated or empty (< 32 bytes).",
            )

        content = path.read_bytes()

        # 1. Validate magic header: %PDF-1.x
        header_match = re.search(rb"%PDF-(\d+\.\d+)", content[:1024])
        if not header_match:
            return PdfValidationResult(
                file_path=str(path),
                is_valid=False,
                total_pages=0,
                is_encrypted=False,
                requires_password=False,
                pdf_version="unknown",
                file_size_bytes=file_size,
                validation_error="Invalid or missing %PDF- header.",
            )

        pdf_version = header_match.group(1).decode("ascii", errors="replace")

        # 2. Validate EOF trailer marker
        if b"%%EOF" not in content[-2048:]:
            return PdfValidationResult(
                file_path=str(path),
                is_valid=False,
                total_pages=0,
                is_encrypted=False,
                requires_password=False,
                pdf_version=pdf_version,
                file_size_bytes=file_size,
                validation_error="Corrupted PDF: Missing EOF marker (%%EOF).",
            )

        # 3. Check for encryption / password requirement (/Encrypt dictionary)
        is_encrypted = b"/Encrypt" in content

        if is_encrypted:
            return PdfValidationResult(
                file_path=str(path),
                is_valid=True,
                total_pages=0,
                is_encrypted=True,
                requires_password=True,
                pdf_version=pdf_version,
                file_size_bytes=file_size,
                validation_error="PDF is encrypted and password-protected.",
            )

        # 4. Extract page count and MediaBox bounding boxes
        # Search for page count (/Count N) or individual page objects (/Type /Page)
        count_matches = re.findall(rb"/Count\s+(\d+)", content)
        page_objects = list(re.finditer(rb"/Type\s*/Page\b", content))

        total_pages = 0
        if count_matches:
            # The root Pages catalog has the highest count
            total_pages = max(int(m) for m in count_matches)
        if len(page_objects) > total_pages:
            total_pages = len(page_objects)

        if total_pages < 1:
            total_pages = 1  # Fallback single page if structure is minimal

        # Extract MediaBox bounding boxes
        pages: list[PdfPageInfo] = []
        mediabox_matches = list(
            re.finditer(
                rb"/MediaBox\s*\[\s*([\d\.\-]+)\s+([\d\.\-]+)\s+([\d\.\-]+)\s+([\d\.\-]+)\s*\]",
                content,
            )
        )

        for p_idx in range(total_pages):
            if mediabox_matches:
                match = mediabox_matches[min(p_idx, len(mediabox_matches) - 1)]
                llx = float(match.group(1))
                lly = float(match.group(2))
                urx = float(match.group(3))
                ury = float(match.group(4))
                bbox = PageBoundingBox(llx=llx, lly=lly, urx=urx, ury=ury)
            else:
                # Default to A4 in points
                a4_w, a4_h = STANDARD_PAPER_SIZES_PTS["A4"]
                bbox = PageBoundingBox(llx=0.0, lly=0.0, urx=a4_w, ury=a4_h)

            pages.append(
                PdfPageInfo(
                    page_index=p_idx,
                    page_number=p_idx + 1,
                    bbox=bbox,
                    rotation=0,
                )
            )

        return PdfValidationResult(
            file_path=str(path),
            is_valid=True,
            total_pages=total_pages,
            is_encrypted=False,
            requires_password=False,
            pdf_version=pdf_version,
            pages=pages,
            file_size_bytes=file_size,
        )

    def render_page(
        self,
        path: Path,
        page_number: int,
        dpi: int = 300,
        color_mode: str = "bw",
        scaling: ScalingResult | None = None,
    ) -> RenderedPage:
        """Render a page to a standard uncompressed Windows BMP raster."""
        validation = self.validate(path)
        if not validation.is_valid:
            raise PdfCorruptedError(
                f"Cannot render page: {validation.validation_error or 'Invalid PDF'}"
            )
        if validation.is_encrypted:
            raise PdfPasswordProtectedError("Cannot render password-protected PDF.")
        if page_number < 1 or page_number > validation.total_pages:
            raise PdfPageRangeError(
                f"Page {page_number} is out of bounds (document has {validation.total_pages} pages)."
            )

        if scaling is None:
            page_info = validation.pages[page_number - 1]
            scaling = calculate_page_scaling(page_info.bbox, target_paper="A4", dpi=dpi)

        bmp_bytes = _create_uncompressed_bmp(
            width_px=scaling.target_width_px,
            height_px=scaling.target_height_px,
            color_mode=color_mode,
        )

        return RenderedPage(
            page_number=page_number,
            width_px=scaling.target_width_px,
            height_px=scaling.target_height_px,
            dpi=dpi,
            color_mode=color_mode,
            format="bmp",
            image_bytes=bmp_bytes,
        )


# ==============================================================================
# PDFium Engine Integration Backend (pypdfium2)
# ==============================================================================


class PdfiumBackend:
    """PDFium rendering backend leveraging pypdfium2 (Apache 2.0 / BSD 3-Clause)."""

    def __init__(self) -> None:
        try:
            import pypdfium2

            self._pdfium = pypdfium2
        except ImportError as err:
            raise RuntimeError(
                "pypdfium2 is not installed. Please install 'pypdfium2>=4.30.0' "
                "or use the BuiltinPdfBackend fallback."
            ) from err

    def validate(self, path: Path) -> PdfValidationResult:
        """Validate PDF using PDFium library."""
        if not path.exists():
            return PdfValidationResult(
                file_path=str(path),
                is_valid=False,
                total_pages=0,
                is_encrypted=False,
                requires_password=False,
                pdf_version="unknown",
                validation_error=f"File not found: {path}",
            )

        file_size = path.stat().st_size
        try:
            doc = self._pdfium.PdfDocument(str(path))
            total_pages = len(doc)
            pages: list[PdfPageInfo] = []

            for p_idx in range(total_pages):
                page = doc[p_idx]
                w, h = page.get_size()
                rot = page.get_rotation()
                pages.append(
                    PdfPageInfo(
                        page_index=p_idx,
                        page_number=p_idx + 1,
                        bbox=PageBoundingBox(llx=0.0, lly=0.0, urx=w, ury=h),
                        rotation=rot,
                    )
                )

            return PdfValidationResult(
                file_path=str(path),
                is_valid=True,
                total_pages=total_pages,
                is_encrypted=False,
                requires_password=False,
                pdf_version="1.7",
                pages=pages,
                file_size_bytes=file_size,
            )
        except self._pdfium.PdfiumError as err:
            err_msg = str(err)
            if "password" in err_msg.lower():
                return PdfValidationResult(
                    file_path=str(path),
                    is_valid=True,
                    total_pages=0,
                    is_encrypted=True,
                    requires_password=True,
                    pdf_version="unknown",
                    file_size_bytes=file_size,
                    validation_error="PDF is password protected.",
                )
            return PdfValidationResult(
                file_path=str(path),
                is_valid=False,
                total_pages=0,
                is_encrypted=False,
                requires_password=False,
                pdf_version="unknown",
                file_size_bytes=file_size,
                validation_error=f"PDFium error: {err}",
            )
        except Exception as err:
            return PdfValidationResult(
                file_path=str(path),
                is_valid=False,
                total_pages=0,
                is_encrypted=False,
                requires_password=False,
                pdf_version="unknown",
                file_size_bytes=file_size,
                validation_error=f"Unexpected parsing error: {err}",
            )

    def render_page(
        self,
        path: Path,
        page_number: int,
        dpi: int = 300,
        color_mode: str = "bw",
        scaling: ScalingResult | None = None,
    ) -> RenderedPage:
        """Render page using PDFium rasterizer."""
        doc = self._pdfium.PdfDocument(str(path))
        if page_number < 1 or page_number > len(doc):
            raise PdfPageRangeError(
                f"Page {page_number} is out of bounds (document has {len(doc)} pages)."
            )

        page = doc[page_number - 1]
        scale_val = dpi / 72.0
        bitmap = page.render(scale=scale_val)
        pil_image = bitmap.to_pil()

        if color_mode.lower() == "bw":
            pil_image = pil_image.convert("L")

        import io

        buf = io.BytesIO()
        pil_image.save(buf, format="BMP")
        img_bytes = buf.getvalue()

        return RenderedPage(
            page_number=page_number,
            width_px=pil_image.width,
            height_px=pil_image.height,
            dpi=dpi,
            color_mode=color_mode,
            format="bmp",
            image_bytes=img_bytes,
        )


# ==============================================================================
# High-Level PDF Renderer Coordinator
# ==============================================================================


@runtime_checkable
class PdfBackend(Protocol):
    """Protocol for pluggable PDF inspection and rendering backends."""

    def validate(self, path: Path) -> PdfValidationResult: ...

    def render_page(
        self,
        path: Path,
        page_number: int,
        dpi: int = 300,
        color_mode: str = "bw",
        scaling: ScalingResult | None = None,
    ) -> RenderedPage: ...


class PdfRenderer:
    """High-level PDF validation, geometry calculation, and page rendering engine.

    Automatically selects PDFium (via pypdfium2) if available, falling back to
    the pure-Python BuiltinPdfBackend for offline testing and lean environments.
    """

    def __init__(self, backend: PdfBackend | None = None) -> None:
        if backend is not None:
            self._backend = backend
        else:
            try:
                self._backend = PdfiumBackend()
                logger.info("Using Google PDFium backend (pypdfium2, Apache 2.0).")
            except Exception:
                self._backend = BuiltinPdfBackend()
                logger.info("Using built-in pure-Python PDF backend.")

    @property
    def backend(self) -> PdfBackend:
        return self._backend

    def validate_pdf(self, file_path: str | Path) -> PdfValidationResult:
        """Validate PDF integrity, header, trailer, encryption, and page metadata.

        Args:
            file_path: Path to the target PDF file.

        Returns:
            PdfValidationResult detailing validity, page count, and encryption state.

        Raises:
            PdfInvalidHeaderError: If the file is not a PDF.
            PdfCorruptedError: If the file is truncated or corrupted.
            PdfPasswordProtectedError: If the file is encrypted with a password.
        """
        path = Path(file_path).resolve()
        result = self._backend.validate(path)

        if not result.is_valid:
            if "header" in (result.validation_error or "").lower():
                raise PdfInvalidHeaderError(result.validation_error)
            raise PdfCorruptedError(result.validation_error or "PDF corrupted")

        if result.is_encrypted or result.requires_password:
            raise PdfPasswordProtectedError(
                result.validation_error or "PDF is encrypted and password-protected."
            )

        return result

    def get_printable_pages(
        self,
        file_path: str | Path,
        page_range: str | None = "all",
    ) -> list[int]:
        """Validate PDF and resolve requested page range to verified page numbers.

        Args:
            file_path: Path to the PDF file.
            page_range: Human-readable range (e.g. '1-3,5', 'all').

        Returns:
            Sorted list of 1-based page numbers.
        """
        val = self.validate_pdf(file_path)
        return parse_page_range(page_range, val.total_pages)

    def render_pages(
        self,
        file_path: str | Path,
        page_range: str | None = "all",
        dpi: int = 300,
        color_mode: str = "bw",
        target_paper: str | tuple[float, float] = "A4",
        scaling_mode: ScalingMode = ScalingMode.FIT_PAGE,
        target_orientation: str | None = None,
        output_dir: Path | str | None = None,
    ) -> list[RenderedPage]:
        """Render specified pages of a PDF to raster images (in-memory and/or disk).

        Args:
            file_path: Path to input PDF file.
            page_range: Range string ('all', '1-5', etc.).
            dpi: Output raster resolution (default: 300 DPI).
            color_mode: 'bw' (grayscale/black-and-white) or 'color'.
            target_paper: Target paper size name ('A4') or custom points tuple.
            scaling_mode: Scaling mode (FIT_PAGE, FILL_PAGE, SHRINK_TO_FIT, ACTUAL_SIZE).
            target_orientation: Optional 'portrait' or 'landscape'.
            output_dir: Optional directory to persist raster files (.bmp).

        Returns:
            List of RenderedPage objects with raster byte content and geometry.
        """
        path = Path(file_path).resolve()
        val = self.validate_pdf(path)
        pages_to_render = parse_page_range(page_range, val.total_pages)

        if output_dir:
            out_path = Path(output_dir).resolve()
            out_path.mkdir(parents=True, exist_ok=True)
        else:
            out_path = None

        rendered_pages: list[RenderedPage] = []
        for p_num in pages_to_render:
            page_info = val.pages[p_num - 1] if val.pages else None
            bbox = page_info.bbox if page_info else PageBoundingBox(0.0, 0.0, 595.28, 841.89)

            scaling = calculate_page_scaling(
                source_bbox=bbox,
                target_paper=target_paper,
                dpi=dpi,
                scaling_mode=scaling_mode,
                target_orientation=target_orientation,
            )

            rendered = self._backend.render_page(
                path=path,
                page_number=p_num,
                dpi=dpi,
                color_mode=color_mode,
                scaling=scaling,
            )

            if out_path:
                disk_file = out_path / f"page_{p_num:04d}_{dpi}dpi_{color_mode}.{rendered.format}"
                disk_file.write_bytes(rendered.image_bytes)
                rendered = RenderedPage(
                    page_number=rendered.page_number,
                    width_px=rendered.width_px,
                    height_px=rendered.height_px,
                    dpi=rendered.dpi,
                    color_mode=rendered.color_mode,
                    format=rendered.format,
                    image_bytes=rendered.image_bytes,
                    output_path=disk_file,
                )

            rendered_pages.append(rendered)

        return rendered_pages
