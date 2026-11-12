/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A page that sends the browser to another address of this application. On the native kernel a package cannot redirect: the kernel's response has no `redirect`, and it relays a package's status, body and content type and no other header, so a Location never reaches the browser and the old address answered HTTP 500 (found 2026-11-11). The page carries one address and no script: a refresh at once, and a link for a browser that does not refresh.
 */

/**
 * @description The hand-off page to an address of this site.
 * @param target Where to send the browser: a path on this site, with its query when it has one.
 * @param label The words of the link and the page's title.
 * @returns The page's HTML.
 */
export function handOffPage(target: string, label: string): string {
  // A hand-off never leaves this site: a path, not another host.
  if (!/^\/[^/\\]/.test(target)) throw new Error('A hand-off stays on this site');
  const plain = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const address = plain(target), words = plain(label);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0; url=${address}">
<title>${words}</title>
</head>
<body>
<p><a href="${address}">${words}</a></p>
</body>
</html>
`;
}
