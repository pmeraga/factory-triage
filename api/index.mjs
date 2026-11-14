import worker from "../dist/server/index.js";

// The rewrite carries the original path explicitly because Vercel may present
// the function destination as request.url. This is a routing parameter only;
// every request still passes through the Worker's shared production handler.
const PATH_PARAMETER = "__factory_triage_path";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const paths = url.searchParams.getAll(PATH_PARAMETER);
    if (paths.length) {
      const path = paths.length === 1 ? paths[0] : "";
      const valid =
        path.startsWith("/") &&
        !path.startsWith("//") &&
        !/[?#\\\u0000-\u0020]/.test(path);
      // Invalid or ambiguous rewrite parameters become a 404, never an
      // alternate origin or an unintended application route.
      url.pathname = valid ? path : "/__invalid_rewrite_path";
      url.searchParams.delete(PATH_PARAMETER);
    }
    return worker.fetch(new Request(url, request));
  },
};
