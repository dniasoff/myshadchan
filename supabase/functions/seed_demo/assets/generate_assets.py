#!/usr/bin/env python3
"""Validate synthetic portraits and build the canonical demo asset bundle.

Portrait JPGs are committed source assets created with OpenAI image generation.
This script deliberately never invents or replaces them with placeholders. It
fails closed when the 22-person identity manifest and the files drift apart,
then generates polished, photo-free resume PDFs and both runtime base64 packs.

Run from the repository root:
  python3 supabase/functions/seed_demo/assets/generate_assets.py
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ModuleNotFoundError as error:
    raise SystemExit(
        "Pillow is required. Run: python3 -m pip install -r "
        "supabase/functions/seed_demo/assets/requirements.txt"
    ) from error

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
IDENTITY_MANIFEST_FILE = ASSETS_DIR / "identity_manifest.ts"
FIXED_PDF_TIMESTAMP = b"D:20260101000000Z"
MIN_PORTRAIT_BYTES = 30_000
MAX_PORTRAIT_BYTES = 250_000
MAX_ASSET_BYTES = 1_000_000

PAGE_SIZE = (1275, 1650)  # US Letter at 150dpi
NAVY = "#17324D"
NAVY_SOFT = "#294861"
CREAM = "#F7F2E8"
PAPER = "#FFFDF8"
GOLD = "#C49A52"
INK = "#1C2A35"
MUTED = "#65717A"
WHITE = "#FFFFFF"


@dataclass(frozen=True)
class Person:
    slug: str
    name: str
    subject_type: str
    subject_id: int
    target_single_id: int | None
    sex: str
    age: int
    height: str
    location: str
    education: str
    parents: str
    about: str
    looking_for: str
    references: str


# The one identity source for portrait validation, resume generation, and
# base64 packing. Every name and subject id matches the FakeRest showcase.
PEOPLE: tuple[Person, ...] = (
    Person("rivky-klein", "Rivky Klein", "single", 1, None, "female", 24, "5'4\"", "Baltimore, MD", "Bais Yaakov of Baltimore; degree in speech-language sciences", "Dovid and Miriam Klein", "Warm, thoughtful, and organized. Rivky enjoys family time, creative projects, and volunteering with children. Friends describe her as sincere, perceptive, and easy to speak with.", "A kind, growth-oriented man who values learning, family, clear communication, and building a warm Torah home together.", "Mrs. Tova Stein · teacher; Mrs. Gold · family friend; available through the family"),
    Person("yaakov-klein", "Yaakov Klein", "single", 2, None, "male", 27, "5'11\"", "Lakewood, NJ", "Beth Medrash Govoha; business analytics coursework", "Dovid and Miriam Klein", "A thoughtful, steady learner with a practical streak. Yaakov is close with his family, dependable with friends, and balances a serious seder with part-time analytical work.", "A warm, grounded woman who values family, Torah growth, mutual respect, and a balanced home in the Northeast.", "Rabbi Shimon Adler · rebbe; Moshe Weiss · chavrusa; available through the family"),
    Person("ari-rosenberg", "Ari Rosenberg", "shidduch", 1, 1, "male", 25, "5'11\"", "Baltimore, MD", "Ner Yisroel; undergraduate business studies", "Michael and Sarah Rosenberg", "Warm, articulate, and community-minded. Ari is known for being dependable, upbeat, and genuinely interested in other people.", "A sincere, warm woman who appreciates learning, family closeness, and an engaged community life.", "Rabbi Eliezer Stein · rebbe; Daniel Rosen · family friend"),
    Person("menachem-stern", "Menachem Stern", "shidduch", 2, 1, "male", 26, "6'0\"", "Brooklyn, NY", "Mir Yerushalayim; finance certification", "David and Rachel Stern", "Thoughtful and calm with a strong learning routine. Menachem is a careful listener, close to his siblings, and quietly ambitious.", "A thoughtful, family-oriented woman who values sincerity, personal growth, and a balanced Torah home.", "Rabbi Chaim Feld · rebbe; Yossi Stern · cousin"),
    Person("boruch-sofer", "Boruch Sofer", "shidduch", 3, 1, "male", 24, "5'10\"", "Lakewood, NJ", "Beth Medrash Govoha", "Moshe and Leah Sofer", "A serious learner with an approachable, easygoing manner. Boruch is loyal, considerate, and well-liked by friends and rebbeim.", "A warm woman from a close family who values learning, kindness, and steady growth.", "Rabbi Avraham Katz · rebbe; Shmuel Weiss · chavrusa"),
    Person("dovid-berkowitz", "Dovid Berkowitz", "shidduch", 4, 1, "male", 25, "5'9\"", "Lakewood, NJ", "Beth Medrash Govoha; accounting coursework", "Yitzchok and Chana Berkowitz", "A masmid with excellent middos and a warm, practical personality. Dovid is responsible, modest, and very close with his family.", "A grounded, communicative woman who wants a warm home centered on Torah, respect, and family.", "Rabbi Moshe Halpern · rebbe; Mrs. Feldman · family reference"),
    Person("shmuli-katz", "Shmuli Katz", "shidduch", 5, 1, "male", 27, "6'1\"", "Monsey, NY", "Mir Yerushalayim; family business apprenticeship", "Avi and Miriam Katz", "Lively, kind, and industrious. Shmuli maintains a strong learning schedule while contributing to his family's business.", "An upbeat, sincere woman who values family, learning, and building a joyful, responsible home.", "Rabbi Dovid Klein · rebbe; Ezra Katz · employer"),
    Person("yisroel-fried", "Yisroel Fried", "shidduch", 6, 1, "male", 25, "5'10\"", "Cleveland, OH", "Telshe Yeshiva", "Eli and Tova Fried", "Personable, responsible, and grounded. Yisroel is known for consistency, good judgment, and making people feel comfortable.", "A kind, practical woman who values family closeness, sincerity, and continued Torah growth.", "Rabbi Yehuda Cohen · rebbe; Avi Fried · brother"),
    Person("yehuda-klein", "Yehuda Klein", "shidduch", 7, 1, "male", 26, "5'11\"", "Lakewood, NJ", "Beth Medrash Govoha", "Yehuda and Rivka Klein", "Organized, warm, and deeply connected to his rebbeim. Yehuda is a steady friend with a calm sense of humor.", "A warm, emotionally intelligent woman who values family, learning, and straightforward communication.", "Rabbi Aaron Levy · rebbe; Naftali Weiss · chavrusa"),
    Person("moshe-diamond", "Moshe Diamond", "shidduch", 8, 1, "male", 24, "5'8\"", "Monsey, NY", "Mir Yerushalayim; design coursework", "Shlomo and Esther Diamond", "Creative, upbeat, and committed to growth. Moshe brings warmth and curiosity to his learning, friendships, and family life.", "A sincere, positive woman who appreciates creativity, family, and an open, growth-minded home.", "Rabbi Yitzchok Rosen · rebbe; Eli Diamond · family friend"),
    Person("eli-traube", "Eli Traube", "shidduch", 9, 1, "male", 28, "6'0\"", "Baltimore, MD", "Ner Yisroel; healthcare administration", "Avrohom and Devorah Traube", "Mature and easygoing with a strong learning routine. Eli is thoughtful, stable, and attentive to the people around him.", "A mature, warm woman looking to build a balanced home with Torah, kindness, and mutual support.", "Rabbi Noach Adler · rebbe; Dr. Sam Weiss · supervisor"),
    Person("chaim-landau", "Chaim Landau", "shidduch", 10, 1, "male", 25, "5'10\"", "Monsey, NY", "Mir Yerushalayim; operations role", "Yosef and Bracha Landau", "A warm baal middos who balances learning and work well. Chaim is genuine, family-oriented, and quick to help.", "A caring, grounded woman who values growth, family partnership, and a welcoming Torah home.", "Rabbi Meir Stern · rebbe; Daniel Landau · employer"),
    Person("yosef-gross", "Yosef Gross", "shidduch", 11, 1, "male", 26, "5'11\"", "Lakewood, NJ", "Beth Medrash Govoha; real-estate coursework", "Mendel and Chani Gross", "Polished, thoughtful, and well-liked. Yosef combines serious learning with a warm, practical approach to people and responsibility.", "A sincere, articulate woman who values Torah, family, and a calm, mutually supportive home.", "Rabbi Shlomo Fried · rebbe; Menachem Gross · cousin"),
    Person("tzvi-adler", "Tzvi Adler", "shidduch", 12, 1, "male", 24, "5'9\"", "Baltimore, MD", "Ner Yisroel", "Yitzchok and Rina Adler", "Sincere, articulate, and focused on building a home. Tzvi is a loyal friend with a thoughtful, optimistic personality.", "A warm woman from a stable family who values learning, communication, and shared purpose.", "Rabbi Moshe Berger · rebbe; Chaim Adler · brother"),
    Person("naftali-berger", "Naftali Berger", "shidduch", 13, 1, "male", 27, "6'1\"", "Lakewood, NJ", "Beth Medrash Govoha; technology consulting", "Shimon and Ruth Berger", "Bright, kind, and low-key. Naftali is a focused learner, a trusted friend, and thoughtful about building a meaningful home.", "A thoughtful, warm woman who appreciates learning, steadiness, and close family relationships.", "Rabbi Yosef Landau · rebbe; Tzvi Berger · colleague"),
    Person("leah-steinberg", "Leah Steinberg", "shidduch", 14, 2, "female", 23, "5'4\"", "Passaic, NJ", "Bnos Chava; early-childhood education", "Yosef and Miriam Steinberg", "Warm, capable, and family-oriented. Leah is known for patience, follow-through, and making others feel included.", "A thoughtful man who values Torah learning, family, kindness, and building a calm, joyful home.", "Mrs. Chani Weiss · teacher; Mrs. Gold · family friend"),
    Person("miriam-roth", "Miriam Roth", "shidduch", 15, 2, "female", 24, "5'5\"", "Baltimore, MD", "Bais Yaakov of Baltimore; occupational therapy program", "Daniel and Chaya Roth", "Dependable, warm, and articulate. Miriam enjoys family gatherings, chesed projects, and meaningful conversation.", "A grounded, growth-oriented man who values learning, family partnership, and honest communication.", "Mrs. Leah Feldman · teacher; Rabbi Roth · family reference"),
    Person("sara-weinberg", "Sara Weinberg", "shidduch", 16, 2, "female", 23, "5'3\"", "Lakewood, NJ", "Bnos Devorah; bookkeeping certification", "Yehuda and Tzipporah Weinberg", "Responsible and quietly confident. Sara is thoughtful, organized, and especially close with her siblings and grandparents.", "A sincere man with good middos who values family, steady growth, and a warm Torah-centered home.", "Mrs. Bracha Cohen · teacher; Miriam Adler · neighbor"),
    Person("tamar-weiss", "Tamar Weiss", "shidduch", 17, 2, "female", 22, "5'4\"", "Lakewood, NJ", "Bnos Binah; graphic-design studies", "Yosef and Miriam Weiss", "Thoughtful, creative, and community-minded. Tamar brings warmth and care to her friendships, family, and volunteer work.", "A kind, emotionally aware man who values learning, family, creativity, and mutual respect.", "Mrs. Shoshana Levy · teacher; Chani Weiss · sister"),
    Person("ariella-cohen", "Ariella Cohen", "shidduch", 18, 2, "female", 23, "5'5\"", "Passaic, NJ", "Bnos Chaim; business operations", "Chaim and Shoshana Cohen", "Sincere, organized, and very close with her siblings. Ariella is practical, warm, and dependable in both work and friendship.", "A thoughtful, responsible man who values Torah growth, family closeness, and building together.", "Mrs. Devorah Stein · mentor; Tova Cohen · family friend"),
    Person("chani-levine", "Chani Levine", "shidduch", 19, 2, "female", 24, "5'6\"", "Baltimore, MD", "Bais Yaakov; communications degree", "Yitzchok and Rochel Levine", "Warm, articulate, and committed to a balanced home. Chani is a careful listener, an engaged aunt, and a dependable friend.", "A sincere man who values learning, clear communication, family, and a purposeful, welcoming home.", "Mrs. Miriam Katz · teacher; Rabbi Levine · uncle"),
    Person("miriam-kaplan", "Miriam Kaplan", "shidduch", 20, 2, "female", 25, "5'4\"", "Monsey, NY", "Bnos Sarah; social-work program", "Shlomo and Tova Kaplan", "Mature, warm, and calm. Miriam is known for empathy, good judgment, and the steady care she brings to family and community.", "A kind, thoughtful man who values Torah, emotional maturity, family, and a balanced life in the Northeast.", "Mrs. Rina Berger · supervisor; Leah Kaplan · family friend"),
)

# A few profiles intentionally have a prior resume version so the demo can
# show its document-history UI without inventing additional identities.
PROFILE_VERSIONS: tuple[tuple[str, str, str], ...] = (
    ("rivky-klein-2025", "rivky-klein", "ARCHIVED PROFILE · 2025"),
    ("yaakov-klein-2025", "yaakov-klein", "ARCHIVED PROFILE · 2025"),
    ("menachem-stern-2025", "menachem-stern", "ARCHIVED PROFILE · 2025"),
)

MISC_DOCUMENTS = (
    ("family-notes.pdf", "Family Notes", "A concise background summary compiled from fictional demo conversations. The family is warm, welcoming, Torah-oriented, and known for chesed and hospitality. No specific concerns were noted; follow-up questions are organized in the CRM timeline."),
    ("reference-summary.pdf", "Reference Summary", "The fictional demo references consistently describe strong middos, dependable friendships, a serious approach to growth, and a warm family. This summary exists only to demonstrate a polished attachment workflow."),
    ("stein-notes.pdf", "Reference Call Notes", "Rabbi Stein's fictional demo call emphasized hasmada, respectful communication, and a well-regarded family. He recommends continuing the conversation and is available for follow-up through the family."),
)

DEMO_SHARE_FILENAME = "rivky-klein-for-leah-feldman.pdf"
DEMO_SHARE_WATERMARK = "DEMO COPY — PREPARED FOR LEAH FELDMAN"


def _font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    candidates = (
        name,
        f"/usr/share/fonts/truetype/dejavu/{name}",
        f"/usr/local/share/fonts/{name}",
    )
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    raise RuntimeError(f"Required DejaVu font not found: {name}")


def _validate_manifest() -> None:
    if len(PEOPLE) != 22:
        raise RuntimeError(f"Expected 22 canonical profiles, found {len(PEOPLE)}")
    slugs = {person.slug for person in PEOPLE}
    subjects = {(person.subject_type, person.subject_id) for person in PEOPLE}
    if len(slugs) != len(PEOPLE) or len(subjects) != len(PEOPLE):
        raise RuntimeError("Profile slugs and subject identities must be unique")
    version_slugs = {version_slug for version_slug, _, _ in PROFILE_VERSIONS}
    version_owners = {owner_slug for _, owner_slug, _ in PROFILE_VERSIONS}
    if len(version_slugs) != len(PROFILE_VERSIONS) or version_slugs & slugs:
        raise RuntimeError("Resume version slugs must be unique")
    if not version_owners <= slugs:
        raise RuntimeError("Every resume version must belong to a canonical profile")
    for person in PEOPLE:
        if person.sex not in {"female", "male"} or person.age < 18:
            raise RuntimeError(f"Invalid adult/sex invariant for {person.slug}")
        if person.subject_type == "shidduch":
            expected = "male" if person.target_single_id == 1 else "female"
            if person.target_single_id not in {1, 2} or person.sex != expected:
                raise RuntimeError(f"Opposite-sex pairing invariant failed for {person.slug}")


def _validate_portraits() -> None:
    portrait_hashes: dict[str, str] = {}
    for person in PEOPLE:
        path = PORTRAITS_DIR / f"{person.slug}.jpg"
        if not path.is_file():
            raise RuntimeError(f"Missing canonical portrait: {path.relative_to(ROOT)}")
        if path.stat().st_size < MIN_PORTRAIT_BYTES:
            raise RuntimeError(f"Portrait is suspiciously small: {path.name}")
        if path.stat().st_size > MAX_PORTRAIT_BYTES:
            raise RuntimeError(f"Portrait is unexpectedly large: {path.name}")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in portrait_hashes:
            raise RuntimeError(
                f"Portrait bytes are duplicated: {path.name} and {portrait_hashes[digest]}"
            )
        portrait_hashes[digest] = path.name
        with Image.open(path) as image:
            if image.format != "JPEG" or image.mode != "RGB":
                raise RuntimeError(f"Portrait must be RGB JPEG: {path.name}")
            if image.width != image.height or image.width < 400:
                raise RuntimeError(f"Portrait must be square and at least 400px: {path.name}")


def _fit_lines(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=font)[2] <= width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def _draw_wrapped(draw: ImageDraw.ImageDraw, text: str, xy: tuple[int, int], font: ImageFont.FreeTypeFont, fill: str, width: int, line_height: int, max_lines: int | None = None) -> int:
    x, y = xy
    lines = _fit_lines(draw, text, font, width)
    if max_lines is not None:
        lines = lines[:max_lines]
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += line_height
    return y


def _draw_label(
    draw: ImageDraw.ImageDraw,
    label: str,
    value: str,
    y: int,
    *,
    max_lines: int = 3,
) -> int:
    draw.text((64, y), label.upper(), font=_font(18, bold=True), fill=GOLD)
    return (
        _draw_wrapped(
            draw,
            value,
            (64, y + 31),
            _font(22),
            WHITE,
            280,
            31,
            max_lines,
        )
        + 24
    )


def _draw_section(draw: ImageDraw.ImageDraw, title: str, body: str, y: int, *, max_lines: int) -> int:
    draw.text((432, y), title.upper(), font=_font(20, bold=True), fill=GOLD)
    draw.line((432, y + 33, 1190, y + 33), fill="#DED4C4", width=2)
    return _draw_wrapped(draw, body, (432, y + 55), _font(24), INK, 750, 35, max_lines) + 31


def _normalize_pdf_metadata(path: Path) -> None:
    """Replace Pillow's wall-clock PDF dates without changing byte offsets."""
    normalized, replacements = re.subn(
        rb"D:\d{14}Z",
        FIXED_PDF_TIMESTAMP,
        path.read_bytes(),
    )
    if replacements < 2:
        raise RuntimeError(f"Expected PDF timestamps in {path.name}")
    path.write_bytes(normalized)


