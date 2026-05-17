/**
 * EPUB Templates
 * Standard templates for EPUB structure
 */
const EpubTemplates = {
  /**
   * Generate mimetype file content
   */
  mimetype: 'application/epub+zip',

  /**
   * Generate container.xml
   */
  containerXml: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,

  /**
   * Generate content.opf
   * @param {Object} metadata - { title, author, date, uuid, coverMediaType }
   */
  contentOpf(metadata, images = []) {
    const { title, author, date, uuid, coverMediaType } = metadata;
    const creatorLine = author
      ? `    <dc:creator>${this.escapeXml(author)}</dc:creator>`
      : '';
    const dateLine = date
      ? `    <dc:date>${this.escapeXml(date)}</dc:date>`
      : '';

    // Cover metadata
    const coverMeta = coverMediaType
      ? `    <meta name="cover" content="cover-image" />`
      : '';

    const coverItem = coverMediaType
      ? `    <item id="cover-image" href="images/cover.jpg" media-type="${coverMediaType}" properties="cover-image"/>`
      : '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${this.escapeXml(title)}</dc:title>
${creatorLine}
${dateLine}
${coverMeta}
    <dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
${coverItem}
${images.map(img => `    <item id="${img.id}" href="images/${img.id}.${img.ext}" media-type="${img.mimeType}"/>`).join('\n')}
  </manifest>
  <spine toc="ncx">
    <itemref idref="content"/>
  </spine>
</package>`;
  },

  /**
   * Generate toc.ncx
   * @param {Object} metadata - { title, uuid }
   */
  tocNcx(metadata) {
    const { title, uuid } = metadata;
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${uuid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text>${this.escapeXml(title)}</text>
  </docTitle>
  <navMap>
    <navPoint id="navpoint-1" playOrder="1">
      <navLabel>
        <text>${this.escapeXml(title)}</text>
      </navLabel>
      <content src="content.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`;
  },

  /**
   * Generate content.xhtml for longpost
   * @param {Object} data - { title, author, date, body, url }
   */
  contentXhtml(data) {
    const { title, author, date, body, url } = data;

    // Build metadata line: @handle • date • Source: url
    const metaParts = [];
    if (author) metaParts.push(this.escapeXml(author));
    if (date) metaParts.push(this.escapeXml(date));
    if (url) metaParts.push(`<a href="${this.escapeXml(url)}">Source</a>`);
    const metaLine = metaParts.length > 0
      ? `<p class="meta">${metaParts.join(' • ')}</p>`
      : '';

    // Convert HTML body to XHTML (properly close self-closing tags)
    const xhtmlBody = this.htmlToXhtml(body);

    return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head>
  <meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8"/>
  <title>${this.escapeXml(title)}</title>
  <style type="text/css">
    body {
      margin: 1.5em;
      line-height: 1.7;
      font-family: Georgia, "Times New Roman", serif;
    }
    h1 {
      font-size: 1.5em;
      margin-bottom: 0.3em;
      line-height: 1.3;
    }
    .meta {
      color: #666;
      font-size: 0.85em;
      margin-bottom: 1.5em;
      padding-bottom: 1em;
      border-bottom: 1px solid #ddd;
    }
    .meta a {
      color: #666;
    }
    p {
      margin: 0.9em 0;
      text-align: left;
    }
    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 1em auto;
    }
    blockquote {
      margin: 1em 1.5em;
      padding-left: 1em;
      border-left: 3px solid #ccc;
      font-style: italic;
    }
  </style>
</head>
<body>
  <h1>${this.escapeXml(title)}</h1>
  ${metaLine}
  <div class="content">
    ${xhtmlBody}
  </div>
</body>
</html>`;
  },

  /**
   * Escape XML special characters
   * @param {string} text
   */
  escapeXml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
  },

  /**
   * Convert HTML to XHTML by properly closing self-closing tags
   * @param {string} html
   */
  htmlToXhtml(html) {
    if (!html) return '';

    let result = html;

    // Remove <source> elements (HTML5, inside <picture>, unknown to XHTML 1.1 parsers)
    result = result.replace(/<source[^>]*\/?>/gi, '');

    // Unwrap <picture> — keep inner <img>, discard the wrapper tags
    result = result.replace(/<picture[^>]*>/gi, '').replace(/<\/picture>/gi, '');

    // Strip attributes not in XHTML 1.1 that can confuse strict parsers
    result = result.replace(/\s+srcset="[^"]*"/gi, '');
    result = result.replace(/\s+sizes="[^"]*"/gi, '');
    result = result.replace(/\s+loading="[^"]*"/gi, '');
    result = result.replace(/\s+decoding="[^"]*"/gi, '');
    result = result.replace(/\s+fetchpriority="[^"]*"/gi, '');
    result = result.replace(/\s+data-[\w-]+(?:="[^"]*"|='[^']*')?/gi, '');

    // Replace HTML named entities not defined in XHTML without the DTD.
    // &amp; &lt; &gt; &quot; &apos; are predefined XML entities — keep them.
    const namedEntities = {
      '&nbsp;': '&#160;', '&mdash;': '&#8212;', '&ndash;': '&#8211;',
      '&hellip;': '&#8230;', '&ldquo;': '&#8220;', '&rdquo;': '&#8221;',
      '&lsquo;': '&#8216;', '&rsquo;': '&#8217;', '&bull;': '&#8226;',
      '&laquo;': '&#171;',  '&raquo;': '&#187;',  '&copy;': '&#169;',
      '&reg;': '&#174;',    '&trade;': '&#8482;',  '&euro;': '&#8364;',
      '&deg;': '&#176;',    '&plusmn;': '&#177;',  '&times;': '&#215;',
      '&divide;': '&#247;', '&frac12;': '&#189;',  '&frac14;': '&#188;',
      '&frac34;': '&#190;', '&acute;': '&#180;',   '&micro;': '&#181;',
    };
    for (const [named, numeric] of Object.entries(namedEntities)) {
      result = result.split(named).join(numeric);
    }

    // Self-close void elements (required by XHTML)
    const voidElements = [
      'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
      'link', 'meta', 'param', 'track', 'wbr'
    ];
    const pattern = new RegExp(
      `<(${voidElements.join('|')})([^>]*?)(?<!/)>`,
      'gi'
    );
    return result.replace(pattern, '<$1$2 />');
  }
};
