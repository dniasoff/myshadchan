#!/usr/bin/env python3
"""Generate the small, fictional demo asset pack for seed_demo and FakeRest.

Run from the repo root:
  python3 supabase/functions/seed_demo/assets/generate_assets.py

Outputs:
  - supabase/functions/seed_demo/assets/portraits/*.jpg
  - supabase/functions/seed_demo/assets/resumes/*.pdf
  - supabase/functions/seed_demo/assets/misc/*.pdf
  - src/components/atomic-crm/providers/fakerest/dataGenerator/assets_base64.ts
"""

import base64
import io
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[4]
ASSETS_DIR = ROOT / "supabase" / "functions" / "seed_demo" / "assets"
PORTRAITS_DIR = ASSETS_DIR / "portraits"
RESUMES_DIR = ASSETS_DIR / "resumes"
MISC_DIR = ASSETS_DIR / "misc"
FAKEREST_ASSETS_FILE = (
    ROOT
    / "src"
    / "components"
    / "atomic-crm"
    / "providers"
    / "fakerest"
    / "dataGenerator"
    / "assets_base64.ts"
)
DENO_BASE64_ASSETS_FILE = ASSETS_DIR / "manifest_base64.ts"

PORTRAITS = [
    ("rivky-stern.jpg", "Rivky Stern", "Rivky", (255, 230, 240)),
    ("yaakov-stern.jpg", "Yaakov Stern", "Yaakov", (220, 235, 255)),
    ("ahron-klein.jpg", "Ahron Klein", "Ahron", (230, 255, 230)),
    ("eliezer-katz.jpg", "Eliezer Katz", "Eliezer", (255, 240, 220)),
    ("yosef-mandel.jpg", "Yosef Mandel", "Yosef", (220, 255, 250)),
    ("esther-malka-weiss.jpg", "Esther Malka Weiss", "Esther Malka", (255, 228, 225)),
    ("devora-leah-gross.jpg", "Devora Leah Gross", "Devora Leah", (240, 230, 255)),
    ("shira-feldman.jpg", "Shira Feldman", "Shira", (230, 255, 240)),
]

RESUMES = [
    (
        "rivky-stern.pdf",
        "Rivky Stern",
        "Rivky Stern is a 20-year-old Bais Yaakov graduate from Lakewood, NJ. She is described as warm, organized, and close to her family. Her parents are Rabbi and Mrs. Stern, well-known in the Lakewood community. Rivky is seeking a learning boy with good middos and a stable family background. References available upon request.",
    ),
    (
        "yaakov-stern.pdf",
        "Yaakov Stern",
        "Yaakov Stern is a 23-year-old bochur learning in Beth Medrash Govoha (BMG). He is known for his hasmada and pleasant demeanor. His parents are Rabbi and Mrs. Stern of Lakewood. Yaakov is looking for a sincere, family-oriented girl who values a Torah home. References: rebbeim and chavrusos available.",
    ),
    (
        "ahron-klein.pdf",
        "Ahron Klein",
        "Ahron Klein, 23, is a serious learner from Lakewood currently in a BMG afternoon shiur. He is the son of R' Moshe and Esther Klein. Teachers describe him as a masmid with excellent middos. He is looking for a girl from a warm, ehrliche home. References include his rebbe and family friends.",
    ),
    (
        "eliezer-katz.pdf",
        "Eliezer Katz",
        "Eliezer Katz, 23, learns in Yeshiva Gedolah of Philadelphia. Son of R' Chaim and Miriam Katz, he is well-regarded for his diligence and cheerful personality. He is seeking a girl with strong yiras shamayim and a close family. References: Rosh Yeshiva, chavrusa, and family friend.",
    ),
    (
        "yosef-mandel.pdf",
        "Yosef Mandel",
        "Yosef Mandel, 24, is learning in Yeshiva Torah Vodaas in Brooklyn. He is the son of R' Shloime and Faigy Mandel. Known for his hasmada and easygoing nature, he is looking for a sincere girl from a stable home. References include his rebbe and chavrusa.",
    ),
    (
        "esther-malka-weiss.pdf",
        "Esther Malka Weiss",
        "Esther Malka Weiss, 19, is a graduate of Bais Yaakov of Lakewood. She is the daughter of R' Shmuel and Rivka Weiss. Described as mature, warm, and family-oriented, she is looking for a learning boy with good middos. References available from her teachers and neighbors.",
    ),
    (
        "devora-leah-gross.pdf",
        "Devora Leah Gross",
        "Devora Leah Gross, 20, attended Bais Yaakov of Yerushalayim (BJJ). She is the daughter of R' Aryeh and Sarah Gross of Monsey. She is known for her sincerity, creativity, and love of children. She is seeking a boy with strong hashkafa and a warm family. References: seminary teacher and family friend.",
    ),
    (
        "shira-feldman.pdf",
        "Shira Feldman",
        "Shira Feldman, 19, is a graduate of Michlalah in Yerushalayim. She is the daughter of R' Yosef and Chava Feldman of Passaic, NJ. Described as thoughtful, capable, and close to her family, she is looking for a boy who is serious about learning and growth. References available.",
    ),
]