def generate_resume(
    person: Person,
    *,
    output_slug: str | None = None,
    output_path: Path | None = None,
    eyebrow: str = "MYSHADCHAN · CURATED PROFILE",
    watermark: str | None = None,
) -> None:
    canvas = Image.new("RGB", PAGE_SIZE, PAPER)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, 365, PAGE_SIZE[1]), fill=NAVY)
    draw.rectangle((365, 0, 377, PAGE_SIZE[1]), fill=GOLD)
    draw.rectangle((377, 0, PAGE_SIZE[0], 158), fill=CREAM)

    initials = "".join(part[0] for part in person.name.split()[:2]).upper()
    draw.ellipse((78, 72, 287, 281), fill=NAVY_SOFT, outline=GOLD, width=5)
    box = draw.textbbox((0, 0), initials, font=_font(70, bold=True))
    draw.text((182 - (box[2] - box[0]) / 2, 176 - (box[3] - box[1]) / 2), initials, font=_font(70, bold=True), fill=WHITE)
    draw.text((64, 330), "PROFILE", font=_font(20, bold=True), fill=GOLD)
    draw.text((64, 365), "Fictional demo", font=_font(23), fill=WHITE)
    draw.line((64, 420, 310, 420), fill=NAVY_SOFT, width=3)

    y = 458
    y = _draw_label(draw, "Age", str(person.age), y)
    y = _draw_label(draw, "Height", person.height, y)
    y = _draw_label(draw, "Location", person.location, y)
    y = _draw_label(draw, "Parents", person.parents, y)
    _draw_label(draw, "References", person.references, y, max_lines=5)

    draw.text((432, 64), eyebrow, font=_font(19, bold=True), fill=GOLD)
    draw.text((432, 102), person.name, font=_font(52, bold=True), fill=NAVY)
    draw.text((434, 174), f"{person.age} · {person.location} · {person.height}", font=_font(24), fill=MUTED)
    draw.rounded_rectangle((432, 229, 1190, 350), radius=18, fill=CREAM)
    draw.text((461, 253), "AT A GLANCE", font=_font(18, bold=True), fill=GOLD)
    _draw_wrapped(draw, "Warm character, clear values, and a thoughtful approach to building a Torah home.", (461, 284), _font(23), NAVY, 700, 31, 2)

    y = 399
    y = _draw_section(draw, "About", person.about, y, max_lines=5)
    y = _draw_section(draw, "Education & Direction", person.education, y, max_lines=3)
    y = _draw_section(draw, "Looking For", person.looking_for, y, max_lines=5)
    _draw_section(draw, "Family", f"Parents: {person.parents}. Fuller background and contacts are available privately through the managing household.", y, max_lines=4)

    draw.line((432, 1510, 1190, 1510), fill="#DED4C4", width=2)
    draw.text((432, 1534), "FICTIONAL DEMO PROFILE · SYNTHETIC IDENTITY · NO REAL PII", font=_font(16, bold=True), fill=MUTED)
    draw.text((432, 1571), "Photos remain separately permissioned and explicitly revealed in MyShadchan.", font=_font(17), fill=MUTED)
    if watermark:
        banner_font = _font(22, bold=True)
        banner_box = draw.textbbox((0, 0), watermark, font=banner_font)
        banner_width = banner_box[2] - banner_box[0]
        banner_left = (PAGE_SIZE[0] - banner_width - 56) // 2
        draw.rounded_rectangle(
            (banner_left, 12, banner_left + banner_width + 56, 54),
            radius=14,
            fill=GOLD,
            outline=NAVY,
            width=2,
        )
        draw.text(
            (banner_left + 28, 20),
            watermark,
            font=banner_font,
            fill=NAVY,
        )
    output_path = output_path or RESUMES_DIR / f"{output_slug or person.slug}.pdf"
    canvas.save(
        output_path,
        "PDF",
        resolution=150.0,
        quality=92,
        title=watermark or f"{person.name} · Fictional demo resume",
    )
    _normalize_pdf_metadata(output_path)


