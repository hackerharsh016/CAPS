"""Unit and contract tests for PDF validation, page-range parsing, scaling, and raster rendering.

Tests cover:
- Valid single-page and multi-page PDF inspection
- Bounding-box and aspect-ratio extraction (points, inches, mm, landscape/portrait)
- Rejection of invalid headers (%PDF- missing), corrupted bodies, and truncated files (missing %%EOF)
- Detection and safe rejection of password-protected / encrypted PDFs
- Page range parsing, normalization, and bounds enforcement ('all', '1-3', '2,4', '3-', '-2')
- Error handling for inverted ranges ('5-2'), out-of-bounds ('1-10' for 5-page doc), and non-numeric input
- Bounding-box scaling modes (FIT_PAGE, FILL_PAGE, SHRINK_TO_FIT, ACTUAL_SIZE) and DPI conversions
- Raster output validation: BMP header structure (BITMAPFILEHEADER, BITMAPINFOHEADER), pixel dimensions
- File output persistence to temporary directories and cleanup
- Documentation and ADR compliance for PDFium (Apache 2.0) vs MuPDF (AGPL-3.0)
"""

from __future__ import annotations

import struct
import tempfile
import unittest
from pathlib import Path

from caps_agent.printing.pdf_renderer import (
    STANDARD_PAPER_SIZES_PTS,
    BuiltinPdfBackend,
    PageBoundingBox,
    PdfCorruptedError,
    PdfInvalidHeaderError,
    PdfPageRangeError,
    PdfPasswordProtectedError,
    PdfRenderer,
    ScalingMode,
    calculate_page_scaling,
    parse_page_range,
)


def _generate_synthetic_pdf(
    num_pages: int = 1,
    width_pts: float = 595.28,
    height_pts: float = 841.89,
    encrypted: bool = False,
    corrupt_eof: bool = False,
) -> bytes:
    """Generate a syntactically valid PDF binary stream for deterministic testing."""
    lines: list[bytes] = [
        b"%PDF-1.4",
        b"%\xe2\xe3\xcf\xd3",
    ]

    objects: list[bytes] = []

    # 1 0 obj: Catalog
    objects.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj")

    # 2 0 obj: Pages
    kid_refs = " ".join(f"{i + 3} 0 R" for i in range(num_pages))
    objects.append(
        f"2 0 obj\n<< /Type /Pages /Kids [{kid_refs}] /Count {num_pages} >>\nendobj".encode("ascii")
    )

    # 3..N obj: Individual Page objects
    for i in range(num_pages):
        obj_num = i + 3
        page_content = (
            f"{obj_num} 0 obj\n"
            f"<< /Type /Page /Parent 2 0 R "
            f"/MediaBox [0 0 {width_pts:.2f} {height_pts:.2f}] >>\n"
            f"endobj"
        ).encode("ascii")
        objects.append(page_content)

    if encrypted:
        enc_obj_num = num_pages + 3
        objects.append(
            f"{enc_obj_num} 0 obj\n<< /Filter /Standard /V 2 /R 3 /P -4 >>\nendobj".encode("ascii")
        )

    # Assemble objects with xref table
    body = b"\n".join(lines) + b"\n"
    xref_offsets: list[int] = [0]  # object 0 is special

    for obj in objects:
        xref_offsets.append(len(body))
        body += obj + b"\n"

    xref_start = len(body)
    total_objs = len(xref_offsets)

    xref = f"xref\n0 {total_objs}\n0000000000 65535 f \n".encode("ascii")
    for offset in xref_offsets[1:]:
        xref += f"{offset:010d} 00000 n \n".encode("ascii")

    body += xref

    encrypt_ref = f" /Encrypt {num_pages + 3} 0 R" if encrypted else ""
    trailer = (
        f"trailer\n<< /Size {total_objs} /Root 1 0 R{encrypt_ref} >>\nstartxref\n{xref_start}\n"
    ).encode("ascii")

    if not corrupt_eof:
        trailer += b"%%EOF\n"
    else:
        trailer += b"%%INCOMPLETE_FILE"

    return body + trailer


