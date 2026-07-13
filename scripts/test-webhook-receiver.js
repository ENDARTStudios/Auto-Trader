// Simple webhook receiver for testing notifications.
// Logs every received payload to stdout and returns 200 OK.
import http from "node:http";

const PORT = 9876;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    console.log("=== RECEIVED ===");
    console.log(`${req.method} ${req.url}`);
    console.log("Body:", body);
    console.log("================\n");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, receivedAt: new Date().toISOString() }));
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Test webhook receiver listening on http://127.0.0.1:${PORT}`);
});