def generate_misc_pdf(filename: str, title: str, body: str) -> None:
    canvas = Image.new("RGB", PAGE_SIZE, PAPER)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, PAGE_SIZE[0], 185), fill=NAVY)
    draw.rectangle((0, 185, PAGE_SIZE[0], 197), fill=GOLD)
    draw.text((92, 70), title, font=_font(48, bold=True), fill=WHITE)
    draw.text((92, 235), "MYSHADCHAN · FICTIONAL DEMO ATTACHMENT", font=_font(19, bold=True), fill=GOLD)
    _draw_wrapped(draw, body, (92, 320), _font(27), INK, 1080, 41, 12)
    draw.line((92, 1450, 1180, 1450), fill="#DED4C4", width=2)
    draw.text((92, 1485), "Synthetic demo content · No real personal information", font=_font(18), fill=MUTED)
    output_path = MISC_DIR / filename
    canvas.save(output_path, "PDF", resolution=150.0, quality=92)
    _normalize_pdf_metadata(output_path)


def _canonical_paths() -> list[str]:
    paths: list[str] = []
    for person in PEOPLE:
        paths.extend((f"portraits/{person.slug}.jpg", f"resumes/{person.slug}.pdf"))
    paths.extend(
        f"resumes/{version_slug}.pdf"
        for version_slug, _, _ in PROFILE_VERSIONS
    )
    paths.extend(f"misc/{filename}" for filename, _, _ in MISC_DOCUMENTS)
    paths.append(f"misc/{DEMO_SHARE_FILENAME}")
    return sorted(paths)


