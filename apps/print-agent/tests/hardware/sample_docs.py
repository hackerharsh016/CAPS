"""Sample PDF document generator for hardware and compatibility matrix tests.

Produces valid, conformant PDF byte streams and files with known page counts,
orientations, and text markers for matrix permutation testing.
"""

from __future__ import annotations

from pathlib import Path


def create_minimal_pdf(pages: int = 1, landscape: bool = False, title: str = "Test") -> bytes:
    """Generate in-memory PDF bytes containing the specified number of pages."""
    width, height = (792, 612) if landscape else (612, 792)

    lines: list[bytes] = [
        b"%PDF-1.4",
        b"1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj",
    ]

    # Page object IDs will be 3, 5, 7, ...; Content object IDs will be 4, 6, 8, ...
    kids_refs = [f"{3 + i * 2} 0 R".encode() for i in range(pages)]
    kids_str = b" ".join(kids_refs)
    lines.append(
        f"2 0 obj <</Type /Pages /Kids [{kids_str.decode()}] /Count {pages}>> endobj".encode()
    )

    for i in range(pages):
        page_num = i + 1
        page_obj_id = 3 + i * 2
        content_obj_id = 4 + i * 2

        # Page object
        lines.append(
            f"{page_obj_id} 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] "
            f"/Contents {content_obj_id} 0 R /Resources <<>>>> endobj".encode()
        )

        # Content stream
        stream_text = (
            f"BT /F1 18 Tf 50 {height - 80} Td ({title} - Page {page_num} of {pages}) ET".encode()
        )
        stream_len = len(stream_text)
        lines.append(
            f"{content_obj_id} 0 obj <</Length {stream_len}>> stream\n".encode()
            + stream_text
            + b"\nendstream\nendobj"
        )

    # Build cross-reference table
    body = b"\n".join(lines) + b"\n"
    total_objects = 2 + pages * 2

    # Compute object byte offsets
    offsets: list[int] = [0]
    for obj_id in range(1, total_objects + 1):
        target = f"{obj_id} 0 obj".encode()
        pos = body.find(target)
        offsets.append(pos if pos != -1 else 0)

    xref_lines = [f"xref\n0 {total_objects + 1}".encode(), b"0000000000 65535 f "]
    for off in offsets[1:]:
        xref_lines.append(f"{off:010d} 00000 n ".encode())

    xref_data = b"\n".join(xref_lines) + b"\n"
    startxref = len(body)
    trailer = (
        f"trailer <</Size {total_objects + 1} /Root 1 0 R>>\nstartxref\n{startxref}\n%%EOF\n"
    ).encode()

    return body + xref_data + trailer


def write_sample_pdf(
    path: Path, pages: int = 1, landscape: bool = False, title: str = "Test"
) -> Path:
    """Write sample PDF to disk and return path."""
    content = create_minimal_pdf(pages=pages, landscape=landscape, title=title)
    path.write_bytes(content)
    return path
