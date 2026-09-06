import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import next from "next";

// Custom-server boot only: the snapshot's Next config, routes and auth are real.
const server = createServer((request, response) => handler(request, response));
let handler;
let app;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10_000);
  try {
    server.closeAllConnections();
    server.close();
    await app?.close();
    await rm(process.env.BROWSER_SNAPSHOT, { recursive: true, force: true });
  } finally {
    clearTimeout(deadline);
    process.exit(0);
  }
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("disconnect", stop);

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  process.env.AUTH_URL = url;
  process.env.NEXTAUTH_URL = url;
  app = next({
    dev: true,
    dir: process.cwd(),
    hostname: "127.0.0.1",
    port,
    webpack: true,
  });
  await app.prepare();
  handler = app.getRequestHandler();
  process.send({ url });
} catch (error) {
  console.error(error);
  await stop();
}