MISC = [
    (
        "family-notes.pdf",
        "Family Notes",
        "General family notes for the shidduch: the parents are warm and welcoming. The household is Torah-oriented with an emphasis on chesed and hospitality. No specific concerns were noted. Notes compiled from informal conversations and a brief family background call.",
    ),
    (
        "reference-summary.pdf",
        "Reference Summary",
        "Reference summary for this suggestion: the rebbi gave a strong report on learning and middos. A neighbor confirmed the family is well-respected and ehrliche. One reference noted the boy is particularly good with younger siblings. Overall impression is positive and consistent across callers.",
    ),
    (
        "stein-notes.pdf",
        "Stein Notes",
        "Notes from Rabbi Avrohom Stein's reference call: the family is solid and well-known in the BMG circle. Rabbi Stein emphasized the boy's hasmada and respectful demeanor. He recommends pursuing the shidduch and is available for follow-up questions if needed.",
    ),
]


def _draw_gradient(draw: ImageDraw.ImageDraw, size: int, color: tuple[int, int, int]) -> None:
    """Draw a subtle radial gradient behind the portrait placeholder."""
    cx, cy = size // 2, size // 2
    for r in range(size // 2, -1, -1):
        factor = 0.55 + 0.45 * (r / (size // 2))
        fill = tuple(int(c * factor) for c in color)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def generate_portrait(filename: str, label: str, first_name: str, color: tuple[int, int, int]) -> bytes:
    size = 400
    img = Image.new("RGB", (size, size), color)
    draw = ImageDraw.Draw(img)
    _draw_gradient(draw, size, color)

    try:
        font_large = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 42)
        font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
    except Exception:
        font_large = ImageFont.load_default()
        font_small = font_large

    # Silhouette placeholder circle
    outline = (100, 100, 100)
    draw.ellipse([120, 70, 280, 230], outline=outline, width=3)
    # Draw a simple face-ish silhouette
    draw.ellipse([150, 100, 250, 180], outline=outline, width=2)
    draw.arc([150, 110, 250, 170], 0, 180, fill=outline, width=2)

    # Name label
    bbox = draw.textbbox((0, 0), label, font=font_large)
    text_width = bbox[2] - bbox[0]
    draw.text(((size - text_width) // 2, 280), label, fill=(50, 50, 50), font=font_large)

    note = "Fictional demo portrait"
    bbox = draw.textbbox((0, 0), note, font=font_small)
    text_width = bbox[2] - bbox[0]
    draw.text(((size - text_width) // 2, 340), note, fill=(100, 100, 100), font=font_small)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


def _escape_pdf_string(s: str) -> str:
    # PDF literal strings need certain chars escaped.
    escaped = []
    for ch in s:
        if ch == "\\":
            escaped.append("\\\\")
        elif ch == "(":
            escaped.append("\\(")
        elif ch == ")":
            escaped.append("\\)")
        elif ord(ch) > 126:
            escaped.append(f"\\{ord(ch):03o}")
        else:
            escaped.append(ch)
    return "".join(escaped)


def generate_pdf(filename: str, title: str, body: str) -> bytes:
    """Generate a minimal but valid PDF 1.4 with a title and body text."""
    title = _escape_pdf_string(title)
    body = _escape_pdf_string(body)

    # Body text wrapped into lines
    lines = []
    max_chars = 80
    words = body.split(" ")
    current = ""
    for w in words:
        if len(current) + len(w) + 1 <= max_chars:
            current = f"{current} {w}" if current else w
        else:
            lines.append(current)
            current = w
    if current:
        lines.append(current)

    content_lines = []
    y = 700
    for line in lines:
        content_lines.append(f"( {_escape_pdf_string(line)} ) Tj")
        content_lines.append("0 -18 Td")
        y -= 18

    content_stream = f"""BT
/F1 18 Tf
100 720 Td
( {_escape_pdf_string('Demo Resume')} ) Tj
0 -30 Td
/F1 14 Tf
( {title} ) Tj
0 -30 Td
/F1 10 Tf
{chr(10).join(content_lines)}
ET
"""
    content_bytes = content_stream.encode("latin-1")
    content_length = len(content_bytes)

    objects = [
        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj",
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj",
        f"4 0 obj\n<< /Length {content_length} >>\nstream\n{content_stream}endstream\nendobj",
        "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj",
    ]

    offsets = []
    pdf = io.BytesIO()
    pdf.write(b"%PDF-1.4\n")
    pdf.write(b"%\xe2\xe3\xcf\xd3\n")  # binary marker
    for obj in objects:
        offsets.append(pdf.tell())
        pdf.write(obj.encode("latin-1"))
        pdf.write(b"\n")

    xref_offset = pdf.tell()
    pdf.write(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    pdf.write(b"0000000000 65535 f \n")
    for offset in offsets:
        pdf.write(f"{offset:010d} 00000 n \n".encode("latin-1"))

    pdf.write(
        f"""trailer
<< /Size {len(objects) + 1} /Root 1 0 R >>
startxref
{xref_offset}
%%EOF
""".encode("latin-1")
    )
    return pdf.getvalue()


def main() -> None:
    PORTRAITS_DIR.mkdir(parents=True, exist_ok=True)
    RESUMES_DIR.mkdir(parents=True, exist_ok=True)
    MISC_DIR.mkdir(parents=True, exist_ok=True)

    base64_map: dict[str, str] = {}

    for filename, label, first_name, color in PORTRAITS:
        data = generate_portrait(filename, label, first_name, color)
        (PORTRAITS_DIR / filename).write_bytes(data)
        base64_map[f"portraits/{filename}"] = base64.b64encode(data).decode("ascii")

    for filename, title, body in RESUMES:
        data = generate_pdf(filename, title, body)
        (RESUMES_DIR / filename).write_bytes(data)
        base64_map[f"resumes/{filename}"] = base64.b64encode(data).decode("ascii")

    for filename, title, body in MISC:
        data = generate_pdf(filename, title, body)
        (MISC_DIR / filename).write_bytes(data)
        base64_map[f"misc/{filename}"] = base64.b64encode(data).decode("ascii")

    fakeRestLines = [
        "// Auto-generated by supabase/functions/seed_demo/assets/generate_assets.py",
        "// Base64-encoded demo assets for the FakeRest provider.",
        "// These are small, clearly fictional/synthetic files.",
        "",
        "export const ASSETS_BASE64: Record<string, string> = {",
    ]
    for key in sorted(base64_map):
        fakeRestLines.append(f'  "{key}": "{base64_map[key]}",')
    fakeRestLines.append("};")
    fakeRestLines.append("")

    FAKEREST_ASSETS_FILE.parent.mkdir(parents=True, exist_ok=True)
    FAKEREST_ASSETS_FILE.write_text("\n".join(fakeRestLines))

    denoLines = [
        "// Auto-generated by supabase/functions/seed_demo/assets/generate_assets.py",
        "// Base64-encoded demo assets used as a fallback when Deno.readFile is unavailable.",
        "// These are small, clearly fictional/synthetic files.",
        "",
        "export const ASSETS_BASE64: Record<string, string> = {",
    ]
    for key in sorted(base64_map):
        denoLines.append(f'  "{key}": "{base64_map[key]}",')
    denoLines.append("};")
    denoLines.append("")
    DENO_BASE64_ASSETS_FILE.write_text("\n".join(denoLines))

    print(
        f"Wrote {len(base64_map)} assets to disk, {FAKEREST_ASSETS_FILE}, and {DENO_BASE64_ASSETS_FILE}"
    )


if __name__ == "__main__":
    main()
