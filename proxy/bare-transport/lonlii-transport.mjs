// bare-mux hands every request body to the transport as a ReadableStream, and bare-as-module3
// uploads it as a streamed (chunked) body. bare servers drop those bodies, so every POST
// arrives empty: that's what made youtube say "you're offline" through the proxy.
// this wrapper reads the body into bytes first, so it's sent as a normal, sized request.
import BareClient from "./index.mjs";

export default class LonliiBareClient extends BareClient {
  async request(remote, method, body, headers, signal) {
    if (body instanceof ReadableStream) {
      body = await new Response(body).arrayBuffer();
    } else if (body instanceof Blob) {
      body = await body.arrayBuffer();
    }
    // a GET/HEAD with an empty body is rejected by fetch, so drop it entirely
    if (body && body.byteLength === 0 && (method === "GET" || method === "HEAD")) {
      body = undefined;
    }
    return super.request(remote, method, body, headers, signal);
  }
}
