// The sign-in hop's landing page on unset.cc (build step 6; ADR 0081 decision 4). web 303s the tab here with the ticket
// in the fragment (interfaces/web/src/lib/server/chat-sign-in.ts), which a browser never sends to a server. That a
// Referer leaves the fragment out (RFC 9110 section 10.1.3) was not re-read here, so the page does not rely on it: it
// is served with no-referrer and the script removes the fragment before it sends anything.
// Its one script, a fixed file on a path-scoped script-src (the web's pattern, interfaces/web/src/lib/server/csp.ts),
// reads the ticket, strips the fragment from the address bar and history at once (history.replaceState), and posts
// the ticket to /sign-in/redeem, the only address connect-src allows. On success it goes to the path the hop started
// from; handing the chat session to the chat page is build step 7's. Every message it shows is a fixed code.

export const RETURN_PATH = "/sign-in/return";
export const SCRIPT_PATH = "/sign-in/return.js";
export const REDEEM_PATH = "/sign-in/redeem";

/** No inline script or style, nothing framed, no form, no base: the script file and its one POST, nothing else. */
export const returnPageCsp = (origin: string): string =>
  [
    "default-src 'none'",
    `script-src ${origin}${SCRIPT_PATH}`,
    `connect-src ${origin}${REDEEM_PATH}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'",
  ].join("; ");

export const RETURN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Opening chat</title>
<script src="${SCRIPT_PATH}" defer></script>
</head>
<body>
<main><p id="status">Opening chat…</p></main>
</body>
</html>
`;

/**
 * The script. It writes only textContent (no Trusted Types sink) and navigates only to a path the door chose and
 * checked (`returnTo`, a same-origin path from safeReturnPath). The fragment goes before anything else runs.
 */
export const RETURN_SCRIPT = `"use strict";
(function () {
  var ticket = new URLSearchParams(window.location.hash.slice(1)).get("ticket");
  window.history.replaceState(null, "", window.location.pathname);
  var status = document.getElementById("status");
  function fail(code) {
    status.textContent = "Chat could not open (" + code + "). Go back and try again.";
  }
  if (ticket === null || ticket === "") {
    fail("chat.no_ticket");
    return;
  }
  window
    .fetch("${REDEEM_PATH}", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: ticket }),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    })
    .then(function (res) {
      return res.json().then(
        function (body) { return { ok: res.ok, body: body }; },
        function () { return { ok: false, body: null }; }
      );
    })
    .then(function (answer) {
      var body = answer.body || {};
      if (answer.ok && typeof body.returnTo === "string" && body.returnTo.charAt(0) === "/" && body.returnTo.charAt(1) !== "/") {
        window.location.replace(body.returnTo);
      } else {
        fail(typeof body.error === "string" ? body.error : "chat.unavailable");
      }
    }, function () {
      fail("chat.unavailable");
    });
})();
`;