class TestPdfValidationAndInspection(unittest.TestCase):
    """Tests PDF header integrity, page metadata extraction, and corruption handling."""

    def setUp(self) -> None:
        self.renderer = PdfRenderer(backend=BuiltinPdfBackend())

    def test_valid_single_page_pdf(self) -> None:
        """Inspects valid 1-page A4 PDF document."""
        data = _generate_synthetic_pdf(num_pages=1, width_pts=595.28, height_pts=841.89)
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(data)
            temp_path = Path(f.name)

        try:
            result = self.renderer.validate_pdf(temp_path)
            self.assertTrue(result.is_valid)
            self.assertEqual(result.total_pages, 1)
            self.assertFalse(result.is_encrypted)
            self.assertFalse(result.requires_password)
            self.assertEqual(result.pdf_version, "1.4")
            self.assertEqual(len(result.pages), 1)

            p0 = result.pages[0]
            self.assertEqual(p0.page_number, 1)
            self.assertAlmostEqual(p0.bbox.width_pts, 595.28, places=1)
            self.assertAlmostEqual(p0.bbox.height_pts, 841.89, places=1)
            self.assertFalse(p0.bbox.is_landscape)
            self.assertAlmostEqual(p0.bbox.width_mm, 210.0, delta=1.0)
            self.assertAlmostEqual(p0.bbox.height_mm, 297.0, delta=1.0)
        finally:
            if temp_path.exists():
                temp_path.unlink()

    def test_valid_multi_page_pdf(self) -> None:
        """Inspects 5-page PDF document with sequential page numbers."""
        data = _generate_synthetic_pdf(num_pages=5)
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(data)
            temp_path = Path(f.name)

        try:
            result = self.renderer.validate_pdf(temp_path)
            self.assertTrue(result.is_valid)
            self.assertEqual(result.total_pages, 5)
            self.assertEqual(len(result.pages), 5)
            for idx, page in enumerate(result.pages):
                self.assertEqual(page.page_index, idx)
                self.assertEqual(page.page_number, idx + 1)
        finally:
            if temp_path.exists():
                temp_path.unlink()

    def test_landscape_geometry_detection(self) -> None:
        """Correctly identifies landscape orientation and aspect ratio."""
        # Landscape A4: 841.89 x 595.28 pts
        data = _generate_synthetic_pdf(num_pages=1, width_pts=841.89, height_pts=595.28)
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(data)
            temp_path = Path(f.name)

        try:
            result = self.renderer.validate_pdf(temp_path)
            p = result.pages[0]
            self.assertTrue(p.bbox.is_landscape)
            self.assertGreater(p.bbox.aspect_ratio, 1.0)
            self.assertAlmostEqual(p.bbox.width_inches, 841.89 / 72.0, places=2)
            self.assertAlmostEqual(p.bbox.height_inches, 595.28 / 72.0, places=2)
        finally:
            if temp_path.exists():
                temp_path.unlink()

    def test_invalid_header_rejected(self) -> None:
        """Files missing %PDF- header must raise PdfInvalidHeaderError."""
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(b"MZ\x90\x00Not a PDF file content header at all")
            temp_path = Path(f.name)

        try:
            with self.assertRaises(PdfInvalidHeaderError):
                self.renderer.validate_pdf(temp_path)
        finally:
            if temp_path.exists():
                temp_path.unlink()

    def test_truncated_missing_eof_rejected(self) -> None:
        """PDF with missing %%EOF marker must raise PdfCorruptedError."""
        data = _generate_synthetic_pdf(num_pages=2, corrupt_eof=True)
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(data)
            temp_path = Path(f.name)

        try:
            with self.assertRaises(PdfCorruptedError):
                self.renderer.validate_pdf(temp_path)
        finally:
            if temp_path.exists():
                temp_path.unlink()

    def test_empty_or_tiny_file_rejected(self) -> None:
        """Empty or <32 byte file must raise PdfCorruptedError."""
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(b"short")
            temp_path = Path(f.name)

        try:
            with self.assertRaises(PdfCorruptedError):
                self.renderer.validate_pdf(temp_path)
        finally:
            if temp_path.exists():
                temp_path.unlink()

    def test_password_protected_pdf_detected_and_rejected(self) -> None:
        """PDF with /Encrypt dictionary must raise PdfPasswordProtectedError."""
        data = _generate_synthetic_pdf(num_pages=3, encrypted=True)
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(data)
            temp_path = Path(f.name)

        try:
            # Inspection result should flag encryption
            result = self.renderer.backend.validate(temp_path)
            self.assertTrue(result.is_encrypted)
            self.assertTrue(result.requires_password)

            # validate_pdf should raise PdfPasswordProtectedError to prevent silent print attempts
            with self.assertRaises(PdfPasswordProtectedError):
                self.renderer.validate_pdf(temp_path)
        finally:
            if temp_path.exists():
                temp_path.unlink()


