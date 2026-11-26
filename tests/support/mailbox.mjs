import { createServer as createHttpServer } from "node:http";
import { createServer as createSmtpServer } from "node:net";
import { createInterface } from "node:readline";

export async function openTestMailbox() {
  const messages = new Map();
  const http = createHttpServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1:3101");
    const link = messages.get(url.searchParams.get("email"));
    response.writeHead(link ? 200 : 404, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(link ? { link } : { message: "No test message received yet" }));
  });
  const smtp = createSmtpServer((socket) => {
    socket.setTimeout(10000, () => socket.destroy());
    const lines = createInterface({ input: socket, crlfDelay: Infinity });
    socket.write("220 biotrades-test ESMTP\r\n");
    let recipient = "";
    let data = null;
    lines.on("line", (line) => {
      if (data) {
        if (line !== ".") {
          data.push(line);
          return;
        }
        const decoded = data
          .join("\n")
          .replace(/=\n/g, "")
          .replace(/=([A-F0-9]{2})/g, (_, value) => String.fromCharCode(parseInt(value, 16)));
        const link = decoded.match(/http:\/\/localhost:3100\/api\/auth\/verify-email\?[^\s]+/);
        if (recipient && link) messages.set(recipient, link[0]);
        data = null;
        socket.write("250 Message accepted\r\n");
      } else if (/^DATA$/i.test(line)) {
        data = [];
        socket.write("354 End data with <CRLF>.<CRLF>\r\n");
      } else if (/^RCPT TO:/i.test(line)) {
        recipient = line.match(/<([^>]+@example\.test)>/i)?.[1] ?? "";
        socket.write(recipient ? "250 Recipient accepted\r\n" : "550 Test recipient required\r\n");
      } else if (/^QUIT$/i.test(line)) {
        socket.end("221 Bye\r\n");
      } else {
        socket.write("250 OK\r\n");
      }
    });
  });
  await Promise.all([
    new Promise((resolve) => http.listen(3101, "127.0.0.1", resolve)),
    new Promise((resolve) => smtp.listen(3102, "127.0.0.1", resolve)),
  ]);
  return () => {
    http.close();
    smtp.close();
  };
}
