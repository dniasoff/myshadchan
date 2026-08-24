import { describe, expect, it } from "vitest";

import { convertDocxToSafeHtml } from "./docxSanitizer";

/**
 * A Word document is the one preview path whose output reaches the DOM as
 * HTML, so the sanitiser is this feature's security boundary — the same role
 * `attachmentPreview.ts`'s mime allow-list plays for the frame. `mammoth`
 * turns a file any account member can upload into markup, and that markup is
 * injected with `dangerouslySetInnerHTML`; everything below is what stands
 * between those two facts.
 *
 * The conversion step is stubbed so these exercise the REAL DOMPurify
 * configuration against markup a malicious `.docx` could plausibly produce,
 * rather than needing a crafted binary fixture per case.
 */
/** Parses sanitised output into a detached tree, so assertions can be about
 * live nodes rather than about substrings. */
const parseHtml = (html: string): HTMLElement => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
};

const convertAs = (html: string) =>
  convertDocxToSafeHtml(new ArrayBuffer(0), {
    convert: () => Promise.resolve(html),
  });

describe("convertDocxToSafeHtml — what survives into the page", () => {
  it("keeps the prose a resume is actually made of", async () => {
    // Arrange
    const html =
      "<h1>Ari Rosenberg</h1><p>Learning at <strong>Ner Yisroel</strong>.</p>" +
      "<ul><li>Baltimore, MD</li></ul>";

    // Act
    const safe = await convertAs(html);

    // Assert
    expect(safe).toContain("Ari Rosenberg");
    expect(safe).toContain("<strong>Ner Yisroel</strong>");
    expect(safe).toContain("<li>Baltimore, MD</li>");
  });

  it("keeps tables, which is how half of these documents are laid out", async () => {
    // Arrange / Act
    const safe = await convertAs(
      '<table><tr><td colspan="2">Father</td><td>Occupation</td></tr></table>',
    );

    // Assert
    expect(safe).toContain("<td");
    expect(safe).toContain('colspan="2"');
    expect(safe).toContain("Occupation");
  });
});

describe("convertDocxToSafeHtml — the security boundary", () => {
  it("strips a script tag outright", async () => {
    // Arrange / Act
    const safe = await convertAs('<p>hi</p><script>alert("x")</script>');

    // Assert
    expect(safe).not.toContain("<script");
    expect(safe).not.toContain("alert(");
    expect(safe).toContain("hi");
  });

  it("strips inline event handlers, keeping the text they hid behind", async () => {
    // Arrange / Act
    const safe = await convertAs(
      '<p onclick="steal()" onmouseover="steal()">Family details</p>',
    );

    // Assert
    expect(safe.toLowerCase()).not.toContain("onclick");
    expect(safe.toLowerCase()).not.toContain("onmouseover");
    expect(safe).toContain("Family details");
  });

  it("removes an iframe, so a document cannot embed a page of its own", async () => {
    // Arrange / Act
    const safe = await convertAs(
      '<iframe src="https://evil.example/harvest"></iframe><p>ok</p>',
    );

    // Assert
    expect(safe).not.toContain("<iframe");
    expect(safe).not.toContain("evil.example");
  });

  it("removes forms, so nothing in the document can collect anything", async () => {
    // Arrange / Act
    const safe = await convertAs(
      '<form action="https://evil.example"><input name="x" /></form><p>ok</p>',
    );

    // Assert
    expect(safe).not.toContain("<form");
    expect(safe).not.toContain("<input");
    expect(safe).toContain("ok");
  });

  it("drops style attributes and style blocks, so a document cannot restyle the app", async () => {
    // Arrange / Act — `position: fixed` over the real UI is the concern here,
    // not aesthetics.
    const safe = await convertAs(
      '<style>body{display:none}</style><p style="position:fixed;inset:0">x</p>',
    );

    // Assert
    expect(safe).not.toContain("<style");
    expect(safe.toLowerCase()).not.toContain("position:fixed");
    expect(safe.toLowerCase()).not.toContain("display:none");
  });

  it("drops links entirely rather than trusting their href", async () => {
    // Arrange / Act — `<a>` is absent from the allow-list, so a
    // `javascript:` href has no element to live on in the first place.
    const safe = await convertAs(
      "<p><a href=\"javascript:alert('x')\">click</a></p>",
    );

    // Assert
    expect(safe.toLowerCase()).not.toContain("javascript:");
    expect(safe).not.toContain("<a ");
    // The words survive; only the navigable element is gone.
    expect(safe).toContain("click");
  });

  it("drops images, including the data: URIs mammoth inlines", async () => {
    // Arrange / Act — `img` is absent from the allow-list deliberately: a
    // Word resume's inline photo is not worth opening an attribute channel,
    // and the Photo tab is where a photo belongs.
    const safe = await convertAs(
      '<p>before</p><img src="data:image/png;base64,AAAA" onerror="steal()" /><p>after</p>',
    );

    // Assert
    expect(safe).not.toContain("<img");
    expect(safe.toLowerCase()).not.toContain("onerror");
    expect(safe).toContain("before");
    expect(safe).toContain("after");
  });

  it("survives a nested obfuscation attempt rather than half-stripping it", async () => {
    // Arrange / Act — the classic case where a naive regex stripper leaves a
    // working tag behind after removing the inner one.
    const safe = await convertAs("<p><scr<script>ipt>alert(1)</script></p>");

    // Assert — the property is an absent executable ELEMENT, not absent
    // characters. `alert(1)` survives here as escaped text inside a <p>,
    // which is inert; asserting the substring is gone would be asserting
    // something neither true nor necessary.
    expect(parseHtml(safe).querySelectorAll("script").length).toBe(0);
    expect(safe.toLowerCase()).not.toContain("<script");
  });

  it("leaves nothing executable anywhere, across every attack shape at once", async () => {
    // Arrange — one document carrying each vector, parsed and inspected as a
    // tree. A string assertion can pass while a live node survives; this
    // cannot.
    const hostile = [
      "<script>a()</script>",
      '<img src=x onerror="a()">',
      '<a href="javascript:a()">x</a>',
      '<iframe src="https://evil.example"></iframe>',
      '<svg onload="a()"></svg>',
      '<body onload="a()">',
      '<form action="https://evil.example"><input></form>',
      '<p style="position:fixed">y</p>',
      "<style>*{display:none}</style>",
    ].join("");

    // Act
    const root = parseHtml(await convertAs(hostile));

    // Assert
    for (const banned of [
      "script",
      "img",
      "a",
      "iframe",
      "svg",
      "form",
      "input",
      "style",
      "object",
      "embed",
    ]) {
      expect(root.querySelectorAll(banned).length).toBe(0);
    }
    for (const element of root.querySelectorAll("*")) {
      for (const attribute of element.getAttributeNames()) {
        expect(attribute.toLowerCase().startsWith("on")).toBe(false);
        expect(["colspan", "rowspan"]).toContain(attribute.toLowerCase());
      }
    }
  });
});