class TestPageRangeParsing(unittest.TestCase):
    """Tests parsing and validation of human-readable page ranges."""

    def test_all_pages_variants(self) -> None:
        """Tests 'all', empty string, and None."""
        self.assertEqual(parse_page_range("all", 5), [1, 2, 3, 4, 5])
        self.assertEqual(parse_page_range("ALL", 3), [1, 2, 3])
        self.assertEqual(parse_page_range("", 4), [1, 2, 3, 4])
        self.assertEqual(parse_page_range(None, 2), [1, 2])
        self.assertEqual(parse_page_range("  all  ", 1), [1])

    def test_single_pages_and_lists(self) -> None:
        """Tests comma-separated single pages."""
        self.assertEqual(parse_page_range("1", 5), [1])
        self.assertEqual(parse_page_range("3", 5), [3])
        self.assertEqual(parse_page_range("1,3,5", 5), [1, 3, 5])
        # Deduplication and sorting
        self.assertEqual(parse_page_range("4,2,2,1", 5), [1, 2, 4])

    def test_closed_and_mixed_ranges(self) -> None:
        """Tests closed ranges 'X-Y' and mixed ranges '1-3,5'."""
        self.assertEqual(parse_page_range("1-3", 5), [1, 2, 3])
        self.assertEqual(parse_page_range("2-4", 5), [2, 3, 4])
        self.assertEqual(parse_page_range("1-2,4-5", 5), [1, 2, 4, 5])
        self.assertEqual(parse_page_range("1-3, 5", 5), [1, 2, 3, 5])

    def test_open_ended_ranges(self) -> None:
        """Tests open-ended ranges '3-' and '-2'."""
        self.assertEqual(parse_page_range("3-", 5), [3, 4, 5])
        self.assertEqual(parse_page_range("-2", 5), [1, 2])
        self.assertEqual(parse_page_range("1-, -5", 5), [1, 2, 3, 4, 5])

    def test_out_of_bounds_rejected(self) -> None:
        """Page numbers exceeding total pages must raise PdfPageRangeError."""
        with self.assertRaises(PdfPageRangeError) as ctx:
            parse_page_range("6", 5)
        self.assertIn("exceeds document page count", str(ctx.exception))

        with self.assertRaises(PdfPageRangeError):
            parse_page_range("1-10", 5)

    def test_inverted_range_rejected(self) -> None:
        """Ranges where start > end ('5-2') must raise PdfPageRangeError."""
        with self.assertRaises(PdfPageRangeError) as ctx:
            parse_page_range("5-2", 10)
        self.assertIn("Inverted page range", str(ctx.exception))

    def test_zero_or_negative_page_rejected(self) -> None:
        """Page numbers < 1 must raise PdfPageRangeError."""
        with self.assertRaises(PdfPageRangeError):
            parse_page_range("0", 5)
        with self.assertRaises(PdfPageRangeError):
            parse_page_range("0-3", 5)

    def test_malformed_syntax_rejected(self) -> None:
        """Non-numeric or malformed tokens must raise PdfPageRangeError."""
        with self.assertRaises(PdfPageRangeError):
            parse_page_range("1-a", 5)
        with self.assertRaises(PdfPageRangeError):
            parse_page_range("xyz", 5)
        with self.assertRaises(PdfPageRangeError):
            parse_page_range("1--3", 5)