def _validate_canonical_files(paths: list[str]) -> None:
    expected = set(paths)
    actual = {
        path.relative_to(ASSETS_DIR).as_posix()
        for directory in (PORTRAITS_DIR, RESUMES_DIR, MISC_DIR)
        for path in directory.iterdir()
        if path.is_file()
    }
    missing = sorted(expected - actual)
    extras = sorted(actual - expected)
    if missing or extras:
        raise RuntimeError(
            f"Demo asset directory drift; missing={missing}, extras={extras}"
        )
    oversized = [
        relative
        for relative in paths
        if (ASSETS_DIR / relative).stat().st_size > MAX_ASSET_BYTES
    ]
    if oversized:
        raise RuntimeError(f"Demo assets exceed {MAX_ASSET_BYTES} bytes: {oversized}")


def _write_identity_manifest() -> None:
    identities = [
        {
            "slug": person.slug,
            "name": person.name,
            "subjectType": person.subject_type,
            "subjectId": person.subject_id,
            "targetSingleId": person.target_single_id,
            "sex": person.sex,
            "age": person.age,
        }
        for person in PEOPLE
    ]
    lines = [
        "// Auto-generated by generate_assets.py. Do not edit by hand.",
        "export const GENERATED_DEMO_IDENTITIES = [",
    ]
    for identity in identities:
        lines.extend(
            (
                "  {",
                f'    slug: {json.dumps(identity["slug"])},',
                f'    name: {json.dumps(identity["name"])},',
                f'    subjectType: {json.dumps(identity["subjectType"])},',
                f'    subjectId: {identity["subjectId"]},',
                "    targetSingleId: "
                f'{json.dumps(identity["targetSingleId"])},',
                f'    sex: {json.dumps(identity["sex"])},',
                f'    age: {identity["age"]},',
                "  },",
            )
        )
    lines.extend(("] as const;", ""))
    IDENTITY_MANIFEST_FILE.write_text("\n".join(lines), encoding="utf-8")