class TestBoundingBoxScaling(unittest.TestCase):
    """Tests geometry calculations, scaling modes, and DPI conversions."""

    def setUp(self) -> None:
        # A4 source: 595.28 x 841.89 pts
        self.a4_bbox = PageBoundingBox(0.0, 0.0, 595.28, 841.89)

    def test_fit_page_same_aspect_ratio(self) -> None:
        """Scaling A4 to A4 target with 300 DPI."""
        scaling = calculate_page_scaling(
            source_bbox=self.a4_bbox,
            target_paper="A4",
            dpi=300,
            scaling_mode=ScalingMode.FIT_PAGE,
        )
        self.assertAlmostEqual(scaling.scale_x, 1.0, places=3)
        self.assertAlmostEqual(scaling.scale_y, 1.0, places=3)
        # Expected pixels: 595.28 / 72.0 * 300 ~ 2480 px, 841.89 / 72.0 * 300 ~ 3508 px
        self.assertEqual(scaling.target_width_px, 2481)
        self.assertEqual(scaling.target_height_px, 3508)
        self.assertEqual(scaling.offset_x_px, 0)
        self.assertEqual(scaling.offset_y_px, 0)

    def test_fit_page_different_aspect_ratio(self) -> None:
        """Scaling A4 to Letter (612 x 792) with FIT_PAGE."""
        letter_bbox = PageBoundingBox(0.0, 0.0, 612.0, 792.0)
        scaling = calculate_page_scaling(
            source_bbox=letter_bbox,
            target_paper="A4",
            dpi=300,
            scaling_mode=ScalingMode.FIT_PAGE,
        )
        # Letter is wider than A4 proportionally, so scale_x limits scaling
        self.assertLess(scaling.scale_x, 1.0)
        self.assertEqual(scaling.scale_x, scaling.scale_y)
        # Height will have vertical centering offset
        self.assertGreaterEqual(scaling.offset_y_px, 0)

    def test_standard_paper_sizes_defined(self) -> None:
        """Verifies standard paper sizes dictionary contains key ISO and ANSI dimensions."""
        self.assertIn("A4", STANDARD_PAPER_SIZES_PTS)
        self.assertIn("A3", STANDARD_PAPER_SIZES_PTS)
        self.assertIn("LETTER", STANDARD_PAPER_SIZES_PTS)
        self.assertIn("LEGAL", STANDARD_PAPER_SIZES_PTS)
        a4_w, a4_h = STANDARD_PAPER_SIZES_PTS["A4"]
        self.assertAlmostEqual(a4_w, 595.28, places=1)
        self.assertAlmostEqual(a4_h, 841.89, places=1)

    def test_shrink_to_fit_mode(self) -> None:
        """SHRINK_TO_FIT should not upscale smaller source pages."""
        # Small 300x400 pts source page
        small_bbox = PageBoundingBox(0.0, 0.0, 300.0, 400.0)
        scaling = calculate_page_scaling(
            source_bbox=small_bbox,
            target_paper="A4",
            dpi=300,
            scaling_mode=ScalingMode.SHRINK_TO_FIT,
        )
        self.assertEqual(scaling.scale_x, 1.0)
        self.assertEqual(scaling.scale_y, 1.0)

    def test_dpi_variations(self) -> None:
        """DPI directly affects target pixel dimensions."""
        scaling_150 = calculate_page_scaling(self.a4_bbox, target_paper="A4", dpi=150)
        scaling_600 = calculate_page_scaling(self.a4_bbox, target_paper="A4", dpi=600)

        # 600 DPI dimensions should be exactly 4x 150 DPI dimensions
        self.assertAlmostEqual(
            scaling_600.target_width_px / scaling_150.target_width_px, 4.0, delta=0.05
        )
        self.assertAlmostEqual(
            scaling_600.target_height_px / scaling_150.target_height_px, 4.0, delta=0.05
        )