def _write_base64_manifests(paths: list[str]) -> None:
    encoded = {
        relative: base64.b64encode((ASSETS_DIR / relative).read_bytes()).decode("ascii")
        for relative in paths
    }
    fake_lines = [
        "// Auto-generated by supabase/functions/seed_demo/assets/generate_assets.py",
        "// Canonical local-only synthetic demo assets. Do not edit by hand.",
        "",
        "export const ASSETS_BASE64 = {",
    ]
    deno_lines = [
        "// Auto-generated by supabase/functions/seed_demo/assets/generate_assets.py",
        "// Canonical local-only synthetic demo assets. Do not edit by hand.",
        "",
        "export const ASSETS_BASE64 = {",
    ]
    for key in paths:
        fake_lines.extend((f'  "{key}":', f'    "{encoded[key]}",'))
        deno_lines.extend((f'  "{key}":', f'    "{encoded[key]}",'))
    fake_lines.extend(("} as const;", ""))
    deno_lines.extend(("} as const;", ""))
    FAKEREST_ASSETS_FILE.write_text("\n".join(fake_lines), encoding="utf-8")
    DENO_BASE64_ASSETS_FILE.write_text("\n".join(deno_lines), encoding="utf-8")


def main() -> None:
    RESUMES_DIR.mkdir(parents=True, exist_ok=True)
    MISC_DIR.mkdir(parents=True, exist_ok=True)
    _validate_manifest()
    _validate_portraits()
    for person in PEOPLE:
        generate_resume(person)
    people_by_slug = {person.slug: person for person in PEOPLE}
    for version_slug, owner_slug, eyebrow in PROFILE_VERSIONS:
        generate_resume(
            people_by_slug[owner_slug],
            output_slug=version_slug,
            eyebrow=eyebrow,
        )
    for document in MISC_DOCUMENTS:
        generate_misc_pdf(*document)
    generate_resume(
        people_by_slug["rivky-klein"],
        output_path=MISC_DIR / DEMO_SHARE_FILENAME,
        eyebrow="MYSHADCHAN · OFFICIAL ONBOARDING SHOWCASE",
        watermark=DEMO_SHARE_WATERMARK,
    )
    paths = _canonical_paths()
    _validate_canonical_files(paths)
    _write_identity_manifest()
    _write_base64_manifests(paths)
    print(f"Validated 22 portraits and wrote {len(paths)} canonical assets")


if __name__ == "__main__":
    main()