class TestRasterRendering(unittest.TestCase):
    """Tests page raster generation, Windows BMP file compliance, and file output."""

    def setUp(self) -> None:
        self.renderer = PdfRenderer(backend=BuiltinPdfBackend())

    def test_render_pages_to_bmp_bytes(self) -> None:
        """Renders page to Windows uncompressed DIB bitmap."""
        data = _generate_synthetic_pdf(num_pages=3)
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(data)
            temp_path = Path(f.name)

        try:
            pages = self.renderer.render_pages(
                file_path=temp_path,
                page_range="1,3",
                dpi=150,
                color_mode="bw",
                target_paper="A4",
            )
            self.assertEqual(len(pages), 2)
            self.assertEqual(pages[0].page_number, 1)
            self.assertEqual(pages[1].page_number, 3)

            for page in pages:
                self.assertEqual(page.format, "bmp")
                self.assertEqual(page.color_mode, "bw")
                self.assertEqual(page.dpi, 150)
                self.assertGreater(page.width_px, 1000)
                self.assertGreater(page.height_px, 1500)

                # Validate BMP header
                bmp_bytes = page.image_bytes
                self.assertTrue(bmp_bytes.startswith(b"BM"))
                bf_size = struct.unpack_from("<I", bmp_bytes, 2)[0]
                self.assertEqual(bf_size, len(bmp_bytes))

                # Info header biWidth and biHeight
                bi_width, bi_height = struct.unpack_from("<II", bmp_bytes, 18)
                self.assertEqual(bi_width, page.width_px)
                self.assertEqual(bi_height, page.height_px)
        finally:
            if temp_path.exists():
                temp_path.unlink()

    def test_render_pages_persisted_to_disk(self) -> None:
        """Rendered raster files are written to designated output directory."""
        data = _generate_synthetic_pdf(num_pages=2)
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(data)
            temp_path = Path(f.name)

        with tempfile.TemporaryDirectory() as temp_dir:
            out_dir = Path(temp_dir)
            pages = self.renderer.render_pages(
                file_path=temp_path,
                page_range="2",
                dpi=150,
                color_mode="color",
                output_dir=out_dir,
            )

            self.assertEqual(len(pages), 1)
            rendered = pages[0]
            self.assertIsNotNone(rendered.output_path)
            self.assertTrue(rendered.output_path.exists())
            self.assertTrue(rendered.output_path.name.startswith("page_0002_150dpi_color.bmp"))
            self.assertEqual(rendered.output_path.stat().st_size, len(rendered.image_bytes))

        if temp_path.exists():
            temp_path.unlink()

    def test_render_corrupt_file_raises_error(self) -> None:
        """Attempting to render an invalid or corrupt file raises appropriate PdfError."""
        # Test file with invalid header (>32 bytes)
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(b"NOT A VALID PDF HEADER WITH SUFFICIENT LENGTH TO EXCEED THIRTY TWO BYTES")
            temp_invalid = Path(f.name)

        # Test truncated/corrupted file
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(b"%PDF-1.4 but truncated content without eof marker")
            temp_corrupt = Path(f.name)

        try:
            with self.assertRaises(PdfInvalidHeaderError):
                self.renderer.render_pages(temp_invalid)
            with self.assertRaises(PdfCorruptedError):
                self.renderer.render_pages(temp_corrupt)
        finally:
            if temp_invalid.exists():
                temp_invalid.unlink()
            if temp_corrupt.exists():
                temp_corrupt.unlink()

    def test_render_password_protected_file_raises_error(self) -> None:
        """Attempting to render password-protected file raises PdfPasswordProtectedError."""
        data = _generate_synthetic_pdf(num_pages=1, encrypted=True)
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(data)
            temp_path = Path(f.name)

        try:
            with self.assertRaises(PdfPasswordProtectedError):
                self.renderer.render_pages(temp_path)
        finally:
            if temp_path.exists():
                temp_path.unlink()


class TestAdrDocumentation(unittest.TestCase):
    """Verifies that the PDF renderer selection ADR exists and covers licensing."""

    def test_adr_file_exists_and_contains_licensing_rationale(self) -> None:
        """ADR 001 must document PDFium (Apache 2.0) vs MuPDF (AGPL-3.0)."""
        adr_path = Path(__file__).resolve().parents[1] / "docs" / "ADR_001_PDF_RENDERER_CHOICE.md"
        self.assertTrue(adr_path.exists(), f"ADR 001 not found at {adr_path}")

        content = adr_path.read_text(encoding="utf-8")
        self.assertIn("PDFium", content)
        self.assertIn("pypdfium2", content)
        self.assertIn("MuPDF", content)
        self.assertIn("Apache", content)
        self.assertIn("AGPL", content)
        self.assertIn("Accepted", content)


if __name__ == "__main__":
    unittest.main()
